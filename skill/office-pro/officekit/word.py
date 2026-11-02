"""Professional Word documents: cover page, contents, themed headings and tables, KPI boxes,
callouts, charts, page numbers and full right-to-left (Arabic) support.

    from officekit.word import Document
    doc = Document(theme="emerald", title="التقرير السنوي 2026", org="شركة المثال")
    doc.cover(subtitle="ملخص الأداء والنتائج", meta={"إعداد": "إدارة التخطيط", "التاريخ": "نوفمبر 2026"})
    doc.toc()
    doc.heading("الملخص التنفيذي")
    doc.paragraph("حققت الشركة **نمواً بنسبة 12%** في الإيرادات ...")
    doc.table(df, caption="الإيرادات حسب المنطقة", totals=True)
    doc.save("/mnt/data/annual_report.docx")
"""

from __future__ import annotations

import os
import re
from datetime import date

from docx import Document as _new_document
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

from .theme import format_value, get_theme, guess_kind, has_arabic, kpi_item, normalize_table, split_scripts, tint

_RPR = ["rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike", "outline", "shadow",
        "emboss", "imprint", "noProof", "snapToGrid", "vanish", "webHidden", "color", "spacing", "w", "kern",
        "position", "sz", "szCs", "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs",
        "em", "lang", "eastAsianLayout", "specVanish", "oMath"]
_PPR = ["pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl", "numPr",
        "suppressLineNumbers", "pBdr", "shd", "tabs", "suppressAutoHyphens", "kinsoku", "wordWrap",
        "overflowPunct", "topLinePunct", "autoSpaceDE", "autoSpaceDN", "bidi", "adjustRightInd", "snapToGrid",
        "spacing", "ind", "contextualSpacing", "mirrorIndents", "suppressOverlap", "jc", "textDirection",
        "textAlignment", "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr", "sectPr", "pPrChange"]
_TBLPR = ["tblStyle", "tblpPr", "tblOverlap", "bidiVisual", "tblStyleRowBandSize", "tblStyleColBandSize", "tblW",
          "jc", "tblCellSpacing", "tblInd", "tblBorders", "shd", "tblLayout", "tblCellMar", "tblLook"]
_TCPR = ["cnfStyle", "tcW", "gridSpan", "hMerge", "vMerge", "tcBorders", "shd", "noWrap", "tcMar",
         "textDirection", "tcFitText", "vAlign", "hideMark"]
_TRPR = ["cnfStyle", "divId", "gridBefore", "gridAfter", "wBefore", "wAfter", "cantSplit", "trHeight",
         "tblHeader", "tblCellSpacing", "jc", "hidden"]
_SECTPR = ["headerReference", "footerReference", "footnotePr", "endnotePr", "type", "pgSz", "pgMar", "paperSrc",
           "pgBorders", "lnNumType", "pgNumType", "cols", "formProt", "vAlign", "noEndnote", "titlePg",
           "textDirection", "bidi", "rtlGutter", "docGrid", "printerSettings"]
_LATIN = re.compile(r"[A-Za-z]")
_INLINE = re.compile(r"(\*\*.+?\*\*|\*[^*\s][^*]*?\*)")
_CALLOUTS = {"info": "secondary", "note": "secondary", "success": "positive", "warning": "accent",
             "danger": "negative", "key": "primary"}


def _child(parent, tag, seq, **attrs):
    """Get or create w:<tag> under parent at its schema position, then set attributes."""
    el = parent.find(qn(f"w:{tag}"))
    if el is None:
        el = OxmlElement(f"w:{tag}")
        later = {qn(f"w:{t}") for t in seq[seq.index(tag) + 1:]}
        for existing in parent:
            if existing.tag in later:
                existing.addprevious(el)
                break
        else:
            parent.append(el)
    for k, v in attrs.items():
        el.set(qn(f"w:{k}"), str(v))
    return el


def _borders(parent, tag, seq, **sides):
    """sides: top=('single', 8, '1B365D') ... or top=None for no border."""
    box = _child(parent, tag, seq)
    for side, spec in sides.items():
        el = box.find(qn(f"w:{side}"))
        if el is None:
            el = OxmlElement(f"w:{side}")
            box.append(el)
        if spec is None:
            el.set(qn("w:val"), "nil")
            continue
        val, size, color = spec
        el.set(qn("w:val"), val)
        el.set(qn("w:sz"), str(size))
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), color)
    # keep schema order: top, left/start, bottom, right/end, insideH, insideV
    order = ["top", "left", "start", "bottom", "right", "end", "between", "bar", "insideH", "insideV", "tl2br",
             "tr2bl"]
    kids = sorted(box, key=lambda e: order.index(e.tag.split("}")[1]))
    for k in kids:
        box.remove(k)
        box.append(k)
    return box


