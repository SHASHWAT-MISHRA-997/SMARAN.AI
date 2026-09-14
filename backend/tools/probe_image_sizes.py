"""What image sizes this card can actually produce, measured rather than assumed.

The image path was capped at 512 and defaulted to 384, which is the softness
being complained about. The cap was a guess; this replaces it with a
measurement. Prints a row per size: whether it fit, how long it took, and the
peak VRAM it needed.
"""

import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
sys.path.insert(0, BACKEND)
sys.path.insert(0, os.path.join(os.path.dirname(BACKEND), "data", "video-packages"))

import torch  # noqa: E402
from diffusers import StableDiffusionPipeline  # noqa: E402

MODEL = os.environ.get("PROBE_MODEL", "stable-diffusion-v1-5/stable-diffusion-v1-5")
SIZES = [512, 640, 768, 896, 1024]
STEPS = int(os.environ.get("PROBE_STEPS", "20"))

print("model:", MODEL, "steps:", STEPS, flush=True)
pipe = StableDiffusionPipeline.from_pretrained(
    MODEL, torch_dtype=torch.float16, safety_checker=None, requires_safety_checker=False,
)
pipe.enable_model_cpu_offload()
pipe.enable_attention_slicing()
# In this diffusers version slicing lives on the VAE, not the pipeline.
for owner, name in ((pipe, "enable_vae_slicing"), (pipe.vae, "enable_slicing"),
                    (pipe.vae, "enable_tiling")):
    fn = getattr(owner, name, None)
    if callable(fn):
        fn()
pipe.set_progress_bar_config(disable=True)

out_dir = os.path.join(os.path.dirname(BACKEND), "data", "preview")
os.makedirs(out_dir, exist_ok=True)

for size in SIZES:
    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats()
    started = time.time()
    try:
        image = pipe(
            prompt=("a snow leopard on a rocky ledge at golden hour, dense fur "
                    "detail, sharp eyes, photographic, highly detailed"),
            negative_prompt="blurry, low quality, distorted, watermark",
            width=size, height=size, num_inference_steps=STEPS, guidance_scale=7.5,
            generator=torch.Generator(device="cpu").manual_seed(11),
        ).images[0]
        took = time.time() - started
        peak = torch.cuda.max_memory_allocated() / 1e9
        path = os.path.join(out_dir, "probe_%d.png" % size)
        image.save(path)
        print("%4d  OK   %5.1fs  peak %.2f GB  %d bytes"
              % (size, took, peak, os.path.getsize(path)), flush=True)
    except torch.cuda.OutOfMemoryError:
        print("%4d  OOM  after %.1fs" % (size, time.time() - started), flush=True)
        torch.cuda.empty_cache()
    except Exception as exc:  # noqa: BLE001
        print("%4d  FAIL %s: %s" % (size, type(exc).__name__, str(exc)[:110]), flush=True)
        torch.cuda.empty_cache()
