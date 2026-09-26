"""/api/reminders: what the page shows, speaks and notifies when a reminder is due."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from . import everyday
from .database import get_db


def get_current_user(request: Request, db: Session = Depends(get_db),
                     session_token: Optional[str] = Cookie(None)):
    from .main import get_current_user as check
    return check(request, db, session_token)


router = APIRouter(prefix="/api/reminders", tags=["reminders"])


@router.get("")
def list_reminders(_user=Depends(get_current_user)):
    return {"reminders": everyday.reminders().pending()}


@router.get("/fired")
def fired(_user=Depends(get_current_user)):
    """Reminders that have come due since the last ask. Each is handed out once."""
    return {"reminders": everyday.reminders().take_due()}


@router.delete("/{reminder_id}")
def cancel(reminder_id: str, _user=Depends(get_current_user)):
    gone = everyday.reminders().cancel(reminder_id)
    if not gone:
        raise HTTPException(status_code=404, detail="No such reminder.")
    return {"cancelled": gone}
