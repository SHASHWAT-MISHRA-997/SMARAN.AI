"""An answer engine in the manner of Perplexity: search, read, cite, suggest.

What the research on Perplexity and on generative search in general says,
and what this does about each:

* Retrieval first, and citations assigned while the evidence is assembled,
  not added afterwards (Perplexity's own description; DataStudios analysis).
  Every source here gets its number before the model sees it, and the model
  is told to cite those numbers and nothing else.
* Pro Search plans, then searches step by step, and shows the steps
  (LangChain case study with Perplexity). `pro` asks a model for a short plan
  of search queries, runs them together, and reports each step as it goes.
* Deep Research loops: search, read, ask what is still missing, search again
  (Perplexity, Feb 2025). `deep` does up to three such rounds.
* Answers read well but cite badly: only about half of the sentences from
  commercial engines were fully supported by their citations, and about a
  quarter of citations did not support their sentence (Liu, Zhang & Liang,
  "Evaluating Verifiability in Generative Search Engines", EMNLP 2023).
  So every answer is checked afterwards: citations to sources that do not
  exist are removed, and citation coverage and support are measured and shown
  rather than assumed.
* Open-source engines that check the model's citation numbers against the
  real source list (e.g. Ant6009/42) instead of trusting them.
* Related questions after the answer (Perplexity; Perplexica, simplexity).
* Focus: all of the web, academic papers, news, or discussions.

The engine never calls a model itself: it is handed `llm(messages) -> str`,
so it runs with whatever the router picked, cloud or local.
"""
from __future__ import annotations

import concurrent.futures
import json
import logging
import math
import re
import time
import urllib.parse
from typing import Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

MODES = ("quick", "pro", "deep")
FOCUSES = ("web", "academic", "news", "discussions")

FOCUS_SITES = {
    "academic": ("arxiv.org", "semanticscholar.org", "researchgate.net", "pubmed.ncbi.nlm.nih.gov",
                 "aclanthology.org", "nature.com", "sciencedirect.com", "ieeexplore.ieee.org",
                 "dl.acm.org", "springer.com", "journals.plos.org", "scholar.archive.org"),
    "discussions": ("reddit.com", "stackoverflow.com", "stackexchange.com", "news.ycombinator.com",
                    "quora.com", "github.com"),
}

# How much each mode does. Deep reads more and loops; quick answers fast.
PLAN = {
    "quick": {"queries": 1, "results": 8, "read": 5, "rounds": 1},
    "pro": {"queries": 4, "results": 6, "read": 8, "rounds": 1},
    "deep": {"queries": 4, "results": 8, "read": 10, "rounds": 3},
}

PAGE_TIMEOUT = 6
PASSAGE_CHARS = 700
STOP = set("""a an and are as at be by for from has have how i in is it its of on or that the this to was
were what when where which who why will with you your about into than then there these those do does did
can could should would may might latest current new vs versus""".split())

Emit = Callable[[Dict], None]
LLM = Callable[[List[Dict]], str]


# Reference and official sources, and the farms that rank well but say
# little (from the parallel Perplexity-style work on this code).
_AUTHORITY = re.compile(
    r"(\.gov(\.[a-z]{2})?$|\.edu$|\.ac\.[a-z]{2}$|wikipedia\.org$|who\.int$|un\.org$|"
    r"docs\.|developer\.|learn\.microsoft\.com$|python\.org$|mozilla\.org$|w3\.org$|ietf\.org$|"
    r"arxiv\.org$|nature\.com$|sciencedirect\.com$|nih\.gov$|github\.com$|reuters\.com$|apnews\.com$|"
    r"bbc\.(com|co\.uk)$|thehindu\.com$|pib\.gov\.in$|rbi\.org\.in$|isro\.gov\.in$)", re.I)
_LOW = re.compile(r"(pinterest\.|quora\.com$|answers\.com$|ehow\.com$|slideshare\.net$|"
                  r"scribd\.com$|coursehero\.com$|brainly\.)", re.I)



