"""Multi-Platform Gateway Connector Plugin for SMARAN.AI.

Provides gateway operations for Telegram, Discord, and Webhooks within
the plugin system, enabling agents and workflows to send and receive
external messages seamlessly.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List

from app.plugin_system import ConnectorPlugin, PluginConfig, PluginMetadata, PluginType

logger = logging.getLogger("gateway_connector_plugin")


class GatewayConnectorPlugin(ConnectorPlugin):
    """Plugin connecting SMARAN.AI to multi-platform messaging gateways."""

    def __init__(self, config: PluginConfig, metadata: PluginMetadata):
        super().__init__(config, metadata)
        self.connected = False

    async def initialize(self, app_context: Dict[str, Any]) -> bool:
        self.connected = True
        self._initialized = True
        logger.info("Gateway Connector Plugin initialized.")
        return True

    async def shutdown(self) -> bool:
        self.connected = False
        self._initialized = False
        return True

    async def connect(self) -> bool:
        self.connected = True
        return True

    async def disconnect(self) -> bool:
        self.connected = False
        return True

    def get_operations(self) -> List[Dict]:
        return [
            {
                "name": "gateway_send_telegram",
                "description": "Send a notification or update message to Telegram chat via SMARAN gateway.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "chat_id": {"type": "string", "description": "Target Telegram Chat ID (optional if default configured)"},
                        "text": {"type": "string", "description": "Message content in markdown format"}
                    },
                    "required": ["text"]
                }
            },
            {
                "name": "gateway_send_discord",
                "description": "Send an update or report to a Discord channel via SMARAN gateway.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "channel_id": {"type": "string", "description": "Target Discord Channel ID"},
                        "text": {"type": "string", "description": "Message content to post"}
                    },
                    "required": ["text"]
                }
            },
            {
                "name": "gateway_post_webhook",
                "description": "Post task results or notification payload to an external webhook URL.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": {"type": "string", "description": "Destination Webhook URL"},
                        "message": {"type": "string", "description": "Message or payload summary"}
                    },
                    "required": ["url", "message"]
                }
            },
            {
                "name": "gateway_status",
                "description": "Check the connection status of Telegram, Discord, and Webhook gateways.",
                "parameters": {
                    "type": "object",
                    "properties": {}
                }
            }
        ]

    async def execute_operation(self, operation: str, parameters: Dict[str, Any]) -> Dict[str, Any]:
        if operation == "gateway_send_telegram":
            from app.gateway.telegram_bot import TelegramGateway
            tg = TelegramGateway.get_instance()
            chat_id = parameters.get("chat_id") or tg.default_chat_id
            text = parameters.get("text", "")
            if not tg.is_running():
                return {"success": False, "error": "Telegram Gateway is not currently active."}
            success = await tg.send_message(chat_id, text)
            return {"success": success, "chat_id": chat_id}

        elif operation == "gateway_send_discord":
            from app.gateway.discord_bot import DiscordGateway
            dc = DiscordGateway.get_instance()
            channel_id = parameters.get("channel_id") or dc.default_channel_id
            text = parameters.get("text", "")
            if not dc.is_running():
                return {"success": False, "error": "Discord Gateway is not currently active."}
            success = await dc.send_message(channel_id, text)
            return {"success": success, "channel_id": channel_id}

        elif operation == "gateway_post_webhook":
            from app.gateway.webhook_adapter import WebhookGateway
            wh = WebhookGateway.get_instance()
            url = parameters.get("url", "")
            msg = parameters.get("message", "")
            success = await wh.send_message(url, msg)
            return {"success": success, "url": url}

        elif operation == "gateway_status":
            from app.gateway.telegram_bot import TelegramGateway
            from app.gateway.discord_bot import DiscordGateway
            from app.gateway.webhook_adapter import WebhookGateway
            return {
                "telegram": {"active": TelegramGateway.get_instance().is_running()},
                "discord": {"active": DiscordGateway.get_instance().is_running()},
                "webhook": {"active": WebhookGateway.get_instance().is_running()},
            }

        return {"success": False, "error": f"Unknown operation: {operation}"}


def create_plugin(config: PluginConfig) -> GatewayConnectorPlugin:
    meta = PluginMetadata(
        id="gateway_connector",
        name="Multi-Platform Gateway Connector",
        description="Unified gateway connecting SMARAN.AI to Telegram, Discord, and Webhooks.",
        version="1.0.0",
        author="SMARAN.AI",
        plugin_type=PluginType.CONNECTOR,
        tags=["gateway", "telegram", "discord", "webhook", "hermes"],
        dependencies=[],
        is_bundle=False
    )
    return GatewayConnectorPlugin(config, meta)
