"""Scanning code for the mistakes that actually get made.

The previous version was half real. It did run regular expressions over a
snippet, which is a genuine thing to do, and then spoiled it three ways.

It scored with `100 - findings * 20`, a scale nobody chose: five findings
came to zero and six to minus twenty, and a hardcoded password counted the
same as a missing rate limit. It used `re.search`, which stops at the first
match, so ten SQL injections were reported as one. And its endpoint "audit"
asked the caller whether the endpoint had authentication and then told them
what they had just said — a truth table over its own inputs, verifying
nothing.

What is here now reports what it found and where: every match, with a line
number and the line, counted by severity. There is no score, because a
number out of a hundred implies a measurement of security that a dozen
regular expressions cannot make. And the endpoint check reads this app's own
source to find routes that never mention a user dependency, which is a
question about the code rather than about the caller.

It is a linter. It finds patterns known to be dangerous; it does not prove
anything is safe, and it says so in its own output.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Dict, List

from app.plugin_system import ToolPlugin, PluginMetadata, PluginConfig, PluginType

logger = logging.getLogger("strix_security_plugin")

# Each pattern is here because it catches a mistake that is made in real code,
# and each carries why it matters rather than a bare label.
PATTERNS = [
    (r"""(?i)\b(api[_-]?key|secret|password|passwd|token)\s*=\s*['"][^'"\s]{8,}['"]""",
     "hardcoded-secret", "high",
     "A credential in source is in every copy of the repository and every "
     "backup. Read it from the environment."),

    (r"subprocess\.(?:run|call|Popen|check_output)\([^)]*shell\s*=\s*True",
     "shell-injection", "critical",
     "shell=True passes the string to a shell, so anything interpolated into "
     "it can add its own commands. Pass a list of arguments instead."),

    (r"""(?:execute|executemany)\s*\(\s*f['"]""",
     "sql-injection", "critical",
     "An f-string in a query puts the value into the SQL itself. Use a "
     "parameterised query so the driver keeps them apart."),

    (r"\beval\s*\(|\bexec\s*\(",
     "arbitrary-execution", "critical",
     "eval and exec run whatever they are given. If any part comes from "
     "input, that is remote code execution."),

    (r"dangerouslySetInnerHTML",
     "xss", "medium",
     "This inserts HTML without escaping. Anything user-supplied inside it "
     "can carry script."),

    (r"pickle\.loads?\s*\(",
     "unsafe-deserialisation", "high",
     "Unpickling executes code contained in the data. Only ever unpickle "
     "something you produced yourself."),

    (r"verify\s*=\s*False",
     "tls-verification-off", "high",
     "Disabling certificate verification makes the connection trivially "
     "interceptable."),

    (r"""(?i)\bhttp://(?!localhost|127\.0\.0\.1|0\.0\.0\.0)[a-z0-9.-]+""",
     "plaintext-http", "low",
     "Plain HTTP to a remote host is readable in transit. Only loopback is "
     "exempt here."),
]

SEVERITY_ORDER = ("critical", "high", "medium", "low")


def _scan_text(text: str, source: str = "") -> List[dict]:
    """Every match, with its line. Not just the first one."""
    findings: List[dict] = []
    lines = text.splitlines()
    for pattern, name, severity, why in PATTERNS:
        # finditer, not search: a file with ten of the same mistake has ten
        # of them, and reporting one was the old bug.
        for match in re.finditer(pattern, text):
            line_no = text.count("\n", 0, match.start()) + 1
            findings.append({
                "rule": name,
                "severity": severity,
                "line": line_no,
                "text": (lines[line_no - 1].strip()[:160] if line_no <= len(lines) else ""),
                "why": why,
                **({"file": source} if source else {}),
            })
    findings.sort(key=lambda f: (SEVERITY_ORDER.index(f["severity"]), f.get("file", ""), f["line"]))
    return findings


def _summary(findings: List[dict]) -> dict:
    counts = {s: sum(1 for f in findings if f["severity"] == s) for s in SEVERITY_ORDER}
    return {
        "total": len(findings),
        "by_severity": counts,
        # No score. A number out of a hundred would imply a measurement of
        # security, and a set of regular expressions cannot make one.
        "verdict": (
            "Nothing matched. That means these patterns did not fire, not "
            "that the code is safe."
            if not findings else
            "%d match%s. Each is a pattern known to be dangerous, not a "
            "proven vulnerability - read the line before acting."
            % (len(findings), "" if len(findings) == 1 else "es")
        ),
    }


