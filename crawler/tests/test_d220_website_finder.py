"""D220 S5 — website finder: OpenAI web search (or DuckDuckGo) + homepage verification."""
from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import ai_client, campaign_store, website_finder as wf  # noqa: E402
from app import config as config_mod  # noqa: E402
from app.campaign_store import MemoryCampaignStore  # noqa: E402
from app.config import Settings  # noqa: E402
from app.discovery_search import DiscoveryResult, SiteCandidate, VendorContact  # noqa: E402


def _settings(**over) -> Settings:
    base = dict(CRAWLER_SHARED_SECRET="sek", CRAWL_RESPECT_ROBOTS="false", CRAWL_MIN_DELAY_SECONDS="0",
                CAMPAIGN_AUTO_RESUME="false", _env_file=None)
    base.update(over)
    return Settings(**base)


GOOD = ("<html><head><title>Green Valley Farms | Craft Cannabis</title>"
        "<meta property='og:site_name' content='Green Valley Farms'></head><body>"
        "<div>Are you 21 or older?</div><h1>Green Valley Farms</h1>"
        "<p>Tier 2 producer/processor in Spokane, Washington. Indica, sativa and hybrid flower and pre-rolls.</p>"
        "<footer>WSLCB License #412345</footer></body></html>")
OTHER = "<html><head><title>Joe's Plumbing</title></head><body><h1>Plumbing</h1><p>Call 555-412345-1</p></body></html>"

V = wf.VendorQuery(vendor_id="v1", name="Green Valley Farms LLC", license_number="412345", city="Spokane")


@pytest.fixture()
def mem():
    store = MemoryCampaignStore()
    campaign_store.set_store_for_tests(store)
    wf.reset_for_tests()
    ai_client.reset_state_for_tests()
    yield store
    wf.reset_for_tests()
    campaign_store.set_store_for_tests(None)


def _pages(monkeypatch, pages: dict[str, str]):
    async def fake_fetch(settings, url):
        html = pages.get(url)
        if html is None:
            return 0, "", url, "ConnectError: unreachable"
        return 200, html, url, ""
    monkeypatch.setattr(wf, "fetch_homepage", fake_fetch)


# ---------------------------------------------------------------------------
def test_candidates_from_search_json_then_citations_and_blocks_marketplaces():
    out = {"text": '{"candidates":[{"url":"https://www.greenvalleyfarms.com/shop","reason":"brand site","confidence":0.9},'
                   '{"url":"https://leafly.com/brands/gvf","reason":"x","confidence":0.8}]}',
           "citations": [{"url": "https://greenvalleyfarms.com/about", "title": "dup"},
                         {"url": "https://gvf-wa.com/", "title": "GVF"}],
           "sources": ["https://weedmaps.com/x", "https://news.example/a"]}
    got = wf.candidates_from_search(out)
    hosts = [wf.bare_host(u) for u, _, _ in got]
    assert hosts == ["greenvalleyfarms.com", "gvf-wa.com", "news.example"]
    assert got[0][0] == "https://www.greenvalleyfarms.com/" and got[0][2] == 0.9


def test_candidates_from_search_free_text_fallback():
    got = wf.candidates_from_search({"text": "Their site is https://gvf.example/home and that's it."})
    assert [u for u, _, _ in got] == ["https://gvf.example/"]


def test_score_page_and_verdict_verified_by_license():
    ev = wf.score_page(GOOD, V, final_url="https://greenvalleyfarms.com/")
    assert ev.name_in_title and ev.license_found and ev.age_gate
    assert "spokane" in [w.lower() for w in ev.wa_signals] or ev.wa_signals
    status, conf = wf.verdict(ev, search_conf=0.9)
    assert status == "verified" and conf >= 0.9


def test_license_inside_a_longer_number_does_not_count():
    ev = wf.score_page(OTHER.replace("555-412345-1", "Call 5554123451"), V, final_url="https://joes.example/")
    assert not ev.license_found
    status, conf = wf.verdict(ev, search_conf=0.9)
    assert status == "mismatch" and conf <= 0.4


def test_unreachable_verdict():
    status, conf = wf.verdict(wf.Evidence(error="HTTP 503"), search_conf=0.8)
    assert status == "unreachable" and conf <= 0.3


def test_find_for_vendor_openai_search_verifies_and_ranks(monkeypatch, mem):
    settings = _settings(AI_API_KEY="k")
    seen_prompts: list[str] = []

    async def fake_search(settings, prompt, **kw):
        seen_prompts.append(prompt)
        assert "leafly.com" in kw["blocked_domains"]
        return {"text": '{"candidates":[{"url":"https://joes.example/","reason":"maybe","confidence":0.7},'
                        '{"url":"https://greenvalleyfarms.com/","reason":"brand","confidence":0.6}]}'}

    monkeypatch.setattr(ai_client, "responses_web_search_async", fake_search)
    _pages(monkeypatch, {"https://joes.example/": OTHER, "https://greenvalleyfarms.com/": GOOD})
    cands = asyncio.run(wf.find_for_vendor(settings, V))
    assert "412345" in seen_prompts[0] and "Spokane" in seen_prompts[0]
    assert [c.host for c in cands] == ["greenvalleyfarms.com", "joes.example"]
    assert cands[0].verify_status == "verified" and cands[0].source == "openai_web_search"
    assert cands[1].verify_status == "mismatch"
    row = cands[0].row("v1")
    assert row["vendor_id"] == "v1" and row["evidence"]["license_found"] is True


