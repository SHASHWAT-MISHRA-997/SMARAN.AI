"""The folder, and what may be done inside it.

Point the app at a directory and it can read what is there and propose changes
to it. Nothing is written when a change is proposed: a proposal produces a
diff and an id, and the file on disk only moves when someone approves that id.
That is the whole shape of it, and it is deliberate — an assistant that edits
first and reports afterwards leaves you reading a diff of something that has
already happened.

The security boundary is the root. Every path is resolved before it is used
and must still be inside the root afterwards, which is what stops `../` and a
symlink pointing out of the tree. Resolution has to come first: checking the
string before resolving it is the classic way to get this wrong, because
`root/link/../../etc` looks fine as text.

Everything here is synchronous and file-backed. There is no database and no
daemon; the pending changes live in memory for the life of the process, and
an unapproved change that is never approved simply never happens.
"""

from __future__ import annotations

import difflib
import hashlib
import logging
import os
import subprocess
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger("workspace")

# A tree listing is for orientation, not for reading a whole repository into a
# prompt. Beyond this the listing says it was truncated rather than quietly
# stopping, so nobody believes they have seen everything.
MAX_TREE_ENTRIES = 2000

# Reading a file into a reply has to stop somewhere. 400 KB is well past any
# source file and short of the point where a single read fills the context.
MAX_READ_BYTES = 400_000

# Directories that are never worth walking: they are large, generated, and
# nothing in them is what someone means by "my project".
SKIP_DIRS = {
    ".git", ".hg", ".svn", "node_modules", "__pycache__", ".venv", "venv",
    "env", "dist", "build", ".next", ".nuxt", "target", ".gradle", ".idea",
    ".mypy_cache", ".pytest_cache", ".ruff_cache", ".tox", "site-packages",
    ".terraform", "vendor", "Pods", ".cache",
}

# Extensions that are text as far as this is concerned. Anything else is
# reported with its size and not read, rather than decoded into mojibake.
TEXT_SUFFIXES = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json", ".yaml",
    ".yml", ".toml", ".ini", ".cfg", ".conf", ".env", ".md", ".markdown",
    ".txt", ".rst", ".html", ".htm", ".css", ".scss", ".sass", ".less",
    ".sql", ".sh", ".bash", ".zsh", ".ps1", ".bat", ".java", ".kt", ".go",
    ".rs", ".c", ".h", ".cpp", ".hpp", ".cs", ".rb", ".php", ".swift", ".m",
    ".r", ".jl", ".lua", ".vue", ".svelte", ".graphql", ".proto", ".xml",
    ".gitignore", ".dockerignore", ".editorconfig", "",
}


class WorkspaceError(RuntimeError):
    """A failure worth showing the user in the words it happened in."""


@dataclass
class PendingChange:
    """A change that has been described but not made."""
    id: str
    kind: str                 # "write" | "create" | "delete"
    path: str                 # relative to the root, for display
    absolute: str
    diff: str
    new_text: Optional[str]
    #: Hash of the file when the change was proposed. If the file moves
    #: underneath us before approval, applying it would silently discard
    #: whatever happened in between, so it is refused instead.
    base_digest: Optional[str]
    created_at: float = field(default_factory=time.time)
    summary: str = ""

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "path": self.path,
            "diff": self.diff,
            "summary": self.summary,
            "created_at": self.created_at,
            "lines_added": sum(
                1 for l in self.diff.splitlines()
                if l.startswith("+") and not l.startswith("+++")
            ),
            "lines_removed": sum(
                1 for l in self.diff.splitlines()
                if l.startswith("-") and not l.startswith("---")
            ),
        }


