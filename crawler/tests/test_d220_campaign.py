"""D220 S4 — campaigns end to end on a fake site + memory store.

Covers: slices continue the frontier until the site is complete; every page
and image is catalogued; the per-site cap gives an honest PARTIAL; cancel
stops mid-site and resume continues; feeds add catalog products; vision
labels; images match the vendor's product cards (human decisions are never
touched); drafts carry the campaign's coverage verdict; the dynamic allow-list;
and the HTTP endpoints.
"""
from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app.pipeline as pipeline  # noqa: E402
from app import ai_client, campaign, campaign_store, fetcher  # noqa: E402
from app import config as config_mod  # noqa: E402
from app.campaign_feeds import FeedImage, FeedProduct, FeedResult  # noqa: E402
from app.campaign_store import MemoryCampaignStore  # noqa: E402
from app.config import Settings  # noqa: E402
from app.fetcher import FetchResult  # noqa: E402

BASE = "https://acme-farms.example/"


def _settings(**over) -> Settings:
    base = dict(
        CRAWLER_SHARED_SECRET="s", CRAWL_RESPECT_ROBOTS="false", CRAWL_MIN_DELAY_SECONDS="0",
        CRAWL_SEED_ENABLED="false", FOLLOW_SOCIAL_LINKS="false", CAMPAIGN_SLICE_PAGES="5",
        CAMPAIGN_VISION_ENABLED="false", CAMPAIGN_PAGE_AI_ENABLED="false", CAMPAIGN_FEEDS_ENABLED="false",
        CAMPAIGN_AUTO_RESUME="false", _env_file=None,
    )
    base.update(over)
    return Settings(**base)


def _site(n: int) -> dict[str, str]:
    links = "".join(f'<a href="/products/strain-{i}/">Strain {i}</a>' for i in range(n))
    site = {
        BASE: (f"<html><head><title>Acme Farms</title></head><body><nav>{links}<a href='/about/'>About</a></nav>"
               "<img src='/img/acme-logo.png' alt='Acme Farms logo'><p>Acme Farms grows craft cannabis.</p></body></html>"),
        f"{BASE}about/": "<html><body><h1>Our story</h1><p>Family farm since 2014 in Washington.</p></body></html>",
    }
    for i in range(n):
        site[f"{BASE}products/strain-{i}/"] = (
            f"<html><head><script type='application/ld+json'>{{\"@type\":\"Product\",\"name\":\"Strain {i}\"}}"
            f"</script></head><body><h1>Strain {i}</h1><figure><img src='/img/strain-{i}-jar.jpg' "
            f"alt='Strain {i} 3.5g jar'><figcaption>Strain {i}</figcaption></figure>"
            f"<p>Strain {i} flower, 3.5g. Sweet citrus aroma.</p></body></html>"
        )
    return site


def _wire(monkeypatch, site: dict[str, str], log: list[str] | None = None, *, delay: float = 0.0):
    async def fake_fetch(url, *, prefer_browser=True, settings=None, force_fresh=False):
        if log is not None:
            log.append(url)
        if delay:
            await asyncio.sleep(delay)
        html = site.get(url)
        if html is None:
            return FetchResult(url=url, ok=False, error="404")
        text = fetcher._html_to_text(html)
        return FetchResult(url=url, ok=True, status=200, html=html, markdown=text, image_urls=[])

    monkeypatch.setattr(pipeline, "fetch_page", fake_fetch)
    monkeypatch.setattr(pipeline, "discover_sitemap_urls", lambda url, settings, limit=100: [])
    monkeypatch.setattr(pipeline, "fetch_banned_phrases", lambda settings=None: [])
    import app.store as store_mod
    import app.kb_products as kbp
    written: dict = {"drafts": [], "products": []}

    def fake_write_drafts(rows, settings=None):
        written["drafts"].extend(rows)
        return {"written": len(rows), "skipped": 0}

    def fake_write_products(rows, settings=None):
        written["products"].extend(rows)
        return {"written": len(rows)}

    monkeypatch.setattr(store_mod, "write_drafts", fake_write_drafts)
    monkeypatch.setattr(store_mod, "fetch_banned_phrases", lambda settings=None: [])
    monkeypatch.setattr(kbp, "write_product_drafts", fake_write_products)
    return written


