"""
SMARAN AI — Real-Time Web Search Module (Gemini-Style Search Grounding)

Performs live internet search for real-time web grounding, news, documentation, and web references.
Extracts clean titles, snippets, and URLs to inject into LLM prompt context with clickable citations.
"""

import re
import urllib.parse
import httpx
from typing import List, Dict, Any

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}

def _relevant_page_excerpt(content: str, query: str, max_chars: int = 5000) -> str:
    """Keep broad page context plus lines relevant to the user's question."""
    content = re.sub(r"^URL:\s*https?://\S+\s*$", "", content, flags=re.MULTILINE)
    if len(content) <= max_chars:
        return content
    query_terms = {
        term for term in re.findall(r"[a-zA-Z0-9]{3,}", query.lower())
        if term not in {"http", "https", "www", "com", "what", "this", "that", "from", "with", "about"}
    }
    lines = []
    for raw_line in content.splitlines():
        raw_line = raw_line.strip()
        if not raw_line:
            continue
        lines.extend(raw_line[index:index + 500] for index in range(0, len(raw_line), 500))
    scored = []
    for index, line in enumerate(lines):
        words = set(re.findall(r"[a-zA-Z0-9]{3,}", line.lower()))
        scored.append((len(query_terms & words), -index, line))
    selected = lines[:10]
    if len(lines) > 10:
        step = max(1, len(lines) // 12)
        selected.extend(lines[index] for index in range(10, len(lines), step))
    selected.extend(line for score, _, line in sorted(scored, reverse=True) if score > 0)
    output, seen, length = [], set(), 0
    for line in selected:
        if line in seen or length + len(line) + 1 > max_chars:
            continue
        seen.add(line)
        output.append(line)
        length += len(line) + 1
    return "\n".join(output)

def perform_web_search(query: str, max_results: int = 5) -> List[Dict[str, str]]:
    """
    Execute live web search for query and return list of search results.
    Each result item: {"title": str, "snippet": str, "url": str}
    """
    clean_query = query.strip()
    if not clean_query:
        return []

    results = []
    
    # Find ALL YouTube URLs in the query
    youtube_ids = []
    for m in re.finditer(r"(?:youtube\.com/(?:watch\?[^\s]*?v=|shorts/|live/)|youtu\.be/)([\w-]{6,})", clean_query, re.I):
        vid = m.group(1)
        if vid not in youtube_ids:
            youtube_ids.append(vid)
    
    # Find ALL direct URLs in the query (excluding YouTube)
    direct_urls = []
    for m in re.finditer(r"https?://[^\s<>\]\[\)\(]+", clean_query, re.I):
        url = m.group(0).rstrip(".,;:!?")
        if 'youtube.com' not in url and 'youtu.be' not in url and url not in direct_urls:
            direct_urls.append(url)
    
    source_count = max(1, len(youtube_ids) + len(direct_urls))
    # Keep combined evidence inside small local-model context windows while
    # reserving a fair, deterministic slice for every supplied URL.
    per_source_chars = max(700, min(1400, 2800 // source_count))

    # Process ALL YouTube URLs
    for video_id in youtube_ids:
        video_url = f"https://www.youtube.com/watch?v={video_id}"
        try:
            from app.youtube_analysis import analyze_youtube_video
            result = analyze_youtube_video(video_url, video_id)
            result["snippet"] = _relevant_page_excerpt(result["snippet"], clean_query, max_chars=per_source_chars)
            results.append(result)
        except Exception as error:
            results.append({"title": f"YouTube video {video_id}", "snippet": f"Content extraction failed; do not guess. Error: {error}", "url": video_url, "content_verified": False})
    
    # Process ALL direct URLs
    for url in direct_urls:
        try:
            from app.utils import fetch_url_content
            content = fetch_url_content(url)
            title_match = re.search(r"^\[Web Page:\s*(.*?)\]$", content, re.MULTILINE)
            title = title_match.group(1) if title_match else urllib.parse.urlparse(url).netloc
            results.append({"title": title or "Web page", "snippet": _relevant_page_excerpt(content, clean_query, max_chars=per_source_chars), "url": url, "content_verified": True})
        except Exception as error:
            results.append({"title": urllib.parse.urlparse(url).netloc or "Web page", "snippet": f"Page content extraction failed; do not guess. Error: {error}", "url": url, "content_verified": False})
    
    # If no URLs found, do a web search
    if not results:
        try:
            from ddgs import DDGS
            for item in DDGS().text(clean_query, max_results=max_results):
                results.append({"title": item.get("title", "Web result"), "snippet": item.get("body", ""), "url": item.get("href", "")})
        except Exception as error:
            print("Search provider error:", error)

        # Method 1: DuckDuckGo HTML Search Scraper (only when DDGS did not already
        # provide enough results; avoid a redundant second internet search).
        try:
            if len(results) >= max_results:
                raise StopIteration
            encoded = urllib.parse.quote(clean_query)
            url = f"https://html.duckduckgo.com/html/?q={encoded}"
            with httpx.Client(timeout=8.0, follow_redirects=True, headers=HEADERS) as client:
                resp = client.get(url)
                if resp.status_code == 200:
                    html = resp.text
                    # Parse DuckDuckGo result links & snippets
                    blocks = re.findall(r'<a class="result__url" href="([^"]+)".*?>.*?</a>.*?<a class="result__snippet[^"]*"[^>]*>(.*?)</a>', html, re.DOTALL)
                    title_matches = re.findall(r'<a class="result__a"[^>]*>(.*?)</a>', html, re.DOTALL)
                    
                    for idx, (raw_url, snippet_html) in enumerate(blocks[:max_results]):
                        title_html = title_matches[idx] if idx < len(title_matches) else "Web Reference"
                        
                        # Clean tags
                        title = re.sub(r'<[^>]+>', '', title_html).strip()
                        snippet = re.sub(r'<[^>]+>', '', snippet_html).strip()
                        
                        # Unescape DuckDuckGo redirect URL
                        actual_url = raw_url
                        if "uddg=" in raw_url:
                            u_match = re.search(r'uddg=([^&]+)', raw_url)
                            if u_match:
                                actual_url = urllib.parse.unquote(u_match.group(1))

                        if actual_url.startswith("http") and snippet:
                            results.append({
                                "title": title or "Web Result",
                                "snippet": snippet,
                                "url": actual_url
                            })
        except StopIteration:
            pass
        except Exception as e:
            print(f"[WebSearch] Primary DuckDuckGo search error: {e}")

    # Method 2: Fallback Wikipedia / DuckDuckGo Instant Answers API
    if len(results) < 2:
        try:
            api_url = f"https://api.duckduckgo.com/?q={urllib.parse.quote(clean_query)}&format=json&no_html=1"
            with httpx.Client(timeout=5.0, headers=HEADERS) as client:
                res = client.get(api_url).json()
                abstract = res.get("AbstractText")
                abstract_url = res.get("AbstractURL")
                if abstract and abstract_url:
                    results.insert(0, {
                        "title": res.get("Heading") or "Web Summary",
                        "snippet": abstract,
                        "url": abstract_url
                    })
                
                # Related Topics
                for topic in res.get("RelatedTopics", []):
                    if isinstance(topic, dict) and topic.get("Text") and topic.get("FirstURL"):
                        results.append({
                            "title": topic.get("Text")[:60] + "...",
                            "snippet": topic.get("Text"),
                            "url": topic.get("FirstURL")
                        })
                        if len(results) >= max_results:
                            break
        except Exception as e:
            print(f"[WebSearch] Fallback API error: {e}")

    # De-duplicate by URL
    seen_urls = set()
    unique_results = []
    for r in results:
        if r["url"] not in seen_urls:
            seen_urls.add(r["url"])
            unique_results.append(r)

    # Prefer likely primary/official domains when a query term appears in the
    # hostname (for example, "python" -> python.org). Keep engine order as the
    # tie-breaker so this remains generic rather than hard-coded per website.
    query_domain_terms = {
        term for term in re.findall(r"[a-zA-Z0-9]{3,}", clean_query.lower())
        if term not in {"what", "which", "latest", "stable", "version", "official", "source", "from", "with"}
    }
    ranked_results = []
    for index, item in enumerate(unique_results):
        hostname = urllib.parse.urlparse(item.get("url", "")).hostname or ""
        domain_score = sum(1 for term in query_domain_terms if term in hostname.lower())
        ranked_results.append((domain_score, -index, item))
    unique_results = [item for _, _, item in sorted(ranked_results, key=lambda row: (row[0], row[1]), reverse=True)]

    # Open the top public result pages and replace thin search-engine snippets
    # with relevant text extracted from inside those pages. Direct YouTube URLs
    # are handled earlier by the transcript/frame analyzer and are skipped here
    # to avoid downloading incidental videos from ordinary search results.
    try:
        from app.utils import fetch_url_content
        enriched_count = 0
        for item in unique_results:
            if enriched_count >= 2:
                break
            url = item.get("url", "")
            if not url.startswith(("http://", "https://")) or re.search(r"(?:youtube\.com|youtu\.be)", url, re.I):
                continue
            try:
                page_content = fetch_url_content(url)
                page_excerpt = _relevant_page_excerpt(page_content, clean_query, max_chars=1100)
                if page_excerpt.strip():
                    item["snippet"] = page_excerpt
                    item["content_verified"] = True
                    enriched_count += 1
            except Exception:
                # Keep the real search snippet when a result page blocks access.
                continue
    except Exception:
        pass

    return unique_results[:max_results]
