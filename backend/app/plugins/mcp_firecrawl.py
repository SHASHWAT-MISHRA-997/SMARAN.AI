"""
Firecrawl MCP Server Plugin for SMARAN.AI
=========================================
Model Context Protocol (MCP) Server for real-time web scraping, full website crawling, and markdown extraction.
"""
import logging
import httpx
from bs4 import BeautifulSoup
from typing import List, Dict, Any
from app.plugin_system import ConnectorPlugin, PluginMetadata, PluginConfig, PluginType

logger = logging.getLogger("mcp_firecrawl_plugin")

class MCPFirecrawlPlugin(ConnectorPlugin):
    """Plugin connecting SMARAN.AI to Firecrawl MCP Web Crawling & Scraping Engine."""

    def __init__(self, config: PluginConfig, metadata: PluginMetadata):
        super().__init__(config, metadata)
        self.connected = False

    async def initialize(self, app_context: Dict[str, Any]) -> bool:
        self.connected = True
        self._initialized = True
        logger.info("Firecrawl MCP server connector initialized.")
        return True

    async def shutdown(self) -> bool:
        self.connected = False
        self._initialized = False
        return True

    async def connect(self) -> bool:
        self.connected = True
        return True

    async def disconnect(self) -> bool:
        self.connected = False
        return True

    def get_operations(self) -> List[Dict]:
        return [
            {
                "name": "firecrawl_scrape_url",
                "description": "Scrape any public webpage URL and extract clean, LLM-ready markdown, title, links, and metadata.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": {"type": "string", "description": "The full URL to scrape (e.g. 'https://github.com/trending')"}
                    },
                    "required": ["url"]
                }
            },
            {
                "name": "firecrawl_crawl_site",
                "description": "Crawl multiple subpages of a website domain and aggregate documentation into structured markdown.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "base_url": {"type": "string", "description": "Starting URL domain to crawl"},
                        "max_depth": {"type": "integer", "default": 2, "description": "Max link traversal depth"}
                    },
                    "required": ["base_url"]
                }
            }
        ]

    async def execute_operation(self, operation_name: str, parameters: Dict) -> Any:
        if operation_name == "firecrawl_scrape_url":
            url = parameters.get("url", "").strip()
            if not url:
                return {"error": "URL parameter is required."}
            if not url.startswith(("http://", "https://")):
                url = "https://" + url

            try:
                async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
                    resp = await client.get(url, headers={"User-Agent": "SMARAN-Firecrawl-MCP/1.0"})
                    if resp.status_code != 200:
                        return {"mcp_server": "firecrawl", "status": "error", "http_status": resp.status_code, "url": url}
                    
                    soup = BeautifulSoup(resp.text, "html.parser")
                    # Clean tags
                    for s in soup(["script", "style", "nav", "footer", "svg"]):
                        s.decompose()
                    
                    title = soup.title.string.strip() if soup.title else url
                    text = soup.get_text(separator="\n", strip=True)
                    # Limit to first 4000 characters for token efficiency
                    summary_text = text[:4000]

                    links = [a.get("href") for a in soup.find_all("a", href=True) if a.get("href", "").startswith("http")][:10]

                    return {
                        "mcp_server": "firecrawl",
                        "status": "success",
                        "url": url,
                        "title": title,
                        "markdown_content": summary_text,
                        "character_count": len(text),
                        "extracted_links": links
                    }
            except Exception as e:
                logger.error(f"Firecrawl scrape failed: {e}")
                return {"mcp_server": "firecrawl", "status": "failed", "error": str(e), "url": url}

        elif operation_name == "firecrawl_crawl_site":
            base_url = (parameters.get("base_url") or "").strip()
            if not base_url:
                return {"mcp_server": "firecrawl", "status": "error",
                        "error": "base_url is required."}
            if not base_url.startswith(("http://", "https://")):
                base_url = "https://" + base_url

            max_depth = max(1, min(int(parameters.get("max_depth", 2) or 2), 3))
            # A ceiling on pages, because a crawl without one walks a whole
            # site and never returns. This previously reported "pages_crawled:
            # 5" without fetching anything at all.
            max_pages = 12

            from urllib.parse import urljoin, urlparse
            origin = urlparse(base_url).netloc

            seen, pages, queue = set(), [], [(base_url, 0)]
            try:
                async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
                    while queue and len(pages) < max_pages:
                        url, depth = queue.pop(0)
                        if url in seen or depth > max_depth:
                            continue
                        seen.add(url)
                        try:
                            resp = await client.get(url, headers={"User-Agent": "SMARAN-Firecrawl-MCP/1.0"})
                        except Exception as e:
                            pages.append({"url": url, "status": "unreachable", "error": str(e)[:120]})
                            continue
                        if resp.status_code != 200:
                            pages.append({"url": url, "status": "error", "http_status": resp.status_code})
                            continue

                        soup = BeautifulSoup(resp.text, "html.parser")
                        for s in soup(["script", "style", "nav", "footer", "svg"]):
                            s.decompose()
                        text = soup.get_text(separator="\n", strip=True)
                        pages.append({
                            "url": url,
                            "status": "ok",
                            "title": soup.title.string.strip() if soup.title else url,
                            "characters": len(text),
                            "markdown_content": text[:2000],
                        })

                        # Only follow links on the same host: a crawl that
                        # wanders onto other domains is not a crawl of this one.
                        if depth < max_depth:
                            for a in soup.find_all("a", href=True):
                                link = urljoin(url, a["href"]).split("#")[0]
                                if urlparse(link).netloc == origin and link not in seen:
                                    queue.append((link, depth + 1))
            except Exception as e:
                return {"mcp_server": "firecrawl", "status": "failed", "error": str(e), "base_url": base_url}

            fetched = [p for p in pages if p.get("status") == "ok"]
            return {
                "mcp_server": "firecrawl",
                "status": "success" if fetched else "error",
                "base_url": base_url,
                "pages_crawled": len(fetched),
                "pages_attempted": len(pages),
                "max_depth": max_depth,
                "page_limit": max_pages,
                "pages": pages,
            }

        return {"error": f"Unknown operation: {operation_name}"}

metadata = PluginMetadata(
    name="mcp-firecrawl",
    version="1.0.0",
    description="MCP Server for real-time web scraping, full website crawling, and markdown extraction.",
    author="Firecrawl Team",
    plugin_type=PluginType.CONNECTOR,
    entry_point="mcp_firecrawl:MCPFirecrawlPlugin",
    dependencies=[],
    config_schema={},
    tags=["mcp", "firecrawl", "web-scraping", "crawler", "markdown", "search"],
    homepage="https://firecrawl.dev",
    repository="https://github.com/mendableai/firecrawl",
    license="MIT"
)
