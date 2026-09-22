"""HTTP for live browsing: start a task and watch it, or stop it.

One task at a time. There is one screen and one person watching it, and two
agents driving two windows at once would be impossible to follow.
"""

from __future__ import annotations

import asyncio
import json
import queue
import threading
from typing import Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from . import live_browser
from .database import get_db


def get_current_user(request: Request, db: Session = Depends(get_db),
                     session_token: Optional[str] = Cookie(None)):
    """main.get_current_user, looked up when called to avoid a circular import."""
    from .main import get_current_user as check
    return check(request, db, session_token)

router = APIRouter(prefix="/api/browse", tags=["live-browsing"])

_active = threading.Lock()
_stop = threading.Event()


class BrowseRequest(BaseModel):
    task: str = Field(..., min_length=1, max_length=2000)


@router.get("/status")
def status(current_user=Depends(get_current_user)):
    """Whether live browsing can run here, and whether it is running."""
    browser = live_browser.find_browser()
    return {
        "available": bool(browser),
        "browser": browser.rsplit("\\", 1)[-1].rsplit("/", 1)[-1] if browser else None,
        "running": _active.locked(),
    }


@router.post("/stop")
def stop(current_user=Depends(get_current_user)):
    _stop.set()
    return {"stopping": _active.locked()}


@router.post("")
async def browse(body: BrowseRequest, current_user=Depends(get_current_user)):
    if not _active.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="A browsing task is already running. "
                                                    "Stop it first.")
    _stop.clear()
    events: "queue.Queue[Optional[dict]]" = queue.Queue()

    def work() -> None:
        try:
            live_browser.run_task(body.task, events.put, _stop.is_set)
        finally:
            events.put(None)
            _active.release()

    threading.Thread(target=work, name="live-browser", daemon=True).start()

    async def stream():
        loop = asyncio.get_running_loop()
        while True:
            event = await loop.run_in_executor(None, events.get)
            if event is None:
                break
            yield json.dumps(event) + "\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson")