class StrixSecurityPlugin(ToolPlugin):
    """A pattern linter that reports what it found and where."""

    async def initialize(self, app_context: Dict[str, Any]) -> bool:
        self._initialized = True
        return True

    async def shutdown(self) -> bool:
        self._initialized = False
        return True

    def get_tools(self) -> List[Dict]:
        return [
            {
                "name": "strix_scan_code",
                "description": (
                    "Scan a code snippet for dangerous patterns. Reports every "
                    "match with its line number. Finds patterns, not proof."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "code_snippet": {"type": "string",
                                         "description": "Source text to scan."},
                    },
                    "required": ["code_snippet"],
                },
            },
            {
                "name": "strix_scan_folder",
                "description": (
                    "Scan the currently open project folder. Requires a folder "
                    "to be open; reads only files inside it."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "max_files": {"type": "integer",
                                      "description": "Stop after this many files."},
                    },
                },
            },
            {
                "name": "strix_find_unguarded_routes",
                "description": (
                    "Read this app's own source and list HTTP routes whose "
                    "handler never mentions a user dependency."
                ),
                "parameters": {"type": "object", "properties": {}},
            },
        ]

    async def execute_tool(self, tool_name: str, arguments: Dict) -> Any:
        if tool_name == "strix_scan_code":
            findings = _scan_text(arguments.get("code_snippet", "") or "")
            return {"findings": findings, **_summary(findings)}

        if tool_name == "strix_scan_folder":
            from app.workspace.core import workspace

            if not workspace.root:
                return {"error": "No folder is open. Open one first; this "
                                 "reads only files inside it."}

            limit = int(arguments.get("max_files") or 400)
            findings: List[dict] = []
            scanned = 0
            for entry in workspace.tree()["entries"]:
                if scanned >= limit:
                    break
                if not entry["text"] or entry["size"] > 400_000:
                    continue
                try:
                    text = workspace.resolve(entry["path"]).read_text(
                        encoding="utf-8", errors="strict")
                except (OSError, UnicodeDecodeError):
                    continue
                scanned += 1
                findings.extend(_scan_text(text, entry["path"]))

            findings.sort(key=lambda f: (SEVERITY_ORDER.index(f["severity"]),
                                         f.get("file", ""), f["line"]))
            return {
                "root": str(workspace.root),
                "files_scanned": scanned,
                "findings": findings[:400],
                "truncated": len(findings) > 400,
                **_summary(findings),
            }

        if tool_name == "strix_find_unguarded_routes":
            # A real question about real code: which route handlers never
            # mention the dependency that supplies a user. Reported as
            # "worth checking", because a route can be public on purpose.
            source = Path(__file__).resolve().parents[1] / "main.py"
            try:
                text = source.read_text(encoding="utf-8", errors="replace")
            except OSError as exc:
                return {"error": "Could not read %s: %s" % (source, exc)}

            lines = text.splitlines()
            unguarded = []
            for i, line in enumerate(lines):
                m = re.match(r"\s*@app\.(get|post|put|delete|patch)\(\s*[\"']([^\"']+)", line)
                if not m:
                    continue
                # The handler is the block until the next decorator or a
                # top-level def, which is enough to see its signature.
                body = []
                for j in range(i + 1, min(i + 40, len(lines))):
                    if lines[j].startswith("@app.") or (j > i + 1 and lines[j].startswith("def ")):
                        break
                    body.append(lines[j])
                joined = "\n".join(body)
                if "current_user" not in joined and "get_current_user" not in joined:
                    unguarded.append({"method": m.group(1).upper(),
                                      "path": m.group(2), "line": i + 1})

            return {
                "source": str(source),
                "routes_without_a_user_dependency": unguarded,
                "count": len(unguarded),
                "note": (
                    "These handlers do not mention current_user. Some are "
                    "meant to be public - health, static, the update check. "
                    "This is a list to read, not a list of faults."
                ),
            }

        raise ValueError("Unknown STRIX tool: %s" % tool_name)


metadata = PluginMetadata(
    name="strix-security",
    version="2.0.0",
    description=(
        "A pattern linter for dangerous code. Reports every match with its "
        "line, counted by severity, and claims no more than that."
    ),
    # Written for SMARAN.AI. The earlier metadata credited "Strix Labs" and
    # linked their repository; none of this is their code.
    author="SMARAN.AI",
    plugin_type=PluginType.TOOL,
    entry_point="strix_security:StrixSecurityPlugin",
    dependencies=[],
    config_schema={},
    tags=["security", "linter", "static-analysis"],
    license="MIT",
)
