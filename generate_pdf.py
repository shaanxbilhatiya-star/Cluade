#!/usr/bin/env python3
"""
Generate RuraLift DSA Presentation PDF - 15 Pages
Professional, modern design with white background, landscape orientation.
Logo embedded on EVERY page. Uses raw PDF 1.4 format with standard Type1 fonts.
"""

import zlib
import os

# Page dimensions (landscape A4 in points: 841.89 x 595.28)
PAGE_W = 842
PAGE_H = 595

# Colors
DEEP_BLUE = (0.102, 0.137, 0.494)       # #1a237e
TEAL = (0.0, 0.588, 0.533)              # #009688
GOLD = (0.976, 0.659, 0.145)            # #f9a825
DARK_TEXT = (0.129, 0.129, 0.129)       # #212121
LIGHT_GRAY = (0.957, 0.957, 0.957)     # #f4f4f4
MEDIUM_GRAY = (0.757, 0.757, 0.757)    # #c1c1c1
WHITE = (1.0, 1.0, 1.0)
ACCENT_BLUE = (0.247, 0.318, 0.710)    # #3f51b5
LIGHT_BLUE = (0.882, 0.906, 0.996)     # #e1e8fe
NAVY = (0.059, 0.071, 0.306)           # #0f124e


def escape_pdf_string(text):
    """Escape special characters in PDF strings."""
    text = text.replace('\\', '\\\\')
    text = text.replace('(', '\\(')
    text = text.replace(')', '\\)')
    return text


def set_color(r, g, b, stroke=False):
    """Return PDF color operator."""
    if stroke:
        return f"{r:.3f} {g:.3f} {b:.3f} RG\n"
    return f"{r:.3f} {g:.3f} {b:.3f} rg\n"


def draw_rect(x, y, w, h, fill_color=None, stroke_color=None, line_width=1):
    """Draw a rectangle."""
    ops = ""
    if line_width != 1:
        ops += f"{line_width} w\n"
    if fill_color and stroke_color:
        ops += set_color(*fill_color)
        ops += set_color(*stroke_color, stroke=True)
        ops += f"{x:.2f} {y:.2f} {w:.2f} {h:.2f} re B\n"
    elif fill_color:
        ops += set_color(*fill_color)
        ops += f"{x:.2f} {y:.2f} {w:.2f} {h:.2f} re f\n"
    elif stroke_color:
        ops += set_color(*stroke_color, stroke=True)
        ops += f"{x:.2f} {y:.2f} {w:.2f} {h:.2f} re S\n"
    return ops


def draw_rounded_rect(x, y, w, h, r, fill_color=None, stroke_color=None):
    """Draw a rounded rectangle using bezier curves."""
    ops = ""
    if fill_color:
        ops += set_color(*fill_color)
    if stroke_color:
        ops += set_color(*stroke_color, stroke=True)

    k = 0.5523

    ops += f"{x + r:.2f} {y:.2f} m\n"
    ops += f"{x + w - r:.2f} {y:.2f} l\n"
    ops += f"{x + w - r + r*k:.2f} {y:.2f} {x + w:.2f} {y + r - r*k:.2f} {x + w:.2f} {y + r:.2f} c\n"
    ops += f"{x + w:.2f} {y + h - r:.2f} l\n"
    ops += f"{x + w:.2f} {y + h - r + r*k:.2f} {x + w - r + r*k:.2f} {y + h:.2f} {x + w - r:.2f} {y + h:.2f} c\n"
    ops += f"{x + r:.2f} {y + h:.2f} l\n"
    ops += f"{x + r - r*k:.2f} {y + h:.2f} {x:.2f} {y + h - r + r*k:.2f} {x:.2f} {y + h - r:.2f} c\n"
    ops += f"{x:.2f} {y + r:.2f} l\n"
    ops += f"{x:.2f} {y + r - r*k:.2f} {x + r - r*k:.2f} {y:.2f} {x + r:.2f} {y:.2f} c\n"

    if fill_color and stroke_color:
        ops += "B\n"
    elif fill_color:
        ops += "f\n"
    elif stroke_color:
        ops += "S\n"

    return ops


def draw_circle(cx, cy, radius, fill_color=None, stroke_color=None):
    """Draw a circle using bezier curves."""
    ops = ""
    if fill_color:
        ops += set_color(*fill_color)
    if stroke_color:
        ops += set_color(*stroke_color, stroke=True)

    k = 0.5523 * radius

    ops += f"{cx + radius:.2f} {cy:.2f} m\n"
    ops += f"{cx + radius:.2f} {cy + k:.2f} {cx + k:.2f} {cy + radius:.2f} {cx:.2f} {cy + radius:.2f} c\n"
    ops += f"{cx - k:.2f} {cy + radius:.2f} {cx - radius:.2f} {cy + k:.2f} {cx - radius:.2f} {cy:.2f} c\n"
    ops += f"{cx - radius:.2f} {cy - k:.2f} {cx - k:.2f} {cy - radius:.2f} {cx:.2f} {cy - radius:.2f} c\n"
    ops += f"{cx + k:.2f} {cy - radius:.2f} {cx + radius:.2f} {cy - k:.2f} {cx + radius:.2f} {cy:.2f} c\n"

    if fill_color and stroke_color:
        ops += "B\n"
    elif fill_color:
        ops += "f\n"
    elif stroke_color:
        ops += "S\n"

    return ops


def draw_line(x1, y1, x2, y2, color, width=1):
    """Draw a line."""
    ops = f"{width:.2f} w\n"
    ops += set_color(*color, stroke=True)
    ops += f"{x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l S\n"
    return ops


def text_block(text, x, y, font="F2", size=12, color=DARK_TEXT):
    """Create a text drawing operation."""
    ops = "BT\n"
    ops += f"/{font} {size} Tf\n"
    ops += set_color(*color)
    ops += f"{x:.2f} {y:.2f} Td\n"
    ops += f"({escape_pdf_string(text)}) Tj\n"
    ops += "ET\n"
    return ops


def text_center(text, cx, y, font="F2", size=12, color=DARK_TEXT):
    """Approximate center-aligned text."""
    if font in ("F2", "F4"):
        char_w = size * 0.55
    else:
        char_w = size * 0.50
    text_w = char_w * len(text)
    x = cx - text_w / 2
    return text_block(text, x, y, font, size, color)


def text_right(text, right_x, y, font="F2", size=12, color=DARK_TEXT):
    """Right-aligned text."""
    if font in ("F2", "F4"):
        char_w = size * 0.55
    else:
        char_w = size * 0.50
    text_w = char_w * len(text)
    x = right_x - text_w
    return text_block(text, x, y, font, size, color)


def draw_logo_top_left(size=50):
    """Draw the logo in the top-left corner of a page. Uses XObject /Logo."""
    # q = save state, cm = transform matrix, Do = draw XObject, Q = restore state
    x = 20
    y = PAGE_H - size - 15
    return f"q {size} 0 0 {size} {x} {y} cm /Logo Do Q\n"


def draw_logo_watermark():
    """Draw a large semi-transparent watermark logo in the center."""
    size = 200
    x = PAGE_W / 2 - size / 2
    y = PAGE_H / 2 - size / 2
    # Use graphics state with transparency
    return f"q /GS1 gs {size} 0 0 {size} {x:.2f} {y:.2f} cm /Logo Do Q\n"


