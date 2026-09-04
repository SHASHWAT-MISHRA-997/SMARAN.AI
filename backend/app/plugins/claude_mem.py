"""Memory that survives the process, because it is written to the database.

This plugin described itself as "persistent cross-session long-term episodic
memory" and kept everything in `self.observations`, a Python list on the
instance. It was neither persistent nor cross-session: closing the app lost
every observation, and the tool that reported "status: stored" had stored
nothing that would still be there in a minute.

The app already has real memory — a `user_memory` table that outlives
sessions, refreshes and history deletion. This now reads and writes that,
which is the only way the description on the tin becomes true.

Recall is keyword matching over stored facts, and it says so. Calling it
semantic when it is a substring search is the same class of claim as calling
a list persistent.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List

from app.plugin_system import ToolPlugin, PluginMetadata, PluginConfig, PluginType

logger = logging.getLogger("claude_mem_plugin")

# The memory belongs to a user, and on this machine that is the local one.
# Resolved per call rather than held, so it follows whoever is signed in.
LOCAL_USER = "local_default_user"


def _session():
    from app.database import SessionLocal
    return SessionLocal()


def _user_id(db) -> int:
    from app.models import User

    user = (db.query(User).filter(User.username == LOCAL_USER).first()
            or db.query(User).order_by(User.id).first())
    if not user:
        raise RuntimeError(
            "There is no user record yet, so there is nowhere to attach a "
            "memory. Use the app once and it will exist."
        )
    return user.id


#: Probed once. None means not yet asked.
_EMBEDDER_WORKS = None


def _real_embedder():
    """The embedding model, only if it can actually embed.

    app.rag.embeddings falls back to a hash-seeded random vector when no key
    is present. That preserves nothing about meaning, so searching with it
    would return noise while calling itself semantic. If the real one is not
    available this returns None and recall stays keyword-only and says so.
    """
    try:
        from app.rag.embeddings import OpenRouterFreeEmbeddings
        embedder = OpenRouterFreeEmbeddings()
        if not embedder.is_available():
            return None
        # is_available() only checks that a key exists. On this machine it
        # returns True and embed_query then returns nothing, so the key alone
        # is not evidence the model answers. Probed once, cached for the
        # process.
        global _EMBEDDER_WORKS
        if _EMBEDDER_WORKS is None:
            _EMBEDDER_WORKS = bool(embedder.embed_query("probe"))
        return embedder if _EMBEDDER_WORKS else None
    except Exception:
        return None


def _cosine(a, b) -> float:
    total = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    return (total / (na * nb)) if na and nb else 0.0


class ClaudeMemPlugin(ToolPlugin):
    """Records and recalls facts in the database the rest of the app uses."""

    async def initialize(self, app_context: Dict[str, Any]) -> bool:
        self._initialized = True
        return True

    async def shutdown(self) -> bool:
        self._initialized = False
        return True

    def get_tools(self) -> List[Dict]:
        return [
            {
                "name": "claudemem_record",
                "description": (
                    "Write a fact to long-term memory. Stored in the "
                    "user_memory table, so it survives restarts."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "observation": {"type": "string",
                                        "description": "The fact to remember."},
                        "category": {"type": "string",
                                     "description": "What part of the person it describes."},
                    },
                    "required": ["observation"],
                },
            },
            {
                "name": "claudemem_recall",
                "description": (
                    "Find stored facts. Uses keyword matching, and cosine "
                    "similarity too when a real embedding model is "
                    "reachable. Says which ran."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "limit": {"type": "integer"},
                    },
                    "required": ["query"],
                },
            },
            {
                "name": "claudemem_timeline",
                "description": "Stored facts in the order they were recorded.",
                "parameters": {
                    "type": "object",
                    "properties": {"limit": {"type": "integer"}},
                },
            },
        ]

    async def execute_tool(self, tool_name: str, arguments: Dict) -> Any:
        from app.models import UserMemory

        if tool_name == "claudemem_record":
            fact = (arguments.get("observation") or "").strip()
            if not fact:
                return {"error": "Nothing to remember - the observation was empty."}

            db = _session()
            try:
                uid = _user_id(db)
                # A fact already held is not written twice. Duplicates make
                # recall noisier and tell nobody anything new.
                existing = (db.query(UserMemory)
                            .filter(UserMemory.user_id == uid,
                                    UserMemory.fact == fact).first())
                if existing:
                    return {
                        "stored": False, "id": existing.id,
                        "note": "Already held, recorded %s." % existing.created_at,
                    }

                row = UserMemory(
                    user_id=uid, fact=fact,
                    category=(arguments.get("category") or "durable_record"),
                )
                db.add(row)
                db.commit()
                db.refresh(row)
                total = db.query(UserMemory).filter(UserMemory.user_id == uid).count()
                return {
                    "stored": True, "id": row.id,
                    "recorded_at": str(row.created_at),
                    "total_facts_held": total,
                    "note": "Written to user_memory; it survives a restart.",
                }
            except Exception as exc:
                db.rollback()
                return {"error": str(exc)[:200]}
            finally:
                db.close()

        if tool_name == "claudemem_recall":
            words = [w for w in (arguments.get("query") or "").lower().split() if w]
            limit = max(1, min(int(arguments.get("limit") or 8), 50))
            if not words:
                return {"error": "No query given."}

            db = _session()
            try:
                uid = _user_id(db)
                rows = (db.query(UserMemory)
                        .filter(UserMemory.user_id == uid)
                        .order_by(UserMemory.created_at.desc()).all())
                matches = []
                for row in rows:
                    haystack = "%s %s" % (row.fact.lower(), (row.category or "").lower())
                    hits = sum(1 for w in words if w in haystack)
                    if hits:
                        matches.append((hits, row))
                # Most words matched first: a fact containing two of the three
                # search words is a better answer than one containing one.
                matches.sort(key=lambda pair: -pair[0])

                # The real claude-mem searches with a vector database as well
                # as keywords. Here that runs only when an embedding model is
                # genuinely reachable - the hash fallback would score random
                # noise and call it meaning.
                embedder = _real_embedder()
                method = "keyword match over stored facts"
                if embedder and rows:
                    try:
                        q = embedder.embed_query(" ".join(words))
                        if q:
                            scored = []
                            for row in rows:
                                v = embedder.embed_query(row.fact)
                                if v:
                                    scored.append((_cosine(q, v), row))
                            if scored:
                                scored.sort(key=lambda pair: -pair[0])
                                # Anything the keywords already found keeps
                                # its place; semantic results fill in behind.
                                seen = {r.id for _, r in matches}
                                for score, row in scored:
                                    if score >= 0.35 and row.id not in seen:
                                        matches.append((0, row))
                                        seen.add(row.id)
                                method = ("hybrid: keyword match plus cosine "
                                          "similarity over real embeddings")
                    except Exception as exc:
                        logger.warning("semantic recall unavailable: %s", exc)

                return {
                    "query": " ".join(words),
                    "searched": len(rows),
                    "matched": len(matches),
                    "facts": [{
                        "id": r.id, "fact": r.fact, "category": r.category,
                        "recorded_at": str(r.created_at), "words_matched": n,
                    } for n, r in matches[:limit]],
                    "method": method,
                }
            except Exception as exc:
                return {"error": str(exc)[:200]}
            finally:
                db.close()

        if tool_name == "claudemem_timeline":
            limit = max(1, min(int(arguments.get("limit") or 20), 200))
            db = _session()
            try:
                uid = _user_id(db)
                rows = (db.query(UserMemory)
                        .filter(UserMemory.user_id == uid)
                        .order_by(UserMemory.created_at.desc())
                        .limit(limit).all())
                total = db.query(UserMemory).filter(UserMemory.user_id == uid).count()
                return {
                    "total_facts_held": total,
                    "showing": len(rows),
                    "facts": [{
                        "id": r.id, "fact": r.fact, "category": r.category,
                        "recorded_at": str(r.created_at),
                    } for r in rows],
                }
            except Exception as exc:
                return {"error": str(exc)[:200]}
            finally:
                db.close()

        raise ValueError("Unknown claude-mem tool: %s" % tool_name)


metadata = PluginMetadata(
    name="long-term-memory",
    version="2.0.0",
    description=(
        "Long-term memory in the user_memory table, so it survives restarts. "
        "Recall is keyword matching and says so."
    ),
    # Written for SMARAN.AI. The earlier metadata credited "TheDotMack" and
    # linked their repository; none of this is their code.
    author="SMARAN.AI",
    plugin_type=PluginType.TOOL,
    entry_point="claude_mem:ClaudeMemPlugin",
    dependencies=[],
    config_schema={},
    tags=["memory", "persistent", "recall"],
    license="MIT",
)
