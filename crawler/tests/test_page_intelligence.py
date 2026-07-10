"""Slice C1 — image ↔ adjacent-text pairing. Pure DOM logic, no network/LLM.

Owner's requirement (verbatim): "a lot of the product pictures … have their
descriptions outside of the image, in plain text on the page either next to
the image or below it. the crawler needs to … grab an image and realize there
is text to be scraped right next to the image that is very relevant."
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.page_intelligence import (  # noqa: E402
    extract_image_contexts,
    jsonld_product_map,
)

BASE = "https://vendor.example.com/products/"


def _ctx_for(contexts, filename):
    for c in contexts:
        if c.url.endswith(filename):
            return c
    raise AssertionError(f"no context found for {filename}: {[c.url for c in contexts]}")


# ---------------------------------------------------------------------------
# Product-card ancestor: heading + body text NEXT TO the image
# ---------------------------------------------------------------------------

CARD_HTML = """
<html><body>
<ul class="product-grid">
  <li class="product-card">
    <a href="/p/gg4-rosin"><img src="/img/gg4-rosin.jpg" alt=""></a>
    <h3>GG4 Cold Cure Rosin</h3>
    <p>Solventless rosin pressed from fresh-frozen GG4. Gassy, earthy,
       chem-forward aroma with a creamy badder consistency.</p>
    <span class="price">$40.00</span>
  </li>
  <li class="product-card">
    <a href="/p/papaya-punch"><img src="/img/papaya-punch.jpg" alt=""></a>
    <h3>Papaya Punch Live Hash</h3>
    <p>Tropical papaya and stone-fruit flavor from whole-plant fresh frozen.</p>
  </li>
</ul>
</body></html>
"""


def test_card_heading_and_body_are_paired_with_the_image():
    contexts = extract_image_contexts(CARD_HTML, BASE)
    gg4 = _ctx_for(contexts, "gg4-rosin.jpg")
    assert gg4.heading == "GG4 Cold Cure Rosin"
    assert "Solventless rosin" in gg4.nearby_text
    assert gg4.source == "card"
    line = gg4.best_context()
    assert "GG4 Cold Cure Rosin" in line
    assert "Solventless" in line


def test_each_card_pairs_with_its_own_image_not_the_neighbor():
    contexts = extract_image_contexts(CARD_HTML, BASE)
    papaya = _ctx_for(contexts, "papaya-punch.jpg")
    assert papaya.heading == "Papaya Punch Live Hash"
    assert "papaya" in papaya.nearby_text.lower()
    assert "GG4" not in papaya.best_context()


def test_price_only_text_is_not_treated_as_a_description():
    html = """
    <div class="card"><img src="/img/tin.jpg" alt=""><span>$25.00</span></div>
    """
    contexts = extract_image_contexts(html, BASE)
    tin = _ctx_for(contexts, "tin.jpg")
    # $25.00 alone is noise, not context.
    assert "$25" not in tin.best_context()


# ---------------------------------------------------------------------------
# figcaption beats everything
# ---------------------------------------------------------------------------

def test_figcaption_wins_over_card_text():
    html = """
    <div class="card">
      <figure>
        <img src="/img/jar.jpg" alt="jar">
        <figcaption>Blue Dream flower jar, harvest Oct 2025</figcaption>
      </figure>
      <p>Some other card copy that should lose to the figcaption.</p>
    </div>
    """
    contexts = extract_image_contexts(html, BASE)
    jar = _ctx_for(contexts, "jar.jpg")
    assert jar.source == "figcaption"
    assert jar.best_context().startswith("Blue Dream flower jar")


# ---------------------------------------------------------------------------
# JSON-LD Product mapping
# ---------------------------------------------------------------------------

JSONLD_HTML = """
<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product",
 "name":"Grease Monkey Pre-Roll 5pk",
 "description":"Five half-gram pre-rolls of greasy, diesel-forward Grease Monkey.",
 "image":"/img/grease-monkey-5pk.jpg"}