def decompose(query: str) -> List[str]:
    """The query plus up to two focused parts when it asks several things."""
    q = re.sub(r"\s+", " ", (query or "").strip())
    parts: List[str] = []
    vs = re.split(r"\s+(?:vs\.?|versus|or|compared (?:to|with))\s+", q, maxsplit=1, flags=re.I)
    if len(vs) == 2 and all(len(p.split()) <= 8 for p in vs):
        # "Compare A vs B": search each side on its own, then together.
        head = re.sub(r"^(?:compare|difference between)\s+", "", vs[0], flags=re.I)
        parts = [head.strip(" ?"), vs[1].strip(" ?")]
    elif q.count("?") >= 2:
        parts = [p.strip() + "?" for p in q.split("?") if len(p.split()) >= 3][:2]
    elif re.search(r"\s+and\s+(?:also\s+)?(?:what|how|why|when|where|who|which|is|are|does|do|can|will|should)\b", q, re.I):
        pieces = re.split(r"\s+and\s+(?:also\s+)?(?=(?:what|how|why|when|where|who|which|is|are|does|do|can|will|should)\b)",
                          q, maxsplit=1, flags=re.I)
        parts = [p.strip(" ?") for p in pieces if len(p.split()) >= 3]
    out = [q]
    for p in parts:
        if p and p.lower() != q.lower() and p not in out:
            out.append(p)
    return out[:3]



# ---------------------------------------------------------------------------
# Searching and reading
# ---------------------------------------------------------------------------

def _terms(text: str) -> List[str]:
    return [t for t in re.findall(r"[a-z0-9][a-z0-9.+#-]*", (text or "").lower()) if t not in STOP and len(t) > 1]


def _domain(url: str) -> str:
    host = urllib.parse.urlparse(url or "").hostname or ""
    return host[4:] if host.startswith("www.") else host


def _with_focus(query: str, focus: str) -> str:
    sites = FOCUS_SITES.get(focus)
    if not sites:
        return query
    return "%s (%s)" % (query, " OR ".join("site:%s" % s for s in sites[:6]))


def search(query: str, focus: str = "web", max_results: int = 8) -> List[Dict]:
    """Result list for one query: title, url, snippet, date if known."""
    from ddgs import DDGS

    rows: List[Dict] = []
    try:
        engine = DDGS()
        if focus == "news":
            for item in engine.news(query, max_results=max_results):
                rows.append({"title": item.get("title", ""), "url": item.get("url") or item.get("href", ""),
                             "snippet": item.get("body", ""), "date": (item.get("date") or "")[:10],
                             "publisher": item.get("source", "")})
        else:
            for item in engine.text(_with_focus(query, focus), max_results=max_results):
                rows.append({"title": item.get("title", ""), "url": item.get("href", ""),
                             "snippet": item.get("body", "")})
    except Exception as exc:  # noqa: BLE001 - one failed search is not the whole answer
        logger.warning("search failed for %r: %s", query, exc)
    return [r for r in rows if r["url"].startswith(("http://", "https://")) and not _MIRROR.search(_domain(r["url"]))]


# Proxies and mirrors of other sites ("www-python-org.nproxy.org"): the real
# site, if it matters, is in the results too.
_MIRROR = re.compile(r"(proxy|mirror|translate\.goog|webcache|archive\.(ph|is|today)|cachedview)", re.I)


def read_page(url: str, timeout: int = PAGE_TIMEOUT) -> str:
    """The readable text of one public page, quickly, or '' if it will not come."""
    from bs4 import BeautifulSoup

    from app.utils import _safe_public_get

    try:
        response = _safe_public_get(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.8"}, timeout=timeout)
        if response.status_code >= 400:
            return ""
        kind = response.headers.get("content-type", "")
        if kind and "html" not in kind and "text" not in kind:
            return ""
        soup = BeautifulSoup(response.text[:2_000_000], "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "header", "aside", "form", "iframe",
                         "svg", "noscript", "button"]):
            tag.decompose()
        # Tables stay tables: one line per row, cells joined with " | ".
        # Flattened to one cell per line, a release table became a column of
        # loose numbers, and a model read "3.16 ... 2016" out of it.
        for table in soup.find_all("table"):
            rows = []
            for tr in table.find_all("tr"):
                cells = [c.get_text(" ", strip=True) for c in tr.find_all(["th", "td"])]
                if any(cells):
                    rows.append(" | ".join(cells))
            table.replace_with(soup.new_string("\n" + "\n".join(rows) + "\n"))
        main = soup.find("article") or soup.find("main") or soup.body or soup
        lines = [line.strip() for line in main.get_text("\n").splitlines()]
        return "\n".join(line for line in lines if len(line) > 2)[:60000]
    except Exception as exc:  # noqa: BLE001 - a blocked page falls back to its snippet
        logger.debug("could not read %s: %s", url, exc)
        return ""


def _passages(text: str) -> List[str]:
    """Split a page into passages of about PASSAGE_CHARS, on paragraph lines."""
    out, current = [], ""
    for line in (text or "").splitlines():
        if len(current) + len(line) + 1 > PASSAGE_CHARS and current:
            out.append(current)
            current = ""
        current = (current + "\n" + line).strip() if current else line
        while len(current) > PASSAGE_CHARS * 2:
            out.append(current[:PASSAGE_CHARS])
            current = current[PASSAGE_CHARS:]
    if current:
        out.append(current)
    return out


