"""
Endeavour Mining — Group IT Operations Report (April 2026)
Built from scratch using brand color scheme.
"""
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

with open('kpis.json') as f:
    K = json.load(f)

prs = Presentation()
prs.slide_width = SLIDE_W
prs.slide_height = SLIDE_H

BLANK = prs.slide_layouts[6]

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
    banner_pic = slide.shapes.add_picture('em_banner.jpg', 0, BANNER_Y,
                                          width=SLIDE_W, height=BANNER_H)
    # Bottom-right corner accent — shorter, lifted above the banner
    CORNER_W = Inches(0.85)
    CORNER_H = Inches(0.16)        # was 0.55 — trimmed per user adjustment
    CORNER_X = Inches(12.473)
    CORNER_Y = Inches(7.18)
    corner_pic = slide.shapes.add_picture('left_corner.png', CORNER_X, CORNER_Y,
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
         "April 2026", size=22, color=WHITE)
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

# vs March: 1598/1502/87.7%/226/1/30
cover_stat(Inches(6.4), Inches(2.5), f"{K['total']:,}", "TOTAL TICKETS", "-9% vs Mar", "neutral")
cover_stat(Inches(8.7), Inches(2.5), f"{K['closure_rate']:.1f}%", "CLOSURE RATE", "-2.5pp vs Mar", "bad")
cover_stat(Inches(11.0), Inches(2.5), f"{K['sla_compliance']:.1f}%", "SLA COMPLIANCE", "+1.3pp vs Mar", "good")
cover_stat(Inches(6.4), Inches(3.9), f"{K['open_backlog']}", "OPEN BACKLOG", "-12% vs Mar", "good")
cover_stat(Inches(8.7), Inches(3.9), f"{K['mi_total']}", "MAJOR INCIDENTS", "+2 vs Mar", "bad")
cover_stat(Inches(11.0), Inches(3.9), f"{K['changes_total']}", "CHANGES (NEW)", "-8 vs Mar", "neutral")

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
         "April 2026", size=12, bold=True, color=ORANGE, align=PP_ALIGN.RIGHT, anchor=MSO_ANCHOR.MIDDLE)

# Owner block left
add_rect(s, Inches(0.4), Inches(1.05), Inches(3.6), Inches(1.5), LIGHT_GRAY, line=RGBColor(0xE5,0xE7,0xEB))
add_text(s, Inches(0.55), Inches(1.15), Inches(3.4), Inches(0.4),
         "Mohamed Diagne", size=14, bold=True, color=NAVY)
add_text(s, Inches(0.55), Inches(1.55), Inches(3.4), Inches(0.35),
         "IT Operations  ·  Mines & Exploration", size=11, italic=True, color=GRAY)
# Owner KV grid
labels_kv = [("Reporting Month","April"),("Financial Year","2026"),("Headcount (inc. Contract)","7")]
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
# Progress
add_rect(s, Inches(0.4), col_y, Inches(6.2), Inches(0.35), GREEN)
add_text(s, Inches(0.55), col_y, Inches(6), Inches(0.35), "Progress since last period",
         size=11, bold=True, color=WHITE, anchor=MSO_ANCHOR.MIDDLE)
add_rect(s, Inches(0.4), col_y+Inches(0.35), Inches(6.2), col_h, WHITE, line=RGBColor(0xE5,0xE7,0xEB))
prog_lines = [
    ("• Helpdesk Apr: ", 9, True, NAVY),
    (f"1,465 tickets, {K['closure_rate']:.1f}% closure, Res SLA {K['sla_compliance']:.0f}% (+1.3pp, 1pp from target).", 9, False, CHARCOAL),
    ("• Toolbox Meetings: ", 9, True, NAVY),
    ("video + PPT content rolled out to sites for dynamic display.", 9, False, CHARCOAL),
    ("• Tooling: ", 9, True, NAVY),
    ("CSV import + drill-down dashboards live for action tracking.", 9, False, CHARCOAL),
    ("• 4MP V2 Launch: ", 9, True, NAVY),
    ("Finance pilot underway with 9-box, mentoring, dev plans.", 9, False, CHARCOAL),
    ("• Change Governance: ", 9, True, NAVY),
    ("22 changes — 15 Standard / 6 Major / 1 Emergency (CHG-254 SML).", 9, False, CHARCOAL),
]
add_multi_text(s, Inches(0.55), col_y+Inches(0.45), Inches(6.0), col_h-Inches(0.2), prog_lines, line_space=1.15)

# Issues / Risks
add_rect(s, Inches(6.75), col_y, Inches(6.2), Inches(0.35), AMBER)
add_text(s, Inches(6.9), col_y, Inches(6), Inches(0.35), "Issues / Risks / Comments",
         size=11, bold=True, color=WHITE, anchor=MSO_ANCHOR.MIDDLE)
