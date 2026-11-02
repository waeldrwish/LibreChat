"""Professional PowerPoint decks (16:9): designed slide layouts, native charts and tables,
automatic text sizing and mirrored right-to-left layouts for Arabic.

    from officekit.slides import Deck
    deck = Deck(theme="royal", title="خطة التحول الرقمي 2027")
    deck.title_slide("خطة التحول الرقمي", "الرؤية والمبادرات والميزانية", meta="إدارة التقنية — نوفمبر 2026")
    deck.agenda(["الوضع الحالي", "المبادرات", "الميزانية", "الخطوات التالية"])
    deck.kpis("أرقام رئيسية", [("12", "مبادرة"), ("45M", "ميزانية (ر.س)"), ("18", "شهراً")])
    deck.chart("الميزانية حسب المبادرة", ["البنية", "البيانات", "الأمن"], {"الميزانية": [20, 15, 10]})
    deck.closing()
    deck.save("/mnt/data/digital_plan.pptx")
"""

from __future__ import annotations

import math
import os

from lxml import etree
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LABEL_POSITION, XL_LEGEND_POSITION, XL_TICK_MARK
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Inches, Pt

from .theme import (compact_number, format_value, get_theme, guess_kind, has_arabic, kpi_item, normalize_table,
                    split_scripts, tint)

W, H = 13.333, 7.5
M = 0.6  # side margin (in)
_A = "http://schemas.openxmlformats.org/drawingml/2006/main"
_CHART_TYPES = {
    "column": XL_CHART_TYPE.COLUMN_CLUSTERED, "stacked_column": XL_CHART_TYPE.COLUMN_STACKED,
    "percent_column": XL_CHART_TYPE.COLUMN_STACKED_100, "bar": XL_CHART_TYPE.BAR_CLUSTERED,
    "stacked_bar": XL_CHART_TYPE.BAR_STACKED, "line": XL_CHART_TYPE.LINE_MARKERS, "area": XL_CHART_TYPE.AREA,
    "stacked_area": XL_CHART_TYPE.AREA_STACKED, "pie": XL_CHART_TYPE.PIE, "doughnut": XL_CHART_TYPE.DOUGHNUT,
    "scatter": XL_CHART_TYPE.XY_SCATTER,
}
_NO_STYLE_TABLE = "{2D5ABB26-0587-4C30-8999-92F81FD0307C}"


def _rgb(h):
    return RGBColor.from_string(h.lstrip("#").upper())


def _em(text, bold=False):
    """Approximate rendered width of text in em units (Segoe UI-like proportions)."""
    w = 0.0
    for ch in text:
        if ch == " ":
            w += 0.28
        elif ch.isdigit():
            w += 0.57
        elif "A" <= ch <= "Z" or ch in "%$€£":
            w += 0.66
        elif ch in ".,:;'|!ilj()-":
            w += 0.3
        elif has_arabic(ch):
            w += 0.5
        else:
            w += 0.53
    return w * (1.07 if bold else 1)


def _est_lines(text, size, width_pt, bold=False):
    """Lines needed after greedy word wrapping."""
    lines = 0
    for seg in str(text).split("\n"):
        n, cur = 1, 0.0
        for word in seg.split(" "):
            w = _em(word, bold) * size
            gap = 0.28 * size if cur else 0
            if cur and cur + gap + w > width_pt:
                n += 1
                cur = w
            else:
                cur += gap + w
            while cur > width_pt:
                n += 1
                cur -= width_pt
        lines += n
    return lines


def _fit_size(paras, width_in, height_in, max_size, min_size, spacing=1.18):
    """Largest font size (pt) at which paragraphs [(text, scale, bold, space_after_pt)] fit the box."""
    width_pt, height_pt = (width_in - 0.2) * 72 * 0.94, (height_in - 0.1) * 72
    size = max_size
    while size > min_size:
        total = sum(_est_lines(t, size * sc, width_pt, b) * size * sc * spacing + sa for t, sc, b, sa in paras)
        if total <= height_pt:
            return size
        size -= 1
    return min_size


