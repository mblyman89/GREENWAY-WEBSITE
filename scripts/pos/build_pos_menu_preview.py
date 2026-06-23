#!/usr/bin/env python3
"""Build a conservative POS-derived Greenway menu preview feed.

This script is intentionally a dry-run generator. It reads the verified v2 exact
priority matches and writes website-shaped JSON under research output folders.
It does not modify the Next.js app or wire data into the UI.
"""

from __future__ import annotations

import csv
import hashlib
import json
import math
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
ROOT = REPO_ROOT / "pos-data"
ANALYSIS = ROOT / "analysis"
GENERATED = ROOT / "generated"
MATCHES_CSV = ANALYSIS / "priority_matches_v2.csv"
AMBIGUOUS_CSV = ANALYSIS / "priority_ambiguous_v2.csv"
UNMATCHED_CSV = ANALYSIS / "priority_unmatched_v2.csv"
OUT_JSON = GENERATED / "greenway_pos_menu_preview.json"
OUT_SUMMARY = GENERATED / "greenway_pos_menu_preview_summary.json"
OUT_VARIANTS_CSV = GENERATED / "greenway_pos_menu_preview_variants.csv"
WEBSITE_FULL_JSON = REPO_ROOT / "src" / "data" / "pos-menu-preview.json"
WEBSITE_SAMPLE_JSON = REPO_ROOT / "src" / "data" / "pos-menu-sample-preview.json"

WEBSITE_CATEGORIES = {
    "flower",
    "paraphernalia",
    "preroll-pack",
    "cartridge",
    "disposable-cartridge",
    "edible-solid",
    "concentrate",
    "infused-preroll",
    "infused-preroll-pack",
    "preroll",
    "edible-liquid",
    "topical",
    "trim",
}

CONCENTRATE_FAMILY_CATEGORIES = {
    "cartridge",
    "disposable-cartridge",
    "concentrate",
    "infused-preroll",
    "infused-preroll-pack",
}


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    s = str(value).strip()
    if s.lower() in {"nan", "none", "null"}:
        return ""
    return re.sub(r"\s+", " ", s)


def slugify(value: str, fallback: str = "item") -> str:
    s = clean_text(value).lower()
    s = re.sub(r"&", " and ", s)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or fallback


def parse_float(value: Any) -> float | None:
    s = clean_text(value).replace("$", "").replace(",", "")
    if not s:
        return None
    try:
        f = float(s)
        if math.isfinite(f):
            return f
    except ValueError:
        return None
    return None


def parse_int(value: Any) -> int:
    f = parse_float(value)
    if f is None:
        return 0
    return max(0, int(math.floor(f)))


def parse_money_minor(value: Any) -> int | None:
    f = parse_float(value)
    if f is None:
        return None
    return max(0, int(round(f * 100)))


def format_money(minor: int) -> str:
    if minor % 100 == 0:
        return f"${minor // 100}"
    return f"${minor / 100:.2f}"


