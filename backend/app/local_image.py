"""Free, on-device text-to-image generation using Diffusers."""
import logging
import os
import re
import threading
from typing import Optional
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
        # AutoPipeline rather than the Stable Diffusion 1.x class by name.
        #
        # The fixed class was fine while SD 1.5 was the only thing that could
        # be chosen. Once the model is picked from what the card can run, it
        # can be SDXL - which is a different architecture with two text
        # encoders, and loading it through the 1.x pipeline does not work. The
        # selector would offer a model the loader could not open.
        from diffusers import AutoPipelineForText2Image
    except ImportError as exc:
        raise RuntimeError("Local image engine is not installed. Install backend requirements and restart Smaran AI.") from exc

    # Whichever image model is actually on disk, rather than a fixed name.
    # The default was sd-turbo on every machine, downloaded or not, so the
    # first image request on a machine that already held Stable Diffusion 1.5
    # started a fresh multi-gigabyte download instead of using it.
    from app.image_plan import available_model

    model_id = available_model()
    offline_only = os.getenv("LOCAL_IMAGE_OFFLINE_ONLY", "0") == "1"
    use_cuda = torch.cuda.is_available() and os.getenv("LOCAL_IMAGE_DEVICE", "auto").lower() != "cpu"
    dtype = torch.float16 if use_cuda else torch.float32
    common = dict(
        torch_dtype=dtype,
        local_files_only=offline_only,
        use_safetensors=os.getenv("LOCAL_IMAGE_USE_SAFETENSORS", "1") == "1",
    )
    # Prefer the fp16 weights where a repository publishes them.
    #
    # SDXL ships both, and the fp32 copies are twice the size for a pipeline
    # that runs in fp16 anyway - so only the fp16 variant is downloaded. Asking
    # without naming the variant asks for the fp32 files, which are not there,
    # and the load fails with "1 file(s) are missing" on a model that is
    # perfectly well installed.
    try:
        pipe = AutoPipelineForText2Image.from_pretrained(
            model_id, variant="fp16", **common)
    except Exception:  # noqa: BLE001
        # No fp16 variant published, or only the full weights are on disk.
        # Both are normal; the plain load is correct for them.
        logger.info("No fp16 variant for %s; loading the default weights.", model_id)
        pipe = AutoPipelineForText2Image.from_pretrained(model_id, **common)
    if use_cuda:
        # Sequential offload when the model does not fit, component offload
        # when it does.
        #
        # Component-level offload moves whole pieces at a time, and SDXL's unet
        # alone is 5.1 GB - more than a 6 GB card has free - so it runs out of
        # memory on exactly the machines that need offloading most. Sequential
        # moves a layer at a time and is what the measurement was taken with:
        # 1024x1024 at 3.23 GB peak on a 6 GB card.
        from app.image_plan import plan as _plan_image

        try:
            fits = not _plan_image(model_id)["offloaded"]
        except Exception:  # noqa: BLE001
            fits = False
        offload_mode = os.getenv(
            "LOCAL_IMAGE_OFFLOAD", "model" if fits else "sequential").lower()
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
    # Carried on the pipeline because the step count and guidance depend on
    # which family of model this is, and the pipeline object does not say.
    pipe._smaran_model_id = model_id
    _pipeline = pipe
    return pipe


def _is_blank(image) -> bool:
    """Whether an image carries no picture at all.

    Checked by extremes rather than the mean: a legitimately dark night scene
    still varies, while a substituted frame is one flat colour throughout.
    """
    try:
        extrema = image.convert("RGB").getextrema()
    except Exception:  # noqa: BLE001
        logger.debug("could not inspect the generated image", exc_info=True)
        return False
    return all(low == high for low, high in extrema)


