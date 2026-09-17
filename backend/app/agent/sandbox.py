"""Command filters, timeouts, and file checkpoints for agent execution.

Strict mode restricts the environment and PATH. It is not an OS-level
filesystem or network isolation boundary. Checkpoints restore captured files;
new files are retained.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

logger = logging.getLogger("agent.sandbox")


class SandboxMode(str, Enum):
    """How restrictive the sandbox is."""
    OFF = "off"              # No sandboxing — commands run directly
    PERMISSIVE = "permissive"  # Timeout + output capture, no filesystem isolation
    STRICT = "strict"        # Restricted environment and PATH, not OS isolation


@dataclass
class SandboxConfig:
    """Configuration for a sandbox instance."""
    mode: SandboxMode = SandboxMode.PERMISSIVE
    timeout_seconds: int = 120
    max_output_bytes: int = 100_000
    allowed_hosts: List[str] = field(default_factory=lambda: [
        "127.0.0.1", "localhost", "github.com", "pypi.org",
        "npmjs.org", "registry.npmjs.org",
    ])
    restricted_commands: Set[str] = field(default_factory=lambda: {
        "format", "del /s", "rm -rf /", "shutdown", "reboot",
        "reg delete", "diskpart", "cipher /w",
    })
    allowed_path_dirs: List[str] = field(default_factory=lambda: [
        r"C:\Windows\System32",
        r"C:\Program Files\Git\cmd",
        r"C:\Program Files\nodejs",
    ])


@dataclass
class Snapshot:
    """A checkpoint of workspace state."""
    id: str
    workspace_root: str
    created_at: float
    file_checksums: Dict[str, str]
    description: str = ""


class CommandResult:
    """Result from a sandboxed command execution."""

    def __init__(self, returncode: int, stdout: str, stderr: str,
                 timed_out: bool = False, blocked: bool = False,
                 block_reason: str = ""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr
        self.timed_out = timed_out
        self.blocked = blocked
        self.block_reason = block_reason

    @property
    def output(self) -> str:
        combined = (self.stdout or "") + (self.stderr or "")
        return combined.strip() or "(no output)"

    def to_agent_string(self) -> str:
        """Format as the string the agent sees."""
        if self.blocked:
            return f"BLOCKED: {self.block_reason}"
        if self.timed_out:
            return (f"The command was still running after the timeout "
                    f"and was stopped.\n{self.output[:2000]}")
        return f"exit code {self.returncode}\n{self.output}"


class Sandbox:
    """Manages sandboxed command execution with NemoClaw-style protections."""

    def __init__(self, config: Optional[SandboxConfig] = None):
        self.config = config or SandboxConfig()
        self._snapshots: Dict[str, Snapshot] = {}
        self._snapshot_dir = os.path.join(
            os.getenv("DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "data")),
            "sandbox_snapshots",
        )
        os.makedirs(self._snapshot_dir, exist_ok=True)

    # ── Command execution ───────────────────────────────────────────────

    def run(self, command: str, cwd: str, env: Optional[Dict] = None) -> CommandResult:
        """Run a command inside the sandbox."""
        if self.config.mode == SandboxMode.OFF:
            return self._run_direct(command, cwd, env)

        # Check for blocked commands
        block_reason = self._check_command(command)
        if block_reason:
            logger.warning("Sandbox blocked command: %s — %s", command[:80], block_reason)
            return CommandResult(
                returncode=-1, stdout="", stderr="",
                blocked=True, block_reason=block_reason,
            )

        if self.config.mode == SandboxMode.PERMISSIVE:
            return self._run_permissive(command, cwd, env)

        return self._run_strict(command, cwd, env)

    def run_command(self, command: str, cwd: str, env: Optional[Dict] = None) -> CommandResult:
        """Alias for run to maintain compatibility with tools."""
        return self.run(command, cwd, env)

    def _check_command(self, command: str) -> str:
        """Check if a command is blocked. Returns reason or empty string."""
        cmd_lower = command.lower().strip()
        for restricted in self.config.restricted_commands:
            if restricted.lower() in cmd_lower:
                return (f"Command contains restricted pattern '{restricted}'. "
                        f"This is blocked for safety.")

        # Block attempts to modify system directories
        system_paths = [r"c:\windows", r"c:\program files", "/etc/", "/usr/"]
        for sys_path in system_paths:
            if sys_path.lower() in cmd_lower and any(
                    w in cmd_lower for w in ("del ", "rm ", "rmdir", "move ", "mv ")):
                return f"Modifying system path {sys_path} is not allowed."

        return ""

    def _run_direct(self, command: str, cwd: str,
                    env: Optional[Dict]) -> CommandResult:
        """Run without any sandboxing."""
        try:
            result = subprocess.run(
                command, shell=True, cwd=cwd, capture_output=True,
                text=True, timeout=self.config.timeout_seconds, env=env,
            )
            return CommandResult(
                returncode=result.returncode,
                stdout=result.stdout[:self.config.max_output_bytes],
                stderr=result.stderr[:self.config.max_output_bytes],
            )
        except subprocess.TimeoutExpired:
            return CommandResult(0, "", "", timed_out=True)
        except OSError as exc:
            return CommandResult(-1, "", str(exc))

    def _run_permissive(self, command: str, cwd: str,
                        env: Optional[Dict]) -> CommandResult:
        """Run with timeout and output limits but no filesystem isolation."""
        run_env = dict(os.environ)
        if env:
            run_env.update(env)

        try:
            result = subprocess.run(
                command, shell=True, cwd=cwd, capture_output=True,
                text=True, timeout=self.config.timeout_seconds,
                env=run_env,
            )
            return CommandResult(
                returncode=result.returncode,
                stdout=result.stdout[:self.config.max_output_bytes],
                stderr=result.stderr[:self.config.max_output_bytes],
            )
        except subprocess.TimeoutExpired:
            return CommandResult(0, "", "", timed_out=True)
        except OSError as exc:
            return CommandResult(-1, "", str(exc))

    def _run_strict(self, command: str, cwd: str,
                    env: Optional[Dict]) -> CommandResult:
        """Run with full sandboxing: restricted PATH, env isolation."""
        run_env = {}

        # Minimal environment — only essentials
        for key in ("SystemRoot", "TEMP", "TMP", "USERPROFILE", "HOME",
                     "APPDATA", "LOCALAPPDATA", "COMPUTERNAME"):
            if key in os.environ:
                run_env[key] = os.environ[key]

        # Restricted PATH — only allowed directories
        existing_path = os.environ.get("PATH", "")
        restricted_path_dirs = []
        for allowed in self.config.allowed_path_dirs:
            if os.path.isdir(allowed):
                restricted_path_dirs.append(allowed)
        # Also include the workspace's node_modules/.bin etc.
        local_bin = os.path.join(cwd, "node_modules", ".bin")
        if os.path.isdir(local_bin):
            restricted_path_dirs.append(local_bin)
        # Python and pip need to work
        python_dir = os.path.dirname(sys.executable)
        restricted_path_dirs.append(python_dir)
        scripts_dir = os.path.join(python_dir, "Scripts")
        if os.path.isdir(scripts_dir):
            restricted_path_dirs.append(scripts_dir)

        run_env["PATH"] = os.pathsep.join(restricted_path_dirs)

        # Apply user overrides
        if env:
            run_env.update(env)

        try:
            # On Windows, use CREATE_NO_WINDOW to prevent popups
            kwargs: Dict[str, Any] = {
                "shell": True, "cwd": cwd, "capture_output": True,
                "text": True, "timeout": self.config.timeout_seconds,
                "env": run_env,
            }
            if sys.platform == "win32":
                kwargs["creationflags"] = (
                    subprocess.CREATE_NO_WINDOW  # type: ignore[attr-defined]
                )

            result = subprocess.run(command, **kwargs)
            return CommandResult(
                returncode=result.returncode,
                stdout=result.stdout[:self.config.max_output_bytes],
                stderr=result.stderr[:self.config.max_output_bytes],
            )
        except subprocess.TimeoutExpired:
            return CommandResult(0, "", "", timed_out=True)
        except OSError as exc:
            return CommandResult(-1, "", str(exc))

    # ── Snapshots ───────────────────────────────────────────────────────

    def create_snapshot(self, workspace_root: str,
                        description: str = "") -> Snapshot:
        """Checkpoint the workspace state for later rollback."""
        snap_id = f"snap_{uuid.uuid4().hex[:8]}"
        checksums: Dict[str, str] = {}

        if not workspace_root.strip() or not Path(workspace_root).is_dir():
            raise ValueError("Select an existing workspace directory")
        root = Path(workspace_root).resolve()
        workspace_root = str(root)
        skip = {".git", "node_modules", "__pycache__", ".venv", "dist", ".next"}

        snap_dir = os.path.join(self._snapshot_dir, snap_id)
        os.makedirs(snap_dir, exist_ok=True)
        snapshot_base = Path(self._snapshot_dir).resolve()
        for directory, dirs, files in os.walk(root, followlinks=False):
            parent = Path(directory)
            dirs[:] = [d for d in dirs if d not in skip
                       and not (parent / d).is_symlink()
                       and not (parent / d).is_junction()
                       and (parent / d).resolve() != snapshot_base]
            for name in files:
                src = parent / name
                if src.is_symlink() or name == '_snapshot_meta.json':
                    continue
                relpath = str(src.relative_to(root))
                dst = Path(snap_dir) / relpath
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)
                with dst.open('rb') as stream:
                    checksums[relpath] = hashlib.file_digest(stream, 'sha256').hexdigest()

        snapshot = Snapshot(
            id=snap_id,
            workspace_root=workspace_root,
            created_at=time.time(),
            file_checksums=checksums,
            description=description,
        )
        self._snapshots[snap_id] = snapshot

        # Save metadata
        meta_path = os.path.join(snap_dir, "_snapshot_meta.json")
        with open(meta_path, "w") as f:
            json.dump({
                "id": snap_id,
                "workspace_root": workspace_root,
                "created_at": snapshot.created_at,
                "description": description,
                "file_count": len(checksums),
            }, f, indent=2)

        logger.info("Created snapshot %s (%d files) for %s",
                     snap_id, len(checksums), workspace_root)
        return snapshot

    def restore_snapshot(self, snap_id: str, target_dir: str = "") -> Dict[str, Any]:
        """Restore workspace to a snapshot state."""
        if not re.fullmatch(r"snap_[0-9a-f]{8}", snap_id):
            return {"success": False, "error": "Invalid snapshot ID"}
        snapshot = self._snapshots.get(snap_id)
        if not snapshot:
            # Try loading from disk
            snap_dir = os.path.join(self._snapshot_dir, snap_id)
            meta_path = os.path.join(snap_dir, "_snapshot_meta.json")
            if not os.path.exists(meta_path):
                return {"success": False, "error": f"Snapshot {snap_id} not found"}
            with open(meta_path) as f:
                meta = json.load(f)
            snapshot = Snapshot(
                id=meta["id"],
                workspace_root=meta["workspace_root"],
                created_at=meta["created_at"],
                file_checksums={},
                description=meta.get("description", ""),
            )

        snap_dir = os.path.join(self._snapshot_dir, snap_id)
        root = Path(target_dir or snapshot.workspace_root).resolve()
        restored = 0
        errors = []

        for relpath in Path(snap_dir).rglob("*"):
            if relpath.is_dir() or relpath.name == "_snapshot_meta.json":
                continue
            rel = relpath.relative_to(snap_dir)
            dst = root / rel
            try:
                if relpath.is_symlink() or not dst.resolve().is_relative_to(root):
                    raise ValueError("Snapshot path escapes workspace")
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(str(relpath), str(dst))
                restored += 1
            except (OSError, ValueError) as exc:
                errors.append(f"{rel}: {exc}")

        logger.info("Restored snapshot %s: %d files restored, %d errors",
                     snap_id, restored, len(errors))
        return {
            "success": len(errors) == 0,
            "restored": restored,
            "errors": errors[:10],
        }

    def list_snapshots(self) -> List[Dict[str, Any]]:
        """List all available snapshots."""
        snapshots = []
        if not os.path.isdir(self._snapshot_dir):
            return snapshots
        for name in sorted(os.listdir(self._snapshot_dir)):
            meta_path = os.path.join(self._snapshot_dir, name, "_snapshot_meta.json")
            if os.path.exists(meta_path):
                try:
                    with open(meta_path) as f:
                        snapshots.append(json.load(f))
                except (OSError, json.JSONDecodeError):
                    continue
        return snapshots

    def delete_snapshot(self, snap_id: str) -> bool:
        """Delete a snapshot and its stored files."""
        if not re.fullmatch(r"snap_[0-9a-f]{8}", snap_id):
            return False
        snap_dir = os.path.join(self._snapshot_dir, snap_id)
        if os.path.isdir(snap_dir):
            shutil.rmtree(snap_dir, ignore_errors=True)
            self._snapshots.pop(snap_id, None)
            return True
        return False

    # ── Network policy ──────────────────────────────────────────────────

    def is_host_allowed(self, host: str) -> bool:
        """Check if outbound connections to a host are allowed."""
        if self.config.mode != SandboxMode.STRICT:
            return True
        return host.lower() in [h.lower() for h in self.config.allowed_hosts]

    def allow_host(self, host: str):
        """Add a host to the allowed list."""
        if host not in self.config.allowed_hosts:
            self.config.allowed_hosts.append(host)
            logger.info("Added %s to sandbox network whitelist", host)


# Global sandbox instance
_sandbox: Optional[Sandbox] = None


def get_sandbox() -> Sandbox:
    """Get or create the global Sandbox instance."""
    global _sandbox
    if _sandbox is None:
        # Read mode from environment
        mode_str = os.getenv("SMARAN_SANDBOX_MODE", "permissive").lower()
        try:
            mode = SandboxMode(mode_str)
        except ValueError:
            mode = SandboxMode.PERMISSIVE
        _sandbox = Sandbox(SandboxConfig(mode=mode))
    return _sandbox
