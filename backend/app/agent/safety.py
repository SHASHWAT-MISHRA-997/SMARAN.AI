"""What the coding agent may do on its own, and what it must ask about.

Three modes, chosen by the owner:

  manual   every change asks: writing or editing a file, running a command,
           git, restoring a snapshot.
  smart    reading never asks; editing files inside the open folder runs (each
           edit is checkpointed, so "Undo this run" puts it back); commands run
           when every part of them is on the known-safe list - tests, builds,
           linters, listing, git status/diff/log/add/commit - or matches the
           owner's allowlist; anything else asks.
  off      nothing asks.

In every mode, commands that destroy things beyond the project - wiping a
drive, formatting, deleting system folders, fork bombs, registry deletion,
shutdown - are refused outright. That list is deliberately short and
unambiguous; everything merely risky goes to "ask" in smart mode.

Deterministic on purpose. Hermes Agent's smart mode asks a second model to
judge each command; here the same command always gets the same answer, costs
nothing, and works with a local model and no network.

Also here: masking secrets before tool output reaches the model, so an API
key in a .env file or a command's output is not sent to a cloud provider.
"""
from __future__ import annotations

import json
import os
import re
import shlex
import threading
from typing import Dict, List, Optional

from app.config import settings

MODES = ("manual", "smart", "off")
DEFAULTS = {"approval_mode": "smart", "allowlist": [], "redact_secrets": True}
_lock = threading.Lock()

READ_ONLY = {"list_files", "read_file", "search", "search_memory"}
FILE_CHANGES = {"write_file", "edit_file"}

#: Files whose change should always be seen by a person, even in smart mode.
_SENSITIVE_PATH = re.compile(
    r"(^|[\\/])\.git([\\/]|$)"                      # anything inside .git
    r"|(^|[\\/])(\.env(\.[\w.-]+)?|id_rsa|id_ed25519|.*\.pem|.*\.key|"
    r"credentials(\.json)?|secrets?\.(json|ya?ml|toml)|\.npmrc|\.pypirc)$", re.I)

