"""TypeSafe's Jev: a "System One" model that returns typed decisions with
probabilities instead of text, in well under a second.

SMARAN uses it only as a second opinion on safety, and only when a key is
saved (Model Hub -> Cloud Provider Keys -> TypeSafe, or TYPESAFE_API_KEY):

  - Computer use: is this next click or keystroke about money, sending
    something, credentials or destroying data? If so, ask the owner.
  - SMARAN Code, Smart mode: could this file edit break security or delete
    work? If so, ask instead of running it.

It can only add caution. The rules that already ask keep asking; Jev being
slow, down or unset changes nothing (every failure answers "no opinion").

API (POST https://api.typesafe.ai/v1/systemone):
  {"model": "jev-latest", "state": "...", "questions":
      {"name": {"type": "noul", "instructions": "..."}}}
  -> {"answers": {"name": {"type": "noul", "noul": 0.82}}}
"""

from __future__ import annotations

import logging
import os
from typing import Dict, Optional

import httpx

log = logging.getLogger("jev")

URL = "https://api.typesafe.ai/v1/systemone"
ENV = "TYPESAFE_API_KEY"
TIMEOUT = 4.0
THRESHOLD = 0.5


def key() -> str:
    return os.getenv(ENV, "").strip()


def ask(state: str, questions: Dict[str, Dict], api_key: str = "", timeout: float = TIMEOUT) -> Optional[Dict]:
    """The `answers` object, or None when Jev is not set up or did not answer."""
    api_key = api_key or key()
    if not api_key:
        return None
    try:
        response = httpx.post(URL, timeout=timeout, headers={"Authorization": f"Bearer {api_key}"},
                              json={"model": "jev-latest", "state": state[:8000], "questions": questions})
    except httpx.HTTPError as exc:
        log.info("Jev did not answer: %s", exc)
        return None
    if response.status_code != 200:
        log.info("Jev answered %s", response.status_code)
        return None
    try:
        answers = response.json().get("answers")
    except ValueError:
        return None
    return answers if isinstance(answers, dict) else None


def risky(state: str, instructions: str) -> Optional[float]:
    """Probability that the step is risky in the way described, or None."""
    answers = ask(state, {"risky": {"type": "noul", "instructions": instructions}})
    value = (answers or {}).get("risky", {}).get("noul") if answers else None
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def verify(api_key: str) -> bool:
    """True when TypeSafe accepts the key. Raises PermissionError when it refuses it."""
    try:
        response = httpx.post(URL, timeout=15, headers={"Authorization": f"Bearer {api_key}"},
                              json={"model": "jev-latest", "state": "ping",
                                    "questions": {"ok": {"type": "noul", "instructions": "Is this a ping?"}}})
    except httpx.HTTPError as exc:
        raise ConnectionError(f"TypeSafe could not be reached: {exc}") from exc
    if response.status_code in (401, 403):
        raise PermissionError("TypeSafe did not accept this key.")
    if response.status_code != 200:
        raise ConnectionError(f"TypeSafe could not check the key ({response.status_code}).")
    return True
