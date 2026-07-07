"""Slice H9e — pure-core tests for vendor-website discovery.

No network, no Supabase. Exercises query building, DDG link unwrapping, host
classification (marketplace/social/aggregator exclusion), homepage
normalization, candidate ranking, result parsing, and contact extraction. The
one I/O function (discover_vendor_sites) is covered by manual verification; the
parsing it relies on is fully tested here against realistic DDG HTML.
"""
from __future__ import annotations

from app.discovery_search import (
    SiteCandidate,
    build_search_queries,
    ddg_html_url,
    extract_contact,
    format_discovery_draft,
    is_excluded_host,
    parse_search_results,
)


# ---------------------------------------------------------------------------
# build_search_queries
# ---------------------------------------------------------------------------

def test_build_queries_empty_name():
    assert build_search_queries("") == []
    assert build_search_queries("   ") == []


def test_build_queries_includes_name_and_excludes_marketplaces():
    qs = build_search_queries("Sticky Frog Farms", location="Port Orchard WA")
    assert qs, "expected at least one query"
    joined = " ".join(qs)
    assert "Sticky Frog Farms" in joined
    assert "Port Orchard WA" in joined
    # Marketplaces + socials excluded right in the query.
    assert "-site:iheartjane.com" in joined
    assert "-site:leafly.com" in joined
    assert "-site:instagram.com" in joined


def test_build_queries_deduped():
    qs = build_search_queries("Acme", location="")
    assert len(qs) == len(set(qs))


def test_ddg_html_url_encodes():
    url = ddg_html_url('"Acme" official website')
    assert url.startswith("https://html.duckduckgo.com/html/?q=")
    assert "%22Acme%22" in url


# ---------------------------------------------------------------------------
# is_excluded_host — marketplaces/socials/aggregators are NOT vendor sites
# ---------------------------------------------------------------------------

def test_marketplaces_excluded():
    for h in ("iheartjane.com", "www.leafly.com", "weedmaps.com",
              "dutchie.com", "leafbuyer.com"):
        assert is_excluded_host(h), h


def test_socials_excluded():
    for h in ("instagram.com", "www.facebook.com", "x.com", "tiktok.com",
              "youtube.com", "linktr.ee", "yelp.com"):
        assert is_excluded_host(h), h


def test_aggregators_and_regulator_excluded():
    for h in ("google.com", "en.wikipedia.org", "lcb.wa.gov", "bbb.org"):
        assert is_excluded_host(h), h


def test_vendor_own_site_not_excluded():
    for h in ("stickyfrogfarms.com", "greenway-po.com", "cascadecannabis.co"):
        assert not is_excluded_host(h), h


# ---------------------------------------------------------------------------
# parse_search_results — DDG HTML -> ranked first-party candidates
# ---------------------------------------------------------------------------

_DDG_HTML = """
<html><body>
  <div class="result web-result">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fstickyfrogfarms.com%2F&amp;rut=x">
      Sticky Frog Farms — Official Site</a>
    <a class="result__snippet">Family cannabis farm in Washington. Home of Sticky Frog.</a>
  </div>
  <div class="result web-result">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.leafly.com%2Fbrands%2Fsticky-frog">
      Sticky Frog on Leafly</a>
    <a class="result__snippet">Menu on Leafly</a>
  </div>
  <div class="result web-result">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.instagram.com%2Fstickyfrog">
      Sticky Frog (@stickyfrog) Instagram</a>
  </div>
</body></html>
"""


def test_parse_drops_marketplace_and_social_keeps_own_site():
    cands = parse_search_results(_DDG_HTML, "Sticky Frog Farms")
    hosts = {c.host for c in cands}
    assert hosts == {"stickyfrogfarms.com"}
    assert cands[0].url == "https://stickyfrogfarms.com"


def test_parse_unwraps_ddg_redirect():
    cands = parse_search_results(_DDG_HTML, "Sticky Frog Farms")
    assert cands[0].url.startswith("https://stickyfrogfarms.com")
    assert "duckduckgo" not in cands[0].url


