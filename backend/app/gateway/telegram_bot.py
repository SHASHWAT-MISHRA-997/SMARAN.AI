"""Telegram Bot Gateway Adapter for SMARAN.AI.

Uses direct Telegram Bot HTTP API via httpx for maximum reliability
and zero extra dependency requirement.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from typing import Any, Dict, Optional

import httpx

from app.gateway import BaseGateway

logger = logging.getLogger("gateway.telegram")
# httpx logs every request URL at INFO, and a Telegram URL carries the bot
# token: /bot<token>/getUpdates. Kept out of the log.
logging.getLogger("httpx").setLevel(logging.WARNING)

#: What a BotFather token looks like: "<bot id>:<35 characters>".
TOKEN_SHAPE = re.compile(r"^\d{5,15}:[A-Za-z0-9_-]{30,60}$")


def token_problem(token: str) -> str:
    """Why this cannot be a bot token, in words a person can act on, or ''."""
    token = (token or "").strip()
    if not token:
        return "Paste the bot token from @BotFather first."
    if TOKEN_SHAPE.match(token):
        return ""
    if ":" not in token:
        return ("That is not a bot token. A bot token comes from @BotFather in Telegram "
                "(send /newbot, then copy the token) and looks like 123456789:AAE... with a colon. "
                "The API token on gateway.telegram.org is for Telegram's paid verification-code "
                "service and cannot run a bot.")
    return "That does not look like a complete bot token - copy it again from @BotFather."


class TelegramGateway(BaseGateway):
    _instance: Optional[TelegramGateway] = None

    @classmethod
    def get_instance(cls) -> TelegramGateway:
        if cls._instance is None:
            cls._instance = TelegramGateway()
        return cls._instance

    def __init__(self):
        super().__init__("telegram")
        self.bot_token: str = ""
        self.default_chat_id: str = ""
        self.allowed_users: list[int] = []
        self._poll_task: Optional[asyncio.Task] = None
        self._client: Optional[httpx.AsyncClient] = None
        self._last_update_id: int = 0
        self.last_error: str = ""
        self.bot_name: str = ""
        from app.gateway.owners import Pairing
        self.pairing = Pairing("telegram")

    async def start(self, config: Dict[str, Any]) -> bool:
        if self._running:
            return True
        token = (config.get("token") or os.environ.get("SMARAN_TELEGRAM_TOKEN", "")).strip()
        self.last_error = token_problem(token)
        if self.last_error:
            return False

        self.bot_token = token
        self.default_chat_id = str(config.get("default_chat_id", "") or "")
        self._client = httpx.AsyncClient(
            base_url=f"https://api.telegram.org/bot{self.bot_token}",
            timeout=30.0
        )
        try:
            resp = await self._client.get("/getMe")
            data = resp.json()
            if not data.get("ok"):
                # 401: Telegram does not know this token (revoked or mistyped).
                self.last_error = ("Telegram refused this token (%s). Copy it again from @BotFather, "
                                   "or send /token there to get the current one."
                                   % (data.get("description") or resp.status_code))
                await self.stop()
                return False
            self.bot_name = data.get("result", {}).get("username", "")
            logger.info("Connected to Telegram Bot: @%s", self.bot_name)
        except Exception as exc:  # noqa: BLE001
            # The request URL carries the token; keep it out of the log.
            logger.error("Failed to connect to Telegram: %s", str(exc).replace(self.bot_token, "<token>"))
            self.last_error = f"Could not reach Telegram ({type(exc).__name__}). Check the internet connection."
            await self.stop()
            return False

        self._running = True
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
        logger.info("Telegram Gateway stopped.")
        return True

    async def send_message(self, recipient_id: str, text: str) -> bool:
        if not self._client or not self.bot_token or not recipient_id:
            return False
        try:
            for offset in range(0, len(text), 4000):
                response = await self._client.post("/sendMessage", json={
                    "chat_id": recipient_id, "text": text[offset:offset + 4000],
                })
                response.raise_for_status()
                if not response.json().get("ok"):
                    return False
            return True
        except Exception:
            logger.warning("Telegram message delivery failed")
            return False

    async def _poll_loop(self):
        while self._running and self._client:
            try:
                resp = await self._client.get("/getUpdates", params={
                    "offset": self._last_update_id + 1,
                    "timeout": 20,
                })
                data = resp.json()
                if not data.get("ok"):
                    await asyncio.sleep(5)
                    continue
                if data.get("ok"):
                    for update in data.get("result", []):
                        self._last_update_id = update.get("update_id", self._last_update_id)
                        await self._handle_update(update)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.debug(f"Telegram polling error: {exc}")
                await asyncio.sleep(5)

    async def _handle_update(self, update: Dict[str, Any]):
        msg = update.get("message")
        if not msg:
            return

        chat_id = str(msg.get("chat", {}).get("id"))
        user_id = msg.get("from", {}).get("id")
        text = msg.get("text", "").strip()
        if not text:
            return

        # Only owners command this computer. Anyone else can only pair.
        if not self.pairing.is_owner(user_id):
            if text.startswith("/pair"):
                outcome = self.pairing.try_pair(user_id, text[5:].strip())
                if outcome == "paired":
                    if not self.default_chat_id:
                        self.default_chat_id = chat_id
                    await self.send_message(chat_id, "Paired. This chat now controls SMARAN on your computer. Send /help to see what I can do.")
                elif outcome == "locked":
                    await self.send_message(chat_id, "Too many wrong codes from this account.")
                else:
                    await self.send_message(chat_id, "That code is not right. Check SMARAN -> Settings -> Gateway & Bots.")
                return
            from app.gateway.owners import PRIVATE
            await self.send_message(chat_id, PRIVATE)
            return

        if text.startswith("/start") or text.startswith("/help"):
            welcome = (
                "🤖 **SMARAN.AI Agent Gateway**\n\n"
                "I am your local AI agent. You can send me coding tasks, questions, or instructions.\n\n"
                "Commands:\n"
                "• `/status` - Check agent & model status\n"
                "• `/model <name>` - Switch active model\n"
                "• Just type any query or task to run the agent!"
            )
            await self.send_message(chat_id, welcome)
            return

        if text.startswith("/status"):
            await self.send_message(chat_id, "⚡ SMARAN.AI Agent is online and ready for tasks.")
            return

        # Regular task prompt -> Dispatch to agent loop
        await self.send_message(chat_id, f"⚙️ *Working on task:* `{text[:100]}...`")

        asyncio.create_task(self._run_agent_task(chat_id, text))

    async def _run_agent_task(self, chat_id: str, prompt: str):
        try:
            from app.agent import loop as agent_loop
            output_parts = []
            tools_used = []

            # Smart approval with nobody to approve: edits inside the project run,
            # anything else that would ask is declined.
            async for event in agent_loop.run(task=prompt, mode="smart"):
                etype = event.get("type")
                if etype == "message":
                    output_parts.append(event.get("text", ""))
                elif etype == "tool_call":
                    tool_name = event.get("name")
                    tools_used.append(tool_name)
                elif etype == "error":
                    output_parts.append(f"❌ Error: {event.get('message')}")

            final_reply = "\n\n".join(filter(None, output_parts)) or "Task completed."
            if tools_used:
                final_reply = f"🔧 *Used tools:* {', '.join(set(tools_used))}\n\n" + final_reply

            await self.send_message(chat_id, final_reply)
        except Exception as exc:
            await self.send_message(chat_id, f"⚠️ Agent execution error: {exc}")
