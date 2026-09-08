import asyncio

from app.mcp.client import MCPError
from app.mcp.manager import MCPManager


class Session:
    server_info = {"name": "fixture"}
    server_capabilities = {"tools": {}}
    closed = False
    fail = False

    async def list_tools(self):
        if self.fail:
            raise MCPError("server disconnected")
        return [{"name": "read", "description": "Read a fixture"}]

    async def list_resources(self):
        return []

    async def list_prompts(self):
        return []

    async def close(self):
        self.closed = True


def test_probe_retains_tool_evidence_and_failed_probe_clears_connection():
    async def run():
        manager = MCPManager()
        manager.load = lambda: {"fixture": {"target": "fixture", "enabled": True}}
        session = Session()
        manager._sessions["fixture"] = session
        assert (await manager.status("fixture", probe=True))["tools"][0]["name"] == "read"
        assert (await manager.status("fixture"))["tools"][0]["name"] == "read"
        session.fail = True
        result = await manager.status("fixture", probe=True)
        assert result["state"] == "failed"
        assert "disconnected" in result["detail"]
        assert session.closed
        assert "fixture" not in manager._sessions
        assert (await manager.status("fixture"))["state"] == "failed"
    asyncio.run(run())
