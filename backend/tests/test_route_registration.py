"""Routes have to be reachable, and two of them were not.

`main.py` is edited by several hands and has grown past two thousand lines of
route declarations. Two failure modes have both already happened in it, and
neither one raises anything at import time:

1. **Duplicate registration.** `POST /api/memory` was declared twice. Starlette
   serves the first match and never reaches the second, so the stricter of the
   two handlers was dead while its own unit tests passed against the function
   object. Green tests, unreachable code.

2. **Shadowing by a path parameter.** `DELETE /api/memory/{memory_id}` is
   declared before `DELETE /api/memory/clear`, so "clear" is matched as a
   `memory_id`, fails `int` conversion, and returns 422. The clear-all button
   could never have worked.

These check the routing table itself rather than any one handler, because the
bug is in the arrangement and is invisible from inside a handler.
"""

import sys
from pathlib import Path

import pytest
from starlette.routing import Route

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.main import app  # noqa: E402


def _api_routes():
    for route in app.routes:
        if isinstance(route, Route) and route.path.startswith("/api/"):
            for method in route.methods or ():
                if method not in ("HEAD", "OPTIONS"):
                    yield method, route.path


def test_no_api_route_is_registered_twice():
    seen, duplicated = set(), []
    for pair in _api_routes():
        (duplicated.append(pair) if pair in seen else seen.add(pair))
    assert duplicated == [], (
        "these are declared more than once; only the first is reachable: "
        + ", ".join(f"{m} {p}" for m, p in duplicated)
    )


def test_no_literal_route_is_shadowed_by_an_earlier_parameter_route():
    """A literal segment declared after `{param}` on the same prefix is dead."""
    ordered = list(_api_routes())
    shadowed = []
    for index, (method, path) in enumerate(ordered):
        if "{" in path:
            continue
        prefix, _, last = path.rpartition("/")
        for earlier_method, earlier_path in ordered[:index]:
            if earlier_method != method:
                continue
            e_prefix, _, e_last = earlier_path.rpartition("/")
            if e_prefix == prefix and e_last.startswith("{") and e_last.endswith("}"):
                shadowed.append((method, path, earlier_path))
    assert shadowed == [], (
        "these can never be reached, the earlier parameter route swallows them: "
        + ", ".join(f"{m} {p} (shadowed by {e})" for m, p, e in shadowed)
    )


@pytest.mark.parametrize("path", ["/api/memory", "/api/memory/clear"])
def test_the_memory_endpoints_the_settings_panel_calls_are_present(path):
    paths = {p for _, p in _api_routes()}
    assert path in paths
