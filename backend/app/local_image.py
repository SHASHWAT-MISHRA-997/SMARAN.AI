"""Free, on-device text-to-image generation using Diffusers."""
import logging
import os
import threading
import difflib
import uuid

logger = logging.getLogger(__name__)
_pipeline = None
_lock = threading.Lock()


def _load_pipeline():
    global _pipeline
    if _pipeline is not None:
        return _pipeline
    try:
        import torch
        from diffusers.pipelines.stable_diffusion.pipeline_stable_diffusion import StableDiffusionPipeline
    except ImportError as exc:
        raise RuntimeError("Local image engine is not installed. Install backend requirements and restart Smaran AI.") from exc

    model_id = os.getenv("LOCAL_IMAGE_MODEL", "stabilityai/sd-turbo")
    offline_only = os.getenv("LOCAL_IMAGE_OFFLINE_ONLY", "0") == "1"
    use_cuda = torch.cuda.is_available() and os.getenv("LOCAL_IMAGE_DEVICE", "auto").lower() != "cpu"
    dtype = torch.float16 if use_cuda else torch.float32
    pipe = StableDiffusionPipeline.from_pretrained(
        model_id,
        torch_dtype=dtype,
        local_files_only=offline_only,
        use_safetensors=os.getenv("LOCAL_IMAGE_USE_SAFETENSORS", "1") == "1",
    )
    if use_cuda:
        offload_mode = os.getenv("LOCAL_IMAGE_OFFLOAD", "model").lower()
        if offload_mode == "sequential":
            pipe.enable_sequential_cpu_offload()
        elif offload_mode == "model":
            # The chat model sleeps while an image is generated, so component-level
            # offload is both safe on 6 GB GPUs and much faster than layer offload.
            pipe.enable_model_cpu_offload()
        else:
            pipe.to("cuda")
        pipe.enable_attention_slicing()
        try:
            pipe.enable_vae_slicing()
        except Exception:
            pass
    else:
        pipe.to("cpu")
    pipe.set_progress_bar_config(disable=True)
    _pipeline = pipe
    return pipe


def generate_local_image(prompt: str, output_dir: str) -> str:
    """Generate one local PNG and return its filename."""
    prompt = prompt.strip()
    if not prompt:
        raise ValueError("Image prompt cannot be empty")
    os.makedirs(output_dir, exist_ok=True)
    with _lock:
        pipe = _load_pipeline()
        release_gpu = os.getenv("LOCAL_IMAGE_RELEASE_GPU", "0") == "1"
        if release_gpu:
            try:
                pipe.to("cuda")
            except Exception:
                logger.exception("Could not move the image pipeline to CUDA")
        image_size = max(256, min(512, int(os.getenv("LOCAL_IMAGE_SIZE", "384"))))
        image_size -= image_size % 8
        steps = max(1, min(20, int(os.getenv("LOCAL_IMAGE_STEPS", "2"))))
        guidance = float(os.getenv("LOCAL_IMAGE_GUIDANCE", "0.0"))
        try:
            result = pipe(
                prompt=prompt,
                negative_prompt="blurry, low quality, distorted, watermark, unreadable text",
                width=image_size,
                height=image_size,
                num_inference_steps=steps,
                guidance_scale=guidance,
            )
        finally:
            if release_gpu:
                try:
                    import torch
                    pipe.to("cpu")
                    torch.cuda.empty_cache()
                except Exception:
                    logger.exception("Could not release image-model VRAM")
        if not result.images:
            raise RuntimeError("The local image model returned no image")
        filename = f"local_gen_{uuid.uuid4().hex}.png"
        result.images[0].save(os.path.join(output_dir, filename), format="PNG")
        return filename


# The Hindi entries here were "????? ????" and "?????? ????" - Devanagari that
# had been through a lossy encoding somewhere and come out as question marks.
# They matched nothing anybody would ever say, so asking for an image in Hindi
# never worked. Written back in Devanagari, and the file is UTF-8.
# The Hindi entries here were "????? ????" and "?????? ????" - Devanagari that
# had been through a lossy encoding somewhere and come out as question marks.
# They matched nothing anybody would ever say, so asking for an image in Hindi
# never worked. Written back in Devanagari, and the file is UTF-8.
#
# A verb and a thing, not a fixed phrase.
#
# This was a list of exact strings - "create a video", "make a video". Real
# requests put words in between: "Craete a full ultrarealistic + cyber and neon
# effect video" contains neither phrase, so it was not recognised as a video
# request at all. With web search on it went to the search path instead, and
# came back as a summary of somebody else's YouTube videos. The person had
# asked for a video to be made.
#
# So: any of these verbs, then the noun, with room between them - and the verb
# is matched a token at a time, allowing for a typo, because "craete" is what
# people type and refusing it is not principled.

