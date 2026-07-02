#!/usr/bin/env python3
"""build_product_categories.py — generate the verified KB product-category taxonomy.

Reads product_categories_seed.json (built by /workspace/kb_sources, sourced from WA
I-502 inventory types + Kushy retail categories) and emits:
  1. product_categories_seed.sql — idempotent upsert on slug (run AFTER 0070).
  2. ../../src/lib/ai/kb/product-categories-data.ts — typed seed the app imports.

Customer-facing FACTS ONLY — no medical or effect claims (WA I-502).
Run:  python3 build_product_categories.py
"""
import csv, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))

CATEGORIES = [
    # (slug, name, group, summary, wa_inventory_types[], aliases[])
    ("flower", "Flower", "flower",
     "Dried, cured cannabis buds sold by weight for smoking or as an ingredient in other products.",
     ["Flower Lot", "Marijuana Mix", "Marijuana Mix Packaged"], ["bud", "eighth", "nug"]),
    ("pre-roll", "Pre-Rolls", "flower",
     "Ready-to-smoke cannabis joints rolled from ground flower; may be single or multi-packs and can be infused.",
     ["Marijuana Mix Infused"], ["preroll", "joint", "pre roll", "cone"]),
    ("wax", "Wax", "concentrate",
     "A soft, opaque cannabis concentrate with a wax-like texture, made by extracting resin from flower.",
     ["Hydrocarbon Wax"], ["budder", "crumble"]),
    ("shatter", "Shatter", "concentrate",
     "A hard, glass-like cannabis concentrate that is brittle and translucent.",
     ["Food Grade Solvent Extract"], []),
    ("live-resin", "Live Resin", "concentrate",
     "A concentrate made from fresh-frozen cannabis to preserve a fuller terpene profile.",
     ["Marijuana Extract for Inhalation"], ["resin"]),
    ("rosin", "Rosin", "concentrate",
     "A solventless concentrate pressed from flower or hash using heat and pressure.",
     ["Marijuana Extract for Inhalation"], ["solventless"]),
    ("co2-oil", "CO2 Oil", "concentrate",
     "A cannabis oil extracted using pressurized carbon dioxide, commonly used in cartridges.",
     ["CO2 Hash Oil"], ["co2", "hash oil"]),
    ("distillate", "Distillate", "concentrate",
     "A highly refined cannabis oil produced by distillation, used in cartridges and edibles.",
     ["Marijuana Extract for Inhalation"], []),
    ("kief", "Kief", "concentrate",
     "The collected resin trichomes sifted from cannabis flower.",
     ["Kief"], ["dry sift"]),
    ("hash", "Hash", "concentrate",
     "A traditional concentrate made by compressing cannabis resin.",
     ["Hash"], ["hashish"]),
    ("bubble-hash", "Bubble Hash", "concentrate",
     "A solventless hash made using ice water and agitation to separate trichomes.",
     ["Bubble Hash"], ["ice water hash", "water hash"]),
    ("vape-cartridge", "Vape Cartridges", "vape",
     "Pre-filled cartridges of cannabis oil that attach to a battery for vaporizing.",
     ["Marijuana Extract for Inhalation", "CO2 Hash Oil"], ["cart", "cartridge", "510"]),
    ("disposable-vape", "Disposable Vapes", "vape",
     "All-in-one vaporizer pens pre-filled with cannabis oil and a built-in battery.",
     ["Marijuana Extract for Inhalation"], ["disposable", "all-in-one"]),
    ("edible-gummies", "Gummies", "edible",
     "Chewy cannabis-infused candies dosed per piece.",
     ["Solid Marijuana Infused Edible"], ["gummy", "chew"]),
    ("edible-chocolate", "Chocolates", "edible",
     "Cannabis-infused chocolate bars and confections dosed per serving.",
     ["Solid Marijuana Infused Edible"], ["chocolate bar"]),
    ("edible-candy", "Candy", "edible",
     "Cannabis-infused hard candies, caramels, and other confections.",
     ["Solid Marijuana Infused Edible"], ["hard candy", "caramel"]),
    ("edible-baked", "Baked Goods", "edible",
     "Cannabis-infused cookies, brownies, and other baked treats.",
     ["Solid Marijuana Infused Edible"], ["cookie", "brownie", "snack"]),
    ("edible-drink", "Beverages", "edible",
     "Ready-to-drink cannabis-infused beverages and drink mixes.",
     ["Liquid Marijuana Infused Edible"], ["drink", "beverage", "soda", "seltzer"]),
    ("capsule", "Capsules", "edible",
     "Cannabis-infused capsules or pills dosed per unit.",
     ["Capsule"], ["pill", "softgel"]),
    ("tincture", "Tinctures", "liquid",
     "Liquid cannabis extracts dosed with a dropper, taken orally.",
     ["Tincture", "Liquid Marijuana Infused Edible"], ["drops", "sublingual"]),
    ("infused-oil", "Cooking Oils", "liquid",
     "Cannabis-infused cooking oils and butters used as ingredients.",
     ["Infused Cooking Oil", "Infused Dairy Butter or Fat in Solid Form"],
     ["cooking oil", "infused butter", "ghee"]),
    ("topical", "Topicals", "topical",
     "Cannabis-infused lotions, balms, and salves applied to the skin.",
     ["Marijuana Infused Topicals"], ["lotion", "balm", "salve", "cream"]),
    ("topical-bath", "Bath & Body", "topical",
     "Cannabis-infused bath soaks and body products.",
     ["Marijuana Infused Topicals"], ["bath bomb", "bath soak"]),
    ("suppository", "Suppositories", "topical",
     "Cannabis-infused suppositories.",
     ["Suppository"], []),
]


