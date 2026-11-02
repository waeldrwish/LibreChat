# officekit API reference

All builders take `theme=` (`corporate`, `emerald`, `royal`, `ocean`, `slate`, `maroon`) plus optional
color/font overrides (`primary=`, `secondary=`, `accent=`, `font=`, `font_ar=` …) and `rtl=None|True|False`
(None = detect Arabic automatically).

Shared helpers (`from officekit import ...`):

| helper | result |
|---|---|
| `format_value(1250000, "currency", "SAR")` | `1,250,000.00 ر.س` (`decimals=0` → `1,250,000 ر.س`) |
| `format_value(0.183, "percent")` | `18.3%` |
| `compact_number(45_000_000, "SAR")` | `45M ر.س` |
| `get_theme("emerald").primary` | `0B5D4B` (hex without `#`) |
| `display_text("نص عربي")` | shaped + reordered text for images (not needed inside Office files) |

KPI items are the same everywhere: `(label, value[, kind][, delta])` or
`dict(label=, value=, kind=, delta=, lower_is_better=)`. A string third element is the kind
(`int`, `number`, `currency`, `percent`); a number is the delta (`0.12` → ▲ 12%).

Table data is the same everywhere: a pandas DataFrame, a list of dicts, or a list of rows with
`columns=[...]` (or the first row as headers). Format kinds: `text, int, number, currency, percent,
date, datetime` (Excel also accepts a raw number format string).

---

## Deck (PowerPoint, 16:9)

```
Deck(theme="corporate", rtl=None, title=None, author=None, footer=None, slide_numbers=True, **theme_overrides)
  .title_slide(title, subtitle=None, meta=None, notes=None)
  .agenda(items, title=None, notes=None)                                   # 2–8 items
  .section(title, subtitle=None, number=None, notes=None)                  # divider; number=1 → "01"
  .bullets(title, items, subtitle=None, notes=None, takeaway=None)         # item: str | (str, [subs])
  .cards(title, items, subtitle=None, notes=None, numbered=False)          # (heading, body), 2–6
  .kpis(title, items, subtitle=None, notes=None, note=None, currency=None) # 2–6 KPI items
  .chart(title, categories, series, kind="column", subtitle=None, notes=None, number_format=None,
         labels=None, side_text=None, legend=None, x_title=None, y_title=None)
  .table(title, data, columns=None, formats=None, currency=None, subtitle=None, notes=None,
         widths=None, highlight_first=False, note=None)                    # ≤ 8 rows, ≤ 6 columns
  .comparison(title, left_title, left_items, right_title, right_items, subtitle=None, notes=None)
  .timeline(title, steps, subtitle=None, notes=None)                       # (label, text), 3–6
  .image(title, path, caption=None, subtitle=None, notes=None)
  .quote(text, source=None, notes=None)
  .closing(title=None, subtitle=None, contact=None, notes=None)            # default "شكراً لكم"/"Thank you"
  .save(path) -> path
```

- `series` is `{"Series name": [one value per category]}`. Chart kinds: `column, stacked_column,
  percent_column, bar, stacked_bar, line, area, stacked_area, pie, doughnut`.
- `number_format` is an Office format such as `'#,##0'`, `'0.0%'`, `'#,##0.0,,"M"'` (auto when omitted).
- Text is sized automatically to fit its box; `check.py` still flags anything that may overflow.
- In right-to-left decks every layout is mirrored (start side is the right).

## Document (Word, A4)

