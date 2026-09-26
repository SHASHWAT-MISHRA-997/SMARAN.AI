"""SMARAN operating the computer: the loop, and what it will not do alone."""
import asyncio
import base64
import io

import pytest

from app import computer_agent as ca, control_session


def _png(w=1920, h=1080):
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (w, h), "white").save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def fake_screen(monkeypatch):
    monkeypatch.setattr(ca, "capture", lambda: _png())
    done = []

    async def act(step, scale, token=""):
        done.append((step["action"], round(float(step.get("x", 0)) * scale) if "x" in step else None))
        return {"success": True, "message": "ok"}
    monkeypatch.setattr(ca, "act", act)
    return done


def _run(replies, token=None):
    it = iter(replies)
    events = []
    token = token or control_session.begin("test")
    asyncio.run(ca.run("goal", events.append, token,
                       see=lambda prompt, image: {"answer": next(it), "model": "m", "where": "local"}))
    return events


def test_steps_scale_back_to_the_real_screen(fake_screen):
    events = _run(['{"action":"click","x":640,"y":360}', '{"action":"done","summary":"ok"}'])
    assert fake_screen == [("click", 960)]          # 1280-wide image, 1920-wide screen
    assert events[-1] == {"type": "done", "summary": "ok", "steps": 2}


def test_money_and_passwords_become_a_question(fake_screen):
    events = _run(['{"thought":"press Place order to buy it","action":"click","x":5,"y":5}'])
    assert fake_screen == [] and events[-1]["type"] == "question"
    events = _run(['{"action":"type","text":"Hunter2!xyz"}'])
    assert fake_screen == [] and events[-1]["type"] == "question"
    events = _run(['{"action":"open_app","name":"paytm"}'])
    assert fake_screen == [] and events[-1]["type"] == "question"


def test_stop_ends_the_run_before_the_next_step(fake_screen):
    token = control_session.begin("test")
    control_session.stop(token)
    events = _run(['{"action":"click","x":1,"y":1}'], token)
    assert fake_screen == [] and events == [{"type": "stopped"}]


def test_a_model_that_never_acts_is_given_up_on(fake_screen):
    events = _run(["I think so", "hmm", "maybe"])
    assert events[-1]["type"] == "error" and "without an action" in events[-1]["message"]


def test_the_action_is_found_however_it_is_wrapped():
    assert ca.parse('Sure!\n```json\n{"action": "key", "key": "ctrl+l"}\n```')["key"] == "ctrl+l"
    assert ca.parse('{"note": {"a": 1}} then {"action":"done"}')["action"] == "done"
    assert ca.parse("no json here") is None


def test_the_grid_image_is_model_sized():
    image, scale, size, preview = ca.prepare(_png())
    assert size == (1280, 720) and scale == 1.5
    from PIL import Image
    assert Image.open(io.BytesIO(base64.b64decode(preview))).size[0] <= 720


def test_computer_use_off_stops_keys(monkeypatch):
    from app import control_prefs
    monkeypatch.setattr(control_prefs, "load", lambda: {"computer_use_enabled": False})
    out = asyncio.run(ca.act({"action": "key", "key": "enter"}, 1.0, ""))
    assert out["blocked"]