class Deck:
    def __init__(self, theme="corporate", rtl=None, title=None, author=None, footer=None, slide_numbers=True,
                 **theme_overrides):
        self.t = get_theme(theme, **theme_overrides)
        self.title_text = title
        self.footer_text = footer if footer is not None else (title or "")
        self.slide_numbers = slide_numbers
        self._rtl = rtl if rtl is not None else (True if has_arabic(title, footer) else None)
        self.prs = Presentation()
        self.prs.slide_width, self.prs.slide_height = Inches(W), Inches(H)
        self._blank = self.prs.slide_layouts[6]
        self._apply_theme()
        cp = self.prs.core_properties
        cp.title = title or ""
        cp.author = author or ""

    # -- direction & geometry ------------------------------------------------
    @property
    def rtl(self):
        return bool(self._rtl)

    def _decide(self, *texts):
        if self._rtl is None:
            joined = " ".join(str(x) for x in texts if x)
            if joined.strip():
                self._rtl = has_arabic(joined)

    def _x(self, x, w):
        """Mirror an LTR x position for right-to-left decks."""
        return W - x - w if self.rtl else x

    @property
    def _start(self):
        return PP_ALIGN.RIGHT if self.rtl else PP_ALIGN.LEFT

    @property
    def _end(self):
        return PP_ALIGN.LEFT if self.rtl else PP_ALIGN.RIGHT

    # -- theme part: fonts and colors used by charts, tables and defaults ------
    def _apply_theme(self):
        t = self.t
        part = self.prs.slide_master.part.part_related_by(
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme")
        root = etree.fromstring(part.blob)
        ns = {"a": _A}
        for font_tag in ("majorFont", "minorFont"):
            node = root.find(f".//a:fontScheme/a:{font_tag}", ns)
            node.find("a:latin", ns).set("typeface", t.font)
            cs = node.find("a:cs", ns)
            if cs is not None:
                cs.set("typeface", t.font_ar)
            for f in node.findall("a:font", ns):
                if f.get("script") == "Arab":
                    f.set("typeface", t.font_ar)
        scheme = root.find(".//a:clrScheme", ns)
        mapping = {"dk2": t.primary, "lt2": t.light, "accent1": t.color(0), "accent2": t.color(1),
                   "accent3": t.color(2), "accent4": t.color(3), "accent5": t.color(4), "accent6": t.color(5)}
        for tag, val in mapping.items():
            node = scheme.find(f"a:{tag}", ns)
            for child in list(node):
                node.remove(child)
            clr = etree.SubElement(node, f"{{{_A}}}srgbClr")
            clr.set("val", val)
        part._blob = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)

    # -- primitives -----------------------------------------------------------
    def _slide(self, bg=None):
        s = self.prs.slides.add_slide(self._blank)
        if bg:
            s.background.fill.solid()
            s.background.fill.fore_color.rgb = _rgb(bg)
        return s

    def _shape(self, slide, x, y, w, h, fill=None, line=None, kind=MSO_SHAPE.RECTANGLE, alpha=None,
               line_w=1.0, mirror=True):
        left = self._x(x, w) if mirror else x
        shp = slide.shapes.add_shape(kind, Inches(left), Inches(y), Inches(w), Inches(h))
        style = shp._element.find(qn("p:style"))
        if style is not None:
            shp._element.remove(style)
        if fill:
            shp.fill.solid()
            shp.fill.fore_color.rgb = _rgb(fill)
            if alpha is not None:
                clr = shp.fill._xPr.find(qn("a:solidFill")).find(qn("a:srgbClr"))
                a = etree.SubElement(clr, qn("a:alpha"))
                a.set("val", str(int(alpha * 100000)))
        else:
            shp.fill.background()
        if line:
            shp.line.color.rgb = _rgb(line)
            shp.line.width = Pt(line_w)
        else:
            shp.line.fill.background()
        if kind == MSO_SHAPE.ROUNDED_RECTANGLE:
            shp.adjustments[0] = 0.08
        return shp

    def _text(self, slide, x, y, w, h, paras, size=18, color=None, bold=False, align=None,
              anchor=MSO_ANCHOR.TOP, min_size=10, fit=True, mirror=True, spacing=1.12, italic=False, inset=0.05):
        """paras: str or list of str / dict(text, scale, bold, color, bullet, level, space_after, align)."""
        if isinstance(paras, (str, int, float, dict)):
            paras = [paras if isinstance(paras, dict) else str(paras)]
        items = [p if isinstance(p, dict) else {"text": str(p)} for p in paras]
        self._decide(*(i["text"] for i in items))
        if fit:
            spec = [(i["text"], i.get("scale", 1.0), i.get("bold", bold), i.get("space_after", 0)) for i in items]
            size = _fit_size(spec, w - (0.35 if any(i.get("bullet") for i in items) else 0), h, size, min_size,
                             spacing + 0.06)
        left = self._x(x, w) if mirror else x
        box = slide.shapes.add_textbox(Inches(left), Inches(y), Inches(w), Inches(h))
        tf = box.text_frame
        tf.word_wrap = True
        tf.vertical_anchor = anchor
        for side in ("margin_left", "margin_right"):
            setattr(tf, side, Inches(inset))
        tf.margin_top = tf.margin_bottom = Inches(0.03)
        bodypr = tf._txBody.find(qn("a:bodyPr"))
        for child in list(bodypr):
            bodypr.remove(child)
        etree.SubElement(bodypr, qn("a:noAutofit"))
        for n, item in enumerate(items):
            p = tf.paragraphs[0] if n == 0 else tf.add_paragraph()
            text = item["text"]
            p_rtl = has_arabic(text) or (self.rtl and not any(c.isalpha() and c.isascii() for c in text))
            p.alignment = item.get("align") or align or (PP_ALIGN.RIGHT if p_rtl else PP_ALIGN.LEFT)
            p.line_spacing = spacing
            sa = item.get("space_after")
            if sa:
                p.space_after = Pt(sa)
            ppr = p._p.get_or_add_pPr()
            if p_rtl:
                ppr.set("rtl", "1")
            level = item.get("level", 0)
            if item.get("bullet"):
                indent = 0.32 + 0.3 * level
                ppr.set("marL", str(Inches(indent)))
                ppr.set("indent", str(-Inches(0.28)))
                for tag in ("a:buClrTx", "a:buClr", "a:buFont", "a:buChar", "a:buNone", "a:buAutoNum"):
                    for el in ppr.findall(qn(tag)):
                        ppr.remove(el)
                bc = etree.SubElement(ppr, qn("a:buClr"))
                etree.SubElement(bc, qn("a:srgbClr")).set("val", item.get("bullet_color", self.t.accent))
                etree.SubElement(ppr, qn("a:buSzPct")).set("val", "100000")
                etree.SubElement(ppr, qn("a:buFont")).set("typeface", "Arial")
                etree.SubElement(ppr, qn("a:buChar")).set("char", "■" if level == 0 else "–")
            self._run(p, text, size=size * item.get("scale", 1.0), bold=item.get("bold", bold),
                      color=item.get("color", color or self.t.dark), italic=item.get("italic", italic))
        return box

    def _run(self, p, text, size, bold=False, color=None, italic=False):
        r = None
        for segment, latin_seg in split_scripts(text):
            r = p.add_run()
            r.text = segment
            f = r.font
            f.size = Pt(size)
            f.bold = bold
            f.italic = italic
            if color:
                f.color.rgb = _rgb(color)
            f.name = self.t.font
            rpr = r._r.get_or_add_rPr()
            latin = rpr.find(qn("a:latin"))
            cs = etree.Element(qn("a:cs"))
            cs.set("typeface", self.t.font_ar)
            latin.addnext(cs)
            if has_arabic(segment):
                rpr.set("lang", "ar-SA")
            elif latin_seg and has_arabic(text):
                rpr.set("lang", "en-US")
        return r

    def _notes(self, slide, notes):
        if notes:
            slide.notes_slide.notes_text_frame.text = notes

    # -- shared chrome ----------------------------------------------------------
    def _header(self, slide, title, subtitle=None):
        t = self.t
        self._decide(title, subtitle)
        self._text(slide, M, 0.38, W - 2 * M, 0.8, {"text": title, "bold": True}, size=28, min_size=18,
                   color=t.primary, anchor=MSO_ANCHOR.BOTTOM)
        self._shape(slide, M + 0.05, 1.24, 0.9, 0.06, fill=t.accent)
        top = 1.5
        if subtitle:
            self._text(slide, M, 1.36, W - 2 * M, 0.45, subtitle, size=15, min_size=11, color=t.muted)
            top = 1.95
        return top

    def _footer(self, slide):
        t = self.t
        n = len(self.prs.slides)
        self._shape(slide, M, H - 0.55, W - 2 * M, 0.01, fill=t.border)
        if self.footer_text:
            self._text(slide, M, H - 0.5, W * 0.6, 0.32, self.footer_text, size=10, color=t.muted, fit=False,
                       align=self._start)
        if self.slide_numbers:
            self._text(slide, W - M - 1.0, H - 0.5, 1.0, 0.32, str(n), size=10, color=t.muted, fit=False,
                       bold=True, align=self._end)

    def _content_slide(self, title, subtitle=None):
        s = self._slide()
        top = self._header(s, title, subtitle)
        self._footer(s)
        return s, top, H - 0.75

    # -- slide types ---------------------------------------------------------------
    def title_slide(self, title, subtitle=None, meta=None, notes=None):
        t = self.t
        self._decide(title, subtitle, meta)
        if self.title_text is None:
            self.title_text = title
            self.footer_text = self.footer_text or title
        s = self._slide(bg=t.primary)
        self._shape(s, W - 4.2, H - 4.6, 6.0, 6.0, fill=t.secondary, kind=MSO_SHAPE.OVAL, alpha=0.35)
        self._shape(s, W - 2.3, -1.6, 3.6, 3.6, fill=tint(t.secondary, 0.35), kind=MSO_SHAPE.OVAL, alpha=0.25)
        self._shape(s, M + 0.05, 2.35, 1.3, 0.09, fill=t.accent)
        self._text(s, M, 2.55, 8.6, 1.9, {"text": title, "bold": True}, size=44, min_size=26, color="FFFFFF",
                   anchor=MSO_ANCHOR.TOP, spacing=1.05)
        if subtitle:
            self._text(s, M, 4.5, 8.6, 1.0, subtitle, size=21, min_size=14, color=tint(t.primary, 0.78))
        if meta:
            self._text(s, M, H - 1.25, 8.6, 0.5, meta, size=14, min_size=11, color=tint(t.primary, 0.6))
        self._notes(s, notes)
        return s

    def section(self, title, subtitle=None, number=None, notes=None):
        t = self.t
        self._decide(title, subtitle)
        s = self._slide()
        self._shape(s, 0, 0, 4.6, H, fill=t.primary)
        self._shape(s, 4.6, 0, 0.12, H, fill=t.accent)
        if number is not None:
            label = f"{number:02d}" if isinstance(number, int) else str(number)
            self._text(s, 0.4, 2.2, 3.8, 2.6, {"text": label, "bold": True}, size=110, min_size=60,
                       color=tint(t.primary, 0.75), align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, fit=False)
        self._text(s, 5.4, 2.4, W - 5.4 - M, 1.6, {"text": title, "bold": True}, size=38, min_size=24,
                   color=t.primary, anchor=MSO_ANCHOR.BOTTOM)
        if subtitle:
            self._text(s, 5.4, 4.15, W - 5.4 - M, 1.2, subtitle, size=18, min_size=12, color=t.muted)
        self._notes(s, notes)
        return s

    def agenda(self, items, title=None, notes=None):
        t = self.t
        self._decide(title, *items)
        title = title or ("جدول الأعمال" if self.rtl else "Agenda")
        s, top, bottom = self._content_slide(title)
        n = len(items)
        cols = 1 if n <= 4 else 2
        rows = math.ceil(n / cols)
        col_w = (W - 2 * M - 0.6 * (cols - 1)) / cols
        row_h = min(1.05, (bottom - top - 0.2) / rows)
        for i, item in enumerate(items):
            c, r = divmod(i, rows)
            x = M + c * (col_w + 0.6)
            y = top + 0.2 + r * row_h
            d = min(0.62, row_h - 0.2)
            self._shape(s, x, y + (row_h - d) / 2 - 0.08, d, d, fill=t.primary, kind=MSO_SHAPE.OVAL)
            self._text(s, x, y + (row_h - d) / 2 - 0.08, d, d, {"text": str(i + 1), "bold": True}, size=18,
                       color="FFFFFF", align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, fit=False, inset=0)
            self._text(s, x + d + 0.25, y, col_w - d - 0.3, row_h - 0.16, str(item), size=22, min_size=13,
                       color=t.dark, anchor=MSO_ANCHOR.MIDDLE)
            if r < rows - 1 and i < n - 1:
                self._shape(s, x + d + 0.25, y + row_h - 0.1, col_w - d - 0.3, 0.01, fill=t.border)
        self._notes(s, notes)
        return s

    def bullets(self, title, items, subtitle=None, notes=None, takeaway=None):
        """Bullet list. Item: str or (str, [sub items]). takeaway: highlighted bar at the bottom."""
        t = self.t
        s, top, bottom = self._content_slide(title, subtitle)
        paras = []
        for it in items:
            text, subs = (it if isinstance(it, (tuple, list)) else (it, None))
            paras.append({"text": str(text), "bullet": True, "space_after": 10})
            for sub in subs or []:
                paras.append({"text": str(sub), "bullet": True, "level": 1, "scale": 0.82, "color": t.muted,
                              "space_after": 6})
        if takeaway:
            bottom -= 0.95
        self._text(s, M, top + 0.15, W - 2 * M, bottom - top - 0.2, paras, size=24, min_size=13, spacing=1.1)
        if takeaway:
            self._takeaway(s, takeaway, bottom + 0.15)
        self._notes(s, notes)
        return s

    def _takeaway(self, s, text, y):
        t = self.t
        self._shape(s, M, y, W - 2 * M, 0.7, fill=tint(t.accent, 0.85))
        self._shape(s, M, y, 0.09, 0.7, fill=t.accent)
        self._text(s, M + 0.3, y, W - 2 * M - 0.45, 0.7, {"text": text, "bold": True}, size=16, min_size=11,
                   color=t.dark, anchor=MSO_ANCHOR.MIDDLE)

    def cards(self, title, items, subtitle=None, notes=None, numbered=False):
        """2–6 cards. Item: (heading, body) or dict(title, body)."""
        t = self.t
        s, top, bottom = self._content_slide(title, subtitle)
        items = [(i.get("title"), i.get("body")) if isinstance(i, dict) else tuple(i) for i in items]
        n = len(items)
        cols = n if n <= 4 else 3
        rows = math.ceil(n / cols)
        gap = 0.3
        cw = (W - 2 * M - gap * (cols - 1)) / cols
        ch = (bottom - top - 0.2 - gap * (rows - 1)) / rows
        for i, (head, body) in enumerate(items):
            r, c = divmod(i, cols)
            x, y = M + c * (cw + gap), top + 0.15 + r * (ch + gap)
            self._shape(s, x, y, cw, ch, fill=t.light)
            self._shape(s, x, y, cw, 0.08, fill=t.color(i))
            inner_top = y + 0.3
            if numbered:
                self._text(s, x + 0.25, inner_top, 1.2, 0.6, {"text": f"{i + 1:02d}", "bold": True}, size=26,
                           color=t.color(i), fit=False)
                inner_top += 0.6
            self._text(s, x + 0.25, inner_top, cw - 0.5, 0.75, {"text": str(head), "bold": True}, size=19,
                       min_size=12, color=t.primary, anchor=MSO_ANCHOR.TOP)
            if body:
                self._text(s, x + 0.25, inner_top + 0.8, cw - 0.5, y + ch - inner_top - 1.0, str(body), size=15,
                           min_size=10, color=t.dark, spacing=1.15)
        self._notes(s, notes)
        return s

    def kpis(self, title, items, subtitle=None, notes=None, note=None, currency=None):
        """Big-number slide. Item: (label, value[, kind][, delta]) or dict(label, value, kind, delta,
        lower_is_better). A string value is shown as given; numbers are formatted (large ones compacted)."""
        t = self.t
        s, top, bottom = self._content_slide(title, subtitle)
        items = [kpi_item(i) for i in items]
        n = len(items)
        cols = n if n <= 4 else 3
        rows = math.ceil(n / cols)
        gap = 0.35
        cw = (W - 2 * M - gap * (cols - 1)) / cols
        ch = min(2.6, (bottom - top - 0.3 - gap * (rows - 1) - (0.6 if note else 0)) / rows)
        y0 = top + 0.25 + max(0, (bottom - top - 0.3 - (0.6 if note else 0) - rows * ch - gap * (rows - 1)) / 2)
        for i, it in enumerate(items):
            r, c = divmod(i, cols)
            x, y = M + c * (cw + gap), y0 + r * (ch + gap)
            self._shape(s, x, y, cw, ch, fill="FFFFFF", line=t.border)
            self._shape(s, x, y, 0.08, ch, fill=t.color(i))
            value, kind = it["value"], it["kind"]
            if not isinstance(value, str):
                if kind == "percent":
                    value = format_value(value, "percent")
                elif abs(value) >= 1e5:
                    value = compact_number(value, currency if kind == "currency" else None)
                else:
                    value = format_value(value, kind or "number", currency)
            # Big numbers must stay on one line: size them to the card width.
            vsize = max(18, min(44, int((cw - 0.75) * 72 * 0.9 / max(_em(value, True), 0.5))))
            self._text(s, x + 0.3, y + 0.25, cw - 0.5, ch * 0.45, {"text": value, "bold": True}, size=vsize,
                       color=t.primary, anchor=MSO_ANCHOR.BOTTOM, spacing=1.0, fit=False)
            self._text(s, x + 0.3, y + 0.3 + ch * 0.45, cw - 0.5, ch * 0.28, str(it.get("label", "")), size=16,
                       min_size=10, color=t.muted)
            delta = it.get("delta")
            if delta is not None:
                good = delta >= 0 if not it.get("lower_is_better") else delta <= 0
                text = delta if isinstance(delta, str) else f"{'▲' if delta >= 0 else '▼'} {abs(delta) * 100:.1f}%"
                self._text(s, x + 0.3, y + ch - 0.5, cw - 0.5, 0.36, {"text": text, "bold": True}, size=13,
                           color=t.positive if good else t.negative, fit=False,
                           align=PP_ALIGN.RIGHT if self.rtl else PP_ALIGN.LEFT)
        if note:
            self._text(s, M, bottom - 0.55, W - 2 * M, 0.45, note, size=13, min_size=10, color=t.muted,
                       italic=True)
        self._notes(s, notes)
        return s

    def chart(self, title, categories, series, kind="column", subtitle=None, notes=None, number_format=None,
              labels=None, side_text=None, legend=None, x_title=None, y_title=None):
        """Native, editable chart. series: {"name": [values...]}.
        kind: column | stacked_column | percent_column | bar | stacked_bar | line | area | stacked_area | pie |
        doughnut.  side_text: list of short insight lines shown beside the chart."""
        t = self.t
        self._decide(title, *map(str, categories), *series)
        s, top, bottom = self._content_slide(title, subtitle)
        cw = W - 2 * M
        if side_text:
            cw = (W - 2 * M) * 0.64
        ctype = _CHART_TYPES[kind]
        data = CategoryChartData()
        data.categories = [str(c) for c in categories]
        for name, vals in series.items():
            data.add_series(str(name), [v if isinstance(v, (int, float)) else None for v in vals])
        x = self._x(M, cw)
        gf = s.shapes.add_chart(ctype, Inches(x), Inches(top + 0.1), Inches(cw), Inches(bottom - top - 0.15), data)
        ch = gf.chart
        self._style_chart(ch, kind, series, number_format, labels, legend, x_title, y_title)
        if side_text:
            sx = M + cw + 0.35
            sw = W - M - sx
            self._shape(s, sx, top + 0.1, sw, bottom - top - 0.15, fill=t.light)
            paras = [{"text": str(line), "bullet": True, "space_after": 12} for line in side_text]
            self._text(s, sx + 0.2, top + 0.35, sw - 0.4, bottom - top - 0.6, paras, size=17, min_size=11)
        self._notes(s, notes)
        return s

    def _style_chart(self, ch, kind, series, number_format, labels, legend, x_title, y_title):
        t = self.t
        pie = kind in ("pie", "doughnut")
        ch.has_title = False  # the slide title names the chart
        ch.font.size = Pt(12)
        ch.font.name = t.font
        ch.font.color.rgb = _rgb(t.muted)
        peak = max((abs(v) for vals in series.values() for v in vals if isinstance(v, (int, float))), default=0)
        fmt = number_format or ("0%" if kind == "percent_column" else _scaled(peak))
        show_legend = legend if legend is not None else (len(series) > 1 or pie)
        ch.has_legend = show_legend
        if show_legend:
            ch.legend.position = XL_LEGEND_POSITION.RIGHT if pie else XL_LEGEND_POSITION.BOTTOM
            ch.legend.include_in_layout = False
            ch.legend.font.size = Pt(12)
            ch.legend.font.color.rgb = _rgb(t.dark)
        plot = ch.plots[0]
        if kind in ("column", "bar", "stacked_column", "stacked_bar", "percent_column"):
            plot.gap_width = 60
            plot.overlap = 100 if kind.startswith(("stacked", "percent")) else -10
        for i, sr in enumerate(plot.series):
            if pie:
                for j, pt in enumerate(sr.points):
                    pt.format.fill.solid()
                    pt.format.fill.fore_color.rgb = _rgb(t.color(j))
                    pt.format.line.color.rgb = _rgb("FFFFFF")
                    pt.format.line.width = Pt(1.5)
            elif kind == "line":
                sr.format.line.color.rgb = _rgb(t.color(i))
                sr.format.line.width = Pt(3)
                sr.smooth = False
                sr.marker.style = 8  # circle
                sr.marker.size = 8
                sr.marker.format.fill.solid()
                sr.marker.format.fill.fore_color.rgb = _rgb(t.color(i))
                sr.marker.format.line.color.rgb = _rgb("FFFFFF")
            else:
                sr.format.fill.solid()
                sr.format.fill.fore_color.rgb = _rgb(t.color(i))
                sr.format.line.fill.background()
        n_points = max((len(v) for v in series.values()), default=0)
        if labels is None:
            labels = pie or (len(series) == 1 and n_points <= 12)
        if labels:
            plot.has_data_labels = True
            dl = plot.data_labels
            dl.font.size = Pt(12)
            if pie:
                dl.number_format = "0%"
                dl.number_format_is_linked = False
                dl.show_percentage = True
                dl.show_value = False
                dl.font.color.rgb = _rgb("FFFFFF")
                dl.font.bold = True
            else:
                dl.number_format = fmt
                dl.number_format_is_linked = False
                dl.font.color.rgb = _rgb(t.dark)
                if kind in ("column", "bar"):
                    dl.position = XL_LABEL_POSITION.OUTSIDE_END
        if kind == "doughnut":
            hole = ch._chartSpace.find(".//" + qn("c:holeSize"))
            if hole is not None:
                hole.set("val", "55")
        if pie:
            return
        va, ca = ch.value_axis, ch.category_axis
        va.has_major_gridlines = True
        va.major_gridlines.format.line.color.rgb = _rgb("E6E9EE")
        va.major_gridlines.format.line.width = Pt(0.75)
        va.format.line.fill.background()
        va.tick_labels.number_format = fmt
        va.tick_labels.number_format_is_linked = False
        va.tick_labels.font.size = Pt(11)
        ca.tick_labels.font.size = Pt(12)
        ca.format.line.color.rgb = _rgb(t.border)
        ca.has_major_gridlines = False
        ca.major_tick_mark = XL_TICK_MARK.NONE
        va.major_tick_mark = XL_TICK_MARK.NONE
        if kind in ("bar", "stacked_bar"):
            ca.reverse_order = True  # first category on top
            # The value axis crosses the reversed category axis at its end, i.e. along the bottom.
            ch._chartSpace.find(".//" + qn("c:valAx")).find(qn("c:crosses")).set("val", "max")
            if self.rtl:
                va.reverse_order = True
        elif self.rtl:
            ca.reverse_order = True  # first category on the right, value axis moves right
        if x_title:
            ca.has_title = True
            ca.axis_title.text_frame.text = x_title
        if y_title:
            va.has_title = True
            va.axis_title.text_frame.text = y_title

    def table(self, title, data, columns=None, formats=None, currency=None, subtitle=None, notes=None,
              widths=None, highlight_first=False, note=None):
        """Styled native table. Keep it to ~8 rows x 6 columns; split bigger data across slides."""
        t = self.t
        cols, rows = normalize_table(data, columns)
        self._decide(title, *cols)
        s, top, bottom = self._content_slide(title, subtitle)
        formats = formats or {}
        kinds = [formats.get(c) or guess_kind([r[i] for r in rows], c) for i, c in enumerate(cols)]
        decs = []
        for i, k in enumerate(kinds):
            nums = [r[i] for r in rows if isinstance(r[i], (int, float)) and not isinstance(r[i], bool)]
            decs.append(0 if nums and all(float(v).is_integer() for v in nums) and k in ("number", "currency") else None)
        cells = [[format_value(v, kinds[i], currency, decs[i]) for i, v in enumerate(r)] for r in rows]
        n_rows = len(cells) + 1
        avail_h = bottom - top - 0.25 - (0.5 if note else 0)
        row_h = min(0.55, avail_h / n_rows)
        size = max(10, min(16, row_h * 72 * 0.42))
        tw = W - 2 * M
        weights = widths or [min(max(max([len(str(c))] + [len(x[i]) for x in cells]), 4), 40)
                             for i, c in enumerate(cols)]
        col_w = [tw * w / sum(weights) for w in weights]
        x = self._x(M, tw)
        gf = s.shapes.add_table(n_rows, len(cols), Inches(x), Inches(top + 0.15), Inches(tw), Inches(row_h * n_rows))
        tbl = gf.table
        tblpr = tbl._tbl.tblPr
        sid = tblpr.find(qn("a:tableStyleId"))
        if sid is None:
            sid = etree.SubElement(tblpr, qn("a:tableStyleId"))
        sid.text = _NO_STYLE_TABLE
        tblpr.set("firstRow", "1")
        tblpr.set("bandRow", "0")
        if self.rtl:
            tblpr.set("rtl", "1")
        for i, w in enumerate(col_w):
            tbl.columns[i].width = Inches(w)
        numeric = {i for i, k in enumerate(kinds) if k in ("int", "number", "currency", "percent", "date")}
        for r in range(n_rows):
            tbl.rows[r].height = Inches(row_h)
            for c in range(len(cols)):
                cell = tbl.cell(r, c)
                header = r == 0
                text = str(cols[c]) if header else cells[r - 1][c]
                self._cell_border(cell, bottom=(t.primary if header else t.border, 1.0 if not header else 0))
                cell.fill.solid()
                cell.fill.fore_color.rgb = _rgb(t.primary if header else (t.light if r % 2 == 0 else "FFFFFF"))
                cell.vertical_anchor = MSO_ANCHOR.MIDDLE
                cell.margin_left = cell.margin_right = Inches(0.12)
                cell.margin_top = cell.margin_bottom = Inches(0.03)
                tf = cell.text_frame
                tf.word_wrap = True
                p = tf.paragraphs[0]
                p_rtl = has_arabic(text) or (self.rtl and not any(ch.isalpha() and ch.isascii() for ch in text))
                if p_rtl:
                    p._p.get_or_add_pPr().set("rtl", "1")
                p.alignment = PP_ALIGN.CENTER if (header or c in numeric) else (
                    PP_ALIGN.RIGHT if p_rtl else PP_ALIGN.LEFT)
                bold = header or (highlight_first and c == 0)
                self._run(p, text, size=size, bold=bold, color="FFFFFF" if header else t.dark)
        if note:
            self._text(s, M, bottom - 0.5, tw, 0.4, note, size=12, min_size=9, color=t.muted, italic=True)
        self._notes(s, notes)
        return s

    @staticmethod
    def _cell_border(cell, bottom=None):
        tcpr = cell._tc.get_or_add_tcPr()
        for tag in ("a:lnL", "a:lnR", "a:lnT", "a:lnB"):
            for el in tcpr.findall(qn(tag)):
                tcpr.remove(el)
        specs = {"lnL": None, "lnR": None, "lnT": None, "lnB": bottom}
        for pos, (tag, spec) in enumerate(specs.items()):
            ln = etree.Element(qn(f"a:{tag}"))
            if spec and spec[1] > 0:
                ln.set("w", str(int(Pt(spec[1]))))
                fill = etree.SubElement(ln, qn("a:solidFill"))
                etree.SubElement(fill, qn("a:srgbClr")).set("val", spec[0])
            else:
                ln.set("w", "0")
                etree.SubElement(ln, qn("a:noFill"))
            tcpr.insert(pos, ln)

    def comparison(self, title, left_title, left_items, right_title, right_items, subtitle=None, notes=None):
        """Two side-by-side panels (before/after, option A/B, pros/cons). 'left' is the start side."""
        t = self.t
        s, top, bottom = self._content_slide(title, subtitle)
        gap = 0.4
        pw = (W - 2 * M - gap) / 2
        for k, (head, items, color) in enumerate(((left_title, left_items, t.primary),
                                                  (right_title, right_items, t.secondary))):
            x = M + k * (pw + gap)
            self._shape(s, x, top + 0.15, pw, 0.7, fill=color)
            self._text(s, x + 0.25, top + 0.15, pw - 0.5, 0.7, {"text": str(head), "bold": True}, size=20,
                       min_size=12, color="FFFFFF", anchor=MSO_ANCHOR.MIDDLE)
            self._shape(s, x, top + 0.85, pw, bottom - top - 0.95, fill=t.light)
            paras = [{"text": str(i), "bullet": True, "space_after": 10, "bullet_color": color} for i in items]
            self._text(s, x + 0.25, top + 1.05, pw - 0.5, bottom - top - 1.3, paras, size=19, min_size=11)
        self._notes(s, notes)
        return s

    def timeline(self, title, steps, subtitle=None, notes=None):
        """Milestones. Step: (label, text) e.g. ("Q1 2027", "Launch pilot")."""
        t = self.t
        s, top, bottom = self._content_slide(title, subtitle)
        n = len(steps)
        line_y = top + (bottom - top) * 0.42
        self._shape(s, M, line_y - 0.03, W - 2 * M, 0.06, fill=t.border)
        seg = (W - 2 * M) / n
        for i, (label, text) in enumerate(steps):
            cx = M + seg * i + seg / 2
            d = 0.38
            self._shape(s, cx - d / 2, line_y - d / 2, d, d, fill=t.color(i), kind=MSO_SHAPE.OVAL, line="FFFFFF",
                        line_w=3)
            self._text(s, cx - seg / 2 + 0.1, line_y - 1.15, seg - 0.2, 0.75, {"text": str(label), "bold": True},
                       size=18, min_size=11, color=t.color(i), align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.BOTTOM)
            self._text(s, cx - seg / 2 + 0.1, line_y + 0.4, seg - 0.2, bottom - line_y - 0.5, str(text), size=15,
                       min_size=10, color=t.dark, align=PP_ALIGN.CENTER)
        self._notes(s, notes)
        return s

    def image(self, title, path, caption=None, subtitle=None, notes=None):
        """Picture scaled to fit the content area."""
        from PIL import Image

        t = self.t
        s, top, bottom = self._content_slide(title, subtitle)
        avail_w, avail_h = W - 2 * M, bottom - top - 0.25 - (0.45 if caption else 0)
        with Image.open(path) as im:
            iw, ih = im.size
        scale = min(avail_w / iw, avail_h / ih)
        w, h = iw * scale, ih * scale
        s.shapes.add_picture(path, Inches((W - w) / 2), Inches(top + 0.15), Inches(w), Inches(h))
        if caption:
            self._text(s, M, top + 0.2 + h, W - 2 * M, 0.4, caption, size=12, color=t.muted,
                       align=PP_ALIGN.CENTER, italic=True)
        self._notes(s, notes)
        return s

    def quote(self, text, source=None, notes=None):
        t = self.t
        self._decide(text)
        s = self._slide(bg=t.light)
        mark = self._text(s, M, 0.45, W - 2 * M, 1.9, "“", size=110, color=t.accent, align=PP_ALIGN.CENTER,
                          fit=False)
        mark.text_frame.paragraphs[0].runs[0].font.name = "Georgia"
        self._text(s, 1.5, 2.3, W - 3.0, 2.6, {"text": str(text), "bold": False}, size=30, min_size=16,
                   color=t.primary, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, italic=not self.rtl)
        if source:
            self._text(s, 1.5, 5.1, W - 3.0, 0.6, f"— {source}", size=16, color=t.muted, align=PP_ALIGN.CENTER)
        self._notes(s, notes)
        return s

    def closing(self, title=None, subtitle=None, contact=None, notes=None):
        t = self.t
        title = title or ("شكراً لكم" if self.rtl else "Thank you")
        s = self._slide(bg=t.primary)
        self._shape(s, -1.8, H - 3.6, 5.5, 5.5, fill=t.secondary, kind=MSO_SHAPE.OVAL, alpha=0.35, mirror=False)
        self._shape(s, W - 2.6, -1.4, 3.6, 3.6, fill=tint(t.secondary, 0.35), kind=MSO_SHAPE.OVAL, alpha=0.25,
                    mirror=False)
        self._shape(s, (W - 1.3) / 2, 2.55, 1.3, 0.09, fill=t.accent, mirror=False)
        self._text(s, 1.0, 2.75, W - 2.0, 1.3, {"text": title, "bold": True}, size=48, min_size=28, color="FFFFFF",
                   align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
        if subtitle:
            self._text(s, 1.5, 4.1, W - 3.0, 0.8, subtitle, size=20, min_size=13, color=tint(t.primary, 0.78),
                       align=PP_ALIGN.CENTER)
        if contact:
            self._text(s, 1.5, H - 1.3, W - 3.0, 0.6, contact, size=14, min_size=10, color=tint(t.primary, 0.6),
                       align=PP_ALIGN.CENTER)
        self._notes(s, notes)
        return s

    def save(self, path):
        if not path.lower().endswith(".pptx"):
            path += ".pptx"
        folder = os.path.dirname(path)
        if folder:
            os.makedirs(folder, exist_ok=True)
        self.prs.save(path)
        return path


def _scaled(peak):
    if peak >= 1e6:
        return '#,##0.0,,"M"'
    if peak >= 1e4:
        return '#,##0,"K"'
    return "#,##0" if peak >= 100 else "#,##0.0"