def sql_str(s):
    return "'" + s.replace("'", "''") + "'"


def sql_arr(items):
    if not items:
        return "'{}'"
    inner = ",".join('"' + i.replace("'", "''").replace('"', '\\"') + '"' for i in items)
    return "'{" + inner + "}'"


def main():
    rows = []
    for i, (slug, name, group, summary, wa, aliases) in enumerate(CATEGORIES):
        rows.append({"slug": slug, "name": name, "group_key": group, "summary": summary,
                     "wa_inventory_types": wa, "aliases": aliases, "sort_order": i})

    slugs = [r["slug"] for r in rows]
    assert len(slugs) == len(set(slugs)), "duplicate category slug"

    # ---- SQL ----
    sql_path = os.path.join(HERE, "product_categories_seed.sql")
    with open(sql_path, "w") as f:
        f.write("-- Generated by build_product_categories.py — verified product-category taxonomy.\n")
        f.write("-- Idempotent: upsert on slug. Run AFTER migration 0070.\n")
        f.write("-- Customer-facing / market-factual only; no medical or effect claims.\n\n")
        f.write("insert into public.kb_product_categories\n")
        f.write("  (slug, name, group_key, summary, aliases, wa_inventory_types, sort_order, active)\nvalues\n")
        vals = []
        for r in rows:
            vals.append("  (" + ", ".join([
                sql_str(r["slug"]), sql_str(r["name"]), sql_str(r["group_key"]),
                sql_str(r["summary"]), sql_arr(r["aliases"]),
                sql_arr(r["wa_inventory_types"]), str(r["sort_order"]), "true",
            ]) + ")")
        f.write(",\n".join(vals))
        f.write("\non conflict (slug) do update set\n")
        f.write("  name = excluded.name,\n  group_key = excluded.group_key,\n")
        f.write("  summary = excluded.summary,\n  aliases = excluded.aliases,\n")
        f.write("  wa_inventory_types = excluded.wa_inventory_types,\n")
        f.write("  sort_order = excluded.sort_order,\n  active = true;\n")

    # ---- TS ----
    ts_path = os.path.join(REPO, "src", "lib", "ai", "kb", "product-categories-data.ts")
    with open(ts_path, "w") as f:
        f.write("/**\n")
        f.write(" * src/lib/ai/kb/product-categories-data.ts\n *\n")
        f.write(" * GENERATED by back-office/kb_seed/build_product_categories.py — do not edit by hand.\n")
        f.write(" * Verified customer-facing product-category taxonomy (edibles, liquids,\n")
        f.write(" * concentrates, topicals, pre-rolls, vapes, …). Each category maps to the WA\n")
        f.write(" * CCRS inventory_type names it corresponds to. Market-factual only; no medical\n")
        f.write(" * or effect claims.\n */\n\n")
        f.write("export type SeedProductCategory = {\n")
        f.write("  slug: string;\n  name: string;\n")
        f.write('  group_key: "flower" | "concentrate" | "vape" | "edible" | "liquid" | "topical";\n')
        f.write("  summary: string;\n  aliases: string[];\n")
        f.write("  wa_inventory_types: string[];\n  sort_order: number;\n};\n\n")
        f.write("export const PRODUCT_CATEGORIES: SeedProductCategory[] = [\n")
        for r in rows:
            f.write("  {\n")
            f.write(f"    slug: {json.dumps(r['slug'])}, name: {json.dumps(r['name'])}, group_key: {json.dumps(r['group_key'])},\n")
            f.write(f"    summary: {json.dumps(r['summary'])},\n")
            f.write(f"    aliases: {json.dumps(r['aliases'])},\n")
            f.write(f"    wa_inventory_types: {json.dumps(r['wa_inventory_types'])}, sort_order: {r['sort_order']},\n")
            f.write("  },\n")
        f.write("];\n\n")
        f.write("export const PRODUCT_CATEGORY_GROUPS: { key: SeedProductCategory[\"group_key\"]; label: string }[] = [\n")
        for k, lbl in [("flower", "Flower"), ("concentrate", "Concentrates"),
                       ("vape", "Vapes"), ("edible", "Edibles"),
                       ("liquid", "Liquids & Oils"), ("topical", "Topicals")]:
            f.write(f"  {{ key: {json.dumps(k)}, label: {json.dumps(lbl)} }},\n")
        f.write("];\n")

    print(f"Wrote {len(rows)} product categories:")
    print(f"  SQL: {sql_path}")
    print(f"  TS:  {ts_path}")


if __name__ == "__main__":
    main()
