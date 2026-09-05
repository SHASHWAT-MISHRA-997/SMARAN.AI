"""Building a website from a brief, using the best model this installation has.

WHAT WAS WRONG

Sites only ever asked Ollama. On a machine whose Ollama holds nothing but
nomic-embed-text - an embedding model, which cannot write a sentence, let
alone a page - that is a guaranteed failure, and the screen fell back to a
stock template every time. Meanwhile the same installation had keys saved for
four cloud providers, two of them frontier models, and Sites never touched
one of them. The comparison the report was really making was between a page
built by a large model somewhere else and a page built here by nothing at
all.

So the generator is chosen rather than assumed: a cloud provider when this
installation has a key for one, the local server when it does not, and an
honest sentence when neither can help.

THE SECOND THING THAT WAS WRONG

    for entry in (tags.json().get("models") or []):
        name = entry.get("name")

`name` was the function's first parameter - the site's name. After that loop
it held the last model in the list, and that string was what went to the
model as "Site name:", and what the title was afterwards forced to. A tea
shop came out titled "Qwen2.5 Coder:3b". That was read as the model being
too small to follow instructions, and papered over by overwriting the title;
the model had followed the instruction exactly, and the instruction was
wrong.

HOW THE PAGE IS BUILT

Two passes, which is the part that actually shows. A first pass builds the
site from the brief; a second pass is given the result back and asked to
improve it as a designer would - spacing, type scale, palette, states. This
helps a small local model most, because a single prompt carrying structure
and content and aesthetics at once is longer than it can hold and the
aesthetics are what get dropped. It helps a large model too, for the ordinary
reason that a second look at a finished thing is easier than getting
everything right while writing it.

The polish pass can only improve things: its result is kept only if it is
still a complete document and has not lost most of the page.

Replies that stop mid-document are continued rather than thrown away. A rich
page runs past a token limit easily, and the old code treated a page missing
its closing tag as no page at all - so the better the model did, the likelier
it was to be discarded.
"""

from __future__ import annotations

import os
import re
from typing import Iterable, Optional

import httpx

from app.config import settings

# ---------------------------------------------------------------------------
# Which model builds the site
# ---------------------------------------------------------------------------

#: Cloud providers in the order they are preferred, with the environment
#: variable each key is kept in. The order is about how good the result tends
#: to be at this particular job - one long, self-contained, visually-judged
#: HTML document - and not about anything else.
PROVIDER_ORDER: tuple[tuple[str, str], ...] = (
    ("anthropic", "ANTHROPIC_API_KEY"),
    ("openai", "OPENAI_API_KEY"),
    ("gemini", "GEMINI_API_KEY"),
    ("openrouter", "OPENROUTER_API_KEY"),
    ("deepseek", "DEEPSEEK_API_KEY"),
    ("mistral", "MISTRAL_API_KEY"),
    ("groq", "GROQ_API_KEY"),
    ("cerebras", "CEREBRAS_API_KEY"),
    ("together", "TOGETHER_API_KEY"),
    ("sambanova", "SAMBANOVA_API_KEY"),
    ("nvidia", "NVIDIA_API_KEY"),
)

_ENDPOINTS = {
    "groq": "https://api.groq.com/openai/v1",
    "openrouter": "https://openrouter.ai/api/v1",
    "cerebras": "https://api.cerebras.ai/v1",
    "together": "https://api.together.xyz/v1",
    "deepseek": "https://api.deepseek.com/v1",
    "sambanova": "https://api.sambanova.ai/v1",
    "mistral": "https://api.mistral.ai/v1",
    "nvidia": "https://integrate.api.nvidia.com/v1",
    "openai": "https://api.openai.com/v1",
    "anthropic": "https://api.anthropic.com/v1",
    "gemini": "https://generativelanguage.googleapis.com/v1beta",
}

