"""
Phone and desktop, working as one assistant.

Three things live here:

* **Pairing** — the desktop shows a QR code; the phone scans it and the two are
  linked. The QR carries the desktop's address on the local network plus a
  short-lived pairing code, so nothing is typed by hand and no account is
  needed.

* **Sync** — conversations are mirrored both ways. Either side can be offline:
  each message carries the clock time it was written and the device that wrote
  it, so when the two meet again the histories merge instead of one overwriting
  the other.

* **Remote control** — a paired device can ask the other to do something (speak
  a line, open a page, run a desktop action). Requests queue until the other
  side next polls, which is what makes "PC is off" work: the phone keeps going
  and the desktop catches up when it wakes.
"""

from __future__ import annotations

import io
import ipaddress
import json
import secrets
import socket
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ChatMessage, ChatSession, PairedDevice, User

router = APIRouter(prefix="/api/companion", tags=["companion"])


def get_current_user_dep(request: Request, db: Session = Depends(get_db)) -> User:
    """The app's own session check, imported late.

    ``main`` imports this module, so importing it back at module scope would be
    circular; resolving it per request keeps the dependency honest without the
    cycle.
    """
    from app.main import get_current_user

    return get_current_user(request=request, db=db, session_token=request.cookies.get("session_token"))

# A pairing code is only useful for the couple of minutes the QR is on screen.
PAIRING_TTL_SECONDS = 300
_pending_pairings: Dict[str, Dict[str, Any]] = {}

# Commands waiting for a device to collect them, keyed by target device id.
_command_queues: Dict[str, List[Dict[str, Any]]] = {}
_MAX_QUEUED_COMMANDS = 50


# ---------------------------------------------------------------------------
# Network identity
# ---------------------------------------------------------------------------

def local_network_address() -> Optional[str]:
    """This machine's address on the LAN, as a phone would reach it.

    ``gethostbyname`` often answers ``127.0.0.1``, which is useless to another
    device, so a UDP socket is pointed outward and the chosen source address is
    read back. No packet is actually sent.
    """
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("10.255.255.255", 1))
        address = probe.getsockname()[0]
    except OSError:
        return None
    finally:
        probe.close()

    try:
        parsed = ipaddress.ip_address(address)
    except ValueError:
        return None
    if parsed.is_loopback or parsed.is_unspecified:
        return None
    return address


# ---------------------------------------------------------------------------
# Pairing
# ---------------------------------------------------------------------------

class PairingClaim(BaseModel):
    code: str
    device_name: str
    device_kind: str = "phone"


def _prune_pairings() -> None:
    now = time.time()
    for code in [c for c, entry in _pending_pairings.items() if entry["expires"] < now]:
        _pending_pairings.pop(code, None)


@router.post("/pairing/start")
def start_pairing(port: int = Query(..., ge=1, le=65535), current_user: User = Depends(get_current_user_dep)):
    """Open a pairing window and describe the QR the desktop should display."""
    _prune_pairings()
    address = local_network_address()
    if not address:
        raise HTTPException(
            status_code=503,
            detail="This machine is not on a local network, so a phone cannot reach it.",
        )

    code = f"{secrets.randbelow(10**6):06d}"
    _pending_pairings[code] = {
        "expires": time.time() + PAIRING_TTL_SECONDS,
        "user_id": current_user.id,
        "token": secrets.token_urlsafe(32),
    }
    base = f"http://{address}:{port}"
    # The QR carries a URL, not raw JSON. A phone's own camera app shows
    # whatever a QR contains, so JSON produced a screenful of braces instead of
    # anything useful. A link opens the workspace served from this machine with
    # the pairing code already filled in.
    #
    # This installs nothing, and the dialog no longer claims it does. An
    # Android build exists and the website offers it, but it is not needed
    # here and scanning does not fetch it.
    qr_payload = f"{base}/?pair={code}"
    return {
        "code": code,
        "url": base,
        "expires_in": PAIRING_TTL_SECONDS,
        "qr_payload": qr_payload,
    }


@router.get("/pairing/qr")
def pairing_qr(payload: str = Query(..., min_length=4, max_length=512)):
    """Render a pairing payload as an SVG QR code.

    Drawn server-side so the window needs no QR library of its own, and as SVG
    so it stays sharp at any size.
    """
    import segno

    if len(payload) > 512:
        raise HTTPException(status_code=400, detail="That pairing payload is too long to encode.")

    buffer = io.BytesIO()
    # Medium error correction: readable even with a fingerprint on the screen.
    segno.make(payload, error="m").save(
        buffer,
        kind="svg",
        scale=6,
        border=2,
        dark="#7dd3fc",
        light=None,  # transparent, so it sits on the app's dark panel
    )
    return Response(content=buffer.getvalue(), media_type="image/svg+xml")


