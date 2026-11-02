"""Themes, number formatting and Arabic helpers shared by the Excel, Word and PowerPoint builders."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, replace
from datetime import date, datetime

ARABIC_RE = re.compile(r"[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]")


def has_arabic(*texts) -> bool:
    """True when any of the given values contains an Arabic letter."""
    return any(isinstance(t, str) and ARABIC_RE.search(t) for t in texts)


_LATIN_SEG = re.compile(
    r"[A-Za-z0-9$€£#@][A-Za-z0-9$€£#@%.,:/+\-_'&]*(?: [A-Za-z0-9$€£#@(][A-Za-z0-9$€£#@%.,:/+\-_'&()]*)*")


def split_scripts(text):
    """Split mixed Arabic/Latin text into [(segment, is_latin)] so each piece can carry its own language.
    Office apps scramble Latin words (e.g. 'Q3 2026', '45M') inside runs tagged as Arabic."""
    if not has_arabic(text):
        return [(text, True)]
    out, pos = [], 0
    for m in _LATIN_SEG.finditer(text):
        if not re.search(r"[A-Za-z]", m.group()):
            continue  # plain numbers render fine inside Arabic runs
        if m.start() > pos:
            out.append((text[pos:m.start()], False))
        out.append((m.group(), True))
        pos = m.end()
    if pos < len(text):
        out.append((text[pos:], False))
    return out


def detect_rtl(values) -> bool:
    """True when any string in a (possibly nested) collection contains Arabic."""
    stack = [values]
    seen = 0
    while stack and seen < 5000:
        item = stack.pop()
        seen += 1
        if isinstance(item, str):
            if ARABIC_RE.search(item):
                return True
        elif isinstance(item, dict):
            stack.extend(item.keys())
            stack.extend(item.values())
        elif isinstance(item, (list, tuple, set)):
            stack.extend(item)
    return False


@dataclass(frozen=True)
class Theme:
    name: str
    primary: str  # titles, table headers, title slides
    secondary: str  # sub-headings, second chart series
    accent: str  # highlights, KPI accents, bullets
    dark: str  # body text
    muted: str  # captions, footers, labels
    light: str  # zebra rows, card backgrounds
    border: str  # table rules and card outlines
    series: tuple  # chart series colors, in order
    positive: str = "1E8E3E"
    negative: str = "C5221F"
    font: str = "Segoe UI"  # Latin text
    font_ar: str = "Segoe UI"  # Arabic (complex-script) text

    def color(self, i: int) -> str:
        return self.series[i % len(self.series)]


THEMES = {
    "corporate": Theme(
        "corporate", "1B365D", "3A6EA5", "E07A1F", "1F2933", "6B7785", "F2F5F9", "D5DCE4",
        ("1B365D", "3A6EA5", "E07A1F", "5FA8A0", "9A6FB0", "C9A227"),
    ),
    "emerald": Theme(
        "emerald", "0B5D4B", "178F72", "C8A04A", "1D2B27", "667A73", "EEF6F3", "CFE3DC",
        ("0B5D4B", "178F72", "C8A04A", "5B8DB8", "8E6C8A", "D07A4E"),
    ),
    "royal": Theme(
        "royal", "3B2A6B", "6A4FB3", "D4A017", "221B33", "6F6987", "F4F1FA", "DDD6EE",
        ("3B2A6B", "6A4FB3", "D4A017", "3F9C8F", "C0587E", "7F8C9D"),
    ),
    "ocean": Theme(
        "ocean", "0F4C5C", "1C7C8C", "F2A541", "17262B", "62777D", "EEF6F7", "CFE2E6",
        ("0F4C5C", "1C7C8C", "F2A541", "E26D5C", "6C8EBF", "9BC53D"),
    ),
    "slate": Theme(
        "slate", "2F3B48", "5A6B7D", "E4572E", "1E252D", "6E7781", "F3F4F6", "D9DDE3",
        ("2F3B48", "E4572E", "5A6B7D", "17BEBB", "FFC914", "76B041"),
    ),
    "maroon": Theme(
        "maroon", "7A1F2B", "A63A46", "2F6F8F", "2B1B1E", "7A6A6D", "FAF1F2", "EBD3D6",
        ("7A1F2B", "2F6F8F", "C9A227", "A63A46", "5E8C61", "8C6E9E"),
    ),
}


def get_theme(theme="corporate", **overrides) -> Theme:
    """Return a Theme by name (or pass one through) with optional field overrides,
    e.g. get_theme("emerald", font_ar="Dubai", primary="004D40")."""
    if isinstance(theme, Theme):
        base = theme
    else:
        key = (theme or "corporate").lower()
        if key not in THEMES:
            raise ValueError(f"Unknown theme {theme!r}; choose one of {', '.join(THEMES)}")
        base = THEMES[key]
    overrides = {k: (v.lstrip("#") if isinstance(v, str) and k not in ("name", "font", "font_ar") else v)
                 for k, v in overrides.items() if v is not None}
    return replace(base, **overrides) if overrides else base


def rgb(hex_color: str) -> tuple:
    h = hex_color.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def tint(hex_color: str, amount: float) -> str:
    """Mix a color with white; amount 0 keeps it, 1 gives white."""
    r, g, b = rgb(hex_color)
    mix = lambda c: round(c + (255 - c) * amount)
    return f"{mix(r):02X}{mix(g):02X}{mix(b):02X}"


# ---------------------------------------------------------------- numbers

CURRENCIES = {
    "SAR": "ر.س", "AED": "د.إ", "KWD": "د.ك", "QAR": "ر.ق", "BHD": "د.ب", "OMR": "ر.ع",
    "EGP": "ج.م", "JOD": "د.أ", "YER": "ر.ي", "IQD": "د.ع", "MAD": "د.م", "LYD": "د.ل",
    "USD": "$", "EUR": "€", "GBP": "£",
}

FORMAT_KINDS = ("text", "int", "number", "currency", "percent", "date", "datetime")


def currency_symbol(currency) -> str:
    if not currency:
        return ""
    return CURRENCIES.get(str(currency).upper(), str(currency))


def guess_kind(values, header: str = "") -> str:
    """Pick a format kind for a column from its values (and a hint in its header)."""
    sample = [v for v in values if v is not None and v != ""][:200]
    if not sample:
        return "text"
    if all(isinstance(v, datetime) for v in sample):
        return "datetime"
    if all(isinstance(v, (date, datetime)) for v in sample):
        return "date"
    if all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in sample):
        h = (header or "").lower()
        if any(k in h for k in ("%", "نسبة", "percent", "rate", "معدل", "share", "حصة")) and all(
            -1.5 <= v <= 1.5 for v in sample
        ):
            return "percent"
        if any(k in h for k in ("مبلغ", "قيمة", "سعر", "تكلفة", "إيراد", "ايراد", "مبيعات", "ربح", "راتب",
                                "amount", "price", "cost", "revenue", "sales", "profit", "salary", "budget",
                                "ميزانية", "إجمالي", "اجمالي", "total")):
            return "currency"
        if all(float(v).is_integer() for v in sample):
            return "int"
        return "number"
    return "text"


def format_value(value, kind: str = "text", currency=None, decimals: int | None = None) -> str:
    """Render a value as display text (used for Word and PowerPoint tables)."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    if kind in ("int", "number", "currency", "percent") and isinstance(value, (int, float)):
        if kind == "percent":
            d = 1 if decimals is None else decimals
            return f"{value * 100:,.{d}f}%"
        if kind == "int":
            return f"{value:,.0f}"
        d = 2 if decimals is None else decimals
        if kind == "number" and float(value).is_integer() and decimals is None:
            d = 0
        text = f"{value:,.{d}f}"
        sym = currency_symbol(currency) if kind == "currency" else ""
        if sym in ("$", "€", "£"):
            return f"-{sym}{text[1:]}" if text.startswith("-") else f"{sym}{text}"
        return f"{text} {sym}".strip()
    if isinstance(value, datetime) and kind != "date":
        return value.strftime("%Y-%m-%d %H:%M")
    if isinstance(value, (date, datetime)):
        return value.strftime("%Y-%m-%d")
    return str(value)


