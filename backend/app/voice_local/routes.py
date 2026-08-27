"""The local live call, on the same wire protocol as the Gemini one.

Deliberately identical on the wire: start, audio, text, close going up;
ready, text, audio, interrupted, turn_complete, error coming down. The
browser client already speaks this, so choosing between the two is a matter
of which URL it opens rather than a second client.
"""

from __future__ import annotations

import base64
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .engine import LocalVoiceSession

logger = logging.getLogger("voice.local")

router = APIRouter(tags=["voice"])

# Where Ollama listens. The local model answers here; nothing else is called.
OLLAMA = "http://127.0.0.1:11434"

SYSTEM = (
    "You are SMARAN.AI, speaking out loud in a voice call. Reply in one or "
    "two short sentences. Do not use markdown, lists or emoji - every "
    "character you write will be spoken."
)


def _pick_model() -> str:
    """Whichever model Ollama has, preferring a small one for latency."""
    import urllib.error
    import urllib.request

    try:
        with urllib.request.urlopen(OLLAMA + "/api/tags", timeout=4) as response:
            tags = json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        # The common case by far, and worth a sentence someone can act on
        # rather than a WinError number.
        raise RuntimeError(
            "Ollama is not running, so there is no local model to talk to. "
            "Start Ollama and pull a model, or use the Gemini live call."
        ) from exc
    names = [m.get("name", "") for m in tags.get("models", []) if m.get("name")]
    if not names:
        raise RuntimeError(
            "Ollama is running but has no model pulled. Pull one first, for "
            "example: ollama pull llama3.2:3b"
        )
    # A voice call is judged on how fast it answers, so the smallest model
    # that is present wins unless there is only one.
    small = [n for n in names if any(s in n for s in (":1b", ":3b", "mini", "small"))]
    return (small or names)[0]


async def _answer_locally(prompt: str, history: list) -> str:
    """Ask the local model. No key, no network beyond this machine."""
    import asyncio
    import urllib.error
    import urllib.request

    def call() -> str:
        model = _pick_model()
        messages = [{"role": "system", "content": SYSTEM}]
        # Only the last few turns: a voice call does not need the whole
        # history, and a shorter prompt is a faster first token.
        messages.extend(history[-6:])
        messages.append({"role": "user", "content": prompt})

        body = json.dumps({
            "model": model, "messages": messages, "stream": False,
            "options": {"temperature": 0.6, "num_predict": 160},
        }).encode("utf-8")
        request = urllib.request.Request(
            OLLAMA + "/api/chat", data=body,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=120) as response:
            data = json.loads(response.read().decode("utf-8"))
        return (data.get("message") or {}).get("content", "").strip()

    try:
        return await asyncio.to_thread(call)
    except urllib.error.URLError as exc:
        raise RuntimeError(
            "Ollama is not answering on %s. Start it, or use the Gemini live "
            "call instead. (%s)" % (OLLAMA, exc)
        ) from exc


@router.websocket("/ws/voice/local")
async def local_voice(socket: WebSocket):
    """A live call served entirely from this machine."""
    await socket.accept()
    history: list = []
    session = None

    async def send(payload: dict) -> None:
        try:
            await socket.send_text(json.dumps(payload))
        except Exception:
            # The other end went away mid-turn; nothing to recover.
            pass

    try:
        while True:
            raw = await socket.receive_text()
            try:
                message = json.loads(raw)
            except ValueError:
                continue
            kind = message.get("type")

            if kind == "start":
                async def answer(text: str) -> str:
                    reply = await _answer_locally(text, history)
                    history.append({"role": "user", "content": text})
                    history.append({"role": "assistant", "content": reply})
                    return reply

                session = LocalVoiceSession(
                    send=send,
                    answer=answer,
                    language=(message.get("language") or "en"),
                    gender=(message.get("gender") or "female"),
                )
                # Checked before saying ready, so a missing Ollama is reported
                # up front rather than after the first thing someone says.
                try:
                    model = await __import__("asyncio").to_thread(_pick_model)
                    await send({"type": "ready", "engine": "local",
                                "model": model,
                                "note": "Running on this machine. Nothing is sent anywhere."})
                except Exception as exc:
                    await send({"type": "error", "message": str(exc)[:220]})

            elif kind == "audio" and session:
                try:
                    await session.feed(base64.b64decode(message.get("data") or ""))
                except Exception as exc:
                    logger.warning("bad audio frame: %s", exc)

            elif kind == "text" and session:
                # Typed while the call is open: same path, skipping the ears.
                text = (message.get("text") or "").strip()
                if text:
                    reply = await session.answer(text)
                    await send({"type": "text", "text": reply, "role": "assistant"})
                    await session._speak(reply)
                    await send({"type": "turn_complete"})

            elif kind == "image":
                # The local pipeline has no vision model wired to it. Said
                # plainly rather than accepting frames and ignoring them.
                await send({
                    "type": "error",
                    "message": "The local call has no vision. Screen and camera "
                               "sharing need the Gemini live call.",
                })

            elif kind == "close":
                break

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.exception("local voice socket failed")
        await send({"type": "error", "message": str(exc)[:200]})
    finally:
        if session:
            await session.close()
        try:
            await socket.close()
        except Exception:
            pass