def test_find_for_vendor_falls_back_to_duckduckgo(monkeypatch, mem):
    settings = _settings(AI_API_KEY="k")

    async def no_search(settings, prompt, **kw):
        raise ai_client.AiUnavailable("no web search")

    async def fake_ddg(name, **kw):
        return DiscoveryResult(name=name, queries=[], fetched_ok=True, contact=VendorContact(), candidates=[
            SiteCandidate(url="https://greenvalleyfarms.com/", host="greenvalleyfarms.com", title="GVF", score=5)])

    monkeypatch.setattr(ai_client, "responses_web_search_async", no_search)
    monkeypatch.setattr(wf, "discover_vendor_sites", fake_ddg)
    _pages(monkeypatch, {"https://greenvalleyfarms.com/": GOOD})
    cands = asyncio.run(wf.find_for_vendor(settings, V))
    assert len(cands) == 1 and cands[0].source == "duckduckgo" and cands[0].verify_status == "verified"


def test_job_writes_pending_candidates_and_never_reopens_decisions(monkeypatch, mem):
    settings = _settings()  # no AI key -> DuckDuckGo path

    async def fake_ddg(name, **kw):
        return DiscoveryResult(name=name, queries=[], fetched_ok=True, contact=VendorContact(), candidates=[
            SiteCandidate(url="https://greenvalleyfarms.com/", host="greenvalleyfarms.com", score=5)])

    monkeypatch.setattr(wf, "discover_vendor_sites", fake_ddg)
    _pages(monkeypatch, {"https://greenvalleyfarms.com/": GOOD})
    mem.candidates[("v1", "greenvalleyfarms.com")] = {"id": "x", "vendor_id": "v1", "host": "greenvalleyfarms.com",
                                                       "status": "rejected"}

    async def go():
        job = wf.start_job([{"vendor_id": "v1", "name": "Green Valley Farms", "license_number": "412345"},
                            {"vendor_id": "v2", "name": "Green Valley Farms"}, {"vendor_id": "", "name": "x"}],
                           settings=settings)
        for _ in range(200):
            if job["status"] != "running":
                break
            await asyncio.sleep(0.01)
        return job

    job = asyncio.run(go())
    assert job["status"] == "completed" and job["total"] == 2 and job["done"] == 2
    assert mem.candidates[("v1", "greenvalleyfarms.com")]["status"] == "rejected"  # human decision kept
    assert mem.candidates[("v2", "greenvalleyfarms.com")]["status"] == "pending"
    assert job["found"] == 2


def test_start_job_rejects_empty():
    with pytest.raises(ValueError):
        wf.start_job([{"vendor_id": "", "name": ""}], settings=_settings())


def test_website_endpoints(monkeypatch, mem, tmp_path):
    settings = _settings(CRAWL_CACHE_DIR=str(tmp_path))
    monkeypatch.setattr(config_mod, "get_settings", lambda: settings)
    import app.main as main_mod
    monkeypatch.setattr(main_mod, "get_settings", lambda: settings)
    monkeypatch.setattr(wf, "get_settings", lambda: settings)

    async def fake_ddg(name, **kw):
        return DiscoveryResult(name=name, queries=[], fetched_ok=True, contact=VendorContact(), candidates=[])

    monkeypatch.setattr(wf, "discover_vendor_sites", fake_ddg)
    with TestClient(main_mod.app) as c:
        body = {"vendors": [{"vendor_id": "v1", "name": "Green Valley Farms"}]}
        assert c.post("/websites/find", json=body).status_code == 401
        r = c.post("/websites/find", json=body, headers={"X-Crawler-Secret": "sek"})
        assert r.status_code == 202, r.text
        jid = r.json()["job"]["id"]
        for _ in range(200):
            j = c.get(f"/websites/jobs/{jid}", headers={"X-Crawler-Secret": "sek"}).json()["job"]
            if j["status"] != "running":
                break
            time.sleep(0.02)
        assert j["status"] == "completed" and j["results"][0]["candidates"] == 0
        assert c.get("/websites/jobs", headers={"X-Crawler-Secret": "sek"}).json()["jobs"][0]["id"] == jid
        assert c.post(f"/websites/jobs/{jid}/cancel", headers={"X-Crawler-Secret": "sek"}).status_code == 200
        assert c.get("/websites/jobs/nope", headers={"X-Crawler-Secret": "sek"}).status_code == 404