def compact_number(value, currency=None) -> str:
    """1250000 -> '1.25M', handy for KPI cards."""
    if not isinstance(value, (int, float)):
        return str(value)
    sign = "-" if value < 0 else ""
    v = abs(value)
    for limit, suffix in ((1e9, "B"), (1e6, "M"), (1e3, "K")):
        if v >= limit:
            text = f"{v / limit:.2f}".rstrip("0").rstrip(".") + suffix
            break
    else:
        text = f"{v:,.0f}" if float(v).is_integer() else f"{v:,.2f}"
    sym = currency_symbol(currency)
    if sym in ("$", "€", "£"):
        return f"{sign}{sym}{text}"
    return f"{sign}{text} {sym}".strip()


def kpi_item(item):
    """Normalize a KPI to a dict. Tuples are (label, value[, kind][, delta]) — a string third element is the
    kind ('int', 'number', 'currency', 'percent'), a number is the delta (0.12 = +12%)."""
    if isinstance(item, dict):
        d = dict(item)
    else:
        item = list(item)
        d = {"label": item[0], "value": item[1] if len(item) > 1 else ""}
        for extra in item[2:]:
            if isinstance(extra, str) and "kind" not in d:
                d["kind"] = extra
            elif isinstance(extra, (int, float)) and "delta" not in d:
                d["delta"] = extra
    d.setdefault("kind", None)
    d.setdefault("delta", None)
    return d