#: Ranked substrings, matched against whatever model ids the provider itself
#: reports. Nothing here is a guess at a model that might exist: the list
#: comes from the provider, and these only decide which of its models to
#: prefer. A provider that renames or retires a model therefore breaks
#: nothing - the next pattern down is used instead.
_PREFERENCES: dict[str, tuple[str, ...]] = {
    "anthropic": ("sonnet-5", "opus-5", "sonnet", "opus", "haiku"),
    "openai": ("gpt-5", "gpt-4.1", "gpt-4o", "o3"),
    # No version numbers: they go stale. "pro" and "flash" are the two
    # tiers Google has kept across every generation, and the version in
    # the id breaks the tie, newest first - see _rank.
    "gemini": ("pro", "flash"),
    "openrouter": ("qwen3-coder", "coder", "deepseek", "llama-4", "70b", "72b"),
    "deepseek": ("chat", "coder"),
    "mistral": ("large", "medium", "codestral"),
    "groq": ("70b", "maverick", "versatile", "8b"),
    "cerebras": ("70b", "llama-4", "8b"),
    "together": ("coder", "70b", "72b", "405b"),
    "sambanova": ("405b", "70b", "coder"),
    # Named families rather than "coder", which on this provider matched
    # bigcode/starcoder2-15b - a base code-completion model that finishes
    # a line of source and has never been taught to answer a request.
    "nvidia": ("llama-3.3", "llama-4", "qwen2.5-coder", "deepseek",
               "405b", "253b", "70b"),
}

#: Models that cannot write a web page, whatever their size. Names are checked
#: rather than capabilities because not every provider reports capabilities.
_NOT_A_WRITER = ("embed", "rerank", "tts", "whisper", "audio", "image",
                 "vision", "guard", "moderation", "diffusion", "video",
                 # Base completion models. They continue source code and
                 # were never instruction-tuned, so a brief comes back as
                 # more brief rather than as a page.
                 "starcoder", "codegen", "-base", "santacoder",
                 # Not general writers either: a deep-research model
                 # answers only through a different API, and a
                 # tool-calling variant is tuned for calling tools.
                 "deep-research", "customtools", "-tools")


def _key_for(env_name: str) -> str:
    return os.getenv(env_name, "").strip()


def _usable(model_id: str) -> bool:
    low = model_id.lower()
    return not any(term in low for term in _NOT_A_WRITER)


def _version_of(model_id: str) -> float:
    """The model's version number, for preferring the newer one.

    Google lists gemini-2.5-pro and gemini-3.1-pro-preview side by side; the
    first is the one being retired. Reading the number beats writing today's
    version into this file, where it would be wrong within a year.

    Dates are not versions. deep-research-pro-preview-12-2025 was ranked
    above everything else on this machine because the 12 of a December date
    read as version 12, which put a research model at the top of the list for
    building a web page. So a number followed by a four-digit year is thrown
    away, and so is anything too large to be a version.
    """
    text = model_id.lower()
    versions = []
    for match in re.finditer(r"(?<![a-z0-9.])(\d+(?:\.\d+)?)(?![a-z0-9])", text):
        if re.match(r"-\d{4}(?![0-9])", text[match.end():]):
            continue          # 12-2025 and the like
        value = float(match.group(1))
        if value >= 100:
            continue          # a year, or a snapshot stamp
        versions.append(value)
    return max(versions) if versions else 0.0

def rank_models(provider: str, model_ids: Iterable[str]) -> list[str]:
    """A provider's own models, best first for writing a page.

    Ordered rather than reduced to one, because a model list is a claim and
    not proof. Google lists gemini-2.5-pro for this installation and then
    answers 404 for it - "no longer available to new users" - so the only
    thing that establishes a model works is asking it. Whoever calls this
    walks the list until one actually answers.
    """
    usable = sorted({m.strip() for m in model_ids if m and _usable(m)})
    if not usable:
        return []

    order = _PREFERENCES.get(provider, ())

    def rank(model_id: str) -> tuple:
        low = model_id.lower()
        position = next((i for i, pattern in enumerate(order) if pattern in low),
                        len(order))
        # On OpenRouter a free route of the same model is preferred to the
        # paid one. The model catalogue in this app already offers nothing but
        # zero-cost OpenRouter routes, and quietly running up a bill from a
        # different screen would contradict that.
        free = provider == "openrouter" and low.endswith(":free")
        # Newer first, then the shorter id - which is almost always the stable
        # alias rather than a dated snapshot of it, and the one that keeps
        # working after the snapshot is retired.
        return (position, 0 if free else 1, -_version_of(model_id),
                len(model_id), model_id)

    return sorted(usable, key=rank)