class Workspace:
    """One open folder and the changes waiting on it."""

    def __init__(self) -> None:
        self.root: Optional[Path] = None
        self._pending: Dict[str, PendingChange] = {}
        self._applied: List[dict] = []

    # ── opening ────────────────────────────────────────────────────────

    def open(self, folder: str) -> dict:
        """Point at a folder. Reads nothing yet; just establishes the root."""
        if not (folder or "").strip():
            raise WorkspaceError("No folder was given.")

        try:
            path = Path(folder).expanduser().resolve(strict=True)
        except FileNotFoundError:
            raise WorkspaceError("There is no folder at %s." % folder)
        except OSError as exc:
            raise WorkspaceError("Could not open %s: %s" % (folder, exc))

        if not path.is_dir():
            raise WorkspaceError("%s is a file, not a folder." % path)

        # Refusing the obvious mistakes. Handing an assistant a whole drive or
        # a home directory is almost never what someone means, and the cost of
        # being wrong there is high enough to be worth a sentence.
        if path.parent == path:
            raise WorkspaceError(
                "That is the root of a drive. Choose the project folder itself."
            )
        if path == Path.home().resolve():
            raise WorkspaceError(
                "That is your home folder, which holds everything. Choose the "
                "project inside it."
            )

        self.root = path
        self._pending.clear()
        logger.info("workspace opened at %s", path)
        return self.describe()

    def close(self) -> None:
        self.root = None
        self._pending.clear()

    def describe(self) -> dict:
        if not self.root:
            return {"open": False, "root": None, "pending": [], "git": None}
        return {
            "open": True,
            "root": str(self.root),
            "name": self.root.name,
            "pending": [c.as_dict() for c in self._pending.values()],
            "applied_count": len(self._applied),
            "git": self._git_status(),
        }

    def _git_status(self) -> Optional[dict]:
        """Read the selected folder's real Git context without changing it."""
        if not self.root:
            return None
        try:
            def git(*args: str) -> str:
                return subprocess.check_output(
                    ["git", "-C", str(self.root), *args],
                    stderr=subprocess.DEVNULL, text=True, timeout=2,
                ).strip()
            if git("rev-parse", "--is-inside-work-tree") != "true":
                return None
            branch = git("rev-parse", "--abbrev-ref", "HEAD")
            git_dir = Path(git("rev-parse", "--git-dir")).resolve()
            common_dir = Path(git("rev-parse", "--git-common-dir")).resolve()
            return {"branch": branch if branch != "HEAD" else "detached HEAD", "worktree": git_dir != common_dir}
        except (OSError, subprocess.SubprocessError):
            return None

    # ── path safety ────────────────────────────────────────────────────

    def resolve(self, relative: str) -> Path:
        """A path inside the root, or an error.

        Resolved first, checked second. Checking the text before resolving is
        how `root/link/../../etc/passwd` gets through: as a string it starts
        with the root, and only resolution reveals where it lands.
        """
        if not self.root:
            raise WorkspaceError("No folder is open.")

        candidate = (self.root / relative).expanduser()
        try:
            resolved = candidate.resolve()
        except OSError as exc:
            raise WorkspaceError("Could not resolve %s: %s" % (relative, exc))

        try:
            resolved.relative_to(self.root)
        except ValueError:
            raise WorkspaceError(
                "%s is outside the open folder. Only files under %s can be "
                "read or changed." % (relative, self.root)
            )
        return resolved

    def _relative(self, path: Path) -> str:
        return path.relative_to(self.root).as_posix()

    # ── browsing for a folder ──────────────────────────────────────────

    @staticmethod
    def browse(path: Optional[str] = None) -> dict:
        """Directories at `path`, for a picker built in the interface.

        Deliberately not a native dialog. pywebview's would work in the
        desktop window and nowhere else, and the same app runs in a browser
        and on a phone over the pairing link. This is one endpoint that
        serves all three.

        This is the one place that looks outside any root, because choosing
        the root is the point. It lists directory names only - no file
        contents, no sizes - so it cannot be used to read anything.
        """
        user_profile = Path(os.environ.get("USERPROFILE", ""))
        if path:
            here = Path(path).expanduser()
        else:
            # The profile root can be non-enumerable on Windows. Open an
            # ordinary user-visible directory instead of Path.home().
            candidates = [
                user_profile / "Desktop",
                Path.cwd(),
                user_profile / "Documents",
            ]
            here = next((candidate for candidate in candidates if candidate.is_dir()), Path.cwd())

        try:
            here = here.resolve(strict=True)
        except (FileNotFoundError, OSError):
            raise WorkspaceError("There is no folder at %s." % (path or here))
        if not here.is_dir():
            raise WorkspaceError("%s is not a folder." % here)

        children = []
        try:
            for entry in sorted(here.iterdir(), key=lambda e: e.name.lower()):
                if not entry.is_dir():
                    continue
                if entry.name.startswith(".") or entry.name in SKIP_DIRS:
                    continue
                children.append({"name": entry.name, "path": str(entry)})
        except PermissionError:
            raise WorkspaceError(
                "Windows will not let this app list %s." % here
            )

        return {
            "path": str(here),
            "parent": None if here.parent == here else str(here.parent),
            "folders": children,
            # Somewhere to start rather than the filesystem root.
            "shortcuts": [
                {"name": n, "path": str(p)} for n, p in (
                    ("Desktop", user_profile / "Desktop"),
                    ("Documents", user_profile / "Documents"),
                    ("Downloads", user_profile / "Downloads"),
                    ("SMARAN.AI", Path.cwd().parent if Path.cwd().name == "backend" else Path.cwd()),
                ) if p.is_dir()
            ],
        }

    # ── reading ────────────────────────────────────────────────────────

    def tree(self, limit: int = MAX_TREE_ENTRIES) -> dict:
        """Every file worth showing, relative to the root."""
        if not self.root:
            raise WorkspaceError("No folder is open.")

        entries: List[dict] = []
        truncated = False

        for base, dirs, names in os.walk(self.root):
            # Pruned in place so os.walk does not descend into them at all.
            dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS
                             and not d.startswith("."))
            for name in sorted(names):
                if len(entries) >= limit:
                    truncated = True
                    break
                full = Path(base) / name
                try:
                    size = full.stat().st_size
                except OSError:
                    continue
                entries.append({
                    "path": self._relative(full),
                    "size": size,
                    "text": full.suffix.lower() in TEXT_SUFFIXES,
                })
            if truncated:
                break

        return {
            "root": str(self.root),
            "entries": entries,
            "count": len(entries),
            "truncated": truncated,
            "note": (
                "Listing stopped at %d entries; there are more." % limit
                if truncated else ""
            ),
            "skipped_directories": sorted(SKIP_DIRS),
        }

    def read(self, relative: str) -> dict:
        path = self.resolve(relative)
        if not path.exists():
            raise WorkspaceError("%s does not exist." % relative)
        if path.is_dir():
            raise WorkspaceError("%s is a folder, not a file." % relative)

        size = path.stat().st_size
        if size > MAX_READ_BYTES:
            raise WorkspaceError(
                "%s is %.1f MB and the limit for reading is %.1f MB."
                % (relative, size / 1e6, MAX_READ_BYTES / 1e6)
            )

        raw = path.read_bytes()
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            raise WorkspaceError(
                "%s is not UTF-8 text. Binary files are not read." % relative
            )

        return {
            "path": self._relative(path),
            "text": text,
            "bytes": size,
            "lines": text.count("\n") + 1,
            "digest": _digest(raw),
        }

    # ── proposing ──────────────────────────────────────────────────────

    def propose_write(self, relative: str, new_text: str,
                      summary: str = "") -> dict:
        """Describe a change without making it. Returns the diff and an id."""
        path = self.resolve(relative)

        if path.is_dir():
            raise WorkspaceError("%s is a folder." % relative)

        existed = path.exists()
        if existed:
            raw = path.read_bytes()
            try:
                old_text = raw.decode("utf-8")
            except UnicodeDecodeError:
                raise WorkspaceError(
                    "%s is not UTF-8 text, so a diff cannot be shown and it "
                    "will not be overwritten blind." % relative
                )
            base_digest = _digest(raw)
        else:
            old_text, base_digest = "", None

        if existed and old_text == new_text:
            raise WorkspaceError(
                "%s already contains exactly that; there is nothing to change."
                % relative
            )

        diff = "".join(difflib.unified_diff(
            old_text.splitlines(keepends=True),
            new_text.splitlines(keepends=True),
            fromfile="a/%s" % self._relative(path) if existed else "/dev/null",
            tofile="b/%s" % self._relative(path),
            n=3,
        ))

        change = PendingChange(
            id=uuid.uuid4().hex[:12],
            kind="write" if existed else "create",
            path=self._relative(path),
            absolute=str(path),
            diff=diff,
            new_text=new_text,
            base_digest=base_digest,
            summary=summary,
        )
        self._pending[change.id] = change
        return change.as_dict()

    def propose_delete(self, relative: str, summary: str = "") -> dict:
        path = self.resolve(relative)
        if not path.exists():
            raise WorkspaceError("%s does not exist." % relative)
        if path.is_dir():
            raise WorkspaceError(
                "%s is a folder. Deleting a folder is not offered here; "
                "delete the files you mean." % relative
            )

        raw = path.read_bytes()
        try:
            old_text = raw.decode("utf-8")
        except UnicodeDecodeError:
            old_text = "<binary file, %d bytes>\n" % len(raw)

        diff = "".join(difflib.unified_diff(
            old_text.splitlines(keepends=True), [],
            fromfile="a/%s" % self._relative(path), tofile="/dev/null", n=3,
        ))

        change = PendingChange(
            id=uuid.uuid4().hex[:12], kind="delete",
            path=self._relative(path), absolute=str(path), diff=diff,
            new_text=None, base_digest=_digest(raw), summary=summary,
        )
        self._pending[change.id] = change
        return change.as_dict()

    # ── approving ──────────────────────────────────────────────────────

    def apply(self, change_id: str) -> dict:
        """Carry out a change that was approved. This is the only writer."""
        change = self._pending.get(change_id)
        if not change:
            raise WorkspaceError(
                "No pending change with id %s. It may already have been "
                "applied or rejected." % change_id
            )

        path = Path(change.absolute)
        # Re-checked at the moment of writing, not only when proposed. The
        # root could have been closed or changed in between.
        self.resolve(change.path)

        # The file must still be what the diff was made against. Without this
        # an edit approved five minutes ago would silently overwrite whatever
        # happened since.
        if change.base_digest is not None:
            if not path.exists():
                raise WorkspaceError(
                    "%s no longer exists, so this change cannot be applied to "
                    "it." % change.path
                )
            if _digest(path.read_bytes()) != change.base_digest:
                del self._pending[change_id]
                raise WorkspaceError(
                    "%s changed on disk after this was proposed, so applying "
                    "it would discard that. The change has been dropped; ask "
                    "again against the current file." % change.path
                )
        elif path.exists():
            raise WorkspaceError(
                "%s was going to be created but already exists now." % change.path
            )

        if change.kind == "delete":
            path.unlink()
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            # Written whole, then moved into place, so an interrupted write
            # cannot leave a half-file where a working one was.
            temp = path.with_name(path.name + ".smaran-tmp")
            temp.write_text(change.new_text, encoding="utf-8", newline="")
            os.replace(temp, path)

        del self._pending[change_id]
        record = {
            "id": change.id, "kind": change.kind, "path": change.path,
            "at": time.time(), "summary": change.summary,
        }
        self._applied.append(record)
        logger.info("workspace applied %s to %s", change.kind, change.path)
        return record

    def reject(self, change_id: str) -> dict:
        change = self._pending.pop(change_id, None)
        if not change:
            raise WorkspaceError("No pending change with id %s." % change_id)
        return {"id": change_id, "path": change.path, "rejected": True}

    def pending(self) -> List[dict]:
        return [c.as_dict() for c in self._pending.values()]

    def history(self) -> List[dict]:
        return list(self._applied)


def _digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


#: One workspace per running app, which is what "the folder I opened" means.
workspace = Workspace()
