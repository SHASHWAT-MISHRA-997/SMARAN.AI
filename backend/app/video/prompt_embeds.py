"""Encode the prompt without holding the text encoder in RAM.

The reason this exists is a crash, not a preference.

LTX-Video's text encoder is T5-XXL: 19 GB on disk at fp32, about 9.5 GB once
loaded at bfloat16, and the loader needs room for a 5 GB shard on top of that
while it works. On a 16 GB machine with a browser open there is around 9 GB
free, so loading it *segmentation faulted* - the process died outright inside
transformers' tensor materialisation, with no Python exception and nothing in
the log. From the user's side the app simply vanished mid-render.

The fix is to stop holding the whole thing at once. Two changes:

  * The encoder streams: each block's weights are read from disk just before
    it runs and dropped just after (StreamedT5Encoder). accelerate's disk
    offload did this job once and now crashes torch itself, so it is not used.

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

_cache: dict = {}
_cache_lock = threading.Lock()

# Four small tensors per entry, so this is bounded for tidiness rather than to
# reclaim any real amount of memory.
_CACHE_LIMIT = 32


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


class StreamedT5Encoder:
    """T5-XXL, one block at a time, straight from its files.

    accelerate's disk offload (device_map="auto" with an offload folder) was
    the previous answer to the encoder not fitting in RAM, and on the current
    torch / transformers / accelerate it crashes the process with an access
    violation inside torch_cpu.dll during the first forward pass - measured on
    the RTX 2060 / 16 GB machine, every time. A native crash takes the whole
    app down, so video could not be made at all.

    This does the same streaming without accelerate's offload machinery: the
    model is built empty (on the meta device), and each of its 24 blocks has
    its weights read from the safetensors shards onto the GPU just before it
    runs and dropped just after. Peak memory is the embedding plus one block -
    well under a gigabyte - on a card or in RAM, whichever is used. Blocks run
    in float32: T5 overflows in float16, and Turing cards have no fast
    bfloat16, so float32 is both the correct and the fast choice here.
    """

    def __init__(self, repo: str):
        import json
        from contextlib import ExitStack

        import torch
        from accelerate import init_empty_weights
        from huggingface_hub import snapshot_download
        from safetensors import safe_open
        from transformers import T5Config, T5EncoderModel

        root = snapshot_download(repo, allow_patterns=["text_encoder/*"])
        self.folder = os.path.join(root, "text_encoder")
        with open(os.path.join(self.folder, "model.safetensors.index.json"), encoding="utf-8") as fh:
            self.weight_map = json.load(fh)["weight_map"]
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.compute = torch.float32
        self._files = ExitStack()
        self._open = {}
        self._safe_open = safe_open

        config = T5Config.from_pretrained(self.folder)
        with init_empty_weights():
            self.model = T5EncoderModel(config)
        self.model.eval()

        # Always resident: the token embedding and the closing layer norm.
        self._load(self.model.shared, "shared.")
        embed = self.model.encoder.embed_tokens
        if embed is not self.model.shared:
            self._load(embed, "shared.", alias=True)
        self._load(self.model.encoder.final_layer_norm, "encoder.final_layer_norm.")

        self._hooks = []
        for index, block in enumerate(self.model.encoder.block):
            prefix = "encoder.block.%d." % index
            self._hooks.append(block.register_forward_pre_hook(
                lambda module, args, prefix=prefix: self._load(module, prefix)))
            self._hooks.append(block.register_forward_hook(
                lambda module, args, output: self._drop(module)))

    def _tensor(self, key: str):
        name = self.weight_map[key]
        handle = self._open.get(name)
        if handle is None:
            handle = self._files.enter_context(
                self._safe_open(os.path.join(self.folder, name), framework="pt", device="cpu"))
            self._open[name] = handle
        return handle.get_tensor(key)

    @staticmethod
    def _set(module, dotted: str, value) -> None:
        import torch

        *path, leaf = dotted.split(".")
        for part in path:
            module = getattr(module, part)
        module._parameters[leaf] = torch.nn.Parameter(value, requires_grad=False)

    def _load(self, module, prefix: str, alias: bool = False) -> None:
        for name, _ in list(module.named_parameters(recurse=True)):
            key = "shared.weight" if alias else prefix + name
            self._set(module, name, self._tensor(key).to(device=self.device, dtype=self.compute))

    def _drop(self, module) -> None:
        import torch

        for name, param in list(module.named_parameters(recurse=True)):
            self._set(module, name, torch.empty(param.shape, dtype=param.dtype, device="meta"))

    def __call__(self, input_ids):
        out = self.model(input_ids=input_ids.to(self.device))
        hidden = out[0] if isinstance(out, (tuple, list)) else out.last_hidden_state
        return hidden.detach().to("cpu")

    def close(self) -> None:
        for hook in self._hooks:
            hook.remove()
        self._hooks = []
        self._files.close()
        self._open.clear()
        self.model = None


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
    encoder = StreamedT5Encoder(repo)
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
                embeds = encoder(inputs.input_ids)
            result["%s_embeds" % name] = embeds.to(dtype=dtype)
            result["%s_attention_mask" % name] = inputs.attention_mask.bool()
    finally:
        # Freed before the transformer and VAE are loaded. This ordering is
        # the entire point: held on to, the two together exceed the machine.
        encoder.close()
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
