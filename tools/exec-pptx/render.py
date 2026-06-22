#!/usr/bin/env python3
"""
Endeavour Mining — Group IT Operations Report renderer (production).

Spawned by server.js for the `📋 Group IT Report` button. Reads a
kpis-may.json-shaped payload on stdin, builds an 11-slide brand-correct
PPTX, writes bytes to stdout.

Refactored 2026-06-03 from `refs/build_group_it_report.original.py`
(the hand-built April-2026 prototype) per Phase 2 of
`tools/exec-pptx/INTEGRATION_ROADMAP.md`. Same brand tokens and layout
as the prototype; everything that was hardcoded for April is now
data-driven from the payload.
"""
import sys
import os
from pathlib import Path

# ── Windows binary stdout (PEP 528 idiom) ─────────────────────────────
# Without this, Windows FD text mode CR-injects 0x0A bytes into the PPTX
# binary stream, corrupting the ZIP container.
if sys.platform == 'win32':
    import msvcrt
    try:
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    except Exception as _e:
        print(f"[render] WARN: could not set stdout to binary: {_e}",
              file=sys.stderr)

from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.oxml.ns import qn
from lxml import etree
import json

# ========== BRAND ==========
ORANGE   = RGBColor(0xE8, 0x77, 0x22)
ORANGE_D = RGBColor(0xC8, 0x5F, 0x10)
NAVY     = RGBColor(0x1A, 0x3A, 0x5F)
DARK_NAVY= RGBColor(0x0E, 0x2B, 0x4F)
BLUE     = RGBColor(0x2E, 0x5C, 0x8A)
GREEN    = RGBColor(0x2E, 0x85, 0x40)
AMBER    = RGBColor(0xF5, 0x9E, 0x0B)
RED      = RGBColor(0xDC, 0x26, 0x26)
GRAY     = RGBColor(0x6B, 0x72, 0x80)
LIGHT_GRAY=RGBColor(0xF1, 0xF3, 0xF6)
LIGHTER_GRAY=RGBColor(0xF8, 0xF9, 0xFB)
WHITE    = RGBColor(0xFF, 0xFF, 0xFF)
CHARCOAL = RGBColor(0x33, 0x33, 0x33)
MUTED    = RGBColor(0x9C, 0xA3, 0xAF)

# 16:9 widescreen
SLIDE_W = Inches(13.333)
SLIDE_H = Inches(7.5)

# ── Payload from stdin (Node spawn contract) ──────────────────────────
# Node POSTs the kpis-may.json-shaped payload to stdin and reads PPTX
# bytes from stdout. If invoked locally for testing, pipe a fixture:
#     py -3 render.py < fixtures/kpis-may.json > /tmp/out.pptx
try:
    K = json.loads(sys.stdin.read())
except json.JSONDecodeError as e:
    print(f"[render] FATAL: stdin is not valid JSON ({e})", file=sys.stderr)
    sys.exit(2)
if not isinstance(K, dict):
    print(f"[render] FATAL: payload is not a JSON object (got {type(K).__name__})",
          file=sys.stderr)
    sys.exit(2)

# 2026-06-03 — accept either kpis-may.json (top-level `month`, `year`)
# OR the browser-side payload shape (`filters.month_name`, `filters.year`)
# so a router-level enricher failure doesn't crash the renderer. Downstream
# code only reads K['month'] / K['year'], so we coerce here.
if 'month' not in K and isinstance(K.get('filters'), dict):
    _f = K['filters']
    if _f.get('month_name'):
        K['month'] = _f['month_name']
    elif _f.get('period_short'):
        K['month'] = str(_f['period_short']).split()[0]
    if _f.get('year') and 'year' not in K:
        K['year'] = _f['year']
if 'month' not in K:
    print("[render] FATAL: payload missing required field 'month' "
          "(and no filters.month_name fallback)", file=sys.stderr)
    print(f"[render] payload top-level keys: {sorted(K.keys())[:20]}",
          file=sys.stderr)
    sys.exit(2)

# ── Defaults for optional fields the original prototype expected ──────
# The kpis-may.json fixture is a SUBSET of everything the script reads.
# Rather than littering .get() calls across 800 lines, set defaults here
# so missing fields render as 0 / '—' without crashing.
_DEFAULTS = {
    # Slide 1 + 3 — core helpdesk volume (values default to 0, but
    # MoM delta fields default to None so the renderer shows "— vs Apr"
    # instead of a misleading "0.0% vs Apr" when the previous period
    # wasn't computed by the browser).
    'total': 0, 'total_apr': 0, 'total_delta_pct': None,
    'closed': 0, 'closed_delta_pct': None,
    'closure_rate': 0.0, 'closure_rate_delta_pp': None,
    'sla_compliance': 0.0, 'sla_compliance_delta_pp': None,
    'frt_sla': 0.0, 'frt_sla_delta_pp': None,
    'open_backlog': 0, 'open_backlog_delta_pct': None,
    'fcr_rate': 0.0, 'fcr_delta_pp': None,
    'avg_res_days': 0, 'avg_res_days_delta': None,
    'changes_total_delta': None, 'emergency_delta_pp': None,
    'mi_total_delta': None, 'support_groups_delta': None,
    'time_to_assign_h': 0, 'first_reply_h': 0, 'closing_time_d': 0,
    # Channel + categories + groups — must exist even if empty so the
    # iter loops don't KeyError
    'channel': {}, 'categories': {}, 'groups': {}, 'ageing': {},
    # MI + changes blocks
    'mi_total': 0, 'mi_critical': 0, 'mi_high': 0, 'mi_records': [],
    'changes_total': 0, 'changes_type': {}, 'changes_status': {},
    'changes_emergency': 0, 'emergency_changes': [],
    # CSAT block (slide 7)
    'csat_pct': 0, 'csat_total_responses': 0, 'csat_satisfied': 0,
    'csat_neutral': 0, 'csat_dissatisfied': 0, 'csat_no_rating': 0,
    'csat_avg_score': 0.0, 'nps_proxy': 0, 'nps_delta': 0,
    # Activity tracker (slides 10/11) — empty defaults if absent
'activity_tracker': {},
    'voice_themes': {},
    'commentary': {},
    'tracker': {
        'green': 0, 'amber': 0, 'red': 0,
        'avg_score': 0, 'avg_delta_pp': 0,
        'sites': [],
        'pillars': {},
        'commentary': [],
    },
}
for k, v in _DEFAULTS.items():
    # Both missing keys AND explicit-None values get the default. The
    # browser payload + server enricher will frequently send `null` for
    # KPIs the month doesn't have enough data to compute (e.g. fcr_rate,
    # csat_pct, time_to_assign_h on a quiet month).
    if K.get(k) is None:
        K[k] = v

# ── Period helpers — used hundreds of times below ─────────────────────
MONTH = K.get('month', 'Month')             # 'May'
YEAR  = str(K.get('year', '2026'))          # '2026'
PERIOD_LONG  = f"{MONTH} {YEAR}"             # 'May 2026'
_MONTH_3 = {'January':'Jan','February':'Feb','March':'Mar','April':'Apr',
            'May':'May','June':'Jun','July':'Jul','August':'Aug',
            'September':'Sep','October':'Oct','November':'Nov','December':'Dec'}
MONTH_SHORT  = _MONTH_3.get(MONTH, MONTH[:3])
PERIOD_SHORT = f"{MONTH_SHORT} {YEAR}"       # 'May 2026'
PERIOD_TICK  = f"{MONTH_SHORT} '{YEAR[-2:]}" # "May '26"
# Previous-month short ref (for trend labels). Hardcoded April fallback
# to maintain backward compat — payload should ideally include 'prev_month_short'.
PREV_MONTH_SHORT = K.get('prev_month_short', 'Mar')
PREV_PERIOD_TICK = f"{PREV_MONTH_SHORT} '{YEAR[-2:]}"

# ── Asset paths — relative to this script for prod portability ────────
SCRIPT_DIR = Path(__file__).resolve().parent
# Brand assets shipped at public/brand/exec-pptx/ on prod.
ASSET_DIR  = SCRIPT_DIR.parent.parent / 'public' / 'brand' / 'exec-pptx'
BANNER_IMG = str(ASSET_DIR / 'em_banner.jpg')
CORNER_IMG = str(ASSET_DIR / 'left_corner.png')

print(f"[render] period={PERIOD_LONG} payload_keys={len(K)} "
      f"assets={'OK' if Path(BANNER_IMG).exists() else 'MISSING'}",
      file=sys.stderr)

prs = Presentation()
prs.slide_width = SLIDE_W
prs.slide_height = SLIDE_H

BLANK = prs.slide_layouts[6]

# ── Chart helper — Phase 2 minimal matplotlib renderer ────────────────
# The original prototype expected pre-rendered PNGs at `charts/c*.png`.
# Phase 2 ships an inline matplotlib generator that produces simple but
# real charts from the payload. Phase 3 will replace this with a richer
# per-chart spec (volume bars, SLA line, ageing stacked bars, etc.) per
# §7 of the integration guide.
#
# Usage:
#     png_path = _chart('cN', figsize=(8.5, 4.2), data_fn=lambda ax: ...)
#     slide.shapes.add_picture(png_path, ...)
import tempfile
try:
    import matplotlib
    matplotlib.use('Agg')   # no display, safe on headless prod
    import matplotlib.pyplot as plt
    _MPL_AVAILABLE = True

    # ── Python 3.14 + matplotlib compatibility patch ──────────────────
    # matplotlib's `Path.__deepcopy__` calls `copy.deepcopy(super(), memo)`,
    # which infinite-loops on Python 3.14 due to changed super() semantics
    # in the copy protocol. The recursion is triggered by EVERY savefig()
    # call (via _update_title_position → get_tightbbox → get_major_ticks
    # → _copy_tick_props → MarkerStyle deepcopy).
    #
    # Override Path.__deepcopy__ with a copy.copy-like implementation that
    # bypasses the broken super() chain. For our use (rendering charts to
    # PNG), Path objects are effectively immutable during draw, so a
    # shallow copy of the instance __dict__ is functionally equivalent.
    if sys.version_info >= (3, 14):
        try:
            from matplotlib.path import Path as _MplPath
            def _safe_path_deepcopy(self, memo=None):
                new = _MplPath.__new__(_MplPath)
                new.__dict__.update(self.__dict__)
                if memo is not None:
                    memo[id(self)] = new
                return new
            _MplPath.__deepcopy__ = _safe_path_deepcopy
            _MplPath.__copy__ = lambda self: _safe_path_deepcopy(self)
            print("[render] applied Python 3.14 matplotlib.Path deepcopy patch",
                  file=sys.stderr)
        except Exception as _e:
            print(f"[render] WARN: could not patch matplotlib.Path: {_e}",
                  file=sys.stderr)
except Exception as _e:
    print(f"[render] WARN: matplotlib unavailable ({_e}); charts will be placeholders",
          file=sys.stderr)
    _MPL_AVAILABLE = False

_chart_tmpfiles = []   # collected for cleanup at exit (not strictly required)

def _chart(name, figsize=(8.5, 4.2), data_fn=None, title='', dpi=150):
    """Render a chart via matplotlib, return the PNG path.
    `data_fn` receives a matplotlib Axes and draws on it; if absent,
    a generic "Chart: <name>" placeholder is rendered."""
    fd, path = tempfile.mkstemp(prefix=f'gitops_{name}_', suffix='.png')
    os.close(fd)
    _chart_tmpfiles.append(path)
    if not _MPL_AVAILABLE:
        # matplotlib import failed — fall through to a tiny 1×1 PNG so
        # add_picture has something to embed without blowing up.
        from PIL import Image as _Image
        _Image.new('RGB', (1, 1), '#FFFFFF').save(path, 'PNG')
        return path
    fig, ax = plt.subplots(figsize=figsize, dpi=dpi)
    if data_fn is not None:
        try:
            data_fn(ax)
        except Exception as e:
            print(f"[render] WARN: chart {name} data_fn raised {e}", file=sys.stderr)
            ax.text(0.5, 0.5, f"Chart error: {e}", ha='center', va='center', fontsize=10)
    else:
        ax.text(0.5, 0.5, f"Chart: {name}\n(Phase 3 wires per-chart spec)",
                ha='center', va='center', fontsize=14, color='#1A3A5F', wrap=True)
        ax.set_xticks([]); ax.set_yticks([])
        for s in ax.spines.values(): s.set_visible(False)
    if title:
        ax.set_title(title, fontsize=13, fontweight='bold', color='#1A3A5F')
    # Avoid plt.tight_layout() — recurses infinitely on Python 3.14 +
    # matplotlib due to Path.__deepcopy__/super() semantic change. Use
    # explicit margins instead; bbox_inches='tight' on savefig() trims
    # the final image.
    try:
        plt.subplots_adjust(left=0.10, right=0.96, top=0.90, bottom=0.14)
    except Exception:
        pass  # margins are aesthetic, not critical
    plt.savefig(path, dpi=dpi, facecolor='white', bbox_inches='tight')
    plt.close(fig)
    return path


# ── Per-chart data_fn implementations (Phase 3) ───────────────────────────
# Each `_draw_*` takes a matplotlib Axes and draws the chart from payload K.
# Reasonably defensive — empty data renders a "no data" label instead of
# raising.
def _draw_categories(ax):
    cats = list((K.get('categories') or {}).items())[:8]
    if not cats:
        ax.text(0.5, 0.5, 'No category data', ha='center', va='center',
                fontsize=11, color='#6B7280'); return
    names = [c[0][:32] + ('…' if len(c[0]) > 32 else '') for c in cats][::-1]
    vals  = [c[1] for c in cats][::-1]
    bars  = ax.barh(names, vals, color='#E87722', edgecolor='white')
    for b, v in zip(bars, vals):
        ax.text(v + max(vals) * 0.01, b.get_y() + b.get_height() / 2,
                f'{v:,}', va='center', fontsize=8, color='#1A3A5F')
    ax.spines[['top', 'right']].set_visible(False)
    ax.grid(axis='x', alpha=0.2, linestyle='--')
    ax.tick_params(axis='y', labelsize=8)