# ---------------------------------------------------------------- tabular input


def normalize_table(data, columns=None):
    """Accept a pandas DataFrame, a list of dicts, or a list of rows; return (columns, rows)."""
    if hasattr(data, "to_dict") and hasattr(data, "columns"):  # pandas DataFrame
        cols = [str(c) for c in data.columns]
        rows = []
        for rec in data.itertuples(index=False, name=None):
            rows.append([_clean(v) for v in rec])
        return (list(columns) if columns else cols), rows
    data = list(data or [])
    if data and isinstance(data[0], dict):
        cols = list(columns) if columns else list(dict.fromkeys(k for row in data for k in row))
        return cols, [[_clean(row.get(c)) for c in cols] for row in data]
    if columns is None:
        if not data:
            return [], []
        return [str(c) for c in data[0]], [[_clean(v) for v in row] for row in data[1:]]
    return list(columns), [[_clean(v) for v in row] for row in data]


def _clean(v):
    if v is None:
        return None
    if hasattr(v, "item") and not isinstance(v, (str, bytes)):  # numpy scalar
        try:
            v = v.item()
        except Exception:
            pass
    if hasattr(v, "to_pydatetime"):  # pandas Timestamp
        v = v.to_pydatetime()
    if isinstance(v, float) and math.isnan(v):
        return None
    return v


# ---------------------------------------------------------------- Arabic shaping for images

