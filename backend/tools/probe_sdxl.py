"""Can this card actually run SDXL, and at what cost?

The ladder refuses SDXL below 9.5 GB of free VRAM, and that number was an
estimate rather than a measurement. It decides whether a 7 GB download is
usable or dead weight, so it is worth replacing with a real figure.

Times each size with sequential offload, which is the only way a small card
runs a model this size at all, and records peak VRAM so the threshold can be
set from evidence.
"""

import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
sys.path.insert(0, BACKEND)
sys.path.insert(0, os.path.join(os.path.dirname(BACKEND), "data", "video-packages"))

import torch  # noqa: E402
from diffusers import StableDiffusionXLPipeline  # noqa: E402

MODEL = "stabilityai/stable-diffusion-xl-base-1.0"
SIZES = [int(s) for s in os.environ.get("SDXL_SIZES", "768,1024").split(",")]
STEPS = int(os.environ.get("SDXL_STEPS", "25"))

free, total = torch.cuda.mem_get_info()
print("card: %s, %.1f GB free of %.1f GB"
      % (torch.cuda.get_device_name(0), free / 1024 ** 3, total / 1024 ** 3), flush=True)

started = time.time()
pipe = StableDiffusionXLPipeline.from_pretrained(
    MODEL, torch_dtype=torch.float16, variant="fp16", use_safetensors=True,
)
print("loaded in %.0fs" % (time.time() - started), flush=True)

# The only thing that lets a 6 GB card hold a model this size: layers are
# streamed onto the card as they run rather than all living there.
pipe.enable_sequential_cpu_offload()
pipe.enable_attention_slicing()
for owner, name in ((pipe.vae, "enable_slicing"), (pipe.vae, "enable_tiling")):
    fn = getattr(owner, name, None)
    if callable(fn):
        fn()
pipe.set_progress_bar_config(disable=True)

out_dir = os.path.join(os.path.dirname(BACKEND), "data", "preview")
os.makedirs(out_dir, exist_ok=True)

for size in SIZES:
    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats()
    began = time.time()
    try:
        image = pipe(
            prompt=("a snow leopard on a rocky ledge at golden hour, dense fur "
                    "detail, sharp eyes, photographic, highly detailed"),
            negative_prompt="blurry, low quality, distorted, watermark",
            width=size, height=size, num_inference_steps=STEPS,
            guidance_scale=7.0,
            generator=torch.Generator(device="cpu").manual_seed(11),
        ).images[0]
        took = time.time() - began
        peak = torch.cuda.max_memory_allocated() / 1e9
        path = os.path.join(out_dir, "sdxl_%d.png" % size)
        image.save(path)
        print("%4d  OK   %6.1fs  peak %.2f GB  %d bytes"
              % (size, took, peak, os.path.getsize(path)), flush=True)
    except torch.cuda.OutOfMemoryError:
        print("%4d  OOM  after %.1fs" % (size, time.time() - began), flush=True)
        torch.cuda.empty_cache()
    except Exception as exc:  # noqa: BLE001
        print("%4d  FAIL %s: %s" % (size, type(exc).__name__, str(exc)[:120]), flush=True)
        torch.cuda.empty_cache()
