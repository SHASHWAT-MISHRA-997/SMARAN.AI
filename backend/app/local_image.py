"""Free, on-device text-to-image generation using Diffusers."""
import logging
import os
import threading
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


def is_image_generation_request(prompt: str) -> bool:
    """Conservative natural-language intent detection for English/Hinglish/Hindi."""
    text = " ".join(prompt.lower().split())
    if text.startswith(("/image", "/txt2img")):
        return True
    commands = (
        "generate an image", "generate image", "create an image", "create image",
        "make an image", "draw a", "make a picture", "create a picture",
        "image generate", "image banao", "image bana", "photo banao", "picture banao",
        "tasveer banao", "tasvir banao", "????? ????", "?????? ????",
    )
    questions = ("how to", "kaise", "????")
    return any(command in text for command in commands) and not any(question in text for question in questions)


def clean_image_prompt(prompt: str) -> str:
    text = prompt.strip()
    if text.lower().startswith(("/image", "/txt2img")):
        return text.split(" ", 1)[1].strip() if " " in text else ""
    return text