# (isolated, final, initial, medial); None = the letter cannot join on that side.
_FORMS = {
    "ء": ("ﺀ", None, None, None),
    "آ": ("ﺁ", "ﺂ", None, None),
    "أ": ("ﺃ", "ﺄ", None, None),
    "ؤ": ("ﺅ", "ﺆ", None, None),
    "إ": ("ﺇ", "ﺈ", None, None),
    "ئ": ("ﺉ", "ﺊ", "ﺋ", "ﺌ"),
    "ا": ("ﺍ", "ﺎ", None, None),
    "ب": ("ﺏ", "ﺐ", "ﺑ", "ﺒ"),
    "ة": ("ﺓ", "ﺔ", None, None),
    "ت": ("ﺕ", "ﺖ", "ﺗ", "ﺘ"),
    "ث": ("ﺙ", "ﺚ", "ﺛ", "ﺜ"),
    "ج": ("ﺝ", "ﺞ", "ﺟ", "ﺠ"),
    "ح": ("ﺡ", "ﺢ", "ﺣ", "ﺤ"),
    "خ": ("ﺥ", "ﺦ", "ﺧ", "ﺨ"),
    "د": ("ﺩ", "ﺪ", None, None),
    "ذ": ("ﺫ", "ﺬ", None, None),
    "ر": ("ﺭ", "ﺮ", None, None),
    "ز": ("ﺯ", "ﺰ", None, None),
    "س": ("ﺱ", "ﺲ", "ﺳ", "ﺴ"),
    "ش": ("ﺵ", "ﺶ", "ﺷ", "ﺸ"),
    "ص": ("ﺹ", "ﺺ", "ﺻ", "ﺼ"),
    "ض": ("ﺽ", "ﺾ", "ﺿ", "ﻀ"),
    "ط": ("ﻁ", "ﻂ", "ﻃ", "ﻄ"),
    "ظ": ("ﻅ", "ﻆ", "ﻇ", "ﻈ"),
    "ع": ("ﻉ", "ﻊ", "ﻋ", "ﻌ"),
    "غ": ("ﻍ", "ﻎ", "ﻏ", "ﻐ"),
    "ـ": ("ـ", "ـ", "ـ", "ـ"),
    "ف": ("ﻑ", "ﻒ", "ﻓ", "ﻔ"),
    "ق": ("ﻕ", "ﻖ", "ﻗ", "ﻘ"),
    "ك": ("ﻙ", "ﻚ", "ﻛ", "ﻜ"),
    "ل": ("ﻝ", "ﻞ", "ﻟ", "ﻠ"),
    "م": ("ﻡ", "ﻢ", "ﻣ", "ﻤ"),
    "ن": ("ﻥ", "ﻦ", "ﻧ", "ﻨ"),
    "ه": ("ﻩ", "ﻪ", "ﻫ", "ﻬ"),
    "و": ("ﻭ", "ﻮ", None, None),
    "ى": ("ﻯ", "ﻰ", None, None),
    "ي": ("ﻱ", "ﻲ", "ﻳ", "ﻴ"),
}
_LAM_ALEF = {"آ": ("ﻵ", "ﻶ"), "أ": ("ﻷ", "ﻸ"),
             "إ": ("ﻹ", "ﻺ"), "ا": ("ﻻ", "ﻼ")}
_HARAKAT = re.compile(r"[ً-ٰٟۖ-ۭ]")
_LTR_RUN = re.compile(r"[%$€£]?[A-Za-z0-9](?:[A-Za-z0-9.,:/_\-+% ]*[A-Za-z0-9%])?[$€£]?")
_MIRROR = str.maketrans("()[]{}<>", ")(][}{><")


def _joins_forward(ch) -> bool:
    forms = _FORMS.get(ch)
    return bool(forms and forms[2])


def _shape(text: str) -> str:
    chars = list(_HARAKAT.sub("", text))
    out, i, n = [], 0, len(chars)
    while i < n:
        ch = chars[i]
        forms = _FORMS.get(ch)
        if not forms:
            out.append(ch)
            i += 1
            continue
        prev = i > 0 and _joins_forward(chars[i - 1]) and forms[1] is not None
        if ch == "ل" and i + 1 < n and chars[i + 1] in _LAM_ALEF:
            out.append(_LAM_ALEF[chars[i + 1]][1 if prev else 0])
            i += 2
            continue
        nxt = i + 1 < n and forms[2] is not None and (_FORMS.get(chars[i + 1]) or (None, None))[1] is not None
        out.append(forms[3] if prev and nxt else forms[1] if prev else forms[2] if nxt else forms[0])
        i += 1
    return "".join(out)


def display_text(text) -> str:
    """Shape and visually reorder Arabic so it renders correctly in images (matplotlib, Pillow).
    Office files never need this — Word, Excel and PowerPoint shape Arabic themselves."""
    if not isinstance(text, str) or not has_arabic(text):
        return text
    lines = []
    for line in text.split("\n"):
        visual = _shape(line)[::-1].translate(_MIRROR)
        lines.append(_LTR_RUN.sub(lambda m: m.group(0)[::-1], visual))
    return "\n".join(lines)