#: Never, in any mode.
_REFUSE = [
    (re.compile(r"\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)[a-z]*\s+(/|~|\$HOME|/\*|[a-z]:[\\/]?)(\s|$)", re.I),
     "deletes a whole drive or home folder"),
    (re.compile(r"\b(del|erase)\b[^|&;]*\s/s\b[^|&;]*\b[a-z]:\\?(\s|$|\*)", re.I), "deletes a drive's contents"),
    (re.compile(r"\b(rd|rmdir)\b[^|&;]*\s/s\b[^|&;]*\b[a-z]:\\?(\s|$)", re.I), "deletes a drive's contents"),
    (re.compile(r"\bformat(\.com)?\s+[a-z]:", re.I), "formats a drive"),
    (re.compile(r"\b(diskpart|mkfs(\.\w+)?|fdisk|cipher\s+/w)\b", re.I), "rewrites a disk"),
    (re.compile(r"\bdd\b[^|&;]*\bof=/dev/", re.I), "writes raw to a device"),
    (re.compile(r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:"), "fork bomb"),
    (re.compile(r"\b(shutdown|reboot|poweroff|halt)\b|\bstop-computer\b|\brestart-computer\b", re.I),
     "shuts the computer down"),
    (re.compile(r"\breg(\.exe)?\s+delete\s+hk(lm|ey_local_machine)", re.I), "deletes system registry keys"),
    (re.compile(r"\b(rm|del|rd|rmdir|remove-item)\b[^|&;]*(c:\\windows|c:\\program files|/etc/|/usr/|/bin/|/boot/)",
                re.I), "deletes system files"),
    (re.compile(r"\bvssadmin\b[^|&;]*\bdelete\b|\bbcdedit\b", re.I), "changes system recovery or boot"),
]

#: A command whose every part starts like one of these runs without asking in smart mode.
_SAFE_PREFIXES = [
    "pytest", "python -m pytest", "py -m pytest", "python3 -m pytest", "python -m unittest",
    "npm test", "npm run test", "npm run build", "npm run lint", "npm run typecheck", "npm run check",
    "npm ls", "npm run -s test", "npx vitest", "npx jest", "npx tsc", "npx eslint", "npx prettier --check",
    "yarn test", "yarn build", "yarn lint", "pnpm test", "pnpm build", "pnpm lint",
    "cargo test", "cargo build", "cargo check", "cargo clippy", "cargo fmt --check",
    "go test", "go build", "go vet", "gofmt -l",
    "mvn test", "mvn -q test", "gradle test", "./gradlew test", "gradlew test", "dotnet test", "dotnet build",
    "ruff check", "flake8", "mypy", "black --check", "eslint", "tsc",
    "ls", "dir", "pwd", "cat", "type", "head", "tail", "wc", "echo", "tree", "find", "grep", "rg", "findstr",
    "where", "which", "python --version", "python -V", "node -v", "node --version", "npm -v", "pip list",
    "pip show", "pip --version", "git --version",
    "git status", "git diff", "git log", "git show", "git branch", "git rev-parse", "git remote -v",
    "git add", "git commit", "git stash list", "git ls-files", "git blame",
]

_SPLIT = re.compile(r"\s*(?:&&|\|\||;|\|)\s*")
_OUTPUT_REDIRECT = re.compile(r"(^|[^2&])>{1,2}\s*\S")


def _path() -> str:
    return os.path.join(settings.DATA_DIR, "agent_safety.json")


def load() -> Dict:
    try:
        with open(_path(), encoding="utf-8") as fh:
            saved = json.load(fh)
    except (OSError, ValueError):
        saved = {}
    prefs = dict(DEFAULTS)
    prefs.update({k: v for k, v in saved.items() if k in DEFAULTS})
    return prefs


def save(update: Dict) -> Dict:
    prefs = load()
    if "approval_mode" in update:
        if update["approval_mode"] not in MODES:
            raise ValueError("Approval mode is manual, smart or off.")
        prefs["approval_mode"] = update["approval_mode"]
    if "allowlist" in update:
        items = [str(x).strip() for x in (update["allowlist"] or []) if str(x).strip()]
        if len(items) > 50 or any(len(x) > 120 for x in items):
            raise ValueError("Up to 50 allowed commands, each under 120 characters.")
        if any(refusal(x) for x in items):
            raise ValueError("An allowed command matches something that is always refused.")
        prefs["allowlist"] = items
    if "redact_secrets" in update:
        prefs["redact_secrets"] = bool(update["redact_secrets"])
    with _lock:
        os.makedirs(os.path.dirname(_path()), exist_ok=True)
        tmp = _path() + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(prefs, fh, indent=2)
        os.replace(tmp, _path())
    return prefs


def refusal(command: str) -> Optional[str]:
    """Why this command is never run, or None."""
    for pattern, why in _REFUSE:
        if pattern.search(command or ""):
            return why
    return None


def _normal(segment: str) -> str:
    try:
        words = shlex.split(segment, posix=True)
    except ValueError:
        words = segment.split()
    return " ".join(words).lower()


def _starts_with(text: str, prefix: str) -> bool:
    return text == prefix or text.startswith(prefix + " ")


def command_is_safe(command: str, allowlist: List[str]) -> bool:
    """Every part of the command is a known-safe or owner-allowed one, and nothing is written by redirection."""
    if _OUTPUT_REDIRECT.search(command or ""):
        return False
    segments = [s for s in _SPLIT.split(command or "") if s.strip()]
    if not segments:
        return False
    allowed = [_normal(a) for a in allowlist] + _SAFE_PREFIXES
    for segment in segments:
        text = _normal(segment)
        if text.startswith("git push") or text.startswith("git branch -d") or text.startswith("git branch -D".lower()):
            return False
        if not any(_starts_with(text, prefix) for prefix in allowed):
            return False
    return True


def decide(name: str, arguments: Dict, mode: Optional[str] = None,
           allowlist: Optional[List[str]] = None) -> Dict[str, str]:
    """{'verdict': 'allow'|'ask'|'refuse', 'reason': ...} for one tool call."""
    prefs = load() if mode is None or allowlist is None else {}
    mode = mode or prefs.get("approval_mode", "smart")
    allowlist = allowlist if allowlist is not None else prefs.get("allowlist", [])
    command = ""
    if name == "run_command":
        command = str(arguments.get("command", ""))
    elif name == "git":
        command = "git " + str(arguments.get("subcommand", ""))
    why = refusal(command) if command else None
    if why:
        return {"verdict": "refuse", "reason": "Refused in every mode: this %s." % why}
    if name in READ_ONLY:
        return {"verdict": "allow", "reason": "Reading changes nothing."}
    if mode == "off":
        return {"verdict": "allow", "reason": "Approval is off."}
    if mode == "manual":
        return {"verdict": "ask", "reason": "Manual approval: every change is shown first."}
    # smart
    if name in FILE_CHANGES:
        path = str(arguments.get("path", ""))
        if _SENSITIVE_PATH.search(path):
            return {"verdict": "ask", "reason": "%s may hold secrets or settings." % path}
        return {"verdict": "allow", "reason": "A file edit inside the folder; checkpointed, so it can be undone."}
    if command:
        if command_is_safe(command, allowlist):
            return {"verdict": "allow", "reason": "A known-safe command."}
        return {"verdict": "ask", "reason": "Not on the known-safe list."}
    return {"verdict": "ask", "reason": "This changes things outside a single file."}


# ---------------------------------------------------------------------------
# Secrets
# ---------------------------------------------------------------------------

_SECRETS = [
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.S),
    re.compile(r"\bsk-ant-[A-Za-z0-9_-]{20,}"),
    re.compile(r"\bsk-(proj-)?[A-Za-z0-9_-]{20,}"),
    re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"),
    re.compile(r"\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{40,}\b"),
    re.compile(r"\bhf_[A-Za-z0-9]{30,}\b"),
    re.compile(r"\bgsk_[A-Za-z0-9]{30,}\b"),
    re.compile(r"\bcsk-[A-Za-z0-9]{30,}\b"),
    re.compile(r"\br8_[A-Za-z0-9]{30,}\b"),
    re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
    re.compile(r"\brzp_(live|test)_[A-Za-z0-9]{10,}\b"),
]
_ASSIGNED = re.compile(
    r"(?im)^(\s*(?:export\s+)?[\w.-]*(?:api[_-]?key|secret|token|password|passwd|private[_-]?key|client[_-]?secret)"
    r"[\w.-]*\s*[:=]\s*[\"']?)([^\s\"'#]{6,})")


def redact(text: str) -> str:
    """The text with secrets replaced by [REDACTED]."""
    if not text:
        return text
    out = _ASSIGNED.sub(lambda m: m.group(1) + "[REDACTED]", text)
    for pattern in _SECRETS:
        out = pattern.sub("[REDACTED]", out)
    return out
