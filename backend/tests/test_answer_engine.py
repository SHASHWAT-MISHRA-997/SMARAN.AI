"""The Perplexity-style answer engine: decompose, retrieve, rank, read, cite."""
from app import answer_engine as ae


def test_compound_questions_are_split():
    assert ae.decompose("Compare Rust vs Go for web servers") == [
        "Compare Rust vs Go for web servers", "Rust", "Go for web servers"]
    q = "What is ISRO's budget this year? Who heads it now?"
    assert len(ae.decompose(q)) == 3
    assert ae.decompose("what is photosynthesis") == ["what is photosynthesis"]
    assert ae.decompose("What is new in Python 3.13 and is the JIT on by default?")[1:] == [
        "What is new in Python 3.13", "is the JIT on by default"]


def test_ranking_prefers_coverage_and_authority_and_limits_one_site():
    results = [
        {"title": "random blog", "snippet": "stuff", "url": "https://blog.example.com/a"},
        {"title": "Python 3.13 release notes", "snippet": "python 3.13 released features", "url": "https://docs.python.org/3.13/whatsnew"},
        {"title": "Python 3.13 on Pinterest", "snippet": "python 3.13 released features", "url": "https://pinterest.com/x"},
        {"title": "python 3.13 released", "snippet": "python 3.13 features", "url": "https://docs.python.org/a"},
        {"title": "python 3.13 released", "snippet": "python 3.13 features", "url": "https://docs.python.org/b"},
    ]
    ranked = ae.rank("python 3.13 released features", results, 5)
    assert ranked[0]["url"].startswith("https://docs.python.org")
    assert sum(1 for r in ranked if "docs.python.org" in r["url"]) == 2     # at most two per site
    assert ranked.index(next(r for r in ranked if "pinterest" in r["url"])) > 0


def test_research_merges_reads_and_numbers(monkeypatch):
    calls = []

    def search(q, n):
        calls.append(q)
        return [{"title": f"{q} result", "snippet": "short", "url": f"https://example.org/{len(q)}"},
                {"title": "shared", "snippet": "short", "url": "https://example.org/shared/"}]
    monkeypatch.setattr(ae, "perform_web_search", search)
    import app.utils as utils
    monkeypatch.setattr(utils, "fetch_url_content", lambda url: "A long page about the question. " * 50)
    out = ae.research("Compare tea vs coffee", read_pages=2)
    assert len(calls) == 3
    urls = [s["url"] for s in out["sources"]]
    assert len(urls) == len(set(u.rstrip("/") for u in urls))                  # shared page once
    assert sum(1 for s in out["sources"] if s.get("read")) == 2
    ctx = ae.context(out["sources"], 2000)
    assert ctx.startswith("[1] ") and "[2] " in ctx and len(ctx) <= 2000


def test_a_page_that_cannot_be_read_keeps_its_snippet(monkeypatch):
    monkeypatch.setattr(ae, "perform_web_search", lambda q, n: [{"title": "t", "snippet": "keep me", "url": "https://x.org"}])
    import app.utils as utils

    def boom(url):
        raise RuntimeError("blocked")
    monkeypatch.setattr(utils, "fetch_url_content", boom)
    out = ae.research("anything at all")
    assert out["sources"][0]["snippet"] == "keep me" and not out["sources"][0].get("read")


def test_citations_to_nothing_are_removed():
    assert ae.clean_citations("Yes [1][3]. Also [9].", 3) == "Yes [1][3]. Also ."
    assert "[1] to [4]" in ae.instructions(4)