def page_header(title_text=""):
    """Common page header with top bar and logo."""
    ops = ""
    # Top accent bar
    ops += draw_rect(0, PAGE_H - 6, PAGE_W, 6, fill_color=DEEP_BLUE)
    # Logo in top-left
    ops += draw_logo_top_left(50)
    # Brand name next to logo
    ops += text_block("RURALIFT", 75, PAGE_H - 42, "F2", 14, DEEP_BLUE)
    ops += text_block("Your Trusted Partner for Loans", 75, PAGE_H - 56, "F3", 8, DARK_TEXT)
    # Top right DSA info
    ops += text_right("DSA CODE: 40922", PAGE_W - 30, PAGE_H - 30, "F1", 8, DARK_TEXT)
    ops += text_right("REG: C/1610969", PAGE_W - 30, PAGE_H - 42, "F1", 8, DARK_TEXT)
    return ops


def page_footer():
    """Common page footer."""
    ops = ""
    ops += draw_rect(0, 0, PAGE_W, 4, fill_color=GOLD)
    ops += text_center("RURALIFT - Your Trusted Partner for Loans | 60+ Bank Partners | 24/7 Support", PAGE_W / 2, 12, "F1", 8, DARK_TEXT)
    return ops


# ============================================================
# PAGE 1: TITLE / HERO
# ============================================================
def page_title():
    ops = ""
    ops += draw_rect(0, 0, PAGE_W, PAGE_H, fill_color=WHITE)

    # Top accent bar
    ops += draw_rect(0, PAGE_H - 8, PAGE_W, 8, fill_color=DEEP_BLUE)

    # Left decorative panel
    ops += draw_rect(0, 0, 320, PAGE_H - 8, fill_color=LIGHT_BLUE)

    # Geometric accents on left panel
    ops += draw_circle(60, PAGE_H - 80, 40, fill_color=(0.180, 0.220, 0.600))
    ops += draw_circle(280, 80, 55, fill_color=(0.180, 0.220, 0.600))
    ops += draw_circle(160, 120, 25, fill_color=GOLD)

    # Diagonal accent line
    ops += "q\n"
    ops += "2 w\n"
    ops += set_color(*DEEP_BLUE, stroke=True)
    ops += f"0 {PAGE_H - 200:.2f} m 320 {PAGE_H - 350:.2f} l S\n"
    ops += "Q\n"

    # Dot pattern on left
    for row in range(5):
        for col in range(5):
            dx = 40 + col * 20
            dy = 250 + row * 20
            ops += draw_circle(dx, dy, 2, fill_color=DEEP_BLUE)

    # Large logo on left panel (prominent placement)
    ops += f"q 180 0 0 180 70 350 cm /Logo Do Q\n"

    # DSA Code badge on left panel
    ops += draw_rounded_rect(30, PAGE_H - 180, 260, 60, 8, fill_color=WHITE)
    ops += text_block("DSA CODE: 40922", 55, PAGE_H - 155, "F2", 14, DEEP_BLUE)
    ops += text_block("REG: C/1610969", 55, PAGE_H - 172, "F1", 10, DARK_TEXT)

    # "AUTHORIZED AGENT / DSA" badge
    ops += draw_rounded_rect(50, PAGE_H - 240, 220, 35, 6, fill_color=DEEP_BLUE)
    ops += text_block("AUTHORIZED AGENT / DSA", 70, PAGE_H - 226, "F2", 11, WHITE)

    # Right side - main content
    ops += text_block("RURALIFT", 380, PAGE_H - 120, "F2", 56, DEEP_BLUE)

    # Tagline
    ops += text_block("Your Trusted Partner for Loans", 380, PAGE_H - 170, "F1", 18, DARK_TEXT)

    # Gold accent line under tagline
    ops += draw_rect(380, PAGE_H - 185, 200, 3, fill_color=GOLD)

    # Key stats
    stats_y = PAGE_H - 270

    ops += draw_rounded_rect(370, stats_y - 10, 130, 65, 8, fill_color=LIGHT_BLUE)
    ops += text_center("60+", 435, stats_y + 30, "F2", 26, DEEP_BLUE)
    ops += text_center("Bank Partners", 435, stats_y + 8, "F1", 10, DARK_TEXT)

    ops += draw_rounded_rect(520, stats_y - 10, 130, 65, 8, fill_color=LIGHT_BLUE)
    ops += text_center("100%", 585, stats_y + 30, "F2", 26, DEEP_BLUE)
    ops += text_center("Secure & Trusted", 585, stats_y + 8, "F1", 10, DARK_TEXT)

    ops += draw_rounded_rect(670, stats_y - 10, 130, 65, 8, fill_color=LIGHT_BLUE)
    ops += text_center("24/7", 735, stats_y + 30, "F2", 26, DEEP_BLUE)
    ops += text_center("Support", 735, stats_y + 8, "F1", 10, DARK_TEXT)

    # Subtitle
    ops += text_block("NBFC-Authorized DSA with Official Registration", 380, PAGE_H - 320, "F3", 12, ACCENT_BLUE)
    ops += text_block("Access to India's Largest Network of Banks & NBFCs", 380, PAGE_H - 340, "F3", 12, ACCENT_BLUE)

    # CTA box
    ops += draw_rounded_rect(380, 60, 280, 50, 10, fill_color=DEEP_BLUE)
    ops += text_block("Talk to Our Loan Advisor Today", 410, 80, "F2", 15, WHITE)

    # Bottom accent
    ops += draw_rect(0, 0, PAGE_W, 5, fill_color=GOLD)

    return ops.encode()


# ============================================================
# PAGE 2: ABOUT RURALIFT / COMPANY OVERVIEW
# ============================================================
def page_about():
    ops = ""
    ops += draw_rect(0, 0, PAGE_W, PAGE_H, fill_color=WHITE)
    ops += page_header()

    # Watermark logo in background
    ops += draw_logo_watermark()

    # Title
    ops += text_center("ABOUT RURALIFT", PAGE_W / 2, PAGE_H - 100, "F2", 32, DEEP_BLUE)
    ops += draw_rect(PAGE_W / 2 - 60, PAGE_H - 112, 120, 3, fill_color=GOLD)

    # Company description
    desc_x = 80
    desc_y = PAGE_H - 160
    ops += text_block("RuraLift is an NBFC-Authorized Direct Selling Agent (DSA) registered with", desc_x, desc_y, "F1", 13, DARK_TEXT)
    ops += text_block("official credentials (DSA Code: 40922, Registration: C/1610969).", desc_x, desc_y - 22, "F1", 13, DARK_TEXT)
    ops += text_block("We connect borrowers with 60+ leading banks and NBFCs across India,", desc_x, desc_y - 52, "F1", 13, DARK_TEXT)
    ops += text_block("ensuring they get the best loan products at the lowest interest rates.", desc_x, desc_y - 74, "F1", 13, DARK_TEXT)

    # Mission box
    ops += draw_rounded_rect(80, 220, PAGE_W - 160, 120, 12, fill_color=LIGHT_BLUE)
    ops += text_center("OUR MISSION", PAGE_W / 2, 310, "F2", 18, DEEP_BLUE)
    ops += text_center("To simplify the loan process for every Indian, providing access to the best", PAGE_W / 2, 280, "F1", 12, DARK_TEXT)
    ops += text_center("financial products through transparency, trust, and technology.", PAGE_W / 2, 260, "F1", 12, DARK_TEXT)
    ops += text_center("Zero processing fee. Best rate guaranteed. Fast approvals.", PAGE_W / 2, 235, "F2", 12, TEAL)

    # Key numbers at bottom
    ops += draw_rounded_rect(100, 80, 180, 70, 8, fill_color=DEEP_BLUE)
    ops += text_center("60+", 190, 125, "F2", 28, WHITE)
    ops += text_center("Bank Partners", 190, 100, "F1", 11, GOLD)

    ops += draw_rounded_rect(330, 80, 180, 70, 8, fill_color=DEEP_BLUE)
    ops += text_center("1000+", 420, 125, "F2", 28, WHITE)
    ops += text_center("Happy Customers", 420, 100, "F1", 11, GOLD)

    ops += draw_rounded_rect(560, 80, 180, 70, 8, fill_color=DEEP_BLUE)
    ops += text_center("100%", 650, 125, "F2", 28, WHITE)
    ops += text_center("Free Service", 650, 100, "F1", 11, GOLD)

    ops += page_footer()
    return ops.encode()