def _list_models(provider: str, api_key: str) -> tuple[list[str], str]:
    """Ask the provider which models this key can actually reach.

    Returns the ids and, when there are none, why. A provider that is
    skipped silently looks like a provider that was never set up: the
    saved Anthropic key on this machine is rejected as invalid, and
    without this the screen would simply have built with something else
    and never mentioned it.
    """
    endpoint = _ENDPOINTS.get(provider)
    if not endpoint:
        return [], "there is no endpoint for it"
    headers = {"Authorization": f"Bearer {api_key}"}
    if provider == "anthropic":
        headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
    if provider == "openrouter":
        headers.update({"HTTP-Referer": "http://localhost:3003", "X-Title": "SMARAN.AI"})
    try:
        with httpx.Client(timeout=20.0) as client:
            if provider == "gemini":
                response = client.get(f"{endpoint}/models",
                                      params={"key": api_key, "pageSize": 1000})
            else:
                response = client.get(f"{endpoint}/models", headers=headers)
        if response.status_code != 200:
            if response.status_code in (401, 403):
                return [], "the saved key was refused"
            return [], "listing its models answered HTTP %d" % response.status_code
        payload = response.json()
    except Exception as exc:
        return [], "it could not be reached (%s)" % str(exc)[:60]

    if provider == "gemini":
        ids = [
            str(m.get("name", "")).removeprefix("models/")
            for m in payload.get("models", [])
            if m.get("name")
            and "generateContent" in (m.get("supportedGenerationMethods") or [])
        ]
    else:
        ids = [str(m.get("id", "")) for m in payload.get("data", []) if m.get("id")]
    return ids, ("" if ids else "it reported no usable models")


def _local_models() -> list[str]:
    """Text-capable models on the local server.

    Ollama reports capabilities, and an embedding model says so - checking
    that is exact where guessing from the name is not. The name is still
    checked as well, for older servers that report nothing.
    """
    base = settings.OLLAMA_URL.rstrip("/")
    try:
        with httpx.Client(timeout=3.0) as client:
            response = client.get(f"{base}/api/tags")
        if response.status_code != 200:
            return []
        entries = response.json().get("models") or []
    except Exception:
        return []

    writers = []
    for entry in entries:
        model_id = entry.get("name")
        if not model_id:
            continue
        capabilities = [str(c).lower() for c in (entry.get("capabilities") or [])]
        if "embedding" in capabilities:
            continue
        family = ((entry.get("details") or {}).get("family") or "").lower()
        if "bert" in family or not _usable(model_id):
            continue
        writers.append(model_id)
    return writers


class Generator:
    """Where the page will be asked for, and how to say so."""

    def __init__(self, provider: str, model: str, api_key: str = "") -> None:
        self.provider = provider
        self.model = model
        self.api_key = api_key

    @property
    def described(self) -> str:
        if self.provider == "ollama":
            return f"generated locally by {self.model}"
        return f"generated by {self.model} ({self.provider})"


#: How many of one provider's models are worth trying before moving to the
#: next provider. Three covers a retired first choice and a second choice
#: this account happens not to be enabled for, without turning one page into
#: a dozen requests.
CANDIDATES_PER_PROVIDER = 3


def _spread(provider: str, ranked: list[str]) -> list[str]:
    """The ranked models, re-ordered so the tries are not all the same thing.

    Straight down the ranking, Google's top three here were all Pro variants -
    and Pro has no free tier at all: the quota it reports is "limit: 0". Three
    attempts, three refusals, and the Flash model that would have worked was
    never reached.

    So the best of each kind is tried before the second-best of any kind.
    """
    buckets: dict[int, list[str]] = {}
    order = _PREFERENCES.get(provider, ())
    for model in ranked:
        low = model.lower()
        tier = next((i for i, pattern in enumerate(order) if pattern in low),
                    len(order))
        buckets.setdefault(tier, []).append(model)

    spread: list[str] = []
    depth = 0
    while any(len(models) > depth for models in buckets.values()):
        for tier in sorted(buckets):
            if len(buckets[tier]) > depth:
                spread.append(buckets[tier][depth])
        depth += 1
    return spread

