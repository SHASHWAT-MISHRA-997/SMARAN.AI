"""Talking to OmniRoute, and measuring what this app's own routes cost.

Two things live here, and they are different things.

**OmniRoute itself** is somebody else's project — github.com/diegosouzapw/OmniRoute,
MIT, 56,700 stars at the time of writing. It is a gateway you run: `npm i -g
omniroute` starts a server on localhost:20128 and exposes one OpenAI-compatible
endpoint at /v1 that fans out to, by its own README, 357 providers with 90+
free tiers and 19 routing strategies. None of that is implemented here and it
would be dishonest to imply otherwise. What is here is a client: if that
gateway is running on this machine, this finds it, lists what it offers, and
hands SMARAN.AI a base URL to send requests to.

**The latency table** is this app's own. Every cloud request SMARAN.AI makes
is timed, and those timings are reported here so a routing decision can be
made on evidence.

The version this replaced claimed to be OmniRoute and was neither. It
returned p50 420 ms, p95 1150 ms and uptime 99.98% on a machine with no
providers configured at all, and its metadata credited the OmniRoute team for
code they had never seen.
"""

from __future__ import annotations

import json
import logging
import statistics
import threading
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List

from app.plugin_system import ToolPlugin, PluginMetadata, PluginConfig, PluginType

logger = logging.getLogger("omni_route_plugin")

# Where OmniRoute serves once installed, from its own documentation.
GATEWAY = "http://127.0.0.1:20128"

# Rolling window per provider. Small on purpose: a router should follow how a
# provider behaves now, not average away a slowdown from a thousand requests
# ago.
WINDOW = 40

_lock = threading.Lock()
_samples: Dict[str, List[dict]] = {}


def record(provider: str, milliseconds: float, ok: bool) -> None:
    """Called by the chat path with a real timing. The only source of numbers."""
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

    ok = sorted(s["ms"] for s in series if s["ok"])
    stat = {
        "provider": provider,
        "samples": len(series),
        "measured": True,
        "success_rate": round(sum(1 for s in series if s["ok"]) / len(series), 3),
        "last_seen_seconds_ago": round(time.time() - series[-1]["at"], 1),
    }
    if ok:
        stat["p50_latency_ms"] = round(statistics.median(ok), 1)
        # A percentile needs enough points to mean anything.
        if len(ok) >= 20:
            stat["p95_latency_ms"] = round(ok[int(len(ok) * 0.95) - 1], 1)
        else:
            stat["slowest_ms"] = round(ok[-1], 1)
            stat["note"] = ("%d samples; a p95 needs at least 20, so the "
                            "slowest is given instead." % len(ok))
    else:
        stat["note"] = "Every timed request to this provider failed."
    return stat


def gateway_state() -> dict:
    """Is OmniRoute running here, and what does it offer?

    Asked of the gateway, not assumed. If it is not installed this says so
    and gives the one command that installs it.
    """
    try:
        with urllib.request.urlopen(GATEWAY + "/v1/models", timeout=3) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError):
        return {
            "running": False,
            "endpoint": GATEWAY + "/v1",
            "install": "npm i -g omniroute",
            "project": "https://github.com/diegosouzapw/OmniRoute",
            "note": (
                "OmniRoute is a separate project - an OpenAI-compatible "
                "gateway you run yourself. It is not bundled here and "
                "nothing of it is reimplemented here."
            ),
        }

    models = [m.get("id") for m in (payload.get("data") or []) if m.get("id")]
    return {
        "running": True,
        "endpoint": GATEWAY + "/v1",
        "models_offered": len(models),
        "sample_models": models[:12],
        "project": "https://github.com/diegosouzapw/OmniRoute",
        "note": (
            "Counted from the gateway's own /v1/models. SMARAN.AI can send "
            "requests here as it would to any OpenAI-compatible provider."
        ),
    }


def _configured() -> List[str]:
    """Providers this machine actually holds a key for, plus local ones."""
    import os

    providers: List[str] = []
    try:
        from app.main import _CLOUD_PROVIDER_ENV_VARS
        providers += [name for name, env in _CLOUD_PROVIDER_ENV_VARS.items()
                      if os.getenv(env, "").strip()]
    except Exception as exc:      # pragma: no cover
        logger.warning("could not read configured providers: %s", exc)

    try:
        from app.storage import ollama_binary
        if ollama_binary():
            try:
                urllib.request.urlopen("http://127.0.0.1:11434/api/tags", timeout=2)
                providers.append("ollama")
            except Exception:
                pass
    except Exception:
        pass

    if gateway_state().get("running"):
        providers.append("omniroute")
    return sorted(set(providers))