</script>
</head><body>
<img src="/img/grease-monkey-5pk.jpg" alt="">
</body></html>
"""


def test_jsonld_product_pairs_name_and_description_with_image():
    products = jsonld_product_map(JSONLD_HTML, BASE)
    assert any("grease-monkey-5pk.jpg" in k for k in products)
    contexts = extract_image_contexts(JSONLD_HTML, BASE)
    gm = _ctx_for(contexts, "grease-monkey-5pk.jpg")
    assert gm.jsonld_name == "Grease Monkey Pre-Roll 5pk"
    assert "diesel-forward" in gm.jsonld_description
    assert gm.source == "jsonld"
    assert "Grease Monkey Pre-Roll 5pk" in gm.best_context()


def test_jsonld_graph_and_list_images_are_handled():
    html = """
    <script type="application/ld+json">
    {"@graph":[{"@type":"Product","name":"Dosi Gummies",
      "description":"10-pack fruit gummies.",
      "image":["https://vendor.example.com/img/dosi-gummies.png"]}]}
    </script>
    <img src="/img/dosi-gummies.png" alt="">
    """
    contexts = extract_image_contexts(html, BASE)
    dosi = _ctx_for(contexts, "dosi-gummies.png")
    assert dosi.jsonld_name == "Dosi Gummies"


# ---------------------------------------------------------------------------
# Sibling fallback + alt fallback
# ---------------------------------------------------------------------------

def test_sibling_text_below_the_image_is_used_when_no_card_matches():
    # The wrapper holds two images so the single-image card rule can't fire;
    # each image's caption <p> sits directly after it (below it on the page).
    html = """
    <div class="gallery">
      <img src="/img/one.jpg" alt="">
      <p>Sunset Sherbet flower, indoor grown</p>
      <img src="/img/two.jpg" alt="">
      <p>Wedding Cake flower, greenhouse</p>
    </div>
    """
    contexts = extract_image_contexts(html, BASE)
    one = _ctx_for(contexts, "one.jpg")
    assert one.nearby_text.startswith("Sunset Sherbet")
    assert one.source == "sibling"
    two = _ctx_for(contexts, "two.jpg")
    assert two.nearby_text.startswith("Wedding Cake")
    # never steal the NEXT item's caption
    assert "Wedding Cake" not in one.best_context()


def test_alt_text_is_the_last_resort():
    html = '<div><img src="/img/hero.jpg" alt="Farm at sunrise"></div>'
    contexts = extract_image_contexts(html, BASE)
    hero = _ctx_for(contexts, "hero.jpg")
    assert hero.best_context() == "Farm at sunrise"
    assert hero.source == "alt"


# ---------------------------------------------------------------------------
# Lazy-load + placeholder integration (shared best_image_url ladder)
# ---------------------------------------------------------------------------

def test_lazy_loaded_card_image_still_gets_context():
    html = """
    <li class="card">
      <img src="/theme/lazy.svg" data-src="/img/zkittlez.jpg" alt="">
      <h4>Zkittlez Flower</h4>
      <p>Candy-sweet, berry-forward eighths grown in living soil.</p>
    </li>
    """
    contexts = extract_image_contexts(html, BASE)
    z = _ctx_for(contexts, "zkittlez.jpg")
    assert z.heading == "Zkittlez Flower"
    # the placeholder itself is never emitted
    assert not any("lazy.svg" in c.url for c in contexts)


def test_placeholder_only_images_are_dropped():
    html = '<img src="/img/spacer.gif"><img src="data:image/gif;base64,AAA">'
    assert extract_image_contexts(html, BASE) == []


def test_duplicate_image_keeps_the_occurrence_with_context():
    html = """
    <img src="/img/dup.jpg" alt="">
    <div class="card"><img src="/img/dup.jpg" alt="">
      <h3>Named Product</h3><p>With a real description body.</p></div>
    """
    contexts = extract_image_contexts(html, BASE)
    assert len([c for c in contexts if c.url.endswith("dup.jpg")]) == 1
    dup = _ctx_for(contexts, "dup.jpg")
    assert dup.best_context() != ""


def test_limit_is_enforced():
    html = "".join(f'<img src="/img/p{i}.jpg" alt="img {i}">' for i in range(50))
    contexts = extract_image_contexts(html, BASE, limit=10)
    assert len(contexts) == 10


# ---------------------------------------------------------------------------
# Pipeline integration: research_images lines carry the adjacent text
# ---------------------------------------------------------------------------

def test_best_context_lines_are_parseable_by_the_back_office():
    """Back office parses `caption — url` (parseImageLines). Verify shape."""
    contexts = extract_image_contexts(CARD_HTML, BASE)
    for ctx in contexts:
        line = f"{ctx.best_context() or '(no alt text)'} — {ctx.url}"
        idx = line.rfind(" — ")
        assert idx > 0
        assert line[idx + 3:].startswith("https://")
