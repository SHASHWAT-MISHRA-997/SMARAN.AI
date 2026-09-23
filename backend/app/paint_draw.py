"""Drawing in Paint, by voice: "Paint kholo aur ek ghar banao".

Paint is opened and maximised, the canvas is found by looking for it (the big
white area in a screenshot), and the drawing is made with the mouse, stroke by
stroke, where the person can watch it happen.

The mouse is theirs, so it is borrowed carefully:
  * before every stroke, Paint must still be the window in front, and
  * the pointer must still be where it was left.
Either one failing means the person has taken over, and drawing stops at once.

Common subjects are drawn from shapes kept here - quick, and the same every
time. Anything else ("draw a cat") is sketched by whichever model is set up,
as plain coordinates that are checked before a single one is used.
"""
from __future__ import annotations

import base64
import io
import json
import math
import random
import re
import subprocess
import sys
import time
from typing import Callable, Optional

Point = tuple[float, float]
Stroke = list[Point]

# ---------------------------------------------------------------------------
# What can be drawn without asking a model. Coordinates are 0..1 of the box.
# ---------------------------------------------------------------------------


def _ellipse(cx: float, cy: float, rx: float, ry: float, steps: int = 48,
             start: float = 0.0, end: float = 2 * math.pi) -> Stroke:
    return [(cx + rx * math.cos(start + (end - start) * i / steps),
             cy + ry * math.sin(start + (end - start) * i / steps)) for i in range(steps + 1)]


def _star(cx: float, cy: float, r: float) -> Stroke:
    points = []
    for i in range(11):
        radius = r if i % 2 == 0 else r * 0.4
        angle = -math.pi / 2 + i * math.pi / 5
        points.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle)))
    return points


def _heart(cx: float, cy: float, s: float) -> Stroke:
    points = []
    for i in range(61):
        t = 2 * math.pi * i / 60
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        points.append((cx + x * s / 17, cy - y * s / 17))
    return points


SHAPES: dict[str, list[Stroke]] = {
    "circle": [_ellipse(0.5, 0.5, 0.4, 0.4)],
    "square": [[(0.15, 0.15), (0.85, 0.15), (0.85, 0.85), (0.15, 0.85), (0.15, 0.15)]],
    "triangle": [[(0.5, 0.1), (0.9, 0.9), (0.1, 0.9), (0.5, 0.1)]],
    "line": [[(0.1, 0.5), (0.9, 0.5)]],
    "star": [_star(0.5, 0.52, 0.42)],
    "heart": [_heart(0.5, 0.5, 0.4)],
    "house": [
        [(0.2, 0.45), (0.8, 0.45), (0.8, 0.9), (0.2, 0.9), (0.2, 0.45)],   # walls
        [(0.12, 0.47), (0.5, 0.12), (0.88, 0.47)],                          # roof
        [(0.43, 0.9), (0.43, 0.68), (0.57, 0.68), (0.57, 0.9)],             # door
        [(0.27, 0.55), (0.37, 0.55), (0.37, 0.65), (0.27, 0.65), (0.27, 0.55)],  # window
        [(0.63, 0.55), (0.73, 0.55), (0.73, 0.65), (0.63, 0.65), (0.63, 0.55)],  # window
    ],
    "tree": [
        [(0.44, 0.92), (0.44, 0.6), (0.56, 0.6), (0.56, 0.92)],              # trunk
        _ellipse(0.5, 0.38, 0.28, 0.25),                                    # crown
        [(0.25, 0.92), (0.75, 0.92)],                                       # ground
    ],
    "sun": [_ellipse(0.5, 0.5, 0.2, 0.2)] + [
        [(0.5 + 0.27 * math.cos(a), 0.5 + 0.27 * math.sin(a)),
         (0.5 + 0.42 * math.cos(a), 0.5 + 0.42 * math.sin(a))]
        for a in (i * math.pi / 4 for i in range(8))
    ],
    "smiley": [
        _ellipse(0.5, 0.5, 0.4, 0.4),
        _ellipse(0.36, 0.4, 0.04, 0.05, 16),
        _ellipse(0.64, 0.4, 0.04, 0.05, 16),
        _ellipse(0.5, 0.52, 0.22, 0.2, 24, 0.15 * math.pi, 0.85 * math.pi),
    ],
    "flower": [
        _ellipse(0.5, 0.35, 0.07, 0.07, 20),
        *[_ellipse(0.5 + 0.13 * math.cos(a), 0.35 + 0.13 * math.sin(a), 0.07, 0.07, 20)
          for a in (i * math.pi / 3 for i in range(6))],
        [(0.5, 0.48), (0.5, 0.92)],
        [(0.5, 0.72), (0.38, 0.62)],
        [(0.5, 0.78), (0.62, 0.68)],
    ],
}