class OmniRoutePlugin(ToolPlugin):
    """A client for the OmniRoute gateway, plus this app's latency table."""

    async def initialize(self, app_context: Dict[str, Any]) -> bool:
        self._initialized = True
        return True

    async def shutdown(self) -> bool:
        self._initialized = False
        return True

    def get_tools(self) -> List[Dict]:
        return [
            {
                "name": "omniroute_gateway_status",
                "description": (
                    "Whether the OmniRoute gateway is running on this machine "
                    "and how many models it offers. Asks the gateway."
                ),
                "parameters": {"type": "object", "properties": {}},
            },
            {
                "name": "omniroute_get_metrics",
                "description": (
                    "Latency and success rate per provider, from requests "
                    "SMARAN.AI timed. Unused providers report no data."
                ),
                "parameters": {"type": "object", "properties": {}},
            },
            {
                "name": "omniroute_select_route",
                "description": (
                    "Choose a provider from measured latency, or say there is "
                    "no basis to choose yet."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "priority": {"type": "string",
                                     "enum": ["speed", "reliability", "privacy"]},
                    },
                },
            },
        ]

    async def execute_tool(self, tool_name: str, arguments: Dict) -> Any:
        if tool_name == "omniroute_gateway_status":
            return gateway_state()

        if tool_name == "omniroute_get_metrics":
            configured = _configured()
            return {
                "configured_providers": configured,
                "metrics": [_stats(p) for p in configured],
                "total_samples": sum(len(v) for v in _samples.values()),
                "note": ("Every figure is from a request SMARAN.AI timed. "
                         "A provider with no samples has not been used."),
            }

        if tool_name == "omniroute_select_route":
            priority = arguments.get("priority", "speed")
            configured = _configured()
            if not configured:
                return {"selected": None,
                        "reason": "Nothing is configured and nothing local is "
                                  "running, so there is nothing to route to."}

            if priority == "privacy":
                local = "ollama" if "ollama" in configured else None
                return {
                    "selected": local,
                    "measured": False,
                    "reason": ("Ollama runs on this machine, so nothing leaves it."
                               if local else
                               "Nothing local is available. Note that the "
                               "OmniRoute gateway is local but forwards to "
                               "remote providers, so it is not private."),
                }

            usable = [s for s in (_stats(p) for p in configured)
                      if s.get("measured") and s.get("p50_latency_ms")]
            if not usable:
                return {
                    "selected": None, "candidates": configured, "measured": False,
                    "reason": ("Nothing has been timed yet, so there is no "
                               "basis to choose. Ask something first."),
                }

            if priority == "reliability":
                best = max(usable, key=lambda s: (s["success_rate"], -s["p50_latency_ms"]))
                basis = "highest success rate over %d samples" % best["samples"]
            else:
                best = min(usable, key=lambda s: s["p50_latency_ms"])
                basis = ("lowest median latency (%.0f ms over %d samples)"
                         % (best["p50_latency_ms"], best["samples"]))

            return {"selected": best["provider"], "measured": True,
                    "reason": basis, "evidence": best,
                    "also_considered": [s["provider"] for s in usable
                                        if s["provider"] != best["provider"]]}

        raise ValueError("Unknown OmniRoute tool: %s" % tool_name)


metadata = PluginMetadata(
    name="provider-latency",
    version="3.1.0",
    description=(
        "Measures how fast each provider actually answers, and picks between "
        "them on that. Also talks to an OmniRoute gateway if you run one."
    ),
    # Written for SMARAN.AI. OmniRoute is a separate MIT project by Diego
    # Souza; this talks to it and does not reimplement or vendor it. The
    # earlier metadata named its team as the author of this file, which was
    # not true.
    author="SMARAN.AI",
    plugin_type=PluginType.TOOL,
    entry_point="omni_route:OmniRoutePlugin",
    dependencies=[],
    config_schema={},
    tags=["routing", "latency", "gateway", "measured"],
    homepage="https://omniroute.online",
    repository="https://github.com/diegosouzapw/OmniRoute",
    license="MIT",
)
