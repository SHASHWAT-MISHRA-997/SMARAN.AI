"""Generic Webhook Adapter for SMARAN.AI Gateway.

Handles incoming webhook payloads from platforms like Slack, WhatsApp,
n8n, Zapier, GitHub, or custom services, executes tasks through the agent,
and delivers formatted responses.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from typing import Any, Callable, Dict, Optional

import httpx

from app.gateway import BaseGateway

logger = logging.getLogger("gateway.webhook")


class WebhookGateway(BaseGateway):
    _instance: Optional[WebhookGateway] = None

    @classmethod
    def get_instance(cls) -> WebhookGateway:
        if cls._instance is None:
            cls._instance = WebhookGateway()
        return cls._instance

    def __init__(self):
        super().__init__("webhook")
        self.secret_token: str = ""
        self.default_callback_url: str = ""

    async def start(self, config: Dict[str, Any]) -> bool:
        # A secret is required: without one, any program on this computer -
        # or a web page making a request to 127.0.0.1 - could run the agent.
        # None given: one is made, and Settings shows it.
        import secrets as _secrets
        self.secret_token = (config.get("secret_token") or "").strip() or _secrets.token_urlsafe(24)
        self.default_callback_url = config.get("callback_url", "")
        self._running = True
        logger.info("Webhook Gateway enabled.")
        return True

    async def stop(self) -> bool:
        self._running = False
        logger.info("Webhook Gateway disabled.")
        return True

    async def send_message(self, recipient_id: str, text: str) -> bool:
        url = recipient_id or self.default_callback_url
        if not url:
            return False
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(url, json={
                    "event": "agent_response",
                    "text": text,
                    "timestamp": time.time(),
                })
                response.raise_for_status()
            return True
        except Exception as exc:
            logger.error(f"Failed to post webhook response: {exc}")
            return False

    async def handle_incoming(self, platform: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Parses generic or platform-specific webhook payload and dispatches task."""
        if not self._running:
            return {"status": "unavailable", "reason": "Webhook gateway is stopped"}
        if not isinstance(payload, dict):
            return {"status": "ignored", "reason": "Payload must be a JSON object"}
        # Extract task prompt and optional callback url
        prompt = ""
        callback_url = payload.get("callback_url") or self.default_callback_url

        if platform == "slack":
            # Slack event format
            event = payload.get("event", {})
            prompt = event.get("text", "")
        elif platform == "github":
            # GitHub webhook e.g. issue or push comment
            prompt = f"GitHub event {payload.get('action')}: {payload.get('comment', {}).get('body', '')}"
        else:
            # Generic format: {"prompt": "..."} or {"message": "..."} or {"text": "..."}
            prompt = payload.get("prompt") or payload.get("message") or payload.get("text", "")

        if not isinstance(prompt, str) or not prompt.strip():
            return {"status": "ignored", "reason": "No prompt found in payload"}

        # Run task in background or synchronously if wait requested
        task_id = f"wh_{uuid.uuid4().hex}"
        asyncio.create_task(self._process_webhook_task(task_id, prompt, callback_url))

        return {
            "status": "accepted",
            "task_id": task_id,
            "message": "Task dispatched to SMARAN agent.",
        }

    async def _process_webhook_task(self, task_id: str, prompt: str, callback_url: str):
        try:
            from app.agent import loop as agent_loop
            output_parts = []
            async for event in agent_loop.run(task=prompt, mode="smart"):
                if event.get("type") == "message":
                    output_parts.append(event.get("text", ""))
                elif event.get("type") == "error":
                    output_parts.append(f"Error: {event.get('message')}")

            final = "\n\n".join(filter(None, output_parts)) or "Completed."
            if callback_url:
                await self.send_message(callback_url, final)
        except Exception as exc:
            logger.error(f"Webhook task {task_id} failed: {exc}", exc_info=True)
            if callback_url:
                await self.send_message(callback_url, f"Error: {exc}")
