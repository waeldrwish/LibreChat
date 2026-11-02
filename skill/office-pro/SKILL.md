---
name: office-pro
description: Create professional, well-designed Word (.docx), Excel (.xlsx) and PowerPoint (.pptx) files with full Arabic right-to-left support, using the bundled officekit library (themes, cover pages, KPI cards, native charts, styled tables, automatic text fitting). Use it whenever the user asks for any Office file or downloadable document — report, proposal, letter, memo, contract, CV, spreadsheet, financial table, budget, dashboard, invoice, presentation, slides, deck — including Arabic requests such as تقرير، مستند، ملف وورد، خطاب، ملف إكسل، جدول، ميزانية، لوحة مؤشرات، عرض تقديمي، بوربوينت، شرائح.
---

# Office Pro — professional Word, Excel and PowerPoint files

Build every new Office file with **officekit** (in this skill). Never hand-roll raw python-docx /
openpyxl / python-pptx defaults for a new file: they look plain and break Arabic.

## 1. Setup (start every script with this)

```python
import sys; sys.dont_write_bytecode = True
sys.path.insert(0, "/mnt/data/skills/office-pro")
from officekit import Workbook, Document, Deck, format_value, compact_number
```

- Save outputs to `/mnt/data/<descriptive-name>.<ext>` (e.g. `/mnt/data/sales_report_q3.xlsx`).
  Never write into `/mnt/data/skills/`.
- Arabic content switches to right-to-left automatically (sheets, paragraphs, tables, mirrored slide
  layouts). Pass `rtl=True/False` only to force it.

## 2. Workflow

1. **Plan before coding.** Decide the outline: sheets and blocks, document sections, or the slide list
   with a layout per slide. Use the user's real data and wording. If you must assume figures, say so in
   the file (a note) and in your reply.
2. **Build the whole file in one script** with officekit.
3. **Check it**, fix every problem reported, and re-run until clean:
   `python /mnt/data/skills/office-pro/officekit/check.py /mnt/data/<file>`
4. **Reply briefly**: what the file contains (3–6 bullets) and any assumptions. Don't paste the code.

## 3. Themes

`theme=` on Workbook / Document / Deck. Use one theme per file; keep it the same across files of
one request.

| theme | palette | good for |
|---|---|---|
| `corporate` | navy + orange | general business (default) |
| `emerald` | green + gold | government, Gulf institutions, finance |
| `royal` | purple + gold | strategy, executive, premium |
| `ocean` | teal + amber | technology, health, education |
| `slate` | charcoal + red-orange | modern, startups, marketing |
| `maroon` | burgundy + blue | academic, legal, heritage |

Brand colors: `Deck(theme="corporate", primary="0B4F6C", accent="F2A900")`. Fonts default to Segoe UI
(Latin and Arabic); override with `font=` / `font_ar=` only if asked (e.g. `font_ar="Dubai"`).

## 4. PowerPoint — `Deck`

```python
deck = Deck(theme="royal", title="Deck name shown in the footer")
deck.title_slide("Title", "Subtitle", meta="Presenter — date")
deck.agenda(["Part one", "Part two", "Part three"])
deck.section("Part one", "One-line framing", number=1)
deck.bullets("Slide title", ["Point", ("Point with details", ["sub 1", "sub 2"])], takeaway="Key message")
deck.cards("Title", [("Heading", "1–2 sentence body"), ...], numbered=True)      # 2–6 cards
deck.kpis("Title", [("Budget", 45_000_000, "currency", 0.12), ("Months", 18)], currency="SAR")  # 2–6
deck.chart("Title", categories, {"Series": [..]}, kind="column", side_text=["Insight 1", "Insight 2"])
deck.table("Title", rows_or_dataframe, currency="SAR")                            # ≤ 8 rows
deck.comparison("Title", "Before", [...], "After", [...])
deck.timeline("Roadmap", [("Q1 2027", "Pilot"), ("Q2", "Rollout"), ...])        # 3–6 steps
deck.image("Title", "/mnt/data/photo.png", caption="…")
deck.quote("Quote text", "Source")
deck.closing(subtitle="Questions?", contact="email | phone")
deck.save("/mnt/data/deck.pptx")
```

Every content slide method accepts `subtitle=` and `notes=` (speaker notes).
Chart kinds: `column, stacked_column, percent_column, bar, stacked_bar, line, area, stacked_area, pie, doughnut`.

Slide rules:
- Structure: title → agenda (decks of 6+ slides) → a `section()` per part → content → `closing()`.
- One message per slide. Make titles state the point ("Revenue grew 12%", not "Revenue").
- At most 6 bullets of about 12 words; longer content → split slides, or put detail in `notes=`.
- Vary layouts; never three `bullets()` slides in a row. Numbers → `kpis`; parallel ideas → `cards`;
  data → `chart`; plan or history → `timeline`; A vs B → `comparison`; records → `table`.