@router.post("/pairing/claim")
def claim_pairing(claim: PairingClaim, db: Session = Depends(get_db)):
    """Called by the phone after it scans the QR. Returns its device token."""
    _prune_pairings()
    entry = _pending_pairings.get(claim.code)
    if not entry:
        raise HTTPException(status_code=404, detail="That pairing code has expired. Show a new QR code.")

    device = PairedDevice(
        id=secrets.token_urlsafe(12),
        user_id=entry["user_id"],
        name=(claim.device_name or "Phone").strip()[:80],
        kind=(claim.device_kind or "phone").strip()[:20],
        token=entry["token"],
        last_seen=datetime.now(),
    )
    db.add(device)
    db.commit()
    _pending_pairings.pop(claim.code, None)

    return {
        "device_id": device.id,
        "token": device.token,
        "name": device.name,
        "paired_at": device.created_at.isoformat(),
    }


def _device_from_token(db: Session, token: str) -> PairedDevice:
    device = db.query(PairedDevice).filter(PairedDevice.token == token).first()
    if not device:
        raise HTTPException(status_code=401, detail="This device is not paired.")
    device.last_seen = datetime.now()
    db.commit()
    return device


@router.get("/devices")
def list_devices(db: Session = Depends(get_db), current_user: User = Depends(get_current_user_dep)):
    """Devices linked to this account, newest first."""
    devices = (
        db.query(PairedDevice)
        .filter(PairedDevice.user_id == current_user.id)
        .order_by(PairedDevice.created_at.desc())
        .all()
    )
    now = datetime.now()
    return {
        "devices": [
            {
                "id": d.id,
                "name": d.name,
                "kind": d.kind,
                "paired_at": d.created_at.isoformat(),
                "last_seen": d.last_seen.isoformat() if d.last_seen else None,
                # "Online" here means it has polled recently, which is the only
                # thing this side can actually observe.
                "online": bool(d.last_seen and (now - d.last_seen) < timedelta(seconds=45)),
            }
            for d in devices
        ]
    }


@router.delete("/devices/{device_id}")
def unpair_device(device_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user_dep)):
    device = (
        db.query(PairedDevice)
        .filter(PairedDevice.id == device_id, PairedDevice.user_id == current_user.id)
        .first()
    )
    if not device:
        raise HTTPException(status_code=404, detail="That device is not paired.")
    db.delete(device)
    db.commit()
    _command_queues.pop(device_id, None)
    return {"message": f"{device.name} was unlinked."}


# ---------------------------------------------------------------------------
# Conversation sync
# ---------------------------------------------------------------------------

class SyncMessage(BaseModel):
    session_id: str
    session_title: Optional[str] = None
    role: str
    content: str
    model_used: Optional[str] = None
    created_at: str  # ISO 8601, from the writing device's clock


class SyncRequest(BaseModel):
    token: str
    # Everything written on the calling device that the other side may not have.
    messages: List[SyncMessage] = []
    # Only history newer than this is sent back, so the phone is not handed the
    # entire archive on every poll.
    since: Optional[str] = None


