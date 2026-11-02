"""Professional Excel workbooks: themed tables, KPI cards, native charts and right-to-left sheets.

    from officekit.excel import Workbook
    with Workbook("/mnt/data/sales.xlsx", theme="emerald", currency="SAR") as wb:
        ws = wb.sheet("الملخص")
        ws.title("تقرير المبيعات", "الربع الثالث 2026")
        ws.kpis([("إجمالي المبيعات", 1250000, "currency", 0.12), ("عدد العملاء", 342, "int")])
        t = ws.table(df, totals=["المبيعات"], highlight={"المبيعات": "bar"})
        ws.chart(t, x="المنطقة", y=["المبيعات"], kind="column", title="المبيعات حسب المنطقة")
"""

from __future__ import annotations

import os
import re
from datetime import date, datetime

import xlsxwriter
from xlsxwriter.utility import xl_rowcol_to_cell

from .theme import (
    currency_symbol,
    detect_rtl,
    format_value,
    get_theme,
    guess_kind,
    has_arabic,
    kpi_item,
    normalize_table,
    tint,
)

_SUBTOTAL = {"sum": 109, "average": 101, "avg": 101, "count": 103, "max": 104, "min": 105}
_CHARTS = {
    "column": ("column", None), "bar": ("bar", None), "line": ("line", None), "area": ("area", None),
    "pie": ("pie", None), "doughnut": ("doughnut", None), "scatter": ("scatter", None),
    "stacked_column": ("column", "stacked"), "stacked_bar": ("bar", "stacked"),
    "percent_column": ("column", "percent_stacked"), "stacked_area": ("area", "stacked"),
}


class TableRef:
    """Where a table was written; pass it to Sheet.chart() or use .range() in formulas."""

    def __init__(self, sheet, columns, kinds, header_row, first_col, last_row, total_row, peaks=None):
        self.sheet = sheet
        self.columns = columns
        self.kinds = dict(zip(columns, kinds))
        self.peaks = peaks or {}
        self.header_row = header_row
        self.first_col = first_col
        self.first_row = header_row + 1
        self.last_row = last_row
        self.total_row = total_row

    @property
    def last_col(self):
        return self.first_col + len(self.columns) - 1

    def col(self, name) -> int:
        if isinstance(name, int):
            return self.first_col + name
        try:
            return self.first_col + self.columns.index(name)
        except ValueError:
            raise KeyError(f"Column {name!r} not in table; columns are {self.columns}") from None

    def range(self, name, absolute=True) -> str:
        """Sheet-qualified data range of one column, e.g. 'البيانات'!$C$5:$C$40."""
        c = self.col(name)
        a = xl_rowcol_to_cell(self.first_row, c, absolute, absolute)
        b = xl_rowcol_to_cell(self.last_row, c, absolute, absolute)
        return f"'{self.sheet.name}'!{a}:{b}"


