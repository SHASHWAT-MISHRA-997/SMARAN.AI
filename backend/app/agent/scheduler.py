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


_DAYS = {"sunday": 0, "monday": 1, "tuesday": 2, "wednesday": 3, "thursday": 4, "friday": 5, "saturday": 6,
         "sun": 0, "mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6}
_WEEKLY = re.compile(r"^(?:every\s+)?(weekdays|weekends|[a-z]+?)s?\s+at\s+(\d{1,2}):(\d{2})$")


def _weekly_as_cron(expr: str) -> str:
    """'every monday at 09:00', 'weekdays at 08:30' -> the same schedule as cron.

    Weekly schedules are what a weekly review or a workday reminder needs, and
    the parser only knew intervals, daily times and raw cron.
    """
    match = _WEEKLY.match(expr)
    if not match:
        return expr
    word, hour, minute = match.group(1), int(match.group(2)), int(match.group(3))
    if hour > 23 or minute > 59:
        return expr
    days = {"weekdays": "1-5", "weekends": "0,6"}.get(word)
    if days is None:
        if word not in _DAYS:
            return expr
        days = str(_DAYS[word])
    return "%d %d * * %s" % (minute, hour, days)


def _parse_schedule_to_next_ts(expr: str, after_ts: Optional[float] = None) -> float:
    """Parses a cron expression or natural language schedule into the next run epoch timestamp."""
    base_dt = datetime.fromtimestamp(time.time() if after_ts is None else after_ts)
    expr = _weekly_as_cron(expr.strip().lower())

    # 1. Natural Language matching
    # every X minutes
    m_min = re.match(r"^every\s+(\d+)\s+min(?:ute)?s?$", expr)
    if m_min:
        mins = int(m_min.group(1))
        if not 1 <= mins <= 525600:
            raise ValueError("Minute interval must be between 1 and 525600")
        return (base_dt + timedelta(minutes=mins)).timestamp()

    # every X hours
    m_hr = re.match(r"^every\s+(\d+)\s+hours?$", expr)
    if m_hr:
        hrs = int(m_hr.group(1))
        if not 1 <= hrs <= 8760:
            raise ValueError("Hour interval must be between 1 and 8760")
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
        candidate = base_dt.replace(hour=9, minute=0, second=0, microsecond=0)
        if candidate <= base_dt:
            candidate += timedelta(days=1)
        return candidate.timestamp()

    # 2. Standard 5-field cron parsing: minute hour day-of-month month day-of-week
    parts = expr.split()
    if len(parts) == 5:
        fields = [_cron_values(p, lo, hi) for p, (lo, hi) in zip(
            parts, [(0, 59), (0, 23), (1, 31), (1, 12), (0, 7)])]
        minutes, hours, days, months, weekdays = fields
        weekdays = {v % 7 for v in weekdays}
        day = base_dt.replace(hour=0, minute=0, second=0, microsecond=0)
        # Search days, not every minute; eight years includes the leap-year gap.
        for _ in range(366 * 8):
            dom = day.day in days
            dow = (day.weekday() + 1) % 7 in weekdays
            matches_day = (dom and dow) if (parts[2].startswith('*') or parts[4].startswith('*')) else (dom or dow)
            if day.month in months and matches_day:
                for hour in sorted(hours):
                    for minute in sorted(minutes):
                        candidate = day.replace(hour=hour, minute=minute)
                        if candidate > base_dt:
                            return candidate.timestamp()
            day += timedelta(days=1)
        raise ValueError("Schedule has no occurrence in the next eight years")

    raise ValueError("Use every N minutes/hours, daily at HH:MM, or a five-field cron schedule")


def _cron_values(pattern: str, minimum: int, maximum: int) -> set[int]:
    values = set()
    try:
        for part in pattern.split(','):
            base, separator, step_text = part.partition('/')
            step = int(step_text) if separator else 1
            if step <= 0:
                raise ValueError
            if base == '*':
                low, high = minimum, maximum
            elif '-' in base:
                low, high = map(int, base.split('-'))
            else:
                low = int(base)
                high = maximum if separator else low
            if not minimum <= low <= high <= maximum:
                raise ValueError
            values.update(range(low, high + 1, step))
    except ValueError as exc:
        raise ValueError(f"Invalid cron field: {pattern}") from exc
    return values


def _cron_field_match(val: int, pattern: str) -> bool:
    if pattern == "*":
        return True
    if pattern.startswith("*/"):
        try:
            step = int(pattern[2:])
            return step > 0 and val % step == 0
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
    if not _cron_field_match(dow, parts[4]) and not (dow == 0 and _cron_field_match(7, parts[4])):
        return False
    return True


_NEEDS_WEB = re.compile(
    r"\b(search|news|headline|latest|today|current|price|weather|stock|score|update|trend|release|web)\b", re.I)

RESEARCH_SYSTEM = (
    "You write short, accurate briefings for one person. Use ONLY the search results given - never invent "
    "facts, names, numbers or links. Name the source for each point. If the results do not answer the "
    "request, say so plainly. Reply with the briefing itself, no preamble."
)


async def research_answer(prompt: str, model: str = "", provider: str = "") -> str:
    """A job that needs no project: search the web if it asks for anything current, then answer once.

    The coding agent's tool loop was too much for this with a small local model:
    it searched once and then replied with a stray tag instead of the digest.
    Searching first and asking for one answer over the results is how the
    chat's web mode works, and it is reliable at any model size.
    """
    from app.agent import models as backends

    context = ""
    if _NEEDS_WEB.search(prompt):
        from app.web_search import perform_web_search

        results = await asyncio.to_thread(perform_web_search, prompt[:200], 6)
        lines = ["%d. %s (%s)\n%s" % (i, r.get("title", "").strip(), r.get("url", ""),
                                      str(r.get("snippet", "")).strip()[:700])
                 for i, r in enumerate(results, 1)]
        context = ("\n\nSearch results, fetched %s:\n" % datetime.now().strftime("%d %B %Y, %H:%M")
                   + ("\n\n".join(lines) if lines else "(the search returned nothing)"))
    chosen = model
    if not provider and not chosen:
        from app.main import _auto_route_model, _installed_ollama_models

        chosen = _auto_route_model(prompt, _installed_ollama_models())
        if not chosen:
            raise RuntimeError("No local model is installed and no cloud model was chosen for this job.")
    messages = [{"role": "system", "content": RESEARCH_SYSTEM},
                {"role": "user", "content": "Today is %s.\n\n%s%s" % (datetime.now().strftime("%A %d %B %Y"),
                                                                      prompt, context)}]
    return (await backends.complete(messages, chosen, provider)).strip()


#: Ready-made jobs. The prompt is what the agent is asked each time; it has
#: web search, so briefings and watches work without a project folder.
BLUEPRINTS = [
    {"id": "morning-briefing", "name": "Morning briefing", "schedule": "daily at 08:00", "channel": "phone",
     "prompt": "Give me a short morning briefing for today: the date, the weather where I live ({city}), "
               "and the three most important news headlines in India with one line each. Use web_search. "
               "Keep it under 120 words."},
    {"id": "topic-news", "name": "Topic news digest", "schedule": "daily at 19:00", "channel": "phone",
     "prompt": "Search the web for today's most important news about {topic}. Give five bullet points, each "
               "with the source name. Skip anything older than two days."},
    {"id": "weekly-review", "name": "Weekly review", "schedule": "every friday at 18:00", "channel": "ui",
     "prompt": "Give me a short weekly review to fill in: three prompts for wins, three for what did not go "
               "well, three for next week's priorities, and one reflective question."},
    {"id": "workday-start", "name": "Workday start reminder", "schedule": "weekdays at 09:00", "channel": "phone",
     "prompt": "Remind me to start the workday: suggest planning the top three tasks, and give one short "
               "productivity tip. Under 60 words."},
    {"id": "price-watch", "name": "Price & availability watch", "schedule": "every 6 hours", "channel": "phone",
     "prompt": "Search the web for the current price and availability of {product}. Report the lowest price "
               "you find with the shop name. Say clearly if you could not find a reliable price."},
    {"id": "competitor-watch", "name": "Competitor news watch", "schedule": "daily at 10:00", "channel": "ui",
     "prompt": "Search the web for news from the last day about {company}. Summarise anything new in up to "
               "five bullets with sources, or say there was nothing new."},
    {"id": "learning-drip", "name": "Daily learning drip", "schedule": "daily at 20:00", "channel": "phone",
     "prompt": "Teach me one small, practical thing about {subject} in under 100 words, with a tiny example."},
    {"id": "hydration", "name": "Hydration & movement nudge", "schedule": "every 2 hours", "channel": "phone",
     "prompt": "Give a one-line friendly reminder to drink water and stretch for a minute."},
    {"id": "repo-health", "name": "Project health check", "schedule": "daily at 09:30", "channel": "ui",
     "prompt": "In this project folder, run the test suite and git status. Report failing tests and uncommitted "
               "changes in a few lines. Do not change any files."},
]


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
        if not name.strip() or not task_prompt.strip():
            raise ValueError("Name and task instruction are required")
        if target_channel not in {"ui", "phone", "telegram", "discord", "webhook"}:
            raise ValueError("Unsupported delivery channel")
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
            if enabled and cur.rowcount:
                # A job paused for days has a next run in the past; resuming it
                # must not fire it at once, but at its next scheduled time.
                row = conn.execute("SELECT schedule_expr FROM jobs WHERE id = ?", (job_id,)).fetchone()
                if row:
                    conn.execute("UPDATE jobs SET next_run_ts = ? WHERE id = ?",
                                 (_parse_schedule_to_next_ts(row[0]), job_id))
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
        self._active_jobs: Dict[str, asyncio.Task] = {}

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
        for task in list(self._active_jobs.values()):
            task.cancel()
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
                if job.id not in self._active_jobs:
                    self.queue_job(job.id)

    def queue_job(self, job_id: str) -> Dict[str, Any]:
        if not self.store.get_job(job_id):
            return {"status": "not_found", "message": "Job not found"}
        if job_id in self._active_jobs:
            return {"status": "running", "job_id": job_id}
        task = asyncio.create_task(self.run_job_now(job_id))
        self._active_jobs[job_id] = task
        def completed(done):
            if self._active_jobs.get(job_id) is done:
                self._active_jobs.pop(job_id, None)
            if not done.cancelled() and done.exception():
                logger.error("Scheduled job failed: %s", done.exception())
        task.add_done_callback(completed)
        return {"status": "queued", "job_id": job_id}

    async def run_job_now(self, job_id: str) -> Dict[str, Any]:
        current = asyncio.current_task()
        if job_id in self._active_jobs and self._active_jobs[job_id] is not current:
            return {"status": "running", "job_id": job_id}
        self._active_jobs[job_id] = current
        try:
            return await asyncio.wait_for(self._execute_job(job_id), timeout=600)
        except asyncio.TimeoutError:
            job = self.store.get_job(job_id)
            if job:
                self.store.record_run(job_id, "error", "Execution exceeded 600 seconds", 600,
                                      _parse_schedule_to_next_ts(job.schedule_expr))
            return {"status": "error", "message": "Execution exceeded 600 seconds"}
        finally:
            if self._active_jobs.get(job_id) is current:
                self._active_jobs.pop(job_id, None)

    async def _execute_job(self, job_id: str) -> Dict[str, Any]:
        job = self.store.get_job(job_id)
        if not job:
            return {"status": "error", "message": "Job not found"}

        start_time = time.time()
        logger.info(f"Running scheduled automation: '{job.name}' ({job.id})")

        output_messages = []
        status = "success"
        try:
            from app.agent import loop as agent_loop

            if not job.workspace_root:
                # No project: a briefing, a digest, a reminder. Searched and
                # answered in one pass - see research_answer. (It used to run
                # the coding agent, which needed a folder and got lost.)
                output_messages.append(await research_answer(job.task_prompt, job.model, job.provider))
            else:
                # Work on a project. Nobody is watching, so nothing can be
                # approved: smart mode with no approver runs reading, searching,
                # edits (checkpointed) and known-safe commands, and declines
                # anything that needs a person. It used to run every command
                # unchecked. The step cap keeps a confused model from looping.
                async for event in agent_loop.run(
                    task=job.task_prompt,
                    model=job.model,
                    provider=job.provider,
                    root=job.workspace_root,
                    mode="smart",
                    max_steps=15,
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
        job.last_status = status

        # Route result to gateway or webhook if configured
        if job.target_channel in ("telegram", "discord", "webhook"):
            await self._dispatch_to_channel(job, final_output)
        elif job.target_channel == "phone":
            try:
                from app.companion import notify_paired_devices
                notify_paired_devices("%s: %s" % (job.name, final_output))
            except Exception as exc:  # noqa: BLE001 - delivery must not fail the job
                logger.warning("Could not notify the phone for job %s: %s", job.id, exc)

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