def candidates() -> tuple[list[Generator], list[str]]:
    """Everything that could build the site, best first, and what was skipped.

    A list rather than a single choice, because being listed by a provider
    does not mean a model can be used: this installation is offered
    gemini-2.5-pro and then told, on asking, that it is "no longer available
    to new users". Only a request settles it, so the caller tries them in
    turn.
    """
    found: list[Generator] = []
    skipped: list[str] = []
    for provider, env_name in PROVIDER_ORDER:
        api_key = _key_for(env_name)
        if not api_key:
            continue
        model_ids, problem = _list_models(provider, api_key)
        ranked = rank_models(provider, model_ids)
        if not ranked:
            skipped.append("%s was skipped: %s"
                           % (provider, problem or "no model of its own suited this"))
            continue
        for model in _spread(provider, ranked)[:CANDIDATES_PER_PROVIDER]:
            found.append(Generator(provider, model, api_key))

    local = _local_models()
    if local:
        # Bigger and coder-tuned first, by name, since the local server does
        # not rank its own models.
        local.sort(key=lambda m: (0 if "coder" in m.lower() else 1, -len(m)))
        found.extend(Generator("ollama", m) for m in local[:CANDIDATES_PER_PROVIDER])

    return found, skipped


def nothing_available(skipped: list[str]) -> str:
    """Why no site could be built, said so a person can act on it."""
    if skipped:
        return "; ".join(skipped)
    if _reachable_local_server():
        return ("no provider key is set, and the local model server has only "
                "embedding models installed - those cannot write a page. "
                "Install a chat model, or add a provider key in Settings")
    return ("no provider key is set and no local model server is running, so "
            "there was nothing to build the site with")

def _reachable_local_server() -> bool:
    try:
        with httpx.Client(timeout=3.0) as client:
            return client.get(f"{settings.OLLAMA_URL.rstrip('/')}/api/tags").status_code == 200
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Talking to it
# ---------------------------------------------------------------------------

#: A whole website is a long completion. The old limit was 8192 tokens, which
#: a page with real content and real styling passes easily - and a reply that
#: stopped at the limit was then discarded for having no closing tag, so the
#: more the model wrote the likelier it was to be thrown away.
MAX_OUTPUT_TOKENS = 16000

#: Long, because a page is long and a cold local model has to load first.
_TIMEOUT = httpx.Timeout(900.0, connect=10.0)


