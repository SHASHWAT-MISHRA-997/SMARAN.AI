"""HTTP surface for documents and messages."""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import contacts, documents, messaging

router = APIRouter(prefix="/api/office", tags=["office"])


def _guard(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except (documents.OfficeError, messaging.MessagingError,
            contacts.ContactError) as exc:
        # 400, not 500: the request was understood and refused for a reason
        # worth reading, not a crash.
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class WordRequest(BaseModel):
    title: str = "Document"
    heading: Optional[str] = None
    paragraphs: List[str] = Field(default_factory=list)


class ExcelRequest(BaseModel):
    title: str = "Workbook"
    sheet_name: str = "Sheet1"
    rows: List[List] = Field(default_factory=list)


class SlidesRequest(BaseModel):
    title: str = "Deck"
    slides: List[dict] = Field(default_factory=list)


class NoteRequest(BaseModel):
    title: str = "Note"
    text: str = ""


class MessageRequest(BaseModel):
    #: whatsapp | telegram | sms | email | instagram | messenger | x | linkedin
    service: str
    to: str = ""
    text: str = ""
    subject: str = ""


@router.get("/available")
async def what_works():
    """Which document types this machine can actually produce."""
    return {"documents": documents.available(), "messaging": messaging.services()}


@router.post("/word")
async def word(req: WordRequest):
    return _guard(documents.write_word, req.title, req.paragraphs, req.heading)


@router.post("/excel")
async def excel(req: ExcelRequest):
    return _guard(documents.write_excel, req.title, req.rows, req.sheet_name)


@router.post("/powerpoint")
async def powerpoint(req: SlidesRequest):
    return _guard(documents.write_powerpoint, req.title, req.slides)


@router.post("/notepad")
async def notepad(req: NoteRequest):
    return _guard(documents.write_notepad, req.title, req.text)


@router.post("/message")
async def message(req: MessageRequest):
    """Open a conversation with the message written. Never sends."""
    service = (req.service or "").strip().lower()
    if service == "whatsapp":
        return _guard(messaging.whatsapp, req.to, req.text)
    if service == "telegram":
        return _guard(messaging.telegram, req.to, req.text)
    if service == "sms":
        return _guard(messaging.sms, req.to, req.text)
    if service in ("email", "gmail"):
        return _guard(messaging.email, req.to, req.subject, req.text)
    return _guard(messaging.social, service, req.text, req.to)


# ── contacts ───────────────────────────────────────────────────────────

class ContactRequest(BaseModel):
    name: str
    number: str
    is_self: bool = False


@router.get("/contacts")
async def list_contacts():
    return {"contacts": contacts.everyone(), "you": contacts.myself()}


@router.post("/contacts")
async def add_contact(req: ContactRequest):
    return _guard(contacts.add, req.name, req.number, req.is_self)


@router.delete("/contacts/{name}")
async def remove_contact(name: str):
    return _guard(contacts.remove, name)


class NamedMessage(BaseModel):
    #: A name from the contact book, or "me".
    to: str
    text: str = ""
    service: str = "whatsapp"


@router.post("/message/by-name")
async def message_by_name(req: NamedMessage):
    """Message one named person. Resolves to exactly one or refuses."""
    who = _guard(contacts.resolve, req.to)
    service = (req.service or "whatsapp").lower()
    if service == "telegram":
        result = _guard(messaging.telegram, who["number"], req.text)
    elif service == "sms":
        result = _guard(messaging.sms, who["number"], req.text)
    else:
        result = _guard(messaging.whatsapp, who["number"], req.text)
    result["resolved_to"] = who["name"]
    return result
