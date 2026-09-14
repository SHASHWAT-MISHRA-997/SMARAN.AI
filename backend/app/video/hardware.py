"""What this machine can actually run, measured rather than assumed.

Every field here is read from the driver or from torch. Nothing is inferred
from the GPU's marketing name: two cards sold under one name can ship
different memory, and the amount free right now matters more than the amount
installed.
"""

from __future__ import annotations

import logging
import shutil
from dataclasses import dataclass, asdict
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class Hardware:
    has_cuda: bool
    gpu_name: str
    vram_total_gb: float
    vram_free_gb: float
    compute_capability: Optional[tuple]
    supports_bfloat16: bool
    torch_version: str
    torch_is_cuda_build: bool
    disk_free_gb: float
    reason: str = ""
    # The processor and system memory, which nothing used to look at.
    #
    # That was not a cosmetic gap. The text encoder needs about 9.5 GB of
    # system RAM at bfloat16, and on a 16 GB machine with a browser open it
    # killed the process with a segmentation fault - no exception, no log line.
    # Every decision was made from VRAM alone, so the one resource that
    # actually ran out was the one nothing measured.
    #
    # Defaulted so that a Hardware built positionally by older code, or by a
    # test, still constructs.
    cpu_cores: int = 0
    cpu_threads: int = 0
    cpu_name: str = ""
    ram_total_gb: float = 0.0
    ram_free_gb: float = 0.0

    def as_dict(self) -> dict:
        d = asdict(self)
        d["compute_capability"] = (
            "%d.%d" % self.compute_capability if self.compute_capability else None
        )
        return d


def _cpu_and_ram() -> dict:
    """Processor and system memory. Zeroes rather than an exception if unknown."""
    found = {"cpu_cores": 0, "cpu_threads": 0, "cpu_name": "",
             "ram_total_gb": 0.0, "ram_free_gb": 0.0}
    try:
        import os as _os

        found["cpu_threads"] = _os.cpu_count() or 0
    except Exception:  # noqa: BLE001
        logger.debug("could not read the cpu count", exc_info=True)

    try:
        import psutil

        found["cpu_cores"] = psutil.cpu_count(logical=False) or found["cpu_threads"]
        memory = psutil.virtual_memory()
        found["ram_total_gb"] = round(memory.total / 1024 ** 3, 1)
        # available, not free: cache that the system will hand back on demand
        # is usable, and "free" understates it enough to refuse work that fits.
        found["ram_free_gb"] = round(memory.available / 1024 ** 3, 1)
    except Exception:  # noqa: BLE001
        logger.debug("psutil is unavailable, so RAM is unknown", exc_info=True)

    try:
        import platform

        found["cpu_name"] = platform.processor() or platform.machine() or ""
    except Exception:  # noqa: BLE001
        logger.debug("could not read the cpu name", exc_info=True)
    return found


def probe(model_dir: str = ".") -> Hardware:
    """Look at the machine. Never raises: an unknown answer is still an answer."""
    try:
        free_bytes = shutil.disk_usage(model_dir).free
    except OSError:
        free_bytes = 0
    disk_free = round(free_bytes / 1024 ** 3, 1)
    system = _cpu_and_ram()

    try:
        import torch
    except ImportError:
        return Hardware(
            has_cuda=False, gpu_name="", vram_total_gb=0.0, vram_free_gb=0.0,
            compute_capability=None, supports_bfloat16=False,
            torch_version="", torch_is_cuda_build=False, disk_free_gb=disk_free, **system,
            reason=(
                "The video packages are not installed yet. They are about 3 GB "
                "and are fetched on request rather than shipped to everyone, "
                "since most installs never generate a video."
            ),
        )

    version = getattr(torch, "__version__", "")
    # A '+cpu' build cannot see the card no matter what is plugged in, and this
    # is worth reporting separately: 'no GPU' sends someone to buy hardware
    # they already own, when the fix is one reinstall.
    is_cuda_build = "+cpu" not in version

    if not torch.cuda.is_available():
        return Hardware(
            has_cuda=False, gpu_name="", vram_total_gb=0.0, vram_free_gb=0.0,
            compute_capability=None, supports_bfloat16=False,
            torch_version=version, torch_is_cuda_build=is_cuda_build,
            disk_free_gb=disk_free, **system,
            reason=(
                "PyTorch is installed without CUDA support, so the graphics card "
                "cannot be used. Reinstall the CUDA build to enable it."
                if not is_cuda_build else
                "No CUDA device is visible. The driver may be missing or the card "
                "may be disabled."
            ),
        )

    index = torch.cuda.current_device()
    props = torch.cuda.get_device_properties(index)
    cap = torch.cuda.get_device_capability(index)

    # Free memory, not total. Something else holding 2 GB changes what fits,
    # and a plan built on the total would be a plan that runs out.
    try:
        free_b, total_b = torch.cuda.mem_get_info(index)
    except Exception:
        free_b, total_b = 0, props.total_memory

    # is_bf16_supported() counts emulation by default and so answers True on
    # Turing, which has no bfloat16 in hardware — this card reports 7.5 and
    # returns True for the plain call and False for the native one. Taking the
    # default would pick an emulated path that is markedly slower than float16
    # while looking like the better choice.
    try:
        bf16 = bool(torch.cuda.is_bf16_supported(including_emulation=False))
    except TypeError:
        # Older builds have no flag; fall back to the capability that
        # introduced bfloat16 in silicon.
        bf16 = cap >= (8, 0)
    except Exception:
        bf16 = False

    return Hardware(
        has_cuda=True,
        gpu_name=props.name,
        vram_total_gb=round(total_b / 1024 ** 3, 1),
        vram_free_gb=round(free_b / 1024 ** 3, 1),
        compute_capability=cap,
        supports_bfloat16=bf16,
        torch_version=version,
        torch_is_cuda_build=True,
        disk_free_gb=disk_free, **system,
    )
