"""Free, on-device text-to-image generation using Diffusers."""
import logging
import os
import re
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


# The shape and the length, taken from the sentence the user already typed.
#
# A dropdown neither of them can find is not a choice. People ask for "a 5
# second vertical video of a lantern" in one breath, so that is what gets read.
# Whatever is recognised is also removed from the prompt: left in, "9:16" and
# "5 seconds" become part of the scene the model is asked to draw.
def _shape_words(*words):
    """A shape word only counts when it is being used as a shape.

    Matching these bare would be worse than not matching them at all. "A video
    of a mountain landscape" is a subject, not an orientation, and reading it
    as one would both rotate the video and delete the word from the prompt, so
    the model would never hear what to draw. "Portrait" has the same problem -
    a portrait of someone - and "short video" is a length, not a shape.

    So the word has to be qualified: "portrait mode", "in portrait",
    "landscape format", "vertical video".
    """
    joined = "|".join(words)
    # "portrait mode" leaves nothing worth keeping, so both words go. But in
    # "vertical video" the qualifier *is* the sentence - taking it left "make a
    # of a lantern", a prompt with its subject removed - so it is matched by
    # lookahead and stays where it is.
    debris = r"(?:mode|format|orientation|aspect|ratio|size)"
    kept = r"(?:video|clip|screen|shot|film|reel)"
    return (
        r"\b(?:in\s+(?:the\s+)?)?(?:%s)\s+%s\b"      # portrait mode
        r"|\b%s\s+(?:%s)\b"                          # format: portrait
        r"|\b(?:in\s+(?:the\s+)?)?(?:%s)(?=\s+%s\b)"  # vertical video
        r"|\bin\s+(?:the\s+)?(?:%s)\b"               # in portrait
    ) % (joined, debris, debris, joined, joined, kept, joined)


_ASPECT_WORDS = (
    # Written as a ratio. Unambiguous, so these need no qualifier.
    (r"\b16\s*[:x/]\s*9\b", "16:9"),
    (r"\b9\s*[:x/]\s*16\b", "9:16"),
    (r"\b4\s*[:x/]\s*3\b", "4:3"),
    (r"\b1\s*[:x/]\s*1\b", "1:1"),
    # Named formats that are vertical by definition, and are not ordinary
    # nouns in the plural. "Shorts" alone is left out: it is clothing at least
    # as often as it is a video format.
    (r"\b(?:instagram\s+reels?|youtube\s+shorts?|reels)\b", "9:16"),
    (_shape_words("portrait", "vertical"), "9:16"),
    (_shape_words("landscape", "horizontal", "widescreen"), "16:9"),
    (_shape_words("square"), "1:1"),
)

# "5 second", "5 sec", "5s", "5 seconds ka", "5 sekand" - and minutes, which
# are usually far beyond what a card can decode but must still be *read*, so
# the refusal can name the number the user actually asked for instead of
# silently making two seconds.
_SECONDS_RE = re.compile(
    r"\b(\d+(?:\.\d+)?)\s*(?:-|\s)?\s*"
    r"(seconds?|secs?|sekand|second\s*ka|s)\b(?:\s*ka\b|\s*(?:ki|ka|of)\b)?",
    re.IGNORECASE,
)
_MINUTES_RE = re.compile(
    r"\b(\d+(?:\.\d+)?)\s*(?:-|\s)?\s*(minutes?|mins?|minut|min)\b(?:\s*ka\b)?",
    re.IGNORECASE,
)


def read_video_options(prompt: str):
    """Pull the requested length and shape out of a prompt.

    Returns (prompt without those words, seconds or None, aspect or None).
    None means the user did not say, and the machine's own default is used -
    not a number invented here.
    """
    text = prompt or ""
    seconds = None
    aspect = None

    match = _MINUTES_RE.search(text)
    if match:
        seconds = float(match.group(1)) * 60.0
        text = text[: match.start()] + " " + text[match.end():]
    else:
        match = _SECONDS_RE.search(text)
        if match:
            seconds = float(match.group(1))
            text = text[: match.start()] + " " + text[match.end():]

    for pattern, value in _ASPECT_WORDS:
        found = re.search(pattern, text, re.IGNORECASE)
        if found:
            aspect = value
            text = text[: found.start()] + " " + text[found.end():]
            break

    # Tidy what the removals left behind: doubled spaces, and a dangling
    # connective like "a video of  in a forest".
    text = re.sub(r"\s{2,}", " ", text).strip()
    text = re.sub(r"\b(?:ka|ki|of|in|wala|wali)\s*$", "", text, flags=re.IGNORECASE)
    return text.strip(" ,.-"), seconds, aspect


def clean_image_prompt(prompt: str) -> str:
    text = prompt.strip()
    if text.lower().startswith(("/image", "/txt2img")):
        return text.split(" ", 1)[1].strip() if " " in text else ""
    return text