def ask(generator: Generator, system: str, user: str) -> tuple[str, str]:
    """One completion. Returns (text, error); exactly one of them is filled."""
    provider, model, api_key = generator.provider, generator.model, generator.api_key
    try:
        if provider == "ollama":
            with httpx.Client(timeout=_TIMEOUT) as client:
                response = client.post(
                    f"{settings.OLLAMA_URL.rstrip('/')}/api/chat",
                    json={
                        "model": model,
                        "messages": [{"role": "system", "content": system},
                                     {"role": "user", "content": user}],
                        "stream": False,
                        "think": False,
                        "options": {"temperature": 0.6, "num_predict": MAX_OUTPUT_TOKENS},
                    },
                )
            if response.status_code != 200:
                return "", f"the local model returned HTTP {response.status_code}"
            return (response.json().get("message") or {}).get("content") or "", ""

        if provider == "anthropic":
            with httpx.Client(timeout=_TIMEOUT) as client:
                response = client.post(
                    f"{_ENDPOINTS['anthropic']}/messages",
                    headers={"x-api-key": api_key,
                             "anthropic-version": "2023-06-01",
                             "Content-Type": "application/json"},
                    json={"model": model, "system": system,
                          "messages": [{"role": "user", "content": user}],
                          "max_tokens": MAX_OUTPUT_TOKENS, "temperature": 0.7},
                )
            if response.status_code != 200:
                return "", _explain(response, model)
            data = response.json()
            return "".join(str(b.get("text", "")) for b in (data.get("content") or [])
                           if b.get("type") == "text"), ""

        if provider == "gemini":
            with httpx.Client(timeout=_TIMEOUT) as client:
                response = client.post(
                    f"{_ENDPOINTS['gemini']}/models/{model}:generateContent",
                    params={"key": api_key},
                    json={"systemInstruction": {"parts": [{"text": system}]},
                          "contents": [{"role": "user", "parts": [{"text": user}]}],
                          "generationConfig": {"temperature": 0.7,
                                               "maxOutputTokens": MAX_OUTPUT_TOKENS}},
                )
            if response.status_code != 200:
                return "", _explain(response, model)
            candidates = response.json().get("candidates") or [{}]
            parts = (candidates[0].get("content") or {}).get("parts") or []
            return "".join(p.get("text", "") for p in parts), ""

        endpoint = _ENDPOINTS.get(provider)
        if not endpoint:
            return "", f"{provider} is not a provider this can talk to"
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        if provider == "openrouter":
            headers.update({"HTTP-Referer": "http://localhost:3003", "X-Title": "SMARAN.AI"})
        with httpx.Client(timeout=_TIMEOUT) as client:
            response = client.post(
                f"{endpoint}/chat/completions", headers=headers,
                json={"model": model,
                      "messages": [{"role": "system", "content": system},
                                   {"role": "user", "content": user}],
                      "max_tokens": MAX_OUTPUT_TOKENS, "temperature": 0.7},
            )
        if response.status_code != 200:
            return "", _explain(response, model)
        choices = response.json().get("choices") or [{}]
        return (choices[0].get("message") or {}).get("content") or "", ""
    except Exception as exc:
        return "", f"the request to {model} failed ({str(exc)[:120]})"


def _explain(response: httpx.Response, model: str) -> str:
    """What the provider said, rather than only that it said something.

    A status on its own sends people to check a key that is fine. The body
    carries the actual reason - a quota, a model that is not enabled for this
    account, a region - and it costs nothing to pass it on.
    """
    detail = ""
    try:
        body = response.json()
        detail = (body.get("error") or {}).get("message") or ""
        if not detail and isinstance(body.get("error"), str):
            detail = body["error"]
    except Exception:
        detail = response.text[:200]
    if response.status_code == 429:
        return f"{model} is over a usage limit. {detail}".strip()
    if response.status_code in (401, 403):
        return f"{model} refused the saved key. {detail}".strip()
    return f"{model} answered HTTP {response.status_code}. {detail}".strip()


# ---------------------------------------------------------------------------
# What to ask for
# ---------------------------------------------------------------------------

BUILD_INSTRUCTIONS = """You are a senior front-end developer and designer building a complete website from a brief.

Return ONE HTML document and nothing else - no explanation, no markdown fence. It must begin with <!doctype html> and end with </html>.

All CSS goes in a <style> tag and all JavaScript in a <script> tag, so the file opens on its own with no build step. Do not link to external stylesheets, fonts, images or scripts: nothing loaded over the network will be there. Use system font stacks, CSS gradients, and inline SVG for anything visual.

Build what the brief asks for, in full:
- Every section it names, in the order it implies, with real content in each.
- If it describes several pages, build them as sections of this one document with in-page navigation, so every one of them exists.
- Real, specific copy about this actual subject: names, numbers, prices, dates, words a person from this business would use. Never "Lorem ipsum", "Feature one", "Your text here", or a section left as a heading with nothing under it.
- A palette, type scale and layout chosen to suit this subject, not a default dark page with a purple gradient.
- Responsive down to 360px wide, with the navigation and any grid actually reflowing.
- Working interaction where the brief implies it: a mobile menu that opens, tabs that switch, a form that validates, written in plain JavaScript.

The <title> and the main heading must be the site name you are given, exactly. Never put your own name, or the name of the model you are, anywhere in the page."""