def pack_count_from_text(*values: str) -> int:
    haystack = " ".join(clean_text(value).lower() for value in values)
    patterns = [
        r"\b(\d+)\s*(?:pk|pack|packs|ct|count)\b",
        r"\b(\d+)\s*x\s*(?:\.\d+|\d+)",
        r"\b(\d+)\s*(?:pre[- ]?rolls?|prerolls?|joints?|blunts?)\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, haystack)
        if match:
            count = parse_int(match.group(1))
            if count > 1:
                return count
    return 1


def normalize_category(category: str, inventory_type: str = "", name: str = "", package: str = "") -> str | None:
    """Map POS inventory type/category/name into customer-facing website categories.

    The POS inventory type is often broad (for example, "Usable Marijuana"),
    while the POS category is usually the customer-facing clue (for example,
    "Cartridge", "Infused Pre-roll", "Flower", "Beverage"). Category is
    therefore weighted before type/name. Type is still used as context for broad
    families such as concentrate-for-inhalation, liquid edible, and non-cannabis.
    """
    category_text = clean_text(category).lower()
    type_text = clean_text(inventory_type).lower()
    name_text = clean_text(name).lower()
    package_text = clean_text(package).lower()
    combined = " ".join([category_text, type_text, name_text, package_text])
    count = pack_count_from_text(category_text, name_text, package_text)

    non_cannabis_type = any(term in type_text for term in ["non-cannabis", "non cannabis", "without inventory type", "sample jar"])
    if non_cannabis_type or any(term in category_text for term in ["accessor", "paraphernalia", "device", "pipe", "blunt wrap", "non cannabis", "other non cannabis"]):
        return "paraphernalia"

    if "disposable" in category_text and "cartridge" in category_text:
        return "disposable-cartridge"
    if "cartridge" in category_text:
        return "cartridge"

    infused_preroll_category = any(term in category_text for term in ["infused pre-roll", "infused preroll", "infused pre roll", "infused blunt"])
    if infused_preroll_category:
        return "infused-preroll-pack" if count > 1 else "infused-preroll"

    plain_preroll_category = any(term in category_text for term in ["pre-roll", "preroll", "pre roll", "blunt"])
    if plain_preroll_category:
        return "preroll-pack" if count > 1 else "preroll"

    if any(term in category_text for term in ["trim", "shake", "popcorn"]):
        return "trim"

    if "flower" in category_text:
        return "flower"

    if any(term in category_text for term in ["topical", "bath salts", "balm", "lotion", "salve", "cream"]) or any(term in type_text for term in ["topical", "transdermal"]):
        return "topical"

    liquid_category = any(term in category_text for term in ["beverage", "shots", "shot", "liquid", "soda", "tincture", "other liquid edible"])
    if liquid_category or "liquid edible" in type_text or "tincture" in type_text:
        return "edible-liquid"

    solid_category = any(term in category_text for term in ["edible", "gummies", "gummy", "chocolate", "fruit chews", "chewees", "mints", "balls", "minis", "capsule", "panda candies", "candy"])
    if solid_category or "solid edible" in type_text or "capsule" in type_text:
        return "edible-solid"

    concentrate_category = any(term in category_text for term in [
        "concentrate", "rosin", "resin", "bho", "badder", "budder", "hash", "rso", "moon rocks", "distillate", "shatter", "diamonds", "crumble", "sugar", "thca", "terp", "pod", "wax", "sauce",
    ])
    if concentrate_category or "concentrate for inhalation" in type_text:
        return "concentrate"

    if any(term in combined for term in ["battery", "glass", "pipe", "lighter", "wrap", "papers", "rolling paper"]):
        return "paraphernalia"
    if any(term in combined for term in ["trim", "shake", "popcorn"]):
        return "trim"
    if any(term in combined for term in ["flower", "bud"]):
        return "flower"
    if any(term in combined for term in ["cartridge"]):
        return "disposable-cartridge" if "disposable" in combined else "cartridge"
    if any(term in combined for term in ["infused pre-roll", "infused preroll", "infused pre roll", "infused blunt"]):
        return "infused-preroll-pack" if count > 1 else "infused-preroll"
    if any(term in combined for term in ["pre-roll", "preroll", "pre roll", "blunt", "joint"]):
        return "preroll-pack" if count > 1 else "preroll"
    return None


def filter_categories_for(primary_category: str, pos_category: str, inventory_type: str, name: str = "") -> list[str]:
    """Return all website filters a product should participate in.

    The first value is always the primary display category. Additional values are
    broad family filters. For example, a POS row with category "Cartridge" and
    type "Concentrate for Inhalation" displays as Cartridge but also appears
    when a customer selects the broader Concentrate filter.
    """
    filters = [primary_category]
    category_text = clean_text(pos_category).lower()
    type_text = clean_text(inventory_type).lower()
    combined = " ".join([category_text, type_text, clean_text(name).lower()])

    if primary_category in CONCENTRATE_FAMILY_CATEGORIES or "concentrate for inhalation" in type_text:
        filters.append("concentrate")
    if primary_category in {"edible-solid", "edible-liquid"}:
        filters.append(primary_category)
    if primary_category == "topical" and any(term in combined for term in ["transdermal", "bath salts"]):
        filters.append("topical")
    if primary_category == "paraphernalia":
        filters.append("paraphernalia")

    return sorted(set(filters), key=filters.index)

# ── Authoritative product-field mapping ─────────────────────────────────
VALID_STRAIN_TYPES = {
    "indica": "indica",
    "sativa": "sativa",
    "hybrid": "hybrid",
    "cbd": "cbd",
}

PRODUCT_NAME_DISPLAY_CATEGORIES = {"edible-solid", "edible-liquid", "topical"}


def normalize_strain_type(pos_type: str) -> str:
    """Use the cleaned Products spreadsheet Type column as the source of truth.

    The POS product master now carries strain type directly, so the website feed
    should not infer strain type from strain names, product names, category, or a
    lookup table. Blank or non-standard values are kept as unknown so data issues
    remain visible and fixable at the source spreadsheet/POS layer.
    """
    value = clean_text(pos_type).lower()
    value = re.sub(r"[^a-z]+", " ", value).strip()
    if not value:
        return "unknown"
    if "cbd" in value:
        return "cbd"
    for key, normalized in VALID_STRAIN_TYPES.items():
        if key in value:
            return normalized
    return "unknown"


def display_name_for_product(product_name: str, strain_name: str, category: str) -> str:
    """Choose the customer-facing card/detail name from mapped POS fields."""
    product_name = clean_text(product_name)
    strain_name = clean_text(strain_name)
    if category in PRODUCT_NAME_DISPLAY_CATEGORIES:
        return product_name or strain_name or "Unnamed product"
    return strain_name or product_name or "Unnamed product"


def description_for_product(description: str, display_name: str, product_name: str) -> str:
    """Use the manually enriched Description column with a conservative fallback."""
    description = clean_text(description)
    if description:
        return description
    label = clean_text(display_name) or clean_text(product_name) or "this product"
    return f"Description pending for {label}."

def package_label(row: dict[str, str]) -> str:
    key = clean_text(row.get("product_package_key")) or clean_text(row.get("inventory_package_key"))
    if key:
        return prettify_package_key(key)
    size = clean_text(row.get("product_package_size")) or clean_text(row.get("inventory_package_size"))
    uom = clean_text(row.get("product_uom"))
    if size and uom:
        return f"{trim_number(size)} {uom}".strip()
    if size:
        return size
    return "each"


def trim_number(value: str) -> str:
    f = parse_float(value)
    if f is None:
        return clean_text(value)
    if abs(f - round(f)) < 1e-9:
        return str(int(round(f)))
    return (f"{f:.3f}").rstrip("0").rstrip(".")


def prettify_package_key(key: str) -> str:
    s = clean_text(key).lower().replace(" ", "")
    m = re.match(r"^(\d+(?:\.\d+)?)([a-z]+)$", s)
    if not m:
        return s or "each"
    num, unit = trim_number(m.group(1)), m.group(2)
    unit_labels = {
        "g": "g",
        "gram": "g",
        "grams": "g",
        "oz": "oz",
        "ounce": "oz",
        "ounces": "oz",
        "mg": "mg",
        "ml": "ml",
        "floz": "fl oz",
        "ea": "each",
        "each": "each",
        "pk": "pack",
        "ct": "count",
    }
    label_unit = unit_labels.get(unit, unit)
    if label_unit == "each" and num == "1":
        return "each"
    return f"{num}{label_unit}" if label_unit in {"g", "oz", "mg", "ml"} else f"{num} {label_unit}"


def unit_for_category(category: str) -> str:
    if category in {"edible-solid", "edible-liquid", "topical"}:
        return "mg"
    return "%"


def cannabinoid_value(raw: Any) -> str | None:
    f = parse_float(raw)
    if f is None or f <= 0:
        return None
    if abs(f - round(f)) < 1e-9:
        return str(int(round(f)))
    return (f"{f:.2f}").rstrip("0").rstrip(".")


def cannabinoid_display(value: str | None, unit: str) -> str | None:
    if value is None:
        return None
    return f"{value}{unit}"


def stable_hash(parts: list[str], length: int = 8) -> str:
    payload = "|".join(clean_text(p).lower() for p in parts)
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:length]


