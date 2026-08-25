"""Which video models exist, and what their own publishers say they need.

Every number here was read from the project's own repository or model card,
with the date and the URL recorded beside it. A figure nobody published is
None, not a guess: a made-up VRAM requirement produces either a job that
crashes out of memory or a capability hidden from someone whose machine could
have run it.

Licences are stored twice on purpose. LTX-Video ships an Apache-2.0 LICENSE
file while publishing its weights under custom terms, so a single field would
have to be wrong about one of them.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Optional, List


@dataclass(frozen=True)
class VideoModel:
    id: str
    display_name: str
    hf_repo: str
    pipeline: str                     # the diffusers class that loads it
    capabilities: List[str]           # text-to-video, image-to-video, ...
    min_vram_gb: Optional[float]      # as stated by the publisher, else None
    vram_source: str
    code_license: str
    weights_license: str
    max_seconds_claimed: Optional[float]
    download_gb: Optional[float]
    verified_on: str
    source_url: str
    notes: str = ""

    def as_dict(self) -> dict:
        return asdict(self)


VERIFIED_ON = "2026-08-26"

MODELS: List[VideoModel] = [
    VideoModel(
        id="ltx-video",
        display_name="LTX-Video",
        # The model card's own examples name Lightricks/LTX-Video-0.9.8-dev.
        # That repository does not exist on the Hub - loading it returns
        # "Repository Not Found" - so the id here is the published one the
        # card belongs to, confirmed against the Hub's model listing.
        hf_repo="Lightricks/LTX-Video",
        pipeline="LTXConditionPipeline",
        capabilities=["text-to-video", "image-to-video", "video-to-video", "keyframes"],
        min_vram_gb=1.0,
        vram_source=(
            "Repository README, on the 13B distilled LoRA: 'Requires only 1GB "
            "of VRAM'. The figure is the publisher's and has not been measured "
            "here."
        ),
        code_license="Apache-2.0",
        weights_license="other (custom terms — read before commercial use)",
        max_seconds_claimed=60.0,
        # Summed from the Hub's file listing for the components model_index.json
        # actually references: text encoder 19.05, transformer 7.69, VAE 1.68.
        # There is no fp16 variant to fall back to - one set of weights is all
        # that is published.
        download_gb=28.4,
        verified_on=VERIFIED_ON,
        source_url="https://github.com/Lightricks/LTX-Video",
        notes=(
            "The v0.9.8 release notes advertise distilled models with 'up to 60 "
            "seconds of video', the longest single-generation figure any of "
            "these projects states."
        ),
    ),
    VideoModel(
        id="hunyuan-video",
        display_name="HunyuanVideo",
        hf_repo="tencent/HunyuanVideo",
        pipeline="HunyuanVideoPipeline",
        capabilities=["text-to-video"],
        min_vram_gb=45.0,
        vram_source=(
            "Repository README: 'The minimum GPU memory required is 60GB for "
            "720px1280px129f and 45G for 544px960px129f', recommending 80GB."
        ),
        code_license="unverified",
        weights_license="other",
        max_seconds_claimed=5.4,
        download_gb=None,
        verified_on=VERIFIED_ON,
        source_url="https://github.com/Tencent-Hunyuan/HunyuanVideo",
        notes=(
            "The memory table is quoted for 129 frames, about 5.4 seconds at 24 "
            "fps, on an 80GB card. Listed so a capable machine can use it and a "
            "small one is told plainly why it cannot."
        ),
    ),
    VideoModel(
        id="cogvideox-2b",
        display_name="CogVideoX 2B",
        hf_repo="THUDM/CogVideoX-2b",
        pipeline="CogVideoXPipeline",
        capabilities=["text-to-video"],
        min_vram_gb=None,
        vram_source="Not stated in the repository README. Unverified.",
        code_license="Apache-2.0",
        weights_license="apache-2.0",
        max_seconds_claimed=None,
        download_gb=None,
        verified_on=VERIFIED_ON,
        source_url="https://github.com/THUDM/CogVideo",
        notes=(
            "The only one of these whose weights carry a plainly permissive "
            "licence. Its memory requirement is unknown, so it is offered only "
            "after a check, never assumed to fit."
        ),
    ),
]


def by_id(model_id: str) -> Optional[VideoModel]:
    return next((m for m in MODELS if m.id == model_id), None)


def supporting(capability: str) -> List[VideoModel]:
    return [m for m in MODELS if capability in m.capabilities]
