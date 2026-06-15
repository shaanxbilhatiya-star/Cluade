#!/usr/bin/env python3
"""
Generate RuraLift DSA Presentation PDF
Professional, modern design with white background and accent colors.
Uses raw PDF 1.4 format with standard Type1 fonts.
"""

import struct
import zlib
import math

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


class PDFWriter:
    def __init__(self):
        self.objects = []  # list of bytestrings
        self.pages = []
        self.page_contents = []
        
    def add_object(self, content):
        """Add a PDF object, return its object number (1-based)."""
        self.objects.append(content)
        return len(self.objects)
    
    def build(self):
        """Build the complete PDF file."""
        # We'll construct objects in order:
        # 1: Catalog
        # 2: Pages
        # 3: Font Helvetica
        # 4: Font Helvetica-Bold
        # 5: Font Helvetica-Oblique
        # 6: Font Helvetica-BoldOblique
        # Then page objects and their content streams
        
        pdf_objects = []
        
        # Object 1: Catalog
        pdf_objects.append(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
        
        # Object 2: Pages (placeholder, will be rebuilt)
        # Object 3-6: Fonts
        pdf_objects.append(None)  # placeholder for Pages
        
        pdf_objects.append(b"3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n")
        pdf_objects.append(b"4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n")
        pdf_objects.append(b"5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>\nendobj\n")
        pdf_objects.append(b"6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-BoldOblique /Encoding /WinAnsiEncoding >>\nendobj\n")
        
        # Resources dictionary reference
        resources = "/Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >>"
        
        # Now add pages and their content streams
        page_obj_numbers = []
        next_obj = 7
        
        for page_content in self.page_contents:
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
            page_obj = f"{page_obj_num} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] /Contents {stream_obj_num} 0 R /Resources << {resources} >> >>\nendobj\n".encode()
            pdf_objects.append(page_obj)
            page_obj_numbers.append(page_obj_num)
            next_obj += 1
        
        # Now build Pages object
        kids = " ".join(f"{n} 0 R" for n in page_obj_numbers)
        pages_obj = f"2 0 obj\n<< /Type /Pages /Kids [{kids}] /Count {len(page_obj_numbers)} >>\nendobj\n".encode()
        pdf_objects[1] = pages_obj
        
        # Build the PDF file
        output = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
        offsets = []
        
        for i, obj in enumerate(pdf_objects):
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
    
    # k factor for bezier approximation of quarter circle
    k = 0.5523
    
    # Start path
    ops += f"{x + r:.2f} {y:.2f} m\n"
    # Bottom edge
    ops += f"{x + w - r:.2f} {y:.2f} l\n"
    # Bottom-right corner
    ops += f"{x + w - r + r*k:.2f} {y:.2f} {x + w:.2f} {y + r - r*k:.2f} {x + w:.2f} {y + r:.2f} c\n"
    # Right edge
    ops += f"{x + w:.2f} {y + h - r:.2f} l\n"
    # Top-right corner
    ops += f"{x + w:.2f} {y + h - r + r*k:.2f} {x + w - r + r*k:.2f} {y + h:.2f} {x + w - r:.2f} {y + h:.2f} c\n"
    # Top edge
    ops += f"{x + r:.2f} {y + h:.2f} l\n"
    # Top-left corner
    ops += f"{x + r - r*k:.2f} {y + h:.2f} {x:.2f} {y + h - r + r*k:.2f} {x:.2f} {y + h - r:.2f} c\n"
    # Left edge
    ops += f"{x:.2f} {y + r:.2f} l\n"
    # Bottom-left corner
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
    """Approximate center-aligned text (estimate char width)."""
    # Approximate width: size * 0.5 * len for Helvetica
    if font in ("F2", "F4"):  # Bold fonts are slightly wider
        char_w = size * 0.58
    else:
        char_w = size * 0.52
    text_w = char_w * len(text)
    x = cx - text_w / 2
    return text_block(text, x, y, font, size, color)


def text_right(text, right_x, y, font="F2", size=12, color=DARK_TEXT):
    """Right-aligned text."""
    if font in ("F2", "F4"):
        char_w = size * 0.58
    else:
        char_w = size * 0.52
    text_w = char_w * len(text)
    x = right_x - text_w
    return text_block(text, x, y, font, size, color)


# ============================================================
# PAGE 1: TITLE / HERO
# ============================================================
def page_title():
    ops = ""
    # White background
    ops += draw_rect(0, 0, PAGE_W, PAGE_H, fill_color=WHITE)
    
    # Top accent bar - deep blue
    ops += draw_rect(0, PAGE_H - 8, PAGE_W, 8, fill_color=DEEP_BLUE)
    
    # Left decorative panel - gradient-like effect with overlapping shapes
    ops += draw_rect(0, 0, 320, PAGE_H - 8, fill_color=LIGHT_BLUE)
    
    # Geometric accent circles on left panel
    ops += draw_circle(60, PAGE_H - 80, 40, fill_color=(*DEEP_BLUE[:2], DEEP_BLUE[2] * 0.3,))
    ops += draw_circle(60, PAGE_H - 80, 40, fill_color=(0.180, 0.220, 0.600))
    ops += draw_circle(280, 80, 55, fill_color=(0.180, 0.220, 0.600))
    ops += draw_circle(160, 120, 25, fill_color=GOLD)
    
    # Diagonal accent line
    ops += "q\n"
    ops += f"2 w\n"
    ops += set_color(*DEEP_BLUE, stroke=True)
    ops += f"0 {PAGE_H - 200:.2f} m 320 {PAGE_H - 350:.2f} l S\n"
    ops += "Q\n"
    
    # Small decorative dots pattern on left
    for row in range(5):
        for col in range(5):
            dx = 40 + col * 20
            dy = 250 + row * 20
            ops += draw_circle(dx, dy, 2, fill_color=DEEP_BLUE)
    
    # DSA Code badge on left panel
    ops += draw_rounded_rect(30, PAGE_H - 180, 260, 60, 8, fill_color=WHITE)
    ops += text_block("DSA CODE: 40922", 55, PAGE_H - 155, "F2", 14, DEEP_BLUE)
    ops += text_block("REG: C/1610969", 55, PAGE_H - 172, "F1", 10, DARK_TEXT)
    
    # "AUTHORIZED AGENT / DSA" badge
    ops += draw_rounded_rect(50, PAGE_H - 240, 220, 35, 6, fill_color=DEEP_BLUE)
    ops += text_block("AUTHORIZED AGENT / DSA", 70, PAGE_H - 226, "F2", 11, WHITE)
    
    # Right side - main content
    # Company name
    ops += text_block("RURALIFT", 380, PAGE_H - 120, "F2", 56, DEEP_BLUE)
    
    # Tagline
    ops += text_block("Your Trusted Partner for Loans", 380, PAGE_H - 170, "F1", 18, DARK_TEXT)
    
    # Gold accent line under tagline
    ops += draw_rect(380, PAGE_H - 185, 200, 3, fill_color=GOLD)
    
    # Key stats in a row
    stats_y = PAGE_H - 270
    
    # Stat 1
    ops += draw_rounded_rect(370, stats_y - 10, 130, 65, 8, fill_color=LIGHT_BLUE)
    ops += text_center("60+", 435, stats_y + 30, "F2", 26, DEEP_BLUE)
    ops += text_center("Bank Partners", 435, stats_y + 8, "F1", 10, DARK_TEXT)
    
    # Stat 2
    ops += draw_rounded_rect(520, stats_y - 10, 130, 65, 8, fill_color=LIGHT_BLUE)
    ops += text_center("100%", 585, stats_y + 30, "F2", 26, DEEP_BLUE)
    ops += text_center("Secure & Trusted", 585, stats_y + 8, "F1", 10, DARK_TEXT)
    
    # Stat 3
    ops += draw_rounded_rect(670, stats_y - 10, 130, 65, 8, fill_color=LIGHT_BLUE)
    ops += text_center("24/7", 735, stats_y + 30, "F2", 26, DEEP_BLUE)
    ops += text_center("Support", 735, stats_y + 8, "F1", 10, DARK_TEXT)
    
    # Subtitle text
    ops += text_block("NBFC-Authorized DSA with Official Registration", 380, PAGE_H - 320, "F3", 12, ACCENT_BLUE)
    ops += text_block("Access to India's Largest Network of Banks & NBFCs", 380, PAGE_H - 340, "F3", 12, ACCENT_BLUE)
    
    # CTA box
    ops += draw_rounded_rect(380, 60, 280, 50, 10, fill_color=DEEP_BLUE)
    ops += text_block("Talk to Our Loan Advisor Today", 410, 80, "F2", 15, WHITE)
    
    # Bottom accent
    ops += draw_rect(0, 0, PAGE_W, 5, fill_color=GOLD)
    
    return ops.encode()


# ============================================================
# PAGE 2: WHY CHOOSE RURALIFT
# ============================================================
def page_why_choose():
    ops = ""
    ops += draw_rect(0, 0, PAGE_W, PAGE_H, fill_color=WHITE)
    
    # Top accent bar
    ops += draw_rect(0, PAGE_H - 6, PAGE_W, 6, fill_color=DEEP_BLUE)
    
    # Section title
    ops += text_center("WHY CHOOSE RURALIFT?", PAGE_W/2, PAGE_H - 70, "F2", 32, DEEP_BLUE)
    
    # Decorative line under title
    ops += draw_rect(PAGE_W/2 - 60, PAGE_H - 82, 120, 3, fill_color=GOLD)
    
    # Subtitle
    ops += text_center("India's Most Trusted Loan Distribution Partner", PAGE_W/2, PAGE_H - 110, "F3", 14, DARK_TEXT)
    
    # 6 feature cards in 2x3 grid
    features = [
        ("60+ Bank Partners", "Compare across India's largest", "network of banks and NBFCs"),
        ("Free Service", "Zero processing fee for all", "loan applications"),
        ("100% Secure & Trusted", "NBFC-authorized DSA with", "official registration"),
        ("Fast Processing", "We expedite with insider", "bank relationships"),
        ("Best Rate Guaranteed", "We compare across all partners", "for lowest interest rate"),
        ("Dedicated Agent Support", "24/7 support available,", "7 days a week"),
    ]
    
    card_w = 230
    card_h = 120
    start_x = 55
    gap_x = 35
    start_y = PAGE_H - 180
    gap_y = 25
    
    icons_colors = [TEAL, GOLD, DEEP_BLUE, ACCENT_BLUE, TEAL, GOLD]
    
    for i, (title, line1, line2) in enumerate(features):
        col = i % 3
        row = i // 3
        x = start_x + col * (card_w + gap_x)
        y = start_y - row * (card_h + gap_y) - card_h
        
        # Card background
        ops += draw_rounded_rect(x, y, card_w, card_h, 10, fill_color=LIGHT_BLUE)
        
        # Accent circle (icon placeholder)
        ops += draw_circle(x + 30, y + card_h - 35, 15, fill_color=icons_colors[i])
        
        # Checkmark in circle (simplified)
        ops += "q\n"
        ops += f"2 w\n"
        ops += set_color(*WHITE, stroke=True)
        cx, cy = x + 30, y + card_h - 35
        ops += f"{cx-6:.2f} {cy:.2f} m {cx-2:.2f} {cy-5:.2f} l {cx+7:.2f} {cy+5:.2f} l S\n"
        ops += "Q\n"
        
        # Title
        ops += text_block(title, x + 55, y + card_h - 35, "F2", 13, DEEP_BLUE)
        # Description
        ops += text_block(line1, x + 55, y + card_h - 55, "F1", 10, DARK_TEXT)
        ops += text_block(line2, x + 55, y + card_h - 68, "F1", 10, DARK_TEXT)
    
    # Bottom decorative element
    ops += draw_rect(0, 0, PAGE_W, 4, fill_color=GOLD)
    
    # Small branding bottom right
    ops += text_right("RURALIFT", PAGE_W - 30, 15, "F2", 10, DEEP_BLUE)
    
    return ops.encode()


# ============================================================
# PAGE 3: LOAN PRODUCTS WE OFFER
# ============================================================
def page_loan_products():
    ops = ""
    ops += draw_rect(0, 0, PAGE_W, PAGE_H, fill_color=WHITE)
    
    # Top accent
    ops += draw_rect(0, PAGE_H - 6, PAGE_W, 6, fill_color=DEEP_BLUE)
    
    # Title
    ops += text_center("LOAN PRODUCTS WE OFFER", PAGE_W/2, PAGE_H - 65, "F2", 30, DEEP_BLUE)
    ops += draw_rect(PAGE_W/2 - 60, PAGE_H - 77, 120, 3, fill_color=GOLD)
    
    # 6 products in 2x3 grid with icons
    products = [
        ("Personal Loan", "Quick funds for any personal", "need with minimal docs"),
        ("Business Loan", "Scale your business with quick", "disbursement & flexible repayment"),
        ("Home Loan", "Buy your dream home with low", "interest rates & long tenure"),
        ("Loan Against Property", "Unlock the value of your", "property for large financial needs"),
        ("Balance Transfer", "Move your existing loan to a", "lower interest rate & save on EMI"),
        ("Top-Up Loan", "Extra funds on your existing loan", "with minimal documentation"),
    ]
    
    card_w = 240
    card_h = 140
    start_x = 42
    gap_x = 25
    start_y = PAGE_H - 110
    gap_y = 20
    
    product_colors = [TEAL, ACCENT_BLUE, DEEP_BLUE, GOLD, TEAL, ACCENT_BLUE]
    
    for i, (title, line1, line2) in enumerate(products):
        col = i % 3
        row = i // 3
        x = start_x + col * (card_w + gap_x)
        y = start_y - row * (card_h + gap_y) - card_h
        
        # Card with left accent bar
        ops += draw_rounded_rect(x, y, card_w, card_h, 8, fill_color=WHITE, stroke_color=MEDIUM_GRAY)
        ops += draw_rect(x, y + 10, 4, card_h - 20, fill_color=product_colors[i])
        
        # Product icon circle
        ops += draw_circle(x + 35, y + card_h - 35, 18, fill_color=product_colors[i])
        
        # Simple rupee symbol in circle
        ops += text_block("Rs", x + 26, y + card_h - 41, "F2", 12, WHITE)
        
        # Title
        ops += text_block(title, x + 65, y + card_h - 32, "F2", 14, DEEP_BLUE)
        
        # Separator line
        ops += draw_line(x + 20, y + card_h - 55, x + card_w - 20, y + card_h - 55, LIGHT_GRAY, 0.5)
        
        # Description
        ops += text_block(line1, x + 20, y + card_h - 75, "F1", 10, DARK_TEXT)
        ops += text_block(line2, x + 20, y + card_h - 90, "F1", 10, DARK_TEXT)
    
    # Bottom bar
    ops += draw_rect(0, 0, PAGE_W, 4, fill_color=GOLD)
    ops += text_right("RURALIFT", PAGE_W - 30, 15, "F2", 10, DEEP_BLUE)
    
    return ops.encode()


# ============================================================
# PAGE 4: HOW TO GET YOUR LOAN APPROVED
# ============================================================
def page_loan_process():
    ops = ""
    ops += draw_rect(0, 0, PAGE_W, PAGE_H, fill_color=WHITE)
    
    # Top accent
    ops += draw_rect(0, PAGE_H - 6, PAGE_W, 6, fill_color=DEEP_BLUE)
    
    # Title
    ops += text_center("HOW TO GET YOUR LOAN APPROVED", PAGE_W/2, PAGE_H - 65, "F2", 28, DEEP_BLUE)
    ops += draw_rect(PAGE_W/2 - 60, PAGE_H - 77, 120, 3, fill_color=GOLD)
    
    # 5-step process with connected circles (horizontal timeline)
    steps = [
        ("1", "Walk In / Call Us", "Visit our office or", "call our advisor"),
        ("2", "Document Collection", "Submit required", "documents"),
        ("3", "Bank Matching", "We match your profile", "with the best bank"),
        ("4", "Application &", "Approval", "Bank processes your", ),
        ("5", "Loan Disbursed!", "Funds credited to", "your account"),
    ]
    
    timeline_y = PAGE_H - 200
    start_x = 90
    step_gap = 170
    
    # Draw connecting line
    ops += draw_line(start_x, timeline_y, start_x + 4 * step_gap, timeline_y, MEDIUM_GRAY, 2)
    
    # Draw steps
    step_colors = [TEAL, ACCENT_BLUE, DEEP_BLUE, GOLD, TEAL]
    
    for i in range(5):
        x = start_x + i * step_gap
        
        # Circle
        ops += draw_circle(x, timeline_y, 28, fill_color=step_colors[i])
        
        # Number in circle
        ops += text_center(str(i+1), x, timeline_y - 6, "F2", 20, WHITE)
        
        # Step title below
        if i == 3:
            ops += text_center("Application &", x, timeline_y - 50, "F2", 11, DEEP_BLUE)
            ops += text_center("Approval", x, timeline_y - 64, "F2", 11, DEEP_BLUE)
            ops += text_center("Bank processes", x, timeline_y - 82, "F1", 9, DARK_TEXT)
            ops += text_center("your application", x, timeline_y - 94, "F1", 9, DARK_TEXT)
        else:
            ops += text_center(steps[i][1], x, timeline_y - 50, "F2", 11, DEEP_BLUE)
            ops += text_center(steps[i][2], x, timeline_y - 68, "F1", 9, DARK_TEXT)
            ops += text_center(steps[i][3], x, timeline_y - 80, "F1", 9, DARK_TEXT)
    
    # Lower section: key benefits
    benefits_y = 180
    ops += draw_rect(40, benefits_y - 70, PAGE_W - 80, 140, fill_color=LIGHT_BLUE)
    ops += draw_rounded_rect(40, benefits_y - 70, PAGE_W - 80, 140, 12, fill_color=LIGHT_BLUE)
    
    ops += text_center("WHY OUR PROCESS IS FASTER", PAGE_W/2, benefits_y + 45, "F2", 16, DEEP_BLUE)
    
    benefit_items = [
        "Check eligibility in 10 minutes",
        "Compare across 60+ banks instantly",
        "Zero processing fee on all loans",
        "Insider bank relationships for faster approval",
    ]
    
    bx = 120
    for i, item in enumerate(benefit_items):
        col = i % 2
        row = i // 2
        ix = bx + col * 350
        iy = benefits_y + 10 - row * 30
        
        # Bullet circle
        ops += draw_circle(ix, iy + 4, 5, fill_color=GOLD)
        ops += text_block(item, ix + 15, iy, "F1", 12, DARK_TEXT)
    
    # Bottom bar
    ops += draw_rect(0, 0, PAGE_W, 4, fill_color=GOLD)
    ops += text_right("RURALIFT", PAGE_W - 30, 15, "F2", 10, DEEP_BLUE)
    
    return ops.encode()


# ============================================================
# PAGE 5: ELIGIBILITY & DOCUMENTS
# ============================================================
def page_eligibility():
    ops = ""
    ops += draw_rect(0, 0, PAGE_W, PAGE_H, fill_color=WHITE)
    
    # Top accent
    ops += draw_rect(0, PAGE_H - 6, PAGE_W, 6, fill_color=DEEP_BLUE)
    
    # Split page into two columns
    col1_x = 50
    col2_x = PAGE_W / 2 + 30
    
    # Left column: Eligibility
    ops += text_block("AM I ELIGIBLE", col1_x, PAGE_H - 60, "F2", 24, DEEP_BLUE)
    ops += text_block("FOR A LOAN?", col1_x, PAGE_H - 88, "F2", 24, DEEP_BLUE)
    ops += draw_rect(col1_x, PAGE_H - 98, 80, 3, fill_color=GOLD)
    
    eligibility = [
        "Salaried or Self-Employed",
        "Age: 21 - 65 years",
        "Minimum income criteria varies by bank",
        "Indian resident with valid ID",
        "Existing loans may still qualify",
        "CIBIL score 650+ preferred",
    ]
    
    ey = PAGE_H - 140
    for item in eligibility:
        ops += draw_circle(col1_x + 8, ey + 4, 5, fill_color=TEAL)
        ops += text_block(item, col1_x + 22, ey, "F1", 12, DARK_TEXT)
        ey -= 28
    
    # Eligibility CTA
    ops += draw_rounded_rect(col1_x, ey - 20, 320, 40, 8, fill_color=DEEP_BLUE)
    ops += text_block("Check Your Eligibility in 10 Minutes!", col1_x + 20, ey - 5, "F2", 13, WHITE)
    
    # Vertical divider
    ops += draw_line(PAGE_W/2 + 10, PAGE_H - 50, PAGE_W/2 + 10, 50, MEDIUM_GRAY, 1)
    
    # Right column: Documents
    ops += text_block("DOCUMENTS", col2_x, PAGE_H - 60, "F2", 24, DEEP_BLUE)
    ops += text_block("NEEDED", col2_x, PAGE_H - 88, "F2", 24, DEEP_BLUE)
    ops += draw_rect(col2_x, PAGE_H - 98, 80, 3, fill_color=GOLD)
    
    documents = [
        "PAN Card",
        "Aadhaar Card",
        "Last 3 months bank statements",
        "Latest salary slips (salaried)",
        "ITR / GST returns (self-employed)",
        "Property documents (if applicable)",
        "Passport-size photographs",
    ]
    
    dy = PAGE_H - 140
    for item in documents:
        ops += draw_circle(col2_x + 8, dy + 4, 5, fill_color=GOLD)
        ops += text_block(item, col2_x + 22, dy, "F1", 12, DARK_TEXT)
        dy -= 28
    
    # Bottom decorative
    ops += draw_rect(0, 0, PAGE_W, 4, fill_color=GOLD)
    ops += text_right("RURALIFT", PAGE_W - 30, 15, "F2", 10, DEEP_BLUE)
    
    return ops.encode()


# ============================================================
# PAGE 6: PARTNER BANKS & NBFCs
# ============================================================
def page_partners():
    ops = ""
    ops += draw_rect(0, 0, PAGE_W, PAGE_H, fill_color=WHITE)
    
    # Top accent
    ops += draw_rect(0, PAGE_H - 6, PAGE_W, 6, fill_color=DEEP_BLUE)
    
    # Title
    ops += text_center("OUR 60+ PARTNER BANKS & NBFCs", PAGE_W/2, PAGE_H - 60, "F2", 28, DEEP_BLUE)
    ops += draw_rect(PAGE_W/2 - 60, PAGE_H - 72, 120, 3, fill_color=GOLD)
    ops += text_center("We compare across all partners to find you the lowest interest rate", PAGE_W/2, PAGE_H - 95, "F3", 12, DARK_TEXT)
    
    # Partner bank names in a grid layout
    banks = [
        "HDFC Bank", "ICICI Bank", "SBI", "Axis Bank",
        "Bajaj Finserv", "Kotak Mahindra", "IndusInd Bank", "IDFC First Bank",
        "PNB Housing", "Tata Capital", "L&T Finance", "Aditya Birla Capital",
        "Federal Bank", "Yes Bank", "Punjab National Bank", "Bank of Baroda",
        "Canara Bank", "Union Bank", "IIFL Finance", "Fullerton India",
        "Hero FinCorp", "Piramal Finance", "Shriram Finance", "Muthoot Finance",
        "Manappuram", "Cholamandalam", "Sundaram Finance", "RBL Bank",
        "IDBI Bank", "Bandhan Bank", "AU Small Finance", "Ujjivan SFB",
    ]
    
    # Grid: 8 columns x 4 rows
    cols = 4
    rows = 8
    card_w = 185
    card_h = 42
    start_x = 42
    start_y = PAGE_H - 120
    gap_x = 15
    gap_y = 10
    
    for i, bank in enumerate(banks):
        col = i % cols
        row = i // cols
        x = start_x + col * (card_w + gap_x)
        y = start_y - row * (card_h + gap_y) - card_h
        
        # Alternating backgrounds
        bg_color = LIGHT_BLUE if (i % 2 == 0) else WHITE
        border_color = MEDIUM_GRAY
        
        ops += draw_rounded_rect(x, y, card_w, card_h, 6, fill_color=bg_color, stroke_color=border_color)
        
        # Small accent dot
        ops += draw_circle(x + 15, y + card_h/2, 4, fill_color=DEEP_BLUE)
        
        # Bank name
        ops += text_block(bank, x + 28, y + card_h/2 - 5, "F2", 10, DARK_TEXT)
    
    # "+30 more" indicator
    ops += text_center("+ 30 More Partner Banks & NBFCs", PAGE_W/2, 30, "F2", 13, ACCENT_BLUE)
    
    # Bottom bar
    ops += draw_rect(0, 0, PAGE_W, 4, fill_color=GOLD)
    
    return ops.encode()


# ============================================================
# PAGE 7: CONTACT / CTA
# ============================================================
def page_contact():
    ops = ""
    ops += draw_rect(0, 0, PAGE_W, PAGE_H, fill_color=WHITE)
    
    # Top accent
    ops += draw_rect(0, PAGE_H - 6, PAGE_W, 6, fill_color=DEEP_BLUE)
    
    # Large central content area with blue background
    ops += draw_rounded_rect(60, 100, PAGE_W - 120, PAGE_H - 200, 20, fill_color=DEEP_BLUE)
    
    # Decorative elements on the blue card
    ops += draw_circle(120, PAGE_H - 140, 30, fill_color=(0.150, 0.180, 0.550))
    ops += draw_circle(PAGE_W - 120, 160, 40, fill_color=(0.150, 0.180, 0.550))
    
    # Dots pattern
    for row in range(3):
        for col in range(4):
            ops += draw_circle(PAGE_W - 200 + col * 15, PAGE_H - 150 + row * 15, 2, fill_color=GOLD)
    
    # Main CTA text
    ops += text_center("WALK IN OR CALL US NOW", PAGE_W/2, PAGE_H - 180, "F2", 34, WHITE)
    
    # Sub heading
    ops += text_center("Start Your Loan Journey Today", PAGE_W/2, PAGE_H - 220, "F1", 16, GOLD)
    
    # Gold separator
    ops += draw_rect(PAGE_W/2 - 80, PAGE_H - 240, 160, 2, fill_color=GOLD)
    
    # Key benefits row
    cta_benefits = ["Check eligibility in 10 min", "Compare 60+ banks", "Zero processing fee"]
    bx_start = 160
    b_gap = 220
    by = PAGE_H - 280
    
    for i, benefit in enumerate(cta_benefits):
        bx = bx_start + i * b_gap
        ops += draw_circle(bx - 12, by + 4, 6, fill_color=GOLD)
        ops += text_block(benefit, bx, by, "F1", 11, WHITE)
    
    # Contact details section
    contact_y = PAGE_H - 360
    ops += text_center("DSA CODE: 40922  |  REG: C/1610969", PAGE_W/2, contact_y, "F2", 14, WHITE)
    ops += text_center("AUTHORIZED LOAN DISTRIBUTION AGENT", PAGE_W/2, contact_y - 25, "F1", 12, GOLD)
    
    # Bottom tagline
    ops += text_center("RuraLift - Your Trusted Partner for Loans", PAGE_W/2, 140, "F2", 16, WHITE)
    
    # Decorative bottom inside card
    ops += draw_rect(160, 120, PAGE_W - 320, 1, fill_color=GOLD)
    ops += text_center("24/7 Support Available | 7 Days a Week", PAGE_W/2, 108, "F1", 11, (0.7, 0.8, 1.0))
    
    # Bottom gold bar
    ops += draw_rect(0, 0, PAGE_W, 4, fill_color=GOLD)
    
    # Outside card branding
    ops += text_center("RURALIFT", PAGE_W/2, PAGE_H - 50, "F2", 12, DEEP_BLUE)
    ops += text_center("www.ruralift.com", PAGE_W/2, 60, "F3", 10, DARK_TEXT)
    
    return ops.encode()


# ============================================================
# MAIN: Generate PDF
# ============================================================
def main():
    writer = PDFWriter()
    
    # Generate all pages
    writer.page_contents = [
        page_title(),
        page_why_choose(),
        page_loan_products(),
        page_loan_process(),
        page_eligibility(),
        page_partners(),
        page_contact(),
    ]
    
    pdf_data = writer.build()
    
    output_path = "/projects/sandbox/Cluade/RuraLift_DSA_Presentation.pdf"
    with open(output_path, 'wb') as f:
        f.write(pdf_data)
    
    print(f"PDF generated: {output_path}")
    print(f"Size: {len(pdf_data)} bytes")
    print(f"Pages: {len(writer.page_contents)}")


if __name__ == "__main__":
    main()
