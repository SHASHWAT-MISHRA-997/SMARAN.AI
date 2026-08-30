"""HTTP surface for MCP servers.

The distinction that matters throughout: saving a server is not connecting to
it, and connecting is not the same as it working. Each endpoint says which of
those it did.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .client import MCPError
from .manager import manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/mcp", tags=["mcp"])


class AddServer(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    # Either an http(s) address or a command to run. Both are how servers are
    # published, so both are accepted and the transport is chosen from it.
    target: str = Field(..., min_length=1, max_length=1000)
    env: Optional[Dict[str, str]] = None
    headers: Optional[Dict[str, str]] = None


class CallTool(BaseModel):
    server: str
    tool: str
    arguments: Optional[Dict[str, Any]] = None


# Servers that genuinely exist and genuinely start. Every target here is a
# published package; adding one and probing it runs that package and reads
# the tools it really offers, rather than showing a name with a tool list
# written beside it. Where a server needs a key to do anything, that is said
# here rather than discovered after it fails.
#
# Deliberately short. A long catalogue of names that do not start would be
# the same mistake as the ten "connected" servers this replaced.
CATALOGUE = [
    {
        "name": "filesystem",
        "title": "Filesystem",
        "description": "Read, write and search files in a directory you name.",
        "target": "npx -y @modelcontextprotocol/server-filesystem .",
        "publisher": "Model Context Protocol",
        "needs": None,
        "verified": "Started here: secure-filesystem-server 0.2.0, 14 tools.",
    },
    {
        "name": "memory",
        "title": "Memory graph",
        "description": "A knowledge graph the model can add to and search across sessions.",
        "target": "npx -y @modelcontextprotocol/server-memory",
        "publisher": "Model Context Protocol",
        "needs": None,
        "verified": "Started here: memory-server 0.6.3, 9 tools.",
    },
    {
        "name": "sequential-thinking",
        "title": "Sequential thinking",
        "description": "Lets the model work a problem in explicit numbered steps.",
        "target": "npx -y @modelcontextprotocol/server-sequential-thinking",
        "publisher": "Model Context Protocol",
        "needs": None,
        "verified": None,
    },
    {
        "name": "git",
        "title": "Git",
        "description": "Read a local repository: log, diff, branches, file history.",
        "target": "uvx mcp-server-git",
        "publisher": "Model Context Protocol",
        "needs": "uv installed (pip install uv)",
        "verified": None,
    },
    {
        "name": "fetch",
        "title": "Fetch",
        "description": "Fetch a URL and hand back its content as text.",
        "target": "uvx mcp-server-fetch",
        "publisher": "Model Context Protocol",
        "needs": "uv installed (pip install uv)",
        "verified": None,
    },
    {
        # Voicebox ships two MCP surfaces. Its HTTP one at :17493/mcp speaks
        # StreamableHTTP, which answers in server-sent events - the client
        # here reads JSON and rejected it with "reply was not JSON". The
        # binary beside it speaks plain stdio, which the client does handle,
        # so that is what is offered. Nothing is downloaded for this one; it
        # comes with Voicebox.
        "name": "voicebox",
        "title": "Voicebox",
        "description": "Speak in a cloned voice and transcribe audio, through "
                       "Voicebox's own MCP server.",
        "target": "%LOCALAPPDATA%\\Programs\\Voicebox\\voicebox-mcp.exe",
        "publisher": "jamiepine/voicebox (MIT)",
        "needs": "Voicebox installed from voicebox.sh",
        "verified": "Connected here: voicebox 3.2.4, 4 tools.",
    },
]


@router.get("/catalogue")
async def catalogue():
    """Servers worth adding, and whether each is already configured."""
    configured = manager.load()
    return {
        "servers": [{**entry, "already_added": entry["name"] in configured}
                    for entry in CATALOGUE],
        "note": (
            "Adding one saves it; probing it actually runs the package and "
            "reads the tools it offers. Nothing here is bundled - each is "
            "downloaded by npx or uvx on first use, so the first probe is "
            "slow and needs a network."
        ),
    }


@router.get("/servers")
async def list_servers():
    """Configured servers and what is known about each, without starting any."""
    servers = manager.load()
    return {
        "servers": [await manager.status(name) for name in servers],
        "note": (
            "A saved server is not a connected one. Use /api/mcp/servers/"
            "{name}/probe to actually start it and read its tools."
        ),
    }


@router.post("/servers")
async def add_server(req: AddServer):
    """Save a server. This does not connect to it."""
    name = req.name.strip()
    if name in manager.load():
        raise HTTPException(status_code=409, detail="A server named %r already exists." % name)

    record = manager.add(name, req.target.strip(), req.env, req.headers)
    return {
        "saved": True,
        "server": record,
        "detail": "Saved. Probe it to check that it actually starts.",
    }


@router.post("/servers/{name}/probe")
async def probe_server(name: str):
    """Start the server, complete the handshake and report what it offers."""
    status = await manager.status(name, probe=True)
    if status.get("state") == "unknown":
        raise HTTPException(status_code=404, detail="No server named %r." % name)
    return status


class SetEnabled(BaseModel):
    enabled: bool


@router.post("/servers/{name}/enabled")
async def set_enabled(name: str, req: SetEnabled):
    """Turn a server on or off without forgetting how to reach it.

    Switching one off also drops its running process, so the toggle means
    what it says rather than only hiding the row.
    """
    servers = manager.load()
    record = servers.get(name)
    if record is None:
        raise HTTPException(status_code=404, detail="No server named %r." % name)

    record["enabled"] = bool(req.enabled)
    manager.save(servers)
    if not req.enabled:
        await manager.disconnect(name)

    return {
        "name": name,
        "enabled": record["enabled"],
        "detail": ("Enabled. Probe it to start it."
                   if req.enabled else "Disabled and its process stopped."),
    }


@router.delete("/servers/{name}")
async def remove_server(name: str):
    if not await manager.remove(name):
        raise HTTPException(status_code=404, detail="No server named %r." % name)
    return {"removed": True, "name": name}


@router.get("/tools")
async def list_tools():
    """Tools from servers that are currently connected."""
    tools = await manager.all_tools()
    return {
        "tools": tools,
        "count": len(tools),
        "note": "Only connected servers are listed. Probe a server to connect it.",
    }


@router.post("/call")
async def call_tool(req: CallTool):
    """Invoke a tool on a server and return exactly what it answered."""
    try:
        result = await manager.call(req.server, req.tool, req.arguments)
    except MCPError as exc:
        # The server's own words, not a generic failure: a missing key, an
        # unknown tool and a crashed process read differently and the person
        # reading this needs to tell them apart.
        raise HTTPException(status_code=502, detail=str(exc))

    # The protocol puts tool failures inside the result, not in a JSON-RPC
    # error: the schema says isError means "the tool call ended in an error",
    # absent meaning success. Passing that through untouched reported an
    # unknown tool as a successful call whose text happened to read "not
    # found", which a caller checking the status code would believe.
    if isinstance(result, dict) and result.get("isError"):
        text = " ".join(
            part.get("text", "")
            for part in (result.get("content") or [])
            if isinstance(part, dict)
        ).strip()
        raise HTTPException(
            status_code=502,
            detail="%s: %s" % (req.server, text or "the tool reported an error"),
        )

    return {"server": req.server, "tool": req.tool, "result": result}