def inventory_status(total_inventory: int) -> str:
    if total_inventory <= 0:
        return "unavailable"
    if total_inventory <= 5:
        return "low-stock"
    return "in-stock"


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def build_preview() -> tuple[list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]]:
    rows = read_csv(MATCHES_CSV)
    ambiguous_count = len(read_csv(AMBIGUOUS_CSV)) if AMBIGUOUS_CSV.exists() else None
    unmatched_count = len(read_csv(UNMATCHED_CSV)) if UNMATCHED_CSV.exists() else None

    counters: Counter[str] = Counter()
    category_counter: Counter[str] = Counter()
    strain_counter: Counter[str] = Counter()
    brand_counter: Counter[str] = Counter()
    exclusion_examples: dict[str, list[dict[str, Any]]] = defaultdict(list)
    groups: dict[tuple[str, ...], list[dict[str, str]]] = defaultdict(list)

    for row in rows:
        counters["strict_match_rows_input"] += 1
        units = parse_int(row.get("units_available"))
        if units <= 0:
            counters["excluded_no_positive_units_available"] += 1
            add_example(exclusion_examples, "no_positive_units_available", row)
            continue

        product_name = clean_text(row.get("product_name")) or clean_text(row.get("inventory_product"))
        brand = clean_text(row.get("product_brand")) or clean_text(row.get("inventory_brand")) or "Greenway"
        category = normalize_category(row.get("product_category", "") or row.get("inventory_category", ""), row.get("product_inventory_type", ""), product_name, package_label(row))
        if category not in WEBSITE_CATEGORIES:
            counters["excluded_unmapped_category"] += 1
            add_example(exclusion_examples, "unmapped_category", row)
            continue

        strain = normalize_strain_type(row.get("product_type", ""))
        strain_name = clean_text(row.get("product_strain")) or clean_text(row.get("inventory_strain"))
        display_name = display_name_for_product(product_name, strain_name, category)
        key = (slugify(product_name), slugify(brand), category, strain, slugify(display_name))
        groups[key].append(row)
        counters["included_variant_rows"] += 1
        category_counter[category] += 1
        strain_counter[strain] += 1
        brand_counter[brand] += 1

    items: list[dict[str, Any]] = []
    variant_audit_rows: list[dict[str, Any]] = []

    for key, group_rows in sorted(groups.items(), key=lambda item: (item[0][2], item[0][1], item[0][0])):
        first = group_rows[0]
        product_name = clean_text(first.get("product_name")) or clean_text(first.get("inventory_product"))
        brand = clean_text(first.get("product_brand")) or clean_text(first.get("inventory_brand")) or "Greenway"
        category = normalize_category(first.get("product_category", "") or first.get("inventory_category", ""), first.get("product_inventory_type", ""), product_name, package_label(first)) or "paraphernalia"
        strain = normalize_strain_type(first.get("product_type", ""))
        strain_name = clean_text(first.get("product_strain")) or clean_text(first.get("inventory_strain", ""))
        name = display_name_for_product(product_name, strain_name, category)
        description = description_for_product(first.get("product_description", ""), name, product_name)
        item_hash = stable_hash([product_name, brand, category, strain, name])
        item_id = f"pos-{category}-{slugify(brand)}-{slugify(product_name)}-{item_hash}"
        unit = unit_for_category(category)

        variants_by_signature: dict[tuple[str, int], dict[str, Any]] = {}
        source_inventory_ids: list[str] = []
        thc_values: list[float] = []
        cbd_values: list[float] = []
        total_values: list[float] = []

        for row in group_rows:
            source_inventory_ids.append(clean_text(row.get("inventory_id")))
            units = parse_int(row.get("units_available"))
            label = package_label(row)
            price_minor = parse_money_minor(row.get("product_price_master"))
            if price_minor is None or price_minor <= 0:
                price_minor = parse_money_minor(row.get("product_price_inventory")) or 0
            sig = (label, price_minor)
            variant = variants_by_signature.get(sig)
            if variant is None:
                variant_hash = stable_hash([item_id, label, str(price_minor)], 6)
                variant = {
                    "id": f"{item_id}-{slugify(label, 'variant')}-{variant_hash}",
                    "label": label,
                    "priceMinorUnits": price_minor,
                    "inventoryLevel": 0,
                    "medical": clean_text(row.get("is_medical")).lower() in {"yes", "y", "true", "1"},
                }
                variants_by_signature[sig] = variant
            variant["inventoryLevel"] += units

            for target, raw in [(thc_values, row.get("thc")), (cbd_values, row.get("cbd")), (total_values, row.get("total"))]:
                f = parse_float(raw)
                if f is not None and f > 0:
                    target.append(f)

        variants = sorted(variants_by_signature.values(), key=lambda v: (v["priceMinorUnits"], v["label"]))
        total_inventory = sum(v["inventoryLevel"] for v in variants)
        lowest_price = min((v["priceMinorUnits"] for v in variants if v["priceMinorUnits"] > 0), default=0)
        lowest_variant = next((v for v in variants if v["priceMinorUnits"] == lowest_price), variants[0] if variants else None)

        thc_value = cannabinoid_value(max(total_values) if total_values else (max(thc_values) if thc_values else None))
        cbd_value = cannabinoid_value(max(cbd_values) if cbd_values else None)
        total_thc = {"type": "thc", "value": thc_value, "unit": unit} if thc_value is not None else None
        total_cbd = {"type": "cbd", "value": cbd_value, "unit": unit} if cbd_value is not None else None
        compounds = [c for c in [total_thc, total_cbd] if c is not None]
        price_label = f"{format_money(lowest_price)} {lowest_variant['label']}" if lowest_price and lowest_variant else "Price pending"

        item = {
            "id": item_id,
            "name": name,
            "productName": product_name,
            "brand": brand,
            "category": category,
            "filterCategories": filter_categories_for(category, first.get("product_category", "") or first.get("inventory_category", ""), first.get("product_inventory_type", ""), name),
            "posInventoryType": clean_text(first.get("product_inventory_type")),
            "posInventoryCategory": clean_text(first.get("product_category")) or clean_text(first.get("inventory_category")),
            "strainType": strain,
            "strainName": strain_name,
            "thc": cannabinoid_display(thc_value, unit),
            "cbd": cannabinoid_display(cbd_value, unit),
            "totalThc": total_thc,
            "totalCbd": total_cbd,
            "compounds": compounds,
            "description": description,
            "priceLabel": price_label,
            "priceMinorUnits": lowest_price,
            "inventoryStatus": inventory_status(total_inventory),
            "variants": variants,
            "_previewMeta": {
                "source": "priority_matches_v2.csv",
                "matchMethod": "exact_name_brand_package",
                "sourceInventoryIds": [sid for sid in source_inventory_ids if sid],
                "sourceRowCount": len(group_rows),
                "generatedForInspectionOnly": True,
            },
        }
        items.append(item)

        for variant in variants:
            variant_audit_rows.append({
                "item_id": item_id,
                "name": name,
                "productName": product_name,
                "brand": brand,
                "category": category,
                "filterCategories": "|".join(filter_categories_for(category, first.get("product_category", "") or first.get("inventory_category", ""), first.get("product_inventory_type", ""), name)),
                "posInventoryType": clean_text(first.get("product_inventory_type")),
                "posInventoryCategory": clean_text(first.get("product_category")) or clean_text(first.get("inventory_category")),
                "strainType": strain,
                "variant_id": variant["id"],
                "variant_label": variant["label"],
                "priceMinorUnits": variant["priceMinorUnits"],
                "inventoryLevel": variant["inventoryLevel"],
                "inventoryStatus": item["inventoryStatus"],
            })

    item_category_counter = Counter(item["category"] for item in items)
    item_strain_counter = Counter(item["strainType"] for item in items)
    status_counter = Counter(item["inventoryStatus"] for item in items)
    variant_count = sum(len(item["variants"]) for item in items)
    total_inventory_units = sum(sum(v["inventoryLevel"] for v in item["variants"]) for item in items)

    summary = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "input_files": {
            "strict_matches": str(MATCHES_CSV.relative_to(ROOT.parent.parent)),
            "ambiguous": str(AMBIGUOUS_CSV.relative_to(ROOT.parent.parent)) if AMBIGUOUS_CSV.exists() else None,
            "unmatched": str(UNMATCHED_CSV.relative_to(ROOT.parent.parent)) if UNMATCHED_CSV.exists() else None,
        },
        "row_counts": {
            "strict_match_rows_input": counters["strict_match_rows_input"],
            "ambiguous_rows_not_included_this_slice": ambiguous_count,
            "unmatched_rows_not_included_this_slice": unmatched_count,
            "included_variant_rows": counters["included_variant_rows"],
            "excluded_no_positive_units_available": counters["excluded_no_positive_units_available"],
            "excluded_unmapped_category": counters["excluded_unmapped_category"],
        },
        "menu_counts": {
            "generated_product_cards": len(items),
            "generated_variants": variant_count,
            "total_inventory_units_in_preview": total_inventory_units,
            "average_variants_per_product": round(variant_count / len(items), 2) if items else 0,
        },
        "item_category_counts": dict(sorted(item_category_counter.items())),
        "item_strain_counts": dict(sorted(item_strain_counter.items())),
        "inventory_status_counts": dict(sorted(status_counter.items())),
        "top_brands_by_included_variant_rows": dict(brand_counter.most_common(25)),
        "included_variant_row_category_counts": dict(sorted(category_counter.items())),
        "included_variant_row_strain_counts": dict(sorted(strain_counter.items())),
        "exclusion_examples": exclusion_examples,
        "notes": [
            "This feed maps website categories from POS inventory type plus POS category, with product_category weighted as the customer-facing clue.",
            "Only strict exact v2 matches are included. Ambiguous, fuzzy, and unmatched rows are intentionally held back for later guardrails.",
            "Rows with zero available-for-sale units are excluded from public-menu preview output.",
            "Descriptions come from the manually enriched Description column in the Products workbook when present.",
            "Images are still not included because the POS exports do not provide downloadable product image assets.",
        ],
    }
    return items, summary, variant_audit_rows