@pytest.fixture()
def mem(monkeypatch):
    store = MemoryCampaignStore()
    campaign_store.set_store_for_tests(store)
    campaign.reset_for_tests()
    ai_client.reset_state_for_tests()
    fetcher._dynamic_allow.clear()
    yield store
    campaign.reset_for_tests()
    campaign_store.set_store_for_tests(None)
    fetcher._dynamic_allow.clear()


async def _wait(cid: str, timeout: float = 20.0) -> None:
    t0 = time.time()
    while campaign.campaign_running(cid):
        if time.time() - t0 > timeout:
            raise AssertionError("campaign did not finish")
        await asyncio.sleep(0.02)


def _target(**over) -> dict:
    t = {"entity_type": "vendor", "entity_id": "v1", "vendor_id": "v1", "display_name": "Acme Farms", "url": BASE}
    t.update(over)
    return t


# ---------------------------------------------------------------------------
def test_normalize_targets_dedupes_hosts_and_skips_bad_urls():
    sites, skipped = campaign.normalize_targets([
        _target(), _target(entity_id="v2", url="https://www.acme-farms.example/shop"),
        _target(entity_id="v3", url="not a url"), _target(entity_id="", vendor_id="", url="https://other.example"),
        _target(entity_id="v4", url="other2.example"),
    ])
    assert [s["entity_id"] for s in sites] == ["v1", "v4"]
    assert sites[1]["entry_url"] == "https://other2.example"
    reasons = " ".join(s["reason"] for s in skipped)
    assert "duplicate website acme-farms.example" in reasons and "no usable website" in reasons


def test_dynamic_allow_list_admits_campaign_hosts_in_production(mem):
    s = _settings(CRAWLER_ENV="production", CRAWL_ALLOW_DOMAINS="greenway.example")
    assert not fetcher.domain_allowed(s, "https://shop.acme-farms.example/x")
    fetcher.allow_hosts(["https://www.acme-farms.example/"])
    assert fetcher.domain_allowed(s, "https://shop.acme-farms.example/x")
    assert fetcher.domain_allowed(s, "https://acme-farms.example:443/")
    assert not fetcher.domain_allowed(s, "https://evil.example/")
    assert fetcher.domain_allowed(s, "https://greenway.example/")


def test_campaign_crawls_slice_after_slice_until_complete(monkeypatch, mem):
    settings = _settings()
    written = _wire(monkeypatch, _site(12))
    mem.products["v1"] = [{"id": f"kb{i}", "display_name": f"Strain {i}", "category": "Flower",
                           "variant_label": "3.5g"} for i in range(12)]

    async def go():
        camp = await campaign.start_campaign(label="t", scope="custom", targets=[_target()], settings=settings)
        await _wait(camp["id"])
        return camp["id"]

    cid = asyncio.run(go())
    camp = mem.get_campaign(cid)
    site = mem.list_sites(cid)[0]
    assert camp["status"] == "completed"
    assert site["status"] == "complete", site
    assert site["pages_read"] == 14  # home + about + 12 products
    assert site["slices"] >= 3        # 5 pages per slice → needed several slices
    assert site["pages_pending"] == 0
    assert "COMPLETE" in site["coverage_assessment"]
    pages = mem.list_pages(site["id"])
    types = {p["url"]: p["page_type"] for p in pages}
    assert types[BASE] == "home" and types[f"{BASE}about/"] == "about"
    assert types[f"{BASE}products/strain-3/"] == "product"
    imgs = {i["image_url"]: i for i in mem.list_images(site["id"])}
    logo = imgs[f"{BASE}img/acme-logo.png"]
    assert logo["role"] == "logo" and logo.get("matched_kb_product_id") is None
    jar = imgs[f"{BASE}img/strain-3-jar.jpg"]
    assert jar["product_name"] == "Strain 3"
    assert jar["variant_label"] == "3.5g"
    assert jar["matched_kb_product_id"] == "kb3"
    assert jar["match_status"] == "suggested"
    assert site["images_matched"] == 12
    # The coverage draft is the campaign's verdict, not the 1-page synthesis pass.
    cov = [d for d in written["drafts"] if d.field_key == "research_coverage"]
    assert len(cov) == 1 and "COMPLETE" in cov[0].suggested_value
    assert camp["totals"]["complete"] == 1