```
Document(theme="corporate", rtl=None, title=None, author=None, org=None, landscape=False, font_size=11,
         header=None, page_numbers=True, margins_cm=2.2, **theme_overrides)
  .cover(title=None, subtitle=None, meta=None, org=None, note=None)   # meta: dict or [(label, value)]
  .toc(title=None, levels=3)
  .heading(text, level=1)
  .paragraph(text, size=None, color=None, bold=None, align=None, space_after=None)   # **bold**, *italic*
  .bullets(items, numbered=False) / .numbered(items)                  # item: str | (str, [subs])
  .table(data, columns=None, formats=None, widths=None, totals=None, caption=None, zebra=True,
         font_size=None, currency=None, decimals=None, align=None)    # widths: relative weights
  .kpis(items, currency=None)                                         # 2–5 KPI boxes in a row
  .callout(text, title=None, kind="info")                             # info|success|warning|danger|key
  .chart(kind, categories, series, title=None, caption=None, width_cm=None, height_cm=None,
         number_format=None)                                          # python format, e.g. "{:,.0f}"
  .image(path, width_cm=None, caption=None)
  .fields(pairs, label_width=0.25)                                    # letter header lines
  .quote(text, source=None)
  .signature(name, role=None, label=None)
  .spacer(pt=12) / .page_break()
  .save(path) -> path
```

- Captions are numbered automatically ("جدول 1:" / "Table 1:", "شكل 1:" / "Figure 1:").
- Header shows `org | title` on every page but the cover; footer shows "صفحة X من Y" / "Page X of Y".
- `doc.doc` is the underlying python-docx Document for anything not covered.

## Workbook (Excel)

```
Workbook(path, theme="corporate", rtl=None, currency="SAR", title=None, author=None, company=None,
         decimals=None, **theme_overrides)          # use as a context manager or call .save()
  .sheet(name, rtl=None, tab_color=None, landscape=None) -> Sheet
  .data_sheet(name, data, columns=None, title=None, subtitle=None, **table_kwargs) -> (Sheet, TableRef)
  .save() -> path

Sheet
  .title(text, subtitle=None)        .section(text)        .note(text)        .gap(rows=1)
  .kpis(items, per_row=4, card_cols=2)
  .table(data, columns=None, formats=None, totals=None, name=None, widths=None, highlight=None,
         zebra=True, decimals=None, freeze=None, total_label=None) -> TableRef
  .chart(table, x=None, y=None, kind="column", title=None, labels=None, size=None, position="below",
         number_format=None, x_title=None, y_title=None, legend=None)
  .write(cell, value, kind=None, bold=False, color=None, bg=None, size=None)
  .ws                                 # the xlsxwriter worksheet for anything else

TableRef: .columns  .first_row  .last_row  .header_row  .col(name)  .range(name) -> "'Sheet'!$C$5:$C$40"
```

- Blocks stack top to bottom in call order; titles, sections and notes span the final used width.
- `totals` writes SUBTOTAL formulas (they respect filters) with cached values, so viewers that do
  not recalculate still show the numbers.
- `highlight`: `bar`, `scale`, `scale_reverse`, `icons`, `negative`.
- KPI `formula`: `{"label": "Total", "value": 3800000, "kind": "currency", "formula": "=SUM(Data!C5:C40)"}`
  keeps the card live; `value` is the cached result.

## check.py

`python /mnt/data/skills/office-pro/officekit/check.py FILE [FILE ...]` prints an outline and problems:
text overflow and off-slide text, crowded slides (> 8 bullets), tiny fonts, Arabic paragraphs without
RTL, long paragraphs, Excel error values, numbers stored as text, Arabic sheets not set right-to-left.
Exit code 1 when problems were found.

---

## Example: Arabic board deck