# ============================================================
# PAGE 3: WHY CHOOSE RURALIFT
# ============================================================
def page_why_choose():
    ops = ""
    ops += draw_rect(0, 0, PAGE_W, PAGE_H, fill_color=WHITE)
    ops += page_header()

    # Title
    ops += text_center("WHY CHOOSE RURALIFT?", PAGE_W / 2, PAGE_H - 100, "F2", 30, DEEP_BLUE)
    ops += draw_rect(PAGE_W / 2 - 60, PAGE_H - 112, 120, 3, fill_color=GOLD)
    ops += text_center("India's Most Trusted Loan Distribution Partner", PAGE_W / 2, PAGE_H - 135, "F3", 13, DARK_TEXT)

    # 6 feature cards in 2x3 grid
    features = [
        ("60+ Bank Partners", "Compare across India's largest", "network of banks and NBFCs"),
        ("Free Service", "Zero processing fee for all", "loan applications"),
        ("100% Secure & Trusted", "NBFC-authorized DSA with", "official registration"),
        ("Fast Processing", "We expedite with insider", "bank relationships"),
        ("Best Rate Guaranteed", "We compare across all partners", "for lowest interest rate"),
        ("24/7 Dedicated Support", "Round-the-clock support,", "7 days a week"),
    ]

    card_w = 230
    card_h = 120
    start_x = 55
    gap_x = 35
    start_y = PAGE_H - 170
    gap_y = 25

    icons_colors = [TEAL, GOLD, DEEP_BLUE, ACCENT_BLUE, TEAL, GOLD]

    for i, (title, line1, line2) in enumerate(features):
        col = i % 3
        row = i // 3
        x = start_x + col * (card_w + gap_x)
        y = start_y - row * (card_h + gap_y) - card_h

        ops += draw_rounded_rect(x, y, card_w, card_h, 10, fill_color=LIGHT_BLUE)

        # Accent circle
        ops += draw_circle(x + 30, y + card_h - 35, 15, fill_color=icons_colors[i])

        # Checkmark
        ops += "q\n"
        ops += "2 w\n"
        ops += set_color(*WHITE, stroke=True)
        cx, cy = x + 30, y + card_h - 35
        ops += f"{cx - 6:.2f} {cy:.2f} m {cx - 2:.2f} {cy - 5:.2f} l {cx + 7:.2f} {cy + 5:.2f} l S\n"
        ops += "Q\n"

        ops += text_block(title, x + 55, y + card_h - 35, "F2", 13, DEEP_BLUE)
        ops += text_block(line1, x + 55, y + card_h - 55, "F1", 10, DARK_TEXT)
        ops += text_block(line2, x + 55, y + card_h - 68, "F1", 10, DARK_TEXT)

    ops += page_footer()
    return ops.encode()


# ============================================================
# PAGE 4: 60+ BANK PARTNERS HIGHLIGHT
# ============================================================
def page_partners_highlight():
    ops = ""
    ops += draw_rect(0, 0, PAGE_W, PAGE_H, fill_color=WHITE)
    ops += page_header()

    # Title
    ops += text_center("60+ BANK PARTNERS", PAGE_W / 2, PAGE_H - 100, "F2", 32, DEEP_BLUE)
    ops += draw_rect(PAGE_W / 2 - 60, PAGE_H - 112, 120, 3, fill_color=GOLD)
    ops += text_center("India's Largest Loan Distribution Network at Your Fingertips", PAGE_W / 2, PAGE_H - 135, "F3", 12, DARK_TEXT)

    # Large number highlight
    ops += draw_circle(PAGE_W / 2, PAGE_H - 240, 70, fill_color=DEEP_BLUE)
    ops += text_center("60+", PAGE_W / 2, PAGE_H - 250, "F2", 40, WHITE)
    ops += text_center("Partners", PAGE_W / 2, PAGE_H - 278, "F1", 14, GOLD)

    # Categories around it
    categories = [
        ("Public Sector Banks", "SBI, PNB, Bank of Baroda,", "Canara Bank, Union Bank..."),
        ("Private Banks", "HDFC, ICICI, Axis, Kotak,", "IndusInd, IDFC First..."),
        ("NBFCs", "Bajaj Finserv, Tata Capital,", "L&T Finance, Hero FinCorp..."),
        ("Housing Finance", "LIC Housing, PNB Housing,", "Can Fin Homes, Godrej..."),
    ]

    positions = [
        (80, PAGE_H - 350),
        (450, PAGE_H - 350),
        (80, PAGE_H - 450),
        (450, PAGE_H - 450),
    ]

    for i, ((title, l1, l2), (x, y)) in enumerate(zip(categories, positions)):
        ops += draw_rounded_rect(x, y, 310, 80, 8, fill_color=LIGHT_BLUE)
        ops += text_block(title, x + 15, y + 55, "F2", 13, DEEP_BLUE)
        ops += text_block(l1, x + 15, y + 35, "F1", 10, DARK_TEXT)
        ops += text_block(l2, x + 15, y + 20, "F1", 10, DARK_TEXT)

    # Bottom benefit
    ops += draw_rounded_rect(200, 40, 440, 35, 8, fill_color=GOLD)
    ops += text_center("We compare ALL partners to find YOU the best rate!", PAGE_W / 2, 52, "F2", 13, WHITE)

    ops += page_footer()
    return ops.encode()