def add_example(bucket: dict[str, list[dict[str, Any]]], reason: str, row: dict[str, str], limit: int = 8) -> None:
    if len(bucket[reason]) >= limit:
        return
    bucket[reason].append({
        "inventory_id": clean_text(row.get("inventory_id")),
        "inventory_product": clean_text(row.get("inventory_product")),
        "product_name": clean_text(row.get("product_name")),
        "product_brand": clean_text(row.get("product_brand")) or clean_text(row.get("inventory_brand")),
        "product_category": clean_text(row.get("product_category")) or clean_text(row.get("inventory_category")),
        "units_available": clean_text(row.get("units_available")),
    })


def write_variant_audit(rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    with OUT_VARIANTS_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    GENERATED.mkdir(parents=True, exist_ok=True)
    items, summary, variant_rows = build_preview()
    payload = json.dumps(items, indent=2, ensure_ascii=False) + "\n"
    OUT_JSON.write_text(payload, encoding="utf-8")
    OUT_SUMMARY.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    write_variant_audit(variant_rows)
    WEBSITE_FULL_JSON.write_text(payload, encoding="utf-8")
    WEBSITE_SAMPLE_JSON.write_text(json.dumps(items[:60], indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output_json": str(OUT_JSON),
        "output_summary": str(OUT_SUMMARY),
        "output_variants_csv": str(OUT_VARIANTS_CSV),
        "website_full_json": str(WEBSITE_FULL_JSON),
        "website_sample_json": str(WEBSITE_SAMPLE_JSON),
        "generated_product_cards": len(items),
        "generated_variants": len(variant_rows),
    }, indent=2))


if __name__ == "__main__":
    main()