#: What people call them, in English, Hinglish and Hindi.
_NAMES: list[tuple[str, str]] = [
    ("house", r"house|home|ghar|makan|makaan|घर|मकान"),
    ("tree", r"tree|ped|pedh|पेड़|पेड"),
    ("sun", r"sun|suraj|sooraj|सूरज"),
    ("star", r"star|tara|taara|तारा|सितारा"),
    ("heart", r"heart|dil|दिल"),
    ("smiley", r"smiley|smile|smiling\s+face|happy\s+face|face|muskurata\s+chehra|smiley\s+face|स्माइली"),
    ("flower", r"flower|phool|fool|फूल"),
    ("circle", r"circle|gola|golaa|round|गोला|वृत्त"),
    ("square", r"square|box|rectangle|chaukor|चौकोर|वर्ग"),
    ("triangle", r"triangle|tikon|trikon|त्रिकोण"),
    ("line", r"line|lakeer|rekha|रेखा|लकीर"),
]


def known_subjects(text: str) -> list[str]:
    """The built-in shapes named in `text`, in the order they were said."""
    found: list[tuple[int, str]] = []
    for shape, pattern in _NAMES:
        match = re.search(rf"(?<![a-z])(?:{pattern})(?![a-z])", text, re.I)
        if match:
            found.append((match.start(), shape))
    # "smiley face" is one thing, not a smiley and a face.
    return [shape for _, shape in sorted(found)]


# ---------------------------------------------------------------------------
# Recognising the request
# ---------------------------------------------------------------------------

_DRAW_VERB = r"draw|sketch|paint\s+(?:a|an|me)|banao|bana\s*do|banaiye|bana\s+ke\s+dikhao|chitra|बनाओ|बना\s*दो|ड्रॉ"
_PAINT = r"\b(?:ms\s*)?paint\b|पेंट"

DRAW_REQUEST = re.compile(
    rf"(?:{_PAINT}).*(?:{_DRAW_VERB})|(?:{_DRAW_VERB}).*(?:{_PAINT})"
    rf"|^(?:please\s+)?(?:draw|sketch)\s+(?:a|an|me\s+a|me\s+an|me|the|some)?\s*\w+",
    re.I,
)

_FILLER = re.compile(
    r"\b(?:open|kholo|khol\s*do|launch|start|please|plz|and|aur|then|phir|in|on|me|mein|mai|par|pe|"
    r"ms|paint|draw|sketch|banao|bana\s*do|banaiye|dikhao|ek|a|an|the|some|for|mere|liye|my|picture|"
    r"drawing|image|photo|chitra|karo|kar\s*do)\b|[.,!?]",
    re.I,
)


#: "Draw something" names nothing: ask. "Draw anything" leaves it to SMARAN.
_SOMETHING = re.compile(r"\b(?:kuch|kuchh|something|koi\s+cheez)\b|कुछ", re.I)
_ANYTHING = re.compile(r"\b(?:kuch\s+bhi|kuchh\s+bhi|anything|whatever|your\s+choice|you\s+choose|koi\s+bhi)\b|कुछ\s+भी", re.I)


def subject_of(text: str) -> str:
    """What was asked to be drawn, with the instruction words taken off."""
    return re.sub(r"\s+", " ", _FILLER.sub(" ", _SOMETHING.sub(" ", text))).strip()


def is_draw_request(text: str) -> bool:
    return bool(DRAW_REQUEST.search(text or ""))


ASK_WHAT = ("What should I draw? I can draw a house, tree, sun, star, heart, smiley, flower, "
            "circle, square or triangle - or name anything else and I'll sketch it.")


