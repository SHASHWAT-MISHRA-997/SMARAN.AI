"""Cross-session memory with full-text search and learning nudges.

Hermes' defining feature is its learning loop: it remembers what worked,
searches its own past, and builds a model of who the user is. This module
brings that to SMARAN.AI.

The memory store is a separate SQLite database (not the main chat DB) with
FTS5 indexing, so searches across thousands of past interactions complete in
milliseconds rather than scanning every row with LIKE.

Three capabilities:

1. **Search memory** — the agent can search its own past conversations and
   retrieved context across sessions, finding relevant prior work.

2. **Nudge to persist** — after complex multi-step work, the system asks the
   agent whether anything is worth remembering, and saves the answer.

3. **User model** — an evolving understanding of the user's preferences,
   tools, coding style, and frequently used patterns.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("agent.memory")

# Default location alongside the main data directory
_DEFAULT_MEMORY_DB = os.path.join(
    os.getenv("DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "data")),
    "agent_memory.db",
)

# How many entries to keep before pruning old ones
MAX_MEMORIES = 50_000
NUDGE_STEP_THRESHOLD = 5  # nudge after tasks that took >= this many steps


class AgentMemory:
    """Persistent, searchable memory across agent sessions."""

    def __init__(self, db_path: str = ""):
        self.db_path = db_path or _DEFAULT_MEMORY_DB
        self._conn: Optional[sqlite3.Connection] = None
        self._ensure_db()

    # ── Database lifecycle ──────────────────────────────────────────────

    def _ensure_db(self):
        """Create the database and FTS5 tables if they don't exist."""
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.executescript("""
            CREATE TABLE IF NOT EXISTS memories (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                category   TEXT NOT NULL DEFAULT 'general',
                content    TEXT NOT NULL,
                metadata   TEXT DEFAULT '{}',
                created_at REAL NOT NULL,
                importance INTEGER DEFAULT 0
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
                content, category,
                content=memories,
                content_rowid=id,
                tokenize='porter unicode61'
            );

            -- Triggers to keep FTS in sync
            CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
                INSERT INTO memories_fts(rowid, content, category)
                VALUES (new.id, new.content, new.category);
            END;

            CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
                INSERT INTO memories_fts(memories_fts, rowid, content, category)
                VALUES ('delete', old.id, old.content, old.category);
            END;

            CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
                INSERT INTO memories_fts(memories_fts, rowid, content, category)
                VALUES ('delete', old.id, old.content, old.category);
                INSERT INTO memories_fts(rowid, content, category)
                VALUES (new.id, new.content, new.category);
            END;

            -- User model table: evolving understanding of the user
            CREATE TABLE IF NOT EXISTS user_model (
                key        TEXT PRIMARY KEY,
                value      TEXT NOT NULL,
                confidence REAL DEFAULT 0.5,
                updated_at REAL NOT NULL
            );

            -- Skills learned by the agent
            CREATE TABLE IF NOT EXISTS learned_skills (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT NOT NULL UNIQUE,
                description TEXT NOT NULL,
                steps       TEXT NOT NULL DEFAULT '[]',
                triggers    TEXT NOT NULL DEFAULT '[]',
                usage_count INTEGER DEFAULT 0,
                last_used   REAL,
                created_at  REAL NOT NULL
            );
        """)
        self._conn.commit()

    def close(self):
        if self._conn:
            self._conn.close()
            self._conn = None

    # ── Store and search memories ───────────────────────────────────────

    def store(self, content: str, category: str = "general",
              metadata: Optional[Dict] = None, importance: int = 0) -> int:
        """Store a memory entry. Returns the memory ID."""
        if not content or not content.strip():
            return -1
        cur = self._conn.execute(
            "INSERT INTO memories (category, content, metadata, created_at, importance) "
            "VALUES (?, ?, ?, ?, ?)",
            (category, content.strip(), json.dumps(metadata or {}),
             time.time(), importance),
        )
        self._conn.commit()
        self._maybe_prune()
        logger.info("Stored memory #%d [%s] (%d chars)", cur.lastrowid, category, len(content))
        return cur.lastrowid

    def save_learning(self, session_id: str, content: str, category: str = "general") -> int:
        """Store a learning with session tracking."""
        return self.store(content, category=category, metadata={"session_id": session_id})

    def search(self, query: str, limit: int = 10,
               category: Optional[str] = None) -> List[Dict[str, Any]]:
        """Full-text search across all memories. Returns ranked results."""
        if not query or not query.strip():
            return []

        # FTS5 match query — escape special characters
        fts_query = " ".join(
            word for word in query.strip().split()
            if len(word) >= 2
        )
        if not fts_query:
            return []

        try:
            sql = """
                SELECT m.id, m.category, m.content, m.metadata,
                       m.created_at, m.importance,
                       rank
                FROM memories_fts fts
                JOIN memories m ON m.id = fts.rowid
                WHERE memories_fts MATCH ?
            """
            params: list = [fts_query]
            if category:
                sql += " AND m.category = ?"
                params.append(category)
            sql += " ORDER BY rank LIMIT ?"
            params.append(limit)

            rows = self._conn.execute(sql, params).fetchall()
        except sqlite3.OperationalError:
            # FTS query syntax error — fall back to LIKE
            like_pattern = f"%{query.strip()}%"
            sql = """
                SELECT id, category, content, metadata, created_at, importance, 0
                FROM memories WHERE content LIKE ?
            """
            params = [like_pattern]
            if category:
                sql += " AND category = ?"
                params.append(category)
            sql += " ORDER BY created_at DESC LIMIT ?"
            params.append(limit)
            rows = self._conn.execute(sql, params).fetchall()

        results = []
        for row in rows:
            try:
                meta = json.loads(row[3]) if row[3] else {}
            except (json.JSONDecodeError, TypeError):
                meta = {}
            results.append({
                "id": row[0],
                "category": row[1],
                "content": row[2][:2000],  # Limit content size
                "metadata": meta,
                "created_at": row[4],
                "importance": row[5],
                "relevance_rank": row[6],
            })
        return results

    def get_recent(self, limit: int = 20, category: Optional[str] = None) -> List[Dict]:
        """Get the most recent memories."""
        sql = "SELECT id, category, content, metadata, created_at, importance FROM memories"
        params: list = []
        if category:
            sql += " WHERE category = ?"
            params.append(category)
        sql += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)

        rows = self._conn.execute(sql, params).fetchall()
        return [
            {"id": r[0], "category": r[1], "content": r[2][:2000],
             "metadata": json.loads(r[3] or "{}"), "created_at": r[4], "importance": r[5]}
            for r in rows
        ]

    def _maybe_prune(self):
        """Remove oldest low-importance memories if over the limit."""
        count = self._conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0]
        if count > MAX_MEMORIES:
            excess = count - MAX_MEMORIES
            self._conn.execute(
                "DELETE FROM memories WHERE id IN ("
                "  SELECT id FROM memories ORDER BY importance ASC, created_at ASC LIMIT ?"
                ")", (excess,))
            self._conn.commit()

    # ── User model ──────────────────────────────────────────────────────

    def update_user_model(self, key: str, value: str, confidence: float = 0.5):
        """Update a facet of the user model."""
        self._conn.execute(
            "INSERT INTO user_model (key, value, confidence, updated_at) "
            "VALUES (?, ?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value, "
            "confidence=excluded.confidence, updated_at=excluded.updated_at",
            (key, value, min(1.0, max(0.0, confidence)), time.time()),
        )
        self._conn.commit()

    def get_user_model(self) -> Dict[str, Any]:
        """Get the current user model as a dictionary."""
        rows = self._conn.execute(
            "SELECT key, value, confidence FROM user_model "
            "ORDER BY confidence DESC"
        ).fetchall()
        return {r[0]: {"value": r[1], "confidence": r[2]} for r in rows}

    def get_user_model_prompt(self) -> str:
        """Format the user model as context for the agent's system prompt."""
        model = self.get_user_model()
        if not model:
            return ""
        lines = ["What I know about this user:"]
        for key, info in model.items():
            lines.append(f"- {key}: {info['value']}")
        return "\n".join(lines)

    # ── Learned skills ──────────────────────────────────────────────────

    def save_skill(self, name: str, description: str,
                   steps: List[str], triggers: List[str]) -> int:
        """Save a learned skill. Returns skill ID."""
        cur = self._conn.execute(
            "INSERT INTO learned_skills (name, description, steps, triggers, created_at) "
            "VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(name) DO UPDATE SET description=excluded.description, "
            "steps=excluded.steps, triggers=excluded.triggers",
            (name, description, json.dumps(steps), json.dumps(triggers), time.time()),
        )
        self._conn.commit()
        return cur.lastrowid

    def get_skills(self) -> List[Dict]:
        """Get all learned skills."""
        rows = self._conn.execute(
            "SELECT id, name, description, steps, triggers, usage_count, last_used, created_at "
            "FROM learned_skills ORDER BY usage_count DESC"
        ).fetchall()
        return [
            {"id": r[0], "name": r[1], "description": r[2],
             "steps": json.loads(r[3] or "[]"), "triggers": json.loads(r[4] or "[]"),
             "usage_count": r[5], "last_used": r[6], "created_at": r[7]}
            for r in rows
        ]

    def record_skill_usage(self, name: str):
        """Increment usage count for a skill."""
        self._conn.execute(
            "UPDATE learned_skills SET usage_count = usage_count + 1, "
            "last_used = ? WHERE name = ?",
            (time.time(), name),
        )
        self._conn.commit()

    def find_matching_skills(self, query: str) -> List[Dict]:
        """Find skills whose triggers match the query."""
        all_skills = self.get_skills()
        matched = []
        query_lower = query.lower()
        for skill in all_skills:
            triggers = skill.get("triggers", [])
            if any(trigger.lower() in query_lower for trigger in triggers):
                matched.append(skill)
        return matched

    # ── Nudge system ────────────────────────────────────────────────────

    def should_nudge(self, steps_taken: int, tools_used: List[str]) -> bool:
        """Decide whether to nudge the agent to persist learnings."""
        if steps_taken < NUDGE_STEP_THRESHOLD:
            return False
        # Nudge if agent did significant work
        mutating_tools = {"write_file", "edit_file", "run_command", "git"}
        mutations = sum(1 for t in tools_used if t in mutating_tools)
        return mutations >= 3

    def generate_nudge_prompt(self, task_summary: str,
                              tools_used: List[str]) -> str:
        """Generate the nudge prompt that asks the agent what to remember."""
        return (
            f"\n\n---\n"
            f"LEARNING NUDGE: You just completed a significant task "
            f"({len(tools_used)} tool calls). Before moving on:\n\n"
            f"1. Is there anything about this user's preferences or workflow "
            f"worth remembering for next time? If so, call save_memory.\n"
            f"2. Was this task complex enough to extract a reusable skill? "
            f"If so, call create_skill with clear steps.\n"
            f"3. Did you learn anything about the user (preferred language, "
            f"coding style, tools they use)? If so, call update_user_model.\n\n"
            f"Task summary: {task_summary}\n"
            f"Tools used: {', '.join(tools_used)}"
        )


# Global instance — initialized lazily
_instance: Optional[AgentMemory] = None


def get_memory() -> AgentMemory:
    """Get or create the global AgentMemory instance."""
    global _instance
    if _instance is None:
        _instance = AgentMemory()
    return _instance