class Workbook:
    def __init__(self, path, theme="corporate", rtl=None, currency="SAR", title=None, author=None,
                 company=None, decimals=None, **theme_overrides):
        if not path.lower().endswith(".xlsx"):
            path += ".xlsx"
        folder = os.path.dirname(path)
        if folder:
            os.makedirs(folder, exist_ok=True)
        self.path = path
        self.theme = get_theme(theme, **theme_overrides)
        self.rtl = rtl
        self.currency = currency
        self.decimals = decimals
        self.wb = xlsxwriter.Workbook(path, {"nan_inf_to_errors": True, "remove_timezone": True})
        # Format 0 is the workbook's Normal style: every unformatted cell inherits it.
        self.wb.formats[0].set_font_name(self.theme.font)
        self.wb.formats[0].set_font_size(10)
        self.wb.set_properties({"title": title or "", "author": author or "", "company": company or ""})
        self._formats = {}
        self._sheets = []
        self._table_count = 0
        self._closed = False

    # -- formats -----------------------------------------------------------
    def fmt(self, **props):
        props.setdefault("font_name", self.theme.font)
        props.setdefault("font_size", 10)
        props.setdefault("font_color", self.theme.dark)
        props.setdefault("valign", "vcenter")
        key = tuple(sorted((k, str(v)) for k, v in props.items()))
        if key not in self._formats:
            self._formats[key] = self.wb.add_format(
                {k: (f"#{v}" if k.endswith("color") and isinstance(v, str) and not v.startswith("#") else v)
                 for k, v in props.items()}
            )
        return self._formats[key]

    def num_format(self, kind, decimals=None):
        d = (2 if self.decimals is None else self.decimals) if decimals is None else decimals
        frac = ("." + "0" * d) if d else ""
        if kind == "int":
            return "#,##0"
        if kind == "number":
            return f"#,##0{frac}"
        if kind == "currency":
            sym = currency_symbol(self.currency)
            if not sym:
                return f"#,##0{frac};[Red]-#,##0{frac}"
            if sym in ("$", "€", "£"):
                return f'"{sym}"#,##0{frac};[Red]-"{sym}"#,##0{frac}'
            return f'#,##0{frac} "{sym}";[Red]-#,##0{frac} "{sym}"'
        if kind == "percent":
            return "0.0%" if decimals is None else ("0%" if d == 0 else f"0.{'0' * d}%")
        if kind == "date":
            return "yyyy-mm-dd"
        if kind == "datetime":
            return "yyyy-mm-dd hh:mm"
        if kind in (None, "text"):
            return None
        return kind  # a raw Excel format string

    # -- sheets ------------------------------------------------------------
    def sheet(self, name, rtl=None, tab_color=None, landscape=None):
        rtl = self.rtl if rtl is None else rtl
        if rtl is None and has_arabic(name):
            rtl = True
        sheet = Sheet(self, name, rtl, tab_color, landscape)
        self._sheets.append(sheet)
        return sheet

    def data_sheet(self, name, data, columns=None, title=None, subtitle=None, **table_kwargs):
        """One-call sheet holding a single titled table. Returns (sheet, TableRef)."""
        cols, rows = normalize_table(data, columns)
        rtl = self.rtl if self.rtl is not None else detect_rtl([name, title, cols, rows[:20]])
        ws = self.sheet(name, rtl=rtl)
        if title:
            ws.title(title, subtitle)
        return ws, ws.table(rows, columns=cols, **table_kwargs)

    def save(self):
        if self._closed:
            return self.path
        for sheet in self._sheets:
            sheet._finalize()
        self.wb.close()
        self._closed = True
        return self.path

    close = save

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type is None:
            self.save()


