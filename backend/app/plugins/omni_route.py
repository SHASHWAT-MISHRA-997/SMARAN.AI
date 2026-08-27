"""Routing between providers, on measured latency.

This plugin used to be a lookup table wearing the clothes of a router. It
returned p50 420 ms, p95 1150 ms, uptime 99.98% and every circuit breaker
HEALTHY — none of which was measured. `select_route` took the first entry of
a hardcoded dictionary and stamped `confidence_score: 0.98` on it. Nothing
was timed, no provider was contacted, and the numbers were the same on a
machine with no keys at all.

It now measures. A route is chosen from latencies this app actually recorded
against providers this machine actually has keys for, and when there is no
measurement yet it says so rather than inventing one. Every number below
came from a request that really happened.
"""

from __future__ import annotations

import logging
import statistics
import threading
import time
from typing import Any, Dict, List, Optional

from app.plugin_system import ToolPlugin, PluginMetadata, PluginConfig, PluginType

logger = logging.getLogger("omni_route_plugin")

# Rolling window per provider. Kept small: a router should follow how a
# provider is behaving now, not average away a slowdown that started a
# thousand requests ago.
WINDOW = 40

_lock = threading.Lock()
_samples: Dict[str, List[dict]] = {}


def record(provider: str, milliseconds: float, ok: bool) -> None:
    """Called by whatever made a real request. The only source of numbers here."""
    if not provider:
        return
    with _lock:
        series = _samples.setdefault(provider, [])
        series.append({"ms": float(milliseconds), "ok": bool(ok), "at": time.time()})
        del series[:-WINDOW]


def _stats(provider: str) -> dict:
    with _lock:
        series = list(_samples.get(provider, []))
    if not series:
        return {"provider": provider, "samples": 0, "measured": False,
                "note": "No request has been timed for this provider yet."}

    ok = [s["ms"] for s in series if s["ok"]]
    successes = sum(1 for s in series if s["ok"])
    stat = {
        "provider": provider,
        "samples": len(series),
        "measured": True,
        "success_rate": round(successes / len(series), 3),
        "last_seen_seconds_ago": round(time.time() - series[-1]["at"], 1),
    }
    if ok:
        ordered = sorted(ok)
        stat["p50_latency_ms"] = round(statistics.median(ordered), 1)
        # A percentile needs enough points to mean anything. Below twenty,
        # the slowest sample is reported as the slowest sample.
        if len(ordered) >= 20:
            stat["p95_latency_ms"] = round(ordered[int(len(ordered) * 0.95) - 1], 1)
        else:
            stat["slowest_ms"] = round(ordered[-1], 1)
            stat["note"] = ("%d samples; a p95 needs at least 20, so the "
                            "slowest is given instead." % len(ordered))
    else:
        stat["note"] = "Every timed request to this provider failed."
    return stat


def _configured() -> List[str]:
    """Providers this machine actually holds a key for, plus local ones."""
    import os

    providers: List[str] = []
    try:
        from app.main import _CLOUD_PROVIDER_ENV_VARS
        for name, env in _CLOUD_PROVIDER_ENV_VARS.items():
            if os.getenv(env, "").strip():
                providers.append(name)
    except Exception as exc:      # pragma: no cover
        logger.warning("could not read configured providers: %s", exc)

    try:
        from app.storage import ollama_binary
        import urllib.request
        if ollama_binary():
            try:
                urllib.request.urlopen("http://127.0.0.1:11434/api/tags", timeout=2)
                providers.append("ollama")
            except Exception:
                pass
    except Exception:
        pass
    return sorted(set(providers))


class OmniRoutePlugin(ToolPlugin):
    """Chooses a provider from measured latency, or says it cannot yet."""

    async def initialize(self, app_context: Dict[str, Any]) -> bool:
        self._initialized = True
        return True

    async def shutdown(self) -> bool:
        self._initialized = False
        return True

    def get_tools(self) -> List[Dict]:
        return [
            {
                "name": "omniroute_select_route",
                "description": (
                    "Choose a provider using latency measured by this app. "
                    "Returns the evidence, and says so when there is none."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "priority": {
                            "type": "string",
                            "enum": ["speed", "reliability", "privacy"],
                            "description": "What to optimise for.",
                        }
                    },
                },
            },
            {
                "name": "omniroute_get_metrics",
                "description": (
                    "Latency and success rate per provider, from timed "
                    "requests only. Providers never used report no data."
                ),
                "parameters": {"type": "object", "properties": {}},
            },
        ]

    async def execute_tool(self, tool_name: str, arguments: Dict) -> Any:
        if tool_name == "omniroute_get_metrics":
            configured = _configured()
            return {
                "configured_providers": configured,
                "metrics": [_stats(p) for p in configured],
                "total_samples": sum(len(v) for v in _samples.values()),
                "note": (
                    "Every figure comes from a request this app timed. A "
                    "provider with no samples has not been used yet."
                ),
            }

        if tool_name == "omniroute_select_route":
            priority = arguments.get("priority", "speed")
            configured = _configured()
            if not configured:
                return {
                    "selected": None,
                    "reason": "No provider is configured and Ollama is not "
                              "running, so there is nothing to route to.",
                }

            # Privacy is not a measurement: local is local whatever the
            # latency, so it is answered without pretending to time it.
            if priority == "privacy":
                local = "ollama" if "ollama" in configured else None
                return {
                    "selected": local,
                    "reason": ("Ollama runs on this machine, so nothing leaves it."
                               if local else
                               "Nothing local is available; every configured "
                               "provider is a network service."),
                    "measured": False,
                }

            stats = [_stats(p) for p in configured]
            usable = [s for s in stats if s.get("measured") and s.get("p50_latency_ms")]
            if not usable:
                return {
                    "selected": None,
                    "candidates": configured,
                    "measured": False,
                    "reason": (
                        "Nothing has been timed yet, so there is no basis to "
                        "choose. Ask something first and the measurements "
                        "will exist."
                    ),
                }

            if priority == "reliability":
                best = max(usable, key=lambda s: (s["success_rate"], -s["p50_latency_ms"]))
                basis = "highest success rate over %d samples" % best["samples"]
            else:
                best = min(usable, key=lambda s: s["p50_latency_ms"])
                basis = "lowest median latency (%.0f ms over %d samples)" % (
                    best["p50_latency_ms"], best["samples"])

            return {
                "selected": best["provider"],
                "measured": True,
                "reason": basis,
                "evidence": best,
                "also_considered": [s["provider"] for s in usable
                                    if s["provider"] != best["provider"]],
            }

        raise ValueError("Unknown OmniRoute tool: %s" % tool_name)


metadata = PluginMetadata(
    name="omni-route",
    version="3.0.0",
    description=(
        "Routes between the providers this machine has, using latency this "
        "app measured. Reports no data rather than inventing it."
    ),
    # Written for SMARAN.AI. The earlier version credited "OmniRoute Team"
    # and linked their repository, which implied a relationship that does
    # not exist - none of this is their code.
    author="SMARAN.AI",
    plugin_type=PluginType.TOOL,
    entry_point="omni_route:OmniRoutePlugin",
    dependencies=[],
    config_schema={},
    tags=["routing", "latency", "measured"],
    license="MIT",
)
