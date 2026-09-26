"""/api/computer: SMARAN operates the computer towards a goal, step by step."""

from __future__ import annotations

import asyncio
import json
from typing import Optional

from fastapi import APIRouter, Cookie, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from . import computer_agent, control_session
from .database import get_db


def get_current_user(request: Request, db: Session = Depends(get_db),
                     session_token: Optional[str] = Cookie(None)):
    from .main import get_current_user as check
    return check(request, db, session_token)


router = APIRouter(prefix="/api/computer", tags=["computer-use"])


class Goal(BaseModel):
    goal: str = Field(..., min_length=2, max_length=2000)


@router.post("/run")
async def run(goal: Goal, _user=Depends(get_current_user)):
    """Stream the run as NDJSON. POST /api/control/stop ends it."""
    token = control_session.begin("Computer use: " + goal.goal[:120], actor="computer-agent")
    queue: asyncio.Queue = asyncio.Queue()

    async def work():
        try:
            await computer_agent.run(goal.goal, queue.put_nowait, token)
        except Exception as exc:  # noqa: BLE001 - shown, not swallowed
            queue.put_nowait({"type": "error", "message": str(exc)[:300]})
        finally:
            control_session.stop(token)
            queue.put_nowait(None)

    async def stream():
        yield json.dumps({"type": "session", "token": token}) + "\n"
        task = asyncio.create_task(work())
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield json.dumps(event) + "\n"
        finally:
            # The page went away: stop, rather than keep driving the mouse.
            control_session.stop(token)
            await asyncio.wait([task], timeout=5)

    return StreamingResponse(stream(), media_type="application/x-ndjson")