def test_parse_ranks_name_in_host_highest():
    html = """
    <div class="result"><a class="result__a"
        href="//duckduckgo.com/l/?uddg=https%3A%2F%2Frandomblog.com%2Fpost">
        A blog mentioning Acme Cannabis</a>
      <a class="result__snippet">acme cannabis is great</a></div>
    <div class="result"><a class="result__a"
        href="//duckduckgo.com/l/?uddg=https%3A%2F%2Facmecannabis.com%2F">
        Acme Cannabis Official</a>
      <a class="result__snippet">official home of acme</a></div>
    """
    cands = parse_search_results(html, "Acme Cannabis")
    assert cands[0].host == "acmecannabis.com"
    assert cands[0].score > cands[-1].score


def test_parse_collapses_multiple_paths_to_one_host():
    html = """
    <div class="result"><a class="result__a"
      href="//duckduckgo.com/l/?uddg=https%3A%2F%2Facme.com%2Fabout">Acme About</a></div>
    <div class="result"><a class="result__a"
      href="//duckduckgo.com/l/?uddg=https%3A%2F%2Facme.com%2Fshop">Acme Shop</a></div>
    """
    cands = parse_search_results(html, "Acme")
    assert len(cands) == 1
    assert cands[0].url == "https://acme.com"


def test_parse_drops_document_urls():
    html = """
    <div class="result"><a class="result__a"
      href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fmenu.pdf">menu</a></div>
    """
    assert parse_search_results(html, "Example") == []


def test_parse_empty_html():
    assert parse_search_results("", "Acme") == []


def test_parse_respects_limit():
    rows = "".join(
        f'<div class="result"><a class="result__a" '
        f'href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fsite{i}.com%2F">Site {i}</a></div>'
        for i in range(20)
    )
    cands = parse_search_results(f"<html><body>{rows}</body></html>", "Site", limit=5)
    assert len(cands) == 5


# ---------------------------------------------------------------------------
# extract_contact
# ---------------------------------------------------------------------------

def test_extract_contact_from_anchors_and_text():
    html = """
    <html><body>
      <a href="mailto:hello@stickyfrog.com">Email us</a>
      <a href="tel:+1-360-555-0199">Call</a>
      <p>Reach us at info@stickyfrog.com or (360) 555-0142.</p>
    </body></html>
    """
    c = extract_contact(html)
    assert "hello@stickyfrog.com" in c.emails
    assert "info@stickyfrog.com" in c.emails
    assert "(360) 555-0199" in c.phones
    assert "(360) 555-0142" in c.phones


def test_extract_contact_dedupes_and_normalizes_phone():
    html = '<p>Call 360.555.0100 or 3605550100 or (360) 555-0100.</p>'
    c = extract_contact(html)
    assert c.phones == ["(360) 555-0100"]


def test_extract_contact_strips_leading_country_code():
    html = '<a href="tel:13605551234">x</a>'
    c = extract_contact(html)
    assert c.phones == ["(360) 555-1234"]


def test_extract_contact_empty():
    c = extract_contact("")
    assert c.emails == [] and c.phones == []


# ---------------------------------------------------------------------------
# format_discovery_draft
# ---------------------------------------------------------------------------

def test_format_draft_lists_candidates_and_contact():
    from app.discovery_search import VendorContact
    cands = [
        SiteCandidate(url="https://acme.com", host="acme.com", title="Acme", score=6),
        SiteCandidate(url="https://acme.co", host="acme.co", title="Acme Co", score=3),
    ]
    contact = VendorContact(emails=["hi@acme.com"], phones=["(360) 555-0100"])
    body = format_discovery_draft("Acme", cands, contact)
    assert "Acme" in body
    assert "https://acme.com" in body
    assert "score 6" in body
    assert "hi@acme.com" in body
    assert "(360) 555-0100" in body


def test_format_draft_no_candidates():
    from app.discovery_search import VendorContact
    body = format_discovery_draft("Acme", [], VendorContact())
    assert "No first-party candidate websites found." in body
