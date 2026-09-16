"""Scheduled automations for SMARAN.AI (Hermes Parity).

Allows users and agents to register recurring or one-shot scheduled tasks
defined in cron format or natural language (e.g. 'every 10 minutes',
'daily at 09:00', 'every Monday at 10:00').

Jobs run the SMARAN agent loop autonomously in the background, logging execution
records and routing results back to UI or connected gateways (Telegram, Discord, Webhooks).
"""

from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
import json
import logging
import os
from pathlib import Path
import re
import sqlite3
import time
from typing import Any, Dict, List, Optional
import uuid

logger = logging.getLogger("agent.scheduler")

_DEFAULT_DB_DIR = Path(os.path.expanduser("~")) / ".smaran"
_DEFAULT_DB_PATH = _DEFAULT_DB_DIR / "scheduler.db"


@dataclass
class ScheduledJob:
    id: str
    name: str
    schedule_expr: str  # Cron string or natural language
    task_prompt: str
    model: str = ""
    provider: str = ""
    workspace_root: str = ""
    target_channel: str = "ui"  # "ui", "telegram", "discord", "webhook"
    target_recipient: str = ""  # chat_id or webhook_url
    enabled: bool = True
    next_run_ts: float = 0.0
    last_run_ts: float = 0.0
    last_status: str = "pending"  # "pending", "running", "success", "error"
    last_result: str = ""
    created_at: float = 0.0


