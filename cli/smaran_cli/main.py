"""The SMARAN.AI command line.

Talks to the copy of SMARAN.AI already running on this machine. It is a client,
not a second brain: the model routing, the provider keys and the conversation
history all live in the app, so there is nothing to configure here and no way
for the two to disagree about which model answered.

Requests go to 127.0.0.1 only. The backend treats a caller on the loopback
interface as the local user, which is why no login is asked for — and why this
cannot reach anybody else's machine.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
import uuid

from .discovery import find_backend


TIMEOUT = 300  # A local model on a slow machine can take minutes to answer.


class Problem(Exception):
    """Something the user should read, not a stack trace."""


def _colour_ok() -> bool:
    """Whether to emit escape codes at all.

    Piping the output into a file or another program should give plain text,
    not escape sequences, so colour is only used when stderr is a terminal.
    NO_COLOR is honoured because it costs nothing to.
    """
    import os

    if os.getenv("NO_COLOR"):
        return False
    return sys.stderr.isatty()


def _dim(text: str) -> None:
    """A footer line, dimmed when the terminal will take it."""
    if _colour_ok():
        print(f"\n\033[2m{text}\033[0m", file=sys.stderr)
    else:
        print(f"\n{text}", file=sys.stderr)


def _request(base: str, path: str, payload=None, method: str = "GET", timeout: int = 30):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        base + path,
        data=data,
        headers={"content-type": "application/json", "accept": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            body = res.read().decode("utf-8", "replace")
            if not body.strip():
                return {}
            try:
                return json.loads(body)
            except ValueError:
                # The app serves its web interface from the same port, and any
                # path it does not recognise returns that page with a 200
                # rather than a 404. Parsing it would raise deep inside json
                # and print a traceback for what is really 'no such endpoint'.
                raise Problem(f"{path} is not an endpoint this app version has.")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:300]
        raise Problem(f"The app returned {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise Problem(f"Could not reach the app: {exc.reason}") from exc


def _base_or_exit() -> str:
    base = find_backend()
    if not base:
        raise Problem(
            "SMARAN.AI does not appear to be running.\n"
            "Start the desktop app, then try again.\n"
            "If it is running on an unusual address, set SMARAN_URL."
        )
    return base


# ----------------------------------------------------------------- commands

def cmd_status(_args) -> int:
    base = _base_or_exit()

    # Reach it before announcing it. Discovery can hand back an address it has
    # not tried — SMARAN_URL is taken on trust — and printing 'Running at' for
    # a port with nothing behind it is a plain untruth, made worse by exiting
    # 0 so a script believes it too.
    try:
        me = _request(base, "/api/auth/me", timeout=10)
    except Problem as exc:
        print(f"Not running at {base}", file=sys.stderr)
        print(f"  {exc}", file=sys.stderr)
        print("\nStart the desktop app, or point SMARAN_URL somewhere else.", file=sys.stderr)
        return 1

    print(f"Running at {base}")
    print(f"  account    {me.get('username') or me.get('email') or 'local user'}")

    try:
        status = _request(base, "/api/model/status", timeout=20)
        for label, key in (("engine", "engine"), ("model", "model"), ("model", "active_model")):
            if status.get(key):
                print(f"  {label:<10} {status[key]}")
                break
    except Problem:
        # Not every build exposes this. It is extra detail, not the answer to
        # 'is it running', so its absence is not worth an error line.
        pass
    return 0


def cmd_models(_args) -> int:
    base = _base_or_exit()
    payload = _request(base, "/api/models/catalog", timeout=60)
    models = payload.get("catalog") if isinstance(payload, dict) else payload
    if not models:
        print("No models reported by the app.")
        return 1

    downloaded = [m for m in models if m.get("is_downloaded")]
    engine = payload.get("active_engine") if isinstance(payload, dict) else None
    active = payload.get("active_model_id") if isinstance(payload, dict) else None

    print(f"{len(models)} in the catalogue, {len(downloaded)} downloaded")
    if engine:
        print(f"engine: {engine}" + (f" | active: {active}" if active else ""))
    print()

    # Downloaded models are the ones that can answer right now, so they lead.
    # With none downloaded the catalogue is still worth showing, clearly
    # labelled as things to fetch rather than things that are ready.
    shown = downloaded or models[:20]
    for model in shown:
        name = model.get("name") or model.get("id") or "?"
        params = model.get("parameters") or ""
        company = model.get("company") or ""
        print(f"  {name:<38} {params:<8} {company}")

    if not downloaded:
        print(f"\nNone downloaded yet - the first {len(shown)} of {len(models)} available.")
        print("Download one from the app's model hub, or with `ollama pull`.")
    return 0


def _stream_answer(base: str, prompt: str, session: str, model: str | None) -> int:
    """Send one prompt and print tokens as they arrive.

    The endpoint answers with newline-delimited JSON: many {"token": "..."}
    objects, then a metadata object, then a translated form of the whole reply.
    Only the tokens are printed as they come; the metadata line is used for the
    footer, and anything unrecognised is ignored rather than dumped at the user.
    """
    payload = {
        "session_id": session,
        "prompt": prompt,
        "collections": [],
        "turbo": False,
        "web_search": False,
        "rag_enabled": False,
        "voice_mode": False,
        "target_language": "en",
    }
    if model:
        payload["model"] = model

    req = urllib.request.Request(
        base + "/api/chat",
        data=json.dumps(payload).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )

    meta = {}
    printed_any = False
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
            for raw in res:
                line = raw.decode("utf-8", "replace").strip()
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                except ValueError:
                    continue

                if "token" in chunk:
                    sys.stdout.write(chunk["token"])
                    sys.stdout.flush()
                    printed_any = True
                elif "error" in chunk:
                    print(f"\n\nThe app reported an error: {chunk['error']}", file=sys.stderr)
                    return 1
                elif "response_time_ms" in chunk:
                    meta = chunk
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:300]
        raise Problem(f"The app returned {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise Problem(f"Could not reach the app: {exc.reason}") from exc

    if printed_any:
        print()
    if meta:
        model_used = meta.get("model_routed") or "?"
        secs = meta.get("execution_time_sec")
        rate = meta.get("tokens_per_sec")
        bits = [f"model {model_used}"]
        if secs is not None:
            bits.append(f"{secs}s")
        if rate:
            bits.append(f"{rate} tok/s")
        # ASCII only. The Windows console defaults to a code page that cannot
        # encode a middle dot or an em dash, and printed them as replacement
        # characters in the middle of an otherwise correct answer.
        _dim(f"-- {' | '.join(bits)}")
    return 0


def cmd_ask(args) -> int:
    base = _base_or_exit()
    prompt = " ".join(args.prompt).strip()
    if not prompt:
        raise Problem("Nothing to ask. Put the question after `smaran ask`.")
    return _stream_answer(base, prompt, args.session or f"cli-{uuid.uuid4().hex[:12]}", args.model)


def _prompt() -> str:
    """The input marker, plain when colour is not wanted."""
    return "[1m>[0m " if _colour_ok() else "> "


def cmd_chat(args) -> int:
    base = _base_or_exit()
    session = args.session or f"cli-{uuid.uuid4().hex[:12]}"
    print(f"SMARAN.AI - {base}")
    print("Type a question. Ctrl-C or an empty line twice to leave.\n")

    blanks = 0
    while True:
        try:
            line = input("\033[1m›\033[0m ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 0

        if not line:
            blanks += 1
            if blanks >= 2:
                return 0
            continue
        blanks = 0

        try:
            _stream_answer(base, line, session, args.model)
        except Problem as exc:
            print(f"{exc}", file=sys.stderr)
        print()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="smaran",
        description="Talk to the SMARAN.AI running on this machine.",
    )
    subs = parser.add_subparsers(dest="command")

    status = subs.add_parser("status", help="Check that the app is running")
    status.set_defaults(func=cmd_status)

    models = subs.add_parser("models", help="List the models the app knows about")
    models.set_defaults(func=cmd_models)

    ask = subs.add_parser("ask", help="Ask one question and print the answer")
    ask.add_argument("prompt", nargs="+", help="The question")
    ask.add_argument("--model", help="Override the model the app would pick")
    ask.add_argument("--session", help="Continue a named conversation")
    ask.set_defaults(func=cmd_ask)

    chat = subs.add_parser("chat", help="Keep asking, in one conversation")
    chat.add_argument("--model", help="Override the model the app would pick")
    chat.add_argument("--session", help="Continue a named conversation")
    chat.set_defaults(func=cmd_chat)

    return parser


def main(argv=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "func", None):
        parser.print_help()
        return 0
    try:
        return args.func(args)
    except Problem as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print()
        return 130


if __name__ == "__main__":
    sys.exit(main())