def test_per_site_cap_gives_honest_partial(monkeypatch, mem):
    settings = _settings()
    _wire(monkeypatch, _site(30))

    async def go():
        camp = await campaign.start_campaign(label="t", scope="custom", targets=[_target()],
                                             options={"max_pages_per_site": 10}, settings=settings)
        await _wait(camp["id"])
        return camp["id"]

    cid = asyncio.run(go())
    site = mem.list_sites(cid)[0]
    assert site["status"] == "partial"
    assert 10 <= site["pages_read"] <= 11
    assert site["pages_pending"] > 0
    assert "PARTIAL" in site["coverage_assessment"] and "CAMPAIGN_MAX_PAGES_PER_SITE" in site["coverage_assessment"]


def test_cancel_mid_site_then_resume_continues_without_rereading(monkeypatch, mem):
    settings = _settings()
    log: list[str] = []
    _wire(monkeypatch, _site(15), log, delay=0.01)

    async def go():
        camp = await campaign.start_campaign(label="t", scope="custom", targets=[_target()], settings=settings)
        cid = camp["id"]
        while len(log) < 4:
            await asyncio.sleep(0.005)
        await campaign.cancel_campaign(cid, settings)
        await _wait(cid)
        mid = mem.list_sites(cid)[0]
        read_before = set(log)
        log.clear()
        await campaign.resume_campaign(cid, settings)
        await _wait(cid)
        return cid, mid, read_before

    cid, mid, read_before = asyncio.run(go())
    assert mid["status"] == "cancelled"
    assert mem.get_campaign(cid)["status"] == "completed"
    site = mem.list_sites(cid)[0]
    assert site["status"] == "complete"
    assert site["pages_read"] == 17
    # Resume never re-fetches a sub-page that an earlier slice already read
    # (the entry page is re-read once per slice to seed links — by design).
    rereads = (read_before & set(log)) - {BASE}
    assert rereads == set(), rereads


def test_feeds_add_catalog_products_and_images(monkeypatch, mem):
    settings = _settings(CAMPAIGN_FEEDS_ENABLED="true")
    written = _wire(monkeypatch, _site(2))

    async def fake_feeds(settings, entry_url, should_stop=None):
        return FeedResult(platform="shopify", products=[
            FeedProduct(name="Hidden Gem Rosin", url=f"{BASE}products/hidden-gem", category="Concentrate",
                        variants=["1g"], images=[FeedImage(url="https://cdn.example/hidden-gem.jpg", alt="")]),
        ])

    monkeypatch.setattr(campaign, "read_feeds", fake_feeds)

    async def go():
        camp = await campaign.start_campaign(label="t", scope="custom", targets=[_target()], settings=settings)
        await _wait(camp["id"])
        return camp["id"]

    cid = asyncio.run(go())
    site = mem.list_sites(cid)[0]
    assert site["platform"] == "shopify"
    pages = {p["url"]: p for p in mem.list_pages(site["id"])}
    assert pages[f"{BASE}products/hidden-gem"]["source"] == "shopify"
    img = [i for i in mem.list_images(site["id"]) if i["image_url"] == "https://cdn.example/hidden-gem.jpg"][0]
    assert img["product_name"] == "Hidden Gem Rosin" and img["source"] == "shopify"
    assert "primary" in img["tags"]
    names = [r["display_name"] for r in written["products"]]
    assert "Hidden Gem Rosin" in names
    assert all(r.get("vendor_id") == "v1" for r in written["products"])


