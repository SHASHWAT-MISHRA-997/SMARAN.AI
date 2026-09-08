"""Frozen speech resources must work without downloading shipped corpora."""

import sys
from app import speech_resources


def test_copy_prefers_bundled_corpus(tmp_path, monkeypatch):
    bundle = tmp_path / "bundle"
    source = bundle / "nltk_data" / "corpora" / "cmudict"
    source.mkdir(parents=True)
    (source / "cmudict").write_text("bundled pronunciation data")
    ambient = tmp_path / "ambient"
    other = ambient / "nltk_data" / "corpora" / "cmudict"
    other.mkdir(parents=True)
    (other / "cmudict").write_text("unrelated data")
    monkeypatch.setattr(sys, "_MEIPASS", str(bundle), raising=False)
    monkeypatch.setenv("APPDATA", str(ambient))
    target = tmp_path / "owned"

    assert speech_resources._copy_existing("cmudict", "corpora/cmudict", str(target))
    assert (target / "corpora" / "cmudict" / "cmudict").read_text() == "bundled pronunciation data"


def test_existing_owned_corpus_is_preserved(tmp_path, monkeypatch):
    target = tmp_path / "owned"
    corpus = target / "corpora" / "cmudict"
    corpus.mkdir(parents=True)
    (corpus / "cmudict").write_text("existing data")
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path / "missing"), raising=False)

    assert speech_resources._copy_existing("cmudict", "corpora/cmudict", str(target))
    assert (corpus / "cmudict").read_text() == "existing data"
