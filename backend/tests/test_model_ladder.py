"""Picking the image model from what the card can actually do.

The thresholds here are measurements, and the first set were guesses that were
wrong in both directions.

SDXL was written off below 9.5 GB of free VRAM. Measured on a 6 GB RTX 2060
with sequential offload it renders at its native 1024 in 213 s at **3.23 GB**
peak, and at 768 in 147 s at 1.82 GB - a card the ladder had excluded runs it
perfectly well, just slowly. The guess cost that machine the better model
entirely.

Three bugs came out of correcting it, each found by running the ladder across a
range of cards rather than reading it:

  * With no readable VRAM the ladder fell back to the *first* installed entry.
    It is ordered largest first, so a machine reporting no usable memory was
    handed SDXL - the worst possible choice for exactly the case the fallback
    existed to cover.

  * Ranking that fallback by vram_gb broke the moment vram_gb came to mean
    "enough to run at native size": SDXL reaches 1024 in less memory than
    SD 1.5 needs for 768, so its figure dropped below SD 1.5's and the largest
    model was again handed to the weakest machines.

  * SDXL was capped by VRAM tiers measured with SD 1.5, so a card with 4.4 GB
    free rendered it at 768 - below its training size, where it is visibly
    worse - when 1024 fit comfortably.

  * A machine too small for SD 1.5 was offered SD-Turbo as an "upgrade". Turbo
    draws at 512 against SD 1.5's 768. A download suggested as an improvement
    has to be one.
"""

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app import image_plan  # noqa: E402

SDXL = "stabilityai/stable-diffusion-xl-base-1.0"
SD15 = "stable-diffusion-v1-5/stable-diffusion-v1-5"
TURBO = "stabilityai/sd-turbo"


@pytest.fixture
def all_installed(monkeypatch):
    monkeypatch.setattr(image_plan, "_is_downloaded", lambda repo: True)


@pytest.fixture
def only_small(monkeypatch):
    monkeypatch.setattr(
        image_plan, "_is_downloaded", lambda repo: repo in (SD15, TURBO))


def choose(monkeypatch, vram):
    monkeypatch.setattr(image_plan, "probe_vram_gb", lambda: vram)
    return image_plan.available_model()


# ---------------------------------------------------------------------------
# The measurement that started it
# ---------------------------------------------------------------------------

def test_sdxl_is_not_written_off_on_a_six_gigabyte_card(all_installed, monkeypatch):
    """3.23 GB peak at 1024, measured. The 9.5 GB guess excluded it."""
    assert choose(monkeypatch, 4.4) == SDXL


def test_sdxl_renders_at_its_native_size_when_it_fits(all_installed):
    """768 is below what SDXL was trained for and looks worse. The generic
    tiers were measured with a different model and must not cap it."""
    assert image_plan.plan(SDXL, "1:1", vram_gb=4.4)["width"] == 1024


def test_a_card_that_can_hold_it_is_told_it_will_be_quick():
    slow = image_plan.plan(SDXL, "1:1", vram_gb=4.4)
    fast = image_plan.plan(SDXL, "1:1", vram_gb=12.0)
    assert slow["offloaded"] is True and slow["speed_note"]
    assert fast["offloaded"] is False and fast["speed_note"] == ""


def test_the_slow_path_says_so_in_words_a_person_can_act_on():
    note = image_plan.plan(SDXL, "1:1", vram_gb=4.4)["speed_note"]
    assert "minutes rather than seconds" in note


# ---------------------------------------------------------------------------
# The weakest machines must not get the heaviest model
# ---------------------------------------------------------------------------

def test_an_unreadable_card_gets_the_lightest_model_not_the_largest(
        all_installed, monkeypatch):
    """probe returns 0.0 when the driver will not answer, and on CPU-only
    machines. Handing those SDXL is the exact opposite of a safe default."""
    assert choose(monkeypatch, 0.0) != SDXL


def test_a_small_card_gets_a_small_model(all_installed, monkeypatch):
    for vram in (0.0, 1.0, 2.0, 3.0):
        assert choose(monkeypatch, vram) != SDXL, vram


def test_the_fallback_is_ranked_by_model_weight(all_installed, monkeypatch):
    """Not by vram_gb, which no longer orders the models by size at all."""
    smallest = choose(monkeypatch, 0.0)
    entry = next(e for e in image_plan.LADDER if e["repo"] == smallest)
    assert entry["native"] == min(e["native"] for e in image_plan.LADDER)


def test_bigger_cards_never_get_a_smaller_model(all_installed, monkeypatch):
    sizes = [
        image_plan.plan(choose(monkeypatch, v), "1:1", vram_gb=v)["width"]
        for v in (0.0, 2.0, 3.0, 4.4, 12.0, 24.0)
    ]
    assert sizes == sorted(sizes), "more memory produced a smaller picture: %r" % sizes


# ---------------------------------------------------------------------------
# Only a real upgrade is offered
# ---------------------------------------------------------------------------

def test_a_downgrade_is_never_offered_as_an_upgrade(only_small, monkeypatch):
    """SD-Turbo draws at 512; SD 1.5 at 768. Offering turbo to a machine
    already on SD 1.5 suggests a 2.5 GB download that makes pictures worse."""
    monkeypatch.setattr(image_plan, "probe_vram_gb", lambda: 2.0)
    offer = image_plan.better_model_available(vram_gb=2.0)
    assert offer is None or offer["native"] > 768


def test_nothing_is_offered_when_the_best_is_already_installed(
        all_installed, monkeypatch):
    monkeypatch.setattr(image_plan, "probe_vram_gb", lambda: 24.0)
    assert image_plan.better_model_available(vram_gb=24.0) is None


def test_an_upgrade_is_offered_when_the_card_can_use_it(only_small, monkeypatch):
    monkeypatch.setattr(image_plan, "probe_vram_gb", lambda: 12.0)
    offer = image_plan.better_model_available(vram_gb=12.0)
    assert offer and offer["repo"] == SDXL
    assert offer["download_gb"] > 0
    # It must say what it costs, not just that it is better.
    assert "download" in offer["reason"]
    assert "not fetched unless you ask" in offer["reason"]


def test_an_offer_is_never_made_for_something_already_on_disk(
        all_installed, monkeypatch):
    monkeypatch.setattr(image_plan, "probe_vram_gb", lambda: 12.0)
    assert image_plan.better_model_available(vram_gb=12.0) is None


# ---------------------------------------------------------------------------
# Nothing downloads itself
# ---------------------------------------------------------------------------

def test_choosing_a_model_never_downloads_one():
    import inspect

    source = inspect.getsource(image_plan.available_model)
    assert "snapshot_download" not in source
    assert "hf_hub_download" not in source


def test_an_explicit_choice_still_wins(monkeypatch):
    monkeypatch.setenv("LOCAL_IMAGE_MODEL", "someone/their-model")
    assert image_plan.available_model() == "someone/their-model"
