"""Multi-Platform Gateway for SMARAN.AI (Hermes Parity).

Enables SMARAN.AI to act as a headless assistant accessible via Telegram,
Discord, and generic Webhooks, processing queries through the agent loop
and streaming results back.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

logger = logging.getLogger("gateway")


class BaseGateway:
    def __init__(self, platform: str):
        self.platform = platform
        self._running = False

    def is_running(self) -> bool:
        return self._running

    async def start(self, config: Dict[str, Any]) -> bool:
        raise NotImplementedError

    async def stop(self) -> bool:
        raise NotImplementedError

    async def send_message(self, recipient_id: str, text: str) -> bool:
        raise NotImplementedError
