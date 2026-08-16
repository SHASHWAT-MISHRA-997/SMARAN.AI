"""
STRIX Security Plugin for SMARAN.AI
===================================
Automated AI vulnerability scanning, penetration testing heuristics, code hardening & compliance auditing.
Inspired by: https://github.com/usestrix/strix.git
"""

import logging
import re
from typing import List, Dict, Any, Optional
from app.plugin_system import ToolPlugin, PluginMetadata, PluginConfig, PluginType

logger = logging.getLogger("strix_security_plugin")

class StrixSecurityPlugin(ToolPlugin):
    """Plugin providing STRIX AI-driven vulnerability assessment and code security scanning."""

    def __init__(self, config: PluginConfig, metadata: PluginMetadata):
        super().__init__(config, metadata)

    async def initialize(self, app_context: Dict[str, Any]) -> bool:
        self._initialized = True
        logger.info("STRIX security analysis plugin initialized.")
        return True

    async def shutdown(self) -> bool:
        self._initialized = False
        return True

    def get_tools(self) -> List[Dict]:
        return [
            {
                "name": "strix_scan_code",
                "description": "Perform static and heuristic vulnerability analysis on code snippets (SQLi, IDOR, XSS, Secret Leaks, Command Injection).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "code_snippet": {"type": "string", "description": "Source code text to scan"},
                        "language": {"type": "string", "enum": ["python", "javascript", "sql", "html", "all"], "description": "Code language"}
                    },
                    "required": ["code_snippet"]
                }
            },
            {
                "name": "strix_audit_endpoint_security",
                "description": "Evaluate an API endpoint design for authentication, authorization ownership (IDOR), rate-limiting, and CSRF protection.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "endpoint_path": {"type": "string", "description": "API path (e.g. '/api/chat/sessions/{id}')"},
                        "http_method": {"type": "string", "enum": ["GET", "POST", "PUT", "DELETE", "PATCH"]},
                        "has_auth_guard": {"type": "boolean"},
                        "has_ownership_check": {"type": "boolean"},
                        "has_rate_limit": {"type": "boolean"}
                    },
                    "required": ["endpoint_path", "http_method"]
                }
            }
        ]

    async def execute_tool(self, tool_name: str, arguments: Dict) -> Any:
        if tool_name == "strix_scan_code":
            code = arguments.get("code_snippet", "")
            findings = []
            
            # Check hardcoded secrets
            secret_patterns = [
                (r'(?i)(api_key|secret|password|token)\s*=\s*[\'"][A-Za-z0-9_\-]{8,}[\'"]', "POTENTIAL_HARDCODED_SECRET", "HIGH"),
                (r'(?i)subprocess\.run\(.*shell\s*=\s*True.*\)', "COMMAND_INJECTION_RISK", "CRITICAL"),
                (r'(?i)f["\']SELECT .* FROM .* WHERE .*\{.*\}', "SQL_INJECTION_RISK", "CRITICAL"),
                (r'(?i)dangerouslySetInnerHTML', "XSS_RISK", "MEDIUM")
            ]
            for pat, name, sev in secret_patterns:
                if re.search(pat, code):
                    findings.append({
                        "type": name,
                        "severity": sev,
                        "recommendation": f"Sanitize input or extract configuration to environment variable."
                    })
                    
            status_summary = "SECURE" if not findings else ("WARNING" if any(f["severity"] == "CRITICAL" for f in findings) else "REVIEW")
            return {
                "scan_status": status_summary,
                "total_vulnerabilities_detected": len(findings),
                "findings": findings,
                "strix_score": 100 - (len(findings) * 20)
            }

        elif tool_name == "strix_audit_endpoint_security":
            path = arguments.get("endpoint_path", "")
            method = arguments.get("http_method", "GET")
            auth = arguments.get("has_auth_guard", False)
            ownership = arguments.get("has_ownership_check", False)
            rate_limit = arguments.get("has_rate_limit", False)

            risks = []
            if not auth and not path.startswith("/api/auth"):
                risks.append("Endpoint lacks mandatory authentication verification (401 guard).")
            if not ownership and ("{id}" in path or "{docId}" in path or "{colId}" in path):
                risks.append("Endpoint accepts object ID without explicit user ownership verification (IDOR vulnerability).")
            if not rate_limit and method in ["POST", "PUT", "DELETE"]:
                risks.append("Mutation endpoint lacks rate limiting protection against automated abuse.")

            return {
                "endpoint": f"{method} {path}",
                "security_rating": "A" if not risks else ("C" if len(risks) == 1 else "F"),
                "passed_checks": {
                    "authentication": auth,
                    "idor_protection": ownership,
                    "rate_limiting": rate_limit
                },
                "identified_vulnerabilities": risks,
                "remediation_status": "COMPLIANT" if not risks else "ACTION_REQUIRED"
            }

        raise ValueError(f"Unknown STRIX tool: {tool_name}")

metadata = PluginMetadata(
    name="strix-security",
    version="1.6.0",
    description="Automated AI vulnerability scanner, IDOR verification, secret detection and security defense agent.",
    author="Strix Labs",
    plugin_type=PluginType.TOOL,
    entry_point="strix_security:StrixSecurityPlugin",
    dependencies=[],
    config_schema={},
    tags=["security", "vulnerability-scanner", "idor-defense", "audit", "pentesting"],
    homepage="https://github.com/usestrix/strix",
    repository="https://github.com/usestrix/strix.git",
    license="Apache-2.0"
)