add_rect(s, Inches(6.75), col_y+Inches(0.35), Inches(6.2), col_h, WHITE, line=RGBColor(0xE5,0xE7,0xEB))
issue_lines = [
    ("• 3 Major Incidents (Apr): ", 9, True, RED),
    ("Hounde power-outage, Abidjan WiFi/DHCP, Sabodala Feb-MI follow-up.", 9, False, CHARCOAL),
    ("• MTN Lafigué link: ", 9, True, RED),
    ("formal complaint letter being drafted by GL; meeting requested.", 9, False, CHARCOAL),
    (f"• FRT SLA at {K['frt_sla']:.1f}% (-0.2pp) — ", 9, True, AMBER),
    ("remaining gap; Res SLA 89% within 1pp of 90% target.", 9, False, CHARCOAL),
    (f"• Open Backlog {K['open_backlog']} tickets: ", 9, True, AMBER),
    ("Sabodala 38, Abidjan 27, Explor. CI 15 carrying highest load.", 9, False, CHARCOAL),
    ("• Recurring incidents: ", 9, True, AMBER),
    ("Acronis VM crashes, fiber cuts, backup issues — joint review.", 9, False, CHARCOAL),
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
header_band(s, "Executive Overview", "HELP DESK", "Apr 2026")
add_text(s, Inches(0.4), Inches(1.05), Inches(10), Inches(0.5),
         "April 2026 — At a Glance", size=18, bold=True, color=NAVY)

# 12 KPI tiles in 3 rows × 4 cols
TILE_W = Inches(3.0); TILE_H = Inches(1.55); GAP = Inches(0.13)
ORIGIN_X = Inches(0.4); ORIGIN_Y = Inches(1.65)

def get_pos(row, col):
    return (ORIGIN_X + (TILE_W+GAP)*col, ORIGIN_Y + (TILE_H+GAP)*row)

# Helper: place a delta pill in the top-right corner of a tile
def tile_delta(x, y, txt, kind):
    delta_pill(s, x + TILE_W - Inches(1.30), y + Inches(0.08), txt, kind=kind, dark_bg=False, w=Inches(1.20), size=9)

# Row 1
x,y = get_pos(0,0); kpi_tile(s,x,y,TILE_W,TILE_H,"TOTAL TICKETS", f"{K['total']:,}", "Created in April", accent=BLUE, value_size=32);                  tile_delta(x,y,"-9% MoM","neutral")
x,y = get_pos(0,1); kpi_tile(s,x,y,TILE_W,TILE_H,"CLOSED TICKETS", f"{K['closed']:,}", f"{K['closure_rate']:.1f}% closure rate", accent=GREEN, value_size=32); tile_delta(x,y,"-15% MoM","bad")
x,y = get_pos(0,2); kpi_tile(s,x,y,TILE_W,TILE_H,"SLA COMPLIANCE (Res)", f"{K['sla_compliance']:.1f}%", "Target ≥ 90%  ⚠", accent=AMBER, value_color=NAVY, value_size=32); tile_delta(x,y,"+1.3pp MoM","good")
x,y = get_pos(0,3); kpi_tile(s,x,y,TILE_W,TILE_H,"OPEN BACKLOG", f"{K['open_backlog']}", "Active open tickets", accent=ORANGE, value_size=32);          tile_delta(x,y,"-12% MoM","good")

# Row 2
x,y = get_pos(1,0); kpi_tile(s,x,y,TILE_W,TILE_H,"FCR RATE", f"{K['fcr_rate']:.1f}%", "First Contact Resolution", accent=GREEN, value_color=GREEN, value_size=32); tile_delta(x,y,"+5pp MoM","good")
x,y = get_pos(1,1); kpi_tile(s,x,y,TILE_W,TILE_H,"FRT SLA", f"{K['frt_sla']:.1f}%", "Target ≥ 90%  ⚠", accent=RED, value_size=32);                       tile_delta(x,y,"-0.2pp MoM","bad")
x,y = get_pos(1,2); kpi_tile(s,x,y,TILE_W,TILE_H,"AVG RESOLUTION", f"{K['avg_res_days']}d", "MTTR — all tickets", accent=BLUE, value_size=32);             tile_delta(x,y,"-1d MoM","good")

# Row 3
x,y = get_pos(2,0); kpi_tile(s,x,y,TILE_W,TILE_H,"CHANGES (NEW)", f"{K['changes_total']}", "Created this period", accent=BLUE, value_size=32);            tile_delta(x,y,"-8 MoM","neutral")
x,y = get_pos(2,1); kpi_tile(s,x,y,TILE_W,TILE_H,"EMERGENCY CHANGES", f"{K['changes_type'].get('Emergency',0)}", f"{K['changes_type'].get('Emergency',0)/max(K['changes_total'],1)*100:.1f}% — Target < 5%", accent=AMBER, value_size=32); tile_delta(x,y,"flat MoM","neutral")
x,y = get_pos(2,2); kpi_tile(s,x,y,TILE_W,TILE_H,"MAJOR INCIDENTS", f"{K['mi_total']}", f"{K['mi_critical']} P1 · {K['mi_high']} P2", accent=RED, value_color=RED, value_size=32); tile_delta(x,y,"+2 MoM","bad")
x,y = get_pos(2,3); kpi_tile(s,x,y,TILE_W,TILE_H,"SUPPORT GROUPS", f"{len(K['groups'])}", "Active in April", accent=GREEN, value_size=32);                tile_delta(x,y,"+1 MoM","good")

# Bottom commentary band
add_rect(s, Inches(0.4), Inches(6.55), Inches(12.55), Inches(0.55), DARK_NAVY)
add_text(s, Inches(0.55), Inches(6.55), Inches(12.3), Inches(0.55),
         f"Apr '26: 1,465 tickets, {K['closure_rate']:.1f}% closure, Resolution SLA {K['sla_compliance']:.0f}% (+1.3pp, just below 90% target ⚠), FRT SLA {K['frt_sla']:.1f}% (-0.2pp). {K['mi_total']} major incidents (2 Critical: Hounde power outage + Abidjan WiFi/DHCP — both contained). {K['changes_total']} new changes; emergency rate {K['changes_type'].get('Emergency',0)/max(K['changes_total'],1)*100:.0f}% (CHG-254 SML disk-space). Focus: close 1pp gap to 90% Res SLA target; lift FRT to 90%.",
         size=9, color=WHITE, anchor=MSO_ANCHOR.MIDDLE)
footer_bar(s, 3)

# ====================================================================
# SLIDE 4 — Helpdesk Operations 12-Month Trend
# ====================================================================
s = prs.slides.add_slide(BLANK)
header_band(s, "Helpdesk Operations — 12-Month Trend", "HELP DESK", "Apr 2026")
add_text(s, Inches(0.4), Inches(1.05), Inches(10), Inches(0.4),
         "Ticket Volume & SLA Compliance Trend", size=15, bold=True, color=NAVY)

# Big chart left, summary right
s.shapes.add_picture('charts/c1_volume_trend.png', Inches(0.4), Inches(1.55), width=Inches(8.6), height=Inches(4.5))

# Right: TWO KPI tiles side-by-side (FRT SLA + Res. SLA), then SLA trend chart below
kpi_tile(s, Inches(9.2), Inches(1.55), Inches(1.80), Inches(1.4),
         "FRT SLA", f"{K['frt_sla']:.1f}%", "Target ≥ 90%  ⚠", accent=RED, value_size=24)
kpi_tile(s, Inches(11.10), Inches(1.55), Inches(1.80), Inches(1.4),
         "RES. SLA", f"{K['sla_compliance']:.0f}%", "Target ≥ 90%  ⚠", accent=AMBER, value_color=NAVY, value_size=24)

s.shapes.add_picture('charts/c2_sla_trend.png', Inches(9.2), Inches(3.10), width=Inches(3.7), height=Inches(2.95))

# Bottom commentary
add_rect(s, Inches(0.4), Inches(6.25), Inches(12.55), Inches(0.85), DARK_NAVY)
add_text(s, Inches(0.55), Inches(6.32), Inches(12.3), Inches(0.75),
         f"Resolution SLA {K['sla_compliance']:.0f}% (+1.3pp MoM) — within 1pp of the 90% target. FRT SLA at {K['frt_sla']:.1f}% (-0.2pp) remains the main gap. Software/Apps ({K['categories'].get('Software and Applications',0)} tickets) and IT Infrastructure ({K['categories'].get('IT Infrastructure',0)}) are 40% of volume. Action: close the SLA gap to 90% and lift FRT via dedicated first-response triage across top 3 sites.",
         size=9, color=WHITE, anchor=MSO_ANCHOR.MIDDLE)
footer_bar(s, 4)

# ====================================================================
# SLIDE 5 — Ticket Distribution & Channel
# ====================================================================
s = prs.slides.add_slide(BLANK)
header_band(s, "Ticket Distribution & Submission Channel", "HELP DESK", "Apr 2026")
add_text(s, Inches(0.4), Inches(1.05), Inches(12), Inches(0.4),
         "Tickets by Category & Channel Trend — April 2026", size=15, bold=True, color=NAVY)

# Top-left: category bar chart (kept) — narrower
s.shapes.add_picture('charts/c3_categories.png', Inches(0.4), Inches(1.55), width=Inches(5.5), height=Inches(4.6))

# Top-right: NEW channel TREND line chart (E-Mail vs Web Form % over 12 months)
s.shapes.add_picture('charts/c4b_channel_trend.png', Inches(6.05), Inches(1.55), width=Inches(6.95), height=Inches(3.4))

# April highlight tiles below the trend chart
apr_email = K['channel'].get('E-Mail',0)
apr_web   = K['channel'].get('Web Form',0)
apr_email_pct = apr_email/K['total']*100
apr_web_pct   = apr_web/K['total']*100
mar_email_pct = 1043/1598*100   # 65.3
mar_web_pct   = 319/1598*100    # 20.0
d_email = apr_email_pct - mar_email_pct
d_web   = apr_web_pct - mar_web_pct

def channel_pill(x, y, w, h, label, value, sub, accent, value_color):
    add_rect(s, x, y, Inches(0.10), h, accent)
    add_rect(s, x+Inches(0.10), y, w-Inches(0.10), h, WHITE, line=RGBColor(0xE5,0xE7,0xEB))
    add_text(s, x+Inches(0.20), y+Inches(0.07), w-Inches(0.30), Inches(0.25),
             label.upper(), size=9, bold=True, color=GRAY)
    add_text(s, x+Inches(0.20), y+Inches(0.30), w-Inches(0.30), Inches(0.55),
             value, size=26, bold=True, color=value_color)
    add_text(s, x+Inches(0.20), y+h-Inches(0.30), w-Inches(0.30), Inches(0.25),
             sub, size=9, color=GRAY)

channel_pill(Inches(6.05), Inches(5.05), Inches(3.40), Inches(1.10),
             "E-Mail (April)", f"{apr_email_pct:.1f}%",
             f"{apr_email:,} tickets  ·  {d_email:+.1f}pp vs Mar", BLUE, BLUE)
channel_pill(Inches(9.60), Inches(5.05), Inches(3.40), Inches(1.10),
             "Web Form (April)", f"{apr_web_pct:.1f}%",
             f"{apr_web:,} tickets  ·  {d_web:+.1f}pp vs Mar", ORANGE, ORANGE)

# Bottom commentary
mar_total = 1598
delta_pct = (K['total']-mar_total)/mar_total*100
add_rect(s, Inches(0.4), Inches(6.30), Inches(12.55), Inches(0.80), DARK_NAVY)
add_text(s, Inches(0.55), Inches(6.36), Inches(12.3), Inches(0.70),
         f"Volume {('decreased' if delta_pct<0 else 'increased')} {abs(delta_pct):.0f}% from March (1,598 → {K['total']:,}). Software/Apps now leads at {K['categories'].get('Software and Applications',0)} tickets (was 289). Web Form share rose to {apr_web_pct:.0f}% ({d_web:+.1f}pp) — strongest single-month portal-adoption gain in 12 months — while E-Mail is at {apr_email_pct:.0f}% ({d_email:+.1f}pp). Continued portal push expected to bring Web Form past 30% in May.",
         size=9, color=WHITE, anchor=MSO_ANCHOR.MIDDLE)
footer_bar(s, 5)

# ====================================================================
# SLIDE 6 — SLA Compliance & Ageing
# ====================================================================
s = prs.slides.add_slide(BLANK)
header_band(s, "SLA Compliance & Ticket Ageing by Group", "HELP DESK", "Apr 2026")
add_text(s, Inches(0.4), Inches(1.05), Inches(10), Inches(0.4),
         "Ageing Backlog — Open Tickets by Group", size=15, bold=True, color=NAVY)

s.shapes.add_picture('charts/c5_ageing.png', Inches(0.4), Inches(1.55), width=Inches(7.8), height=Inches(4.6))

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
top_age = list(K['ageing'].items())[:5]
ag_lines = []
for g, v in top_age:
    short = g.replace(' IT Agents','').replace(' IT Agent','').replace(' Support','')
    ag_lines.append((f"{short}: {v['open']} open  ", 9, True, NAVY))
    ag_lines.append((f"({v['under_30']} <30d, {v['30_60']} 30-60d, {v['over_60']} >60d)", 9, False, GRAY))
add_multi_text(s, Inches(8.65), Inches(4.25), Inches(4.2), Inches(1.85), ag_lines, line_space=1.15)

# Bottom commentary
top_ag = list(K['ageing'].items())[:3]
top_summary = ", ".join([f"{g.replace(' IT Agents','').replace(' IT Agent','').replace(' Support','')} {v['open']}" for g,v in top_ag])
total_open = sum(v['open'] for v in K['ageing'].values())
add_rect(s, Inches(0.4), Inches(6.25), Inches(12.55), Inches(0.85), DARK_NAVY)
add_text(s, Inches(0.55), Inches(6.32), Inches(12.3), Inches(0.75),
         f"April open backlog: {total_open} tickets across {len(K['ageing'])} Operations groups. Highest concentration: {top_summary}. All tickets currently within 30 days — no >60-day items, indicating active triage. Engagement ongoing with external providers and procurement to unblock hardware/software dependencies; site recruitment progressing for Mana / Dakar / Sabodala.",
         size=9, color=WHITE, anchor=MSO_ANCHOR.MIDDLE)
footer_bar(s, 6)

# ====================================================================
# SLIDE 7 — Customer Satisfaction & Voice
# ====================================================================
s = prs.slides.add_slide(BLANK)
header_band(s, "Customer Satisfaction & Voice", "HELP DESK", "Apr 2026")
add_text(s, Inches(0.4), Inches(1.05), Inches(10), Inches(0.4),
         "CSAT & Net Promoter Score — April 2026", size=15, bold=True, color=NAVY)

s.shapes.add_picture('charts/c7_survey.png', Inches(0.4), Inches(1.55), width=Inches(4.5), height=Inches(4.3))

# CSAT card
kpi_tile(s, Inches(5.1), Inches(1.55), Inches(3.85), Inches(2.0), "CSAT (% Satisfied)", f"{K['csat_pct']}%",
         "Target ≥ 80%  ✓  above target", accent=GREEN, value_color=GREEN, value_size=42)
add_text(s, Inches(5.30), Inches(3.10), Inches(3.6), Inches(0.3), f"April survey · {K['csat_total_responses']} responses · {K['csat_satisfied']} satisfied", size=9, color=GRAY)

# Average score card (NPS not measured this month — survey has no NPS questions)
kpi_tile(s, Inches(9.10), Inches(1.55), Inches(3.85), Inches(2.0), "AVG SURVEY SCORE", f"{K['csat_avg_score']:.1f}%",
         "Overall ticket-resolution rating", accent=BLUE, value_color=BLUE, value_size=42)
add_text(s, Inches(9.30), Inches(3.10), Inches(3.6), Inches(0.3), f"NPS not measured this month (survey has no NPS questions)", size=9, color=GRAY)

# Pain points panel
add_rect(s, Inches(5.1), Inches(3.7), Inches(7.85), Inches(2.2), WHITE, line=RGBColor(0xE5,0xE7,0xEB))
add_text(s, Inches(5.25), Inches(3.78), Inches(7.7), Inches(0.3),
         f"TOP PAIN POINTS  (April survey · {K['csat_dissatisfied']} dissatisfied responses analysed)", size=10, bold=True, color=NAVY)

# Derive top-3 pain themes dynamically from the April survey free-text
# (filter to Dissatisfied responses; categorize via keyword regex; count by theme)
def _derive_pain_points():
    import pandas as pd, re, collections
    sv = pd.read_csv('/sessions/vibrant-great-darwin/mnt/Monthly-Reports/April/Full_Zoho_Survey_Aggregation_Query_Clde_all-time.csv', low_memory=False)
    sv['RespDT'] = pd.to_datetime(sv['zr.Survey Responded on'], format='%d %b, %Y %H:%M:%S', errors='coerce')
    apr = sv[(sv['RespDT']>=pd.Timestamp('2026-04-01')) & (sv['RespDT']<pd.Timestamp('2026-05-01'))]
    pain_rows = apr[apr['CSAT Category'].isin(['Dissatisfied','Very Dissatisfied'])]
    def is_substantive(s):
        if pd.isna(s): return False
        s = str(s).strip()
        if not s or s.isdigit() or len(s) < 5: return False
        if re.fullmatch(r'(yes|no|ras|ok|excellent|n/a|nil)', s, re.IGNORECASE): return False
        return True
    texts = []
    for _, r in pain_rows.iterrows():
        for col in ('Answer Text','Answer Comment'):
            v = r.get(col)
            if is_substantive(v): texts.append(str(v).strip())
    texts = list(dict.fromkeys(texts))
    themes = {
        'Long-running / Unresolved': [r"\bpending\b", r"\bnot.{0,20}resolved?\b", r"\bnot.{0,20}received\b",
            r"three months", r"long time", r"toujours pas", r"pas.{0,10}r[eé]solu", r"pas.{0,10}encore",
            r"haven['\u2019 ]?t.{0,10}received", r"is pending"],
        'No Solution / Persistent Issue': [r"persiste", r"persist", r"every.{0,10}time",
            r"pas de solution", r"no solution"],
        'Communication / Proof of Action': [r"no.{0,10}indication", r"\bproof\b", r"feedback",
            r"have not received any indication", r"directed.{0,5}us"],
        'Equipment / Hardware Delivery': [r"adopter", r"adapter", r"laptop.*replac", r"don[nv][eé]es", r"my data"],
        'Access / Account / Password': [r"password", r"access\b", r"compte.{0,15}fonction", r"acc[eè]s"],
    }
    cats = collections.defaultdict(list)
    for c in texts:
        cl = c.lower(); placed = False
        for theme, pats in themes.items():
            if any(re.search(p, cl) for p in pats):
                cats[theme].append(c); placed = True; break
        if not placed: cats['Generic Dissatisfaction'].append(c)
    ranked = sorted(cats.items(), key=lambda kv:-len(kv[1]))[:3]
    # Format for slide
    colors = [RED, AMBER, BLUE]
    out = []
    for i,(theme, comments) in enumerate(ranked):
        sample = comments[0][:90] if comments else ''
        sub = f"{len(comments)} mention" + ("s" if len(comments)!=1 else "") + (f' — "{sample}"' if sample else '')
        out.append((str(i+1), theme, sub, colors[i]))
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

# Bottom commentary
add_rect(s, Inches(0.4), Inches(6.10), Inches(12.55), Inches(0.95), DARK_NAVY)
add_text(s, Inches(0.55), Inches(6.18), Inches(12.3), Inches(0.85),
         f"April survey: {K['csat_total_responses']} responses, CSAT {K['csat_pct']}% (target ≥80% ✓). {K['csat_satisfied']} satisfied / {K['csat_dissatisfied']} dissatisfied / {K['csat_no_rating']} no-rating. Avg overall score {K['csat_avg_score']:.1f}%. NPS questions not present in this survey — measure via direct survey item next cycle. Continue addressing the 8 dissatisfied responses with proactive FRT triage and status-update cadence on long-running tickets.",
         size=9, color=WHITE, anchor=MSO_ANCHOR.MIDDLE)
footer_bar(s, 7)

# ====================================================================
# SLIDE 8 — Change Management
# ====================================================================
s = prs.slides.add_slide(BLANK)
header_band(s, "Change Management", "HELP DESK", "Apr 2026")
add_text(s, Inches(0.4), Inches(1.05), Inches(10), Inches(0.4),
         "Change Portfolio — April 2026", size=15, bold=True, color=NAVY)

s.shapes.add_picture('charts/c6_changes_donut.png', Inches(0.4), Inches(1.55), width=Inches(4.7), height=Inches(4.5))

# 6 KPI tiles in 2x3
ct = K['changes_type']
total_ch = K['changes_total']
emerg_ch = ct.get('Emergency',0)
emerg_pct = emerg_ch/max(total_ch,1)*100
status = K['changes_status']
completed = status.get('Completed',0)
in_prog = status.get('In Progress',0)

t_cards = [
    ("TOTAL CHANGES", str(total_ch), "Created in April", BLUE),
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

# Bottom commentary
add_rect(s, Inches(0.4), Inches(6.20), Inches(12.55), Inches(0.85), DARK_NAVY)
add_text(s, Inches(0.55), Inches(6.27), Inches(12.3), Inches(0.75),
         f"Change activity in April: {total_ch} new requests with {ct.get('Standard',0)} standard, {ct.get('Major',0)} major, {emerg_ch} emergency — emergency rate {emerg_pct:.1f}% (within 5% threshold). All major changes flowed through proper CAB governance. Pipeline health: {completed} completed, {in_prog} in progress, plus {status.get('Requested',0)} awaiting submission and {status.get('Approval Pending',0)} pending approval. Focus area: tighten approval cycle on pre-approval items.",
         size=9, color=WHITE, anchor=MSO_ANCHOR.MIDDLE)
footer_bar(s, 8)

# ====================================================================
# SLIDE 9 — Major Incidents & Escalations
# ====================================================================
s = prs.slides.add_slide(BLANK)
header_band(s, "Major Incidents & Escalations", "HELP DESK", "Apr 2026")
add_text(s, Inches(0.4), Inches(1.05), Inches(10), Inches(0.4),
         "Major Incident Summary — April 2026", size=15, bold=True, color=NAVY)

# Top 3 KPI tiles
kpi_tile(s, Inches(0.4), Inches(1.55), Inches(4.1), Inches(1.5), "P1 INCIDENTS", str(K['mi_critical']),
         "Critical priority", accent=RED, value_color=RED, value_size=40)
kpi_tile(s, Inches(4.65), Inches(1.55), Inches(4.1), Inches(1.5), "P2 INCIDENTS", str(K['mi_high']),
         "High priority", accent=AMBER, value_color=AMBER, value_size=40)
kpi_tile(s, Inches(8.90), Inches(1.55), Inches(4.05), Inches(1.5), "TOTAL MAJOR INCIDENTS", str(K['mi_total']),
         "Created in April", accent=BLUE, value_color=NAVY, value_size=40)

# Incident detail boxes
incidents = [
    {
        'badge':'CRITICAL', 'badge_col':RED,
        'site':'HOUNDE  ·  26 Apr 2026',
        'subject':'Power Outage — Main Admin Server Room',
        'detail':'Power outage on the administration area affected the main admin server room. UPS replaced; technical investigation completed; all services restored. Status: Closed.',
        'lessons':'Insist on dedicated generator for the area; accelerate commissioning of the requested generator to power the server room.',
    },
    {
        'badge':'CRITICAL', 'badge_col':RED,
        'site':'ABIDJAN  ·  Apr 2026',
        'subject':'Service Outage — WiFi, DHCP and core services down',
        'detail':'Multiple core services unavailable (WiFi, DHCP and others). Restored same-period. Status: Closed.',
        'lessons':'Reinforce monitoring and redundancy on DHCP/WiFi controllers; review on-call response procedure for Abidjan site.',
    },
    {
        'badge':'HIGH', 'badge_col':AMBER,
        'site':'SABODALA  ·  reopen 26 Apr 2026 (orig. 3-6 Feb)',
        'subject':'Service Disruption Follow-up — Server / EDV-WIFI',
        'detail':'Lessons-learned closure for the February 3rd & 6th major incident. Currently on-hold pending PIR sign-off and preventive measures verification.',
        'lessons':'Complete PIR documentation; close preventive action items; finalize permanent fix plan.',
    },
]
iy = Inches(3.20)
ih = Inches(1.00)
for i,inc in enumerate(incidents):
    yy = iy + (ih+Inches(0.10))*i
    add_rect(s, Inches(0.4), yy, Inches(1.5), ih, inc['badge_col'])
    add_text(s, Inches(0.4), yy, Inches(1.5), ih, inc['badge'], size=14, bold=True, color=WHITE,
             align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    add_rect(s, Inches(1.95), yy, Inches(11.0), ih, WHITE, line=RGBColor(0xE5,0xE7,0xEB))
    add_text(s, Inches(2.10), yy+Inches(0.04), Inches(10.7), Inches(0.18), inc['site'], size=8, bold=True, color=GRAY)
    add_text(s, Inches(2.10), yy+Inches(0.20), Inches(10.7), Inches(0.22), inc['subject'], size=11, bold=True, color=NAVY)
    add_text(s, Inches(2.10), yy+Inches(0.43), Inches(10.7), Inches(0.30), inc['detail'], size=8, color=CHARCOAL)
    add_text(s, Inches(2.10), yy+Inches(0.74), Inches(1.5), Inches(0.20), "Lessons / Actions:", size=8, bold=True, color=ORANGE_D)
    add_text(s, Inches(3.65), yy+Inches(0.74), Inches(9.2), Inches(0.25), inc['lessons'], size=8, color=CHARCOAL)

# Bottom commentary
add_rect(s, Inches(0.4), Inches(6.55), Inches(12.55), Inches(0.55), DARK_NAVY)
add_text(s, Inches(0.55), Inches(6.55), Inches(12.3), Inches(0.55),
         f"April 2026: {K['mi_total']} major incidents — 2 P1 (Hounde power-outage, Abidjan WiFi/DHCP) + 1 P2 (Sabodala Feb follow-up). All contained, no unresolved escalations carrying into May.",
         size=9, color=WHITE, anchor=MSO_ANCHOR.MIDDLE)
footer_bar(s, 9)

# ====================================================================
# SLIDE 10 — IT Ops Strategy Roadmap (rebuilt from refreshed Activity Tracker data)
# ====================================================================
s = prs.slides.add_slide(BLANK)
T = K['tracker']
# Title bar
add_rect(s, 0, 0, SLIDE_W, Inches(1.4), DARK_NAVY)
add_text(s, Inches(0.4), Inches(0.25), Inches(9), Inches(0.7),
         "IT Ops Strategy Roadmap", size=28, bold=True, color=WHITE)
add_text(s, Inches(0.4), Inches(0.95), Inches(9), Inches(0.35),
         f"April 2026  •  Progress Overview  •  5 Operating Sites  •  31 Activities", size=11, color=WHITE, italic=True)
add_rect(s, Inches(11.5), Inches(0.30), Inches(1.4), Inches(0.85), ORANGE)
add_text(s, Inches(11.5), Inches(0.30), Inches(1.4), Inches(0.50), "APR", size=18, bold=True, color=WHITE,
         align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
add_text(s, Inches(11.5), Inches(0.78), Inches(1.4), Inches(0.40), "2026", size=11, color=WHITE,
         align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)

# Big 5 stat cards — refreshed values
big = [
    (str(T['green']), "GREEN", GREEN, RGBColor(0xE0, 0xF2, 0xE4)),
    (str(T['amber']), "AMBER", AMBER, RGBColor(0xFE, 0xF3, 0xC7)),
    (str(T['red']),   "RED",   RED,   RGBColor(0xFE, 0xE2, 0xE2)),
    (f"{T['fleet_avg']}%", "AVG SCORE", BLUE, RGBColor(0xDB, 0xEA, 0xFE)),
    (f"+{T['fleet_delta_pp']}pp", "MoM Δ", GREEN, RGBColor(0xE0, 0xF2, 0xE4)),
]
bx = Inches(0.4); by = Inches(1.7); bw = Inches(2.45); bh = Inches(1.2)
for i,(v,l,colT,colBg) in enumerate(big):
    add_rect(s, bx + (bw+Inches(0.10))*i, by, bw, bh, colBg, line=colT)
    add_text(s, bx + (bw+Inches(0.10))*i, by+Inches(0.18), bw, Inches(0.55), v,
             size=36, bold=True, color=colT, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.TOP)
    add_text(s, bx + (bw+Inches(0.10))*i, by+Inches(0.78), bw, Inches(0.35), l,
             size=11, bold=True, color=colT, align=PP_ALIGN.CENTER)

# Two charts
s.shapes.add_picture('charts/c8_site_perf.png', Inches(0.4), Inches(3.10), width=Inches(6.2), height=Inches(3.5))
s.shapes.add_picture('charts/c9_rag_dist.png',  Inches(6.85), Inches(3.10), width=Inches(6.1), height=Inches(3.5))
add_text(s, Inches(0.4), Inches(6.75), Inches(12.55), Inches(0.3),
         "Source: IT Ops Objectives Tracker — Apr vs Mar 2026  |  Endeavour Mining PLC",
         size=8, italic=True, color=GRAY)
footer_bar(s, 10)

# ====================================================================
# SLIDE 11 — Site Summaries (rebuilt from refreshed tracker data)
# ====================================================================
s = prs.slides.add_slide(BLANK)
add_rect(s, 0, 0, SLIDE_W, Inches(1.0), DARK_NAVY)
add_text(s, Inches(0.4), Inches(0.20), Inches(11), Inches(0.7),
         "Executive Commentary & Site Summaries", size=24, bold=True, color=WHITE)
add_text(s, Inches(11.5), Inches(0.30), Inches(1.4), Inches(0.45), "Apr 2026", size=12, bold=True, color=ORANGE,
         align=PP_ALIGN.RIGHT)

# Pillar header strip — refreshed deltas
pd = T['pillar_delta_pp']
def fmt_delta(v):
    if v == 0: return "flat"
    return f"{v:+}pp"
pillars = [
    ("Network Infra (30%)", fmt_delta(pd['Network Infra']), BLUE),
    ("Biz Partnering (35%)", fmt_delta(pd['Biz Partnering']), ORANGE),
    ("Risk & Compl. (20%)", fmt_delta(pd['Risk & Compl.']), RGBColor(0x9C, 0x27, 0xB0)),
    ("People Dev (15%)", fmt_delta(pd['People Dev']), AMBER),
]
px = Inches(0.4); py = Inches(1.20); pw = Inches(3.05); ph = Inches(0.65)
for i,(lbl, dlt, col) in enumerate(pillars):
    add_rect(s, px+(pw+Inches(0.10))*i, py, pw, ph, col)
    add_text(s, px+(pw+Inches(0.10))*i+Inches(0.20), py+Inches(0.05), pw-Inches(0.4), Inches(0.30),
             lbl, size=10, bold=True, color=WHITE)
    add_text(s, px+(pw+Inches(0.10))*i+Inches(0.20), py+Inches(0.32), pw-Inches(0.4), Inches(0.30),
             dlt, size=14, bold=True, color=WHITE)

add_text(s, Inches(0.4), Inches(2.05), Inches(10), Inches(0.4),
         "Site-by-Site Summary", size=14, bold=True, color=NAVY)

site_codes = ['MGO','HGO','SML','ITY','SGO']
site_colors = [BLUE, ORANGE, RGBColor(0x9C,0x27,0xB0), AMBER, RGBColor(0x0E,0xA5,0xE9)]
site_notes = {
    'MGO': "LEADING (+10pp) — biggest gain. Network Infra +32pp standout. Toolbox & Awareness Campaigns newly GREEN. 71% on track to reach 80% by May.",
    'HGO': "+5pp improvement. Centralized Fire Suppression System newly GREEN. Power-outage MI handled (UPS swap completed).",
    'SML': "Holding steady at 59% (-1pp). People Dev -41pp escalation. CHG-254 Mining-VM disk space upgrade in progress.",
    'ITY': "LAGGING (-4pp). Newly RED: Monthly Department Meeting, Mid Year & Yearly Review. Network Infra at 9% — focus area.",
    'SGO': "+5pp recovery. Newly RED: Weekly Hazards Reporting, Monthly Mentoring/Coaching, Mid Year & Yearly Review. People Dev 18%.",
}
sx = Inches(0.4); sy = Inches(2.55); sw = Inches(2.45); sh = Inches(3.20); sgap = Inches(0.10)
for i, code in enumerate(site_codes):
    info = T['sites'][code]
    x = sx + (sw+sgap)*i
    col = site_colors[i]
    add_rect(s, x, sy, sw, Inches(0.55), col)
    add_text(s, x+Inches(0.15), sy+Inches(0.05), sw-Inches(0.3), Inches(0.30), code, size=18, bold=True, color=WHITE)
    add_text(s, x+Inches(0.15), sy+Inches(0.32), sw-Inches(0.3), Inches(0.20), info['name'], size=9, color=WHITE)
    add_rect(s, x, sy+Inches(0.55), sw, sh-Inches(0.55), WHITE, line=RGBColor(0xE5,0xE7,0xEB))
    add_text(s, x+Inches(0.15), sy+Inches(0.65), Inches(1.2), Inches(0.55), f"{info['score']}%", size=26, bold=True, color=NAVY)
    delta = info['delta']
    delta_kind = GREEN if delta > 0 else RED if delta < 0 else AMBER
    add_rect(s, x+Inches(1.4), sy+Inches(0.78), Inches(0.95), Inches(0.32), delta_kind)
    add_text(s, x+Inches(1.4), sy+Inches(0.78), Inches(0.95), Inches(0.32),
             f"{delta:+}pp" if delta else "flat", size=10, bold=True, color=WHITE,
             align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    pillsy = sy+Inches(1.30)
    for j,(lbl, color) in enumerate([(f"{info['g']}G",GREEN),(f"{info['a']}A",AMBER),(f"{info['r']}R",RED)]):
        px2 = x+Inches(0.15)+Inches(0.75)*j
        add_rect(s, px2, pillsy, Inches(0.65), Inches(0.32), color)
        add_text(s, px2, pillsy, Inches(0.65), Inches(0.32), lbl, size=10, bold=True, color=WHITE,
                 align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    add_text(s, x+Inches(0.15), sy+Inches(1.80), sw-Inches(0.3), sh-Inches(2.0), site_notes[code], size=9, color=CHARCOAL)

# General review
add_text(s, Inches(0.4), Inches(5.95), Inches(12), Inches(0.3),
         "General Review", size=13, bold=True, color=NAVY)
gen_lines = [
    ("✓  Fleet performance improving: 54%→57% (+3pp MoM), 35% on target, 70% showing progress.", 8, True, GREEN),
    ("✓  Newly GREEN: MGO Toolbox & Awareness · HGO Fire Suppression · SML Bandwidth.", 8, False, GREEN),
    ("⚠  People Dev pillar -32pp fleet-wide; SML People Dev -41pp; ITY Network Infra at 9% — escalation needed.", 8, True, AMBER),
    ("⚠  Systemic gap: Business Dept Incubation, Monthly Inspection, Mid/Yearly Review RED at all sites. 6 sites Off (ABJ/DKR/KLN/EXP/EDV/TND).", 8, False, AMBER),
]
add_multi_text(s, Inches(0.55), Inches(6.27), Inches(12.4), Inches(0.85), gen_lines, line_space=1.15)
footer_bar(s, 11)

# Save
out = 'Group_IT_Operations_Report_April_2026.pptx'
prs.save(out)
print(f"Saved: {out}")