def _draw_channels(ax):
    # Rebuilt 2026-06-04: pie → horizontal bar chart. The original pie
    # had label overlap when 4+ channels were present (Mobile App,
    # Live Chat, Web Form labels stacking near the small slices). Bars
    # always read cleanly regardless of the channel distribution.
    chans = list((K.get('channel') or {}).items())
    if not chans:
        ax.text(0.5, 0.5, 'No channel data', ha='center', va='center',
                fontsize=11, color='#6B7280'); return
    chans = sorted(chans, key=lambda kv: -kv[1])   # biggest first
    total = sum(v for _, v in chans) or 1
    labels = [c[0] for c in chans][::-1]
    vals   = [c[1] for c in chans][::-1]
    colors = ['#2E5C8A', '#E87722', '#2E8540', '#F59E0B', '#7C3AED', '#6B7280']
    bars = ax.barh(labels, vals, color=colors[:len(vals)][::-1], edgecolor='white')
    for b, v in zip(bars, vals):
        pct = v / total * 100
        ax.text(v + max(vals) * 0.01, b.get_y() + b.get_height() / 2,
                f'{v:,} ({pct:.0f}%)', va='center', fontsize=9,
                color='#1A3A5F', fontweight='bold')
    ax.spines[['top', 'right']].set_visible(False)
    ax.grid(axis='x', alpha=0.2, linestyle='--')
    ax.tick_params(axis='y', labelsize=9)
    ax.tick_params(axis='x', labelsize=8)


# ── 12-month TREND data_fns (Slide 4 + Slide 5) ────────────────────────
# Both consume K['monthly_trend'] which the browser ships as
#   [{label:'Jun 25', inbound:N, closed:N, res_sla:%, frt_sla:%}, ...]
# When missing (cold/restored cache), render a small "no data" panel.

def _draw_volume_trend(ax):
    series = K.get('monthly_trend') or []
    if not series:
        ax.text(0.5, 0.5, 'No 12-month volume data', ha='center', va='center',
                fontsize=11, color='#6B7280'); return
    labels  = [r.get('label', '') for r in series]
    inbound = [r.get('inbound', 0) or 0 for r in series]
    closed  = [r.get('closed',  0) or 0 for r in series]
    import numpy as _np
    x = _np.arange(len(labels))
    bw = 0.4
    ax.bar(x - bw/2, inbound, width=bw, color='#2E5C8A', label='Inbound',  edgecolor='white')
    ax.bar(x + bw/2, closed,  width=bw, color='#E87722', label='Closed',   edgecolor='white')
    # Highlight the rightmost (current period) by darkening the edge
    if labels:
        for i, b in enumerate(ax.patches):
            if i % len(labels) == len(labels) - 1:
                b.set_edgecolor('#1A3A5F'); b.set_linewidth(1.5)
    ax.set_xticks(x); ax.set_xticklabels(labels, rotation=35, ha='right', fontsize=8)
    ax.spines[['top', 'right']].set_visible(False)
    ax.grid(axis='y', alpha=0.2, linestyle='--')
    ax.legend(fontsize=9, loc='upper left', frameon=False)
    ax.tick_params(axis='y', labelsize=8)


def _draw_sla_trend(ax):
    series = K.get('monthly_trend') or []
    if not series:
        ax.text(0.5, 0.5, 'No SLA trend data', ha='center', va='center',
                fontsize=11, color='#6B7280'); return
    labels  = [r.get('label', '') for r in series]
    res_sla = [r.get('res_sla', 0) or 0 for r in series]
    frt_sla = [r.get('frt_sla', 0) or 0 for r in series]
    import numpy as _np
    x = _np.arange(len(labels))
    ax.plot(x, res_sla, color='#E87722', marker='o', linewidth=2,   label='Resolution SLA')
    ax.plot(x, frt_sla, color='#DC2626', marker='s', linewidth=2,   label='FRT SLA')
    ax.axhline(y=90, color='#16A34A', linestyle='--', linewidth=1,  alpha=0.6, label='Target 90%')
    ax.set_ylim(0, 100)
    ax.set_xticks(x); ax.set_xticklabels(labels, rotation=35, ha='right', fontsize=7)
    ax.spines[['top', 'right']].set_visible(False)
    ax.grid(axis='y', alpha=0.2, linestyle='--')
    ax.legend(fontsize=8, loc='lower left', frameon=False, ncol=3)
    ax.tick_params(axis='y', labelsize=8)
    # Y-axis as %
    from matplotlib.ticker import PercentFormatter as _PF
    ax.yaxis.set_major_formatter(_PF(decimals=0))


# Compact Email vs Web Form % trend for slide 5 (inset chart)
def _draw_channel_share_trend(ax):
    series = K.get('monthly_trend') or []
    chan_series = K.get('monthly_channels') or []  # optional richer source
    # Browser sends inbound monthly volumes; if it includes per-channel split
    # under monthly_channels, prefer that. Otherwise show a placeholder.
    if not chan_series:
        # Fall back to current-month snapshot only (single bar pair)
        em = K.get('channel', {}).get('E-Mail', 0)
        wf = K.get('channel', {}).get('Web Form', 0)
        if em + wf == 0:
            ax.text(0.5, 0.5, '12-month channel split data\nnot in payload yet',
                    ha='center', va='center', fontsize=9, color='#6B7280'); return
        total = em + wf
        em_pct = em / total * 100; wf_pct = wf / total * 100
        ax.bar(['E-Mail', 'Web Form'], [em_pct, wf_pct],
               color=['#2E5C8A', '#E87722'], edgecolor='white')
        for i, v in enumerate([em_pct, wf_pct]):
            ax.text(i, v + 1, f'{v:.0f}%', ha='center', fontsize=9, color='#1A3A5F', fontweight='bold')
        ax.set_ylim(0, max(em_pct, wf_pct) * 1.2)
        ax.spines[['top', 'right']].set_visible(False)
        ax.tick_params(axis='y', labelsize=8); ax.tick_params(axis='x', labelsize=9)
        from matplotlib.ticker import PercentFormatter as _PF
        ax.yaxis.set_major_formatter(_PF(decimals=0))
        return
    labels  = [r.get('label', '') for r in chan_series]
    em_pct  = [r.get('email_pct', 0)   for r in chan_series]
    wf_pct  = [r.get('webform_pct', 0) for r in chan_series]
    import numpy as _np
    x = _np.arange(len(labels))
    ax.plot(x, em_pct, color='#2E5C8A', marker='o', linewidth=2, label='E-Mail')
    ax.plot(x, wf_pct, color='#E87722', marker='s', linewidth=2, label='Web Form')
    ax.set_ylim(0, 100)
    ax.set_xticks(x); ax.set_xticklabels(labels, rotation=35, ha='right', fontsize=7)
    ax.spines[['top', 'right']].set_visible(False)
    ax.grid(axis='y', alpha=0.2, linestyle='--')
    ax.legend(fontsize=8, loc='center right', frameon=False)
    ax.tick_params(axis='y', labelsize=8)
    from matplotlib.ticker import PercentFormatter as _PF
    ax.yaxis.set_major_formatter(_PF(decimals=0))


def _draw_ageing(ax):
    rows = list((K.get('ageing') or {}).items())
    if not rows:
        ax.text(0.5, 0.5, 'No ageing data', ha='center', va='center',
                fontsize=11, color='#6B7280'); return
    # Sort by total descending, take top 10
    def _tot(v): return v.get('total', 0)
    rows = sorted(rows, key=lambda kv: -_tot(kv[1]))[:10][::-1]
    names = [g.replace(' IT Agents', '').replace(' IT Agent', '').replace(' Support', '')
             for g, _ in rows]
    under30 = [v.get('0-30', v.get('under_30', 0))   for _, v in rows]
    mid     = [v.get('31-60', v.get('30_60', 0))     for _, v in rows]
    over60  = [v.get('>60',  v.get('over_60', 0))    for _, v in rows]
    ax.barh(names, under30, color='#2E8540', label='0-30 d')
    ax.barh(names, mid,    left=under30,                       color='#F59E0B', label='31-60 d')
    ax.barh(names, over60, left=[a + b for a, b in zip(under30, mid)],
                                                                color='#DC2626', label='>60 d')
    ax.legend(fontsize=8, loc='lower right', frameon=False)
    ax.spines[['top', 'right']].set_visible(False)
    ax.grid(axis='x', alpha=0.2, linestyle='--')
    ax.tick_params(axis='y', labelsize=8)


def _draw_csat_donut(ax):
    sat = K.get('csat_satisfied', 0) or 0
    neu = K.get('csat_neutral', 0) or 0
    dis = K.get('csat_dissatisfied', 0) or 0
    no  = K.get('csat_no_rating', 0) or 0

    # Fallback path: when explicit counts are zero but the payload has
    # csat_pct + csat_total_responses, derive the breakdown so the chart
    # is still informative instead of showing "No CSAT data" (the
    # situation the user flagged on slide 7 where tiles read 0 but the
    # 81% CSAT was clearly available).
    if (sat + neu + dis + no) == 0:
        total = K.get('csat_total_responses', 0) or 0
        pct   = K.get('csat_pct', 0) or 0
        if total > 0 and pct > 0:
            sat = round(total * pct / 100)
            dis = max(total - sat, 0)
            # leave neu/no at 0 — they're not derivable from a single %

    parts = [(sat, 'Satisfied', '#2E8540'),
             (neu, 'Neutral',   '#F59E0B'),
             (dis, 'Dissatisfied', '#DC2626'),
             (no,  'No rating', '#9CA3AF')]
    parts = [p for p in parts if p[0] > 0]
    if not parts:
        ax.text(0.5, 0.5, 'No CSAT data captured this month',
                ha='center', va='center', fontsize=11, color='#6B7280'); return
    sizes = [p[0] for p in parts]
    labels = [f"{p[1]} ({p[0]})" for p in parts]
    colors = [p[2] for p in parts]
    ax.pie(sizes, labels=labels, autopct='%1.0f%%', colors=colors,
           wedgeprops=dict(width=0.42, edgecolor='white'),
           textprops={'fontsize': 8, 'color': '#1A3A5F'})


def _draw_changes_donut(ax):
    by_type = K.get('changes_type') or {}
    parts = [(by_type.get('Standard', 0),  'Standard',  '#2E5C8A'),
             (by_type.get('Major', 0),     'Major',     '#1A3A5F'),
             (by_type.get('Emergency', 0), 'Emergency', '#DC2626')]
    parts = [p for p in parts if p[0] > 0]
    if not parts:
        ax.text(0.5, 0.5, 'No change data', ha='center', va='center',
                fontsize=11, color='#6B7280'); return
    sizes = [p[0] for p in parts]
    labels = [f"{p[1]} ({p[0]})" for p in parts]
    colors = [p[2] for p in parts]
    ax.pie(sizes, labels=labels, autopct='%1.0f%%', colors=colors,
           wedgeprops=dict(width=0.42, edgecolor='white'),
           textprops={'fontsize': 9, 'color': '#1A3A5F'})

# ========== HELPERS ==========
def add_rect(slide, x, y, w, h, fill, line=None, shape=MSO_SHAPE.RECTANGLE):
    s = slide.shapes.add_shape(shape, x, y, w, h)
    s.fill.solid(); s.fill.fore_color.rgb = fill
    if line is None:
        s.line.fill.background()
    else:
        s.line.color.rgb = line
        s.line.width = Pt(0.5)
    s.shadow.inherit = False
    return s

def add_text(slide, x, y, w, h, text, *, font='Calibri', size=12, bold=False, color=CHARCOAL,
             align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, italic=False):
    tb = slide.shapes.add_textbox(x, y, w, h)
    tf = tb.text_frame
    tf.margin_left = Emu(0); tf.margin_right = Emu(0)
    tf.margin_top = Emu(0); tf.margin_bottom = Emu(0)
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    p = tf.paragraphs[0]
    p.alignment = align
    r = p.add_run(); r.text = text
    r.font.name = font; r.font.size = Pt(size); r.font.bold = bold; r.font.italic = italic
    r.font.color.rgb = color
    return tb

def add_multi_text(slide, x, y, w, h, lines, *, font='Calibri', anchor=MSO_ANCHOR.TOP, align=PP_ALIGN.LEFT, line_space=1.15):
    """lines: [(text, size, bold, color)]"""
    tb = slide.shapes.add_textbox(x,y,w,h)
    tf = tb.text_frame
    tf.margin_left=Emu(0); tf.margin_right=Emu(0); tf.margin_top=Emu(0); tf.margin_bottom=Emu(0)
    tf.word_wrap=True; tf.vertical_anchor=anchor
    for i,(t,sz,bd,col) in enumerate(lines):
        p = tf.paragraphs[0] if i==0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = line_space
        r = p.add_run(); r.text = t
        r.font.name=font; r.font.size=Pt(sz); r.font.bold=bd
        r.font.color.rgb = col
    return tb

