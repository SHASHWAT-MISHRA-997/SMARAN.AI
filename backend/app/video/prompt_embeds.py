"""Encode the prompt without holding the text encoder in RAM.

The reason this exists is a crash, not a preference.

LTX-Video's text encoder is T5-XXL: 19 GB on disk at fp32, about 9.5 GB once
loaded at bfloat16, and the loader needs room for a 5 GB shard on top of that
while it works. On a 16 GB machine with a browser open there is around 9 GB
free, so loading it *segmentation faulted* - the process died outright inside
transformers' tensor materialisation, with no Python exception and nothing in
the log. From the user's side the app simply vanished mid-render.

The fix is to stop holding the whole thing at once. Two changes:

  * The encoder is loaded with accelerate's disk offload and a hard cap on how
    much RAM it may use, so weights stream from disk as each layer runs.
    Measured on the 6 GB / 16 GB machine this was written for: 26 seconds to
    load inside ~2.7 GB, against a segfault before.

  * It is freed the moment the prompt is encoded, before the transformer and
    VAE are loaded at all. Peak memory becomes the larger of the two halves
    rather than their sum.

The result - four tensors, about a megabyte - is cached, so a sequence of
clips sharing one prompt pays the encode once instead of once per clip.

The encoding deliberately mirrors LTXPipeline._get_t5_prompt_embeds exactly,
including the two things that look like mistakes and are not: the encoder is
called *without* the attention mask, and the mask is cast to bool. Differing
from the pipeline here would change the conditioning and quietly produce
something other than what the same prompt produces normally.
"""

from __future__ import annotations

import gc
import logging
import os
import threading
from typing import Callable, Optional

logger = logging.getLogger(__name__)

MAX_SEQUENCE_LENGTH = 128

# How much RAM the text encoder may occupy before the rest streams from disk.
# Low enough to leave room for everything else on a 16 GB machine; high enough
# that the encode is not pure disk traffic.
_ENCODER_RAM_CAP = "4GiB"

_cache: dict = {}
_cache_lock = threading.Lock()

# Four small tensors per entry, so this is bounded for tidiness rather than to
# reclaim any real amount of memory.
_CACHE_LIMIT = 32


def _offload_dir() -> str:
    from app.config import settings

    path = os.path.join(settings.DATA_DIR, "video", "offload")
    os.makedirs(path, exist_ok=True)
    return path


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


def encode(
    prompt: str,
    negative_prompt: str = "",
    dtype=None,
    progress: Optional[Callable[[str], None]] = None,
) -> dict:
    """Return prompt/negative embeddings and masks for LTX-Video.

    The text encoder is loaded, used and discarded inside this call.
    """
    import torch

    dtype = dtype or torch.bfloat16
    key = (prompt, negative_prompt, str(dtype))
    with _cache_lock:
        hit = _cache.get(key)
    if hit is not None:
        if progress:
            progress("Reusing the encoded prompt.")
        return hit

    from transformers import T5EncoderModel, T5TokenizerFast

    # Imported inside the call, not at module scope: ltx_engine imports this
    # module, so a top-level import here would be a cycle.
    from .ltx_engine import MODEL_ID
    from .registry import by_id

    repo = by_id(MODEL_ID).hf_repo

    if progress:
        progress("Reading the prompt. The text encoder streams from disk, "
                 "which takes about a minute and keeps memory in bounds.")

    tokenizer = T5TokenizerFast.from_pretrained(repo, subfolder="tokenizer")
    encoder = T5EncoderModel.from_pretrained(
        repo,
        subfolder="text_encoder",
        dtype=dtype,
        low_cpu_mem_usage=True,
        # Without these three the loader tries to materialise 9.5 GB at once
        # and the process dies with no traceback.
        device_map="auto",
        max_memory={"cpu": _ENCODER_RAM_CAP},
        offload_folder=_offload_dir(),
        offload_state_dict=True,
    )

    try:
        result = {}
        for name, text in (("prompt", prompt), ("negative_prompt", negative_prompt)):
            inputs = tokenizer(
                [text],
                padding="max_length",
                max_length=MAX_SEQUENCE_LENGTH,
                truncation=True,
                add_special_tokens=True,
                return_tensors="pt",
            )
            with torch.no_grad():
                # No attention mask here. The pipeline does not pass one
                # either, and passing one changes the embeddings.
                embeds = encoder(inputs.input_ids)[0]
            result["%s_embeds" % name] = embeds.to(dtype=dtype)
            result["%s_attention_mask" % name] = inputs.attention_mask.bool()
    finally:
        # Freed before the transformer and VAE are loaded. This ordering is
        # the entire point: held on to, the two together exceed the machine.
        del encoder
        gc.collect()
        try:
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:  # noqa: BLE001
            logger.debug("could not empty the CUDA cache", exc_info=True)

    with _cache_lock:
        if len(_cache) >= _CACHE_LIMIT:
            _cache.pop(next(iter(_cache)))
        _cache[key] = result
    return result
