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

def perform_web_search(query: str, max_results: int = 5) -> List[Dict[str, str]]:
    """
    Execute live web search for query and return list of search results.
    Each result item: {"title": str, "snippet": str, "url": str}
    """
    clean_query = query.strip()
    if not clean_query:
        return []

    results = []

    # Method 1: DuckDuckGo HTML Search Scraper
    try:
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

    return unique_results[:max_results]