# ============================================================
# PAGE 5: PERSONAL LOAN DETAILS
# ============================================================
def page_personal_loan():
    ops = ""
    ops += draw_rect(0, 0, PAGE_W, PAGE_H, fill_color=WHITE)
    ops += page_header()

    # Title
    ops += text_center("PERSONAL LOAN", PAGE_W / 2, PAGE_H - 100, "F2", 32, DEEP_BLUE)
    ops += draw_rect(PAGE_W / 2 - 60, PAGE_H - 112, 120, 3, fill_color=GOLD)
    ops += text_center("Quick Funds for Any Personal Need", PAGE_W / 2, PAGE_H - 135, "F3", 13, TEAL)

    # Left column - features
    lx = 60
    ly = PAGE_H - 180
    ops += text_block("KEY FEATURES", lx, ly, "F2", 16, DEEP_BLUE)
    features = [
        "Loan amount: Rs 50,000 to Rs 40,00,000",
        "Interest rate: Starting 10.49% p.a.",
        "Tenure: 12 to 60 months",
        "Minimal documentation required",
        "Quick disbursal within 24-48 hours",
        "No collateral needed",
        "Flexible repayment options",
    ]
    fy = ly - 30
    for feat in features:
        ops += draw_circle(lx + 8, fy + 4, 5, fill_color=TEAL)
        ops += text_block(feat, lx + 22, fy, "F1", 11, DARK_TEXT)
        fy -= 25

    # Right column - use cases
    rx = 460
    ry = PAGE_H - 180
    ops += text_block("IDEAL FOR", rx, ry, "F2", 16, DEEP_BLUE)
    uses = [
        "Medical emergencies",
        "Wedding expenses",
        "Travel & vacation",
        "Home renovation",
        "Education fees",
        "Debt consolidation",
    ]
    uy = ry - 30
    for use in uses:
        ops += draw_circle(rx + 8, uy + 4, 5, fill_color=GOLD)
        ops += text_block(use, rx + 22, uy, "F1", 11, DARK_TEXT)
        uy -= 25

    # Bottom CTA
    ops += draw_rounded_rect(200, 50, 440, 45, 10, fill_color=DEEP_BLUE)
    ops += text_center("Apply Now - Check Eligibility in 10 Minutes!", PAGE_W / 2, 67, "F2", 14, WHITE)

    ops += page_footer()
    return ops.encode()


# ============================================================
# PAGE 6: BUSINESS LOAN DETAILS
# ============================================================
def page_business_loan():
    ops = ""
    ops += draw_rect(0, 0, PAGE_W, PAGE_H, fill_color=WHITE)
    ops += page_header()

    ops += text_center("BUSINESS LOAN", PAGE_W / 2, PAGE_H - 100, "F2", 32, DEEP_BLUE)
    ops += draw_rect(PAGE_W / 2 - 60, PAGE_H - 112, 120, 3, fill_color=GOLD)
    ops += text_center("Scale Your Business with Quick Capital", PAGE_W / 2, PAGE_H - 135, "F3", 13, TEAL)

    # Left column
    lx = 60
    ly = PAGE_H - 180
    ops += text_block("KEY FEATURES", lx, ly, "F2", 16, DEEP_BLUE)
    features = [
        "Loan amount: Rs 1,00,000 to Rs 5,00,00,000",
        "Interest rate: Starting 14% p.a.",
        "Tenure: 12 to 60 months",
        "Collateral-free options available",
        "Quick disbursement in 3-5 days",
        "Flexible EMI options",
        "Overdraft facility available",
    ]
    fy = ly - 30
    for feat in features:
        ops += draw_circle(lx + 8, fy + 4, 5, fill_color=TEAL)
        ops += text_block(feat, lx + 22, fy, "F1", 11, DARK_TEXT)
        fy -= 25

    # Right column
    rx = 460
    ry = PAGE_H - 180
    ops += text_block("IDEAL FOR", rx, ry, "F2", 16, DEEP_BLUE)
    uses = [
        "Working capital needs",
        "Business expansion",
        "Equipment purchase",
        "Inventory stocking",
        "Office renovation",
        "New branch opening",
    ]
    uy = ry - 30
    for use in uses:
        ops += draw_circle(rx + 8, uy + 4, 5, fill_color=GOLD)
        ops += text_block(use, rx + 22, uy, "F1", 11, DARK_TEXT)
        uy -= 25

    # Bottom CTA
    ops += draw_rounded_rect(200, 50, 440, 45, 10, fill_color=DEEP_BLUE)
    ops += text_center("Grow Your Business - Apply Today!", PAGE_W / 2, 67, "F2", 14, WHITE)

    ops += page_footer()
    return ops.encode()


# ============================================================
# PAGE 7: HOME LOAN DETAILS
# ============================================================
def page_home_loan():
    ops = ""
    ops += draw_rect(0, 0, PAGE_W, PAGE_H, fill_color=WHITE)
    ops += page_header()

    ops += text_center("HOME LOAN", PAGE_W / 2, PAGE_H - 100, "F2", 32, DEEP_BLUE)
    ops += draw_rect(PAGE_W / 2 - 60, PAGE_H - 112, 120, 3, fill_color=GOLD)
    ops += text_center("Buy Your Dream Home with the Best Rates", PAGE_W / 2, PAGE_H - 135, "F3", 13, TEAL)

    lx = 60
    ly = PAGE_H - 180
    ops += text_block("KEY FEATURES", lx, ly, "F2", 16, DEEP_BLUE)
    features = [
        "Loan amount: Rs 5,00,000 to Rs 10,00,00,000",
        "Interest rate: Starting 8.35% p.a.",
        "Tenure: Up to 30 years",
        "Up to 90% of property value financed",
        "Tax benefits under Section 80C & 24(b)",
        "Balance transfer available",
        "Top-up loan facility",
    ]
    fy = ly - 30
    for feat in features:
        ops += draw_circle(lx + 8, fy + 4, 5, fill_color=TEAL)
        ops += text_block(feat, lx + 22, fy, "F1", 11, DARK_TEXT)
        fy -= 25

    rx = 460
    ry = PAGE_H - 180
    ops += text_block("PROPERTY TYPES", rx, ry, "F2", 16, DEEP_BLUE)
    uses = [
        "New apartment / flat",
        "Independent house / villa",
        "Under-construction property",
        "Plot purchase + construction",
        "Resale property",
        "Commercial property",
    ]
    uy = ry - 30
    for use in uses:
        ops += draw_circle(rx + 8, uy + 4, 5, fill_color=GOLD)
        ops += text_block(use, rx + 22, uy, "F1", 11, DARK_TEXT)
        uy -= 25

    ops += draw_rounded_rect(200, 50, 440, 45, 10, fill_color=DEEP_BLUE)
    ops += text_center("Get Pre-Approved - Zero Processing Fee!", PAGE_W / 2, 67, "F2", 14, WHITE)

    ops += page_footer()
    return ops.encode()


# ============================================================
# PAGE 8: LOAN AGAINST PROPERTY
# ============================================================
def page_lap():
    ops = ""
    ops += draw_rect(0, 0, PAGE_W, PAGE_H, fill_color=WHITE)
    ops += page_header()

    ops += text_center("LOAN AGAINST PROPERTY", PAGE_W / 2, PAGE_H - 100, "F2", 30, DEEP_BLUE)
    ops += draw_rect(PAGE_W / 2 - 60, PAGE_H - 112, 120, 3, fill_color=GOLD)
    ops += text_center("Unlock the Value of Your Property", PAGE_W / 2, PAGE_H - 135, "F3", 13, TEAL)

    lx = 60
    ly = PAGE_H - 180
    ops += text_block("KEY FEATURES", lx, ly, "F2", 16, DEEP_BLUE)
    features = [
        "Loan amount: Up to Rs 10,00,00,000",
        "Interest rate: Starting 9.5% p.a.",
        "Tenure: Up to 20 years",
        "Up to 70% of property market value",
        "Lower interest than personal loans",
        "Use for any purpose - business or personal",
        "Residential & commercial property accepted",
    ]
    fy = ly - 30
    for feat in features:
        ops += draw_circle(lx + 8, fy + 4, 5, fill_color=TEAL)
        ops += text_block(feat, lx + 22, fy, "F1", 11, DARK_TEXT)
        fy -= 25

    rx = 460
    ry = PAGE_H - 180
    ops += text_block("BENEFITS", rx, ry, "F2", 16, DEEP_BLUE)
    uses = [
        "Higher loan amount",
        "Lower interest rates",
        "Longer repayment tenure",
        "Flexible end-use",
        "Quick processing",
        "Retain property ownership",
    ]
    uy = ry - 30
    for use in uses:
        ops += draw_circle(rx + 8, uy + 4, 5, fill_color=GOLD)
        ops += text_block(use, rx + 22, uy, "F1", 11, DARK_TEXT)
        uy -= 25

    ops += draw_rounded_rect(200, 50, 440, 45, 10, fill_color=DEEP_BLUE)
    ops += text_center("Get Property Valuation - Free of Cost!", PAGE_W / 2, 67, "F2", 14, WHITE)

    ops += page_footer()
    return ops.encode()


