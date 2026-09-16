"""Explicit hardware for regressions about the owner's measured 6 GB limits."""
import pytest


@pytest.fixture
def measured_rtx2060(monkeypatch):
    """Do not turn RTX 2060 assertions into CPU assertions in a sandbox or CI.

    Four duration tests failed when the hardware probe could not see CUDA.
    Keep their memory boundary explicit and avoid the user's timing cache.
    """
    from app.video import calibration
    from app.video.hardware import Hardware

    monkeypatch.setattr(calibration, "units_per_sec", lambda *args, **kwargs: None)
    return Hardware(
        has_cuda=True, gpu_name="NVIDIA GeForce RTX 2060",
        vram_total_gb=6.0, vram_free_gb=5.5,
        compute_capability=(7, 5), supports_bfloat16=False,
        torch_version="fixture", torch_is_cuda_build=True,
        disk_free_gb=100.0, ram_total_gb=16.0, ram_free_gb=8.0,
    )