def test_vision_labels_images_and_matching_respects_human_decisions(monkeypatch, mem):
    settings = _settings(CAMPAIGN_VISION_ENABLED="true", AI_API_KEY="k")
    _wire(monkeypatch, _site(3))
    mem.products["v1"] = [{"id": "kbA", "display_name": "Strain 1", "category": "Flower", "variant_label": "3.5g"},
                          {"id": "kbB", "display_name": "Mystery Jar", "category": "Flower", "variant_label": ""}]
    calls: list[dict] = []

    def fake_chat(settings, system, user, *, purpose="text", image_urls=None, max_tokens=None):
        calls.append({"purpose": purpose, "n": len(image_urls or [])})
        if purpose != "vision":
            raise ai_client.AiUnavailable("text off in this test")
        return {"images": [{"index": i + 1, "role": "packaging", "product_name": "Mystery Jar" if "strain-2" in u else "",
                            "packaging_text": "ACME 3.5g", "colors": ["green"], "tags": ["jar", "front"],
                            "confidence": 0.9} for i, u in enumerate(image_urls or [])]}

    monkeypatch.setattr(ai_client, "chat_json", fake_chat)

    async def go():
        camp = await campaign.start_campaign(label="t", scope="custom", targets=[_target()], settings=settings)
        await _wait(camp["id"])
        return camp["id"]

    cid = asyncio.run(go())
    site = mem.list_sites(cid)[0]
    imgs = {i["image_url"]: i for i in mem.list_images(site["id"])}
    s2 = imgs[f"{BASE}img/strain-2-jar.jpg"]
    assert s2["vision_at"] and s2["role"] == "packaging" and s2["packaging_text"] == "ACME 3.5g"
    assert s2["matched_kb_product_id"] == "kbB"
    assert "jar" in s2["tags"] and s2["colors"] == ["green"]
    assert all(c["n"] <= campaign.VISION_BATCH for c in calls if c["purpose"] == "vision")
    assert imgs[f"{BASE}img/acme-logo.png"].get("vision_at") is None  # logos are never sent to vision

    # A human rejects one link and confirms another; a rematch never changes them.
    s1 = imgs[f"{BASE}img/strain-1-jar.jpg"]
    mem.update_image(s2["id"], {"match_status": "rejected", "matched_kb_product_id": None})
    mem.update_image(s1["id"], {"match_status": "confirmed", "matched_kb_product_id": "kbB"})
    asyncio.run(campaign.rematch_site(site["id"], settings))
    after = {i["image_url"]: i for i in mem.list_images(site["id"])}
    assert after[s2["image_url"]]["match_status"] == "rejected"
    assert after[s1["image_url"]]["matched_kb_product_id"] == "kbB"


def test_match_one_ambiguity_and_unmatching():
    refs = [campaign.ProductRef(id="a", name="Blue Dream", category="Flower", variant_label="3.5g"),
            campaign.ProductRef(id="b", name="Blue Dream", category="Flower", variant_label="1g")]
    p = campaign.match_one({"product_name": "Blue Dream", "category": "flower"}, refs)
    assert p["match_status"] == "suggested" and "ambiguous" in p["match_reason"]
    assert len(p["match_candidates"]) == 2
    # A previously suggested link whose evidence vanished goes back to unmatched.
    p2 = campaign.match_one({"product_name": "Totally Different", "match_status": "suggested",
                             "matched_kb_product_id": "a"}, refs)
    assert p2["match_status"] == "unmatched" and p2["matched_kb_product_id"] is None
    assert campaign.match_one({"role": "logo", "product_name": "Blue Dream"}, refs) is None


def test_failed_entry_marks_site_failed_and_campaign_completes(monkeypatch, mem):
    settings = _settings()
    _wire(monkeypatch, {})

    async def go():
        camp = await campaign.start_campaign(label="t", scope="custom", targets=[_target()], settings=settings)
        await _wait(camp["id"])
        return camp["id"]

    cid = asyncio.run(go())
    site = mem.list_sites(cid)[0]
    assert site["status"] == "failed" and "404" in (site["last_error"] or "")
    assert mem.get_campaign(cid)["status"] == "completed"