# ============================================================
# PAGE 9: BALANCE TRANSFER
# ============================================================
def page_balance_transfer():
    ops = ""
    ops += draw_rect(0, 0, PAGE_W, PAGE_H, fill_color=WHITE)
    ops += page_header()

    ops += text_center("BALANCE TRANSFER", PAGE_W / 2, PAGE_H - 100, "F2", 32, DEEP_BLUE)
    ops += draw_rect(PAGE_W / 2 - 60, PAGE_H - 112, 120, 3, fill_color=GOLD)
    ops += text_center("Switch to a Lower Interest Rate & Save on EMI", PAGE_W / 2, PAGE_H - 135, "F3", 13, TEAL)

    lx = 60
    ly = PAGE_H - 180
    ops += text_block("HOW IT WORKS", lx, ly, "F2", 16, DEEP_BLUE)
    features = [
        "Transfer existing loan to a new bank",
        "Get a significantly lower interest rate",
        "Save lakhs over your loan tenure",
        "Available for Home, Business & Personal loans",
        "Minimal paperwork required",
        "We handle the entire process",
        "Top-up facility available with BT",
    ]
    fy = ly - 30
    for feat in features:
        ops += draw_circle(lx + 8, fy + 4, 5, fill_color=TEAL)
        ops += text_block(feat, lx + 22, fy, "F1", 11, DARK_TEXT)
        fy -= 25

    # Savings example box
    rx = 450
    ops += draw_rounded_rect(rx, PAGE_H - 380, 330, 200, 12, fill_color=LIGHT_BLUE)
    ops += text_block("EXAMPLE SAVINGS", rx + 20, PAGE_H - 200, "F2", 14, DEEP_BLUE)
    ops += draw_rect(rx + 20, PAGE_H - 212, 80, 2, fill_color=GOLD)
    ops += text_block("Loan Amount: Rs 50,00,000", rx + 20, PAGE_H - 235, "F1", 11, DARK_TEXT)
    ops += text_block("Current Rate: 12% p.a.", rx + 20, PAGE_H - 255, "F1", 11, DARK_TEXT)
    ops += text_block("New Rate: 9% p.a.", rx + 20, PAGE_H - 275, "F1", 11, TEAL)
    ops += text_block("You Save: Rs 8,50,000+", rx + 20, PAGE_H - 300, "F2", 14, DEEP_BLUE)
    ops += text_block("over the loan tenure!", rx + 20, PAGE_H - 318, "F1", 11, DARK_TEXT)
    ops += text_block("EMI Reduction: Rs 7,000+/month", rx + 20, PAGE_H - 345, "F2", 11, GOLD)

    ops += draw_rounded_rect(200, 50, 440, 45, 10, fill_color=DEEP_BLUE)
    ops += text_center("Check If You Can Save - Free Consultation!", PAGE_W / 2, 67, "F2", 14, WHITE)

    ops += page_footer()
    return ops.encode()


# ============================================================
# PAGE 10: TOP-UP LOAN
# ============================================================
def page_topup_loan():
    ops = ""
    ops += draw_rect(0, 0, PAGE_W, PAGE_H, fill_color=WHITE)
    ops += page_header()

    ops += text_center("TOP-UP LOAN", PAGE_W / 2, PAGE_H - 100, "F2", 32, DEEP_BLUE)
    ops += draw_rect(PAGE_W / 2 - 60, PAGE_H - 112, 120, 3, fill_color=GOLD)
    ops += text_center("Extra Funds on Your Existing Loan - Hassle Free", PAGE_W / 2, PAGE_H - 135, "F3", 13, TEAL)

    lx = 60
    ly = PAGE_H - 180
    ops += text_block("KEY FEATURES", lx, ly, "F2", 16, DEEP_BLUE)
    features = [
        "Additional loan on existing home/property loan",
        "Lower interest than personal loan",
        "Minimal documentation needed",
        "No additional collateral required",
        "Quick processing and disbursal",
        "Use for any purpose",
        "Available with balance transfer",
    ]
    fy = ly - 30
    for feat in features:
        ops += draw_circle(lx + 8, fy + 4, 5, fill_color=TEAL)
        ops += text_block(feat, lx + 22, fy, "F1", 11, DARK_TEXT)
        fy -= 25

    rx = 460
    ry = PAGE_H - 180
    ops += text_block("ELIGIBILITY", rx, ry, "F2", 16, DEEP_BLUE)
    uses = [
        "Existing home/LAP loan running",
        "Good repayment track record",
        "Property value appreciated",
        "Minimum 12 EMIs paid",
        "No defaults/bounces",
        "Salaried or self-employed",
    ]
    uy = ry - 30
    for use in uses:
        ops += draw_circle(rx + 8, uy + 4, 5, fill_color=GOLD)
        ops += text_block(use, rx + 22, uy, "F1", 11, DARK_TEXT)
        uy -= 25

    ops += draw_rounded_rect(200, 50, 440, 45, 10, fill_color=DEEP_BLUE)
    ops += text_center("Get Extra Funds - Apply in 5 Minutes!", PAGE_W / 2, 67, "F2", 14, WHITE)

    ops += page_footer()
    return ops.encode()


# ============================================================
# PAGE 11: HOW TO GET YOUR LOAN APPROVED
# ============================================================
def page_loan_process():
    ops = ""
    ops += draw_rect(0, 0, PAGE_W, PAGE_H, fill_color=WHITE)
    ops += page_header()

    ops += text_center("HOW TO GET YOUR LOAN APPROVED", PAGE_W / 2, PAGE_H - 100, "F2", 28, DEEP_BLUE)
    ops += draw_rect(PAGE_W / 2 - 60, PAGE_H - 112, 120, 3, fill_color=GOLD)
    ops += text_center("Simple 5-Step Process", PAGE_W / 2, PAGE_H - 135, "F3", 13, DARK_TEXT)

    # 5-step process timeline
    timeline_y = PAGE_H - 230
    start_x = 90
    step_gap = 170

    # Connecting line
    ops += draw_line(start_x, timeline_y, start_x + 4 * step_gap, timeline_y, MEDIUM_GRAY, 3)

    step_colors = [TEAL, ACCENT_BLUE, DEEP_BLUE, GOLD, TEAL]
    steps = [
        ("Walk In / Call", "Visit our office or", "call our advisor"),
        ("Document Collection", "Submit required", "documents"),
        ("Bank Matching", "We match you with", "the best bank"),
        ("Application &", "Bank processes &", "approves your loan"),
        ("Loan Disbursed!", "Funds credited to", "your account"),
    ]

    for i in range(5):
        x = start_x + i * step_gap
        ops += draw_circle(x, timeline_y, 30, fill_color=step_colors[i])
        ops += text_center(str(i + 1), x, timeline_y - 7, "F2", 22, WHITE)
        ops += text_center(steps[i][0], x, timeline_y - 50, "F2", 11, DEEP_BLUE)
        ops += text_center(steps[i][1], x, timeline_y - 68, "F1", 9, DARK_TEXT)
        ops += text_center(steps[i][2], x, timeline_y - 80, "F1", 9, DARK_TEXT)

    # Benefits section
    ops += draw_rounded_rect(60, 60, PAGE_W - 120, 130, 12, fill_color=LIGHT_BLUE)
    ops += text_center("WHY OUR PROCESS IS FASTER", PAGE_W / 2, 160, "F2", 16, DEEP_BLUE)

    benefits = [
        "Check eligibility in 10 minutes",
        "Compare across 60+ banks instantly",
        "Zero processing fee on all loans",
        "Insider bank relationships for faster approval",
    ]
    bx = 120
    for i, item in enumerate(benefits):
        col = i % 2
        row = i // 2
        ix = bx + col * 350
        iy = 120 - row * 28
        ops += draw_circle(ix, iy + 4, 5, fill_color=GOLD)
        ops += text_block(item, ix + 15, iy, "F1", 11, DARK_TEXT)

    ops += page_footer()
    return ops.encode()


