"""officekit — professional Word, Excel and PowerPoint files with full Arabic (RTL) support."""

import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of /mnt/data/skills (and out of the user's files)

from .theme import THEMES, compact_number, display_text, format_value, get_theme  # noqa: E402


def __getattr__(name):
    # Lazy imports so a missing optional library only affects the format that needs it.
    if name == "Workbook":
        from .excel import Workbook
        return Workbook
    if name == "Document":
        from .word import Document
        return Document
    if name == "Deck":
        from .slides import Deck
        return Deck
    if name == "chart_png":
        from .charts import chart_png
        return chart_png
    if name == "check":
        from .check import check
        return check
    raise AttributeError(name)


__all__ = ["Workbook", "Document", "Deck", "chart_png", "check", "THEMES", "get_theme", "format_value",
           "compact_number", "display_text"]
