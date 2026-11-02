"""Quality check for generated Office files.

    python /mnt/data/skills/office-pro/officekit/check.py /mnt/data/report.docx [more files...]

Prints a short outline of each file and a list of problems to fix (text overflow, off-slide shapes,
crowded slides, Arabic paragraphs without right-to-left direction, formula errors, ...)."""

from __future__ import annotations

import os
import sys

if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from officekit.theme import has_arabic
else:
    from .theme import has_arabic

EMU_PER_IN = 914400


def check(path):
    """Return (summary_lines, problems) for a .pptx, .docx or .xlsx file."""
    ext = os.path.splitext(path)[1].lower()
    if not os.path.exists(path):
        return [], [f"File not found: {path}"]
    if ext == ".pptx":
        return _check_pptx(path)
    if ext == ".docx":
        return _check_docx(path)
    if ext in (".xlsx", ".xlsm"):
        return _check_xlsx(path)
    return [], [f"Unsupported file type: {ext}"]


def _check_pptx(path):
    from pptx import Presentation

    if __package__ in (None, ""):
        from officekit.slides import _est_lines
    else:
        from .slides import _est_lines

    prs = Presentation(path)
    sw, sh = prs.slide_width, prs.slide_height
    summary, problems = [f"{len(prs.slides)} slides"], []
    for n, slide in enumerate(prs.slides, 1):
        texts, bullets = [], 0
        for shp in slide.shapes:
            if shp.left is None or shp.width is None:
                continue
            has_text = shp.has_text_frame and shp.text_frame.text.strip()
            if has_text and (shp.left < -EMU_PER_IN * 0.05 or shp.top < 0 or shp.left + shp.width > sw * 1.01
                             or shp.top + shp.height > sh * 1.01):
                problems.append(f"slide {n}: text box '{_short(shp.text_frame.text)}' extends past the slide edge")
            if not has_text:
                continue
            tf = shp.text_frame
            texts.append(tf.text.strip())
            width_pt = shp.width / 12700 - 14
            need = 0.0
            for p in tf.paragraphs:
                size = next((r.font.size.pt for r in p.runs if r.font.size), 18)
                bold = any(r.font.bold for r in p.runs)
                if p._p.pPr is not None and p._p.pPr.find(
                        "{http://schemas.openxmlformats.org/drawingml/2006/main}buChar") is not None:
                    bullets += 1
                need += _est_lines(p.text, size, width_pt, bold) * size * 1.2
                if p.runs and size < 10:
                    problems.append(f"slide {n}: font {size:.0f}pt is too small to read ('{_short(p.text)}')")
            have = shp.height / 12700
            if need > have * 1.2 and need - have > 8:
                problems.append(f"slide {n}: text may overflow its box ('{_short(tf.text)}'): "
                                f"needs ~{need:.0f}pt, box is {have:.0f}pt — shorten it or split the slide")
        if bullets > 8:
            problems.append(f"slide {n}: {bullets} bullet points — too crowded, split into two slides "
                            f"or use cards()")
        title = texts[0] if texts else ""
        summary.append(f"  {n:>2}. {_short(title, 70)}")
    return summary, problems


def _check_docx(path):
    from docx import Document
    from docx.oxml.ns import qn

    doc = Document(path)
    paras = doc.paragraphs
    summary, problems = [], []
    headings = [(p.style.name, p.text) for p in paras if p.style.name.startswith("Heading") and p.text.strip()]
    words = sum(len(p.text.split()) for p in paras)
    summary.append(f"{words} words, {len(doc.tables)} tables, {len(doc.inline_shapes)} images, "
                   f"{len(headings)} headings")
    for style, text in headings[:40]:
        level = style.replace("Heading", "").strip() or "1"
        summary.append(f"  {'  ' * (int(level) - 1) if level.isdigit() else ''}- {_short(text, 70)}")
    empty_run = 0
    for i, p in enumerate(paras):
        text = p.text
        if not text.strip() and not p._p.findall(".//" + qn("w:drawing")) and not p._p.findall(".//" + qn("w:br")):
            empty_run += 1
            if empty_run == 3:
                problems.append(f"paragraph {i}: several empty paragraphs in a row — use spacing instead")
            continue
        empty_run = 0
        if has_arabic(text):
            ppr = p._p.pPr
            if ppr is None or ppr.find(qn("w:bidi")) is None:
                problems.append(f"Arabic paragraph without right-to-left direction: '{_short(text)}'")
        if len(text) > 1500:
            problems.append(f"very long paragraph ({len(text)} chars): '{_short(text)}' — split it")
    if words > 1200 and not headings:
        problems.append("long document without headings — add heading() sections")
    return summary, problems


def _check_xlsx(path):
    import openpyxl
    import warnings

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        wb = openpyxl.load_workbook(path)
    summary, problems = [], []
    errors = ("#REF!", "#DIV/0!", "#NAME?", "#VALUE!", "#N/A", "#NUM!", "#NULL!")
    for ws in wb.worksheets:
        formulas, arabic, numbers_as_text = 0, False, 0
        for row in ws.iter_rows():
            for c in row:
                v = c.value
                if isinstance(v, str):
                    if v.startswith("="):
                        formulas += 1
                        if any(e in v for e in ("#REF!",)):
                            problems.append(f"{ws.title}!{c.coordinate}: broken reference in formula {v}")
                    elif v.strip() in errors:
                        problems.append(f"{ws.title}!{c.coordinate}: error value {v}")
                    else:
                        if not arabic and has_arabic(v):
                            arabic = True
                        stripped = v.replace(",", "").replace(" ", "")
                        if stripped.replace(".", "", 1).lstrip("-").isdigit() and len(stripped) > 0:
                            numbers_as_text += 1
        summary.append(f"sheet '{ws.title}': {ws.dimensions}, {formulas} formulas, "
                       f"{len(ws.tables)} tables, {len(ws._charts)} charts")
        if arabic and not ws.sheet_view.rightToLeft:
            problems.append(f"sheet '{ws.title}' has Arabic text but is not right-to-left")
        if numbers_as_text:
            problems.append(f"sheet '{ws.title}': {numbers_as_text} numbers stored as text — write real numbers "
                            f"and use formats= for display")
    return summary, problems


def _short(text, n=50):
    text = " ".join(str(text).split())
    return text if len(text) <= n else text[: n - 1] + "…"


def main(paths):
    status = 0
    for path in paths:
        summary, problems = check(path)
        print(f"== {os.path.basename(path)}")
        for line in summary:
            print(line)
        if problems:
            status = 1
            print(f"-- {len(problems)} problem(s) to fix:")
            for p in problems[:40]:
                print(f"  * {p}")
        else:
            print("-- no problems found")
        print()
    return status


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1:]))