# ============================================================
# PAGE 12: ELIGIBILITY CRITERIA
# ============================================================
def page_eligibility():
    ops = ""
    ops += draw_rect(0, 0, PAGE_W, PAGE_H, fill_color=WHITE)
    ops += page_header()

    ops += text_center("ELIGIBILITY CRITERIA", PAGE_W / 2, PAGE_H - 100, "F2", 30, DEEP_BLUE)
    ops += draw_rect(PAGE_W / 2 - 60, PAGE_H - 112, 120, 3, fill_color=GOLD)
    ops += text_center("Check If You Qualify for a Loan", PAGE_W / 2, PAGE_H - 135, "F3", 13, DARK_TEXT)

    # Two columns: Salaried and Self-Employed
    col1_x = 60
    col2_x = PAGE_W / 2 + 30

    # Salaried
    ops += draw_rounded_rect(col1_x, PAGE_H - 490, 370, 330, 12, fill_color=LIGHT_BLUE)
    ops += text_block("FOR SALARIED INDIVIDUALS", col1_x + 20, PAGE_H - 180, "F2", 15, DEEP_BLUE)
    ops += draw_rect(col1_x + 20, PAGE_H - 192, 80, 2, fill_color=GOLD)

    salaried = [
        "Age: 21 to 60 years",
        "Minimum salary: Rs 15,000/month",
        "Employment: 6+ months in current job",
        "Total work experience: 1+ years",
        "CIBIL score: 650+",
        "Indian resident with valid ID",
        "Stable income source",
        "No major loan defaults",
    ]
    sy = PAGE_H - 220
    for item in salaried:
        ops += draw_circle(col1_x + 30, sy + 4, 4, fill_color=TEAL)
        ops += text_block(item, col1_x + 42, sy, "F1", 11, DARK_TEXT)
        sy -= 25

    # Self-Employed
    ops += draw_rounded_rect(col2_x, PAGE_H - 490, 370, 330, 12, fill_color=LIGHT_BLUE)
    ops += text_block("FOR SELF-EMPLOYED", col2_x + 20, PAGE_H - 180, "F2", 15, DEEP_BLUE)
    ops += draw_rect(col2_x + 20, PAGE_H - 192, 80, 2, fill_color=GOLD)

    self_emp = [
        "Age: 21 to 65 years",
        "Business vintage: 3+ years",
        "Minimum turnover criteria (varies)",
        "ITR filed for last 2 years",
        "CIBIL score: 650+",
        "Indian resident with valid ID",
        "Profitable business",
        "No major loan defaults",
    ]
    sy = PAGE_H - 220
    for item in self_emp:
        ops += draw_circle(col2_x + 30, sy + 4, 4, fill_color=GOLD)
        ops += text_block(item, col2_x + 42, sy, "F1", 11, DARK_TEXT)
        sy -= 25

    # Bottom note
    ops += draw_rounded_rect(200, 45, 440, 40, 8, fill_color=DEEP_BLUE)
    ops += text_center("Not sure? Call us - we check eligibility in 10 minutes!", PAGE_W / 2, 59, "F2", 12, WHITE)

    ops += page_footer()
    return ops.encode()


# ============================================================
# PAGE 13: DOCUMENTS REQUIRED
# ============================================================
def page_documents():
    ops = ""
    ops += draw_rect(0, 0, PAGE_W, PAGE_H, fill_color=WHITE)
    ops += page_header()

    ops += text_center("DOCUMENTS REQUIRED", PAGE_W / 2, PAGE_H - 100, "F2", 30, DEEP_BLUE)
    ops += draw_rect(PAGE_W / 2 - 60, PAGE_H - 112, 120, 3, fill_color=GOLD)
    ops += text_center("Minimal Paperwork - We Guide You Through Everything", PAGE_W / 2, PAGE_H - 135, "F3", 12, DARK_TEXT)

    # Three columns: Identity, Income, Property
    col_w = 240
    gap = 25
    start_x = (PAGE_W - 3 * col_w - 2 * gap) / 2

    # Column 1: Identity
    c1x = start_x
    ops += draw_rounded_rect(c1x, PAGE_H - 480, col_w, 320, 10, fill_color=LIGHT_BLUE)
    ops += draw_rect(c1x, PAGE_H - 170, col_w, 30, fill_color=DEEP_BLUE)
    ops += text_center("IDENTITY PROOF", c1x + col_w / 2, PAGE_H - 162, "F2", 12, WHITE)

    docs1 = [
        "PAN Card",
        "Aadhaar Card",
        "Passport",
        "Voter ID",
        "Driving License",
        "Passport-size photos",
    ]
    dy = PAGE_H - 210
    for doc in docs1:
        ops += draw_circle(c1x + 20, dy + 4, 4, fill_color=TEAL)
        ops += text_block(doc, c1x + 32, dy, "F1", 11, DARK_TEXT)
        dy -= 28

    # Column 2: Income
    c2x = start_x + col_w + gap
    ops += draw_rounded_rect(c2x, PAGE_H - 480, col_w, 320, 10, fill_color=LIGHT_BLUE)
    ops += draw_rect(c2x, PAGE_H - 170, col_w, 30, fill_color=TEAL)
    ops += text_center("INCOME PROOF", c2x + col_w / 2, PAGE_H - 162, "F2", 12, WHITE)

    docs2 = [
        "Last 3 months salary slips",
        "Last 6 months bank statements",
        "Form 16 (salaried)",
        "ITR - last 2 years",
        "GST returns (business)",
        "P&L / Balance Sheet",
    ]
    dy = PAGE_H - 210
    for doc in docs2:
        ops += draw_circle(c2x + 20, dy + 4, 4, fill_color=TEAL)
        ops += text_block(doc, c2x + 32, dy, "F1", 11, DARK_TEXT)
        dy -= 28

    # Column 3: Property
    c3x = start_x + 2 * (col_w + gap)
    ops += draw_rounded_rect(c3x, PAGE_H - 480, col_w, 320, 10, fill_color=LIGHT_BLUE)
    ops += draw_rect(c3x, PAGE_H - 170, col_w, 30, fill_color=GOLD)
    ops += text_center("PROPERTY DOCS", c3x + col_w / 2, PAGE_H - 162, "F2", 12, WHITE)

    docs3 = [
        "Sale deed / Agreement",
        "Property tax receipts",
        "Approved building plan",
        "Encumbrance certificate",
        "NOC from society",
        "Allotment letter",
    ]
    dy = PAGE_H - 210
    for doc in docs3:
        ops += draw_circle(c3x + 20, dy + 4, 4, fill_color=TEAL)
        ops += text_block(doc, c3x + 32, dy, "F1", 11, DARK_TEXT)
        dy -= 28

    # Bottom note
    ops += text_center("* Property documents only required for Home Loan & Loan Against Property", PAGE_W / 2, 50, "F3", 10, DARK_TEXT)

    ops += page_footer()
    return ops.encode()