# ---------------------------------------------------------------------------
# Anything else: a model sketches it as coordinates
# ---------------------------------------------------------------------------

_SKETCH_SYSTEM = (
    "You draw simple line drawings as coordinates. Reply with JSON only, no prose: "
    '{"strokes": [[[x, y], [x, y], ...], ...]}. Coordinates are 0 to 100, with (0,0) '
    "top-left. Use at most 20 strokes of at most 60 points each. Keep it simple and "
    "recognisable, like a child's clean outline drawing, filling most of the square."
)


def parse_strokes(reply: str) -> list[Stroke]:
    """Strokes from a model's reply, or [] - nothing unchecked is ever drawn."""
    match = re.search(r"\{.*\}", reply or "", re.S)
    if not match:
        return []
    try:
        data = json.loads(match.group(0))
    except (ValueError, TypeError):
        return []
    strokes: list[Stroke] = []
    for raw in (data.get("strokes") or [])[:20]:
        stroke: Stroke = []
        for point in (raw or [])[:60]:
            if (isinstance(point, (list, tuple)) and len(point) == 2
                    and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in point)):
                x, y = float(point[0]), float(point[1])
                if 0 <= x <= 100 and 0 <= y <= 100:
                    stroke.append((x / 100, y / 100))
        if len(stroke) >= 2:
            strokes.append(stroke)
    return strokes


def sketch_with_model(subject: str) -> tuple[list[Stroke], str]:
    """(strokes, error) from the first set-up model that returns a usable sketch."""
    from app import site_builder

    generators, skipped = site_builder.candidates()
    if not generators:
        return [], site_builder.nothing_available(skipped)
    last = ""
    for generator in generators[:4]:
        reply, error = site_builder.ask(generator, _SKETCH_SYSTEM, f"Draw: {subject}")
        strokes = parse_strokes(reply)
        if strokes:
            return strokes, ""
        last = error or "the sketch it returned could not be used"
    return [], last


# ---------------------------------------------------------------------------
# Where to draw: the canvas, found by looking
# ---------------------------------------------------------------------------


