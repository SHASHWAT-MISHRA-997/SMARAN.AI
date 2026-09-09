"""Immutable public conversation sharing for SMARAN.AI.

Allows users to create an immutable snapshot of completed conversation messages,
preview the snapshot, generate an unguessable link, and revoke/delete it at any time.

Security & Privacy:
- Never includes account names, emails, system prompts, hidden tool traces, or credentials.
- Message text is validated, length-bounded (max 100 messages, max 64KB text), and sanitized.
- Unguessable cryptographically random IDs (secrets.token_urlsafe).
- Secret revocation token returned only to the creator upon creation.
- Once revoked, snapshot is immediately inaccessible.
- Original conversation edits or deletions do NOT affect the published snapshot.
"""
from __future__ import annotations

import html
import json
import re
import secrets
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session
from app.models import SharedConversation, User

MAX_MESSAGES = 100
MAX_TOTAL_CHARS = 65_536
MAX_TITLE_CHARS = 120

# Regex patterns for sensitive credentials that should never leak into a public share
_SECRET_PATTERNS = [
    re.compile(r"(?:api[_-]?key|secret|token|password|bearer|auth|authorization)\s*[:=]\s*['\"]?([a-zA-Z0-9_\-\.]{12,})['\"]?", re.IGNORECASE),
    re.compile(r"\b(sk-[a-zA-Z0-9_\-]{20,})\b"),
    re.compile(r"\b(ghp_[a-zA-Z0-9]{36})\b"),
]


def sanitize_content(text: str) -> str:
    """Sanitize message content for public sharing."""
    if not isinstance(text, str):
        return ""
    cleaned = text.strip()
    for pattern in _SECRET_PATTERNS:
        cleaned = pattern.sub("[REDACTED_CREDENTIAL]", cleaned)
    return cleaned