def generate_local_image(prompt: str, output_dir: str,
                         aspect: Optional[str] = None,
                         target: Optional[str] = None) -> str:
    """Generate one local PNG and return its filename.

    aspect is one of image_plan.ASPECTS; target is an enlargement size such as
    "4K". Both default to the machine's own choice when not given, so every
    existing caller keeps working unchanged.
    """
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
        # Chosen from the card, not fixed at 384 with a hard ceiling of 512.
        # That ceiling was the blurriness: this machine renders 768x768 in
        # about fifteen seconds, which is four times the pixels, and was never
        # allowed to. Steps and guidance come with the size because they belong
        # to the model - a turbo model wants 4 steps at guidance 0 and SD 1.5
        # wants 25 at 7.5, so one fixed pair is always wrong for one of them.
        from app.image_plan import plan as plan_image

        settings = plan_image(
            model_id=getattr(pipe, "_smaran_model_id", "") or "",
            aspect=aspect or os.getenv("LOCAL_IMAGE_ASPECT", "1:1"),
        )
        override = os.getenv("LOCAL_IMAGE_SIZE")
        if override:
            asked = max(256, min(1024, int(override)))
            settings["width"] = settings["height"] = asked - asked % 8
        steps = int(os.getenv("LOCAL_IMAGE_STEPS") or settings["steps"])
        guidance = float(os.getenv("LOCAL_IMAGE_GUIDANCE") or settings["guidance"])
        logger.info(
            "image: %dx%d, %d steps, guidance %.1f, %.1f GB free",
            settings["width"], settings["height"], steps, guidance,
            settings["vram_gb"],
        )
        try:
            result = pipe(
                prompt=prompt,
                negative_prompt="blurry, low quality, distorted, watermark, unreadable text",
                width=settings["width"],
                height=settings["height"],
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
        image = result.images[0]

        # A completely black frame is not a picture, and it is what the safety
        # checker substitutes when it flags something. At two steps the model
        # produces noise, noise reads as a false positive, and a request for a
        # snow leopard came back as a 509-byte black square reported as
        # success. Saying so beats saving it and calling it done.
        if _is_blank(image):
            raise RuntimeError(
                "The model returned a blank image. This is usually the safety "
                "filter misreading an under-developed result; raising "
                "LOCAL_IMAGE_STEPS, or rephrasing the prompt, normally fixes it."
            )

        if target:
            # Enlargement, not a render at that size. The card cannot draw 4K
            # and this does not pretend to - the note is logged so the size on
            # a label is never the only thing said about it.
            from app.image_plan import enlarge

            try:
                image, note = enlarge(image, target)
                logger.info("image: %s", note)
            except ValueError as exc:
                # An unknown size must not lose an image that already rendered.
                logger.warning("image: %s", exc)
        image.save(os.path.join(output_dir, filename), format="PNG")
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
    kept = r"(?:video|clip|screen|shot|film|reel|image|images|photo|photos|picture|pictures|wallpaper)"
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


# "QHD", "4K", "8K" asked for in the sentence. Same reasoning as the video
# options: a control nobody can find is not a choice, and the words have to
# come out of the prompt or the model is asked to draw the text "4K".
_TARGET_RE = re.compile(r"\b(hd|qhd|4\s*k|8\s*k|uhd)\b", re.IGNORECASE)


def read_image_options(prompt: str):
    """Pull the requested shape and output size out of a prompt.

    Returns (prompt without those words, aspect or None, target or None).
    None means the user did not say, and the machine's own choice is used.
    """
    text = prompt or ""
    target = None
    aspect = None

    found = _TARGET_RE.search(text)
    if found:
        word = re.sub(r"\s+", "", found.group(1)).upper()
        # UHD is 4K by every consumer definition; treating it as its own tier
        # would mean two names for one size.
        target = {"UHD": "4K"}.get(word, word)
        text = text[: found.start()] + " " + text[found.end():]

    for pattern, value in _ASPECT_WORDS:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            aspect = value
            text = text[: match.start()] + " " + text[match.end():]
            break

    text = re.sub(r"\s{2,}", " ", text).strip()
    text = re.sub(r"\b(?:ka|ki|of|in|wala|wali)\s*$", "", text, flags=re.IGNORECASE)
    return text.strip(" ,.-"), aspect, target
