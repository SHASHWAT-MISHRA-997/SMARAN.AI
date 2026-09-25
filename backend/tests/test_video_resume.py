"""A long video survives failure: finished clips are kept, and asking again carries on."""
import os

import pytest

from app.video import continuity as co

PLAN = {"possible": True, "chunks": 4, "chunk_durations": [1.7, 1.7, 1.7, 0.9], "total_seconds": 6.0,
        "width": 704, "height": 448, "fps": 24, "steps": 20, "estimate_text": "About 4 hours", "caveat": ""}


@pytest.fixture
def rig(tmp_path, monkeypatch):
    monkeypatch.setattr(co, "plan_sequence", lambda *a, **k: dict(PLAN))
    from app.config import settings
    monkeypatch.setattr(settings, "DATA_DIR", str(tmp_path))
    rendered = []
    state = {"fail_at": None}

    def fake_generate(output_path, image_path=None, **kw):
        index = len(rendered)
        if state["fail_at"] is not None and index == state["fail_at"]:
            raise RuntimeError("card fell over")
        rendered.append((output_path, image_path))
        with open(output_path, "wb") as fh:
            fh.write(b"clip")

    import app.video.ltx_engine as engine
    monkeypatch.setattr(engine, "generate", fake_generate)
    monkeypatch.setattr(co, "last_frame", lambda part, still: open(still, "wb").close() or still)
    monkeypatch.setattr(co, "concatenate", lambda parts, out: open(out, "wb").write(b"".join(open(p, "rb").read() for p in parts)))
    return rendered, state, tmp_path


def test_a_failed_chain_keeps_its_clips_and_resumes(rig):
    rendered, state, tmp = rig
    out = str(tmp / "out.mp4")
    state["fail_at"] = 2
    with pytest.raises(RuntimeError):
        co.generate_sequence("a fox", out, 6.0)
    assert len(rendered) == 2
    work = co.resume_dir("a fox", PLAN, "16:9", None, 3.0)
    assert sorted(os.listdir(work))[:2] == ["part0000.mp4", "part0001.mp4"]

    state["fail_at"] = None
    notes = []
    co.generate_sequence("a fox", out, 6.0, progress=notes.append)
    assert len(rendered) == 4                      # only clips 3 and 4 were rendered again
    assert rendered[2][1] and rendered[2][1].endswith("still0001.png")   # continues from clip 2's last frame
    assert any("Carrying on: 2 of 4" in n for n in notes)
    assert open(out, "rb").read() == b"clip" * 4
    assert not os.path.exists(work)                # cleaned up once the whole video exists


def test_stop_is_honoured_between_clips_and_loses_nothing(rig):
    rendered, state, tmp = rig
    calls = {"n": 0}

    def stop_after_one():
        calls["n"] += 1
        return calls["n"] > 1

    with pytest.raises(co.ContinuityError, match="Stopped after 1 of 4"):
        co.generate_sequence("a fox", str(tmp / "o.mp4"), 6.0, should_stop=stop_after_one)
    assert len(rendered) == 1
    kept = [f for f in os.listdir(co.resume_dir("a fox", PLAN, "16:9", None, 3.0)) if f.startswith("part")]
    assert kept == ["part0000.mp4"]


def test_a_different_request_does_not_reuse_clips(rig):
    assert co.resume_dir("a fox", PLAN, "16:9", None, 3.0) != co.resume_dir("a cat", PLAN, "16:9", None, 3.0)
    assert co.resume_dir("a fox", PLAN, "16:9", None, 3.0) != co.resume_dir("a fox", PLAN, "9:16", None, 3.0)


def test_an_hour_is_accepted_and_more_is_not():
    from pydantic import ValidationError
    from app.video.routes import GenerateRequest

    assert GenerateRequest(prompt="x", seconds=3600).seconds == 3600
    with pytest.raises(ValidationError):
        GenerateRequest(prompt="x", seconds=3601)