def _bm25(passages: List[str], query_terms: List[str]) -> List[float]:
    """BM25 over the passages of one answer's sources."""
    docs = [_terms(p) for p in passages]
    if not docs:
        return []
    avg = sum(len(d) for d in docs) / len(docs) or 1.0
    unique = set(query_terms)
    df = {t: sum(1 for d in docs if t in d) for t in unique}
    scores = []
    for doc in docs:
        length = len(doc) or 1
        counts = {}
        for word in doc:
            if word in unique:
                counts[word] = counts.get(word, 0) + 1
        score = 0.0
        for term, tf in counts.items():
            idf = math.log(1 + (len(docs) - df[term] + 0.5) / (df[term] + 0.5))
            score += idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * length / avg))
        scores.append(score)
    return scores


# ---------------------------------------------------------------------------
# Planning
# ---------------------------------------------------------------------------

def _json_list(text: str) -> List[str]:
    match = re.search(r"\[[\s\S]*\]", text or "")
    if not match:
        return []
    try:
        items = json.loads(match.group(0))
    except ValueError:
        return []
    return [str(item).strip() for item in items if str(item).strip()][:6]


_RELATIVE = (
    (r"\b(today|aaj)\b", lambda now: now.strftime("%d %B %Y")),
    (r"\b(yesterday|kal)\b", lambda now: time.strftime("%d %B %Y", time.localtime(time.time() - 86400))),
    (r"\b(this|current) (month|week)\b", lambda now: now.strftime("%B %Y")),
    (r"\b(this|current) year\b", lambda now: now.strftime("%Y")),
)
_TIMELY = re.compile(r"\b(news|latest|today|yesterday|this (week|month|year)|announce\w*|recent\w*|update\w*|"
                     r"breaking|launch\w*|release\w*|score|result\w*|election|price\w*|abhi|aaj)\b", re.I)


def dated(query: str) -> str:
    """'this month' means nothing to a search engine; 'September 2026' does."""
    import datetime as _dt
    now = _dt.datetime.now()
    for pattern, value in _RELATIVE:
        query = re.sub(pattern, lambda _m, v=value: v(now), query, flags=re.I)
    return query


def is_timely(question: str) -> bool:
    return bool(_TIMELY.search(question or ""))


def plan_queries(question: str, history: List[Dict], mode: str, llm: Optional[LLM]) -> List[str]:
    """Search queries for the question: the question itself, or a model's short plan."""
    wanted = PLAN[mode]["queries"] if llm is not None else 3
    context = "\n".join("%s: %s" % (m["role"], str(m["content"])[:300]) for m in history[-4:])
    if llm is None or wanted <= 1:
        if history and len(question.split()) < 6:
            # A short follow-up ("and its price?") searched alone finds nothing.
            last_user = next((m["content"] for m in reversed(history) if m["role"] == "user"), "")
            return [dated(("%s %s" % (str(last_user)[:120], question)).strip())]
        return [dated(q) for q in decompose(question)]
    prompt = (
        "Plan a web search. Write %d short, specific search-engine queries that together find "
        "everything needed to answer the question well. Make each query stand alone (resolve "
        "words like 'it' from the conversation). Include one query aimed at an official or "
        "primary source when that matters. Reply with a JSON array of strings only.\n\n"
        "Today is %s.\nConversation so far:\n%s\n\nQuestion: %s"
        % (wanted, time.strftime("%d %B %Y"), context or "(none)", question))
    try:
        queries = _json_list(llm([{"role": "user", "content": prompt}]))
    except Exception as exc:  # noqa: BLE001 - the question itself is still a query
        logger.info("planning failed, searching the question as written: %s", exc)
        queries = []
    return [dated(q) for q in (queries or [question])][:wanted]


def missing_queries(question: str, notes: str, llm: Optional[LLM], asked: List[str]) -> List[str]:
    """Deep Research: what the sources so far do not cover, as new queries."""
    if llm is None:
        return []
    prompt = (
        "You are researching: %s\n\nWhat has been found so far (source titles and key lines):\n%s\n\n"
        "Already searched: %s\n\nWhat important part of the question is still not covered, or "
        "which claims conflict and need checking? Reply with a JSON array of up to 3 new search "
        "queries, or [] if the sources already cover it." % (question, notes[:6000], "; ".join(asked)))
    try:
        return [q for q in _json_list(llm([{"role": "user", "content": prompt}])) if q not in asked][:3]
    except Exception as exc:  # noqa: BLE001
        logger.info("gap analysis failed: %s", exc)
        return []


