"""Holding the MCP servers this installation talks to.

Servers are stored on disk and connected on demand. Connecting on demand
rather than at startup matters: a server that wants a key, or that is simply
slow to boot, should delay the first call that needs it and not the whole app.

A server is only ever described by what it actually reported. Nothing here
guesses at a tool list, and a server that has not been reached says so instead
of borrowing the shape of one that has.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any, Dict, List, Optional

from .client import MCPError, MCPSession, connect

logger = logging.getLogger(__name__)


def _store_path() -> str:
    from app.config import settings

    os.makedirs(settings.DATA_DIR, exist_ok=True)
    return os.path.join(settings.DATA_DIR, "mcp_servers.json")


class MCPManager:
    def __init__(self) -> None:
        self._sessions: Dict[str, MCPSession] = {}
        self._errors: Dict[str, str] = {}
        self._lock = asyncio.Lock()

    # -- persistence -------------------------------------------------------

    def load(self) -> Dict[str, dict]:
        try:
            with open(_store_path(), "r", encoding="utf-8") as handle:
                return json.load(handle)
        except (OSError, ValueError):
            return {}

    def save(self, servers: Dict[str, dict]) -> None:
        with open(_store_path(), "w", encoding="utf-8") as handle:
            json.dump(servers, handle, indent=2)

    def add(self, name: str, target: str, env: Optional[dict] = None,
            headers: Optional[dict] = None) -> dict:
        servers = self.load()
        record = {
            "name": name,
            "target": target,
            "env": env or {},
            "headers": headers or {},
            "enabled": True,
        }
        servers[name] = record
        self.save(servers)
        return record

    async def remove(self, name: str) -> bool:
        servers = self.load()
        if name not in servers:
            return False
        del servers[name]
        self.save(servers)
        await self.disconnect(name)
        return True

    # -- connections -------------------------------------------------------

    async def session(self, name: str) -> MCPSession:
        """The live session for a server, connecting if it is not up yet."""
        async with self._lock:
            if name in self._sessions:
                return self._sessions[name]

            record = self.load().get(name)
            if not record:
                raise MCPError("No server named %r is configured." % name)
            if not record.get("enabled", True):
                raise MCPError("%s is turned off." % name)

            try:
                session = await connect(
                    name,
                    record["target"],
                    env=record.get("env"),
                    headers=record.get("headers"),
                )
            except MCPError as exc:
                # Keep the reason so status can report it without reconnecting.
                self._errors[name] = str(exc)
                raise

            self._errors.pop(name, None)
            self._sessions[name] = session
            return session

    async def disconnect(self, name: str) -> None:
        session = self._sessions.pop(name, None)
        if session:
            await session.close()

    async def disconnect_all(self) -> None:
        for name in list(self._sessions):
            await self.disconnect(name)

    # -- reporting ---------------------------------------------------------

    async def status(self, name: str, probe: bool = False) -> dict:
        """What is known about one server.

        With probe=False this reports only what is already known, so listing
        does not start every configured server. With probe=True it connects,
        which is what a person asking "does this work?" means.
        """
        record = self.load().get(name)
        if not record:
            return {"name": name, "state": "unknown", "detail": "Not configured."}

        base = {
            "name": name,
            "target": record["target"],
            "enabled": record.get("enabled", True),
        }

        if not record.get("enabled", True):
            return {**base, "state": "off", "detail": "Turned off.", "tools": []}

        if name in self._sessions and not probe:
            s = self._sessions[name]
            return {
                **base,
                "state": "connected",
                "server": s.server_info,
                "capabilities": sorted(s.server_capabilities.keys()),
                "detail": "Connected.",
            }

        if not probe:
            failed = self._errors.get(name)
            return {
                **base,
                "state": "failed" if failed else "not_connected",
                "detail": failed or "Saved. It connects when first used.",
            }

        try:
            s = await self.session(name)
        except MCPError as exc:
            return {**base, "state": "failed", "detail": str(exc)}

        tools = await s.list_tools()
        return {
            **base,
            "state": "connected",
            "server": s.server_info,
            "capabilities": sorted(s.server_capabilities.keys()),
            "tools": [
                {"name": t.get("name"), "description": t.get("description")}
                for t in tools
            ],
            "resources": len(await s.list_resources()),
            "prompts": len(await s.list_prompts()),
            "detail": "Connected. %d tool%s." % (len(tools), "" if len(tools) == 1 else "s"),
        }

    async def all_tools(self) -> List[dict]:
        """Every tool from every connected server, tagged with its origin.

        Only already-connected servers are asked. Starting each configured
        server to answer a listing would make opening a menu launch a dozen
        processes.
        """
        out: List[dict] = []
        for name, session in list(self._sessions.items()):
            try:
                for tool in await session.list_tools():
                    out.append({**tool, "server": name})
            except MCPError as exc:
                logger.warning("listing tools from %s failed: %s", name, exc)
        return out

    async def call(self, server: str, tool: str, arguments: Optional[dict] = None) -> Any:
        session = await self.session(server)
        return await session.call_tool(tool, arguments or {})


manager = MCPManager()
