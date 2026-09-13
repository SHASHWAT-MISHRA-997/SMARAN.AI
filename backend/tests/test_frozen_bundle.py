"""What the frozen application must actually contain.

The desktop builds shipped with ChromaDB broken. `--collect-all chromadb`
brought chromadb itself but not google.protobuf, which is a separate
distribution under the `google` namespace package: the bundle got protobuf's
compiled `_upb` extension and none of its Python modules. ChromaManager then
failed on startup with "module 'google.protobuf.message' has no attribute
'FrozenInstanceError'".

That alone would have been survivable if anything had stopped. Instead the RAG
pipeline set `chroma_manager = None`, `add_chunks` is guarded by
`and self.chroma_manager`, and uploading a document went on returning 200 with
a real document record while nothing was ever indexed. The only symptom was an
assistant that never cited a file it had been given.

It could not be caught by running the test suite either, because from source
protobuf is on the path and every one of these imports works. It is only ever
wrong inside the bundle, so the bundle is what gets checked.

Skipped when no build is present, so a source checkout is unaffected.
"""

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]

# Both desktop builds are produced by build_exe.py and share its collection
# settings, so a gap in one is a gap in the other. Whichever exists is checked.
CANDIDATES = (
    ROOT / "dist" / "SMARAN.AI" / "_internal",
    ROOT / "build-linux" / "dist" / "SMARAN.AI" / "_internal",
)


def bundles():
    return [path for path in CANDIDATES if path.is_dir()]


def bundle_ids():
    return [str(path.relative_to(ROOT)) for path in bundles()]


if not bundles():
    pytest.skip(
        "no frozen build in this checkout; run build_exe.py to check one",
        allow_module_level=True,
    )


@pytest.mark.parametrize("bundle", bundles(), ids=bundle_ids())
def test_google_protobuf_is_more_than_its_compiled_extension(bundle):
    """The exact shape of the failure: `google/` held only `_upb`."""
    google = bundle / "google"
    assert google.is_dir(), "google namespace package missing entirely"

    protobuf = google / "protobuf"
    assert protobuf.is_dir(), (
        "google/protobuf is absent - %s holds only %s. ChromaDB imports it, "
        "and without it document indexing fails silently."
        % (google, sorted(p.name for p in google.iterdir()))
    )

    # A directory is not enough: it has to be importable, which means the
    # modules chromadb actually reaches for have to be in it.
    for module in ("__init__.py", "message.py", "descriptor.py"):
        assert (protobuf / module).is_file(), "google/protobuf/%s missing" % module


@pytest.mark.parametrize("bundle", bundles(), ids=bundle_ids())
def test_the_packages_the_app_cannot_work_without_are_present(bundle):
    """Named individually because each one failed quietly when it was absent.

    onnxruntime and g2p_en are here for the same reason protobuf is: the
    packaged app reported "text-to-speech-offline: needs onnxruntime and
    g2p-en" and fell back to the online voice, which is why speaking worked
    from source and not from the installer.
    """
    for package in ("chromadb", "onnxruntime", "faster_whisper", "tokenizers"):
        assert (bundle / package).is_dir(), (
            "%s is not in the bundle; it is in COLLECT_ALL and should be" % package
        )


@pytest.mark.parametrize("bundle", bundles(), ids=bundle_ids())
def test_the_frontend_the_bundle_serves_is_the_one_that_was_built(bundle):
    """A bundle carrying a different release's UI than the tree it came from.

    The Linux packages shipped 2.10.38's application under a 2.10.39 label
    because the freeze was reused; this is the same check from the other end.
    """
    sys.path.insert(0, str(ROOT / "backend"))
    from app.updates import APP_VERSION

    assets = bundle / "frontend_dist" / "assets"
    if not assets.is_dir():
        pytest.skip("bundle carries no frontend_dist")

    # Matched rather than split on: the content hash that follows the version
    # may itself contain hyphens (inter-latin-ext-600-normal-v2.10.39-BYj_oED-),
    # so splitting produced fragments like "2.10.39-BYj_oED".
    import re

    versions = set(
        re.findall(r"-v(\d+\.\d+\.\d+)-", " ".join(p.name for p in assets.iterdir()))
    )

    assert versions == {APP_VERSION}, (
        "bundle holds %s but the tree is %s" % (sorted(versions) or "nothing", APP_VERSION)
    )