MAKE_VERBS = (
    "generate", "create", "make", "draw", "render", "animate",
    "banao", "bana", "banaa", "banado", "banaye", "banaiye",
    "बनाओ", "बनाना", "बनाइए",
)

IMAGE_NOUNS = (
    "image", "picture", "photo", "photograph", "poster", "logo", "wallpaper",
    "illustration", "artwork", "tasveer", "tasvir", "chitra", "photu",
    "छवि", "तस्वीर", "फोटो", "चित्र",
)

VIDEO_NOUNS = (
    "video", "vidio", "clip", "animation", "movie", "reel", "footage",
    "चलचित्र", "वीडियो",
)

# Kept because they are unambiguous on their own, and shorter than the pattern
# above would allow: "/image", "image banao".
IMAGE_COMMANDS = (
    # Drawing and painting are picture-making whatever the object is: "draw a
    # red car" names no image noun at all.
    "draw a", "draw me", "draw an", "sketch a", "sketch me", "paint a",
    "image banao", "image bana", "photo banao", "picture banao",
    "tasveer banao", "tasvir banao", "chitra banao",
    "छवि बनाओ", "तस्वीर बनाओ", "फोटो बनाओ", "चित्र बनाओ",
)

# "draw" is also an ordinary English verb. These are the ways it gets used that
# have nothing to do with pictures.
NOT_DRAWING = (
    "draw a conclusion", "draw a comparison", "draw a parallel",
    "draw a distinction", "draw a line under", "draw attention",
    "draw the line", "draw a blank", "draw a salary",
)

VIDEO_COMMANDS = (
    "video banao", "video bana", "vidio banao",
    "वीडियो बनाओ", "चलचित्र बनाओ",
)

# A question about how to do something is not a request to do it.
QUESTION_MARKERS = ("how to", "how do i", "kaise", "कैसे")

# How far apart the verb and the noun may sit. Eight words covers "create a
# full ultrarealistic cyber and neon effect video" with room to spare, and
# stops "make a coffee while I watch a video" from counting.
_MAX_WORDS_BETWEEN = 8


def _looks_like(token: str, verb: str) -> bool:
    """One typo away is still the word. "craete" is "create"."""
    if token == verb:
        return True
    if abs(len(token) - len(verb)) > 1 or len(verb) < 4:
        return False
    return difflib.SequenceMatcher(None, token, verb).ratio() >= 0.8


def _verb_then_noun(words, nouns) -> bool:
    for index, word in enumerate(words):
        if not any(_looks_like(word, verb) for verb in MAKE_VERBS):
            continue
        window = words[index + 1:index + 2 + _MAX_WORDS_BETWEEN]
        if any(w.strip(".,!?:;\"'") in nouns for w in window):
            return True
    return False


def _asks_for(text: str, commands, nouns=()) -> bool:
    text = " ".join(text.lower().split())
    if any(marker in text for marker in QUESTION_MARKERS):
        return False
    if any(phrase in text for phrase in NOT_DRAWING):
        return False
    if any(command in text for command in commands):
        return True
    return bool(nouns) and _verb_then_noun(text.split(), nouns)


def is_image_generation_request(prompt: str) -> bool:
    """Conservative natural-language intent detection for English/Hinglish/Hindi."""
    text = " ".join(prompt.lower().split())
    if text.startswith(("/image", "/txt2img")):
        return True
    # A video request usually also contains image-ish words; it is not this.
    if _asks_for(text, VIDEO_COMMANDS, VIDEO_NOUNS):
        return False
    return _asks_for(text, IMAGE_COMMANDS, IMAGE_NOUNS)


def is_video_generation_request(prompt: str) -> bool:
    """Whether this asks for a video, in the same three languages."""
    text = " ".join(prompt.lower().split())
    if text.startswith("/video"):
        return True
    return _asks_for(text, VIDEO_COMMANDS, VIDEO_NOUNS)


def clean_video_prompt(prompt: str) -> str:
    text = prompt.strip()
    if text.lower().startswith("/video"):
        return text.split(" ", 1)[1].strip() if " " in text else ""
    return text


def clean_image_prompt(prompt: str) -> str:
    text = prompt.strip()
    if text.lower().startswith(("/image", "/txt2img")):
        return text.split(" ", 1)[1].strip() if " " in text else ""
    return text
