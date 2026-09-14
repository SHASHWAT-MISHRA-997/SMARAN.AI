"""The text encoder must never be held alongside the rest of the pipeline.

This is the fix for a crash, and the crash had no traceback: loading
LTX-Video's T5-XXL text encoder (19 GB on disk, ~9.5 GB at bfloat16, plus room
for a 5 GB shard while loading) on a 16 GB machine with a browser open killed
the process with a segmentation fault inside transformers' tensor
materialisation. No Python exception was raised, nothing reached the log, and
from outside the app simply disappeared partway through a render.

Because the failure mode is a hard crash rather than an exception, these tests
pin the *structure* that prevents it. They do not load any weights - doing so
would reintroduce the very condition being guarded against on the machine that
runs them.
"""

import ast
import inspect
import sys
import textwrap
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

ENGINE = BACKEND / "app" / "video" / "ltx_engine.py"
EMBEDS = BACKEND / "app" / "video" / "prompt_embeds.py"


def test_the_pipeline_is_loaded_without_a_text_encoder():
    """Loading it with the pipeline is what killed the process."""
    source = ENGINE.read_text(encoding="utf-8")
    assert "text_encoder=None" in source and "tokenizer=None" in source, (
        "the pipeline still loads its own text encoder, which does not fit"
    )


def test_the_encoder_is_capped_and_offloaded():
    source = EMBEDS.read_text(encoding="utf-8")
    for needed in ("device_map", "max_memory", "offload_folder"):
        assert needed in source, (
            f"{needed} is missing - without it the loader materialises the "
            f"whole encoder at once and the process dies"
        )


def test_the_encoder_is_freed_before_the_pipeline_loads():
    """Ordering is the whole point: the two together exceed the machine."""
    from app.video import ltx_engine

    source = inspect.getsource(ltx_engine.generate)
    encode_at = source.index("_prompt_embeds.encode")
    load_at = source.index("pipe = load(")
    assert encode_at < load_at, (
        "the pipeline is loaded before the prompt is encoded, so the text "
        "encoder and the transformer are in memory at the same time"
    )


def test_the_encoder_is_released_even_when_encoding_fails():
    """A failed encode that leaks 9.5 GB leaves the machine unusable."""
    source = EMBEDS.read_text(encoding="utf-8")
    tree = ast.parse(source)
    fn = next(n for n in ast.walk(tree)
              if isinstance(n, ast.FunctionDef) and n.name == "encode")
    tries = [n for n in ast.walk(fn) if isinstance(n, ast.Try) and n.finalbody]
    assert tries, "the encoder is not freed in a finally block"
    freed = any("del encoder" in ast.unparse(n) for t in tries for n in t.finalbody)
    assert freed, "the finally block does not release the encoder"


def test_generation_passes_embeddings_not_text():
    """A pipeline with no text encoder cannot be handed a string."""
    from app.video import ltx_engine

    source = inspect.getsource(ltx_engine.generate)
    assert "prompt_embeds=conditioning" in source
    assert "negative_prompt_embeds=conditioning" in source

    # Read the kwargs that go to the pipeline, rather than searching the whole
    # function for "prompt=". encode() is called with the text and should be -
    # a substring search flagged that as the bug it was looking for.
    tree = ast.parse(textwrap.dedent(source))
    call = next(
        node.value for node in ast.walk(tree)
        if isinstance(node, ast.Assign)
        and any(getattr(t, "id", None) == "kwargs" for t in node.targets)
        and isinstance(node.value, ast.Call)
    )
    names = {kw.arg for kw in call.keywords}
    assert "prompt_embeds" in names, "the pipeline is not given the embeddings"
    assert "prompt" not in names, (
        "the raw prompt is passed to a pipeline that has no text encoder"
    )
    assert "negative_prompt" not in names, (
        "the raw negative prompt is passed to a pipeline with no text encoder"
    )


def test_the_encoding_matches_the_pipelines_own():
    """Differing here silently changes what the same prompt produces.

    Two details in LTXPipeline._get_t5_prompt_embeds look like mistakes and are
    not: the encoder is called *without* the attention mask, and the mask is
    cast to bool. Copying one and not the other would give conditioning that
    differs from every other LTX caller, for no visible reason.
    """
    source = EMBEDS.read_text(encoding="utf-8")
    assert "encoder(inputs.input_ids)[0]" in source, (
        "the encoder is being called with an attention mask; the pipeline "
        "does not, and the embeddings differ if it is"
    )
    assert ".attention_mask.bool()" in source, "the mask is not cast to bool"
    assert "MAX_SEQUENCE_LENGTH = 128" in source, (
        "a sequence length other than the pipeline's 128 changes conditioning"
    )


def test_the_encoded_prompt_is_cached():
    """A chain of clips shares one prompt; encoding it each time is a minute
    of disk streaming per clip for an identical result."""
    from app.video import prompt_embeds

    assert hasattr(prompt_embeds, "_cache")
    assert hasattr(prompt_embeds, "clear_cache")


def test_the_cache_is_keyed_on_everything_that_changes_the_result():
    source = EMBEDS.read_text(encoding="utf-8")
    assert "key = (prompt, negative_prompt, str(dtype))" in source, (
        "two different prompts, or two dtypes, could collide in the cache"
    )
