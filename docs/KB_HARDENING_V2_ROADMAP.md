# KB Hardening v2 — Roadmap & Hand-off

**Branch:** `feat/kb-hardening-v2` · **Status:** in progress (Slice 1 shipped).

This document is the hand-off record for the KB hardening v2 effort. It captures the owner's
directive, the slice plan, what has shipped, what remains, and the **manual steps the owner must
run** (migrations + reseed). Every design decision here is grounded in a verified file read; per
the standing rules, nothing is guessed.

## Owner directive (verbatim)

> "open a new branch so we can continue hardening the kb. i want to add all of your
> recommendations to the kb. start with the effects/ experience. please do quality research on
> this, i want it to be factual, but i also want it to be read by a cannabis user, which means it
> should sound and flow like how we would expect it to. it needs to have personality and vibe with
> our culture. then move on to number 2, i want you to go back to the internet and deep research
> washington state products specifically so you can add quality and relevant consumption methods
> and product format facts. then move on to number 3. i want to add all the compliance related
> stuff to the kb and have it use it in a useful helpful way to keep use safe. for number 4 ... lets
> make it its own slice after the other 4 slices are finished. finally do the 5th item on the list.
> the terpenes and cross map enrichment ... do not cut corners, i want it done the right way, even
> if it is harder."

Voice brief (verbatim): a professional group of experienced cannabis users catering to adults 21+;
tone of a *sophisticated pothead* — relaxed, knowledgeable, friendly, some fun creative terms,
enjoyable and a little funny, **but still professional**. Curated **quality over quantity**.

## Slice order (as directed)

1. **Effects / experience vocabulary** (culture voice, compliance-gated) — **SHIPPED**
2. **Consumption methods / product formats** — deep, Washington-State-specific research
3. **Compliance rules in the KB** — surfaced helpfully to keep customers safe
4. *(item 4 — store/brand voice & FAQ pack)* — its **own slice, LAST**, after 1/2/3/5
5. **Terpene → aroma cross-map enrichment**

> Build order: **1 → 2 → 3 → 5 → 4** (item 4 is explicitly last).

---

## Slice 1 — Effects/experience vocabulary — SHIPPED

**Gap it fills (verified).** `effects text[]` arrays already exist on `kb_products`, `kb_strains`,
`kb_product_categories` (migration 0071) and surface as a bare list with no definitions, no
per-term compliance vetting, and no house voice. The code also has an authoritative
`ALLOWED_EFFECTS` allow-list + `checkEffects` gate (`src/lib/ai/compliance.ts`).

**What shipped.** A controlled vocabulary table `kb_effects` those arrays resolve to — each effect
has a factual non-medical **definition**, a **house_note** (fun-but-professional budtender voice),
and neutral **aliases**. Every seeded slug is a verbatim member of `ALLOWED_EFFECTS`, so the
vocabulary and the compliance gate can never disagree.

**Files.**
- `supabase/migrations/0086_kb_effects.sql` — table + drafts/provenance parity (status default
  `published`; `source`; backfill `manual`), indexes, RLS `is_staff()`, `updated_at` trigger.
  Idempotent, **applied MANUALLY**.
- `src/lib/ai/kb/seed.ts` — `SeedEffect` type + `SEED_EFFECTS` (16 curated effects, 4 families:
  calming / uplifting / energizing / character).
- `src/lib/ai/kb/store.ts` — seed upsert (r7, degrades pre-0086), `KbCounts.effects`,
  `KbEffectRow`, `listKbEffectsFull`, `getKbEffectBySlug`, `upsertKbEffect`, `setEffectActive`.
- `src/lib/ai/kb/retrieval.ts` — `loadEffects()` (published-only; FULL → no-status → seed
  fallback), `buildEffectIndex()` (slug/name/alias → canonical), `groundEffects()` emits a defined,
  house-voiced grounding line + `kb:effect:<slug>` source tag; called on the product record's
  `effects[]`.
- `src/lib/ai/kb/health.ts` — `effectCoverage {present, expected}`.
- `src/app/admin/knowledge-base/effects/page.tsx` — read-only card page; KB-landing nav card.
- `docs/KB_EFFECTS_SEED_SOURCES.md` — research notes + compliance rationale + full curated list.

**Compliance.** Definitions describe subjective experience only; the compliance gate
(`checkCompliance` + `checkEffects` + `EFFECT_MEDICAL_WORDS`) strips any medical framing before it
surfaces. `category` is a UI grouping, not a medical category.

**Verify.** tsc 0 · eslint 0 · `next build` OK.

---

## Slices 2, 3, 5, 4 — NOT STARTED

- **Slice 2 (consumption methods / product formats):** deep WA I-502-specific research
  (usable/concentrate/infused categories, formats, methods). Plan a `kb_consumption_methods` /
  `kb_product_formats` vocabulary mirroring the kb_effects pattern (drafts/provenance parity,
  factual, compliance-gated, house voice). Migration = next free number.
- **Slice 3 (compliance rules in KB):** encode WA I-502 / DOH / CCRS-relevant purchase & safety
  rules as KB facts surfaced helpfully (e.g. daily purchase limits, 21+, no medical claims,
  impairment/driving warnings). Design a `kb_compliance_rules` reference + retrieval surfacing.
- **Slice 5 (terpene → aroma cross-map):** enrich the existing kb_terpenes aroma/flavor map and
  cross-map it into strain/product grounding.
- **Slice 4 (store/brand voice & FAQ pack):** LAST. Curated house voice + FAQ pack for grounding.

---

## MANUAL STEPS FOR THE OWNER (do NOT skip)

The agent never applies migrations. After reviewing/merging this branch:

1. **Apply, in order, in the Supabase SQL editor (idempotent, safe to re-run):**
   - `0083_kb_cannabinoids.sql`, `0084_kb_products_potency.sql`, `0085_kb_strains_provenance.sql`
     (from PR #255) — if not already applied.
   - `0086_kb_effects.sql` (this slice).
2. **Reseed the KB** from `/admin/knowledge-base/setup` (the "Seed knowledge base" action). This
   idempotently upserts the 8 cannabinoids **with the new psychoactive/non-psychoactive labels**
   and the **16 effects**. It never overwrites curated edits (upsert on `slug`).
3. **Confirm** the new pages render: `/admin/knowledge-base/cannabinoids` (new labels) and
   `/admin/knowledge-base/effects` (16 cards). The KB landing shows live counts.

> Standing rule reminder: `main` is branch-protected (branch → PR → squash-merge). Money is in
> minor units (cents). AI copy is drafts-only and compliance-gated. Never overwrite curated data.