class Sheet:
    FIRST_COL = 1  # column A is a narrow margin

    def __init__(self, book, name, rtl, tab_color, landscape):
        self.book = book
        self.t = book.theme
        self.name = _safe_sheet_name(name, [s.name for s in book._sheets])
        self.ws = book.wb.add_worksheet(self.name)
        self._rtl = rtl  # None: decided by the first text written
        self.landscape = landscape
        self.row = 1
        self.width = 0
        self._full_rows = []  # rows merged across the final used width at save time
        self._col_chars = {}
        self._froze = False
        ws = self.ws
        ws.hide_gridlines(2)
        if tab_color:
            ws.set_tab_color(f"#{tab_color.lstrip('#')}")
        ws.set_column(0, 0, 2.5)
        ws.set_row(0, 12)
        ws.set_paper(9)
        ws.set_margins(left=0.4, right=0.4, top=0.6, bottom=0.6)
        ws.fit_to_pages(1, 0)
        ws.center_horizontally()

    @property
    def rtl(self):
        return bool(self._rtl)

    def _decide(self, *texts):
        if self._rtl is None:
            joined = " ".join(str(x) for x in texts if x is not None)
            if joined.strip():
                self._rtl = has_arabic(joined)

    # -- full-width rows ---------------------------------------------------
    def title(self, text, subtitle=None):
        """Large title band (and optional subtitle) spanning the sheet's used width."""
        self._decide(text, subtitle)
        self._full_rows.append((self.row, text, "title"))
        self.ws.set_row(self.row, 34)
        self.row += 1
        if subtitle:
            self._full_rows.append((self.row, subtitle, "subtitle"))
            self.ws.set_row(self.row, 20)
            self.row += 1
        self.ws.set_row(self.row, 10)
        self.row += 1
        return self

    def section(self, text):
        """Section heading with a rule under it."""
        self._decide(text)
        if self.row > 3:
            self.row += 1
        self._full_rows.append((self.row, text, "section"))
        self.ws.set_row(self.row, 24)
        self.row += 2
        return self

    def note(self, text):
        """Muted, wrapped explanatory line (source, assumptions, remarks)."""
        self._full_rows.append((self.row, text, "note"))
        self.row += 2
        return self

    def gap(self, rows=1):
        self.row += rows
        return self

    # -- KPI cards ---------------------------------------------------------
    def kpis(self, items, per_row=4, card_cols=2):
        """Row(s) of KPI cards. Each item: (label, value[, kind[, delta]]) or a dict with
        label, value, kind ('int','number','currency','percent' or an Excel format),
        delta (fraction, e.g. 0.12 = +12%), delta_label, formula ('=SUM(...)' kept live)."""
        t, b = self.t, self.book
        items = [kpi_item(i) for i in items]
        self._decide(*(str(i["label"]) for i in items))
        for start in range(0, len(items), per_row):
            chunk = items[start:start + per_row]
            r = self.row
            self.ws.set_row(r, 22)
            self.ws.set_row(r + 1, 36)
            self.ws.set_row(r + 2, 20)
            for i, it in enumerate(chunk):
                c1 = self.FIRST_COL + i * card_cols
                c2 = c1 + card_cols - 1
                edge = {"left": 5, "right": 5, "left_color": "#FFFFFF", "right_color": "#FFFFFF"}
                label_f = b.fmt(bold=True, font_size=9, font_color=t.muted, bg_color=t.light, align="center",
                                top=5, top_color=t.color(i), **edge)
                kind = it["kind"] or ("int" if isinstance(it["value"], int) else "number")
                dec = it.get("decimals")
                if dec is None and isinstance(it["value"], (int, float)) and kind != "percent":
                    dec = 0 if float(it["value"]).is_integer() or abs(it["value"]) >= 1000 else 2
                value_f = b.fmt(bold=True, font_size=20, font_color=t.primary, bg_color=t.light, align="center",
                                num_format=b.num_format(kind, dec) or "General", **edge)
                self.ws.merge_range(r, c1, r, c2, it["label"], label_f)
                if it.get("formula"):
                    self.ws.merge_range(r + 1, c1, r + 1, c2, "", value_f)
                    self.ws.write_formula(r + 1, c1, it["formula"], value_f, it["value"] if it["value"] is not None else 0)
                else:
                    self.ws.merge_range(r + 1, c1, r + 1, c2, it["value"], value_f)
                delta = it.get("delta")
                if delta is None:
                    text, color = it.get("delta_label") or "", t.muted
                else:
                    arrow = "▲" if delta >= 0 else "▼"
                    text = f"{arrow} {abs(delta) * 100:.1f}%"
                    if it.get("delta_label"):
                        text += f"  {it['delta_label']}"
                    good = delta >= 0 if not it.get("lower_is_better") else delta <= 0
                    color = t.positive if good else t.negative
                delta_f = b.fmt(font_size=9, font_color=color, bg_color=t.light, align="center", bottom=5,
                                bottom_color="#FFFFFF", **edge)
                self.ws.merge_range(r + 2, c1, r + 2, c2, text, delta_f)
                for c in range(c1, c2 + 1):
                    self._col_chars[c] = max(self._col_chars.get(c, 0), 14)
            self.width = max(self.width, len(chunk) * card_cols)
            self.row += 4
        return self

    # -- tables ------------------------------------------------------------
    def table(self, data, columns=None, formats=None, totals=None, name=None, widths=None,
              highlight=None, zebra=True, decimals=None, freeze=None, total_label=None):
        """Write a formatted Excel table (filter buttons, banding, totals row).

        data:      DataFrame, list of dicts, or list of rows (+ columns=[...]).
        formats:   {column: 'text'|'int'|'number'|'currency'|'percent'|'date'|'datetime'|'<excel format>'}
                   — guessed from values and header names when omitted.
        totals:    True (sum every numeric column), [columns] to sum, or {column: 'sum'|'average'|'count'|'max'|'min'}.
        highlight: {column: 'bar'|'scale'|'scale_reverse'|'icons'|'negative'}.
        widths:    {column: width_in_characters} to override auto widths.
        Returns a TableRef for charts and formulas."""
        b, t, ws = self.book, self.t, self.ws
        cols, rows = normalize_table(data, columns)
        if not cols:
            raise ValueError("table() needs at least one column")
        self._decide(*cols, *(v for r in rows[:20] for v in r if isinstance(v, str)))
        formats = formats or {}
        kinds = [formats.get(c) or guess_kind([r[i] for r in rows], c) for i, c in enumerate(cols)]
        decimals = decimals if isinstance(decimals, dict) else {c: decimals for c in cols}
        peaks = {}
        for i, c in enumerate(cols):
            nums = [r[i] for r in rows if isinstance(r[i], (int, float)) and not isinstance(r[i], bool)]
            if nums:
                peaks[str(c)] = max(abs(v) for v in nums)
                if decimals.get(c) is None and b.decimals is None and kinds[i] in ("number", "currency"):
                    decimals[c] = 0 if all(float(v).is_integer() for v in nums) else 2
        totals = _normalize_totals(totals, cols, kinds)
        hdr, c0 = self.row, self.FIRST_COL
        last = hdr + max(len(rows), 1) + (1 if totals else 0)
        data_last = hdr + max(len(rows), 1)

        long_text = {}
        for i, c in enumerate(cols):
            if kinds[i] == "text":
                longest = max((len(str(r[i])) for r in rows if r[i] is not None), default=0)
                long_text[i] = longest > 48 or (widths and c in widths and longest > widths[c])

        header_f = b.fmt(bold=True, font_color="#FFFFFF", bg_color=t.primary, align="center", text_wrap=True,
                         border=1, border_color=t.primary)
        col_specs, cell_fmts = [], []
        for i, c in enumerate(cols):
            kind = kinds[i]
            props = {"bottom": 1, "bottom_color": t.border}
            nf = b.num_format(kind, decimals.get(c))
            if nf:
                props["num_format"] = nf
            if kind in ("int", "number", "currency", "percent", "date", "datetime"):
                props["align"] = "center"
            if long_text.get(i):
                props["text_wrap"] = True
            f = b.fmt(**props)
            cell_fmts.append(f)
            col_specs.append({"header": str(c), "header_format": header_f, "format": f})

        b._table_count += 1
        tname = _safe_table_name(name, b._table_count)
        ws.add_table(hdr, c0, data_last, c0 + len(cols) - 1, {
            "name": tname, "style": "Table Style Light 1", "banded_rows": False,
            "autofilter": True, "columns": col_specs,
            "data": rows if rows else [[None] * len(cols)],
        })
        ws.set_row(hdr, 30)
        for r in range(hdr + 1, data_last + 1):
            ws.set_row(r, 20 if not any(long_text.values()) else None)

        if totals:
            total_f = lambda kind, d=None: b.fmt(bold=True, bg_color=tint(t.primary, 0.85), align="center",
                                                  top=2, top_color=t.primary, bottom=2, bottom_color=t.primary,
                                                  num_format=b.num_format(kind, d) or "General")
            label = total_label or ("الإجمالي" if self.rtl else "Total")
            ws.write_string(last, c0, label, b.fmt(bold=True, bg_color=tint(t.primary, 0.85), top=2,
                                                     top_color=t.primary, bottom=2, bottom_color=t.primary))
            for i, c in enumerate(cols[1:], start=1):
                if c not in totals:
                    ws.write_blank(last, c0 + i, None, total_f("text"))
                    continue
                func = totals[c]
                cell_range = f"{xl_rowcol_to_cell(hdr + 1, c0 + i)}:{xl_rowcol_to_cell(data_last, c0 + i)}"
                values = [r[i] for r in rows if isinstance(r[i], (int, float)) and not isinstance(r[i], bool)]
                cached = _aggregate(func, values, len([r for r in rows if r[i] not in (None, "")]))
                kind = "int" if func == "count" else kinds[i]
                ws.write_formula(last, c0 + i, f"=SUBTOTAL({_SUBTOTAL[func]},{cell_range})",
                                 total_f(kind, decimals.get(c)), cached)

        if zebra and len(rows) > 2:
            ws.conditional_format(hdr + 1, c0, data_last, c0 + len(cols) - 1, {
                "type": "formula", "criteria": f"=MOD(ROW()-{hdr + 1},2)=0",
                "format": b.wb.add_format({"bg_color": f"#{t.light}"}),
            })
        for c, how in (highlight or {}).items():
            i = cols.index(c)
            self._highlight(hdr + 1, c0 + i, data_last, how)

        for i, c in enumerate(cols):
            if widths and c in widths:
                self._col_chars[c0 + i] = max(self._col_chars.get(c0 + i, 0), widths[c])
                continue
            shown = [format_value(r[i], kinds[i], b.currency, decimals.get(c)) for r in rows[:500]]
            longest = max([_text_width(s) for s in shown] + [min(_text_width(str(c)) + 2, 24), 6])
            self._col_chars[c0 + i] = max(self._col_chars.get(c0 + i, 0), min(longest + 3, 50))

        if freeze is None:
            freeze = not self._froze and hdr <= 5
        if freeze:
            ws.freeze_panes(hdr + 1, 0)
            self._froze = True
        ws.repeat_rows(hdr)
        self.width = max(self.width, len(cols))
        self.row = last + 2
        return TableRef(self, [str(c) for c in cols], kinds, hdr, c0, data_last, last if totals else None, peaks)

    def _highlight(self, r1, c, r2, how):
        t = self.t
        if how in ("bar", "data_bar"):
            opts = {"type": "data_bar", "bar_color": f"#{tint(t.secondary, 0.6)}", "bar_solid": True,
                    "bar_no_border": True}
            if self.rtl:
                opts["bar_direction"] = "right"
            self.ws.conditional_format(r1, c, r2, c, opts)
        elif how in ("scale", "scale_reverse"):
            lo, hi = (t.negative, t.positive) if how == "scale" else (t.positive, t.negative)
            self.ws.conditional_format(r1, c, r2, c, {
                "type": "3_color_scale", "min_color": f"#{tint(lo, 0.55)}", "mid_color": "#FFFFFF",
                "max_color": f"#{tint(hi, 0.55)}"})
        elif how == "icons":
            self.ws.conditional_format(r1, c, r2, c, {"type": "icon_set", "icon_style": "3_arrows"})
        elif how == "negative":
            self.ws.conditional_format(r1, c, r2, c, {
                "type": "cell", "criteria": "<", "value": 0,
                "format": self.book.wb.add_format({"font_color": f"#{t.negative}", "bold": True})})
        else:
            raise ValueError(f"Unknown highlight {how!r}")

    # -- charts ------------------------------------------------------------
    def chart(self, table, x=None, y=None, kind="column", title=None, labels=None, size=None,
              position="below", number_format=None, x_title=None, y_title=None, legend=None):
        """Native Excel chart from a TableRef.

        kind: column, bar, line, area, pie, doughnut, scatter, stacked_column, stacked_bar,
              percent_column, stacked_area.  x: category column (default: first).
        y: value column or list (default: every numeric column).  position: 'below', 'right' or a cell like 'H4'.
        size: (width_px, height_px)."""
        b, t = self.book, self.t
        if kind not in _CHARTS:
            raise ValueError(f"Unknown chart kind {kind!r}; choose from {', '.join(_CHARTS)}")
        ctype, subtype = _CHARTS[kind]
        x = x if x is not None else table.columns[0]
        if y is None:
            y = [c for c in table.columns if c != x and table.kinds.get(c) in ("int", "number", "currency", "percent")]
        ys = [y] if isinstance(y, (str, int)) else list(y)
        opts = {"type": ctype}
        if subtype:
            opts["subtype"] = subtype
        chart = b.wb.add_chart(opts)
        sheet = self.name
        r1, r2, xc = table.first_row, table.last_row, table.col(x)
        n_points = r2 - r1 + 1
        font = {"name": t.font, "color": f"#{t.muted}", "size": 9}
        pie = ctype in ("pie", "doughnut")
        if labels is None:
            labels = pie or (len(ys) == 1 and n_points <= 12)
        if number_format is None:
            first = table.columns[table.col(ys[0]) - table.first_col]
            peak = max(table.peaks.get(table.columns[table.col(c) - table.first_col], 0) for c in ys)
            number_format = _scaled_format(table.kinds.get(first) or "number", peak)
        for i, col in enumerate(ys):
            yc = table.col(col)
            s = {
                "name": [sheet, table.header_row, yc],
                "categories": [sheet, r1, xc, r2, xc],
                "values": [sheet, r1, yc, r2, yc],
            }
            color = f"#{t.color(i)}"
            if pie:
                s["points"] = [{"fill": {"color": f"#{t.color(j)}"}, "border": {"color": "#FFFFFF", "width": 1.5}}
                               for j in range(n_points)]
                if labels:
                    s["data_labels"] = {"percentage": True, "category": False, "font": {**font, "color": "#FFFFFF",
                                                                                      "bold": True, "size": 10}}
            elif ctype in ("line", "scatter"):
                s["line"] = {"color": color, "width": 2.5}
                s["marker"] = {"type": "circle", "size": 6, "fill": {"color": color},
                               "border": {"color": "#FFFFFF"}}
                if ctype == "line":
                    s["smooth"] = False
            else:
                s["fill"] = {"color": color}
                s["border"] = {"none": True}
                if ctype in ("column", "bar"):
                    s["gap"] = 60
                    if subtype:
                        s["overlap"] = 100
            if labels and not pie:
                s["data_labels"] = {"value": True, "num_format": number_format,
                                    "font": {**font, "color": f"#{t.dark}"},
                                    **({"position": "outside_end"} if ctype in ("column", "bar") and not subtype else {})}
            chart.add_series(s)
        chart.set_title({"name": title, "name_font": {"name": t.font, "size": 12, "bold": True,
                                                      "color": f"#{t.dark}"}} if title else {"none": True})
        show_legend = legend if legend is not None else (len(ys) > 1 or pie)
        chart.set_legend({"position": "bottom", "font": font} if show_legend else {"none": True})
        chart.set_chartarea({"border": {"none": True}, "fill": {"color": "#FFFFFF"}})
        chart.set_plotarea({"border": {"none": True}})
        if pie:
            if ctype == "doughnut":
                chart.set_hole_size(55)
        else:
            cat_axis = {"num_font": font, "line": {"color": f"#{t.border}"}, "major_tick_mark": "none"}
            val_axis = {"num_font": font, "num_format": number_format, "line": {"none": True},
                        "major_gridlines": {"visible": True, "line": {"color": "#E6E9EE", "width": 0.75}}}
            if x_title:
                cat_axis["name"] = x_title
                cat_axis["name_font"] = {**font, "bold": False}
            if y_title:
                val_axis["name"] = y_title
                val_axis["name_font"] = {**font, "bold": False}
            if ctype == "bar":
                # In bar charts xlsxwriter's y_axis is the category axis.
                cat_axis.update(reverse=True, crossing="max")  # first category on top, values along the bottom
                if self.rtl:
                    val_axis["reverse"] = True  # bars grow from the right
                chart.set_y_axis(cat_axis)
                chart.set_x_axis(val_axis)
            else:
                if self.rtl:
                    cat_axis["reverse"] = True  # first category on the right, value axis moves right
                chart.set_x_axis(cat_axis)
                chart.set_y_axis(val_axis)
        w, h = size or ((480, 340) if pie else (max(560, min(980, 70 * n_points + 160)), 340))
        chart.set_size({"width": w, "height": h})

        if position == "right":
            row, col = table.header_row, table.last_col + 2
        elif position == "below":
            row, col = self.row, self.FIRST_COL
            self.row += int(h / 20) + 2
        else:
            m = re.match(r"([A-Za-z]+)(\d+)$", str(position))
            if not m:
                raise ValueError("position must be 'below', 'right' or a cell like 'H4'")
            from xlsxwriter.utility import xl_cell_to_rowcol
            row, col = xl_cell_to_rowcol(position)
        self.ws.insert_chart(row, col, chart, {"x_offset": 4, "y_offset": 6, "object_position": 1})
        return chart

    # -- free cells ----------------------------------------------------------
    def write(self, cell, value, kind=None, bold=False, color=None, bg=None, size=None):
        """Write a single value with theme styling, e.g. ws.write('B20', '=B5*2', 'currency')."""
        props = {"bold": bold}
        if color:
            props["font_color"] = color
        if bg:
            props["bg_color"] = bg
        if size:
            props["font_size"] = size
        nf = self.book.num_format(kind) if kind else None
        if nf:
            props["num_format"] = nf
        self.ws.write(cell, value, self.book.fmt(**props))
        return self

    def _finalize(self):
        b, t, ws = self.book, self.t, self.ws
        if self.rtl:
            ws.right_to_left()
        footer = "صفحة &P من &N" if self.rtl else "Page &P of &N"
        ws.set_footer(f'&C&"{t.font},Regular"&9{footer}')
        span = max(self.width, 6)
        for c, chars in self._col_chars.items():
            ws.set_column(c, c, chars)
        for c in range(self.FIRST_COL, self.FIRST_COL + span):
            if c not in self._col_chars:
                ws.set_column(c, c, 14)
        if self.landscape or (self.landscape is None and span > 6):
            ws.set_landscape()
        c1, c2 = self.FIRST_COL, self.FIRST_COL + span - 1
        styles = {
            "title": b.fmt(bold=True, font_size=20, font_color=t.primary, bottom=2, bottom_color=t.accent),
            "subtitle": b.fmt(font_size=11, font_color=t.muted),
            "section": b.fmt(bold=True, font_size=13, font_color=t.primary, bottom=1, bottom_color=t.border),
            "note": b.fmt(italic=True, font_size=9, font_color=t.muted, text_wrap=True, valign="top"),
        }
        for row, text, kind in self._full_rows:
            if kind == "note":
                total_width = sum(self._col_chars.get(c, 14) for c in range(c1, c2 + 1))
                lines = max(1, -(-_text_width(text) // max(int(total_width * 1.1), 1)) + text.count("\n"))
                ws.set_row(row, 15 * lines + 4)
            if c2 > c1:
                ws.merge_range(row, c1, row, c2, text, styles[kind])
            else:
                ws.write(row, c1, text, styles[kind])


# ------------------------------------------------------------------ helpers


def _safe_sheet_name(name, taken):
    clean = re.sub(r"[\[\]:*?/\\]", "-", str(name or "Sheet")).strip("'") or "Sheet"
    clean = clean[:31]
    base, n = clean, 2
    while clean.lower() in (t.lower() for t in taken):
        suffix = f" ({n})"
        clean = base[:31 - len(suffix)] + suffix
        n += 1
    return clean


def _safe_table_name(name, n):
    if name:
        clean = re.sub(r"[^A-Za-z0-9_]", "_", str(name))
        if clean and (clean[0].isalpha() or clean[0] == "_") and not re.match(r"^[A-Za-z]{1,3}\d+$", clean):
            return f"{clean}_{n}" if n > 1 else clean
    return f"Table{n}"


def _text_width(text) -> int:
    text = str(text or "")
    longest = max((len(line) for line in text.split("\n")), default=0)
    return int(longest * (1.15 if has_arabic(text) else 1.0)) + 1


def _normalize_totals(totals, cols, kinds):
    numeric = [c for c, k in zip(cols, kinds) if k in ("int", "number", "currency")]
    if not totals:
        return {}
    if totals is True:
        return {c: "sum" for c in numeric}
    if isinstance(totals, dict):
        bad = [f for f in totals.values() if f not in _SUBTOTAL]
        if bad:
            raise ValueError(f"totals functions must be one of {list(_SUBTOTAL)}")
        return dict(totals)
    return {c: "sum" for c in totals}


def _aggregate(func, values, count):
    if func == "count":
        return count
    if not values:
        return 0
    if func == "sum":
        return sum(values)
    if func in ("average", "avg"):
        return sum(values) / len(values)
    return max(values) if func == "max" else min(values)


def _scaled_format(kind, peak):
    """Short axis/label format: 1,250,000 -> 1.3M, 45,000 -> 45K."""
    if kind == "percent":
        return "0%"
    if peak >= 1e6:
        return '#,##0.0,,"M"'
    if peak >= 1e4:
        return '#,##0,"K"'
    return "#,##0" if kind == "int" or peak >= 100 else "#,##0.0"