POLISH_INSTRUCTIONS = """You are a design director reviewing a finished web page before it ships.

You will be given a complete HTML document. Return the improved document and nothing else - no explanation, no markdown fence, beginning with <!doctype html> and ending with </html>.

Improve it as a designer would, without changing what the page is about and without removing any of its content or sections:
- Typography: a real scale, line lengths that read, headings that are not all the same weight.
- Spacing: consistent rhythm, generous section padding, alignment that holds.
- Colour: a considered palette with enough contrast to pass WCAG AA on body text.
- Depth and detail: borders, shadows and radii used consistently; hover, focus and active states on everything interactive; a visible focus ring for keyboard users.
- Motion: subtle transitions only, and honour prefers-reduced-motion.
- Check it still holds together at 360px wide.

Keep every section, every piece of copy and every working script. This pass makes the same page better; it does not make a different page."""


#: A model that is listed is not a model that can be used. Being offered
#: gemini-2.5-pro and then told it is "no longer available to new users", or
#: being offered eighty NVIDIA models that every one answer 404, is the
#: normal case rather than the odd one. So each candidate is asked one tiny
#: question first, on a short leash, and only something that actually answers
#: is given the several minutes a real page takes.
#:
#: Without this a machine whose keys have all expired spent ten minutes
#: walking dead models at the full timeout before saying so.
PROBE_TIMEOUT = httpx.Timeout(25.0, connect=8.0)
PROBE_TOKENS = 16


def answers(generator: Generator) -> tuple[bool, str]:
    """Does this model reply at all? One short question settles it."""
    global MAX_OUTPUT_TOKENS, _TIMEOUT
    full_tokens, full_timeout = MAX_OUTPUT_TOKENS, _TIMEOUT
    MAX_OUTPUT_TOKENS, _TIMEOUT = PROBE_TOKENS, PROBE_TIMEOUT
    try:
        text, error = ask(generator, "Reply with one word.", "Say READY.")
    finally:
        MAX_OUTPUT_TOKENS, _TIMEOUT = full_tokens, full_timeout
    if error:
        return False, error
    if not text.strip():
        return False, "it answered with nothing"
    return True, ""

def _extract(text: str) -> Optional[str]:
    """The document out of a reply, or None if there is not one.

    Models fence HTML even when told not to, so the fence is stripped rather
    than treated as failure.
    """
    if not text:
        return None
    fence = re.search(r"```(?:html)?\s*(.*?)```", text, re.DOTALL | re.IGNORECASE)
    if fence:
        text = fence.group(1)
    start = re.search(r"<!doctype html|<html\b", text, re.IGNORECASE)
    if not start:
        return None
    document = text[start.start():]
    end = document.lower().rfind("</html>")
    if end == -1:
        return None
    document = document[:end + 7].strip()
    return document if len(document) > 400 else None


def _looks_started(text: str) -> bool:
    return bool(text) and bool(re.search(r"<!doctype html|<html\b", text, re.IGNORECASE))


#: How many times a reply that stopped mid-page is asked to carry on. Two is
#: enough to finish a long page, and few enough that a model looping on itself
#: cannot cost an afternoon.
MAX_CONTINUATIONS = 2


def _complete(generator: Generator, system: str, user: str) -> tuple[Optional[str], str]:
    """One page, finishing it if the reply stopped short.

    A reply that runs out of tokens has no </html>, and used to be discarded
    entirely: a whole page thrown away for want of a closing tag, so the more
    the model wrote the likelier it was to be lost. Asking it to continue from
    where it stopped keeps the work.
    """
    text, error = ask(generator, system, user)
    if error:
        return None, error

    for _ in range(MAX_CONTINUATIONS):
        document = _extract(text)
        if document:
            return document, ""
        if not _looks_started(text):
            break
        tail = text[-2000:]
        more, error = ask(
            generator,
            "You are continuing an HTML document that was cut off mid-way. "
            "Reply with the remaining text only - no explanation, no fence, and "
            "do not repeat anything you are shown. Finish the document properly "
            "with </html>.",
            "%s\n\nThe document so far ends like this. Continue from exactly "
            "this point:\n\n%s" % (user, tail),
        )
        if error or not more:
            break
        text += more

    document = _extract(text)
    if document:
        return document, ""
    if _looks_started(text):
        return None, ("the model started a page but never finished one, even "
                      "after being asked to continue")
    return None, "the model replied, but not with an HTML document"


