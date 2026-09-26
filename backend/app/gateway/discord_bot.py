"""Discord Bot Gateway Adapter for SMARAN.AI.

Integrates with Discord Bot API via httpx for lightweight,
dependency-free multi-platform interaction.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any, Dict, Optional

import httpx

from app.gateway import BaseGateway

logger = logging.getLogger("gateway.discord")


class DiscordGateway(BaseGateway):
    _instance: Optional[DiscordGateway] = None

    @classmethod
    def get_instance(cls) -> DiscordGateway:
        if cls._instance is None:
            cls._instance = DiscordGateway()
        return cls._instance

    def __init__(self):
        super().__init__("discord")
        self.bot_token: str = ""
        self.default_channel_id: str = ""
        self.allowed_users: list[str] = []
        self._poll_task: Optional[asyncio.Task] = None
        self._client: Optional[httpx.AsyncClient] = None
        self._last_message_id: Optional[str] = None
        self._bot_user_id: Optional[str] = None
        self.last_error: str = ""
        self.bot_name: str = ""
        from app.gateway.owners import Pairing
        self.pairing = Pairing("discord")

    async def start(self, config: Dict[str, Any]) -> bool:
        if self._running:
            return True
        token = config.get("token") or os.environ.get("SMARAN_DISCORD_TOKEN", "")
        if not token:
            self.last_error = "Paste the bot token from the Discord Developer Portal first."
            return False
        if not str(config.get("default_channel_id", "") or "").strip():
            self.last_error = "Add the Channel ID the bot should listen in (right-click the channel -> Copy Channel ID)."
            return False

        self._last_message_id = None
        self.bot_token = token
        self.default_channel_id = str(config.get("default_channel_id", ""))
        self.allowed_users = [str(u) for u in config.get("allowed_users", [])]

        headers = {
            "Authorization": f"Bot {self.bot_token}",
            "User-Agent": "SMARAN-Agent (https://smaran.ai, 1.0)",
        }
        self._client = httpx.AsyncClient(
            base_url="https://discord.com/api/v10",
            headers=headers,
            timeout=30.0
        )

        try:
            resp = await self._client.get("/users/@me")
            data = resp.json()
            if "id" not in data:
                self.last_error = ("Discord refused this token (%s). Reset it in the Developer Portal -> "
                                   "Bot, and paste the new one." % (data.get("message") or resp.status_code))
                await self.stop()
                return False
            self._bot_user_id = data["id"]
            self.bot_name = data.get("username", "")
            logger.info(f"Connected to Discord Bot: {data.get('username')}#{data.get('discriminator', '0')}")
        except Exception as exc:  # noqa: BLE001
            self.last_error = f"Could not reach Discord ({type(exc).__name__}). Check the internet connection."
            await self.stop()
            return False

        self._running = True
        if self.default_channel_id:
            self._poll_task = asyncio.create_task(self._poll_loop())
        return True

    async def stop(self) -> bool:
        self._running = False
        if self._poll_task and not self._poll_task.done():
            self._poll_task.cancel()
            try:
                await self._poll_task
            except asyncio.CancelledError:
                pass
        self._poll_task = None
        if self._client:
            await self._client.aclose()
            self._client = None
        logger.info("Discord Gateway stopped.")
        return True

    async def send_message(self, recipient_id: str, text: str) -> bool:
        channel_id = recipient_id or self.default_channel_id
        if not self._client or not channel_id:
            return False

        try:
            chunks = [text[i:i + 1900] for i in range(0, len(text), 1900)]
            for chunk in chunks:
                response = await self._client.post(f"/channels/{channel_id}/messages", json={
                    "content": chunk
                })
                response.raise_for_status()
            return True
        except Exception as exc:
            logger.error(f"Failed to send Discord message: {exc}")
            return False

    async def _poll_loop(self):
        """Polls channel messages (HTTP polling for lightweight operation)."""
        while self._running and self._client and self.default_channel_id:
            try:
                params = {"limit": 5}
                if self._last_message_id:
                    params["after"] = self._last_message_id

                resp = await self._client.get(f"/channels/{self.default_channel_id}/messages", params=params)
                if resp.status_code == 200:
                    messages = resp.json()
                    # Messages come newest first if no 'after', or newest first
                    if messages:
                        self._last_message_id = messages[0]["id"]
                        for msg in reversed(messages):
                            author_id = msg.get("author", {}).get("id")
                            if msg.get("author", {}).get("bot") or author_id == self._bot_user_id:
                                continue  # Ignore own messages

                            content = msg.get("content", "").strip()
                            if not content:
                                continue

                            if not self.pairing.is_owner(author_id):
                                # Anyone in the channel can see the bot; only owners command it.
                                lowered = content.lower()
                                if lowered.startswith("!smaran pair") or lowered.startswith("/pair"):
                                    attempt = content.split()[-1]
                                    outcome = self.pairing.try_pair(author_id, attempt)
                                    await self.send_message(self.default_channel_id, {
                                        "paired": "Paired. You can now give SMARAN tasks here with !smaran <task>.",
                                        "locked": "Too many wrong codes from this account.",
                                    }.get(outcome, "That code is not right. Check SMARAN -> Settings -> Gateway & Bots."))
                                elif lowered.startswith("!smaran") or lowered.startswith("/ask"):
                                    from app.gateway.owners import PRIVATE
                                    await self.send_message(self.default_channel_id, PRIVATE.replace("/pair", "!smaran pair"))
                                continue

                            await self._handle_message(self.default_channel_id, content)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.debug(f"Discord poll error: {exc}")
            await asyncio.sleep(4)

    async def _handle_message(self, channel_id: str, content: str):
        if content.startswith("!smaran") or content.startswith("/ask") or content.startswith("<@"):
            # Clean prompt
            prompt = content.replace("!smaran", "").strip()
            await self.send_message(channel_id, f"⚙️ *SMARAN Agent starting task:* `{prompt[:100]}...`")
            asyncio.create_task(self._run_agent_task(channel_id, prompt))

    async def _run_agent_task(self, channel_id: str, prompt: str):
        try:
            from app.agent import loop as agent_loop
            output_parts = []
            async for event in agent_loop.run(task=prompt, mode="smart"):
                if event.get("type") == "message":
                    output_parts.append(event.get("text", ""))
                elif event.get("type") == "error":
                    output_parts.append(f"❌ Error: {event.get('message')}")

            final = "\n\n".join(filter(None, output_parts)) or "Task completed."
            await self.send_message(channel_id, final)
        except Exception as exc:
            await self.send_message(channel_id, f"⚠️ Agent execution error: {exc}")
