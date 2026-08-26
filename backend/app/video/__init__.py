"""Video generation: hardware probing, a verified model registry and a planner."""

# Packages fetched on demand live outside the bundle, so the path has to be
# extended before anything tries to import torch.
try:
    from .install import ensure_on_path
    ensure_on_path()
except Exception:  # pragma: no cover
    pass