def _fonts(rpr, latin, cs):
    rf = _child(rpr, "rFonts", _RPR)
    for attr in ("asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme"):
        rf.attrib.pop(qn(f"w:{attr}"), None)
    rf.set(qn("w:ascii"), latin)
    rf.set(qn("w:hAnsi"), latin)
    rf.set(qn("w:eastAsia"), latin)
    rf.set(qn("w:cs"), cs)


def _set_rpr(rpr, size=None, bold=None, italic=None, color=None, cs_boost=1):
    if size is not None:
        _child(rpr, "sz", _RPR, val=int(round(size * 2)))
        _child(rpr, "szCs", _RPR, val=int(round((size + cs_boost) * 2)))
    if bold is not None:
        _child(rpr, "b", _RPR, val="1" if bold else "0")
        _child(rpr, "bCs", _RPR, val="1" if bold else "0")
    if italic is not None:
        _child(rpr, "i", _RPR, val="1" if italic else "0")
        _child(rpr, "iCs", _RPR, val="1" if italic else "0")
    if color is not None:
        el = _child(rpr, "color", _RPR, val=color)
        for attr in ("themeColor", "themeShade", "themeTint"):
            el.attrib.pop(qn(f"w:{attr}"), None)


def _shade(parent, seq, fill):
    _child(parent, "shd", seq, val="clear", color="auto", fill=fill)