# ---------------------------------------------------------------------------
# The research
# ---------------------------------------------------------------------------

def research(question: str, *, mode: str = "quick", focus: str = "web", history: Optional[List[Dict]] = None,
             llm: Optional[LLM] = None, emit: Emit = lambda _e: None,
             budget_chars: int = 14000) -> Dict:
    """Search and read for the question. Returns numbered sources and the evidence text."""
    mode = mode if mode in MODES else "quick"
    focus = focus if focus in FOCUSES else "web"
    settings = PLAN[mode]
    history = history or []
    started = time.time()

    queries = plan_queries(question, history, mode, llm)
    asked: List[str] = []
    found: Dict[str, Dict] = {}          # url -> result, in the order found
    pages: Dict[str, str] = {}
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=8)
    try:
        for round_number in range(1, settings["rounds"] + 1):
            if not queries:
                break
            emit({"type": "research_step", "stage": "search", "round": round_number,
                  "text": "Searching" if round_number == 1 else "Looking for what is still missing",
                  "queries": queries})
            jobs = [(q, focus) for q in queries]
            if focus == "web" and round_number == 1 and is_timely(question):
                # Timely questions also ask the news index, which has what
                # happened this week that the web index may not yet rank.
                jobs.append((queries[0], "news"))
            for results in pool.map(lambda job: search(job[0], job[1], settings["results"]), jobs):
                for row in results:
                    found.setdefault(row["url"].split("#")[0], row)
            asked.extend(queries)

            to_read = [url for url in list(found)[: settings["read"] * round_number] if url not in pages]
            if to_read:
                emit({"type": "research_step", "stage": "read", "round": round_number,
                      "text": "Reading %d sources" % len(to_read),
                      "sources": [{"title": found[u]["title"], "domain": _domain(u)} for u in to_read]})
                for url, text in zip(to_read, pool.map(read_page, to_read)):
                    pages[url] = text

            if round_number < settings["rounds"]:
                notes = "\n".join("- %s: %s" % (found[u]["title"], (pages.get(u) or found[u]["snippet"])[:300])
                                  for u in list(found)[:12])
                queries = missing_queries(question, notes, llm, asked)
    finally:
        pool.shutdown(wait=False, cancel_futures=True)

    sources = _select(question, asked, found, pages, budget_chars)
    emit({"type": "research_step", "stage": "done", "text": "Read %d of %d sources found in %.1f s"
          % (sum(1 for s in sources if s["read"]), len(found), time.time() - started),
          "seconds": round(time.time() - started, 1)})
    return {"sources": sources, "queries": asked, "mode": mode, "focus": focus,
            "seconds": round(time.time() - started, 1)}


def _select(question: str, queries: List[str], found: Dict[str, Dict], pages: Dict[str, str],
            budget_chars: int) -> List[Dict]:
    """The best passages across every page, grouped by source and numbered."""
    query_terms = _terms(question + " " + " ".join(queries))
    candidates = []   # (score, url, passage)
    for url, row in found.items():
        text = pages.get(url) or ""
        chunks = _passages(text) if text else []
        if row.get("snippet"):
            chunks.append(row["snippet"])
        for chunk in chunks:
            candidates.append((url, chunk))
    scores = _bm25([c[1] for c in candidates], query_terms)
    ranked = sorted(zip(scores, range(len(candidates))), reverse=True)

    chosen: Dict[str, List[str]] = {}
    used = 0
    for score, index in ranked:
        url, passage = candidates[index]
        if score <= 0 and chosen:
            break
        if len(chosen.get(url, [])) >= 3 or passage in chosen.get(url, []):
            continue
        if used + len(passage) > budget_chars:
            continue
        chosen.setdefault(url, []).append(passage)
        used += len(passage)

    # Official sources first - a query word in the domain, python.org for
    # Python - then the search engine's own order.
    official_terms = [t for t in query_terms if len(t) >= 4]
    def official(url: str) -> int:
        labels = _domain(url).split(".")
        return 1 if any(term in labels[:-1] for term in official_terms) else 0
    def standing(url: str) -> int:
        host = _domain(url)
        return official(url) * 2 + (1 if _AUTHORITY.search(host) else 0) - (2 if _LOW.search(host) else 0)
    order, per_site = [], {}
    for url in sorted((u for u in found if u in chosen), key=lambda u: -standing(u)):
        # At most two sources from one site, so one site cannot be every citation.
        site = _domain(url)
        if per_site.get(site, 0) >= 2:
            continue
        per_site[site] = per_site.get(site, 0) + 1
        order.append(url)
    sources = []
    for number, url in enumerate(order[:12], 1):
        row = found[url]
        sources.append({"n": number, "title": (row.get("title") or _domain(url))[:200], "url": url,
                        "domain": _domain(url), "date": row.get("date", ""),
                        "snippet": (row.get("snippet") or chosen[url][0])[:300],
                        "passages": chosen[url], "read": bool(pages.get(url))})
    return sources