def _parse_schedule_to_next_ts(expr: str, after_ts: Optional[float] = None) -> float:
    """Parses a cron expression or natural language schedule into the next run epoch timestamp."""
    base_dt = datetime.fromtimestamp(after_ts or time.time())
    expr = expr.strip().lower()

    # 1. Natural Language matching
    # every X minutes
    m_min = re.match(r"^every\s+(\d+)\s+min(?:ute)?s?$", expr)
    if m_min:
        mins = int(m_min.group(1))
        return (base_dt + timedelta(minutes=mins)).timestamp()

    # every X hours
    m_hr = re.match(r"^every\s+(\d+)\s+hours?$", expr)
    if m_hr:
        hrs = int(m_hr.group(1))
        return (base_dt + timedelta(hours=hrs)).timestamp()

    # daily at HH:MM
    m_daily = re.match(r"^(?:daily|every day)\s+(?:at\s+)?(\d{1,2}):(\d{2})$", expr)
    if m_daily:
        h, m = int(m_daily.group(1)), int(m_daily.group(2))
        candidate = base_dt.replace(hour=h, minute=m, second=0, microsecond=0)
        if candidate <= base_dt:
            candidate += timedelta(days=1)
        return candidate.timestamp()

    # hourly
    if expr in ("hourly", "every hour"):
        candidate = (base_dt + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
        return candidate.timestamp()

    # daily
    if expr in ("daily", "every day"):
        candidate = (base_dt + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
        return candidate.timestamp()

    # 2. Standard 5-field cron parsing: minute hour day-of-month month day-of-week
    parts = expr.split()
    if len(parts) == 5:
        # Step forward minute by minute up to 30 days to find next match
        candidate = (base_dt + timedelta(minutes=1)).replace(second=0, microsecond=0)
        for _ in range(30 * 24 * 60):
            if _cron_match(candidate, parts):
                return candidate.timestamp()
            candidate += timedelta(minutes=1)

    # Fallback default: run in 1 hour
    return (base_dt + timedelta(hours=1)).timestamp()


def _cron_field_match(val: int, pattern: str) -> bool:
    if pattern == "*":
        return True
    if pattern.startswith("*/"):
        try:
            step = int(pattern[2:])
            return val % step == 0
        except ValueError:
            return False
    if "," in pattern:
        return any(_cron_field_match(val, p) for p in pattern.split(","))
    if "-" in pattern:
        try:
            low, high = map(int, pattern.split("-"))
            return low <= val <= high
        except ValueError:
            return False
    try:
        return val == int(pattern)
    except ValueError:
        return False


def _cron_match(dt: datetime, parts: List[str]) -> bool:
    # minute: 0-59
    if not _cron_field_match(dt.minute, parts[0]):
        return False
    # hour: 0-23
    if not _cron_field_match(dt.hour, parts[1]):
        return False
    # day of month: 1-31
    if not _cron_field_match(dt.day, parts[2]):
        return False
    # month: 1-12
    if not _cron_field_match(dt.month, parts[3]):
        return False
    # day of week: 0-6 (0=Sunday or 0=Monday; dt.weekday() is 0=Monday)
    dow = (dt.weekday() + 1) % 7  # 0=Sunday
    if not _cron_field_match(dow, parts[4]) and not _cron_field_match(dt.weekday(), parts[4]):
        return False
    return True


class SchedulerStore:
    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = db_path or _DEFAULT_DB_PATH
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=15)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        with self._get_conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    schedule_expr TEXT NOT NULL,
                    task_prompt TEXT NOT NULL,
                    model TEXT,
                    provider TEXT,
                    workspace_root TEXT,
                    target_channel TEXT,
                    target_recipient TEXT,
                    enabled INTEGER DEFAULT 1,
                    next_run_ts REAL,
                    last_run_ts REAL,
                    last_status TEXT,
                    last_result TEXT,
                    created_at REAL
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS job_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL,
                    run_ts REAL NOT NULL,
                    status TEXT NOT NULL,
                    result TEXT,
                    duration_sec REAL,
                    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
                )
            """)
            conn.commit()

    def add_job(self, name: str, schedule_expr: str, task_prompt: str,
                model: str = "", provider: str = "", workspace_root: str = "",
                target_channel: str = "ui", target_recipient: str = "") -> ScheduledJob:
        now = time.time()
        job_id = f"job_{uuid.uuid4().hex[:10]}"
        next_run = _parse_schedule_to_next_ts(schedule_expr, now)

        job = ScheduledJob(
            id=job_id,
            name=name,
            schedule_expr=schedule_expr,
            task_prompt=task_prompt,
            model=model,
            provider=provider,
            workspace_root=workspace_root,
            target_channel=target_channel,
            target_recipient=target_recipient,
            enabled=True,
            next_run_ts=next_run,
            last_run_ts=0.0,
            last_status="pending",
            last_result="",
            created_at=now,
        )

        with self._get_conn() as conn:
            conn.execute("""
                INSERT INTO jobs (
                    id, name, schedule_expr, task_prompt, model, provider,
                    workspace_root, target_channel, target_recipient, enabled,
                    next_run_ts, last_run_ts, last_status, last_result, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                job.id, job.name, job.schedule_expr, job.task_prompt,
                job.model, job.provider, job.workspace_root,
                job.target_channel, job.target_recipient, 1 if job.enabled else 0,
                job.next_run_ts, job.last_run_ts, job.last_status,
                job.last_result, job.created_at
            ))
            conn.commit()
        return job

    def list_jobs(self) -> List[ScheduledJob]:
        with self._get_conn() as conn:
            cur = conn.execute("SELECT * FROM jobs ORDER BY next_run_ts ASC")
            rows = cur.fetchall()
            jobs = []
            for r in rows:
                jobs.append(ScheduledJob(
                    id=r["id"],
                    name=r["name"],
                    schedule_expr=r["schedule_expr"],
                    task_prompt=r["task_prompt"],
                    model=r["model"] or "",
                    provider=r["provider"] or "",
                    workspace_root=r["workspace_root"] or "",
                    target_channel=r["target_channel"] or "ui",
                    target_recipient=r["target_recipient"] or "",
                    enabled=bool(r["enabled"]),
                    next_run_ts=r["next_run_ts"] or 0.0,
                    last_run_ts=r["last_run_ts"] or 0.0,
                    last_status=r["last_status"] or "pending",
                    last_result=r["last_result"] or "",
                    created_at=r["created_at"] or 0.0,
                ))
            return jobs

    def get_job(self, job_id: str) -> Optional[ScheduledJob]:
        with self._get_conn() as conn:
            cur = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
            r = cur.fetchone()
            if not r:
                return None
            return ScheduledJob(
                id=r["id"],
                name=r["name"],
                schedule_expr=r["schedule_expr"],
                task_prompt=r["task_prompt"],
                model=r["model"] or "",
                provider=r["provider"] or "",
                workspace_root=r["workspace_root"] or "",
                target_channel=r["target_channel"] or "ui",
                target_recipient=r["target_recipient"] or "",
                enabled=bool(r["enabled"]),
                next_run_ts=r["next_run_ts"] or 0.0,
                last_run_ts=r["last_run_ts"] or 0.0,
                last_status=r["last_status"] or "pending",
                last_result=r["last_result"] or "",
                created_at=r["created_at"] or 0.0,
            )

    def delete_job(self, job_id: str) -> bool:
        with self._get_conn() as conn:
            cur = conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
            conn.execute("DELETE FROM job_history WHERE job_id = ?", (job_id,))
            conn.commit()
            return cur.rowcount > 0

    def toggle_job(self, job_id: str, enabled: bool) -> bool:
        with self._get_conn() as conn:
            cur = conn.execute("UPDATE jobs SET enabled = ? WHERE id = ?", (1 if enabled else 0, job_id))
            conn.commit()
            return cur.rowcount > 0

    def record_run(self, job_id: str, status: str, result: str, duration_sec: float, next_ts: float):
        now = time.time()
        with self._get_conn() as conn:
            conn.execute("""
                UPDATE jobs
                SET last_run_ts = ?, last_status = ?, last_result = ?, next_run_ts = ?
                WHERE id = ?
            """, (now, status, result, next_ts, job_id))
            conn.execute("""
                INSERT INTO job_history (job_id, run_ts, status, result, duration_sec)
                VALUES (?, ?, ?, ?, ?)
            """, (job_id, now, status, result, duration_sec))
            conn.commit()

    def get_history(self, job_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        with self._get_conn() as conn:
            cur = conn.execute("""
                SELECT * FROM job_history WHERE job_id = ?
                ORDER BY run_ts DESC LIMIT ?
            """, (job_id, limit))
            return [dict(r) for r in cur.fetchall()]


class AutomationScheduler:
    """Async scheduler daemon that runs periodic checks and dispatches agent loops."""

    _instance: Optional[AutomationScheduler] = None

    @classmethod
    def get_instance(cls) -> AutomationScheduler:
        if cls._instance is None:
            cls._instance = AutomationScheduler()
        return cls._instance

    def __init__(self):
        self.store = SchedulerStore()
        self._running = False
        self._task: Optional[asyncio.Task] = None

    def start(self):
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("Automation scheduler started.")

    def stop(self):
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
        logger.info("Automation scheduler stopped.")

    async def _loop(self):
        while self._running:
            try:
                await self._check_and_run_due_jobs()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error(f"Scheduler tick failed: {exc}", exc_info=True)
            await asyncio.sleep(15)  # Check every 15s

    async def _check_and_run_due_jobs(self):
        now = time.time()
        jobs = self.store.list_jobs()
        for job in jobs:
            if not job.enabled:
                continue
            if job.next_run_ts > 0 and job.next_run_ts <= now:
                asyncio.create_task(self.run_job_now(job.id))

    async def run_job_now(self, job_id: str) -> Dict[str, Any]:
        job = self.store.get_job(job_id)
        if not job:
            return {"status": "error", "message": "Job not found"}

        start_time = time.time()
        logger.info(f"Running scheduled automation: '{job.name}' ({job.id})")

        output_messages = []
        status = "success"
        try:
            from app.agent import loop as agent_loop

            async for event in agent_loop.run(
                task=job.task_prompt,
                model=job.model,
                provider=job.provider,
                root=job.workspace_root
            ):
                if event.get("type") == "message":
                    output_messages.append(event.get("text", ""))
                elif event.get("type") == "error":
                    status = "error"
                    output_messages.append(f"Error: {event.get('message')}")

            final_output = "\n".join(output_messages).strip() or "Task completed with no text output."
        except Exception as exc:
            status = "error"
            final_output = f"Execution exception: {str(exc)}"
            logger.error(f"Scheduled job {job_id} failed: {exc}", exc_info=True)

        duration = time.time() - start_time
        next_ts = _parse_schedule_to_next_ts(job.schedule_expr, time.time())
        self.store.record_run(job.id, status, final_output, duration, next_ts)

        # Route result to gateway or webhook if configured
        if job.target_channel in ("telegram", "discord", "webhook"):
            await self._dispatch_to_channel(job, final_output)

        return {
            "status": status,
            "job_id": job.id,
            "output": final_output,
            "duration": duration,
            "next_run_ts": next_ts,
        }

    async def _dispatch_to_channel(self, job: ScheduledJob, text: str):
        try:
            header = f"⏰ **Scheduled Job Completed: {job.name}**\n\n"
            msg = header + text
            if job.target_channel == "telegram":
                from app.gateway.telegram_bot import TelegramGateway
                tg = TelegramGateway.get_instance()
                if tg and tg.is_running():
                    chat_id = job.target_recipient or tg.default_chat_id
                    if chat_id:
                        await tg.send_message(chat_id, msg)
            elif job.target_channel == "discord":
                from app.gateway.discord_bot import DiscordGateway
                dc = DiscordGateway.get_instance()
                if dc and dc.is_running():
                    channel_id = job.target_recipient or dc.default_channel_id
                    if channel_id:
                        await dc.send_message(channel_id, msg)
            elif job.target_channel == "webhook":
                import httpx
                if job.target_recipient:
                    async with httpx.AsyncClient(timeout=10.0) as client:
                        await client.post(job.target_recipient, json={
                            "job_id": job.id,
                            "job_name": job.name,
                            "status": job.last_status,
                            "output": text,
                            "timestamp": time.time(),
                        })
        except Exception as exc:
            logger.warning(f"Failed to dispatch scheduled job output to {job.target_channel}: {exc}")