class Document:
    def __init__(self, theme="corporate", rtl=None, title=None, author=None, org=None, landscape=False,
                 font_size=11, header=None, page_numbers=True, margins_cm=2.2, **theme_overrides):
        self.t = get_theme(theme, **theme_overrides)
        self.title_text = title
        self.org = org
        self.author = author
        self.header_text = header if header is not None else title
        self.page_numbers = page_numbers
        self.base_size = font_size
        self._rtl = rtl if rtl is not None else (True if has_arabic(title, org, header) else None)
        self._tables = 0
        self._figures = 0
        self._has_cover = False
        self.doc = _new_document()
        sec = self.doc.sections[0]
        sec.page_width, sec.page_height = (Cm(29.7), Cm(21)) if landscape else (Cm(21), Cm(29.7))
        if landscape:
            sec.orientation = WD_ORIENT.LANDSCAPE
        for side in ("left_margin", "right_margin"):
            setattr(sec, side, Cm(margins_cm))
        sec.top_margin, sec.bottom_margin = Cm(2.2), Cm(2.0)
        sec.header_distance, sec.footer_distance = Cm(1.0), Cm(1.0)
        self._setup_styles()
        cp = self.doc.core_properties
        cp.title = title or ""
        cp.author = author or ""
        cp.comments = ""
        # Drop the template's empty first paragraph so content starts at the top.
        body = self.doc.element.body
        first = body.find(qn("w:p"))
        if first is not None and not "".join(first.itertext()).strip():
            body.remove(first)

    # -- direction -----------------------------------------------------------
    @property
    def rtl(self):
        return bool(self._rtl)

    def _dir(self, text):
        """Paragraph direction for a piece of text; the first text decides the document direction."""
        text = text or ""
        if self._rtl is None and text.strip():
            self._rtl = has_arabic(text)
        return has_arabic(text) or (self.rtl and not _LATIN.search(text))

    @property
    def text_width_cm(self):
        sec = self.doc.sections[0]
        return (sec.page_width - sec.left_margin - sec.right_margin) / 360000

    # -- styles ----------------------------------------------------------------
    def _setup_styles(self):
        t, styles = self.t, self.doc.styles
        defaults = styles.element.find(qn("w:docDefaults"))
        rpr_default = defaults.find(qn("w:rPrDefault")).find(qn("w:rPr"))
        _fonts(rpr_default, t.font, t.font_ar)
        _child(rpr_default, "lang", _RPR, val="en-US", bidi="ar-SA", eastAsia="en-US")

        normal = styles["Normal"]
        rpr = normal.element.get_or_add_rPr()
        _fonts(rpr, t.font, t.font_ar)
        _set_rpr(rpr, size=self.base_size, color=t.dark)
        pf = normal.paragraph_format
        pf.space_after = Pt(6)
        pf.line_spacing = 1.2

        spec = {
            "Title": (28, True, t.primary, 0, 8),
            "Subtitle": (15, False, t.secondary, 0, 12),
            "Heading 1": (17, True, t.primary, 18, 8),
            "Heading 2": (13.5, True, t.secondary, 14, 6),
            "Heading 3": (12, True, t.dark, 10, 4),
        }
        for name, (size, bold, color, before, after) in spec.items():
            st = styles[name]
            rpr = st.element.get_or_add_rPr()
            for tag in ("i", "iCs", "spacing", "kern", "u"):
                el = rpr.find(qn(f"w:{tag}"))
                if el is not None:
                    rpr.remove(el)
            _fonts(rpr, t.font, t.font_ar)
            _set_rpr(rpr, size=size, bold=bold, color=color)
            ppr = st.element.get_or_add_pPr()
            for tag in ("pBdr",):
                el = ppr.find(qn(f"w:{tag}"))
                if el is not None:
                    ppr.remove(el)
            st.paragraph_format.space_before = Pt(before)
            st.paragraph_format.space_after = Pt(after)
            st.paragraph_format.keep_with_next = True
            st.paragraph_format.line_spacing = 1.1
            if name == "Heading 1":
                _borders(ppr, "pBdr", _PPR, bottom=("single", 6, t.border))
        for name in ("List Bullet", "List Number", "List Bullet 2", "List Number 2"):
            try:
                styles[name].paragraph_format.space_after = Pt(3)
            except KeyError:
                pass
        cap = styles["Caption"] if "Caption" in [s.name for s in styles] else None
        if cap is not None:
            rpr = cap.element.get_or_add_rPr()
            _fonts(rpr, t.font, t.font_ar)
            _set_rpr(rpr, size=9, bold=False, italic=False, color=t.muted)

    # -- low-level text --------------------------------------------------------
    def _para(self, text="", style=None, align=None, container=None, keep_next=False, space_after=None,
              space_before=None, rtl=None):
        container = container if container is not None else self.doc
        p = container.add_paragraph(style=style) if style else container.add_paragraph()
        is_rtl = self._dir(text) if rtl is None else rtl
        ppr = p._p.get_or_add_pPr()
        if is_rtl:
            _child(ppr, "bidi", _PPR)
        if align == "center":
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        elif align == "justify":
            p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        elif align == "end":
            # Word reads left/right as start/end inside right-to-left paragraphs.
            p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        if keep_next:
            p.paragraph_format.keep_with_next = True
        if space_after is not None:
            p.paragraph_format.space_after = Pt(space_after)
        if space_before is not None:
            p.paragraph_format.space_before = Pt(space_before)
        return p

    def _run(self, p, text, size=None, bold=None, italic=None, color=None):
        r = None
        for segment, _latin in split_scripts(text):
            r = p.add_run(segment)
            rpr = r._r.get_or_add_rPr()
            _set_rpr(rpr, size=size, bold=bold, italic=italic, color=color)
            if has_arabic(segment):
                _child(rpr, "rtl", _RPR)
        return r

    def _rich(self, p, text, size=None, color=None, bold=None):
        """Add text with **bold** and *italic* markup."""
        for part in _INLINE.split(text):
            if not part:
                continue
            if part.startswith("**") and part.endswith("**") and len(part) > 4:
                self._run(p, part[2:-2], size=size, bold=True, color=color)
            elif part.startswith("*") and part.endswith("*") and len(part) > 2:
                self._run(p, part[1:-1], size=size, italic=True, color=color, bold=bold)
            else:
                self._run(p, part, size=size, color=color, bold=bold)

    # -- content -----------------------------------------------------------------
    def cover(self, title=None, subtitle=None, meta=None, org=None, note=None):
        """Cover page: colored title band, subtitle, and a details block (dict or list of pairs)."""
        t = self.t
        title = title or self.title_text or ""
        org = org or self.org
        if self.title_text is None:
            self.title_text = title
            if self.header_text is None:
                self.header_text = title
        self._dir(title)
        band = self.doc.add_table(rows=1, cols=1)
        self._table_frame(band, widths_cm=[self.text_width_cm])
        cell = band.rows[0].cells[0]
        tcpr = cell._tc.get_or_add_tcPr()
        _shade(tcpr, _TCPR, t.primary)
        _borders(tcpr, "tcBorders", _TCPR, bottom=("single", 36, t.accent))
        _child(tcpr, "vAlign", _TCPR, val="bottom")
        _child(tcpr, "tcMar", _TCPR)
        mar = tcpr.find(qn("w:tcMar"))
        for side in ("top", "start", "bottom", "end", "left", "right"):
            el = OxmlElement(f"w:{side}")
            el.set(qn("w:w"), "500" if side in ("top", "bottom") else "480")
            el.set(qn("w:type"), "dxa")
            mar.append(el)
        trpr = band.rows[0]._tr.get_or_add_trPr()
        _child(trpr, "trHeight", _TRPR, val=str(int(Cm(8.5).twips)), hRule="atLeast")
        p = cell.paragraphs[0]
        if self._dir(title):
            _child(p._p.get_or_add_pPr(), "bidi", _PPR)
        if org:
            self._run(p, org, size=12, bold=True, color=tint(t.primary, 0.65))
            p.paragraph_format.space_after = Pt(18)
            p = self._para(title, container=cell)
        self._run(p, title, size=30, bold=True, color="FFFFFF")
        p.paragraph_format.space_after = Pt(6)
        p.paragraph_format.line_spacing = 1.05
        if subtitle:
            p = self._para(subtitle, container=cell)
            self._run(p, subtitle, size=15, color=tint(t.primary, 0.75))
        if meta:
            self._para("", space_after=60)
            pairs = list(meta.items()) if isinstance(meta, dict) else list(meta)
            mt = self.doc.add_table(rows=len(pairs), cols=2)
            w = self.text_width_cm
            self._table_frame(mt, widths_cm=[w * 0.28, w * 0.72])
            for i, (k, v) in enumerate(pairs):
                c1, c2 = mt.rows[i].cells
                for c, text, opts in ((c1, str(k), dict(size=10, bold=True, color=t.muted)),
                                      (c2, str(v), dict(size=11, color=t.dark))):
                    para = c.paragraphs[0]
                    if self._dir(text):
                        _child(para._p.get_or_add_pPr(), "bidi", _PPR)
                    para.paragraph_format.space_after = Pt(4)
                    self._run(para, text, **opts)
                tcpr = c2._tc.get_or_add_tcPr()
                _borders(tcpr, "tcBorders", _TCPR, bottom=("single", 4, t.border))
        if note:
            p = self._para(note, space_before=30)
            self._run(p, note, size=9, italic=True, color=t.muted)
        self.page_break()
        self._has_cover = True
        return self

    def toc(self, title=None, levels=3):
        """Table of contents (Word fills it in when the file is opened)."""
        title = title or ("المحتويات" if self.rtl else "Contents")
        p = self._para(title, space_after=12)
        self._run(p, title, size=17, bold=True, color=self.t.primary)
        p = self._para("", rtl=self.rtl)
        self._field(p, f'TOC \\o "1-{levels}" \\h \\z \\u',
                    "انقر بزر الماوس الأيمن واختر «تحديث الحقل» لعرض المحتويات." if self.rtl
                    else "Right-click and choose Update Field to build the table of contents.")
        settings = self.doc.settings.element
        if settings.find(qn("w:updateFields")) is None:
            uf = OxmlElement("w:updateFields")
            uf.set(qn("w:val"), "true")
            settings.append(uf)
        self.page_break()
        return self

    def heading(self, text, level=1):
        p = self._para(text, style=f"Heading {max(1, min(level, 3))}")
        self._rich(p, text)
        return p

    def paragraph(self, text, size=None, color=None, bold=None, align=None, space_after=None):
        """Body paragraph. Supports **bold** and *italic*. align: None|'center'|'justify'|'end'."""
        if align is None and self._dir(text) and len(text) > 90:
            align = "justify"
        p = self._para(text, align=align, space_after=space_after)
        self._rich(p, text, size=size, color=color, bold=bold)
        return p

    def bullets(self, items, numbered=False):
        """Bulleted (or numbered) list. An item may be (text, [sub items])."""
        style = "List Number" if numbered else "List Bullet"
        num_id = self._restart_numbering(style) if numbered else None
        for item in items:
            text, children = (item if isinstance(item, (tuple, list)) else (item, None))
            p = self._para(str(text), style=style)
            if num_id:
                numpr = _child(p._p.get_or_add_pPr(), "numPr", _PPR)
                _child(numpr, "ilvl", ["ilvl", "numId"], val="0")
                _child(numpr, "numId", ["ilvl", "numId"], val=str(num_id))
            self._rich(p, str(text))
            for child in children or []:
                cp = self._para(str(child), style=f"{style} 2")
                self._rich(cp, str(child))
        return self

    def numbered(self, items):
        return self.bullets(items, numbered=True)

    def _restart_numbering(self, style_name):
        """New numbering instance so each numbered list starts at 1."""
        try:
            st = self.doc.styles[style_name]
            num_pr = st.element.pPr.find(qn("w:numPr"))
            base_id = num_pr.find(qn("w:numId")).get(qn("w:val"))
            numbering = self.doc.part.numbering_part.element
            base = next(n for n in numbering.findall(qn("w:num")) if n.get(qn("w:numId")) == base_id)
            abstract = base.find(qn("w:abstractNumId")).get(qn("w:val"))
        except Exception:
            return None
        new_id = max(int(n.get(qn("w:numId"))) for n in numbering.findall(qn("w:num"))) + 1
        num = OxmlElement("w:num")
        num.set(qn("w:numId"), str(new_id))
        a = OxmlElement("w:abstractNumId")
        a.set(qn("w:val"), abstract)
        num.append(a)
        override = OxmlElement("w:lvlOverride")
        override.set(qn("w:ilvl"), "0")
        start = OxmlElement("w:startOverride")
        start.set(qn("w:val"), "1")
        override.append(start)
        num.append(override)
        numbering.append(num)
        return new_id

    def table(self, data, columns=None, formats=None, widths=None, totals=None, caption=None, zebra=True,
              font_size=None, currency=None, decimals=None, align=None):
        """Themed table. data: DataFrame | list of dicts | list of rows (+columns).
        formats: {col: 'text'|'int'|'number'|'currency'|'percent'|'date'}; totals: True | [cols];
        widths: relative weights per column, e.g. [3, 1, 1]; align: {col: 'center'|'start'}."""
        t = self.t
        cols, rows = normalize_table(data, columns)
        formats = formats or {}
        kinds = [formats.get(c) or guess_kind([r[i] for r in rows], c) for i, c in enumerate(cols)]
        size = font_size or (self.base_size - 1.5 if len(cols) > 4 else self.base_size - 1)
        decs = []
        for i, k in enumerate(kinds):
            nums = [r[i] for r in rows if isinstance(r[i], (int, float)) and not isinstance(r[i], bool)]
            whole = bool(nums) and all(float(v).is_integer() for v in nums)
            decs.append(decimals if decimals is not None else (0 if whole and k in ("number", "currency") else None))
        text_rows = [[format_value(v, kinds[i], currency, decs[i]) for i, v in enumerate(r)] for r in rows]
        if totals:
            sums = {c for c in (totals if isinstance(totals, (list, tuple, set)) else cols)}
            total_row = []
            for i, c in enumerate(cols):
                vals = [r[i] for r in rows if isinstance(r[i], (int, float)) and not isinstance(r[i], bool)]
                if i == 0:
                    total_row.append("الإجمالي" if self.rtl else "Total")
                elif c in sums and kinds[i] in ("int", "number", "currency") and vals:
                    total_row.append(format_value(sum(vals), kinds[i], currency, decs[i]))
                else:
                    total_row.append("")
        self._dir(" ".join(map(str, cols)))
        if caption:
            self._caption(caption, "table")
        tbl = self.doc.add_table(rows=1 + len(text_rows) + (1 if totals else 0), cols=len(cols))
        if widths is None:
            weights = []
            for i, c in enumerate(cols):
                longest = max([len(str(c)) * 0.9] + [len(r[i]) for r in text_rows[:200]])
                weights.append(min(max(longest, 4), 45))
        else:
            weights = list(widths)
        total_w = sum(weights)
        width_cm = [self.text_width_cm * w / total_w for w in weights]
        self._table_frame(tbl, widths_cm=width_cm, borders=True)
        numeric = {i for i, k in enumerate(kinds) if k in ("int", "number", "currency", "percent", "date")}

        def fill(row, values, header=False, total=False, shade=None):
            for i, (cell, text) in enumerate(zip(row.cells, values)):
                p = cell.paragraphs[0]
                p.paragraph_format.space_after = Pt(0)
                p.paragraph_format.line_spacing = 1.0
                if self._dir(text) or (self.rtl and not text):
                    _child(p._p.get_or_add_pPr(), "bidi", _PPR)
                how = (align or {}).get(cols[i]) if align else None
                if header or how == "center" or (how is None and i in numeric):
                    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                tcpr = cell._tc.get_or_add_tcPr()
                _child(tcpr, "vAlign", _TCPR, val="center")
                if header:
                    _shade(tcpr, _TCPR, t.primary)
                    self._run(p, text, size=size, bold=True, color="FFFFFF")
                elif total:
                    _shade(tcpr, _TCPR, tint(t.primary, 0.85))
                    _borders(tcpr, "tcBorders", _TCPR, top=("single", 12, t.primary))
                    self._run(p, text, size=size, bold=True, color=t.dark)
                else:
                    if shade:
                        _shade(tcpr, _TCPR, shade)
                    self._run(p, text, size=size, color=t.dark)

        header = tbl.rows[0]
        fill(header, [str(c) for c in cols], header=True)
        hpr = header._tr.get_or_add_trPr()
        _child(hpr, "tblHeader", _TRPR)
        _child(hpr, "cantSplit", _TRPR)
        for n, values in enumerate(text_rows):
            row = tbl.rows[n + 1]
            _child(row._tr.get_or_add_trPr(), "cantSplit", _TRPR)
            fill(row, values, shade=t.light if zebra and n % 2 == 1 else None)
        if totals:
            fill(tbl.rows[-1], total_row, total=True)
        self._para("", space_after=4, rtl=self.rtl)
        return tbl

    def _table_frame(self, tbl, widths_cm, borders=False):
        t = self.t
        tblpr = tbl._tbl.tblPr
        if self.rtl:
            _child(tblpr, "bidiVisual", _TBLPR)
        _child(tblpr, "tblW", _TBLPR, w="5000", type="pct")
        _child(tblpr, "tblLayout", _TBLPR, type="fixed")
        tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
        style = tblpr.find(qn("w:tblStyle"))
        if style is not None:
            tblpr.remove(style)
        if borders:
            _borders(tblpr, "tblBorders", _TBLPR, top=("single", 10, t.primary), left=None,
                     bottom=("single", 10, t.primary), right=None, insideH=("single", 4, t.border), insideV=None)
        else:
            _borders(tblpr, "tblBorders", _TBLPR, top=None, left=None, bottom=None, right=None, insideH=None,
                     insideV=None)
        mar = _child(tblpr, "tblCellMar", _TBLPR)
        for side, w in (("top", 70), ("left", 110), ("bottom", 70), ("right", 110)):
            el = OxmlElement(f"w:{side}")
            el.set(qn("w:w"), str(w))
            el.set(qn("w:type"), "dxa")
            mar.append(el)
        grid = tbl._tbl.tblGrid
        for gc, w in zip(grid.findall(qn("w:gridCol")), widths_cm):
            gc.set(qn("w:w"), str(int(Cm(w).twips)))
        for row in tbl.rows:
            for cell, w in zip(row.cells, widths_cm):
                cell.width = Cm(w)

    def kpis(self, items, currency=None):
        """Row of KPI boxes. Item: (label, value[, kind[, delta]]) or dict(label, value, kind, delta)."""
        t = self.t
        items = [kpi_item(i) for i in items]
        tbl = self.doc.add_table(rows=1, cols=len(items))
        w = self.text_width_cm / len(items)
        self._table_frame(tbl, widths_cm=[w] * len(items))
        self._dir(" ".join(str(i.get("label", "")) for i in items))
        for i, (cell, it) in enumerate(zip(tbl.rows[0].cells, items)):
            tcpr = cell._tc.get_or_add_tcPr()
            _shade(tcpr, _TCPR, t.light)
            _borders(tcpr, "tcBorders", _TCPR, top=("single", 24, t.color(i)), left=("single", 24, "FFFFFF"),
                     right=("single", 24, "FFFFFF"), bottom=None)
            value = it.get("value")
            kind = it.get("kind") or ("int" if isinstance(value, int) else "number")
            shown = value if isinstance(value, str) else format_value(
                value, kind, currency, 0 if kind in ("number", "currency") and abs(value) >= 1000 else None)
            # Shrink the value until it fits on one line of the box.
            fit = (w - 0.5) * 28.35 / max(len(shown) * (0.62 if has_arabic(shown) else 0.58), 1)
            vsize = max(10, min(19, round(fit * 2) / 2))
            for text, opts, after in ((str(it.get("label", "")), dict(size=9, bold=True, color=t.muted), 2),
                                      (shown, dict(size=vsize, bold=True, color=t.primary), 2)):
                p = cell.paragraphs[0] if not cell.paragraphs[0].runs else cell.add_paragraph()
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                p.paragraph_format.space_after = Pt(after)
                p.paragraph_format.space_before = Pt(6 if p is cell.paragraphs[0] else 0)
                if self._dir(text):
                    _child(p._p.get_or_add_pPr(), "bidi", _PPR)
                self._run(p, text, **opts)
            delta = it.get("delta")
            p = cell.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.space_after = Pt(6)
            if delta is not None:
                good = delta >= 0 if not it.get("lower_is_better") else delta <= 0
                self._run(p, f"{'▲' if delta >= 0 else '▼'} {abs(delta) * 100:.1f}%", size=9,
                          color=t.positive if good else t.negative)
            elif it.get("note"):
                self._run(p, str(it["note"]), size=9, color=t.muted)
        self._para("", space_after=6, rtl=self.rtl)
        return tbl

    def callout(self, text, title=None, kind="info"):
        """Shaded box for key messages. kind: info | success | warning | danger | key."""
        t = self.t
        color = getattr(t, _CALLOUTS.get(kind, "secondary"))
        tbl = self.doc.add_table(rows=1, cols=1)
        self._table_frame(tbl, widths_cm=[self.text_width_cm])
        cell = tbl.rows[0].cells[0]
        tcpr = cell._tc.get_or_add_tcPr()
        _shade(tcpr, _TCPR, tint(color, 0.88))
        # "left" is the start side: right-to-left tables (bidiVisual) mirror it.
        _borders(tcpr, "tcBorders", _TCPR, left=("single", 36, color))
        p = cell.paragraphs[0]
        if title:
            if self._dir(title):
                _child(p._p.get_or_add_pPr(), "bidi", _PPR)
            p.paragraph_format.space_before = Pt(4)
            p.paragraph_format.space_after = Pt(2)
            self._run(p, title, size=self.base_size, bold=True, color=color)
            p = cell.add_paragraph()
        if self._dir(text):
            _child(p._p.get_or_add_pPr(), "bidi", _PPR)
        p.paragraph_format.space_after = Pt(4)
        p.paragraph_format.space_before = Pt(0 if title else 4)
        self._rich(p, text, size=self.base_size - 0.5)
        self._para("", space_after=4, rtl=self.rtl)
        return tbl

    def quote(self, text, source=None):
        p = self._para(text, align="center", space_before=6, space_after=2)
        self._run(p, f"«{text}»" if self._dir(text) else f"“{text}”", size=self.base_size + 2, italic=True,
                  color=self.t.secondary)
        if source:
            p = self._para(source, align="center", space_after=10)
            self._run(p, f"— {source}", size=self.base_size - 1, color=self.t.muted)
        return self

    def image(self, path, width_cm=None, caption=None):
        width_cm = min(width_cm or self.text_width_cm, self.text_width_cm)
        p = self._para("", align="center", rtl=self.rtl, space_after=2, keep_next=bool(caption))
        p.add_run().add_picture(path, width=Cm(width_cm))
        if caption:
            self._caption(caption, "figure")
        return self

    def chart(self, kind, categories, series, title=None, caption=None, width_cm=None, height_cm=None,
              number_format=None):
        """Chart image built from data. series: {"name": [values...]}. kind: column | bar | line | area |
        pie | doughnut | stacked_column | stacked_bar."""
        from .charts import chart_png

        width_cm = min(width_cm or self.text_width_cm, self.text_width_cm)
        height_cm = height_cm or width_cm * (0.62 if kind in ("pie", "doughnut") else 0.52)
        path = chart_png(kind, categories, series, title=title, theme=self.t, rtl=self.rtl or None,
                         number_format=number_format, width_in=width_cm / 2.54, height_in=height_cm / 2.54)
        return self.image(path, width_cm=width_cm, caption=caption)

    def fields(self, pairs, label_width=0.25):
        """Label/value lines without borders (letter headers: date, ref no., subject ...)."""
        pairs = list(pairs.items()) if isinstance(pairs, dict) else list(pairs)
        tbl = self.doc.add_table(rows=len(pairs), cols=2)
        w = self.text_width_cm
        self._table_frame(tbl, widths_cm=[w * label_width, w * (1 - label_width)])
        for i, (k, v) in enumerate(pairs):
            for cell, text, bold in ((tbl.rows[i].cells[0], str(k), True), (tbl.rows[i].cells[1], str(v), False)):
                p = cell.paragraphs[0]
                p.paragraph_format.space_after = Pt(2)
                if self._dir(text):
                    _child(p._p.get_or_add_pPr(), "bidi", _PPR)
                self._run(p, text, bold=bold, color=self.t.muted if bold else self.t.dark)
        self._para("", space_after=6, rtl=self.rtl)
        return tbl

    def signature(self, name, role=None, label=None):
        """Signature block aligned to the end of the line."""
        lines = [x for x in (label, name, role) if x]
        for i, text in enumerate(lines):
            p = self._para(text, align="end", space_after=2, space_before=24 if i == 0 else 0)
            self._run(p, text, bold=(text == name), color=self.t.dark if text == name else self.t.muted)
        return self

    def spacer(self, pt=12):
        self._para("", space_after=pt, rtl=self.rtl)
        return self

    def page_break(self):
        p = self._para("", rtl=self.rtl, space_after=0)
        p.add_run().add_break(WD_BREAK.PAGE)
        return self

    def _caption(self, text, what):
        if what == "table":
            self._tables += 1
            label = f"جدول {self._tables}: " if self.rtl else f"Table {self._tables}: "
        else:
            self._figures += 1
            label = f"شكل {self._figures}: " if self.rtl else f"Figure {self._figures}: "
        p = self._para(label + text, align="center", space_after=4, space_before=6 if what == "table" else 0,
                       keep_next=what == "table")
        self._run(p, label, size=9, bold=True, color=self.t.secondary)
        self._run(p, text, size=9, color=self.t.muted)
        return p

    def _field(self, p, instr, placeholder="", size=None):
        def fld(kind):
            r = OxmlElement("w:r")
            el = OxmlElement("w:fldChar")
            el.set(qn("w:fldCharType"), kind)
            r.append(el)
            return r

        p._p.append(fld("begin"))
        r = OxmlElement("w:r")
        it = OxmlElement("w:instrText")
        it.set(qn("xml:space"), "preserve")
        it.text = f" {instr} "
        r.append(it)
        p._p.append(r)
        p._p.append(fld("separate"))
        run = self._run(p, placeholder or "1", size=size, color=self.t.muted)
        p._p.append(fld("end"))
        return run

    # -- output -----------------------------------------------------------------
    def _finish_section(self):
        t = self.t
        sec = self.doc.sections[0]
        sectpr = sec._sectPr
        if self.rtl:
            _child(sectpr, "bidi", _SECTPR)
        if self._has_cover:
            sec.different_first_page_header_footer = True
        if self.header_text:
            hp = sec.header.paragraphs[0]
            if self._dir(self.header_text):
                _child(hp._p.get_or_add_pPr(), "bidi", _PPR)
            _borders(hp._p.get_or_add_pPr(), "pBdr", _PPR, bottom=("single", 4, t.border))
            label = f"{self.org}  |  {self.header_text}" if self.org and self.org != self.header_text else self.header_text
            self._run(hp, label, size=8.5, color=t.muted)
        if self.page_numbers:
            fp = sec.footer.paragraphs[0]
            fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
            if self.rtl:
                _child(fp._p.get_or_add_pPr(), "bidi", _PPR)
            word, of = ("صفحة ", " من ") if self.rtl else ("Page ", " of ")
            self._run(fp, word, size=8.5, color=t.muted)
            self._field(fp, "PAGE", size=8.5)
            self._run(fp, of, size=8.5, color=t.muted)
            self._field(fp, "NUMPAGES", size=8.5)

    def save(self, path):
        if not path.lower().endswith(".docx"):
            path += ".docx"
        folder = os.path.dirname(path)
        if folder:
            os.makedirs(folder, exist_ok=True)
        self._finish_section()
        self.doc.save(path)
        return path
