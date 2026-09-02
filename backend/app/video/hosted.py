"""Making a video on somebody else's machine, when this one cannot.

The local engine is LTX-Video on your own GPU: nothing leaves the machine, and
nothing is charged. It is also a 32 GB download, it wants bfloat16, and it is
not what Veo or Kling produce. When that trade is the wrong one, this is the
other side of it — a hosted model, reached with your own key, billed to your
own account, with your prompt going to that company.

Replicate, because one key reaches many video models rather than one company's
own. The request shape is theirs and is documented; what is deliberately *not*
here is a list of model names.

No model slug is hardcoded.

    curl https://api.replicate.com/v1/models/google/veo-3   ->  401

Without a key every path answers 401, so from here it is impossible to tell a
model that exists from one that does not. Writing a list would mean writing
names I cannot check, and they change: a slug that has been renamed produces a
404 that reads as the app being broken. So the model is a setting, it is
checked against Replicate before anything is submitted, and if it is not there
the answer is Replicate's own.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Callable, Optional
from urllib import error, request

logger = logging.getLogger(__name__)

API = "https://api.replicate.com/v1"

#: The default is a setting, not a promise. It is what Replicate lists on its
#: own video collection page at the time of writing; if it has moved, the check
#: below says so in Replicate's words rather than failing halfway through.
DEFAULT_MODEL = "wan-video/wan-2.5-t2v"

ENV_KEY = "REPLICATE_API_TOKEN"
ENV_MODEL = "SMARAN_VIDEO_MODEL"

#: A hosted generation is minutes, not seconds, and the caller is a chat
#: stream. Past this it gives up and says so rather than holding the reply open.
MAX_WAIT_SECONDS = 900


class HostedVideoError(RuntimeError):
    """A failure worth showing in the words it happened in."""


def api_key() -> str:
    return (os.getenv(ENV_KEY) or "").strip()


def model_name() -> str:
    return (os.getenv(ENV_MODEL) or "").strip() or DEFAULT_MODEL


def configured() -> bool:
    return bool(api_key())


def _call(method: str, path: str, payload: Optional[dict] = None, timeout: int = 60) -> dict:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = request.Request(
        API + path,
        data=body,
        method=method,
        headers={
            "Authorization": "Bearer " + api_key(),
            "Content-Type": "application/json",
        },
    )
    try:
        with request.urlopen(req, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8") or "{}")
    except error.HTTPError as exc:
        detail = ""
        try:
            detail = json.loads(exc.read().decode("utf-8") or "{}").get("detail", "")
        except Exception:  # noqa: BLE001 - the body is whatever it is
            pass
        # The host's own words. "HTTP 402" tells nobody they are out of credit.
        raise HostedVideoError(
            "Replicate answered %s%s" % (exc.code, ": " + detail if detail else "")
        ) from exc
    except error.URLError as exc:
        raise HostedVideoError("Replicate could not be reached: %s" % exc.reason) from exc


def check_model(name: Optional[str] = None) -> dict:
    """Ask Replicate whether this model exists, before anything is submitted."""
    name = name or model_name()
    if name.count("/") != 1:
        raise HostedVideoError(
            "%r is not a model name. Replicate names look like owner/model, "
            "for example wan-video/wan-2.5-t2v." % name
        )
    return _call("GET", "/models/" + name)


def generate(prompt: str, on_message: Optional[Callable[[str], None]] = None) -> str:
    """Run one hosted generation and return the URL of the finished video."""
    def note(text: str) -> None:
        logger.info("hosted video: %s", text)
        if on_message:
            on_message(text)

    if not configured():
        raise HostedVideoError(
            "No Replicate key is saved. Settings -> Model Matrix -> Cloud "
            "Provider Keys, and the key is yours - the generation is billed to "
            "your account and the prompt goes to Replicate."
        )

    name = model_name()
    details = check_model(name)
    note("Using %s on Replicate." % name)

    started = _call("POST", "/models/%s/predictions" % name, {"input": {"prompt": prompt}})
    prediction_id = started.get("id")
    if not prediction_id:
        raise HostedVideoError("Replicate accepted the request without returning an id.")

    note("Submitted. Hosted generation usually takes a few minutes.")

    deadline = time.time() + MAX_WAIT_SECONDS
    last_status = ""
    while time.time() < deadline:
        time.sleep(3)
        record = _call("GET", "/predictions/" + prediction_id)
        status = record.get("status", "")
        if status != last_status:
            note("Status: %s" % status)
            last_status = status

        if status == "succeeded":
            output = record.get("output")
            # Models return either a URL or a list of them.
            url = output[0] if isinstance(output, list) and output else output
            if not isinstance(url, str) or not url.startswith("http"):
                raise HostedVideoError(
                    "The model finished but did not return a video URL. It may "
                    "not be a video model; %s is what was asked for." % name
                )
            return url

        if status in ("failed", "canceled"):
            raise HostedVideoError(
                "Replicate reported the run %s%s"
                % (status, ": " + str(record.get("error")) if record.get("error") else "")
            )

    raise HostedVideoError(
        "The hosted run was still going after %d minutes, so this stopped "
        "waiting. It may still finish - it is at replicate.com under your "
        "account." % (MAX_WAIT_SECONDS // 60)
    )


def status() -> dict:
    """What the interface needs to describe this without pretending."""
    return {
        "provider": "replicate",
        "configured": configured(),
        "model": model_name(),
        "key_url": "https://replicate.com/account/api-tokens",
        "note": (
            "Your key, your bill, and the prompt goes to Replicate. The model "
            "is a setting - any text-to-video model on Replicate can be named."
        ),
    }