# ============================================================
# PAGE 14: OUR 60+ PARTNER BANKS & NBFCs (FULL GRID)
# ============================================================
def page_partners_grid():
    ops = ""
    ops += draw_rect(0, 0, PAGE_W, PAGE_H, fill_color=WHITE)
    ops += page_header()

    ops += text_center("OUR 60+ PARTNER BANKS & NBFCs", PAGE_W / 2, PAGE_H - 90, "F2", 26, DEEP_BLUE)
    ops += draw_rect(PAGE_W / 2 - 60, PAGE_H - 100, 120, 3, fill_color=GOLD)

    banks = [
        "HDFC Bank", "ICICI Bank", "SBI", "Axis Bank",
        "Bajaj Finserv", "Kotak Mahindra", "IndusInd Bank", "IDFC First Bank",
        "PNB Housing", "Tata Capital", "L&T Finance", "Aditya Birla Capital",
        "Federal Bank", "Yes Bank", "Punjab National", "Bank of Baroda",
        "Canara Bank", "Union Bank", "IIFL Finance", "Fullerton India",
        "Hero FinCorp", "Piramal Finance", "Shriram Finance", "Muthoot Finance",
        "Manappuram", "Cholamandalam", "Sundaram Finance", "RBL Bank",
        "IDBI Bank", "Bandhan Bank", "AU Small Finance", "Ujjivan SFB",
        "LIC Housing", "DHFL", "Indiabulls", "Mahindra Finance",
        "Godrej Housing", "Standard Chartered", "Citibank", "HSBC",
        "Deutsche Bank", "DBS Bank", "South Indian Bank", "Karur Vysya Bank",
        "City Union Bank", "Suryoday SFB", "Equitas SFB", "Jana SFB",
        "ESAF SFB", "Capital First", "Home First", "Aavas Financiers",
        "Repco Home", "Can Fin Homes", "GIC Housing", "Reliance Home",
        "Dewan Housing", "Aptus Value", "Muthoot HomeFin", "& More...",
    ]

    # Grid: 5 columns x 12 rows
    cols = 5
    card_w = 150
    card_h = 30
    start_x = 25
    start_y = PAGE_H - 115
    gap_x = 12
    gap_y = 6

    for i, bank in enumerate(banks):
        col = i % cols
        row = i // cols
        x = start_x + col * (card_w + gap_x)
        y = start_y - row * (card_h + gap_y) - card_h

        bg_color = LIGHT_BLUE if (i % 2 == 0) else WHITE
        ops += draw_rounded_rect(x, y, card_w, card_h, 4, fill_color=bg_color, stroke_color=MEDIUM_GRAY)
        ops += draw_circle(x + 12, y + card_h / 2, 3, fill_color=DEEP_BLUE)
        ops += text_block(bank, x + 22, y + card_h / 2 - 4, "F1", 8, DARK_TEXT)

    ops += page_footer()
    return ops.encode()


# ============================================================
# PAGE 15: CONTACT / WALK IN OR CALL US (CTA)
# ============================================================
def page_contact():
    ops = ""
    ops += draw_rect(0, 0, PAGE_W, PAGE_H, fill_color=WHITE)

    # Top accent
    ops += draw_rect(0, PAGE_H - 6, PAGE_W, 6, fill_color=DEEP_BLUE)

    # Large logo centered at top
    ops += f"q 120 0 0 120 {PAGE_W/2 - 60:.0f} {PAGE_H - 180:.0f} cm /Logo Do Q\n"

    # Large blue card
    ops += draw_rounded_rect(60, 80, PAGE_W - 120, PAGE_H - 250, 20, fill_color=DEEP_BLUE)

    # Decorative circles
    ops += draw_circle(120, PAGE_H - 280, 30, fill_color=(0.150, 0.180, 0.550))
    ops += draw_circle(PAGE_W - 120, 140, 40, fill_color=(0.150, 0.180, 0.550))

    # Dot pattern
    for row in range(3):
        for col in range(4):
            ops += draw_circle(PAGE_W - 200 + col * 15, PAGE_H - 280 + row * 15, 2, fill_color=GOLD)

    # Main CTA text
    ops += text_center("WALK IN OR CALL US NOW", PAGE_W / 2, PAGE_H - 280, "F2", 34, WHITE)

    # Sub heading
    ops += text_center("Start Your Loan Journey Today", PAGE_W / 2, PAGE_H - 320, "F1", 16, GOLD)

    # Gold separator
    ops += draw_rect(PAGE_W / 2 - 80, PAGE_H - 340, 160, 2, fill_color=GOLD)

    # Key benefits
    cta_benefits = ["Check eligibility in 10 min", "Compare 60+ banks", "Zero processing fee"]
    bx_start = 160
    b_gap = 220
    by = PAGE_H - 380

    for i, benefit in enumerate(cta_benefits):
        bx = bx_start + i * b_gap
        ops += draw_circle(bx - 12, by + 4, 6, fill_color=GOLD)
        ops += text_block(benefit, bx, by, "F1", 11, WHITE)

    # Contact details
    contact_y = PAGE_H - 430
    ops += text_center("DSA CODE: 40922  |  REG: C/1610969", PAGE_W / 2, contact_y, "F2", 14, WHITE)
    ops += text_center("AUTHORIZED LOAN DISTRIBUTION AGENT", PAGE_W / 2, contact_y - 25, "F1", 12, GOLD)

    # Bottom tagline
    ops += text_center("RuraLift - Your Trusted Partner for Loans", PAGE_W / 2, 130, "F2", 16, WHITE)
    ops += draw_rect(160, 115, PAGE_W - 320, 1, fill_color=GOLD)
    ops += text_center("24/7 Support Available | 7 Days a Week", PAGE_W / 2, 97, "F1", 11, (0.7, 0.8, 1.0))

    # Bottom gold bar
    ops += draw_rect(0, 0, PAGE_W, 4, fill_color=GOLD)

    # Company name at top
    ops += text_center("RURALIFT", PAGE_W / 2, PAGE_H - 50, "F2", 14, DEEP_BLUE)

    return ops.encode()


