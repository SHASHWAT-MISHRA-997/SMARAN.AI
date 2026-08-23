"""
Spoken web navigation.

Turns a spoken line ("open YouTube", "search for quantum computing", "play
lofi on YouTube") into a URL. The URL is then handed to the desktop agent,
which opens it in whichever browser the person actually uses — Chrome, Brave,
Edge, whatever is set as the system default. Nothing is browsed inside this
app.
"""

import re
from typing import Optional
from urllib.parse import quote

# Spoken shortcuts for sites people ask for by name.
SITE_SHORTCUTS = {
    "youtube": "https://www.youtube.com",
    "google": "https://www.google.com",
    "gmail": "https://mail.google.com",
    "github": "https://github.com",
    "wikipedia": "https://www.wikipedia.org",
    "maps": "https://www.google.com/maps",
    "google maps": "https://www.google.com/maps",
    "news": "https://news.google.com",
    "chatgpt": "https://chat.openai.com",
    "stack overflow": "https://stackoverflow.com",
    "stackoverflow": "https://stackoverflow.com",
    "reddit": "https://www.reddit.com",
    "amazon": "https://www.amazon.in",
    "flipkart": "https://www.flipkart.com",
    "linkedin": "https://www.linkedin.com",
    "whatsapp": "https://web.whatsapp.com",
    "translate": "https://translate.google.com",
    "drive": "https://drive.google.com",
    "google drive": "https://drive.google.com",
    "instagram": "https://www.instagram.com",
    "facebook": "https://www.facebook.com",
    "netflix": "https://www.netflix.com",
    "spotify": "https://open.spotify.com",
}

_OPEN_PATTERNS = (
    re.compile(r"\b(?:open|go to|visit|navigate to)\s+(?P<target>.+)$", re.IGNORECASE),
    re.compile(r"^(?P<target>.+?)\s+(?:kholo|khol do|open karo)$", re.IGNORECASE),
)
_SEARCH_PATTERNS = (
    re.compile(r"\b(?:search|google|look up|dhundo|search karo)\s+(?:for\s+)?(?P<query>.+)$", re.IGNORECASE),
    re.compile(r"^(?P<query>.+?)\s+(?:search karo|dhundo)$", re.IGNORECASE),
)
_YOUTUBE_PATTERNS = (
    re.compile(r"\b(?:play|chalao)\s+(?P<query>.+?)\s+(?:on|par|pe)\s+youtube\b", re.IGNORECASE),
    re.compile(r"\byoutube\s+(?:par|pe|on)?\s*(?P<query>.+?)\s+(?:chalao|play karo)$", re.IGNORECASE),
)

_TRAILING_NOISE = re.compile(r"\b(?:please|karo|kar do|kardo|jaldi|now|abhi)\b\.?$", re.IGNORECASE)


def _clean_target(raw: str) -> str:
    text = (raw or "").strip().strip("\"'.,!?")
    for _ in range(3):
        stripped = _TRAILING_NOISE.sub("", text).strip().strip(".,")
        if stripped == text:
            break
        text = stripped
    text = re.sub(r"\b(?:the\s+)?(?:website|site|web ?page|page)\b", "", text, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", text).strip()


def detect_browser_command(utterance: str) -> Optional[dict]:
    """Map a spoken line to a URL to open, or ``None`` if it is not one.

    Returns a dict with ``url`` and a ``spoken`` acknowledgement.
    """
    text = (utterance or "").strip()
    if not text:
        return None

    for pattern in _YOUTUBE_PATTERNS:
        match = pattern.search(text)
        if match:
            query = _clean_target(match.group("query"))
            if query:
                return {
                    "url": f"https://www.youtube.com/results?search_query={quote(query)}",
                    "spoken": f"Playing {query} on YouTube.",
                }

    for pattern in _SEARCH_PATTERNS:
        match = pattern.search(text)
        if match:
            query = _clean_target(match.group("query"))
            if query:
                return {
                    "url": f"https://www.google.com/search?q={quote(query)}",
                    "spoken": f"Searching for {query}.",
                }

    for pattern in _OPEN_PATTERNS:
        match = pattern.search(text)
        if match:
            target = _clean_target(match.group("target"))
            if not target:
                continue
            shortcut = SITE_SHORTCUTS.get(target.lower())
            if shortcut:
                return {"url": shortcut, "spoken": f"Opening {target}."}
            # Only treat it as an address if it looks like one: "open notepad"
            # belongs to the desktop agent, not the browser.
            if re.fullmatch(r"[\w.-]+\.[a-z]{2,}(?:/\S*)?", target, re.IGNORECASE):
                return {
                    "url": target if "://" in target else f"https://{target}",
                    "spoken": f"Opening {target}.",
                }
    return None
