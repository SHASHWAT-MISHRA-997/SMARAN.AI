"""Adapter: openWakeWord's train.py imports `generate_samples` from the root
of piper-sample-generator, which moved into a package (and started requiring
the model path) in 3.x. This keeps train.py unmodified.

The generator model comes from PIPER_MODEL, set by train.sh.
"""
import os

from piper_sample_generator.__main__ import generate_samples as _generate


def generate_samples(**kwargs):
    kwargs.setdefault("model", os.environ["PIPER_MODEL"])
    # Later LibriTTS speakers had very little training audio and come out
    # garbled; the generator's own README recommends staying under ~900.
    kwargs.setdefault("max_speakers", 800)
    kwargs.pop("auto_reduce_batch_size", None)
    # v2 missed quick speakers (SAPI rate +2 scored 0.0): add faster speeds than
    # train.py's fixed 0.75 / 1.0 / 1.25 (lower = faster).
    if list(kwargs.get("length_scales", ())) == [0.75, 1.0, 1.25]:
        kwargs["length_scales"] = [0.55, 0.65, 0.75, 0.9, 1.0, 1.25]
    return _generate(**kwargs)