# ---------------------------------------------------------------------------
# Writing, checking and following up
# ---------------------------------------------------------------------------

def evidence_block(sources: List[Dict]) -> str:
    """The sources as the model sees them: numbered, dated, with passages."""
    parts = []
    for src in sources:
        head = "[%d] %s (%s%s)" % (src["n"], src["title"], src["domain"], ", " + src["date"] if src["date"] else "")
        parts.append(head + "\n" + "\n...\n".join(src["passages"]))
    return "\n\n".join(parts)


INSTRUCTIONS = (
    "Answer the question using the numbered sources below. Rules:\n"
    "1. After every sentence that states a fact, cite the sources that support it as [1] or [1][3]. "
    "Use only the numbers given; never cite a source for something it does not say.\n"
    "2. Prefer official and primary sources. If sources disagree, say so and cite both sides.\n"
    "3. For 'latest', 'current' or version questions, give the newest stable release and its date as "
    "the sources state them; do not report betas or development branches as stable.\n"
    "4. If the sources do not answer something, say that plainly instead of guessing.\n"
    "5. Start with a direct answer in one or two sentences, then details. Use short sections or "
    "bullets when it helps. Do not list the sources or URLs at the end - the numbers are enough.\n"
    "Today's date is %s."
)


def normalise_citations(text: str) -> str:
    """Citations in the shape the model used, as [n].

    gpt-oss cites in its own style - U+3010 n U+3011, sometimes with a dagger
    and line range after the number - which the screen showed as plain text
    and the checks below did not count.
    """
    return re.sub(r"\u3010(\d{1,2})(?:\u2020[^\u3011]*)?\u3011", r"[\1]", text or "")


def verify(answer: str, sources: List[Dict]) -> Dict:
    """Citation checks after the fact (Liu et al., 2023): what is cited, and whether it holds."""
    answer = normalise_citations(answer)
    valid = {src["n"]: src for src in sources}
    sentences = [s for s in re.split(r"(?<=[.!?])\s+|\n+", answer or "")
                 if len(re.findall(r"[A-Za-z0-9]", s)) > 20 and not s.strip().startswith(("#", "|"))]
    cited, supported, citations, invalid = 0, 0, 0, 0
    for sentence in sentences:
        numbers = [int(n) for n in re.findall(r"\[(\d{1,2})\]", sentence)]
        if not numbers:
            continue
        cited += 1
        citations += len(numbers)
        invalid += sum(1 for n in numbers if n not in valid)
        words = set(_terms(re.sub(r"\[\d+\]", "", sentence)))
        evidence = set()
        for n in numbers:
            if n in valid:
                evidence |= set(_terms(" ".join(valid[n]["passages"]) + " " + valid[n]["title"]))
        overlap = len(words & evidence) / max(1, len(words))
        if overlap >= 0.5:
            supported += 1
    return {
        "sentences": len(sentences),
        "cited_sentences": cited,
        "citation_recall": round(cited / len(sentences), 2) if sentences else None,
        "supported_sentences": supported,
        "citation_support": round(supported / cited, 2) if cited else None,
        "invalid_citations": invalid,
        "method": "word overlap between each cited sentence and its sources' passages",
    }


def clean_citations(answer: str, sources: List[Dict]) -> str:
    """Drop citation numbers that point at no source - the model's, not ours."""
    valid = {src["n"] for src in sources}
    return re.sub(r"\[(\d{1,2})\]", lambda m: m.group(0) if int(m.group(1)) in valid else "", answer or "")


def related_questions(question: str, answer: str, llm: Optional[LLM]) -> List[str]:
    if llm is None or not answer.strip():
        return []
    prompt = ("Suggest 3 short follow-up questions a curious person would ask next after this answer. "
              "Each under 12 words, specific, not repeating what was answered. Reply with a JSON array "
              "of strings only.\n\nQuestion: %s\n\nAnswer: %s" % (question, answer[:3000]))
    try:
        return [q.rstrip("?") + "?" for q in _json_list(llm([{"role": "user", "content": prompt}]))][:3]
    except Exception as exc:  # noqa: BLE001 - follow-ups are a nicety
        logger.info("related questions failed: %s", exc)
        return []