def _parse_time(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


@router.post("/sync")
def sync_conversations(payload: SyncRequest, db: Session = Depends(get_db)):
    """Merge a device's offline history in, and hand back what it is missing.

    Merging is by content and timestamp rather than by id: the two sides
    generate ids independently while apart, so ids cannot be compared.
    """
    device = _device_from_token(db, payload.token)
    user_id = device.user_id
    accepted = 0

    for item in payload.messages:
        written_at = _parse_time(item.created_at) or datetime.now()

        session = (
            db.query(ChatSession)
            .filter(ChatSession.id == item.session_id, ChatSession.user_id == user_id)
            .first()
        )
        if not session:
            session = ChatSession(
                id=item.session_id,
                user_id=user_id,
                title=(item.session_title or "Conversation")[:120],
                created_at=written_at,
                updated_at=written_at,
            )
            db.add(session)
            db.flush()

        # Skip anything already stored: the same text, in the same session,
        # within a few seconds is the same message arriving twice.
        duplicate = (
            db.query(ChatMessage)
            .filter(
                ChatMessage.session_id == session.id,
                ChatMessage.role == item.role,
                ChatMessage.content == item.content,
                ChatMessage.created_at >= written_at - timedelta(seconds=5),
                ChatMessage.created_at <= written_at + timedelta(seconds=5),
            )
            .first()
        )
        if duplicate:
            continue

        db.add(ChatMessage(
            session_id=session.id,
            role=item.role,
            content=item.content,
            model_used=item.model_used,
            created_at=written_at,
        ))
        if written_at > session.updated_at:
            session.updated_at = written_at
        accepted += 1

    db.commit()

    since = _parse_time(payload.since)
    query = (
        db.query(ChatMessage)
        .join(ChatSession, ChatMessage.session_id == ChatSession.id)
        .filter(ChatSession.user_id == user_id)
    )
    if since:
        query = query.filter(ChatMessage.created_at > since)
    rows = query.order_by(ChatMessage.created_at.asc()).limit(500).all()

    titles = {
        s.id: s.title
        for s in db.query(ChatSession).filter(ChatSession.user_id == user_id).all()
    }

    return {
        "accepted": accepted,
        "server_time": datetime.now().isoformat(),
        "messages": [
            {
                "session_id": row.session_id,
                "session_title": titles.get(row.session_id, "Conversation"),
                "role": row.role,
                "content": row.content,
                "model_used": row.model_used,
                "created_at": row.created_at.isoformat(),
            }
            for row in rows
        ],
    }


# ---------------------------------------------------------------------------
# Remote control, in both directions
# ---------------------------------------------------------------------------

class RemoteCommand(BaseModel):
    target_device_id: str
    action: str
    params: Dict[str, Any] = {}


# What one device is allowed to ask another to do. Anything outside this list
# is refused, so a paired phone cannot drive arbitrary code on the desktop.
ALLOWED_REMOTE_ACTIONS = {
    "speak",            # say a line aloud
    "open_url",         # open a page in the default browser
    "notify",           # show a message
    "start_listening",  # open the voice workspace
    "stop_listening",
    "desktop_action",   # run a vetted desktop-agent action by id
    "new_chat",
    "screenshot",
}


@router.post("/command")
def queue_command(
    command: RemoteCommand,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_dep),
):
    """Desktop -> device. The command waits until the device next polls."""
    if command.action not in ALLOWED_REMOTE_ACTIONS:
        raise HTTPException(status_code=400, detail=f"'{command.action}' is not a permitted remote action.")

    device = (
        db.query(PairedDevice)
        .filter(PairedDevice.id == command.target_device_id, PairedDevice.user_id == current_user.id)
        .first()
    )
    if not device:
        raise HTTPException(status_code=404, detail="That device is not paired.")

    queue = _command_queues.setdefault(device.id, [])
    queue.append({
        "id": secrets.token_urlsafe(8),
        "action": command.action,
        "params": command.params,
        "queued_at": datetime.now().isoformat(),
    })
    del queue[:-_MAX_QUEUED_COMMANDS]
    return {"queued": True, "pending": len(queue)}


@router.get("/commands")
def collect_commands(token: str = Query(...), db: Session = Depends(get_db)):
    """Device -> desktop poll. Returns and clears anything waiting."""
    device = _device_from_token(db, token)
    queue = _command_queues.pop(device.id, [])
    return {"commands": queue}


class DeviceRequest(BaseModel):
    token: str
    action: str
    params: Dict[str, Any] = {}


@router.post("/from-device")
async def command_from_device(payload: DeviceRequest, db: Session = Depends(get_db)):
    """Device -> desktop. Runs a vetted action on this machine right away."""
    _device_from_token(db, payload.token)
    if payload.action not in ALLOWED_REMOTE_ACTIONS:
        raise HTTPException(status_code=400, detail=f"'{payload.action}' is not a permitted remote action.")

    if payload.action == "desktop_action":
        from app.desktop_agent import DesktopAgent

        action_id = str(payload.params.get("action") or "").strip()
        if not action_id:
            raise HTTPException(status_code=400, detail="No desktop action was named.")
        result = await DesktopAgent.execute(
            action_id,
            payload.params.get("params") or {},
            confirmed=bool(payload.params.get("confirmed")),
        )
        return result

    if payload.action == "open_url":
        from app.desktop_agent import DesktopAgent

        return await DesktopAgent.execute("open_url", {"url": payload.params.get("url", "")}, confirmed=True)

    if payload.action == "screenshot":
        from app.desktop_agent import DesktopAgent

        return await DesktopAgent.execute("take_screenshot", {}, confirmed=True)

    # The rest are handled by the desktop UI when it polls its own queue.
    queue = _command_queues.setdefault("__desktop__", [])
    queue.append({
        "id": secrets.token_urlsafe(8),
        "action": payload.action,
        "params": payload.params,
        "queued_at": datetime.now().isoformat(),
    })
    del queue[:-_MAX_QUEUED_COMMANDS]
    return {"queued": True}


@router.get("/desktop-commands")
def desktop_commands(current_user: User = Depends(get_current_user_dep)):
    """The desktop UI polls this for anything a phone asked it to do."""
    queue = _command_queues.pop("__desktop__", [])
    return {"commands": queue}


@router.get("/status")
def companion_status(port: int = Query(8000, ge=1, le=65535)):
    """Whether this machine can be paired with at all, and at what address."""
    address = local_network_address()
    return {
        "reachable": bool(address),
        "address": f"http://{address}:{port}" if address else None,
        "reason": None if address else "This machine is not connected to a local network.",
    }
