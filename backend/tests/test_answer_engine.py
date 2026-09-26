"""The Perplexity-style answer engine: plan, search, read, rank, cite, check."""
from app import answer_engine as ae


def test_compound_questions_are_split():
    assert ae.decompose("Compare Rust vs Go for web servers") == [
        "Compare Rust vs Go for web servers", "Rust", "Go for web servers"]
    q = "What is ISRO's budget this year? Who heads it now?"
    assert len(ae.decompose(q)) == 3
    assert ae.decompose("what is photosynthesis") == ["what is photosynthesis"]
    assert ae.decompose("What is new in Python 3.13 and is the JIT on by default?")[1:] == [
        "What is new in Python 3.13", "is the JIT on by default"]


def test_relative_dates_become_real_ones():
    assert "this month" not in ae.dated("What did ISRO announce this month?")
    assert ae.is_timely("latest news today") and not ae.is_timely("population of Tokyo")


def fake_web(monkeypatch, results, pages):
    searched = []

    def search(query, focus="web", max_results=8):
        searched.append((query, focus))
        return [dict(r) for r in results]
    monkeypatch.setattr(ae, "search", search)
    monkeypatch.setattr(ae, "read_page", lambda url, timeout=6: pages.get(url, ""))
    return searched


def test_official_sources_first_farms_last_at_most_two_per_site(monkeypatch):
    results = [
        {"title": "random blog", "snippet": "python 3.13 released features", "url": "https://blog.example.com/a"},
        {"title": "Python 3.13 on Pinterest", "snippet": "python 3.13 released features", "url": "https://pinterest.com/x"},
        {"title": "What's new", "snippet": "python 3.13 released features", "url": "https://docs.python.org/3.13/whatsnew"},
        {"title": "python 3.13", "snippet": "python 3.13 released features", "url": "https://docs.python.org/a"},
        {"title": "python 3.13", "snippet": "python 3.13 released features", "url": "https://docs.python.org/b"},
    ]
    fake_web(monkeypatch, results, {})
    sources = ae.research("python 3.13 released features")["sources"]
    domains = [s["domain"] for s in sources]
    assert domains[0] == "docs.python.org"
    assert domains.count("docs.python.org") == 2
    assert domains.index("pinterest.com") == len(domains) - 1
    assert [s["n"] for s in sources] == list(range(1, len(sources) + 1))


def test_pages_are_read_merged_and_numbered(monkeypatch):
    results = [{"title": "Tea", "snippet": "tea has caffeine", "url": "https://example.org/tea"},
               {"title": "Shared", "snippet": "tea and coffee", "url": "https://example.org/shared#top"}]
    pages = {"https://example.org/tea": "Tea contains less caffeine than coffee.\n" * 20}
    searched = fake_web(monkeypatch, results, pages)
    out = ae.research("Compare tea vs coffee caffeine")
    assert len(searched) == 3                                          # the question and both sides
    urls = [s["url"] for s in out["sources"]]
    assert len(urls) == len(set(urls)) == 2                            # the shared page once
    assert next(s for s in out["sources"] if s["url"].endswith("/tea"))["read"] is True
    block = ae.evidence_block(out["sources"])
    assert block.startswith("[1] ") and "[2] " in block


def test_a_page_that_cannot_be_read_keeps_its_snippet(monkeypatch):
    fake_web(monkeypatch, [{"title": "t", "snippet": "keep me", "url": "https://x.org"}], {})
    source = ae.research("anything at all")["sources"][0]
    assert source["snippet"] == "keep me" and source["read"] is False


def test_mirrors_of_other_sites_are_dropped():
    assert ae._MIRROR.search("www-python-org.nproxy.org")
    assert not ae._MIRROR.search("python.org")


def test_tables_stay_rows(monkeypatch):
    import app.utils as utils

    class Page:
        status_code = 200
        headers = {"content-type": "text/html"}
        text = ("<html><body><table><tr><th>Branch</th><th>Released</th></tr>"
                "<tr><td>3.14</td><td>2025-10-07</td></tr></table></body></html>")
    monkeypatch.setattr(utils, "_safe_public_get", lambda url, headers, timeout: Page())
    text = ae.read_page("https://example.org/versions")
    assert "3.14 | 2025-10-07" in text


def test_citations_are_checked_and_broken_ones_removed():
    sources = [{"n": 1, "title": "Python versions", "passages": ["Python 3.14 was released on 7 October 2025."],
                "url": "u", "domain": "d", "date": "", "snippet": "", "read": True}]
    answer = "Python 3.14 was released on 7 October 2025 [1]. It is also much faster than every older release [7]. Nothing else to add here really."
    assert ae.clean_citations(answer, sources).count("[7]") == 0
    checked = ae.verify(answer, sources)
    assert checked["cited_sentences"] == 2 and checked["invalid_citations"] == 1
    assert checked["supported_sentences"] >= 1
