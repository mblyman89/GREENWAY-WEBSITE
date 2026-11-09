"""D220 S4 — the cataloguing brain: page typing, image tagging, image↔card matching,
and the public product-feed parsers."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import catalog  # noqa: E402
from app.campaign_feeds import parse_shopify, parse_woocommerce, strip_html  # noqa: E402
from app.catalog import ProductRef, classify_page, match_image, match_status_for, tag_image  # noqa: E402


# ---- names ------------------------------------------------------------------
def test_normalize_and_similarity():
    assert catalog.normalize_name("Blue Dream — 3.5g!") == "blue dream"  # sizes are matched separately
    assert catalog.name_similarity("Blue Dream", "blue dream") == 1.0
    assert catalog.name_similarity("Blue Dream Live Rosin", "Blue Dream") >= 0.6
    assert catalog.name_similarity("Blue Dream", "Wedding Cake") < 0.4


def test_filename_words_drop_noise():
    words = catalog.filename_words("https://cdn.shopify.com/s/files/1/products/Blue-Dream_3.5g_front-1024x1024.jpg?v=12")
    assert "blue" in words and "dream" in words
    assert "1024x1024" not in words and "jpg" not in words


def test_detect_category_size_strain():
    assert catalog.detect_category("Live Rosin Badder 1g") == "concentrate"
    assert catalog.detect_category("Watermelon Gummies 10pk") == "edible"
    assert catalog.detect_category("Infused Pre-Roll 2-pack") == "preroll"
    assert catalog.detect_size("Blue Dream Eighth") == "3.5g"
    assert catalog.detect_size("Gummies 100mg") == "100mg"
    assert catalog.detect_strain_type("A balanced HYBRID strain") == "hybrid"


# ---- pages ------------------------------------------------------------------
def test_classify_product_page_from_jsonld():
    html = """<html><head><title>Blue Dream 3.5g | Acme Farms</title>
    <script type="application/ld+json">{"@type":"Product","name":"Blue Dream","category":"Flower",
    "brand":{"@type":"Brand","name":"Acme Farms"}}</script></head>
    <body><h1>Blue Dream</h1><p>THC: 24.5% Hybrid flower, sweet berry aroma.</p></body></html>"""
    info = classify_page("https://acme.com/products/blue-dream", html, "Blue Dream THC: 24.5% Hybrid flower")
    assert info.page_type == "product"
    assert info.primary_product == "Blue Dream"
    assert info.jsonld_products[0]["brand"] == "Acme Farms"
    assert info.thc_percent == "24.5"
    assert info.strain_type == "hybrid"
    assert "Blue Dream" in info.product_names


def test_classify_listing_and_about_and_home():
    cards = "".join(f'<div class="product-card"><h3 class="product-title">Strain {i}</h3></div>' for i in range(6))
    info = classify_page("https://acme.com/shop/", f"<html><body>{cards}</body></html>", "")
    assert info.page_type == "product_list"
    assert len(info.product_names) == 6
    assert classify_page("https://acme.com/about-us", "<html></html>", "").page_type == "about"
    assert classify_page("https://acme.com/", "<html></html>", "").page_type == "home"
    assert classify_page("https://acme.com/coa/", "<html></html>", "").page_type == "lab_results"
    assert classify_page("https://acme.com/where-to-buy", "<html></html>", "").page_type == "where_to_buy"


# ---- images -----------------------------------------------------------------
def test_tag_image_roles():
    assert tag_image(url="https://a.com/wp-content/uploads/logo-white.png").role == "logo"
    assert tag_image(url="https://a.com/img/hero-banner.jpg").role == "banner"
    coa = tag_image(url="https://a.com/files/blue-dream-coa.jpg")
    assert coa.role == "lab_result"


def test_tag_image_takes_product_from_product_page():
    page = classify_page("https://acme.com/products/blue-dream",
                         '<html><script type="application/ld+json">{"@type":"Product","name":"Blue Dream"}</script>'
                         "<h1>Blue Dream</h1></html>", "Blue Dream flower")
    t = tag_image(url="https://acme.com/img/IMG_2231.jpg", alt="", page=page)
    assert t.product_name == "Blue Dream"
    assert t.role == "product"
    assert "product" in t.tags


def test_tag_image_card_heading_on_listing():
    page = catalog.PageInfo(url="https://acme.com/shop/", page_type="product_list")
    t = tag_image(url="https://acme.com/img/x.jpg", heading="Wedding Cake Live Rosin 1g", page=page)
    assert t.product_name == "Wedding Cake Live Rosin 1g"
    assert t.category == "concentrate"
    assert t.variant_label == "1g"


# ---- matching ---------------------------------------------------------------
PRODUCTS = [
    ProductRef(id="p1", name="Blue Dream", category="Flower", variant_label="3.5g"),
    ProductRef(id="p2", name="Blue Dream", category="Flower", variant_label="1g"),
    ProductRef(id="p3", name="Wedding Cake Live Rosin", category="Concentrate", variant_label="1g"),
    ProductRef(id="p4", name="Watermelon Gummies", category="Edible", variant_label="100mg"),
]


def test_match_prefers_size_and_category():
    c = match_image(product_name="Blue Dream", category="flower", variant_label="3.5g", products=PRODUCTS)
    assert c[0].product_id == "p1"
    assert c[0].score >= 0.9
    assert match_status_for(c[0].score) == "suggested"


def test_match_contradicting_category_costs():
    good = match_image(product_name="Wedding Cake Live Rosin", category="concentrate", products=PRODUCTS)[0]
    bad = match_image(product_name="Wedding Cake Live Rosin", category="edible", products=PRODUCTS)[0]
    assert good.product_id == bad.product_id == "p3"
    assert good.score > bad.score


def test_match_nothing_for_unrelated_names():
    assert match_image(product_name="Company Picnic 2023", products=PRODUCTS) == []
    assert match_image(product_name="", products=PRODUCTS) == []
    assert match_status_for(None) == "unmatched"
    assert match_status_for(0.4) == "unmatched"


# ---- feeds ------------------------------------------------------------------
def test_parse_shopify_feed():
    data = {"products": [
        {"title": "Blue Dream", "handle": "blue-dream", "body_html": "<p>Sweet <b>berry</b> aroma.</p>",
         "product_type": "Flower", "vendor": "Acme", "tags": "hybrid, indoor",
         "variants": [{"title": "3.5g"}, {"title": "7g"}],
         "images": [{"src": "//cdn.shopify.com/a.jpg", "alt": "Blue Dream jar"}]},
        {"title": "", "handle": "x"},
    ]}
    out = parse_shopify(data, "https://acme.com")
    assert len(out) == 1
    p = out[0]
    assert p.url == "https://acme.com/products/blue-dream"
    assert p.description == "Sweet berry aroma."
    assert p.variants == ["3.5g", "7g"]
    assert p.tags == ["hybrid", "indoor"]
    assert p.images[0].url == "https://cdn.shopify.com/a.jpg"
    assert "Options: 3.5g, 7g" in p.text()


def test_parse_woocommerce_feed():
    data = [{"name": "Wedding Cake &amp; Co", "permalink": "https://acme.com/product/wc/",
             "description": "<p>Rosin</p>", "categories": [{"name": "Concentrates"}],
             "tags": [{"name": "rosin"}], "attributes": [{"terms": [{"name": "1g"}, {"name": "2g"}]}],
             "images": [{"src": "https://acme.com/wc.jpg", "alt": ""}]}]
    out = parse_woocommerce(data, "https://acme.com")
    assert out[0].name == "Wedding Cake & Co"
    assert out[0].category == "Concentrates"
    assert out[0].variants == ["1g", "2g"]
    assert strip_html("<b>a</b>&nbsp;b") == "a b"