def create_share(
    db: Session,
    messages: List[Dict[str, Any]],
    title: Optional[str] = None,
    user: Optional[User] = None,
) -> Dict[str, Any]:
    """Create an immutable public snapshot of selected conversation messages."""
    if not messages or not isinstance(messages, list):
        raise ValueError("Cannot create a share with no messages.")

    sanitized_messages: List[Dict[str, str]] = []
    total_chars = 0

    for msg in messages[:MAX_MESSAGES]:
        role = msg.get("role")
        if role not in ("user", "assistant"):
            continue
        content = msg.get("content")
        if not isinstance(content, str) or not content.strip():
            continue
        clean = sanitize_content(content)
        total_chars += len(clean)
        if total_chars > MAX_TOTAL_CHARS:
            break
        sanitized_messages.append({"role": role, "content": clean})

    if not sanitized_messages:
        raise ValueError("No completed user or assistant messages found to share.")

    clean_title = (title or "SMARAN Conversation Snapshot").strip()[:MAX_TITLE_CHARS]
    share_id = secrets.token_urlsafe(16)
    revocation_token = secrets.token_urlsafe(24)

    record = SharedConversation(
        id=share_id,
        user_id=user.id if user and hasattr(user, "id") and isinstance(user.id, int) else None,
        title=clean_title,
        snapshot_json=json.dumps(sanitized_messages, ensure_ascii=False),
        revocation_token=revocation_token,
        is_revoked=False,
        created_at=datetime.now(),
        views=0,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    return {
        "share_id": share_id,
        "share_url": f"/share/{share_id}",
        "revocation_token": revocation_token,
        "title": clean_title,
        "message_count": len(sanitized_messages),
        "created_at": record.created_at.isoformat(),
    }


def get_share(db: Session, share_id: str, increment_views: bool = True) -> Optional[Dict[str, Any]]:
    """Retrieve a public share by ID, returning None if not found or revoked."""
    record = db.query(SharedConversation).filter(SharedConversation.id == share_id).first()
    if not record or record.is_revoked:
        return None

    if increment_views:
        try:
            record.views = (record.views or 0) + 1
            db.commit()
        except Exception:
            db.rollback()

    try:
        messages = json.loads(record.snapshot_json)
    except Exception:
        messages = []

    return {
        "share_id": record.id,
        "title": record.title,
        "created_at": record.created_at.isoformat(),
        "views": record.views,
        "messages": messages,
    }


def revoke_share(
    db: Session,
    share_id: str,
    secret: Optional[str] = None,
    user: Optional[User] = None,
) -> bool:
    """Revoke a shared conversation using the revocation secret or owning user."""
    record = db.query(SharedConversation).filter(SharedConversation.id == share_id).first()
    if not record:
        return False

    authorized = False
    if secret and secrets.compare_digest(record.revocation_token, secret):
        authorized = True
    elif user and record.user_id and user.id == record.user_id:
        authorized = True

    if not authorized:
        return False

    record.is_revoked = True
    db.commit()
    return True


def render_public_share_html(data: Dict[str, Any]) -> str:
    """Render a clean, secure, responsive standalone HTML document for the shared snapshot."""
    safe_title = html.escape(data.get("title", "SMARAN Conversation"))
    created_at = html.escape(data.get("created_at", ""))
    messages = data.get("messages", [])

    rendered_messages = []
    for m in messages:
        role = m.get("role")
        is_user = role == "user"
        sender_label = "You" if is_user else "SMARAN"
        content_escaped = html.escape(m.get("content", ""))
        rendered_messages.append(f"""
        <article class="msg {'msg-user' if is_user else 'msg-bot'}">
            <header class="msg-hdr">
                <span class="avatar {'avatar-user' if is_user else 'avatar-bot'}">
                    {'U' if is_user else 'S'}
                </span>
                <span class="author">{sender_label}</span>
            </header>
            <div class="content">{content_escaped}</div>
        </article>
        """)

    messages_html = "\n".join(rendered_messages)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <title>{safe_title} — SMARAN.AI Snapshot</title>
    <style>
        :root {{
            --bg: #09090e;
            --surface: #12121a;
            --border: #272736;
            --text: #f0f0f5;
            --text-muted: #8e8e9f;
            --user-bg: #1c1c28;
            --bot-bg: #151522;
            --accent: #6366f1;
            --accent-glow: rgba(99, 102, 241, 0.15);
        }}
        @media (prefers-color-scheme: light) {{
            :root {{
                --bg: #f5f5f8;
                --surface: #ffffff;
                --border: #e0e0e8;
                --text: #121218;
                --text-muted: #646473;
                --user-bg: #eef0f7;
                --bot-bg: #ffffff;
                --accent: #4f46e5;
                --accent-glow: rgba(79, 70, 229, 0.08);
            }}
        }}
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--bg);
            color: var(--text);
            line-height: 1.6;
            padding: 24px 16px 64px;
        }}
        .container {{
            max-width: 768px;
            margin: 0 auto;
        }}
        header.page-header {{
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 20px 24px;
            margin-bottom: 24px;
            box-shadow: 0 4px 20px var(--accent-glow);
        }}
        .badge {{
            display: inline-block;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--accent);
            margin-bottom: 6px;
        }}
        h1 {{
            font-size: 20px;
            font-weight: 800;
            margin-bottom: 8px;
        }}
        .meta {{
            font-size: 12px;
            color: var(--text-muted);
        }}
        .banner {{
            background: var(--accent-glow);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 12px 16px;
            font-size: 12px;
            color: var(--text-muted);
            margin-bottom: 24px;
        }}
        .chat-stream {{
            display: flex;
            flex-direction: column;
            gap: 16px;
        }}
        .msg {{
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 16px 20px;
            background: var(--surface);
        }}
        .msg-user {{ background: var(--user-bg); }}
        .msg-bot {{ background: var(--bot-bg); }}
        .msg-hdr {{
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 10px;
        }}
        .avatar {{
            width: 24px;
            height: 24px;
            border-radius: 6px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 11px;
            font-weight: 900;
        }}
        .avatar-user {{ background: #3b82f6; color: #fff; }}
        .avatar-bot {{ background: var(--accent); color: #fff; }}
        .author {{
            font-size: 13px;
            font-weight: 700;
        }}
        .content {{
            white-space: pre-wrap;
            word-break: break-word;
            font-size: 14px;
        }}
        footer.page-footer {{
            margin-top: 40px;
            text-align: center;
            font-size: 12px;
            color: var(--text-muted);
        }}
        footer.page-footer a {{
            color: var(--accent);
            text-decoration: none;
            font-weight: 600;
        }}
    </style>
</head>
<body>
    <div class="container">
        <header class="page-header">
            <span class="badge">SMARAN.AI Snapshot</span>
            <h1>{safe_title}</h1>
            <p class="meta">Captured on {created_at} &bull; Immutable Read-Only View</p>
        </header>

        <div class="banner">
            <strong>Public Snapshot:</strong> This is a permanent read-only snapshot captured by the author.
            Later messages or changes in the author's local application do not appear here.
        </div>

        <main class="chat-stream">
            {messages_html}
        </main>

        <footer class="page-footer">
            <p>Shared via <a href="https://smaran.ai" target="_blank" rel="noopener noreferrer">SMARAN.AI</a> &bull; Local-First AI Assistant</p>
        </footer>
    </div>
</body>
</html>"""