# ============================================================
# PDF BUILDER WITH LOGO EMBEDDING
# ============================================================
def build_pdf(page_contents, logo_rgb_path, logo_alpha_path):
    """
    Build a complete PDF with embedded logo on every page.
    Logo data is loaded from pre-extracted zlib-compressed files.
    """
    # Load logo image data (already zlib compressed)
    with open(logo_rgb_path, 'rb') as f:
        logo_rgb_data = f.read()
    with open(logo_alpha_path, 'rb') as f:
        logo_alpha_data = f.read()

    # PDF structure:
    # Obj 1: Catalog
    # Obj 2: Pages
    # Obj 3: Font Helvetica
    # Obj 4: Font Helvetica-Bold
    # Obj 5: Font Helvetica-Oblique
    # Obj 6: Font Helvetica-BoldOblique
    # Obj 7: Logo RGB Image XObject
    # Obj 8: Logo Alpha Mask (SMask)
    # Obj 9: ExtGState (for watermark transparency)
    # Then pairs of (content_stream, page_obj) for each page

    pdf_objects = []

    # Object 1: Catalog
    pdf_objects.append(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")

    # Object 2: Pages (placeholder)
    pdf_objects.append(None)

    # Object 3-6: Fonts
    pdf_objects.append(b"3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n")
    pdf_objects.append(b"4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n")
    pdf_objects.append(b"5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>\nendobj\n")
    pdf_objects.append(b"6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-BoldOblique /Encoding /WinAnsiEncoding >>\nendobj\n")

    # Object 7: Logo RGB Image
    logo_img_dict = (
        f"7 0 obj\n"
        f"<< /Type /XObject /Subtype /Image /Width 2000 /Height 2000 "
        f"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode "
        f"/SMask 8 0 R /Length {len(logo_rgb_data)} >>\n"
        f"stream\n"
    )
    obj7 = logo_img_dict.encode() + logo_rgb_data + b"\nendstream\nendobj\n"
    pdf_objects.append(obj7)

    # Object 8: Logo Alpha Mask (SMask)
    logo_mask_dict = (
        f"8 0 obj\n"
        f"<< /Type /XObject /Subtype /Image /Width 2000 /Height 2000 "
        f"/ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode "
        f"/Length {len(logo_alpha_data)} >>\n"
        f"stream\n"
    )
    obj8 = logo_mask_dict.encode() + logo_alpha_data + b"\nendstream\nendobj\n"
    pdf_objects.append(obj8)

    # Object 9: ExtGState for watermark transparency
    pdf_objects.append(b"9 0 obj\n<< /Type /ExtGState /ca 0.08 /CA 0.08 >>\nendobj\n")

    # Resources string for all pages (includes Logo XObject and transparency state)
    resources = (
        "/Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >> "
        "/XObject << /Logo 7 0 R >> "
        "/ExtGState << /GS1 9 0 R >>"
    )

    # Now add page content streams and page objects
    page_obj_numbers = []
    next_obj = 10  # objects 1-9 are used

    for page_content in page_contents:
        # Content stream
        compressed = zlib.compress(page_content)
        stream_obj_num = next_obj
        stream_obj = f"{stream_obj_num} 0 obj\n<< /Length {len(compressed)} /Filter /FlateDecode >>\nstream\n".encode()
        stream_obj += compressed
        stream_obj += b"\nendstream\nendobj\n"
        pdf_objects.append(stream_obj)
        next_obj += 1

        # Page object
        page_obj_num = next_obj
        page_obj = (
            f"{page_obj_num} 0 obj\n"
            f"<< /Type /Page /Parent 2 0 R "
            f"/MediaBox [0 0 {PAGE_W} {PAGE_H}] "
            f"/Contents {stream_obj_num} 0 R "
            f"/Resources << {resources} >> >>\n"
            f"endobj\n"
        ).encode()
        pdf_objects.append(page_obj)
        page_obj_numbers.append(page_obj_num)
        next_obj += 1

    # Build Pages object (object 2)
    kids = " ".join(f"{n} 0 R" for n in page_obj_numbers)
    pages_obj = f"2 0 obj\n<< /Type /Pages /Kids [{kids}] /Count {len(page_obj_numbers)} >>\nendobj\n".encode()
    pdf_objects[1] = pages_obj

    # Build the PDF file
    output = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
    offsets = []

    for obj in pdf_objects:
        offsets.append(len(output))
        output += obj

    # Cross-reference table
    xref_offset = len(output)
    output += b"xref\n"
    output += f"0 {len(pdf_objects) + 1}\n".encode()
    output += b"0000000000 65535 f \n"
    for offset in offsets:
        output += f"{offset:010d} 00000 n \n".encode()

    # Trailer
    output += f"trailer\n<< /Size {len(pdf_objects) + 1} /Root 1 0 R >>\n".encode()
    output += b"startxref\n"
    output += f"{xref_offset}\n".encode()
    output += b"%%EOF\n"

    return output


# ============================================================
# MAIN
# ============================================================
def main():
    # Logo data paths (extracted from Logo.pdf)
    logo_rgb_path = "/tmp/logo_rgb.zlib"
    logo_alpha_path = "/tmp/logo_alpha.zlib"

    # Check if logo files exist; if not, extract from Logo.pdf
    if not os.path.exists(logo_rgb_path) or not os.path.exists(logo_alpha_path):
        print("Extracting logo from Logo.pdf...")
        import re
        script_dir = os.path.dirname(os.path.abspath(__file__))
        logo_pdf_path = os.path.join(script_dir, "Logo.pdf")
        with open(logo_pdf_path, 'rb') as f:
            data = f.read()

        # Extract object 14 (RGB image, length 94412)
        obj14_match = re.search(rb'14 0 obj\s*<<[^>]*>>\s*stream\r?\n', data)
        if obj14_match:
            stream_start = obj14_match.end()
            rgb_stream = data[stream_start:stream_start + 94412]
            with open(logo_rgb_path, 'wb') as f:
                f.write(rgb_stream)

        # Extract object 20 (Alpha mask, length 35356)
        obj20_match = re.search(rb'20 0 obj\s*<<[^>]*>>\s*stream\r?\n', data)
        if obj20_match:
            stream_start = obj20_match.end()
            alpha_stream = data[stream_start:stream_start + 35356]
            with open(logo_alpha_path, 'wb') as f:
                f.write(alpha_stream)

        print("Logo extracted successfully!")

    # Generate all 15 pages
    pages = [
        page_title(),              # 1: Title/Hero with large logo
        page_about(),              # 2: About RuraLift / Company Overview
        page_why_choose(),         # 3: Why Choose RuraLift
        page_partners_highlight(), # 4: 60+ Bank Partners Highlight
        page_personal_loan(),      # 5: Personal Loan Details
        page_business_loan(),      # 6: Business Loan Details
        page_home_loan(),          # 7: Home Loan Details
        page_lap(),                # 8: Loan Against Property
        page_balance_transfer(),   # 9: Balance Transfer
        page_topup_loan(),         # 10: Top-Up Loan
        page_loan_process(),       # 11: How to Get Your Loan Approved
        page_eligibility(),        # 12: Eligibility Criteria
        page_documents(),          # 13: Documents Required
        page_partners_grid(),      # 14: 60+ Partner Banks Full Grid
        page_contact(),            # 15: Contact / Walk In or Call Us
    ]

    pdf_data = build_pdf(pages, logo_rgb_path, logo_alpha_path)

    output_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "RuraLift_DSA_Presentation.pdf")
    with open(output_path, 'wb') as f:
        f.write(pdf_data)

    print(f"PDF generated: {output_path}")
    print(f"Size: {len(pdf_data):,} bytes")
    print(f"Pages: {len(pages)}")
    print("Logo embedded on EVERY page!")


if __name__ == "__main__":
    main()