def test_watchdog_recycles_then_cancels_silent_campaign(monkeypatch, mem):
    settings = _settings(CRAWL_STALL_SECONDS="60")

    async def go():
        async def forever():
            await asyncio.sleep(3600)
        task = asyncio.get_running_loop().create_task(forever())
        campaign._tasks["c1"] = task
        campaign._heartbeat["c1"] = 1000.0
        a1 = campaign.campaign_watchdog_tick(settings, now=1000.0 + 70)
        a2 = campaign.campaign_watchdog_tick(settings, now=1000.0 + 130)
        await asyncio.sleep(0)
        return a1, a2, task

    a1, a2, task = asyncio.run(go())
    assert a1[0]["action"] == "browser_recycled"
    assert a2[0]["action"] == "cancelled_task"
    assert task.cancelled()


def test_heartbeat_freshness():
    s = _settings(CRAWL_STALL_SECONDS="600")
    from datetime import datetime, timezone
    now = time.time()
    fresh = datetime.fromtimestamp(now - 60, tz=timezone.utc).isoformat()
    stale = datetime.fromtimestamp(now - 3600, tz=timezone.utc).isoformat()
    assert campaign.heartbeat_is_fresh(fresh, s, now=now)
    assert not campaign.heartbeat_is_fresh(stale, s, now=now)
    assert not campaign.heartbeat_is_fresh(None, s, now=now)


def test_merge_product_lines_dedupes_and_fills_gaps():
    from app.schemas import ProductLine
    out = campaign.merge_product_lines(
        [ProductLine(name="Blue Dream", category="")],
        [ProductLine(name="blue dream", category="Flower", lineage="Blueberry x Haze")],
        [ProductLine(name="Wedding Cake")],
    )
    assert [p.name for p in out] == ["Blue Dream", "Wedding Cake"]
    assert out[0].category == "Flower" and out[0].lineage == "Blueberry x Haze"


# ---------------------------------------------------------------------------
# HTTP endpoints
# ---------------------------------------------------------------------------
@pytest.fixture()
def client(monkeypatch, mem, tmp_path):
    settings = _settings(CRAWLER_SHARED_SECRET="sek", CRAWL_CACHE_DIR=str(tmp_path))
    monkeypatch.setattr(config_mod, "get_settings", lambda: settings)
    import app.main as main_mod
    monkeypatch.setattr(main_mod, "get_settings", lambda: settings)
    monkeypatch.setattr(campaign, "get_settings", lambda: settings)
    _wire(monkeypatch, _site(3))
    with TestClient(main_mod.app) as c:
        yield c


def test_campaign_endpoints_auth_start_poll_cancel_resume(client):
    body = {"label": "Harvest all current vendors", "scope": "current_vendors", "targets": [_target()]}
    assert client.post("/campaigns", json=body).status_code == 401
    r = client.post("/campaigns", json=body, headers={"X-Crawler-Secret": "sek"})
    assert r.status_code == 202, r.text
    cid = r.json()["campaign"]["id"]
    for _ in range(200):
        g = client.get(f"/campaigns/{cid}", headers={"X-Crawler-Secret": "sek"}).json()
        if g["campaign"]["status"] == "completed":
            break
        time.sleep(0.02)
    assert g["campaign"]["status"] == "completed"
    assert g["campaign"]["sites"][0]["status"] == "complete"
    assert g["campaign"]["totals"]["pages_read"] == 5
    lst = client.get("/campaigns", headers={"X-Crawler-Secret": "sek"}).json()
    assert lst["campaigns"][0]["id"] == cid
    assert client.post(f"/campaigns/{cid}/cancel", headers={"X-Crawler-Secret": "sek"}).status_code == 200
    assert client.post(f"/campaigns/{cid}/resume", headers={"X-Crawler-Secret": "sek"}).status_code == 200
    assert client.get("/campaigns/nope", headers={"X-Crawler-Secret": "sek"}).status_code == 404
    sid = g["campaign"]["sites"][0]["id"]
    rm = client.post(f"/campaigns/sites/{sid}/rematch", headers={"X-Crawler-Secret": "sek"})
    assert rm.status_code == 200 and rm.json()["site_id"] == sid
    h = client.get("/health").json()
    assert "campaign_heartbeats_s" in h and h["limits"]["campaign_slice_pages"] == 5


def test_campaign_endpoint_rejects_bad_targets(client):
    r = client.post("/campaigns", json={"targets": [_target(url="nowhere")]}, headers={"X-Crawler-Secret": "sek"})
    assert r.status_code == 422