def find_canvas(png_bytes: bytes, near_white: int = 245, cell: int = 8,
                min_side: int = 160) -> Optional[tuple[int, int, int, int]]:
    """(left, top, right, bottom) of the largest white rectangle on screen.

    Paint's canvas is the one big white area; the ribbon, the grey margins and
    the status bar are not white. Searched on a coarse grid of `cell` pixels,
    with the maximal-rectangle-in-a-histogram method.
    """
    from PIL import Image

    image = Image.open(io.BytesIO(png_bytes)).convert("L")
    small = image.resize((max(1, image.width // cell), max(1, image.height // cell)), Image.Resampling.BOX)
    width, height = small.size
    pixels = small.load()
    heights = [0] * width
    best = (0, 0, 0, 0, 0)  # area, left, top, right, bottom in grid cells
    for y in range(height):
        for x in range(width):
            heights[x] = heights[x] + 1 if pixels[x, y] >= near_white else 0
        stack: list[int] = []
        for x in range(width + 1):
            h = heights[x] if x < width else 0
            while stack and heights[stack[-1]] >= h:
                top_h = heights[stack.pop()]
                left = stack[-1] + 1 if stack else 0
                area = top_h * (x - left)
                if area > best[0]:
                    best = (area, left, y - top_h + 1, x, y + 1)
            stack.append(x)
    area, left, top, right, bottom = best
    if not area:
        return None
    box = (left * cell, top * cell, right * cell, bottom * cell)
    if box[2] - box[0] < min_side or box[3] - box[1] < min_side:
        return None
    return box


def fit(strokes: list[Stroke], canvas: tuple[int, int, int, int], margin: float = 0.12,
        slot: int = 0, slots: int = 1) -> list[list[tuple[int, int]]]:
    """Strokes in screen pixels: a square inside the canvas, away from its edges.

    Several subjects share the canvas side by side ("a house and a tree").
    Edges are kept clear because Paint's resize handles sit on them, and a
    drag that starts there resizes the canvas instead of drawing.
    """
    left, top, right, bottom = canvas
    width = (right - left) * (1 - 2 * margin)
    height = (bottom - top) * (1 - 2 * margin)
    side = min(width / slots, height)
    x0 = left + (right - left) * margin + slot * (width / slots) + (width / slots - side) / 2
    y0 = top + (bottom - top) * margin + (height - side) / 2
    return [[(round(x0 + x * side), round(y0 + y * side)) for x, y in stroke] for stroke in strokes]


def densify(stroke: list[tuple[int, int]], step: int = 6) -> list[tuple[int, int]]:
    """Points no more than `step` pixels apart, so the drag draws a smooth line."""
    out = [stroke[0]]
    for (x1, y1), (x2, y2) in zip(stroke, stroke[1:]):
        n = max(1, int(math.hypot(x2 - x1, y2 - y1) // step))
        out.extend((round(x1 + (x2 - x1) * i / n), round(y1 + (y2 - y1) * i / n)) for i in range(1, n + 1))
    return out


# ---------------------------------------------------------------------------
# Drawing, on Windows
# ---------------------------------------------------------------------------


class Interrupted(Exception):
    """The person took the mouse back, or Paint is no longer in front."""


def _paint_in_front() -> bool:
    import ctypes

    user32 = ctypes.windll.user32
    hwnd = user32.GetForegroundWindow()
    length = user32.GetWindowTextLengthW(hwnd)
    buffer = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buffer, length + 1)
    return "paint" in buffer.value.lower()


def _cursor() -> tuple[int, int]:
    import ctypes
    from ctypes import wintypes

    point = wintypes.POINT()
    ctypes.windll.user32.GetCursorPos(ctypes.byref(point))
    return point.x, point.y


def to_absolute(x: int, y: int, screen: tuple[int, int]) -> tuple[int, int]:
    """Screenshot pixels as the 0..65535 range absolute mouse input uses.

    Absolute input is a fraction of the screen, so it lands on the same spot
    whatever the display scaling. SetCursorPos works in scaled units instead:
    on a 125% display the screenshot is 1920 wide and the cursor space 1536,
    and the first drawing landed a quarter too far right and down - mostly
    off the canvas.
    """
    width, height = screen
    return (round(x * 65535 / max(1, width - 1)), round(y * 65535 / max(1, height - 1)))


def draw_strokes(strokes: list[list[tuple[int, int]]], screen: tuple[int, int],
                 in_front: Callable[[], bool] = _paint_in_front,
                 pause: float = 0.006) -> int:
    """Drag each stroke. Returns how many were drawn; raises Interrupted if taken over.

    `screen` is the screenshot's size in pixels, which the strokes are in.
    Moves are sent as real mouse input (MOVE | ABSOLUTE) rather than cursor
    jumps: the current Paint draws from input events, and jumping the cursor
    left only the points where the button went down.
    """
    import ctypes

    user32 = ctypes.windll.user32
    move, absolute, down, up = 0x0001, 0x8000, 0x0002, 0x0004
    # Where the cursor should be afterwards, in the units GetCursorPos reports.
    logical = (user32.GetSystemMetrics(0), user32.GetSystemMetrics(1))
    scale_x, scale_y = logical[0] / screen[0], logical[1] / screen[1]

    def go(x: int, y: int) -> None:
        ax, ay = to_absolute(x, y, screen)
        user32.mouse_event(move | absolute, ax, ay, 0, 0)

    def moved_away(x: int, y: int) -> bool:
        cx, cy = _cursor()
        return abs(cx - x * scale_x) > 4 or abs(cy - y * scale_y) > 4

    drawn = 0
    for stroke in strokes:
        points = densify(stroke)
        if not in_front():
            raise Interrupted("Paint is no longer the window in front")
        go(*points[0])
        time.sleep(0.03)
        user32.mouse_event(down, 0, 0, 0, 0)
        try:
            for x, y in points[1:]:
                go(x, y)
                time.sleep(pause)
                # Not where it was put: someone moved it. Stop, and let go.
                if moved_away(x, y):
                    raise Interrupted("the mouse was moved")
        finally:
            user32.mouse_event(up, 0, 0, 0, 0)
        drawn += 1
        time.sleep(0.02)
    return drawn


def _open_paint_maximised(timeout: float = 12.0) -> bool:
    """Start Paint and bring it to the front, maximised. True once it is in front."""
    import ctypes

    user32 = ctypes.windll.user32
    # The window in front now is not the one being opened - even if it is
    # Paint. With a Paint window already in front, "Paint is in front" was
    # true at once, and that old window was maximised instead of the new one.
    before = user32.GetForegroundWindow()
    subprocess.Popen(["mspaint.exe"])
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(0.4)
        front = user32.GetForegroundWindow()
        if front != before and _paint_in_front():
            user32.ShowWindow(front, 3)  # SW_MAXIMIZE
            time.sleep(1.2)  # let it lay itself out before looking for the canvas
            return True
    return False


def plan(text: str) -> dict:
    """What will be drawn: {"subjects": [...], "strokes": [[...]...]} or {"ask": ...} / {"error": ...}."""
    shapes = known_subjects(text)
    if shapes:
        return {"subjects": shapes, "groups": [SHAPES[s] for s in shapes]}
    # "Kuch bhi", "anything", "your choice": SMARAN picks, and says what.
    if _ANYTHING.search(text):
        choice = random.choice(["house", "tree", "flower", "sun", "star", "smiley", "heart"])
        return {"subjects": [choice], "groups": [SHAPES[choice]]}
    subject = subject_of(text)
    if not subject:
        return {"ask": ASK_WHAT}
    strokes, error = sketch_with_model(subject)
    if not strokes:
        return {"error": f"I couldn't sketch {subject}: {error}. I can always draw a house, tree, "
                         "sun, star, heart, smiley, flower, circle, square or triangle."}
    return {"subjects": [subject], "groups": [strokes]}


def draw(text: str) -> dict:
    """Open Paint and draw what `text` asks for. Returns {"success", "message"|"error", ...}."""
    planned = plan(text)
    if "ask" in planned:
        return {"success": False, "ask": planned["ask"], "message": planned["ask"]}
    if "error" in planned:
        return {"success": False, "error": planned["error"]}
    subjects, groups = planned["subjects"], planned["groups"]
    what = " and ".join(subjects)

    if sys.platform != "win32":
        return _draw_as_picture(what, groups)

    from app.desktop_agent import DesktopAgent

    if not _open_paint_maximised():
        return {"success": False, "error": "Paint did not open in front, so I didn't draw anything."}
    shot = DesktopAgent._action_take_screenshot({})
    canvas = None
    screen = None
    if shot.get("success") and shot.get("screenshot_base64"):
        from PIL import Image

        png = base64.b64decode(shot["screenshot_base64"])
        screen = Image.open(io.BytesIO(png)).size
        canvas = find_canvas(png)
    if not canvas:
        return {"success": False, "error": "I opened Paint but couldn't find its canvas, so I didn't draw."}
    strokes = []
    for slot, group in enumerate(groups):
        strokes.extend(fit(group, canvas, slot=slot, slots=len(groups)))
    try:
        draw_strokes(strokes, screen)
    except Interrupted as stopped:
        return {"success": False, "error": f"I stopped drawing because {stopped} - the mouse is yours again."}
    return {"success": True, "message": f"Drew {_article(what)} in Paint.", "subjects": subjects}


def _article(what: str) -> str:
    return what if re.match(r"^(?:a|an|the)\s", what, re.I) else (
        ("an " if what[:1].lower() in "aeiou" else "a ") + what)


def _draw_as_picture(what: str, groups: list[list[Stroke]]) -> dict:
    """Elsewhere: the drawing as a picture, opened in the system's image app."""
    import os
    import tempfile

    from PIL import Image, ImageDraw

    size = 800
    image = Image.new("RGB", (size * len(groups), size), "white")
    pen = ImageDraw.Draw(image)
    for slot, group in enumerate(groups):
        for stroke in fit(group, (slot * size, 0, (slot + 1) * size, size)):
            pen.line(stroke, fill="black", width=5, joint="curve")
    path = os.path.join(tempfile.gettempdir(), "smaran-drawing.png")
    image.save(path)
    opener = "open" if sys.platform == "darwin" else "xdg-open"
    try:
        subprocess.Popen([opener, path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError:
        return {"success": True, "message": f"Drew {_article(what)} and saved it to {path}.", "path": path}
    return {"success": True, "message": f"Drew {_article(what)} and opened it.", "path": path}