def _force_title(document: str, name: str) -> str:
    """Make the title the site's name.

    This is a backstop, not a correction. Titles used to come out wrong
    because the model was being told the wrong name, and that is fixed at the
    source now. It is kept because the name is the one thing known for
    certain, and only the title element and a heading repeating it are
    touched; the rest of the page is the model's.
    """
    import html as _html

    safe = _html.escape(name.strip())
    existing = re.search(r"<title[^>]*>(.*?)</title>", document, re.DOTALL | re.IGNORECASE)
    if not existing:
        return document
    wrong = existing.group(1).strip()
    if wrong.casefold() == name.strip().casefold():
        return document
    document = document[:existing.start(1)] + safe + document[existing.end(1):]
    if wrong:
        document = re.sub(
            r"(<h1[^>]*>)\s*" + re.escape(wrong) + r"\s*(</h1>)",
            r"\g<1>" + safe.replace("\\", "\\\\") + r"\g<2>",
            document, count=1, flags=re.IGNORECASE)
    return document


#: A polish pass is kept only if it did not lose most of the page. A model
#: that summarises instead of improving, or that stops early, comes back much
#: shorter, and a shorter page is a page with sections missing.
POLISH_KEEP_RATIO = 0.75


def build(name: str, prompt: str, previous: Optional[str] = None) -> tuple[Optional[str], str]:
    """The site, and how it was made. (None, reason) if it could not be built."""
    generators, skipped = candidates()
    if not generators:
        return None, nothing_available(skipped)

    brief = "Site name: %s\n\nBrief:\n%s" % (name, prompt)
    if previous:
        brief += ("\n\nThis is a revision of an existing page. Here is the "
                  "current document; keep everything that still applies and "
                  "change what the brief above asks for.\n\n" + previous[:60_000])

    document = None
    generator = None
    # One line per provider, not one per model. Three dead NVIDIA models
    # say the same thing three times and push the two that matter - an
    # invalid key and an exhausted free tier - off the end of the message.
    failures: dict[str, str] = {}
    for note in skipped:
        failures.setdefault(note.split(" was skipped:")[0], note)

    for candidate in generators:
        replies, why_not = answers(candidate)
        if not replies:
            failures.setdefault(candidate.provider,
                                "%s could not be used: %s" % (candidate.provider, why_not))
            continue
        document, error = _complete(candidate, BUILD_INSTRUCTIONS, brief)
        if document is not None:
            generator = candidate
            break
        failures.setdefault(candidate.provider,
                            "%s could not be used: %s" % (candidate.provider, error))

    if document is None or generator is None:
        return None, ("; ".join(failures.values())
                      or "nothing could build the site")

    # The pass that shows. See the note at the top of this module.
    polished, polish_error = _complete(
        generator, POLISH_INSTRUCTIONS,
        "Site name: %s\n\nThe brief this was built from:\n%s\n\n"
        "The document to improve:\n\n%s" % (name, prompt, document))
    used_polish = False
    if polished and len(polished) >= len(document) * POLISH_KEEP_RATIO:
        document, used_polish = polished, True

    how = generator.described
    if used_polish:
        how += ", then refined in a second pass"
    elif polish_error:
        # Said rather than hidden: the page is real, one of the two passes did
        # not happen, and that is worth knowing when judging the result.
        how += " (the refinement pass did not run: %s)" % polish_error
    passed_over = [note for provider, note in failures.items()
                   if provider != generator.provider]
    if passed_over:
        # What was preferred and could not be used is worth a sentence.
        # Otherwise a dead key just quietly stops mattering, and the page
        # gets built by the second choice for months with nobody the wiser.
        how += ". " + "; ".join(passed_over[:3])
    return _force_title(document, name), how
