"""The owner's Git preferences, and the rules every agent git command obeys.

Settings -> SMARAN Code -> Git & Version Control offered a branch prefix, a
merge method and "create pull requests as drafts", and showed "Safe Git
Enforcement: Enforced". None of it was true: the values went into the
browser's storage, nothing on the agent's side ever read them, and
`git push --force` ran like any other command. This makes each one real, in
one place that both the git tool and run_command pass through - so the agent
cannot step around it by typing the same command into the shell.

  refused     force pushes (--force, -f, --force-with-lease, +refspec),
              deleting remote branches, history rewriting (filter-branch,
              filter-repo, reflog expire, update-ref -d), reset --hard
  rewritten   a new branch gets the prefix: `checkout -b login` becomes
              `checkout -b feat/login`
              a merge follows the method: squash -> --squash,
              merge -> --no-ff, rebase -> --ff-only (never a merge commit)
              `gh pr create` gains --draft when drafts are on
              `gh pr merge` gains --squash / --merge / --rebase
"""
from __future__ import annotations

import json
import os
import re
import shlex
import threading
from typing import Dict, List, Optional, Tuple

from app.config import settings

DEFAULTS = {"branch_prefix": "feat/", "merge_method": "squash", "draft_prs": False}
MERGE_METHODS = ("squash", "merge", "rebase")
_PREFIX = re.compile(r"^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*/?$")
_lock = threading.Lock()


class GitRefused(Exception):
    """A git command the owner's rules do not allow."""


def _path() -> str:
    return os.path.join(settings.DATA_DIR, "git_preferences.json")


def load() -> Dict:
    try:
        with open(_path(), encoding="utf-8") as fh:
            saved = json.load(fh)
    except (OSError, ValueError):
        saved = {}
    prefs = dict(DEFAULTS)
    prefs.update({k: v for k, v in saved.items() if k in DEFAULTS})
    return prefs


def validate(update: Dict) -> Dict:
    prefs = load()
    if "branch_prefix" in update:
        prefix = str(update["branch_prefix"] or "").strip()
        if prefix and (len(prefix) > 40 or not _PREFIX.match(prefix) or ".." in prefix):
            raise ValueError("A branch prefix uses letters, numbers, . _ - and /, like feat/ or smaran/.")
        prefs["branch_prefix"] = prefix
    if "merge_method" in update:
        if update["merge_method"] not in MERGE_METHODS:
            raise ValueError("Merge method is squash, merge or rebase.")
        prefs["merge_method"] = update["merge_method"]
    if "draft_prs" in update:
        prefs["draft_prs"] = bool(update["draft_prs"])
    return prefs


def save(update: Dict) -> Dict:
    prefs = validate(update)
    with _lock:
        os.makedirs(os.path.dirname(_path()), exist_ok=True)
        tmp = _path() + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(prefs, fh, indent=2)
        os.replace(tmp, _path())
    return prefs


def describe(prefs: Optional[Dict] = None) -> str:
    """The rules, as the agent is told them."""
    p = prefs or load()
    lines = [
        "Git rules set by the owner (enforced - a command that breaks them is refused):",
        f"- New branches are named {p['branch_prefix'] or ''}<short-topic>." if p["branch_prefix"]
        else "- Name new branches after their topic.",
        {"squash": "- Merge by squashing into one clean commit.",
         "merge": "- Merge with a merge commit (--no-ff), keeping every commit.",
         "rebase": "- Integrate by rebasing; merges must be fast-forward only."}[p["merge_method"]],
        "- Pull requests are opened as drafts." if p["draft_prs"] else "- Pull requests are opened ready for review.",
        "- Never force-push, delete remote branches, rewrite history or reset --hard.",
    ]
    return "\n".join(lines)


_SPLIT = re.compile(r"(\s*(?:&&|\|\||;|\|)\s*)")


def _words(segment: str) -> List[str]:
    try:
        return shlex.split(segment, posix=True)
    except ValueError:
        return segment.split()


def _join(words: List[str]) -> str:
    out = []
    for w in words:
        out.append(w if re.fullmatch(r"[\w./:=@%+,-]+", w) else '"' + w.replace('"', '\\"') + '"')
    return " ".join(out)


def _git_args(words: List[str]) -> Tuple[List[str], List[str]]:
    """Split `git -C dir -c k=v sub ...` into (prefix options, subcommand onwards)."""
    i = 1
    while i < len(words) and words[i].startswith("-"):
        i += 2 if words[i] in ("-C", "-c", "--git-dir", "--work-tree") else 1
    return words[:i], words[i:]


