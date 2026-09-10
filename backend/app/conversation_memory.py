"""Provider-independent retrieval from the owner's persisted chat archive."""
import unicodedata
import re
from sqlalchemy import or_
from .models import ChatMessage, ChatSession


def recent_context(messages, max_words=3000):
    """Select newest-first archive rows and return chronological prompt turns.

    Oversized turns get an explicitly marked tail instead of erasing all
    context. This is a conservative word bound, not a provider token budget.
    """
    selected = []
    remaining = max_words
    for row in messages:
        if remaining <= 0:
            break
        if row.role not in ('user', 'assistant') or not row.content:
            continue
        words = list(re.finditer(r'\S+', row.content))
        if not words:
            continue
        content = row.content
        if len(words) > remaining:
            # Include the marker inside the budget.
            if remaining <= 1:
                break
            content = '[Earlier-content-omitted]\n' + content[words[-(remaining - 1)].start():]
            remaining = 0
        else:
            remaining -= len(words)
        selected.append({'role': row.role, 'content': content})
    return list(reversed(selected))


def query_terms(query):
    """Keep combining marks attached to letters, including Devanagari matras."""
    normalized = unicodedata.normalize('NFC', query or '').casefold()
    words = ''.join(char if unicodedata.category(char)[0] in 'LNM' else ' '
                    for char in normalized).split()
    stop = {'the', 'and', 'what', 'that', 'this', 'previous', 'conversation', 'remember', 'about', 'please'}
    return list(dict.fromkeys(word for word in words if len(word) >= 3 and word not in stop))[:12]


def relevant_excerpt(content, terms, limit):
    """Center a bounded excerpt on an actual match rather than always the prefix."""
    folded = content.casefold()
    positions = [folded.find(term) for term in terms if term in folded]
    # Case folding can expand characters. Convert the folded offset back to a
    # source offset so non-ASCII text does not shift the excerpt past the hit.
    start = 0
    if positions and len(content) > limit:
        target = min(positions)
        offset = 0
        for index, char in enumerate(content):
            if offset >= target:
                start = max(0, index - limit // 4)
                break
            offset += len(char.casefold())
    return content[start:start + limit], start


def retrieve_conversations(db, user_id, current_session_id, query, max_chars=10000, section=None):
    if max_chars <= 0:
        return []
    terms = query_terms(query)
    base = db.query(ChatMessage).join(ChatSession, ChatMessage.session_id == ChatSession.id).filter(
        ChatSession.user_id == user_id,
        ChatSession.id != current_session_id,
        ChatMessage.role.in_(['user', 'assistant']),
    )
    if section:
        base = base.filter(ChatSession.section == section)
    recent = base.order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc()).limit(12).all()
    matched = []
    if terms:
        matched = base.filter(or_(*[ChatMessage.content.ilike('%' + term + '%') for term in terms])).order_by(
            ChatMessage.created_at.desc(), ChatMessage.id.desc()).limit(100).all()
        matched.sort(key=lambda row: sum(term in (row.content or '').casefold() for term in terms), reverse=True)
    selected, seen, remaining = [], set(), max_chars
    for row in matched + recent:
        if row.id in seen or not row.content:
            continue
        seen.add(row.id)
        text, offset = relevant_excerpt(row.content, terms, min(3000, remaining))
        if not text:
            break
        selected.append({'session_id': row.session_id, 'message_id': row.id,
                         'role': row.role, 'content': text, 'offset': offset,
                         'truncated': len(text) < len(row.content)})
        remaining -= len(text)
    return selected