- KPI items everywhere (Deck, Document, Workbook) are `(label, value[, kind][, delta])`. Kinds: `int`,
  `number`, `currency`, `percent` (value 0.183 → 18.3%). `delta` is a fraction (0.12 = ▲12%). On slides
  large numbers are compacted (45,000,000 → 45M ر.س); pass a string value to show it exactly as written.

## 5. Word — `Document`

```python
doc = Document(theme="emerald", title="Report title", org="Organisation")   # header shows org | title
doc.cover(subtitle="…", meta={"Prepared by": "…", "Date": "…"})           # formal reports/proposals
doc.toc()                                   # when there are 4+ headings (Word fills it on open)
doc.heading("Executive summary")            # level=1..3
doc.paragraph("Text with **bold** and *italic*.")
doc.kpis([("Revenue", 48_500_000, "currency", 0.12), ("Customers", 1240, "int")], currency="SAR")
doc.callout("Key message", title="Highlight", kind="success")   # info | success | warning | danger | key
doc.bullets(["Item", ("Item", ["sub item"])]);  doc.numbered(["Step 1", "Step 2"])
doc.table(data, caption="…", totals=["Amount"], currency="SAR", formats={"Rate": "percent"})
doc.chart("column", categories, {"Series": [...]}, title="…", caption="…")
doc.image("/mnt/data/pic.png", width_cm=12, caption="…")
doc.fields({"Date": "…", "Ref": "…", "Subject": "…"})          # letters / memos header block
doc.quote("…", "source");  doc.signature("Name", "Title", label="Regards,")
doc.page_break();  doc.spacer(12)
doc.save("/mnt/data/report.docx")
```

Document rules:
- Reports/proposals: cover → toc (if long) → executive summary (with `kpis`/`callout`) → sections →
  recommendations / next steps. Letters and memos: no cover; `fields` → paragraphs → `signature`.
- Headings in order (1 → 2 → 3). Paragraphs of 3–6 sentences. Every table and chart gets a caption.
- Use `landscape=True` for wide tables (7+ columns).

## 6. Excel — `Workbook`

```python
with Workbook("/mnt/data/sales.xlsx", theme="corporate", currency="SAR") as wb:
    ws = wb.sheet("Summary")
    ws.title("Sales report", "Q3 2026 — all regions")
    ws.kpis([("Revenue", 3_800_000, "currency", 0.094), ("Margin", 0.339, "percent")])
    ws.section("By region")
    t = ws.table(df, totals=["Revenue", "Cost"], formats={"Growth": "percent"},
                 highlight={"Revenue": "bar", "Growth": "negative"})
    ws.chart(t, x="Region", y=["Revenue", "Cost"], kind="column", title="Revenue vs cost")
    ws.chart(t, x="Region", y="Revenue", kind="doughnut", title="Share", position="right")
    ws.note("Source: … Figures exclude VAT.")
    wb.data_sheet("Data", df_detail, title="Detailed data")   # one-call sheet with a filterable table
```

- `table()` data: DataFrame, list of dicts, or list of rows + `columns=`. Returns a `TableRef`
  (`t.range("Revenue")` gives a sheet-qualified range for formulas).
- formats: `text, int, number, currency, percent, date, datetime` or an Excel format string;
  guessed from values and header names when omitted.
- totals: `True`, `[cols]`, or `{col: "sum"|"average"|"count"|"max"|"min"}` — live SUBTOTAL formulas.
- highlight: `bar` (data bars), `scale`, `scale_reverse`, `icons`, `negative` (red negatives).
- Free cells / formulas: `ws.write("H5", "=SUM(C5:C9)", "currency", bold=True)`.
- Chart kinds: `column, bar, line, area, pie, doughnut, scatter, stacked_column, stacked_bar,
  percent_column, stacked_area`; `position`: `"below"` (default), `"right"`, or a cell like `"J4"`.

Spreadsheet rules:
- First sheet = summary (title, KPIs, key table, chart); raw data on separate sheets.
- Store numbers as numbers and dates as dates — never pre-formatted strings. Percentages as fractions.
- Totals and derived values as formulas, not typed numbers. No merged cells inside data tables.

## 7. Charts as images

`from officekit import chart_png` → `chart_png(kind, categories, series, path, title=..., theme=...)`
renders a themed PNG with correct Arabic (use it for images anywhere; Office files should prefer
native charts). Never draw Arabic text with plain matplotlib/Pillow — letters come out disconnected
and reversed; pass text through `officekit.display_text()` if you must.

## 8. Editing existing files

officekit creates new files. To change a user's file, edit it with openpyxl / python-docx /
python-pptx and keep its existing styles. If the user wants it redesigned, extract the content and
rebuild it with officekit.

More detail and complete examples: `/mnt/data/skills/office-pro/references/api.md`.