def _apply_git(words: List[str], prefs: Dict) -> List[str]:
    head, args = _git_args(words)
    if not args:
        return words
    sub, rest = args[0], args[1:]
    lowered = [a.lower() for a in rest]

    if sub == "push":
        if any(a in ("--force", "-f", "--force-with-lease", "--force-if-includes", "--mirror")
               or a.startswith("--force-with-lease=") or (a.startswith("-") and not a.startswith("--") and "f" in a[1:])
               for a in lowered):
            raise GitRefused("Force-pushing is blocked by Safe Git. Push normally, or pull and merge first.")
        if "--delete" in lowered or "-d" in lowered or any(a.startswith(":") for a in rest if not a.startswith("-")):
            raise GitRefused("Deleting a remote branch is blocked by Safe Git.")
        if any(a.startswith("+") for a in rest if not a.startswith("-")):
            raise GitRefused("A +refspec is a force-push, blocked by Safe Git.")
    if sub in ("filter-branch", "filter-repo"):
        raise GitRefused(f"git {sub} rewrites history and is blocked by Safe Git.")
    if sub == "reflog" and rest[:1] == ["expire"]:
        raise GitRefused("Expiring the reflog destroys recovery points and is blocked by Safe Git.")
    if sub == "update-ref" and "-d" in rest:
        raise GitRefused("Deleting refs directly is blocked by Safe Git.")
    if sub == "reset" and "--hard" in lowered:
        raise GitRefused("git reset --hard throws away work and is blocked by Safe Git. "
                         "Use git stash, or create a snapshot and restore it.")

    prefix = prefs.get("branch_prefix") or ""
    if prefix and not prefix.endswith("/") and not prefix.endswith("-"):
        prefix += "/"

    def prefixed(name: str) -> str:
        return name if not prefix or name.startswith(prefix) else prefix + name

    if prefix and sub in ("checkout", "switch"):
        flag = next((i for i, a in enumerate(rest) if a in ("-b", "-B", "-c", "-C", "--create")), None)
        if flag is not None and flag + 1 < len(rest):
            rest = rest[:flag + 1] + [prefixed(rest[flag + 1])] + rest[flag + 2:]
    if prefix and sub == "branch":
        positional = [i for i, a in enumerate(rest) if not a.startswith("-")]
        creating = not any(a in ("-d", "-D", "--delete", "-m", "-M", "--move", "-l", "--list", "-a", "-r",
                                 "--show-current", "-v", "-vv", "--contains", "--merged", "-u",
                                 "--set-upstream-to", "--unset-upstream") for a in rest)
        if creating and positional:
            i = positional[0]
            rest = rest[:i] + [prefixed(rest[i])] + rest[i + 1:]

    if sub == "merge" and rest and not any(a in ("--abort", "--continue", "--quit") for a in rest):
        method = prefs.get("merge_method", "squash")
        flags = {"squash": "--squash", "merge": "--no-ff", "rebase": "--ff-only"}
        conflicting = {"--squash", "--no-ff", "--ff-only", "--ff", "--no-squash"}
        rest = [flags[method]] + [a for a in rest if a not in conflicting]

    return head + [sub] + rest


def _apply_gh(words: List[str], prefs: Dict) -> List[str]:
    if len(words) < 3 or words[1] != "pr":
        return words
    action, rest = words[2], words[3:]
    if action == "create" and prefs.get("draft_prs") and "--draft" not in rest and "-d" not in rest:
        rest = rest + ["--draft"]
    if action == "merge":
        chosen = {"squash": "--squash", "merge": "--merge", "rebase": "--rebase"}[prefs.get("merge_method", "squash")]
        rest = [a for a in rest if a not in ("--squash", "--merge", "--rebase", "-s", "-m", "-r")] + [chosen]
        if "--admin" in rest:
            raise GitRefused("Merging past branch protection (--admin) is blocked by Safe Git.")
    return words[:3] + rest


def apply(command: str, prefs: Optional[Dict] = None) -> str:
    """The command as the owner's rules allow it, or GitRefused.

    Every git and gh segment of a shell line is checked - `npm test && git
    push -f` is refused as surely as `git push -f` alone.
    """
    prefs = prefs or load()
    parts = _SPLIT.split(command)
    changed = False
    for i in range(0, len(parts), 2):
        segment = parts[i]
        words = _words(segment)
        if not words:
            continue
        exe = os.path.basename(words[0]).lower().removesuffix(".exe")
        if exe == "git":
            new = _apply_git(words, prefs)
        elif exe == "gh":
            new = _apply_gh(words, prefs)
        else:
            continue
        if new != words:
            parts[i] = _join(new)
            changed = True
    return "".join(parts) if changed else command
