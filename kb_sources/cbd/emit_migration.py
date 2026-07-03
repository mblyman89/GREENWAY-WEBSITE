#!/usr/bin/env python3
"""Emit migration 0075 from cbd_strains.json — idempotent CBD strain seed.

Design (non-destructive, drafts-only, owner MANUAL apply):
- INSERT new CBD strains by slug.
- ON CONFLICT (slug): only fill fields that are currently NULL/empty (coalesce /
  array-append with dedupe) so we NEVER clobber the owner's own edits.
- dominant_cannabinoid / potency_note carry the verified lab facts.
- flavor_notes appended (deduped) from the factual API flavor tags.
- Also sets dominant_cannabinoid + ratio_source-style provenance via sources[].
"""
import json

rows = json.load(open("cbd_strains.json"))


def sql_str(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def sql_arr(items) -> str:
    if not items:
        return "'{}'::text[]"
    inner = ",".join('"' + str(i).replace('"', '\\"').replace("'", "''") + '"' for i in items)
    return "'{" + inner + "}'::text[]"


lines = []
lines.append("-- 0075_seed_kb_cbd_strains.sql")
lines.append("-- Seed of CBD-relevant strains grounded in VERIFIED WA state lab data")
lines.append("-- (DoltHub dolthub/cannabis-testing-wa), cross-referenced with the Cannabis")
lines.append("-- API for factual flavor tags. FACTS ONLY — no verbatim descriptions.")
lines.append("--")
lines.append("-- CBD relevance = modal strain chemotype 2 (balanced Type II) or 3")
lines.append("-- (CBD-dominant Type III), >= 5 lab tests (drops one-off outliers).")
lines.append("-- Idempotent: INSERT new by slug; ON CONFLICT only fills NULL/empty fields")
lines.append("-- (coalesce + deduped array append) so owner edits are never overwritten.")
lines.append("-- Drafts-only for data-steward review. Apply MANUALLY.")
lines.append("--")
lines.append(f"-- {len(rows)} strains "
             f"({sum(1 for r in rows if r['chemo']==3)} CBD-dominant, "
             f"{sum(1 for r in rows if r['chemo']==2)} balanced).")
lines.append("")
lines.append("begin;")
lines.append("")

for r in rows:
    slug = sql_str(r["slug"])
    name = sql_str(r["name"])
    stype = sql_str(r["strain_type"])
    dom = sql_str(r["dominant_cannabinoid"])
    potency = sql_str(r["potency_note"])
    flavors = sql_arr(r["flavor_notes"])
    src = sql_arr([r["source"]])
    summary = sql_str(
        f"CBD-relevant strain — WA lab data shows ~{r['avg_cbd']:g}% CBD and "
        f"~{r['avg_thc']:g}% THC across {r['tests']} tests."
    )

    lines.append(
        "insert into public.kb_strains "
        "(slug, name, strain_type, dominant_cannabinoid, potency_note, "
        "flavor_notes, summary, sources, confidence, active)\n"
        f"values ({slug}, {name}, {stype}, {dom}, {potency}, "
        f"{flavors}, {summary}, {src}, {r['confidence']}, true)\n"
        "on conflict (slug) do update set\n"
        "  strain_type = coalesce(public.kb_strains.strain_type, excluded.strain_type),\n"
        "  dominant_cannabinoid = coalesce(public.kb_strains.dominant_cannabinoid, excluded.dominant_cannabinoid),\n"
        "  potency_note = coalesce(public.kb_strains.potency_note, excluded.potency_note),\n"
        "  flavor_notes = array(\n"
        "    select distinct e from unnest(public.kb_strains.flavor_notes || excluded.flavor_notes) as e\n"
        "  ),\n"
        "  summary = coalesce(public.kb_strains.summary, excluded.summary),\n"
        "  sources = array(\n"
        "    select distinct e from unnest(public.kb_strains.sources || excluded.sources) as e\n"
        "  ),\n"
        "  confidence = coalesce(public.kb_strains.confidence, excluded.confidence),\n"
        "  updated_at = now();"
    )
    lines.append("")

lines.append("commit;")

sql = "\n".join(lines) + "\n"
with open("/workspace/repo/supabase/migrations/0075_seed_kb_cbd_strains.sql", "w") as fh:
    fh.write(sql)

print(f"Wrote 0075_seed_kb_cbd_strains.sql ({len(rows)} strains, {len(sql.splitlines())} lines)")