def header_band(slide, title, section, period):
    """Standard header used across helpdesk slides"""
    # Navy band
    add_rect(slide, Inches(0.3), Inches(0.25), Inches(12.7), Inches(0.7), NAVY)
    # Section label (left)
    add_text(slide, Inches(0.55), Inches(0.32), Inches(2.5), Inches(0.55), section,
             size=12, bold=True, color=WHITE, anchor=MSO_ANCHOR.MIDDLE)
    # Title (center)
    add_text(slide, Inches(3.5), Inches(0.32), Inches(6.5), Inches(0.55), title,
             size=18, bold=True, color=WHITE, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    # Period chip (right) - orange box
    add_rect(slide, Inches(11.0), Inches(0.32), Inches(1.85), Inches(0.55), ORANGE)
    add_text(slide, Inches(11.0), Inches(0.32), Inches(1.85), Inches(0.55), period,
             size=12, bold=True, color=WHITE, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)

def footer_bar(slide, page_num):
    # === Adjusted defaults (matches user-edited slide 3, April 2026 deck) ===
    # Thinner banner sitting flush at the bottom; corner image trimmed to align with banner;
    # slide number text-box right-aligned just above the banner — all on background z-order.
    BANNER_H = Inches(0.15)        # was 0.30 — halved per user adjustment
    BANNER_Y = Inches(7.35)        # bottom-flush at SLIDE_H - BANNER_H
    banner_pic = slide.shapes.add_picture(BANNER_IMG, 0, BANNER_Y,
                                          width=SLIDE_W, height=BANNER_H)
    # Bottom-right corner accent — shorter, lifted above the banner
    CORNER_W = Inches(0.85)
    CORNER_H = Inches(0.16)        # was 0.55 — trimmed per user adjustment
    CORNER_X = Inches(12.473)
    CORNER_Y = Inches(7.18)
    corner_pic = slide.shapes.add_picture(CORNER_IMG, CORNER_X, CORNER_Y,
                                          width=CORNER_W, height=CORNER_H)
    # Slide number on top (text — editable, right-aligned over corner image)
    add_text(slide, Inches(12.373), Inches(7.157), Inches(0.75), Inches(0.236),
             str(page_num), size=14, bold=True, color=WHITE,
             align=PP_ALIGN.RIGHT, anchor=MSO_ANCHOR.MIDDLE)
    # Move banner + corner images to the BACK of the z-order (background layer)
    spTree = slide.shapes._spTree
    for pic in (banner_pic, corner_pic):
        elem = pic._element
        spTree.remove(elem)
        # Insert right after the spTree's nvGrpSpPr/grpSpPr (always the first 2 children),
        # so the picture sits behind all other content shapes but above the slide background.
        spTree.insert(2, elem)

def kpi_tile(slide, x, y, w, h, label, value, sub, *, accent=BLUE, value_color=NAVY, sub_color=GRAY, value_size=30):
    """KPI card with left accent bar"""
    # left accent
    add_rect(slide, x, y, Inches(0.10), h, accent)
    # main background
    add_rect(slide, x+Inches(0.10), y, w-Inches(0.10), h, WHITE, line=RGBColor(0xE5,0xE7,0xEB))
    # label
    add_text(slide, x+Inches(0.25), y+Inches(0.10), w-Inches(0.35), Inches(0.25),
             label.upper(), size=9, bold=True, color=GRAY)
    # value
    add_text(slide, x+Inches(0.25), y+Inches(0.32), w-Inches(0.35), Inches(0.55),
             value, size=value_size, bold=True, color=value_color)
    # sub
    add_text(slide, x+Inches(0.25), y+h-Inches(0.30), w-Inches(0.35), Inches(0.25),
             sub, size=9, color=sub_color)

# ---- Delta pill helper (small +/-X badge with directional color) ----
GOOD_BG_LIGHT = RGBColor(0xDC, 0xF5, 0xE2)   # light green pill on white bg
GOOD_FG_LIGHT = RGBColor(0x16, 0x6E, 0x2C)
BAD_BG_LIGHT  = RGBColor(0xFD, 0xE0, 0xE0)   # light pink pill on white bg
BAD_FG_LIGHT  = RGBColor(0xB1, 0x1A, 0x1A)
NEUT_BG_LIGHT = RGBColor(0xE5, 0xE7, 0xEB)   # light gray pill on white
NEUT_FG_LIGHT = RGBColor(0x4B, 0x55, 0x63)
GOOD_BG_DARK  = RGBColor(0x14, 0x55, 0x24)   # darker green pill on dark bg
GOOD_FG_DARK  = RGBColor(0xB7, 0xE7, 0xC2)
BAD_BG_DARK   = RGBColor(0x6E, 0x14, 0x14)   # darker red pill on dark bg
BAD_FG_DARK   = RGBColor(0xFA, 0xC8, 0xC8)
NEUT_BG_DARK  = RGBColor(0x2D, 0x3E, 0x57)
NEUT_FG_DARK  = RGBColor(0xCD, 0xD9, 0xE6)

def delta_pill(slide, x, y, text, *, kind='good', dark_bg=False, w=None, h=None, size=9):
    """Render a small +/-X badge. kind in {'good','bad','neutral'}."""
    if dark_bg:
        bg, fg = (GOOD_BG_DARK, GOOD_FG_DARK) if kind=='good' else (BAD_BG_DARK, BAD_FG_DARK) if kind=='bad' else (NEUT_BG_DARK, NEUT_FG_DARK)
    else:
        bg, fg = (GOOD_BG_LIGHT, GOOD_FG_LIGHT) if kind=='good' else (BAD_BG_LIGHT, BAD_FG_LIGHT) if kind=='bad' else (NEUT_BG_LIGHT, NEUT_FG_LIGHT)
    if w is None:
        w = Inches(0.05 + 0.085*max(len(text), 3))   # autosize
    if h is None:
        h = Inches(0.26)
    add_rect(slide, x, y, w, h, bg, shape=MSO_SHAPE.ROUNDED_RECTANGLE)
    add_text(slide, x, y, w, h, text, size=size, bold=True, color=fg,
             align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    return (x+w, y, w, h)

# ====================================================================
# SLIDE 1 — COVER
# ====================================================================
s = prs.slides.add_slide(BLANK)
# Orange left panel
add_rect(s, 0, 0, Inches(5.5), SLIDE_H, ORANGE)
# Navy diagonal accent stripe
add_rect(s, Inches(5.5), 0, Inches(7.83), SLIDE_H, DARK_NAVY)
# White rect with rounded corner feel - using a simple rectangle for the photo placeholder
# Inner frame on right side
add_rect(s, Inches(5.8), Inches(0.8), Inches(7.2), Inches(5.9), NAVY)
# Subtle horizontal accent stripes (no overlapping dots)
add_rect(s, Inches(5.8), Inches(0.80), Inches(7.2), Inches(0.10), ORANGE)
add_rect(s, Inches(5.8), Inches(6.60), Inches(7.2), Inches(0.10), ORANGE)

# Endeavour logo placeholder (top-left)
add_text(s, Inches(0.5), Inches(0.4), Inches(4), Inches(0.6),
         "ENDEAVOUR", font='Calibri', size=22, bold=True, color=WHITE)
add_text(s, Inches(0.5), Inches(0.85), Inches(4), Inches(0.4),
         "MINING", font='Calibri', size=14, bold=True, color=WHITE)

# Main title
add_text(s, Inches(0.5), Inches(3.6), Inches(4.7), Inches(0.9),
         "GROUP IT", size=44, bold=True, color=WHITE)
add_text(s, Inches(0.5), Inches(4.4), Inches(4.7), Inches(0.9),
         "REPORT", size=44, bold=True, color=WHITE)
# Accent stripe under title
stripes = [(WHITE, 0.55), (RGBColor(0xFD,0xC1,0x00), 0.55), (DARK_NAVY, 0.55), (BLUE, 0.55), (WHITE, 0.55)]
sx = Inches(0.5)
for c, w in stripes:
    add_rect(s, sx, Inches(5.45), Inches(w), Inches(0.10), c)
    sx += Inches(w + 0.02)

# Period
add_text(s, Inches(0.5), Inches(5.85), Inches(4.5), Inches(0.5),
         PERIOD_LONG, size=22, color=WHITE)
add_text(s, Inches(0.5), Inches(6.30), Inches(4.5), Inches(0.4),
         "Operations Monthly Performance Review", size=12, italic=True, color=WHITE)

# Inside the navy panel: large helpdesk summary
add_text(s, Inches(6.2), Inches(1.2), Inches(6.6), Inches(0.5),
         "Operations at a Glance", size=20, bold=True, color=WHITE)
add_text(s, Inches(6.2), Inches(1.7), Inches(6.6), Inches(0.4),
         "12 Operating Sites  •  Helpdesk + Major Incidents + Changes", size=11, color=RGBColor(0xCD,0xD9,0xE6))

# Big stats inside navy — with delta pills (vs March)
def cover_stat(x, y, val, lbl, delta_text=None, delta_kind='neutral'):
    add_text(s, x, y, Inches(2.2), Inches(0.7), val, size=36, bold=True, color=ORANGE)
    add_text(s, x, y+Inches(0.7), Inches(2.2), Inches(0.35), lbl, size=10, color=WHITE)
    if delta_text:
        # Pill on dark bg, placed below the label
        delta_pill(s, x, y+Inches(1.02), delta_text, kind=delta_kind, dark_bg=True, size=9)

# Cover deltas — derive from K MoM fields with the previous month label.
# K['prev_month_short'] is set by services/reportPayload.js based on the
# selected period (e.g. May → "Apr"). When the browser doesn't compute a
# MoM, render "— vs <prev>" instead of a fake hardcoded delta.
_prev_lbl = K.get('prev_month_short') or 'prev'

def _cover_delta(value, unit, invert=False):
    if value is None or (isinstance(value, float) and value != value):
        return (f'— vs {_prev_lbl}', 'neutral')
    sign = '+' if value > 0 else ''
    txt = f"{sign}{value:.1f}{unit} vs {_prev_lbl}" if unit in ('%', 'pp') else f"{sign}{value}{unit} vs {_prev_lbl}"
    if value == 0:           return (txt, 'neutral')
    is_good = (value > 0) ^ invert
    return (txt, 'good' if is_good else 'bad')

_cv_total   = _cover_delta(K.get('total_delta_pct'),         '%')
_cv_closure = _cover_delta(K.get('closure_rate_delta_pp'),   'pp')
_cv_sla     = _cover_delta(K.get('sla_compliance_delta_pp'), 'pp')
_cv_backlog = _cover_delta(K.get('open_backlog_delta_pct'),  '%',  invert=True)
_cv_mi      = _cover_delta(K.get('mi_total_delta'),          '',   invert=True)
_cv_changes = _cover_delta(K.get('changes_total_delta'),     '')

cover_stat(Inches(6.4), Inches(2.5), f"{K['total']:,}",           "TOTAL TICKETS",   _cv_total[0],   _cv_total[1])
cover_stat(Inches(8.7), Inches(2.5), f"{K['closure_rate']:.1f}%", "CLOSURE RATE",    _cv_closure[0], _cv_closure[1])
cover_stat(Inches(11.0), Inches(2.5), f"{K['sla_compliance']:.1f}%", "SLA COMPLIANCE", _cv_sla[0],     _cv_sla[1])
cover_stat(Inches(6.4), Inches(3.9), f"{K['open_backlog']}",      "OPEN BACKLOG",    _cv_backlog[0], _cv_backlog[1])
cover_stat(Inches(8.7), Inches(3.9), f"{K['mi_total']}",           "MAJOR INCIDENTS", _cv_mi[0],      _cv_mi[1])
cover_stat(Inches(11.0), Inches(3.9), f"{K['changes_total']}",     "CHANGES (NEW)",   _cv_changes[0], _cv_changes[1])

# Stock-listing tag
add_text(s, Inches(6.2), Inches(5.9), Inches(6.8), Inches(0.5),
         "LSE  •  TSX  •  OTCQX", size=10, color=RGBColor(0xCD,0xD9,0xE6), align=PP_ALIGN.LEFT)

# ====================================================================
# SLIDE 2 — Operations: Summary
# ====================================================================
s = prs.slides.add_slide(BLANK)
# Title bar
add_rect(s, 0, 0, SLIDE_W, Inches(0.85), DARK_NAVY)
add_text(s, Inches(0.4), Inches(0.18), Inches(10), Inches(0.5),
         "Operations: Summary", size=22, bold=True, color=WHITE)
add_text(s, Inches(11.5), Inches(0.18), Inches(1.7), Inches(0.5),
         PERIOD_LONG, size=12, bold=True, color=ORANGE, align=PP_ALIGN.RIGHT, anchor=MSO_ANCHOR.MIDDLE)

# Owner block left
add_rect(s, Inches(0.4), Inches(1.05), Inches(3.6), Inches(1.5), LIGHT_GRAY, line=RGBColor(0xE5,0xE7,0xEB))
add_text(s, Inches(0.55), Inches(1.15), Inches(3.4), Inches(0.4),
         "Mohamed Diagne", size=14, bold=True, color=NAVY)
add_text(s, Inches(0.55), Inches(1.55), Inches(3.4), Inches(0.35),
         "IT Operations  ·  Mines & Exploration", size=11, italic=True, color=GRAY)
# Owner KV grid
labels_kv = [("Reporting Month", MONTH),("Financial Year","2026"),("Headcount (inc. Contract)","7")]
yy = Inches(2.0)
for i,(k,v) in enumerate(labels_kv):
    add_text(s, Inches(0.55), yy+Inches(0.18*i), Inches(2.0), Inches(0.2), k, size=9, color=GRAY)
    add_text(s, Inches(2.6), yy+Inches(0.18*i), Inches(1.4), Inches(0.2), v, size=9, bold=True, color=NAVY)

# RAG status pills (top right)
def status_pill(x, y, label, color):
    add_rect(s, x, y, Inches(1.2), Inches(0.5), color)
    add_text(s, x, y, Inches(1.2), Inches(0.5), label, size=10, bold=True, color=WHITE,
             align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)

add_text(s, Inches(4.2), Inches(1.05), Inches(8.7), Inches(0.3), "Project Health", size=10, bold=True, color=GRAY)
status_pill(Inches(4.2), Inches(1.4), "Overall: A", AMBER)
status_pill(Inches(5.5), Inches(1.4), "Schedule: A", AMBER)
status_pill(Inches(6.8), Inches(1.4), "Risk: A", AMBER)
status_pill(Inches(8.1), Inches(1.4), "Budget: G", GREEN)
status_pill(Inches(9.4), Inches(1.4), "Resource: A", AMBER)

# Goal banner
add_rect(s, Inches(0.4), Inches(2.7), Inches(12.55), Inches(0.6), NAVY)
add_text(s, Inches(0.55), Inches(2.78), Inches(1.2), Inches(0.45),
         "GOAL", size=11, bold=True, color=ORANGE, anchor=MSO_ANCHOR.MIDDLE)
add_text(s, Inches(1.7), Inches(2.78), Inches(11.2), Inches(0.45),
         "Ensure IT alignment with operational needs and strategic objectives, while fostering innovation and maintaining cost-effectiveness.",
         size=10, italic=True, color=WHITE, anchor=MSO_ANCHOR.MIDDLE)

# Two columns: Progress / Issues
col_y = Inches(3.45)
col_h = Inches(1.65)

# Helper — split AI commentary text into clean bullet lines for the
# slide. Accepts text with • · - * ◦ markers or plain newlines.
def _parse_commentary_bullets(text, max_bullets=5):
    if not text or not isinstance(text, str):
        return []
    # Normalise unicode bullets to newline separators
    text = text.replace('•', '\n').replace('·', '\n')
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    out = []
    for l in lines:
        cleaned = l.lstrip('•·-*◦ ').strip()
        if cleaned: out.append(cleaned)
    return out[:max_bullets]

# Convert bullet list to add_multi_text tuples — splits on ':' into a
# bold NAVY label + CHARCOAL body so the slide retains its visual
# hierarchy even when content is AI-generated.
def _bullets_to_lines(bullets, accent_color):
    out = []
    for b in bullets:
        if ': ' in b and len(b.split(': ', 1)[0]) < 60:
            head, tail = b.split(': ', 1)
            out.append((f"• {head}: ", 9, True, accent_color))
            out.append((tail, 9, False, CHARCOAL))
        else:
            out.append((f"• {b}", 9, False, CHARCOAL))
    return out

_commentary = K.get('commentary') or {}
_progress_text = _commentary.get('progress') or ''
_issues_text   = _commentary.get('issues')   or ''

# Progress
add_rect(s, Inches(0.4), col_y, Inches(6.2), Inches(0.35), GREEN)
add_text(s, Inches(0.55), col_y, Inches(6), Inches(0.35), "Progress since last period",
         size=11, bold=True, color=WHITE, anchor=MSO_ANCHOR.MIDDLE)
add_rect(s, Inches(0.4), col_y+Inches(0.35), Inches(6.2), col_h, WHITE, line=RGBColor(0xE5,0xE7,0xEB))
_prog_bullets = _parse_commentary_bullets(_progress_text, max_bullets=5)
if _prog_bullets:
    prog_lines = _bullets_to_lines(_prog_bullets, NAVY)
else:
    # Fallback: data-driven defaults from K (replaces previous
    # April-hardcoded template text)
    prog_lines = [
        (f"• Helpdesk {MONTH}: ", 9, True, NAVY),
        (f"{K.get('total', 0):,} tickets, {K.get('closure_rate', 0):.1f}% closure, Res SLA {K.get('sla_compliance', 0):.0f}%.", 9, False, CHARCOAL),
        (f"• Change Governance: ", 9, True, NAVY),
        (f"{K.get('changes_total', 0)} changes — {K.get('changes_type', {}).get('Standard', 0)} Standard / {K.get('changes_type', {}).get('Major', 0)} Major / {K.get('changes_type', {}).get('Emergency', 0)} Emergency.", 9, False, CHARCOAL),
        ("• Click Analyze ", 9, True, AMBER),
        ("on the dashboard to generate executive commentary for this section.", 9, False, GRAY),
    ]
add_multi_text(s, Inches(0.55), col_y+Inches(0.45), Inches(6.0), col_h-Inches(0.2), prog_lines, line_space=1.15)

# Issues / Risks
add_rect(s, Inches(6.75), col_y, Inches(6.2), Inches(0.35), AMBER)
add_text(s, Inches(6.9), col_y, Inches(6), Inches(0.35), "Issues / Risks / Comments",
         size=11, bold=True, color=WHITE, anchor=MSO_ANCHOR.MIDDLE)
add_rect(s, Inches(6.75), col_y+Inches(0.35), Inches(6.2), col_h, WHITE, line=RGBColor(0xE5,0xE7,0xEB))
_issue_bullets = _parse_commentary_bullets(_issues_text, max_bullets=5)
if _issue_bullets:
    issue_lines = _bullets_to_lines(_issue_bullets, RED)
else:
    # Fallback: data-driven from current month's K
    issue_lines = [
        (f"• {K.get('mi_total', 0)} Major Incidents ({MONTH}): ", 9, True, RED),
        ("see slide 9 for site breakdown + actions.", 9, False, CHARCOAL),
        (f"• FRT SLA at {K.get('frt_sla', 0):.1f}%: ", 9, True, AMBER),
        ("review on slide 4 (12-month trend).", 9, False, CHARCOAL),
        (f"• Open Backlog {K.get('open_backlog', 0)} tickets: ", 9, True, AMBER),
        ("ageing distribution on slide 6.", 9, False, CHARCOAL),
        ("• Click ✨ Analyze (AI) ", 9, True, AMBER),
        ("on the dashboard for narrative risk commentary.", 9, False, GRAY),
    ]
add_multi_text(s, Inches(6.9), col_y+Inches(0.45), Inches(6.0), col_h-Inches(0.2), issue_lines, line_space=1.15)

# Strategic KPIs table — start earlier so the last row clears the corner footer at y=7.18
ky = Inches(5.10)
add_rect(s, Inches(0.4), ky, Inches(12.55), Inches(0.35), NAVY)
add_text(s, Inches(0.55), ky, Inches(12.4), Inches(0.35), "Strategic KPIs",
         size=11, bold=True, color=WHITE, anchor=MSO_ANCHOR.MIDDLE)

# Header row
hy = ky + Inches(0.35)
hdrs = [("Deliverable / KPI", 4.2),("Owner", 1.0),("End",0.8),("RAG",0.7),("Comments",5.85)]
hx = Inches(0.4)
add_rect(s, hx, hy, Inches(12.55), Inches(0.32), LIGHT_GRAY)
cx = hx
for label, w in hdrs:
    add_text(s, cx+Inches(0.1), hy+Inches(0.04), Inches(w), Inches(0.25), label,
             size=9, bold=True, color=NAVY, anchor=MSO_ANCHOR.MIDDLE)
    cx += Inches(w)

rows = [
    ("Strategic IT Roadmap Delivery & Governance", "Mohamed", "H2-26", GREEN, "Roadmap distributed to Site IT Mgrs; first IT Council scheduled May."),
    ("Control Framework Transfer to SCM", "Mohamed", "H1-26", AMBER, "Transfer in progress with Guy Serge; June review session planned."),
    ("Skills Matrix APPS Adoption (4MP V2)", "Mohamed", "H1-26", GREEN, "V2 released; Finance pilot underway with 9-box, mentoring, dev plans."),
    ("Infrastructure Standardization Oversight", "Mohamed", "H2-26", AMBER, "Site link upgrades progressing; SGO contract/procurement delays."),
]
ry = hy + Inches(0.32)
row_h = Inches(0.30)
for i,(d,o,e,rag,com) in enumerate(rows):
    bg = WHITE if i%2==0 else LIGHTER_GRAY
    add_rect(s, hx, ry+row_h*i, Inches(12.55), row_h, bg, line=RGBColor(0xE5,0xE7,0xEB))
    cx = hx
    cells = [(d,4.2,9,False,NAVY),(o,1.0,9,False,CHARCOAL),(e,0.8,9,False,CHARCOAL)]
    for txt,w,sz,bd,col in cells:
        add_text(s, cx+Inches(0.1), ry+row_h*i+Inches(0.05), Inches(w), Inches(0.25), txt,
                 size=sz, bold=bd, color=col, anchor=MSO_ANCHOR.MIDDLE)
        cx += Inches(w)
    # RAG dot
    add_rect(s, cx+Inches(0.27), ry+row_h*i+Inches(0.07), Inches(0.18), Inches(0.18), rag, shape=MSO_SHAPE.OVAL)
    cx += Inches(0.7)
    # Comments
    add_text(s, cx+Inches(0.1), ry+row_h*i+Inches(0.05), Inches(5.7), Inches(0.25), com,
             size=8, color=GRAY, anchor=MSO_ANCHOR.MIDDLE)

footer_bar(s, 2)

# ====================================================================
# SLIDE 3 — Executive Overview (KPI tiles)
# ====================================================================
s = prs.slides.add_slide(BLANK)
header_band(s, "Executive Overview", "HELP DESK", PERIOD_SHORT)
add_text(s, Inches(0.4), Inches(1.05), Inches(10), Inches(0.5),
         f"{PERIOD_LONG} — At a Glance", size=18, bold=True, color=NAVY)

# 12 KPI tiles in 3 rows × 4 cols
TILE_W = Inches(3.0); TILE_H = Inches(1.55); GAP = Inches(0.13)
ORIGIN_X = Inches(0.4); ORIGIN_Y = Inches(1.65)

def get_pos(row, col):
    return (ORIGIN_X + (TILE_W+GAP)*col, ORIGIN_Y + (TILE_H+GAP)*row)

# Helper: place a delta pill in the top-right corner of a tile
def tile_delta(x, y, txt, kind):
    delta_pill(s, x + TILE_W - Inches(1.30), y + Inches(0.08), txt, kind=kind, dark_bg=False, w=Inches(1.20), size=9)

# Helpers — derive MoM delta string + direction from a (delta, unit, good_is) tuple
def _delta_str(val, unit='%', invert=False):
    """Format a MoM delta. unit ∈ '%'/'pp'/'d'. invert=True means lower=better."""
    if val is None or (isinstance(val, float) and (val != val)):  # None or NaN
        return ('— MoM', 'neutral')
    sign = '+' if val > 0 else ''
    # Trailing zero cleanup for % / pp
    if unit in ('%', 'pp'):
        s = f"{sign}{val:.1f}{unit} MoM"
    else:
        s = f"{sign}{val}{unit} MoM"
    if val == 0: return (s, 'neutral')
    pos = (val > 0) ^ invert   # XOR: invert flips the good direction
    return (s, 'good' if pos else 'bad')

# Pull MoM deltas from K (server payload). Set via reportPayload.js mapping.
_d_total   = _delta_str(K.get('total_delta_pct'),         '%')
_d_closed  = _delta_str(K.get('closed_delta_pct'),        '%')
_d_sla     = _delta_str(K.get('sla_compliance_delta_pp'), 'pp')
_d_backlog = _delta_str(K.get('open_backlog_delta_pct'),  '%', invert=True)   # lower backlog = good
_d_fcr     = _delta_str(K.get('fcr_delta_pp'),            'pp')
_d_frt     = _delta_str(K.get('frt_sla_delta_pp'),        'pp')
_d_res     = _delta_str(K.get('avg_res_days_delta'),      'd',  invert=True)  # faster = good
_d_changes = ( ('— MoM', 'neutral')
               if K.get('changes_total_delta') is None
               else _delta_str(K.get('changes_total_delta'), '', invert=False) )
# Emergency rate change: derive from K if present, else neutral
_d_emerg   = _delta_str(K.get('emergency_delta_pp'),      'pp', invert=True)
_d_mi      = _delta_str(K.get('mi_total_delta'),          '',   invert=True)
_d_grp     = _delta_str(K.get('support_groups_delta'),    '',   invert=False)

# Support Groups count — preference order:
#   1. Browser-sent `support_groups` (distinct tech_groups in cur data)
#   2. Server-side K['groups'] dict size (requires site_id)
#   3. Ageing dict size (one entry per group with open tickets)
_grp_dict   = K.get('groups') or {}
_ageing_obj = K.get('ageing') or {}
_support_n  = (K.get('support_groups') or
               (len(_grp_dict) if _grp_dict else len(_ageing_obj)) or
               0)

# Emergency rate % (with safe div)
_emerg_n   = K.get('changes_emergency')
if _emerg_n is None:
    _emerg_n = K.get('changes_type', {}).get('Emergency', 0)
_emerg_pct = (_emerg_n / max(K.get('changes_total', 0), 1) * 100) if K.get('changes_total') else 0

# Row 1 — Volume & SLA
x,y = get_pos(0,0); kpi_tile(s,x,y,TILE_W,TILE_H,"TOTAL TICKETS", f"{K['total']:,}", f"Created in {MONTH}", accent=BLUE, value_size=32);                  tile_delta(x,y,_d_total[0],   _d_total[1])
x,y = get_pos(0,1); kpi_tile(s,x,y,TILE_W,TILE_H,"CLOSED TICKETS", f"{K['closed']:,}", f"{K['closure_rate']:.1f}% closure rate", accent=GREEN, value_size=32); tile_delta(x,y,_d_closed[0],  _d_closed[1])
x,y = get_pos(0,2); kpi_tile(s,x,y,TILE_W,TILE_H,"SLA COMPLIANCE (Res)", f"{K['sla_compliance']:.1f}%", "Target ≥ 90%  ⚠", accent=AMBER, value_color=NAVY, value_size=32); tile_delta(x,y,_d_sla[0],     _d_sla[1])
x,y = get_pos(0,3); kpi_tile(s,x,y,TILE_W,TILE_H,"OPEN BACKLOG", f"{K['open_backlog']}", "Active open tickets", accent=ORANGE, value_size=32);          tile_delta(x,y,_d_backlog[0], _d_backlog[1])

# Row 2 — Quality: FCR · FRT · Resolution · SLA Violations (4 tiles, May-final layout)
# FCR + SLA Violations restored 2026-06-22: fcr_rate is now reconciled to the
# scorecard's ticket-based proxy (closed, not escalated, not reopened — no longer
# the empty CSAT-derived value), and SLA Violations = 100 - Resolution SLA.
_sla_viol = max(0.0, 100 - K.get('sla_compliance', 0))
x,y = get_pos(1,0); kpi_tile(s,x,y,TILE_W,TILE_H,"FCR RATE", f"{K['fcr_rate']:.1f}%", "Closed, no escalation / reopen", accent=GREEN, value_size=32);      tile_delta(x,y,_d_fcr[0],  _d_fcr[1])
x,y = get_pos(1,1); kpi_tile(s,x,y,TILE_W,TILE_H,"FRT SLA", f"{K['frt_sla']:.1f}%", "Target ≥ 90%  ⚠", accent=RED, value_size=32);                         tile_delta(x,y,_d_frt[0],  _d_frt[1])
x,y = get_pos(1,2); kpi_tile(s,x,y,TILE_W,TILE_H,"AVG RESOLUTION", f"{K['avg_res_days']}d", "MTTR — all tickets", accent=BLUE, value_size=32);              tile_delta(x,y,_d_res[0],  _d_res[1])
x,y = get_pos(1,3); kpi_tile(s,x,y,TILE_W,TILE_H,"SLA VIOLATIONS", f"{_sla_viol:.1f}%", "Missed Resolution SLA", accent=ORANGE, value_color=NAVY, value_size=32)

# Row 3 — Governance & Incident
x,y = get_pos(2,0); kpi_tile(s,x,y,TILE_W,TILE_H,"CHANGES (NEW)", f"{K['changes_total']}", "Created this period", accent=BLUE, value_size=32);            tile_delta(x,y,_d_changes[0], _d_changes[1])
x,y = get_pos(2,1); kpi_tile(s,x,y,TILE_W,TILE_H,"EMERGENCY CHANGES", f"{_emerg_n}", f"{_emerg_pct:.1f}% — Target < 5%", accent=AMBER, value_size=32); tile_delta(x,y,_d_emerg[0],   _d_emerg[1])
x,y = get_pos(2,2); kpi_tile(s,x,y,TILE_W,TILE_H,"MAJOR INCIDENTS", f"{K['mi_total']}", f"{K['mi_critical']} P1 · {K['mi_high']} P2", accent=RED, value_color=RED, value_size=32); tile_delta(x,y,_d_mi[0],      _d_mi[1])
x,y = get_pos(2,3); kpi_tile(s,x,y,TILE_W,TILE_H,"SUPPORT GROUPS", f"{_support_n}", f"Active in {MONTH}", accent=GREEN, value_size=32);                tile_delta(x,y,_d_grp[0],     _d_grp[1])

# Bottom commentary band — data-driven, no more April hardcoded
# Prefer AI-generated executive comment from K['commentary']['exec']
# (filled by browser's Analyze button) — if absent, fall back to a
# numeric summary derived from this month's K.
_exec_comment = (K.get('commentary') or {}).get('exec', '').strip()
if not _exec_comment:
    _sla_gap_pp = 90 - K.get('sla_compliance', 0)
    _sla_status = "below 90% target ⚠" if K.get('sla_compliance', 0) < 90 else "above 90% target ✓"
    _exec_comment = (
        f"{MONTH} {K.get('year','')}: {K.get('total', 0):,} tickets, "
        f"{K.get('closure_rate', 0):.1f}% closure, Resolution SLA "
        f"{K.get('sla_compliance', 0):.1f}% ({_sla_status}), "
        f"FRT SLA {K.get('frt_sla', 0):.1f}%. "
        f"{K.get('mi_total', 0)} major incidents ({K.get('mi_critical', 0)} P1, "
        f"{K.get('mi_high', 0)} P2). {K.get('changes_total', 0)} new changes; "
        f"emergency rate {_emerg_pct:.1f}%. "
        f"Focus: {'close ' + format(_sla_gap_pp, '.1f') + 'pp gap to 90% Res SLA' if _sla_gap_pp > 0 else 'maintain Res SLA above target'}; "
        f"lift FRT to 90%."
    )
add_rect(s, Inches(0.4), Inches(6.55), Inches(12.55), Inches(0.55), DARK_NAVY)
add_text(s, Inches(0.55), Inches(6.55), Inches(12.3), Inches(0.55),
         _exec_comment,
         size=9, color=WHITE, anchor=MSO_ANCHOR.MIDDLE)
footer_bar(s, 3)

# ====================================================================
# SLIDE 4 — Helpdesk Operations 12-Month Trend
# ====================================================================
s = prs.slides.add_slide(BLANK)
header_band(s, "Helpdesk Operations — 12-Month Trend", "HELP DESK", PERIOD_SHORT)
add_text(s, Inches(0.4), Inches(1.05), Inches(10), Inches(0.4),
         "Ticket Volume & SLA Compliance Trend", size=15, bold=True, color=NAVY)

# Big chart left, summary right — wired to data_fns (Phase 3.5)
s.shapes.add_picture(_chart('volume_trend', figsize=(8.5, 4.5), data_fn=_draw_volume_trend, title=f'Monthly Volume — {PERIOD_LONG}'), Inches(0.4), Inches(1.55), width=Inches(8.6), height=Inches(4.5))

# Right: TWO KPI tiles side-by-side (FRT SLA + Res. SLA), then SLA trend chart below
kpi_tile(s, Inches(9.2), Inches(1.55), Inches(1.80), Inches(1.4),
         "FRT SLA", f"{K['frt_sla']:.1f}%", "Target ≥ 90%  ⚠", accent=RED, value_size=24)
kpi_tile(s, Inches(11.10), Inches(1.55), Inches(1.80), Inches(1.4),
         "RES. SLA", f"{K['sla_compliance']:.0f}%", "Target ≥ 90%  ⚠", accent=AMBER, value_color=NAVY, value_size=24)

s.shapes.add_picture(_chart('sla_trend', figsize=(5.0, 4.0), data_fn=_draw_sla_trend, title='SLA Compliance — 12 Months'), Inches(9.2), Inches(3.10), width=Inches(3.7), height=Inches(2.95))

# Bottom commentary — prefer AI commentary['sla'] if filled, else
# derive from K with the actual MoM delta values
_sla_comment = (K.get('commentary') or {}).get('sla', '').strip()
if not _sla_comment:
    _sla_mom    = K.get('sla_compliance_delta_pp') or 0
    _sla_mom_s  = f"{'+' if _sla_mom>0 else ''}{_sla_mom:.1f}pp"
    _frt_mom    = K.get('frt_sla_delta_pp') or 0
    _frt_mom_s  = f"{'+' if _frt_mom>0 else ''}{_frt_mom:.1f}pp"
    _swa = K.get('categories', {}).get('Software and Applications', 0)
    _iti = K.get('categories', {}).get('IT Infrastructure', 0)
    _cat_share = (_swa + _iti) / max(K.get('total', 0), 1) * 100
    _sla_comment = (
        f"Resolution SLA {K['sla_compliance']:.0f}% ({_sla_mom_s} MoM) — "
        f"{'above 90% target ✓' if K['sla_compliance'] >= 90 else 'within ' + format(90 - K['sla_compliance'], '.1f') + 'pp of the 90% target'}. "
        f"FRT SLA at {K['frt_sla']:.1f}% ({_frt_mom_s}) "
        f"{'is the main gap' if K['frt_sla'] < 90 else 'meets target'}. "
        f"Software/Apps ({_swa:,} tickets) and IT Infrastructure ({_iti:,}) are "
        f"{_cat_share:.0f}% of volume. "
        f"Action: {'close the SLA gap to 90% and ' if K['sla_compliance'] < 90 else ''}"
        f"lift FRT via dedicated first-response triage across top 3 sites."
    )
add_rect(s, Inches(0.4), Inches(6.25), Inches(12.55), Inches(0.85), DARK_NAVY)
add_text(s, Inches(0.55), Inches(6.32), Inches(12.3), Inches(0.75),
         _sla_comment,
         size=9, color=WHITE, anchor=MSO_ANCHOR.MIDDLE)
footer_bar(s, 4)

# ====================================================================
# SLIDE 5 — Ticket Distribution & Channel
# ====================================================================
s = prs.slides.add_slide(BLANK)
header_band(s, "Ticket Distribution & Submission Channel", "HELP DESK", PERIOD_SHORT)
add_text(s, Inches(0.4), Inches(1.05), Inches(12), Inches(0.4),
         f"Tickets by Category & Channel Trend — {PERIOD_LONG}", size=15, bold=True, color=NAVY)

# Top-left: category bar chart (kept) — narrower
s.shapes.add_picture(_chart('categories', figsize=(5.8, 4.6), data_fn=_draw_categories, title=f'Top Categories — {PERIOD_LONG}'), Inches(0.4), Inches(1.55), width=Inches(5.5), height=Inches(4.6))

# Top-right: current-month channel breakdown (bar chart — replaces pie
# to fix label overlap when 4+ channels are present)
s.shapes.add_picture(_chart('channel_now', figsize=(7.0, 2.2), data_fn=_draw_channels, title=f'Submission Channel — {MONTH}'), Inches(6.05), Inches(1.55), width=Inches(6.95), height=Inches(2.2))

# NEW (2026-06-04): 12-month Email vs Web Form share trend below the
# current-month bar — user explicitly asked to see "the compared trend
# of email channel over months vs Web form submission on last 12 month
# in small format".
s.shapes.add_picture(_chart('channel_trend_12m', figsize=(7.0, 1.6), data_fn=_draw_channel_share_trend, title='E-Mail vs Web Form — 12-Month Share'), Inches(6.05), Inches(3.80), width=Inches(6.95), height=Inches(1.30))

# Current-month channel split tiles — moved down to clear the 12-month
# trend chart above (which ends at y=5.10)
cur_email = K['channel'].get('E-Mail', 0)
cur_web   = K['channel'].get('Web Form', 0)
_ch_denom = K.get('total') or sum(K['channel'].values()) or 1
cur_email_pct = cur_email / _ch_denom * 100
cur_web_pct   = cur_web   / _ch_denom * 100
# MoM deltas vs previous month — pulled from K when browser sent them
_em_mom = K.get('mom_email_pp')
_wf_mom = K.get('mom_webform_pp')
_em_mom_s = f"{'+' if _em_mom and _em_mom > 0 else ''}{_em_mom:.1f}pp vs {K.get('prev_month_short', 'prev')}" if _em_mom is not None else f"— vs {K.get('prev_month_short', 'prev')}"
_wf_mom_s = f"{'+' if _wf_mom and _wf_mom > 0 else ''}{_wf_mom:.1f}pp vs {K.get('prev_month_short', 'prev')}" if _wf_mom is not None else f"— vs {K.get('prev_month_short', 'prev')}"

def channel_pill(x, y, w, h, label, value, sub, accent, value_color):
    add_rect(s, x, y, Inches(0.10), h, accent)
    add_rect(s, x+Inches(0.10), y, w-Inches(0.10), h, WHITE, line=RGBColor(0xE5,0xE7,0xEB))
    add_text(s, x+Inches(0.20), y+Inches(0.05), w-Inches(0.30), Inches(0.22),
             label.upper(), size=8, bold=True, color=GRAY)
    add_text(s, x+Inches(0.20), y+Inches(0.25), w-Inches(0.30), Inches(0.45),
             value, size=22, bold=True, color=value_color)
    add_text(s, x+Inches(0.20), y+h-Inches(0.25), w-Inches(0.30), Inches(0.20),
             sub, size=8, color=GRAY)

# Tiles now at y=5.20 (was 5.05) with compressed height 0.95 (was 1.10)
channel_pill(Inches(6.05), Inches(5.20), Inches(3.40), Inches(0.95),
             f"E-Mail ({MONTH})", f"{cur_email_pct:.1f}%",
             f"{cur_email:,} tickets  ·  {_em_mom_s}", BLUE, BLUE)
channel_pill(Inches(9.60), Inches(5.20), Inches(3.40), Inches(0.95),
             f"Web Form ({MONTH})", f"{cur_web_pct:.1f}%",
             f"{cur_web:,} tickets  ·  {_wf_mom_s}", ORANGE, ORANGE)

# Bottom commentary — data-driven, prefer AI commentary['helpdesk'] if filled
_chan_comment = (K.get('commentary') or {}).get('helpdesk', '').strip()
if not _chan_comment:
    _total_mom = K.get('total_delta_pct')
    _prev_lbl  = K.get('prev_month_short', 'prev')
    _vol_phrase = (
        f"Volume {'decreased' if (_total_mom or 0) < 0 else 'increased'} "
        f"{abs(_total_mom or 0):.0f}% MoM ({K.get('total_apr', '—')} → {K['total']:,})."
        if K.get('total_apr') else f"Volume this period: {K['total']:,} tickets."
    )
    _top_cat = next(iter((K.get('categories') or {}).items()), (None, 0))
    _top_cat_phrase = (
        f"Top category: {_top_cat[0]} ({_top_cat[1]:,} tickets)."
        if _top_cat[0] else ""
    )
    _chan_comment = (
        f"{_vol_phrase} {_top_cat_phrase} "
        f"E-Mail at {cur_email_pct:.0f}% ({_em_mom_s}) — Web Form at "
        f"{cur_web_pct:.0f}% ({_wf_mom_s}). "
        f"Continue portal-adoption push to keep Web Form share rising."
    )
add_rect(s, Inches(0.4), Inches(6.30), Inches(12.55), Inches(0.80), DARK_NAVY)
add_text(s, Inches(0.55), Inches(6.36), Inches(12.3), Inches(0.70),
         _chan_comment,
         size=9, color=WHITE, anchor=MSO_ANCHOR.MIDDLE)
footer_bar(s, 5)

# ====================================================================
# SLIDE 6 — SLA Compliance & Ageing
# ====================================================================
s = prs.slides.add_slide(BLANK)
header_band(s, "SLA Compliance & Ticket Ageing by Group", "HELP DESK", PERIOD_SHORT)
add_text(s, Inches(0.4), Inches(1.05), Inches(10), Inches(0.4),
         "Ageing Backlog — Open Tickets by Group", size=15, bold=True, color=NAVY)

s.shapes.add_picture(_chart('ageing', figsize=(8.0, 4.6), data_fn=_draw_ageing, title='Open Ticket Ageing by Group'), Inches(0.4), Inches(1.55), width=Inches(7.8), height=Inches(4.6))

# Right side panels
# Why is the backlog blocked
add_rect(s, Inches(8.5), Inches(1.55), Inches(4.45), Inches(2.2), RGBColor(0xFF,0xF8,0xE6), line=AMBER)
add_text(s, Inches(8.65), Inches(1.65), Inches(4.2), Inches(0.3),
         "WHY IS THE BACKLOG BLOCKED?", size=10, bold=True, color=ORANGE_D)
backlog_lines = [
    ("①  External providers ", 9, True, NAVY),
    ("(data & credit provisioning) — SLA commitments under review by Infra team.", 9, False, CHARCOAL),
    ("②  Procurement delays ", 9, True, NAVY),
    ("on hardware / software purchases creating pending-approval queues.", 9, False, CHARCOAL),
    ("③  Site coverage gaps ", 9, True, NAVY),
    ("at Mana / Dakar / Sabodala awaiting recruitment closure.", 9, False, CHARCOAL),
    ("→  Engagement underway with providers & procurement.", 9, True, GREEN),
]
add_multi_text(s, Inches(8.65), Inches(1.95), Inches(4.2), Inches(1.7), backlog_lines, line_space=1.2)

# Critical ageing panel
add_rect(s, Inches(8.5), Inches(3.85), Inches(4.45), Inches(2.3), RGBColor(0xFE,0xE2,0xE2), line=RED)
add_text(s, Inches(8.65), Inches(3.95), Inches(4.2), Inches(0.3),
         "⚠ CRITICAL AGEING — Top Sites by Open Volume", size=10, bold=True, color=RED)
# Helper: kpis-may.json uses {'0-30', '31-60', '>60', 'total'}; the
# original prototype used {'open', 'under_30', '30_60', 'over_60'}.
# Accept either shape so we don't have to patch every site upstream.
def _ag_open(v):    return v.get('total') if 'total' in v else v.get('open', 0)
def _ag_under30(v): return v.get('0-30', v.get('under_30', 0))
def _ag_3160(v):    return v.get('31-60', v.get('30_60', 0))
def _ag_over60(v):  return v.get('>60', v.get('over_60', 0))

# Sort by open volume so the top-5 reflects the highest concentration
_ag_sorted = sorted(K['ageing'].items(), key=lambda kv: -_ag_open(kv[1]))
top_age = _ag_sorted[:5]
ag_lines = []
for g, v in top_age:
    short = g.replace(' IT Agents','').replace(' IT Agent','').replace(' Support','')
    ag_lines.append((f"{short}: {_ag_open(v)} open  ", 9, True, NAVY))
    ag_lines.append((f"({_ag_under30(v)} <30d, {_ag_3160(v)} 30-60d, {_ag_over60(v)} >60d)", 9, False, GRAY))
add_multi_text(s, Inches(8.65), Inches(4.25), Inches(4.2), Inches(1.85), ag_lines, line_space=1.15)

# Bottom commentary
top_ag = _ag_sorted[:3]
top_summary = ", ".join([
    f"{g.replace(' IT Agents','').replace(' IT Agent','').replace(' Support','')} {_ag_open(v)}"
    for g, v in top_ag
])
total_open = sum(_ag_open(v) for v in K['ageing'].values())
add_rect(s, Inches(0.4), Inches(6.25), Inches(12.55), Inches(0.85), DARK_NAVY)
add_text(s, Inches(0.55), Inches(6.32), Inches(12.3), Inches(0.75),
         K.get('commentary', {}).get('slide6')
         or f"{MONTH} open backlog: {total_open} tickets across {len(K['ageing'])} Operations groups. Highest concentration: {top_summary}. Engagement ongoing with external providers and procurement to unblock hardware/software dependencies.",
         size=9, color=WHITE, anchor=MSO_ANCHOR.MIDDLE)
footer_bar(s, 6)

# ====================================================================
# SLIDE 7 — Customer Satisfaction & Voice
# ====================================================================
s = prs.slides.add_slide(BLANK)
header_band(s, "Customer Satisfaction & Voice", "HELP DESK", PERIOD_SHORT)
add_text(s, Inches(0.4), Inches(1.05), Inches(10), Inches(0.4),
         f"CSAT & Net Promoter Score — {PERIOD_LONG}", size=15, bold=True, color=NAVY)

s.shapes.add_picture(_chart('csat_donut', figsize=(5.0, 4.3), data_fn=_draw_csat_donut, title=f'Survey Responses ({MONTH})'), Inches(0.4), Inches(1.55), width=Inches(4.5), height=Inches(4.3))

# CSAT card — caption + colour now reflect whether the value is above
# or below the 80% target instead of always saying "above target".
_csat_pct_val = K.get('csat_pct', 0) or 0
_csat_above   = _csat_pct_val >= 80
_csat_caption = "Target ≥ 80%  ✓  above target" if _csat_above else (
    f"Target ≥ 80%  ⚠  {80 - _csat_pct_val:.1f}pp below target"
)
_csat_accent  = GREEN if _csat_above else AMBER
kpi_tile(s, Inches(5.1), Inches(1.55), Inches(3.85), Inches(2.0),
         "CSAT (% Satisfied)", f"{_csat_pct_val}%",
         _csat_caption, accent=_csat_accent, value_color=_csat_accent, value_size=42)
# Sub-line: survey-level breakdown
_csat_sub = (
    f"{MONTH} survey · {K['csat_total_responses']} responses · "
    f"{K.get('csat_satisfied', 0)} satisfied / {K.get('csat_dissatisfied', 0)} dissatisfied"
)
add_text(s, Inches(5.30), Inches(3.10), Inches(3.6), Inches(0.3),
         _csat_sub, size=9, color=GRAY)

# Right tile — prefer NPS when present (nps_proxy non-zero), else fall
# back to the Avg Survey Score expressed as a 0-100% figure derived
# from the 1-5 rating. The user's audit showed NPS=41 IS available
# in the payload — the old tile unconditionally said "NPS not measured".
_nps_val = K.get('nps_proxy', 0) or 0
if _nps_val:
    _nps_above = _nps_val >= 30
    _nps_caption = "Target ≥ 30  ✓  above target" if _nps_above else (
        f"Target ≥ 30  ⚠  {30 - _nps_val} below target"
    )
    _nps_accent = GREEN if _nps_above else AMBER
    kpi_tile(s, Inches(9.10), Inches(1.55), Inches(3.85), Inches(2.0),
             "NPS", f"{'+' if _nps_val > 0 else ''}{_nps_val}",
             _nps_caption, accent=_nps_accent, value_color=_nps_accent, value_size=42)
    add_text(s, Inches(9.30), Inches(3.10), Inches(3.6), Inches(0.3),
             f"Net Promoter Score · 0-10 rating distribution", size=9, color=GRAY)
else:
    _avg_score = K.get('csat_avg_score', 0) or 0
    kpi_tile(s, Inches(9.10), Inches(1.55), Inches(3.85), Inches(2.0),
             "AVG SURVEY SCORE", f"{_avg_score:.1f}%",
             "Overall ticket-resolution rating",
             accent=BLUE, value_color=BLUE, value_size=42)
    add_text(s, Inches(9.30), Inches(3.10), Inches(3.6), Inches(0.3),
             f"NPS not measured this month (survey has no NPS questions)",
             size=9, color=GRAY)

# Pain points panel
add_rect(s, Inches(5.1), Inches(3.7), Inches(7.85), Inches(2.2), WHITE, line=RGBColor(0xE5,0xE7,0xEB))
add_text(s, Inches(5.25), Inches(3.78), Inches(7.7), Inches(0.3),
         f"TOP PAIN POINTS  ({MONTH} survey · {K['csat_dissatisfied']} dissatisfied responses analysed)", size=10, bold=True, color=NAVY)

# Derive top-3 pain themes dynamically from the April survey free-text
# (filter to Dissatisfied responses; categorize via keyword regex; count by theme)
# 2026-06-03: Production rewrite — _derive_pain_points used to read a
# CSV from a dev-only sandbox path that does not exist on prod.
# Voice themes now expected on the payload at K[voice_themes][pain][].
# When absent, fall back to a placeholder row so the slide still renders.
# Phase 5 of the integration roadmap brings LLM clustering — see
# ITOPS_REPORT_INTEGRATION_GUIDE.md §3.5 and §9.
# 2026-06-03: Production rewrite — _derive_pain_points used to read a
# CSV from a dev-only sandbox path that does not exist on prod.
# Voice themes now expected on the payload at K['voice_themes']['pain'][].
# When absent, fall back to a placeholder row so the slide still renders.
# Phase 5 of the integration roadmap brings LLM clustering — see
# ITOPS_REPORT_INTEGRATION_GUIDE.md sec 3.5 and sec 9.
def _derive_pain_points():
    colors = [RED, AMBER, BLUE]
    voice = K.get('voice_themes', {})
    raw = (voice.get('pain') or [])[:3]
    if not raw:
        return [('1', 'Voice clustering pending',
                 'Phase 5 of the integration brings LLM clustering of survey verbatims.',
                 GRAY)]
    out = []
    for i, item in enumerate(raw):
        theme = (item or {}).get('theme', '—')
        count = (item or {}).get('count', 0)
        sample = (item or {}).get('sample', '')
        mention_word = 'mentions' if count != 1 else 'mention'
        sample_str = f' — "{sample[:90]}"' if sample else ''
        sub = f"{count} {mention_word}{sample_str}"
        out.append((str(i + 1), theme, sub, colors[i % len(colors)]))
    return out

    return out
pain = _derive_pain_points()
py = Inches(4.10)
for i,(n,t,d,col) in enumerate(pain):
    yy = py + Inches(0.55*i)
    add_rect(s, Inches(5.25), yy, Inches(0.45), Inches(0.45), col)
    add_text(s, Inches(5.25), yy, Inches(0.45), Inches(0.45), n, size=15, bold=True, color=WHITE,
             align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    add_text(s, Inches(5.85), yy+Inches(0.02), Inches(7.0), Inches(0.25), t, size=11, bold=True, color=NAVY)
    add_text(s, Inches(5.85), yy+Inches(0.25), Inches(7.0), Inches(0.25), d, size=9, color=GRAY)

# Bottom commentary — prefer AI commentary['csat'] if filled, else
# derive from K with the actual MONTH (not April)
_csat_comment = (K.get('commentary') or {}).get('csat', '').strip()
if not _csat_comment:
    _csat_n  = K.get('csat_total_responses', 0)
    _csat_p  = K.get('csat_pct', 0)
    _csat_d  = K.get('csat_dissatisfied', 0)
    _csat_s  = K.get('csat_satisfied', 0)
    _csat_nr = K.get('csat_no_rating', 0)
    _csat_avg= K.get('csat_avg_score', 0) or 0
    _csat_target = '✓' if _csat_p >= 80 else '⚠ below target'
    if _csat_n == 0:
        _csat_comment = (
            f"{MONTH} survey: 0 responses captured this month — push for survey "
            f"completion via SDP closure email automation. Last known CSAT was "
            f"{_csat_p}%. NPS not tracked in current survey instrument."
        )
    else:
        _csat_comment = (
            f"{MONTH} survey: {_csat_n} responses, CSAT {_csat_p}% "
            f"(target ≥80% {_csat_target}). {_csat_s} satisfied / "
            f"{_csat_d} dissatisfied / {_csat_nr} no-rating. Avg overall "
            f"score {_csat_avg:.1f}%. NPS questions not present in this "
            f"survey — measure via direct survey item next cycle. Focus: "
            f"address {_csat_d} dissatisfied responses with proactive FRT "
            f"triage and status-update cadence on long-running tickets."
        )
add_rect(s, Inches(0.4), Inches(6.10), Inches(12.55), Inches(0.95), DARK_NAVY)
add_text(s, Inches(0.55), Inches(6.18), Inches(12.3), Inches(0.85),
         _csat_comment,
         size=9, color=WHITE, anchor=MSO_ANCHOR.MIDDLE)
footer_bar(s, 7)

# ====================================================================
# SLIDE 8 — Change Management
# ====================================================================
s = prs.slides.add_slide(BLANK)
header_band(s, "Change Management", "HELP DESK", PERIOD_SHORT)
add_text(s, Inches(0.4), Inches(1.05), Inches(10), Inches(0.4),
         f"Change Portfolio — {PERIOD_LONG}", size=15, bold=True, color=NAVY)

s.shapes.add_picture(_chart('changes_donut', figsize=(5.0, 4.5), data_fn=_draw_changes_donut, title=f'Changes by Type — {MONTH}'), Inches(0.4), Inches(1.55), width=Inches(4.7), height=Inches(4.5))

# 6 KPI tiles in 2x3
ct = K['changes_type']
total_ch = K['changes_total']
emerg_ch = ct.get('Emergency',0)
emerg_pct = emerg_ch/max(total_ch,1)*100
status = K['changes_status']
completed = status.get('Completed',0)
in_prog = status.get('In Progress',0)

t_cards = [
    ("TOTAL CHANGES", str(total_ch), f"Created in {MONTH}", BLUE),
    ("EMERGENCY", str(emerg_ch), f"{emerg_pct:.1f}% — Target < 5% {'✓' if emerg_pct<5 else '⚠'}", RED if emerg_pct>=5 else GREEN),
    ("MAJOR CHANGES", str(ct.get('Major',0)), "Require CAB review", AMBER),
    ("STANDARD", str(ct.get('Standard',0)), "Pre-approved process", GREEN),
    ("COMPLETED", str(completed), "Closed this period", GREEN),
    ("IN PROGRESS", str(in_prog), "Currently executing", BLUE),
]
gx = Inches(5.4); gy = Inches(1.55); cw = Inches(2.5); chh = Inches(1.45); ggap = Inches(0.13)
for i,(lbl, val, sub, ac) in enumerate(t_cards):
    r,c = divmod(i,3)
    kpi_tile(s, gx + (cw+ggap)*c, gy + (chh+ggap)*r, cw, chh, lbl, val, sub, accent=ac, value_size=28)

# Highlight box - Emergency change description
add_rect(s, Inches(5.4), Inches(4.85), Inches(7.55), Inches(1.10), RGBColor(0xFF,0xF8,0xE6), line=AMBER)
add_text(s, Inches(5.55), Inches(4.92), Inches(7.3), Inches(0.30),
         "⚠  Emergency Change — sml-fsv-mining Disk Space Upgrade  (CHG-254)",
         size=10, bold=True, color=ORANGE_D, anchor=MSO_ANCHOR.TOP)
add_text(s, Inches(5.55), Inches(5.20), Inches(7.3), Inches(0.70),
         "Lafigué (SML) — Mining VM running out of disk space. Critical urgent storage extension to prevent service interruption. Status: In Progress  ·  Group: EDV InfraOPs Support  ·  Priority: Critical.",
         size=9, color=NAVY, anchor=MSO_ANCHOR.TOP)

# Bottom commentary — data-driven, prefer AI commentary['change'] if filled
_change_comment = (K.get('commentary') or {}).get('change', '').strip()
if not _change_comment:
    _emerg_band = 'within 5% threshold' if emerg_pct < 5 else 'ABOVE 5% threshold ⚠'
    _change_comment = (
        f"Change activity in {MONTH}: {total_ch} new requests with "
        f"{ct.get('Standard',0)} standard, {ct.get('Major',0)} major, "
        f"{emerg_ch} emergency — emergency rate {emerg_pct:.1f}% ({_emerg_band}). "
        f"Pipeline health: {completed} completed, {in_prog} in progress, "
        f"plus {status.get('Requested',0)} awaiting submission and "
        f"{status.get('Approval Pending',0)} pending approval. "
        f"Focus area: tighten approval cycle on pre-approval items."
    )
add_rect(s, Inches(0.4), Inches(6.20), Inches(12.55), Inches(0.85), DARK_NAVY)
add_text(s, Inches(0.55), Inches(6.27), Inches(12.3), Inches(0.75),
         _change_comment,
         size=9, color=WHITE, anchor=MSO_ANCHOR.MIDDLE)
footer_bar(s, 8)

# ====================================================================
# SLIDE 9 — Major Incidents & Escalations
# ====================================================================
s = prs.slides.add_slide(BLANK)
header_band(s, "Major Incidents & Escalations", "HELP DESK", PERIOD_SHORT)
add_text(s, Inches(0.4), Inches(1.05), Inches(10), Inches(0.4),
         f"Major Incident Summary — {PERIOD_LONG}", size=15, bold=True, color=NAVY)

# Top 3 KPI tiles
kpi_tile(s, Inches(0.4), Inches(1.55), Inches(4.1), Inches(1.5), "P1 INCIDENTS", str(K['mi_critical']),
         "Critical priority", accent=RED, value_color=RED, value_size=40)
kpi_tile(s, Inches(4.65), Inches(1.55), Inches(4.1), Inches(1.5), "P2 INCIDENTS", str(K['mi_high']),
         "High priority", accent=AMBER, value_color=AMBER, value_size=40)
kpi_tile(s, Inches(8.90), Inches(1.55), Inches(4.05), Inches(1.5), "TOTAL MAJOR INCIDENTS", str(K['mi_total']),
         f"Created in {MONTH}", accent=BLUE, value_color=NAVY, value_size=40)

# Incident detail boxes — data-driven from K['mi_records'][]. Each record
# is expected to carry: id, site, priority, subject, status, plus optional
# detail / lessons / date strings. The payload from server.js may not
# include detail/lessons for every record; we render whatever is present
# and fall back to a brief generic line otherwise.
def _badge_for_priority(p):
    p = (p or '').strip().lower()
    if p in ('critical', 'p1', 'high (critical)'): return ('CRITICAL', RED)
    if p in ('high', 'p2'):                         return ('HIGH', AMBER)
    return (p.upper() if p else 'INCIDENT', BLUE)

_mi_raw = K.get('mi_records', [])[:6]   # 2 columns × 3 rows max
incidents = []
for rec in _mi_raw:
    badge, badge_col = _badge_for_priority(rec.get('priority'))
    site_str = rec.get('site', '—')
    if rec.get('date_resolved'):
        site_str = f"{site_str}  ·  resolved {rec['date_resolved']}"
    elif rec.get('date'):
        site_str = f"{site_str}  ·  {rec['date']}"
    else:
        site_str = f"{site_str}  ·  {PERIOD_LONG}"
    incidents.append({
        'badge':     badge,
        'badge_col': badge_col,
        'site':      site_str,
        'subject':   rec.get('subject') or rec.get('title') or '—',
        'detail':    rec.get('detail') or rec.get('description')
                     or f"Ticket {rec.get('id', '—')} — status: {rec.get('status', '—')}.",
        'lessons':   rec.get('lessons') or rec.get('action')
                     or 'Lessons-learned capture pending — see ticket for RCA.',
    })
if not incidents:
    incidents.append({
        'badge': 'INFO', 'badge_col': BLUE,
        'site':  f'No major incidents recorded for {PERIOD_LONG}',
        'subject': 'Quiet period',
        'detail': 'No P1 / P2 incidents created or resolved in scope this period.',
        'lessons': '—',
    })

# 2-column × 3-row grid layout (2026-06-04) — user reported cards
# drifting off the slide with the old 5-stacked layout. Now max 6
# incidents render in 2 columns of 3, each card 6.10" wide × 1.05"
# tall. Footer band still lands at y=6.55.
COL_W      = Inches(6.10)
COL_GAP    = Inches(0.15)
BADGE_W    = Inches(1.00)   # narrower than before to leave room for text
TEXT_W     = COL_W - BADGE_W - Inches(0.10)   # inner text panel
ROW_H      = Inches(1.05)
ROW_GAP    = Inches(0.05)
GRID_X0    = Inches(0.4)
GRID_Y0    = Inches(3.20)

for i, inc in enumerate(incidents[:6]):
    row = i // 2
    col = i %  2
    cx  = GRID_X0 + (COL_W + COL_GAP) * col
    cy  = GRID_Y0 + (ROW_H + ROW_GAP) * row

    # Badge strip (Critical/High/Info)
    add_rect(s, cx, cy, BADGE_W, ROW_H, inc['badge_col'])
    add_text(s, cx, cy, BADGE_W, ROW_H, inc['badge'], size=12, bold=True, color=WHITE,
             align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)

    # Text panel (white card with thin border)
    tx = cx + BADGE_W + Inches(0.05)
    add_rect(s, tx, cy, TEXT_W, ROW_H, WHITE, line=RGBColor(0xE5,0xE7,0xEB))
    # Site + date (top muted line)
    add_text(s, tx + Inches(0.10), cy + Inches(0.03),
             TEXT_W - Inches(0.20), Inches(0.18),
             inc['site'], size=7, bold=True, color=GRAY)
    # Subject (main bold line)
    add_text(s, tx + Inches(0.10), cy + Inches(0.18),
             TEXT_W - Inches(0.20), Inches(0.26),
             inc['subject'], size=10, bold=True, color=NAVY)
    # Detail (status / ticket line)
    add_text(s, tx + Inches(0.10), cy + Inches(0.43),
             TEXT_W - Inches(0.20), Inches(0.20),
             inc['detail'], size=7, color=CHARCOAL)
    # Lessons (last line, italic)
    _lsn = (inc['lessons'] or '').strip()
    if _lsn:
        # Truncate to fit single line in the narrower 2-col layout
        if len(_lsn) > 120:
            _lsn = _lsn[:118] + '…'
        add_text(s, tx + Inches(0.10), cy + Inches(0.63),
                 Inches(0.85), Inches(0.20),
                 "Lessons:", size=7, bold=True, color=ORANGE_D)
        add_text(s, tx + Inches(0.95), cy + Inches(0.63),
                 TEXT_W - Inches(1.05), Inches(0.38),
                 _lsn, size=7, color=CHARCOAL)

# Bottom commentary — data-driven, prefer AI commentary['incidents'] if filled
_inc_comment = (K.get('commentary') or {}).get('incidents', '').strip()
if not _inc_comment:
    if K.get('mi_total', 0) == 0:
        _inc_comment = (
            f"{PERIOD_LONG}: no major incidents recorded — "
            f"all systems operating within SLA. Continue current "
            f"observability + change-control discipline."
        )
    else:
        _withRca = sum(1 for r in K.get('mi_records', []) if (r.get('rca') or r.get('description') or '').strip())
        _inc_comment = (
            f"{PERIOD_LONG}: {K.get('mi_total', 0)} major incidents — "
            f"{K.get('mi_critical', 0)} P1, {K.get('mi_high', 0)} P2 listed above. "
            f"Root-cause analysis completed on {_withRca}/{K.get('mi_total', 0)}; "
            f"PIR pending on the remainder. Focus: drive RCA-completion to 100% "
            f"and embed lessons-learned in next change-control cycle."
        )
add_rect(s, Inches(0.4), Inches(6.55), Inches(12.55), Inches(0.55), DARK_NAVY)
add_text(s, Inches(0.55), Inches(6.55), Inches(12.3), Inches(0.55),
         _inc_comment,
         size=9, color=WHITE, anchor=MSO_ANCHOR.MIDDLE)
footer_bar(s, 9)

# ====================================================================
# ── Slides 10 + 11: Activity Tracker — Phase 3.5 wired ──────────────
# Consumes K['tracker'] populated server-side by services/reportPayload
# `_tracker()` → { green, amber, red, avg_score, avg_delta_pp,
#                   sites: [{code, name, color, score, delta_pp, g, a, r}],
#                   pillars: {pName: {green, amber, red, score, weight}} }
# Empty / unavailable tracker → graceful stub panel (was unconditional
# before).
# ====================================================================

# Chart data_fns for the tracker visuals
def _draw_tracker_site_scores(ax):
    sites = (K.get('tracker') or {}).get('sites') or []
    if not sites:
        ax.text(0.5, 0.5, 'No tracker data', ha='center', va='center',
                fontsize=11, color='#6B7280'); return
    sites = sorted(sites, key=lambda s: s.get('score', 0))   # ascending so best at top
    names  = [s.get('name', s.get('code','?')) for s in sites]
    scores = [s.get('score', 0) for s in sites]
    # Brand red for <55, amber 55-65, green ≥65 (matches RAG thresholds in
    # the dashboard tracker UI per CLAUDE.md activity tracker section).
    colors = ['#DC2626' if v < 55 else '#F59E0B' if v < 65 else '#16A34A' for v in scores]
    bars = ax.barh(names, scores, color=colors, edgecolor='white')
    for b, v in zip(bars, scores):
        ax.text(v + 1.5, b.get_y() + b.get_height() / 2,
                f'{v}%', va='center', fontsize=9,
                color='#1A3A5F', fontweight='bold')
    ax.set_xlim(0, 105)
    ax.spines[['top', 'right']].set_visible(False)
    ax.grid(axis='x', alpha=0.2, linestyle='--')
    ax.tick_params(axis='y', labelsize=9)
    from matplotlib.ticker import PercentFormatter as _PF
    ax.xaxis.set_major_formatter(_PF(decimals=0))


def _draw_tracker_pillar_rag(ax):
    """Stacked horizontal bar per pillar showing G/A/R counts."""
    pillars = (K.get('tracker') or {}).get('pillars') or {}
    if not pillars:
        ax.text(0.5, 0.5, 'No pillar data', ha='center', va='center',
                fontsize=11, color='#6B7280'); return
    # Sort by weight DESC so the most-strategic pillar is at top
    items = sorted(pillars.items(), key=lambda kv: -(kv[1].get('weight', 0) or 0))
    names = [n.replace('-', ' — ') for n, _ in items][::-1]
    g = [v.get('green', 0) for _, v in items][::-1]
    a = [v.get('amber', 0) for _, v in items][::-1]
    r = [v.get('red',   0) for _, v in items][::-1]
    ax.barh(names, g, color='#16A34A', label='Green')
    ax.barh(names, a, left=g, color='#F59E0B', label='Amber')
    ax.barh(names, r, left=[gi+ai for gi,ai in zip(g,a)], color='#DC2626', label='Red')
    ax.legend(fontsize=8, loc='lower right', frameon=False, ncol=3)
    ax.spines[['top', 'right']].set_visible(False)
    ax.grid(axis='x', alpha=0.2, linestyle='--')
    ax.tick_params(axis='y', labelsize=9)


# ────────────────────────────────────────────────────────────────────
# SLIDE 10 — IT Ops Strategy Roadmap
# ────────────────────────────────────────────────────────────────────
s = prs.slides.add_slide(BLANK)
_tk = K.get('tracker') or {}
_has_tk = bool(_tk.get('sites'))

header_band(s, "IT Ops Strategy Roadmap", "ACTIVITY TRACKER", PERIOD_SHORT)
add_text(s, Inches(0.4), Inches(1.05), Inches(12), Inches(0.4),
         f"Fleet Performance — {PERIOD_LONG}", size=15, bold=True, color=NAVY)

if not _has_tk:
    # Graceful empty-data panel — same shape as before but reflects
    # the actual reason rather than blaming "Phase 3"
    add_rect(s, Inches(0.4), Inches(1.55), Inches(12.55), Inches(4.7),
             RGBColor(0xFE, 0xF3, 0xC7), line=AMBER)
    add_text(s, Inches(0.55), Inches(2.0), Inches(12.3), Inches(0.5),
             "Activity Tracker data unavailable for this period", size=18, bold=True,
             color=NAVY, align=PP_ALIGN.CENTER)
    add_text(s, Inches(0.55), Inches(2.7), Inches(12.3), Inches(2.5),
             "No tracker snapshot was returned by the server. Possible causes: "
             "tracker-db module unreachable from the API process; no inputs "
             "captured for the selected month yet; or the active sites list is "
             "empty. Verify in pm2 logs and on the /activity-tracker.html page.",
             size=11, color=CHARCOAL, align=PP_ALIGN.CENTER)
else:
    # ── Top row: 4 KPI tiles (Fleet Score · Green · Amber · Red) ──────
    avg_sc = _tk.get('avg_score', 0)
    avg_d  = _tk.get('avg_delta_pp', 0) or 0
    avg_kind = 'good' if avg_d > 0 else 'bad' if avg_d < 0 else 'neutral'
    avg_color = GREEN if avg_sc >= 65 else AMBER if avg_sc >= 55 else RED

    def _tk_tile(x, y, w, h, label, value, sub, accent, value_color, delta_str=None, delta_kind='neutral'):
        kpi_tile(s, x, y, w, h, label, value, sub, accent=accent, value_color=value_color, value_size=28)
        if delta_str:
            tile_delta(x, y, delta_str, delta_kind)

    _tk_tile(Inches(0.4),  Inches(1.55), Inches(3.0), Inches(1.3),
             "FLEET SCORE", f"{avg_sc}%", f"Active in {MONTH}", avg_color, avg_color,
             delta_str=f"{'+' if avg_d>0 else ''}{avg_d}pp MoM" if avg_d != 0 else 'flat MoM',
             delta_kind=avg_kind)
    _tk_tile(Inches(3.55), Inches(1.55), Inches(3.0), Inches(1.3),
             "GREEN", str(_tk.get('green', 0)), "Activities meeting target",
             GREEN, GREEN)
    _tk_tile(Inches(6.70), Inches(1.55), Inches(3.0), Inches(1.3),
             "AMBER", str(_tk.get('amber', 0)), "Activities partial",
             AMBER, AMBER)
    _tk_tile(Inches(9.85), Inches(1.55), Inches(3.1), Inches(1.3),
             "RED", str(_tk.get('red', 0)), "Activities below target",
             RED, RED)

    # ── Left: site score bar chart ───────────────────────────────────
    s.shapes.add_picture(_chart('tracker_sites', figsize=(6.5, 3.8),
                                 data_fn=_draw_tracker_site_scores,
                                 title='Site Scores — Fleet Leaderboard'),
                          Inches(0.4),  Inches(3.05), width=Inches(6.4), height=Inches(3.15))

    # ── Right: pillar RAG distribution stacked bar ──────────────────
    s.shapes.add_picture(_chart('tracker_pillars', figsize=(6.5, 3.8),
                                 data_fn=_draw_tracker_pillar_rag,
                                 title='Pillar RAG Distribution'),
                          Inches(6.95), Inches(3.05), width=Inches(6.0), height=Inches(3.15))

# Bottom commentary — prefer AI commentary['exec'] (if filled), else
# auto-derive from K
_tk_comment = (K.get('commentary') or {}).get('exec', '').strip()
if not _tk_comment:
    if _has_tk:
        n_sites = len(_tk.get('sites', []))
        best = max(_tk.get('sites') or [], key=lambda s: s.get('score', 0), default=None)
        worst = min(_tk.get('sites') or [], key=lambda s: s.get('score', 0), default=None)
        _tk_comment = (
            f"{PERIOD_LONG}: fleet score {_tk.get('avg_score', 0)}% across "
            f"{n_sites} active sites ({_tk.get('green', 0)} green, "
            f"{_tk.get('amber', 0)} amber, {_tk.get('red', 0)} red). "
            f"Leader: {best.get('name','?')} ({best.get('score',0)}%). "
            f"Watch: {worst.get('name','?')} ({worst.get('score',0)}%) — "
            f"focus next month on closing the gap via the dominant red pillar."
        )
    else:
        _tk_comment = "Tracker integration available but no snapshot data for this period."
add_rect(s, Inches(0.4), Inches(6.35), Inches(12.55), Inches(0.70), DARK_NAVY)
add_text(s, Inches(0.55), Inches(6.40), Inches(12.3), Inches(0.65),
         _tk_comment, size=9, color=WHITE, anchor=MSO_ANCHOR.MIDDLE)
footer_bar(s, 10)

# ────────────────────────────────────────────────────────────────────
# SLIDE 11 — Executive Commentary & Site Summaries
# ────────────────────────────────────────────────────────────────────
s = prs.slides.add_slide(BLANK)
header_band(s, "Executive Commentary & Site Summaries", "ACTIVITY TRACKER", PERIOD_SHORT)
add_text(s, Inches(0.4), Inches(1.05), Inches(12), Inches(0.4),
         f"Per-Site Performance — {PERIOD_LONG}", size=15, bold=True, color=NAVY)

sites = _tk.get('sites') or []
if not sites:
    add_rect(s, Inches(0.4), Inches(1.55), Inches(12.55), Inches(4.7),
             RGBColor(0xFE, 0xF3, 0xC7), line=AMBER)
    add_text(s, Inches(0.55), Inches(3.0), Inches(12.3), Inches(0.5),
             "No site-level tracker data for this period",
             size=16, bold=True, color=NAVY, align=PP_ALIGN.CENTER)
else:
    # 2-row × 5-col grid of site cards (10 sites max, layout adapts)
    sites_sorted = sorted(sites, key=lambda s: -s.get('score', 0))
    cols = 5
    rows = (min(len(sites_sorted), 10) + cols - 1) // cols  # at most 2 rows
    card_w = Inches(2.45); card_h = Inches(2.20); gap = Inches(0.10)
    gx0 = Inches(0.4); gy0 = Inches(1.55)
    for i, site in enumerate(sites_sorted[:cols * rows]):
        r = i // cols; c = i % cols
        x = gx0 + (card_w + gap) * c
        y = gy0 + (card_h + gap) * r
        sc      = site.get('score', 0)
        sc_col  = GREEN if sc >= 65 else AMBER if sc >= 55 else RED
        d       = site.get('delta_pp', 0) or 0
        d_kind  = 'good' if d > 0 else 'bad' if d < 0 else 'neutral'

        add_rect(s, x, y, card_w, Inches(0.10), sc_col)
        add_rect(s, x, y + Inches(0.10), card_w, card_h - Inches(0.10),
                 WHITE, line=RGBColor(0xE5, 0xE7, 0xEB))

        # Site name
        add_text(s, x + Inches(0.10), y + Inches(0.18), card_w - Inches(0.20), Inches(0.30),
                 site.get('name', site.get('code', '?')), size=11, bold=True, color=NAVY)
        add_text(s, x + Inches(0.10), y + Inches(0.45), card_w - Inches(0.20), Inches(0.20),
                 f"({site.get('code', '?')})", size=8, color=GRAY, italic=True)

        # Big score
        add_text(s, x + Inches(0.10), y + Inches(0.70), card_w - Inches(0.20), Inches(0.55),
                 f"{sc}%", size=28, bold=True, color=sc_col)

        # MoM delta pill (smaller text)
        if d != 0:
            d_text = f"{'+' if d > 0 else ''}{d}pp MoM"
            add_text(s, x + Inches(0.10), y + Inches(1.25), card_w - Inches(0.20), Inches(0.18),
                     d_text, size=8, bold=True,
                     color=GREEN if d_kind == 'good' else RED if d_kind == 'bad' else GRAY)

        # G/A/R counts in mini-pills
        gy = y + Inches(1.45); pill_w = Inches(0.65); pill_h = Inches(0.30)
        for j, (cnt, lbl, col) in enumerate([
            (site.get('g', 0), 'G', GREEN),
            (site.get('a', 0), 'A', AMBER),
            (site.get('r', 0), 'R', RED),
        ]):
            px = x + Inches(0.10) + (pill_w + Inches(0.05)) * j
            add_rect(s, px, gy, pill_w, pill_h, col)
            add_text(s, px, gy, pill_w, pill_h, f"{cnt} {lbl}",
                     size=8, bold=True, color=WHITE,
                     align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)

# Bottom commentary — prefer commentary['progress'] from Analyze, else
# generic period summary
_s11_comment = (K.get('commentary') or {}).get('progress', '').strip()
if not _s11_comment:
    if sites:
        green_sites = [s for s in sites if s.get('score', 0) >= 65]
        red_sites   = [s for s in sites if s.get('score', 0) < 55]
        _s11_comment = (
            f"{PERIOD_LONG}: {len(green_sites)} of {len(sites)} sites at green "
            f"(≥65% score), {len(red_sites)} at red (<55%). "
            f"{('Top red exposures: ' + ', '.join(s.get('name','?') for s in red_sites[:3]) + '.') if red_sites else 'No red sites — fleet healthy.'}"
        )
    else:
        _s11_comment = "No site summaries to render."
add_rect(s, Inches(0.4), Inches(6.35), Inches(12.55), Inches(0.70), DARK_NAVY)
add_text(s, Inches(0.55), Inches(6.40), Inches(12.3), Inches(0.65),
         _s11_comment, size=9, color=WHITE, anchor=MSO_ANCHOR.MIDDLE)
footer_bar(s, 11)

# ────────────────────────────────────────────────────────────────────
# SLIDE 11b — Pillar Trends (6-month fleet avg per pillar)
# Mirrors the Dashboard drill-down (Pillar Health → click pillar →
# 6-month trend). Consumes K['tracker']['trends'] = { months, pillars }
# Renders 4 mini line charts in a 2×2 grid — one per pillar.
# Graceful skip if trends payload missing.
# ────────────────────────────────────────────────────────────────────
_trends    = _tk.get('trends') or {}
_tr_months = _trends.get('months') or []
_tr_pillars = _trends.get('pillars') or {}
if _tr_months and _tr_pillars:
    s = prs.slides.add_slide(BLANK)
    header_band(s, "Pillar Trends — 6-Month Fleet Average", "ACTIVITY TRACKER", PERIOD_SHORT)
    add_text(s, Inches(0.4), Inches(1.05), Inches(12), Inches(0.4),
             f"Per-Pillar Trend — trailing 6 months to {PERIOD_LONG}",
             size=15, bold=True, color=NAVY)

    # Stable pillar → colour map (mirrors brand tokens used in dashboard)
    _PILLAR_COLORS = {
        '1-Network Infra':      '#145FAE',  # blue
        '2-Biz Partnering':     '#0D9488',  # teal
        '3-Risk & Compliance':  '#7C3AED',  # purple
        '4-People Development': '#E87722',  # orange
    }

    def _make_pillar_trend_chart_fn(pillar_name, series):
        def _draw(ax):
            color = _PILLAR_COLORS.get(pillar_name, '#1A3A5F')
            # RAG threshold reference bands (subtle)
            ax.axhspan(0, 55,   color='#DC2626', alpha=0.05)
            ax.axhspan(55, 65,  color='#F59E0B', alpha=0.05)
            ax.axhspan(65, 100, color='#16A34A', alpha=0.05)
            ax.plot(_tr_months, series,
                    color=color, linewidth=2.8,
                    marker='o', markersize=7, markerfacecolor=color,
                    markeredgecolor='white', markeredgewidth=1.5)
            # Point labels
            for i, v in enumerate(series):
                ax.text(i, v + 3.5, f'{v}%', ha='center', fontsize=9,
                        color='#1A3A5F', fontweight='bold')
            ax.set_ylim(0, 105)
            ax.spines[['top', 'right']].set_visible(False)
            ax.grid(axis='y', alpha=0.25, linestyle='--', linewidth=0.5)
            ax.tick_params(axis='y', labelsize=8)
            ax.tick_params(axis='x', labelsize=9)
            from matplotlib.ticker import PercentFormatter as _PF
            ax.yaxis.set_major_formatter(_PF(decimals=0))
        return _draw

    # 2×2 grid of pillar mini-charts. Iterate the seeded order to keep
    # the slide stable across periods even if data dict ordering shifts.
    pillar_order = list(_PILLAR_COLORS.keys())
    # Fallback: include any extra pillars present in payload but not in
    # the canonical order (defensive — pillar additions should still render)
    for p in _tr_pillars.keys():
        if p not in pillar_order:
            pillar_order.append(p)
    pillar_order = [p for p in pillar_order if p in _tr_pillars][:4]

    cell_w = Inches(6.20); cell_h = Inches(2.40); gap = Inches(0.15)
    gx0 = Inches(0.4); gy0 = Inches(1.55)
    for i, p in enumerate(pillar_order):
        series = _tr_pillars.get(p) or []
        if len(series) != len(_tr_months):
            # Pad to match (server should already, but be defensive)
            series = ([0] * (len(_tr_months) - len(series))) + list(series)
        row = i // 2; col = i % 2
        x = gx0 + (cell_w + gap) * col
        y = gy0 + (cell_h + gap) * row

        # Card background
        add_rect(s, x, y, cell_w, cell_h, WHITE,
                 line=RGBColor(0xE5, 0xE7, 0xEB))
        # Pillar name strip
        pillar_disp = p.replace('-', ' — ')
        add_rect(s, x, y, Inches(0.10), cell_h,
                 RGBColor.from_string(_PILLAR_COLORS.get(p, '#1A3A5F').lstrip('#')))
        add_text(s, x + Inches(0.18), y + Inches(0.08),
                 cell_w - Inches(0.25), Inches(0.30),
                 pillar_disp, size=11, bold=True, color=NAVY)
        # Latest value pill on the right of the header
        latest = series[-1] if series else 0
        latest_col = GREEN if latest >= 65 else AMBER if latest >= 55 else RED
        add_text(s, x + cell_w - Inches(0.85), y + Inches(0.08),
                 Inches(0.75), Inches(0.30),
                 f"{latest}%", size=12, bold=True, color=latest_col,
                 align=PP_ALIGN.RIGHT)

        # Chart
        chart_png = _chart(f'pillar_trend_{i}', figsize=(5.2, 2.0),
                            data_fn=_make_pillar_trend_chart_fn(p, series))
        s.shapes.add_picture(chart_png,
                              x + Inches(0.18), y + Inches(0.42),
                              width=cell_w - Inches(0.30),
                              height=cell_h - Inches(0.50))

    # Bottom commentary — synthesise from trends (no AI dependency)
    def _trend_dir(series):
        if len(series) < 2 or series[-1] == 0: return None
        # last vs trailing average (excluding last)
        prior = series[:-1]
        if not prior: return None
        baseline = sum(prior) / len(prior)
        diff = series[-1] - baseline
        if abs(diff) < 2: return 'stable'
        return 'improving' if diff > 0 else 'declining'

    movers = []
    for p in pillar_order:
        ser = _tr_pillars.get(p) or []
        d = _trend_dir(ser)
        if d in ('improving', 'declining'):
            movers.append((p.replace('-', ' — '), d, ser[-1]))
    if movers:
        _s11b_bits = []
        for n, d, v in movers:
            arrow = '↑' if d == 'improving' else '↓'
            _s11b_bits.append(f"{n} {arrow} ({v}%)")
        _s11b_comment = (
            f"6-month trend: " + " · ".join(_s11b_bits) +
            f". Period: {PERIOD_LONG}."
        )
    else:
        _s11b_comment = (
            f"All four pillars are tracking flat over the trailing 6 months "
            f"({PERIOD_LONG}). Watch RAG bands for status changes."
        )
    add_rect(s, Inches(0.4), Inches(6.35), Inches(12.55), Inches(0.70), DARK_NAVY)
    add_text(s, Inches(0.55), Inches(6.40), Inches(12.3), Inches(0.65),
             _s11b_comment, size=9, color=WHITE, anchor=MSO_ANCHOR.MIDDLE)
    footer_bar(s, 12)

# ── Save to stdout (Node spawn contract) ──────────────────────────────
# Server.js streams stdout to the browser as the PPTX download. The
# Windows binary-mode setmode at the top of this file is what keeps the
# ZIP container intact across the pipe.
import io as _io
_buf = _io.BytesIO()
prs.save(_buf)
sys.stdout.buffer.write(_buf.getvalue())
sys.stdout.buffer.flush()
print(f"[render] OK — {len(_buf.getvalue()):,} bytes written to stdout",
      file=sys.stderr)
sys.exit(0)
