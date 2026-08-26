"""Image models, with the terms and the real download beside each.

Same rule as the video registry: a figure nobody published is None rather than
a guess, and the weights licence is recorded separately from the repository's,
because they are frequently not the same thing.

The download figures are the fp16 variant a pipeline actually fetches, not the
repository total. SDXL's repository is 50 GB and holds fp32, fp16 and .bin
copies of everything; loading in fp16 touches 7.1 GB of it. Quoting the
repository would rule out a model that fits.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import List, Optional

VERIFIED_ON = "2026-08-26"


@dataclass(frozen=True)
class ImageModel:
    id: str
    display_name: str
    hf_repo: str
    pipeline: str
    capabilities: List[str]
    min_vram_gb: Optional[float]
    vram_source: str
    weights_license: str
    download_gb: Optional[float]
    default_size: int
    verified_on: str
    source_url: str
    notes: str = ""

    def as_dict(self) -> dict:
        return asdict(self)


MODELS: List[ImageModel] = [
    ImageModel(
        id="sd15",
        display_name="Stable Diffusion 1.5",
        hf_repo="stable-diffusion-v1-5/stable-diffusion-v1-5",
        pipeline="StableDiffusionPipeline",
        capabilities=["text-to-image", "image-to-image"],
        # Measured from the fp16 weights rather than taken from a blog: 2.7 GB
        # of weights leaves room on a 6 GB card without offloading, which is
        # what makes this the one that answers quickly.
        min_vram_gb=3.5,
        vram_source=(
            "Derived from the fp16 weights (2.7 GB) plus headroom for "
            "activations. Not a figure published by the authors."
        ),
        weights_license="creativeml-openrail-m",
        download_gb=2.7,
        default_size=512,
        verified_on=VERIFIED_ON,
        source_url="https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5",
        notes="Fast and small. Lower detail than SDXL, and native at 512.",
    ),
    ImageModel(
        id="sdxl",
        display_name="Stable Diffusion XL",
        hf_repo="stabilityai/stable-diffusion-xl-base-1.0",
        pipeline="StableDiffusionXLPipeline",
        capabilities=["text-to-image", "image-to-image"],
        min_vram_gb=5.0,
        vram_source=(
            "Derived from the fp16 weights (7.1 GB). Above 6 GB it is resident; "
            "below, layers are offloaded, which works and is slower."
        ),
        weights_license="openrail++",
        download_gb=7.1,
        default_size=1024,
        verified_on=VERIFIED_ON,
        source_url="https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0",
        notes=(
            "Native at 1024 and markedly more detailed. On a 6 GB card it runs "
            "with layers offloaded, so it is the slower of the two."
        ),
    ),
]


def by_id(model_id: str) -> Optional[ImageModel]:
    return next((m for m in MODELS if m.id == model_id), None)
