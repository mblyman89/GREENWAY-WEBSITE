"""D220 S4 — the cataloguing brain (pure functions, no network).

Owner: "please do your best to tag and label and catalog everything so it is
easy to match images to product cards. please make it as incredibly
inteligent as possible."

Everything here is deterministic and unit-tested; the AI layer (vision +
page facts, crawler/app/campaign_ai.py) only REFINES what these heuristics
already produced, so the catalogue is useful even with AI switched off.

  classify_page(url, html, text)        -> PageInfo (type, title, h1, product names, jsonld products)
  tag_image(ctx, page)                  -> ImageTags (role, product, strain, category, size, tags, confidence)
  match_image(tags, products)           -> [MatchCandidate] best first, score 0..1
  normalize_name / name_similarity      -> the shared fuzzy-name primitives
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from urllib.parse import unquote, urlparse

from bs4 import BeautifulSoup

# ---------------------------------------------------------------------------
# Vocabulary
# ---------------------------------------------------------------------------
PAGE_TYPES = ("home", "about", "product", "product_list", "strain", "contact", "blog",
              "faq", "lab_results", "where_to_buy", "legal", "careers", "other")

IMAGE_ROLES = ("product", "packaging", "flower_closeup", "lifestyle", "logo", "banner", "team",
               "facility", "lab_result", "icon", "other", "unknown")

# URL path → page type (first match wins; checked on the lowercased path).
_PATH_RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("lab_results", re.compile(r"/(coa|coas|lab[-_]?results?|test[-_]?results?|certificates?)(/|$|\.)")),
    ("where_to_buy", re.compile(r"/(where[-_]?to[-_]?(buy|find)|find[-_]?us|store[-_]?locator|retailers?|stockists?|locations?|dispensar(y|ies))(/|$)")),
    ("legal", re.compile(r"/(privacy|terms|tos|legal|accessibility|cookie|disclaimer|refund)")),
    ("careers", re.compile(r"/(careers?|jobs?|join[-_]?(us|our[-_]?team)|employment|hiring)(/|$)")),
    ("contact", re.compile(r"/(contact|contact[-_]?us|wholesale|get[-_]?in[-_]?touch)(/|$)")),
    ("faq", re.compile(r"/(faqs?|help|questions)(/|$)")),
    ("about", re.compile(r"/(about|about[-_]?us|our[-_]?(story|team|farm|mission|process|values)|story|mission|who[-_]?we[-_]?are|the[-_]?farm|process|cultivation|sustainability)(/|$)")),
    ("blog", re.compile(r"/(blog|news|press|articles?|posts?|journal|events?)(/|$)")),
    ("strain", re.compile(r"/(strains?|genetics|cultivars?|menu/strain)(/|$)")),
    ("product", re.compile(r"/(products?|shop|store|item)/[^/]+/?$")),
    ("product_list", re.compile(r"/(products?|shop|store|menu|catalog|collections?|brands?|flower|pre[-_]?rolls?|vapes?|cartridges?|edibles?|concentrates?|extracts?|rosin|tinctures?|topicals?|beverages?)(/|$)")),
)

# Categories (canonical) and the words that signal them.
CATEGORY_WORDS: dict[str, tuple[str, ...]] = {
    "flower": ("flower", "eighth", "eighths", "1/8", "bud", "buds", "nug", "nugs", "smalls", "popcorn", "shake"),
    "preroll": ("pre-roll", "preroll", "pre roll", "prerolls", "pre-rolls", "joint", "joints", "blunt", "infused pre"),
    "vape": ("vape", "cartridge", "cart", "carts", "disposable", "pod", "510", "all-in-one", "aio"),
    "concentrate": ("concentrate", "rosin", "resin", "live resin", "shatter", "wax", "badder", "budder", "sauce",
                    "diamonds", "hash", "kief", "crumble", "sugar", "distillate", "rso"),
    "edible": ("edible", "gummy", "gummies", "chocolate", "chew", "chews", "candy", "cookie", "mint", "mints",
               "lozenge", "caramel", "baked", "brownie", "taffy"),
    "beverage": ("beverage", "drink", "soda", "seltzer", "tea", "coffee", "shot", "tonic", "lemonade"),
    "tincture": ("tincture", "drops", "dropper", "oil"),
    "topical": ("topical", "balm", "lotion", "salve", "cream", "patch", "bath", "rub"),
    "capsule": ("capsule", "capsules", "tablet", "tablets", "softgel", "pill"),
}

_ROLE_URL_WORDS: dict[str, tuple[str, ...]] = {
    "logo": ("logo", "brandmark", "wordmark", "favicon", "site-icon", "siteicon", "emblem"),
    "icon": ("icon", "sprite", "badge", "arrow", "chevron", "social", "instagram", "facebook", "twitter",
             "payment", "visa", "mastercard", "star-rating", "rating"),
    "banner": ("banner", "hero", "slider", "slide", "header-bg", "background", "bg-", "cover", "masthead"),
    "team": ("team", "staff", "founder", "owner", "headshot", "portrait", "crew", "family"),
    "facility": ("facility", "greenhouse", "grow-room", "growroom", "farm", "field", "garden", "barn", "warehouse",
                 "lab-", "extraction", "drying", "trim"),
    "lab_result": ("coa", "lab-result", "labresult", "certificate", "test-result", "terpene-chart", "potency"),
    "packaging": ("package", "packaging", "jar", "tin", "box", "bag", "pouch", "tube", "label", "mylar",
                  "front", "back", "mockup", "render", "pack"),
    "flower_closeup": ("bud", "nug", "macro", "closeup", "close-up", "trichome", "flower-shot"),
    "lifestyle": ("lifestyle", "people", "hiking", "outdoor", "beach", "party", "adventure", "mood"),
}

_SIZE_RE = re.compile(
    r"(?<![\w.])(\d+(?:\.\d+)?)\s*(g|gram|grams|gr|mg|ml|oz|ounce|pk|pack|ct|count)\b|"
    r"(?<![\w/])(1/8|1/4|1/2)\s*(?:oz|ounce)?\b|"
    r"\b(eighth|quarter|half[- ]ounce|ounce)\b",
    re.I,
)
_STRAIN_TYPE_RE = re.compile(r"\b(indica|sativa|hybrid|cbd|1:1|2:1|high[- ]cbd)\b", re.I)
_THC_RE = re.compile(r"\b(?:thc[a]?|total thc)\s*[:\-]?\s*(\d{1,2}(?:\.\d+)?)\s*%", re.I)
_WORD_RE = re.compile(r"[a-z0-9]+")
_JUNK_TOKENS = frozenset({
    "the", "and", "of", "a", "an", "by", "with", "for", "in", "on", "to", "x", "co", "inc", "llc",
    "img", "image", "images", "photo", "pic", "jpg", "jpeg", "png", "webp", "gif", "copy", "final", "web",
    "min", "large", "small", "medium", "thumb", "thumbnail", "scaled", "edited", "new", "v", "wp", "content",
    "uploads", "cdn", "shopify", "files", "products", "product",
})
_NUM_DIMS_RE = re.compile(r"\d+x\d+")


# ---------------------------------------------------------------------------
# Names
# ---------------------------------------------------------------------------
def normalize_name(text: str) -> str:
    """Lowercase, strip sizes/strain types/punctuation and filler tokens."""
    t = (text or "").lower().replace("&amp;", "&")
    t = _SIZE_RE.sub(" ", t)
    t = _NUM_DIMS_RE.sub(" ", t)
    # Standalone numbers are kept: "Gelato 33" and "Gelato 41" are different strains.
    # Sizes were removed above, and 4+ digit runs (years, SKUs) are dropped.
    tokens = [w for w in _WORD_RE.findall(t) if w not in _JUNK_TOKENS and not (w.isdigit() and len(w) > 3)]
    return " ".join(tokens)


def name_tokens(text: str) -> set[str]:
    return set(normalize_name(text).split())


def name_similarity(a: str, b: str) -> float:
    """0..1 — max of token-set Jaccard and character ratio on normalized names;
    a full containment of the shorter name in the longer one scores >= 0.85."""
    na, nb = normalize_name(a), normalize_name(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    ta, tb = set(na.split()), set(nb.split())
    nums_a = {w for w in ta if w.isdigit()}
    nums_b = {w for w in tb if w.isdigit()}
    if nums_a and nums_b and nums_a != nums_b:
        # "Gelato 33" vs "Gelato 41": a conflicting number means a different product.
        return 0.4
    jacc = len(ta & tb) / max(1, len(ta | tb))
    ratio = SequenceMatcher(None, na, nb).ratio()
    contain = 0.0
    small, big = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
    if small and small <= big:
        contain = 0.85 + 0.15 * (len(small) / max(1, len(big)))
    return round(max(jacc, ratio, contain), 3)


def filename_words(url: str) -> str:
    """'…/uploads/2024/03/Papaya-Punch-Live-Rosin-1g-front-800x800.jpg' → 'papaya punch live rosin 1g front'."""
    path = unquote(urlparse(url).path)
    base = path.rsplit("/", 1)[-1]
    base = re.sub(r"\.[a-z0-9]{2,5}$", "", base, flags=re.I)
    base = _NUM_DIMS_RE.sub(" ", base)
    base = re.sub(r"[_\-+.]+", " ", base)
    base = re.sub(r"\b[0-9a-f]{12,}\b", " ", base, flags=re.I)  # hashes
    return re.sub(r"\s+", " ", base).strip().lower()


# ---------------------------------------------------------------------------
# Small extractors
# ---------------------------------------------------------------------------
def detect_category(text: str) -> str:
    low = f" {(text or '').lower()} "
    best, best_n = "", 0
    for cat, words in CATEGORY_WORDS.items():
        n = sum(1 for w in words if re.search(rf"(?<![a-z]){re.escape(w)}(?![a-z])", low))
        if n > best_n:
            best, best_n = cat, n
    return best


def detect_size(text: str) -> str:
    m = _SIZE_RE.search(text or "")
    if not m:
        return ""
    if m.group(1):
        unit = m.group(2).lower()
        unit = {"gram": "g", "grams": "g", "gr": "g", "ounce": "oz", "pack": "pk", "count": "ct"}.get(unit, unit)
        num = m.group(1)
        if num.endswith(".0"):
            num = num[:-2]
        return f"{num}{unit}"
    if m.group(3):
        return {"1/8": "3.5g", "1/4": "7g", "1/2": "14g"}[m.group(3)]
    word = (m.group(4) or "").lower().replace(" ", "-")
    return {"eighth": "3.5g", "quarter": "7g", "half-ounce": "14g", "ounce": "28g"}.get(word, "")


def detect_strain_type(text: str) -> str:
    m = _STRAIN_TYPE_RE.search(text or "")
    return m.group(1).lower() if m else ""


def _clip(s: str, n: int) -> str:
    s = re.sub(r"\s+", " ", (s or "")).strip()
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------
@dataclass
class PageInfo:
    url: str
    page_type: str = "other"
    title: str = ""
    h1: str = ""
    og_title: str = ""
    og_image: str = ""
    word_count: int = 0
    product_names: list[str] = field(default_factory=list)
    jsonld_products: list[dict] = field(default_factory=list)
    primary_product: str = ""
    category: str = ""
    size: str = ""
    strain_type: str = ""
    thc_percent: str = ""
    excerpt: str = ""


def _jsonld_nodes(soup: BeautifulSoup):
    for tag in soup.find_all("script", attrs={"type": "application/ld+json"}):
        raw = tag.string or tag.text or ""
        try:
            data = json.loads(raw)
        except Exception:
            continue
        stack = [data]
        while stack:
            node = stack.pop()
            if isinstance(node, list):
                stack.extend(node)
            elif isinstance(node, dict):
                yield node
                for k in ("@graph", "itemListElement", "hasVariant", "offers"):
                    v = node.get(k)
                    if isinstance(v, (list, dict)):
                        stack.append(v)
                if isinstance(node.get("item"), dict):
                    stack.append(node["item"])


def _types(node: dict) -> list[str]:
    t = node.get("@type", "")
    return [str(x).lower() for x in (t if isinstance(t, list) else [t])]


def classify_page(url: str, html: str, text: str, *, entry_url: str = "") -> PageInfo:
    """Type the page and pull the product facts its markup states outright."""
    info = PageInfo(url=url)
    soup = BeautifulSoup(html or "", "lxml") if html else None
    if soup is not None:
        if soup.title and soup.title.string:
            info.title = _clip(soup.title.string, 300)
        h1 = soup.find("h1")
        if h1:
            info.h1 = _clip(h1.get_text(" "), 300)
        og = soup.find("meta", attrs={"property": "og:title"})
        if og and og.get("content"):
            info.og_title = _clip(og["content"], 300)
        ogi = soup.find("meta", attrs={"property": "og:image"})
        if ogi and ogi.get("content"):
            info.og_image = ogi["content"].strip()
        ogt = soup.find("meta", attrs={"property": "og:type"})
        og_type = (ogt.get("content") or "").lower() if ogt else ""
        for node in _jsonld_nodes(soup):
            if "product" in _types(node):
                name = _clip(str(node.get("name") or ""), 200)
                if name:
                    info.jsonld_products.append({
                        "name": name,
                        "description": _clip(str(node.get("description") or ""), 600),
                        "sku": str(node.get("sku") or ""),
                        "category": str(node.get("category") or ""),
                        "brand": (node.get("brand") or {}).get("name", "") if isinstance(node.get("brand"), dict) else str(node.get("brand") or ""),
                    })
        # Product-card headings on listing pages.
        names: list[str] = []
        for el in soup.select(
            "[class*=product-title], [class*=product_title], [class*=product-name], [class*=productName], "
            "[class*=card-title], [class*=item-title], .woocommerce-loop-product__title, h2.product-title, h3.product-title"
        )[:300]:
            t = _clip(el.get_text(" "), 160)
            if t and t not in names:
                names.append(t)
        info.product_names = names[:200]
    else:
        og_type = ""

    path = urlparse(url).path.lower() or "/"
    entry_path = urlparse(entry_url).path.lower() if entry_url else "/"
    ptype = ""
    if path in ("/", "", "/home", "/index.html") or (entry_url and path == entry_path):
        ptype = "home"
    if not ptype:
        for name, rx in _PATH_RULES:
            if rx.search(path):
                ptype = name
                break
    if info.jsonld_products and len(info.jsonld_products) == 1 and ptype in ("", "product_list", "strain", "other"):
        ptype = "product" if ptype != "strain" else "strain"
    if not ptype and og_type == "product":
        ptype = "product"
    if ptype == "product_list" and len(info.product_names) <= 1 and (info.jsonld_products or og_type == "product"):
        ptype = "product"
    if not ptype and len(info.product_names) >= 4:
        ptype = "product_list"
    info.page_type = ptype or "other"

    body = text or ""
    info.word_count = len(body.split())
    head = " ".join(p for p in (info.h1, info.og_title, info.title) if p)
    if info.page_type in ("product", "strain"):
        primary = (info.jsonld_products[0]["name"] if info.jsonld_products else "") or info.h1 or info.og_title
        info.primary_product = _clip(re.split(r"\s+[|–—-]\s+", primary)[0] if primary else "", 160)
        if info.primary_product and info.primary_product not in info.product_names:
            info.product_names.insert(0, info.primary_product)
    sample = f"{head} {body[:4000]}"
    info.category = detect_category(f"{head} {head} {body[:1500]}")
    info.size = detect_size(head) or (detect_size(body[:1500]) if info.page_type == "product" else "")
    info.strain_type = detect_strain_type(sample)
    m = _THC_RE.search(sample)
    info.thc_percent = m.group(1) if m else ""
    info.excerpt = _clip(body, 6000)
    return info


# ---------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------
@dataclass
class ImageTags:
    role: str = "unknown"
    role_confidence: float = 0.3
    product_name: str = ""
    strain_name: str = ""
    category: str = ""
    variant_label: str = ""
    tags: list[str] = field(default_factory=list)
    context: str = ""


def _has_word(hay: str, words: tuple[str, ...]) -> bool:
    return any(re.search(rf"(?<![a-z]){re.escape(w)}(?![a-z])", hay) for w in words)


def tag_image(
    *,
    url: str,
    alt: str = "",
    caption: str = "",
    heading: str = "",
    nearby_text: str = "",
    jsonld_name: str = "",
    page: PageInfo | None = None,
    vendor_name: str = "",
) -> ImageTags:
    """Heuristic first pass: what is this image, and which product is it?"""
    fname = filename_words(url)
    text_ctx = " ".join(p for p in (alt, caption, heading, jsonld_name, nearby_text) if p)
    hay = f" {fname} {text_ctx.lower()} "
    out = ImageTags()
    out.context = _clip(" · ".join(p for p in (caption or jsonld_name, heading, nearby_text, alt) if p), 400)

    low_url = url.lower()
    if low_url.endswith(".svg") or _has_word(fname, _ROLE_URL_WORDS["logo"]) or (
        vendor_name and alt and normalize_name(alt) == normalize_name(vendor_name) and "logo" in hay
    ):
        out.role, out.role_confidence = "logo", 0.8
    elif _has_word(fname, _ROLE_URL_WORDS["icon"]):
        out.role, out.role_confidence = "icon", 0.7
    elif _has_word(hay, _ROLE_URL_WORDS["lab_result"]):
        out.role, out.role_confidence = "lab_result", 0.6
    elif _has_word(fname, _ROLE_URL_WORDS["banner"]):
        out.role, out.role_confidence = "banner", 0.6
    elif _has_word(hay, _ROLE_URL_WORDS["team"]):
        out.role, out.role_confidence = "team", 0.5
    elif _has_word(hay, _ROLE_URL_WORDS["packaging"]):
        out.role, out.role_confidence = "packaging", 0.55
    elif _has_word(hay, _ROLE_URL_WORDS["flower_closeup"]):
        out.role, out.role_confidence = "flower_closeup", 0.5
    elif _has_word(hay, _ROLE_URL_WORDS["facility"]):
        out.role, out.role_confidence = "facility", 0.45
    elif _has_word(hay, _ROLE_URL_WORDS["lifestyle"]):
        out.role, out.role_confidence = "lifestyle", 0.45

    # Which product? Strongest evidence first.
    product = jsonld_name or ""
    if not product and page is not None and page.page_type in ("product", "strain") and page.primary_product:
        product = page.primary_product
    if not product and heading and page is not None and page.page_type in ("product_list", "strain", "product"):
        product = heading
    if not product and caption:
        product = caption
    if product:
        product = _clip(re.split(r"\s+[|–—]\s+", product)[0], 160)
    out.product_name = product
    if product and out.role in ("unknown", "flower_closeup", "lifestyle"):
        out.role = "product" if out.role == "unknown" else out.role
        out.role_confidence = max(out.role_confidence, 0.55)

    cat_src = " ".join(p for p in (product, fname, alt, heading, caption) if p)
    out.category = detect_category(cat_src) or (page.category if page is not None and product else "")
    out.variant_label = detect_size(" ".join(p for p in (product, alt, fname, heading) if p))
    if page is not None and page.page_type in ("strain",) and product:
        out.strain_name = product

    tags: list[str] = []
    for t in (out.role, out.category, out.variant_label, detect_strain_type(hay),
              page.page_type if page is not None else ""):
        if t and t not in tags and t != "unknown":
            tags.append(t)
    for w in ("front", "back", "side", "open", "lineup", "group", "close", "jar", "tin", "box", "bag",
              "pouch", "tube", "cart", "gummies", "chocolate", "joint", "rosin", "hash", "live", "badder",
              "sauce", "diamonds", "infused", "multi", "pack", "kit", "merch", "sticker", "hat", "shirt"):
        if re.search(rf"(?<![a-z]){w}(?![a-z])", hay) and w not in tags:
            tags.append(w)
    out.tags = tags[:20]
    return out


# ---------------------------------------------------------------------------
# Matching images ↔ product cards
# ---------------------------------------------------------------------------
@dataclass
class ProductRef:
    id: str
    name: str
    category: str = ""
    variant_label: str = ""
    strain_name: str = ""
    brand: str = ""


@dataclass
class MatchCandidate:
    product_id: str
    name: str
    score: float
    reason: str

    def as_dict(self) -> dict:
        return {"id": self.product_id, "name": self.name, "score": self.score, "reason": self.reason}


def match_image(
    *,
    product_name: str,
    category: str = "",
    variant_label: str = "",
    strain_name: str = "",
    extra_text: str = "",
    products: list[ProductRef],
    limit: int = 3,
) -> list[MatchCandidate]:
    """Rank product cards for one catalogued image. Score is 0..1:
    0.70 × best name similarity (product name / strain / filename-ish text)
    + 0.15 category agreement + 0.15 size agreement (missing facts are neutral,
    a contradiction costs). Nothing under 0.35 is returned."""
    if not products:
        return []
    probes = [p for p in (product_name, strain_name, extra_text) if p]
    if not probes:
        return []
    out: list[MatchCandidate] = []
    for pr in products:
        names = [pr.name] + ([pr.strain_name] if pr.strain_name else [])
        sim = 0.0
        for probe in probes:
            for n in names:
                sim = max(sim, name_similarity(probe, n))
        if sim < 0.4:
            continue
        reasons = [f"name {sim:.2f}"]
        cat_part = 0.075  # neutral
        if category and pr.category:
            pc = detect_category(pr.category) or pr.category.lower()
            if pc == category:
                cat_part, _ = 0.15, reasons.append("category")
            else:
                cat_part, _ = 0.0, reasons.append("category differs")
        size_part = 0.075
        if variant_label and pr.variant_label:
            if detect_size(pr.variant_label) == variant_label or pr.variant_label.lower() == variant_label.lower():
                size_part, _ = 0.15, reasons.append("size")
            else:
                size_part, _ = 0.0, reasons.append("size differs")
        score = round(min(1.0, 0.70 * sim + cat_part + size_part), 3)
        if score >= 0.35:
            out.append(MatchCandidate(pr.id, pr.name, score, ", ".join(reasons)))
    out.sort(key=lambda c: c.score, reverse=True)
    return out[:limit]


def match_status_for(score: float | None) -> str:
    if score is None:
        return "unmatched"
    return "suggested" if score >= 0.6 else "unmatched"
