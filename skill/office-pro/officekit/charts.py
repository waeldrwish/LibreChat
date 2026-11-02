"""Theme-styled chart images (PNG) for Word documents, with correct Arabic text."""

from __future__ import annotations

import os
import tempfile

from .theme import display_text, get_theme, has_arabic


def chart_png(kind, categories, series, path=None, title=None, theme="corporate", rtl=None,
              number_format=None, width_in=6.5, height_in=3.4, labels=None, dpi=200):
    """Render a chart to PNG and return its path.

    kind:   column | bar | line | area | pie | doughnut | stacked_column | stacked_bar
    series: {"Series name": [values...]} — one value per category.
    number_format: python format for labels/axis, e.g. "{:,.0f}", "{:.0%}"."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.ticker import FuncFormatter

    t = get_theme(theme)
    from matplotlib import ft2font

    # Matplotlib built with libraqm (3.11+) shapes and reorders Arabic itself.
    native_bidi = bool(getattr(ft2font, "__libraqm_version__", None))
    if rtl is None:
        rtl = has_arabic(title, *map(str, categories), *map(str, series))
    hexc = lambda h: f"#{h}"
    shown = (lambda s: str(s)) if native_bidi else (lambda s: display_text(str(s)))
    cats = [shown(c) for c in categories]
    names = list(series)
    peak = max((abs(v) for vals in series.values() for v in vals if isinstance(v, (int, float))), default=0)
    fmt = number_format or _auto_format(peak)
    tick = FuncFormatter(lambda v, _: _apply(fmt, v))

    plt.rcParams.update({"font.family": "DejaVu Sans", "axes.unicode_minus": False})
    fig, ax = plt.subplots(figsize=(width_in, height_in), dpi=dpi)
    fig.patch.set_facecolor("white")
    muted, dark, grid = hexc(t.muted), hexc(t.dark), "#E6E9EE"

    if kind in ("pie", "doughnut"):
        vals = series[names[0]]
        wedges, _texts, autotexts = ax.pie(
            vals, labels=None, colors=[hexc(t.color(i)) for i in range(len(vals))], startangle=90,
            counterclock=not rtl, autopct=lambda p: f"{p:.0f}%" if p >= 4 else "", pctdistance=0.78 if kind == "doughnut" else 0.65,
            wedgeprops={"linewidth": 1.5, "edgecolor": "white", **({"width": 0.42} if kind == "doughnut" else {})},
            textprops={"color": "white", "fontsize": 9, "fontweight": "bold"},
        )
        ax.axis("equal")
        ax.legend(wedges, cats, loc="center left" if not rtl else "center right",
                  bbox_to_anchor=(1.0, 0.5) if not rtl else (0.0, 0.5), frameon=False, fontsize=9,
                  labelcolor=dark)
    else:
        import numpy as np

        n, k = len(cats), len(names)
        x = np.arange(n)
        order = x[::-1] if rtl and kind not in ("bar", "stacked_bar") else x
        horizontal = kind in ("bar", "stacked_bar")
        stacked = kind.startswith("stacked")
        width = 0.75 / (1 if stacked else k)
        bottom = np.zeros(n)
        for i, name in enumerate(names):
            vals = np.array([v if isinstance(v, (int, float)) else 0 for v in series[name]], dtype=float)
            color = hexc(t.color(i))
            label = shown(name)
            if kind in ("line", "area"):
                ax.plot(order, vals, color=color, linewidth=2.4, marker="o", markersize=5,
                        markeredgecolor="white", label=label)
                if kind == "area":
                    ax.fill_between(order, vals, alpha=0.18, color=color)
                continue
            pos = order if stacked else order + (i - (k - 1) / 2) * width * (-1 if rtl and not horizontal else 1)
            if horizontal:
                bars = ax.barh(pos, vals, height=width, left=bottom if stacked else None, color=color, label=label)
            else:
                bars = ax.bar(pos, vals, width=width, bottom=bottom if stacked else None, color=color, label=label)
            if (labels if labels is not None else (k == 1 and n <= 12)) and not stacked:
                ax.bar_label(bars, labels=[_apply(fmt, v) for v in vals], padding=3, fontsize=8, color=dark)
            if stacked:
                bottom = bottom + vals
        if horizontal:
            ax.set_yticks(x, cats)
            ax.invert_yaxis()
            if rtl:
                ax.invert_xaxis()
                ax.yaxis.tick_right()
            ax.xaxis.set_major_formatter(tick)
            ax.grid(axis="x", color=grid, linewidth=0.8)
        else:
            ax.set_xticks(order, cats)
            if rtl:
                ax.yaxis.tick_right()
            ax.yaxis.set_major_formatter(tick)
            ax.grid(axis="y", color=grid, linewidth=0.8)
        ax.set_axisbelow(True)
        for side in ("top", "right", "left"):
            ax.spines[side].set_visible(False)
        ax.spines["bottom"].set_color("#C9CED6")
        ax.tick_params(colors=muted, labelsize=9, length=0)
        if k > 1:
            ax.legend(frameon=False, fontsize=9, labelcolor=dark, loc="upper center",
                      bbox_to_anchor=(0.5, -0.12), ncol=min(k, 4))
    if title:
        ax.set_title(shown(title), fontsize=12, fontweight="bold", color=dark, pad=12,
                     loc="center" if kind in ("pie", "doughnut") else "right" if rtl else "left")
    fig.tight_layout()
    if path is None:
        fd, path = tempfile.mkstemp(suffix=".png", prefix="chart_", dir=_scratch_dir())
        os.close(fd)
    fig.savefig(path, dpi=dpi, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return path


def _scratch_dir():
    d = os.path.join(tempfile.gettempdir(), "officekit")
    os.makedirs(d, exist_ok=True)
    return d


def _auto_format(peak):
    if peak >= 1e6:
        return "M"
    if peak >= 1e4:
        return "K"
    return "{:,.0f}" if peak >= 100 else "{:,.1f}"


def _apply(fmt, v):
    if fmt == "M":
        return f"{v / 1e6:,.1f}M"
    if fmt == "K":
        return f"{v / 1e3:,.0f}K"
    try:
        return fmt.format(v)
    except (ValueError, TypeError):
        return str(v)
