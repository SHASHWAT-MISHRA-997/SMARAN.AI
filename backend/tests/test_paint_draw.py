"""Drawing in Paint by voice - what is drawn, where, and when it stops."""
import io
import sys
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import main as main_module
from app import paint_draw
from app.main import app, get_current_user


@pytest.mark.parametrize("said, shapes", [
    ("paint kholo aur ek ghar banao", ["house"]),
    ("open paint and draw a tree", ["tree"]),
    ("draw a star", ["star"]),
    ("paint mein suraj aur ped banao", ["sun", "tree"]),
    ("draw a smiley face in paint", ["smiley"]),
    ("पेंट में फूल बनाओ", ["flower"]),
])
def test_the_request_and_what_it_names(said, shapes):
    assert paint_draw.is_draw_request(said)
    assert paint_draw.known_subjects(said) == shapes


@pytest.mark.parametrize("said", ["open paint", "paint kholo", "what is the weather", "play some music"])
def test_opening_paint_or_other_things_are_not_drawing(said):
    assert not paint_draw.is_draw_request(said)


def test_nothing_named_asks_what_to_draw():
    assert paint_draw.plan("paint mein kuch draw karo") == {"ask": paint_draw.ASK_WHAT}


def test_something_unusual_goes_to_the_model_as_a_subject(monkeypatch):
    monkeypatch.setattr(paint_draw, "sketch_with_model",
                        lambda subject: ([[(0.1, 0.1), (0.9, 0.9)]], "") if subject == "cat" else ([], "no"))
    planned = paint_draw.plan("paint mein ek cat banao")
    assert planned["subjects"] == ["cat"]


def test_a_models_sketch_is_checked_before_anything_is_drawn():
    good = paint_draw.parse_strokes('Here: {"strokes": [[[10, 10], [90, 90]], [[50, 0], [50, 100]]]}')
    assert good == [[(0.1, 0.1), (0.9, 0.9)], [(0.5, 0.0), (0.5, 1.0)]]
    # Off the square, not numbers, a single point, or no JSON at all: dropped.
    assert paint_draw.parse_strokes('{"strokes": [[[10, 10], [500, 90]]]}') == []
    assert paint_draw.parse_strokes('{"strokes": [[["x", 1], [2, 2]]]}') == []
    assert paint_draw.parse_strokes('{"strokes": [[[10, 10]]]}') == []
    assert paint_draw.parse_strokes("I cannot draw.") == []


def _fake_paint_screenshot() -> bytes:
    """A Paint-like screen: grey ribbon and margins, white canvas, status bar."""
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (1920, 1080), (243, 243, 243))
    pen = ImageDraw.Draw(image)
    pen.rectangle((0, 0, 1920, 170), fill=(230, 230, 235))        # ribbon
    pen.rectangle((300, 240, 1500, 900), fill=(255, 255, 255))     # canvas
    pen.rectangle((0, 1040, 1920, 1080), fill=(225, 225, 225))     # status bar
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def test_the_canvas_is_found_by_looking():
    left, top, right, bottom = paint_draw.find_canvas(_fake_paint_screenshot())
    assert abs(left - 300) <= 16 and abs(top - 240) <= 16
    assert abs(right - 1500) <= 16 and abs(bottom - 900) <= 16


def test_strokes_stay_inside_the_canvas_away_from_its_edges():
    canvas = (300, 240, 1500, 900)
    for slots in (1, 2, 3):
        for slot in range(slots):
            for stroke in paint_draw.fit(paint_draw.SHAPES["house"], canvas, slot=slot, slots=slots):
                for x, y in stroke:
                    assert 300 + 100 < x < 1500 - 100
                    assert 240 + 60 < y < 900 - 60


def test_every_built_in_shape_is_drawable():
    for name, strokes in paint_draw.SHAPES.items():
        assert strokes, name
        for stroke in strokes:
            assert len(stroke) >= 2
            assert all(-0.01 <= v <= 1.01 for point in stroke for v in point), name


@pytest.mark.skipif(sys.platform != "win32", reason="the mouse is driven only on Windows")
def test_drawing_stops_when_paint_is_no_longer_in_front(monkeypatch):
    with pytest.raises(paint_draw.Interrupted):
        paint_draw.draw_strokes([[(10, 10), (20, 20)]], in_front=lambda: False)


def test_voice_route_asks_then_draws_the_answer(monkeypatch):
    calls = []

    def fake_draw(text):
        calls.append(text)
        if not paint_draw.known_subjects(text):
            return {"success": False, "ask": paint_draw.ASK_WHAT, "message": paint_draw.ASK_WHAT}
        return {"success": True, "message": "Drew a house in Paint."}

    monkeypatch.setattr(paint_draw, "draw", fake_draw)
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1, username="owner")
    try:
        client = TestClient(app)
        first = client.post("/api/desktop/voice-command",
                            json={"text": "paint mein kuch draw karo", "language": "en"}).json()
        assert first["followup"] == "paint" and first["action"] == "paint_draw"
        second = client.post("/api/desktop/voice-command",
                             json={"text": "ghar", "language": "en", "followup": "paint"}).json()
        assert second["success"] is True
        assert calls == ["paint mein kuch draw karo", "draw ghar"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_anything_means_smaran_picks():
    planned = paint_draw.plan("paint mein kuch bhi bana do")
    assert planned["subjects"][0] in paint_draw.SHAPES
