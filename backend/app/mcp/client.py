"""A Model Context Protocol client.

MCP is an open specification, so a server written for any client that speaks it
works here too — the same server a person already runs against another tool
needs no change to be used from this one. Nothing in this file is copied from
another product; it implements the published protocol.

Shapes and method names were read from the official schema at
modelcontextprotocol/modelcontextprotocol, revision 2025-06-18, rather than
recalled. `initialize` requires exactly protocolVersion, capabilities and
clientInfo; the rest of the method names are the ones the schema defines.

Two transports are supported, because those are the two servers are published
with: a local process spoken to over stdin and stdout, and an HTTP endpoint.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shlex
import shutil
import sys
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

PROTOCOL_VERSION = "2025-06-18"
CLIENT_INFO = {"name": "SMARAN.AI", "version": "2.8.2"}

# What this client can do for a server. Declaring a capability it does not
# implement would have servers send requests that are never answered, so this
# stays empty until each is genuinely handled.
CLIENT_CAPABILITIES: Dict[str, Any] = {}


class MCPError(RuntimeError):
    """A failure worth showing the user in the words it happened in."""


class MCPSession:
    """One connection to one server.

    A session is stateful: the protocol requires `initialize` before anything
    else, and a notification that initialisation finished before the server is
    obliged to answer. Doing that per call would be several round trips for
    every tool invocation.
    """

    def __init__(self, name: str) -> None:
        self.name = name
        self.server_info: Dict[str, Any] = {}
        self.server_capabilities: Dict[str, Any] = {}
        self._next_id = 0
        self._initialised = False

    def _id(self) -> int:
        self._next_id += 1
        return self._next_id

    # -- transport ---------------------------------------------------------

    async def _send(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        raise NotImplementedError

    async def close(self) -> None:
        return None

    # -- protocol ----------------------------------------------------------

    async def _request(self, method: str, params: Optional[Dict] = None) -> Any:
        message = {"jsonrpc": "2.0", "id": self._id(), "method": method}
        if params is not None:
            message["params"] = params

        reply = await self._send(message)
        if reply is None:
            raise MCPError("%s: no reply to %s" % (self.name, method))

        if "error" in reply:
            err = reply["error"] or {}
            raise MCPError(
                "%s: %s (code %s)"
                % (self.name, err.get("message", "unknown error"), err.get("code"))
            )
        return reply.get("result")

    async def _notify(self, method: str, params: Optional[Dict] = None) -> None:
        message = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            message["params"] = params
        await self._send(message)

    async def initialize(self) -> Dict[str, Any]:
        result = await self._request(
            "initialize",
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": CLIENT_CAPABILITIES,
                "clientInfo": CLIENT_INFO,
            },
        )
        self.server_info = (result or {}).get("serverInfo") or {}
        self.server_capabilities = (result or {}).get("capabilities") or {}

        # The server is not required to answer anything else until it has been
        # told initialisation completed.
        await self._notify("notifications/initialized")
        self._initialised = True
        return result or {}

    async def list_tools(self) -> List[Dict[str, Any]]:
        # Asking a server for a capability it did not advertise is a request it
        # is entitled to reject, so absence is reported as an empty list rather
        # than as a failure.
        if "tools" not in self.server_capabilities:
            return []
        result = await self._request("tools/list")
        return (result or {}).get("tools") or []

    async def list_resources(self) -> List[Dict[str, Any]]:
        if "resources" not in self.server_capabilities:
            return []
        result = await self._request("resources/list")
        return (result or {}).get("resources") or []

    async def list_prompts(self) -> List[Dict[str, Any]]:
        if "prompts" not in self.server_capabilities:
            return []
        result = await self._request("prompts/list")
        return (result or {}).get("prompts") or []

    async def call_tool(self, name: str, arguments: Optional[Dict] = None) -> Any:
        return await self._request(
            "tools/call", {"name": name, "arguments": arguments or {}}
        )


class StdioSession(MCPSession):
    """A server run as a child process, spoken to over stdin and stdout.

    Messages are newline-delimited JSON. The process's stderr is kept and
    surfaced on failure: servers write their startup problems there, and
    discarding it turns "missing API key" into "the process exited".
    """

    def __init__(self, name: str, command: str, env: Optional[Dict[str, str]] = None) -> None:
        super().__init__(name)
        self.command = command
        self.env = env or {}
        self._proc: Optional[asyncio.subprocess.Process] = None
        self._stderr: List[str] = []
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        parts = shlex.split(self.command, posix=(os.name != "nt"))
        if not parts:
            raise MCPError("%s: no command to run." % self.name)

        # Most MCP servers are published as an `npx` or `uvx` line. On Windows
        # those are .cmd shims, and create_subprocess_exec does not apply
        # PATHEXT, so the bare name is not found even though the tool is
        # installed. Resolving it first makes the documented command work as
        # written rather than requiring a Windows-specific one.
        resolved = shutil.which(parts[0])
        if resolved:
            parts[0] = resolved

        environment = dict(os.environ)
        environment.update(self.env)

        try:
            self._proc = await asyncio.create_subprocess_exec(
                *parts,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=environment,
            )
        except FileNotFoundError:
            raise MCPError(
                "%s: '%s' is not on PATH. Install it, or give the full path."
                % (self.name, parts[0])
            )
        except OSError as exc:
            raise MCPError("%s: could not start '%s': %s" % (self.name, parts[0], exc))

        asyncio.create_task(self._drain_stderr())

    async def _drain_stderr(self) -> None:
        if not self._proc or not self._proc.stderr:
            return
        while True:
            line = await self._proc.stderr.readline()
            if not line:
                return
            text = line.decode("utf-8", "replace").rstrip()
            if text:
                self._stderr.append(text)
                del self._stderr[:-40]  # keep the tail, not the whole run

    def _why_it_died(self) -> str:
        tail = " / ".join(self._stderr[-4:])
        code = self._proc.returncode if self._proc else None
        if tail:
            return "the server exited (code %s): %s" % (code, tail[:300])
        return "the server exited (code %s) without saying why" % code

    async def _send(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not self._proc or not self._proc.stdin or not self._proc.stdout:
            raise MCPError("%s: not running." % self.name)

        line = json.dumps(payload) + "\n"
        async with self._lock:
            try:
                self._proc.stdin.write(line.encode("utf-8"))
                await self._proc.stdin.drain()
            except (BrokenPipeError, ConnectionResetError):
                raise MCPError("%s: %s" % (self.name, self._why_it_died()))

            if "id" not in payload:
                return None  # a notification is not answered

            while True:
                try:
                    raw = await asyncio.wait_for(self._proc.stdout.readline(), timeout=60)
                except asyncio.TimeoutError:
                    raise MCPError("%s: no reply within 60 seconds." % self.name)
                if not raw:
                    raise MCPError("%s: %s" % (self.name, self._why_it_died()))

                text = raw.decode("utf-8", "replace").strip()
                if not text:
                    continue
                try:
                    message = json.loads(text)
                except ValueError:
                    # Servers sometimes print to stdout. Skip what is not a
                    # message rather than failing the call over it.
                    continue
                # Ignore anything that is not the answer to this request:
                # notifications and server-initiated requests share the pipe.
                if message.get("id") == payload["id"]:
                    return message

    async def close(self) -> None:
        if self._proc and self._proc.returncode is None:
            try:
                self._proc.terminate()
                await asyncio.wait_for(self._proc.wait(), timeout=5)
            except (asyncio.TimeoutError, ProcessLookupError):
                try:
                    self._proc.kill()
                except ProcessLookupError:
                    pass


class HttpSession(MCPSession):
    """A server reached over HTTP.

    Each message is posted and the reply read from the response. A server that
    upgrades to a stream answers with text/event-stream, so both are accepted.
    """

    def __init__(self, name: str, url: str, headers: Optional[Dict[str, str]] = None) -> None:
        super().__init__(name)
        self.url = url
        self.headers = headers or {}
        self._session_header: Optional[str] = None

    async def _send(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        import httpx

        headers = {
            "content-type": "application/json",
            "accept": "application/json, text/event-stream",
        }
        headers.update(self.headers)
        if self._session_header:
            headers["mcp-session-id"] = self._session_header

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(self.url, json=payload, headers=headers)
        except httpx.ConnectError as exc:
            raise MCPError("%s: could not reach %s (%s)" % (self.name, self.url, exc))
        except httpx.TimeoutException:
            raise MCPError("%s: %s did not answer within 60 seconds." % (self.name, self.url))

        # The server assigns a session on initialize and expects it back.
        if response.headers.get("mcp-session-id"):
            self._session_header = response.headers["mcp-session-id"]

        if "id" not in payload:
            return None
        if response.status_code >= 400:
            raise MCPError(
                "%s: HTTP %s from %s — %s"
                % (self.name, response.status_code, self.url, response.text[:200])
            )

        body = response.text.strip()
        if response.headers.get("content-type", "").startswith("text/event-stream"):
            # Take the last data: line, which carries the reply.
            for line in reversed(body.splitlines()):
                if line.startswith("data:"):
                    body = line[5:].strip()
                    break

        try:
            return json.loads(body)
        except ValueError:
            raise MCPError("%s: reply was not JSON — %s" % (self.name, body[:200]))


async def connect(name: str, target: str, env: Optional[Dict[str, str]] = None,
                  headers: Optional[Dict[str, str]] = None) -> MCPSession:
    """Open and initialise a session, choosing the transport from the target.

    An http(s) target is spoken to over HTTP; anything else is treated as a
    command to run. That covers how servers are actually published — either an
    address or an `npx`/`uvx` line.
    """
    if target.startswith(("http://", "https://")):
        session: MCPSession = HttpSession(name, target, headers)
    else:
        session = StdioSession(name, target, env)
        await session.start()

    try:
        await session.initialize()
    except Exception:
        await session.close()
        raise
    return session
