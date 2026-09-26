"""A Perplexity-style answer engine over SMARAN's web search.

What it does differently from a single search, following how Perplexity
describes its own pipeline (retrieve widely, rank, read, then write with
citations assigned while the context is assembled - not added afterwards):

  1. Decompose   a compound question ("X vs Y", "A and B", several
                 questions in one) into up to three focused searches.
  2. Retrieve    all of them in parallel; merge and de-duplicate by URL.
  3. Rank        by how much of the question each result covers, with
                 primary/reference sources (official docs, .gov, .edu,
                 Wikipedia, standards bodies) ahead of content farms.
  4. Read        the top pages themselves - not only the search snippet -
                 keeping the passages that match the question.
  5. Number      every source [1]..[n] in the context, and require an inline
                 [n] after each claim, using only those numbers.
  6. Follow up   with three related questions the reader can tap.

Nothing here calls a language model: it is fast, and it works the same with
a local model or a cloud one.
"""

from __future__ import annotations

import re
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from typing import Dict, List

from app.web_search import _relevant_page_excerpt, perform_web_search

_STOP = {"the", "and", "for", "are", "was", "what", "which", "who", "how", "why", "when", "where",
         "does", "did", "with", "from", "that", "this", "about", "into", "than", "then", "there",
         "their", "have", "has", "will", "would", "should", "could", "can", "you", "your", "vs",
         "versus", "compare", "between", "difference", "kya", "hai", "hain", "kaise", "kyu", "kyon"}

_AUTHORITY = re.compile(
    r"(\.gov(\.[a-z]{2})?$|\.edu$|\.ac\.[a-z]{2}$|wikipedia\.org$|who\.int$|un\.org$|"
    r"docs\.|developer\.|learn\.microsoft\.com$|python\.org$|mozilla\.org$|w3\.org$|ietf\.org$|"
    r"arxiv\.org$|nature\.com$|sciencedirect\.com$|nih\.gov$|github\.com$|reuters\.com$|apnews\.com$|"
    r"bbc\.(com|co\.uk)$|thehindu\.com$|pib\.gov\.in$|rbi\.org\.in$|isro\.gov\.in$)", re.I)
_LOW = re.compile(r"(pinterest\.|quora\.com$|answers\.com$|ehow\.com$|slideshare\.net$|"
                  r"scribd\.com$|coursehero\.com$|brainly\.)", re.I)


def terms(text: str) -> set:
    return {t for t in re.findall(r"[a-z0-9ऀ-ॿ]{3,}", (text or "").lower()) if t not in _STOP}


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


def _host(url: str) -> str:
    return (urllib.parse.urlparse(url).hostname or "").lower().removeprefix("www.")


def _norm(url: str) -> str:
    u = urllib.parse.urlparse(url)
    return f"{_host(url)}{u.path.rstrip('/')}".lower()


def rank(query: str, results: List[Dict], limit: int) -> List[Dict]:
    """Best sources first: coverage of the question, then authority, then order found."""
    wanted = terms(query)
    scored = []
    seen_hosts: Dict[str, int] = {}
    for position, item in enumerate(results):
        host = _host(item.get("url", ""))
        text_terms = terms(item.get("title", "") + " " + item.get("snippet", ""))
        coverage = len(wanted & text_terms) / max(1, len(wanted))
        score = coverage * 3.0
        if _AUTHORITY.search(host):
            score += 1.0
        if _LOW.search(host):
            score -= 1.5
        score -= position * 0.02
        scored.append((score, position, item))
    ranked = []
    for score, _, item in sorted(scored, key=lambda s: (-s[0], s[1])):
        host = _host(item.get("url", ""))
        # At most two sources from one site, so one site cannot be every citation.
        if seen_hosts.get(host, 0) >= 2:
            continue
        seen_hosts[host] = seen_hosts.get(host, 0) + 1
        ranked.append(item)
        if len(ranked) >= limit:
            break
    return ranked


def _read(item: Dict, query: str, chars: int) -> Dict:
    from app.utils import fetch_url_content
    try:
        content = fetch_url_content(item["url"])
    except Exception:  # noqa: BLE001 - the snippet stays
        return item
    excerpt = _relevant_page_excerpt(content, query, max_chars=chars)
    if len(excerpt) > len(item.get("snippet", "")):
        return {**item, "snippet": excerpt, "read": True}
    return item


def research(query: str, max_sources: int = 6, read_pages: int = 3, page_chars: int = 1600,
             deadline: float = 12.0) -> Dict:
    """{'queries': [...], 'sources': [{title, url, snippet, read?}]} - sources in citation order."""
    queries = decompose(query)
    merged: List[Dict] = []
    seen = set()
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(perform_web_search, q, 6) for q in queries]
        for future in futures:
            try:
                batch = future.result(timeout=deadline)
            except (FutureTimeout, Exception):  # noqa: BLE001 - one failed search is not all
                continue
            for item in batch or []:
                url = item.get("url", "")
                if not url.startswith("http") or _norm(url) in seen:
                    continue
                seen.add(_norm(url))
                merged.append(item)
    sources = rank(query, merged, max_sources)
    if read_pages and sources:
        with ThreadPoolExecutor(max_workers=read_pages) as pool:
            futures = {i: pool.submit(_read, sources[i], query, page_chars)
                       for i in range(min(read_pages, len(sources)))}
            for i, future in futures.items():
                try:
                    sources[i] = future.result(timeout=deadline)
                except (FutureTimeout, Exception):  # noqa: BLE001 - keep the snippet
                    pass
    return {"queries": queries, "sources": sources}


def context(sources: List[Dict], budget: int) -> str:
    """Numbered evidence for the prompt, within `budget` characters."""
    per = max(300, budget // max(1, len(sources)))
    blocks = []
    for n, s in enumerate(sources, 1):
        blocks.append(f"[{n}] {s.get('title', '').strip()}\nURL: {s.get('url', '')}\n"
                      f"{(s.get('snippet') or '').strip()[:per]}")
    return "\n\n".join(blocks)[:budget]


def instructions(count: int) -> str:
    return (
        f"ANSWER LIKE AN ANSWER ENGINE. You have {count} numbered sources above, [1] to [{count}].\n"
        "- Put the citation right after the sentence it supports, as [n] (or [1][3]); cite only "
        f"numbers from 1 to {count}, never a URL in the text and never a number that is not listed.\n"
        "- Every factual sentence needs a citation. If the sources do not cover something, say so "
        "instead of filling the gap; if they disagree, say which says what.\n"
        "- Start with the direct answer in one or two sentences, then the details (short sections or "
        "bullets when it helps). Prefer official and primary sources.\n"
        "- End with a line '**Related**' followed by exactly three short follow-up questions the "
        "reader might ask next, one per line starting with '- '."
    )


_CITE = re.compile(r"\[(\d{1,2})\]")


def clean_citations(text: str, count: int) -> str:
    """Remove citation numbers that point at no source."""
    return _CITE.sub(lambda m: m.group(0) if 1 <= int(m.group(1)) <= count else "", text or "")