```python
import sys; sys.dont_write_bytecode = True
sys.path.insert(0, "/mnt/data/skills/office-pro")
from officekit import Deck

d = Deck(theme="royal", title="خطة التحول الرقمي 2027")
d.title_slide("خطة التحول الرقمي 2027", "الرؤية والمبادرات والميزانية", meta="إدارة التقنية — نوفمبر 2026")
d.agenda(["الوضع الحالي", "المبادرات", "الميزانية", "الخطوات التالية"])
d.section("الوضع الحالي", "أين نقف اليوم", number=1)
d.bullets("تعدد الأنظمة يرفع التكلفة 30%", [
    "14 نظاماً منفصلاً بلا تكامل",
    ("بطء الإجراءات الورقية:", ["9 أيام لإنجاز المعاملة", "اعتماد على البريد الداخلي"]),
], takeaway="الأولوية: توحيد المنصات قبل إضافة خدمات جديدة")
d.kpis("أرقام رئيسية", [("مبادرة", 12), ("الميزانية", 45_000_000, "currency"), ("شهراً للتنفيذ", 18)],
       currency="SAR")
d.cards("المبادرات", [("منصة موحدة", "دمج الأنظمة في منصة سحابية واحدة."),
                      ("أتمتة الإجراءات", "تحويل 80% من المعاملات إلى مسارات رقمية."),
                      ("حوكمة البيانات", "مستودع بيانات ولوحات مؤشرات لحظية.")], numbered=True)
d.chart("المنصة تستحوذ على ثلث الميزانية", ["المنصة", "الأتمتة", "البيانات"],
        {"2027": [15, 10, 8], "2028": [6, 5, 4]}, side_text=["70% من الإنفاق في السنة الأولى"])
d.timeline("خارطة الطريق", [("الربع الأول", "اعتماد الخطة"), ("الربع الثاني", "الإطلاق التجريبي"),
                            ("الربع الرابع", "التعميم")])
d.closing(subtitle="نرحب بأسئلتكم")
d.save("/mnt/data/digital_plan.pptx")
```

## Example: report (Word)

```python
from officekit import Document

doc = Document(theme="emerald", title="التقرير السنوي 2026", org="شركة الأفق")
doc.cover(subtitle="ملخص الأداء المالي والتشغيلي", meta={"إعداد": "إدارة التخطيط", "التاريخ": "نوفمبر 2026"})
doc.toc()
doc.heading("الملخص التنفيذي")
doc.paragraph("حققت الشركة **نمواً بنسبة 12%** في الإيرادات مقارنة بالعام السابق ...")
doc.kpis([("الإيرادات", 48_500_000, "currency", 0.12), ("العملاء", 1240, "int", 0.15)], currency="SAR")
doc.callout("تجاوزنا المستهدف السنوي بنسبة 4%.", title="أبرز ما تحقق", kind="success")
doc.heading("أداء المناطق")
doc.table(rows, caption="الإيرادات حسب المنطقة", totals=["الإيرادات"], currency="SAR")
doc.chart("column", regions, {"الإيرادات": revenue}, title="الإيرادات حسب المنطقة", caption="مقارنة المناطق")
doc.heading("التوصيات")
doc.numbered(["التوسع جنوباً", "أتمتة الفوترة", "برنامج ولاء للعملاء"])
doc.save("/mnt/data/annual_report_2026.docx")
```

Letter: `Document(title=..., org=...)` without `cover()`; then `fields({"التاريخ": ..., "الرقم": ...,
"الموضوع": ...})`, paragraphs, `signature("الاسم", "المنصب", label="وتفضلوا بقبول فائق الاحترام،")`.

## Example: workbook (Excel)

```python
from officekit import Workbook

with Workbook("/mnt/data/sales_q3.xlsx", theme="corporate", currency="SAR") as wb:
    ws = wb.sheet("الملخص")
    ws.title("تقرير المبيعات الربعي", "الربع الثالث 2026")
    ws.kpis([("إجمالي المبيعات", 3_800_000, "currency", 0.094), ("هامش الربح", 0.339, "percent", 0.021)])
    ws.section("أداء المناطق")
    t = ws.table(df, totals=["المبيعات", "التكلفة"], formats={"نسبة النمو": "percent"},
                 highlight={"المبيعات": "bar", "نسبة النمو": "negative"})
    ws.chart(t, x="المنطقة", y=["المبيعات", "التكلفة"], title="المبيعات مقابل التكلفة")
    ws.chart(t, x="المنطقة", y="المبيعات", kind="doughnut", title="الحصة", position="right")
    ws.note("المصدر: نظام المبيعات. الأرقام بالريال ولا تشمل الضريبة.")
    wb.data_sheet("البيانات", df_detail, title="البيانات التفصيلية")
```
