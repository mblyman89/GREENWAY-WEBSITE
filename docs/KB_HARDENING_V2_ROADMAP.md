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
2. **Consumption methods / product formats** — deep, Washington-State-specific research — **SHIPPED**
3. **Compliance rules in the KB** — surfaced helpfully to keep customers safe — **SHIPPED**
4. **Store/brand voice & FAQ pack** — its **own slice, LAST**, after 1/2/3/5 — **SHIPPED**
5. **Terpene → aroma cross-map enrichment** — **SHIPPED**

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

## Slice 2 — Consumption methods / product formats — SHIPPED

**Gap it fills (verified).** The KB already had broad *category* vocabulary (`kb_category_terms`)
and a deep product-type tree (`kb_product_categories`), but **neither carried the WA-market FACTS**
a budtender-grade brain needs about the physical FORM a product takes: what it is, how it's
consumed, and its typical measured potency band. This slice adds that missing layer. Effects
(Slice 1) = **how it feels**; formats (this slice) = **what it is and how you use it**.

**What shipped.** A controlled vocabulary table `kb_product_formats` (14 curated forms across 3
delivery families: `inhaled` / `ingested` / `topical`). Each record has a factual **definition**, a
factual **consumption** description, a **WA-verified potency band** (`potency_note`), a
**house_note** (fun-but-professional budtender voice), and neutral **aliases**.

**Verified WA facts (never guessed).** All potency bands, consumption facts, and the edible cap are
from Washington authorities — see `docs/KB_PRODUCT_FORMATS_SEED_SOURCES.md`:
- WSLCB "Types of Products": flower ~15–25%+ THC; kief/hash ~30–60%; shatter/wax/budder/dabs
  ~60–90%; concentrates/carts are extract-based/high-THC; infused pre-rolls run higher than flower.
- WAC 314-55-095 (via Network for Public Health Law): WA edible cap = **10 mg active THC per
  serving, 100 mg per package** (phrased in words in the seed to avoid the compliance gate's
  "X mg per" dosing-pattern trigger — factual, not a dosing directive).
- RCW 69.50.360 / .4013 possession limits & 21+/no-public-use context recorded for Slice 3.

**Files.**
- `supabase/migrations/0087_kb_product_formats.sql` — table + drafts/provenance parity (status
  default `published`; `source`; backfill `manual`), indexes (slug/active/status/category), RLS
  `is_staff()`, `updated_at` trigger. Idempotent, **applied MANUALLY**.
- `src/lib/ai/kb/seed.ts` — `SeedProductFormat` type + `SEED_PRODUCT_FORMATS` (14 formats). Fields:
  `definition`, `consumption`, `potency_note`, `house_note`, `aliases`, `sources`, `confidence`.
- `src/lib/ai/kb/store.ts` — seed upsert (r8, degrades pre-0087), `KbCounts.productFormats`,
  `KbProductFormatRow`, `listKbProductFormatsFull`, `getKbProductFormatBySlug`,
  `upsertKbProductFormat`, `setProductFormatActive`; `productFormats` added to all `inserted{}`.
- `src/lib/ai/kb/retrieval.ts` — `loadProductFormats()` (published-only; FULL → no-status → seed
  fallback), `buildFormatIndex()` (slug/name/alias → canonical), and format grounding keyed off the
  product's category / `catKey` / `kbCategory` slug+name; emits definition + consumption
  ("factual, not dosing advice") + potency band + house voice, and a `kb:format:<slug>` source tag.
- `src/lib/ai/kb/health.ts` — `productFormatCoverage {present, expected}`.
- `src/app/admin/knowledge-base/formats/page.tsx` — read-only card page (What it is / How it's used /
  Typical potency (WA) / House voice / Also matches / Sources / provenance); KB-landing nav card.
- `docs/KB_PRODUCT_FORMATS_SEED_SOURCES.md` — research notes + WA sources + compliance rationale.

**Compliance.** Records are factual/descriptive only — form, use, measured potency band. **No**
medical claims, **no** dosing directives. Every field of all 14 formats was run through
`checkCompliance` and returns **zero blocking flags and zero warnings** (the seed copy was tightened
until clean: e.g. "cured"→"well-aged", "hard candy" dropped, "10 mg per serving"→spelled in words,
"great for"/"best"/"top-shelf" rephrased). `category` is a UI grouping, not a medical category.

**Verify.** tsc 0 · eslint 0 · `next build` OK · compliance gate 0 blocking / 0 warn. Commit
`2cfd113` on `feat/kb-hardening-v2`.

---

## Slice 3 — Compliance rules in the KB — SHIPPED

**Gap it fills (verified).** The repo already **enforces** WA single-transaction purchase limits
operationally (`src/lib/compliance/sales-limits-core.ts` → `RECREATIONAL_LIMITS` / `MEDICAL_LIMITS`,
checked at checkout; owner page `/admin/compliance/sales-limits`). What it did **not** have was a
curated *education / reference* layer the AI can surface **helpfully to keep customers safe** — the
"know before you go / know before you consume" facts.

**What shipped.** A curated reference table `kb_compliance_rules` (8 rules across categories
`age` / `purchase-limit` / `possession` / `public-use` / `driving` / `edibles-safety` / `storage` /
`transport`). Each rule: a neutral factual `rule` statement, a friendly plain-language `house_note`,
a `severity` (info/important/critical, UI only), and a statute `citation`.

**Single source of truth (no drift).** The purchase- and possession-limit NUMBERS are **derived from
`RECREATIONAL_LIMITS`** (imported into `seed.ts` from the *pure* `sales-limits-core`) at seed time —
the KB reference can never disagree with what checkout enforces. This is explicitly NOT a second
enforcement mechanism.

**Verified WA facts (never guessed).** WSLCB "Using and Having Cannabis", WAC 314-55-095, RCW
69.50.360 / .4013 / .445 — see `docs/KB_COMPLIANCE_RULES_SEED_SOURCES.md`. Rec limits 1 oz / 7 g /
16 oz / 72 oz; edible cap 10 mg/serving · 100 mg/package (spelled in words to clear the gate's
dosing-pattern flag); 21+; no public use; no impaired driving; store away from underage & pets; no
crossing state lines.

**Files.**
- `supabase/migrations/0088_kb_compliance_rules.sql` — table + drafts/provenance parity, `severity`
  + `status` check constraints, indexes, RLS `is_staff()`, `updated_at` trigger. Idempotent, MANUAL.
- `src/lib/ai/kb/seed.ts` — `SeedComplianceRule` type + `SEED_COMPLIANCE_RULES` (8 rules); imports
  `RECREATIONAL_LIMITS` + `gramsToOunces` from `sales-limits-core` to derive limit numbers.
- `src/lib/ai/kb/store.ts` — seed upsert (r9, degrades pre-0088), `KbCounts.complianceRules`,
  `KbComplianceRuleRow`, `listKbComplianceRulesFull`, `getKbComplianceRuleBySlug`,
  `upsertKbComplianceRule`, `setComplianceRuleActive`; wired into all `inserted{}`.
- `src/lib/ai/kb/retrieval.ts` — `loadComplianceRules()` (published-only; FULL → no-status → seed);
  when the matched product format is `ingested`, surfaces the `edibles-safety` "start low, go slow"
  rule as a helpful customer-safety note + `kb:compliance:<slug>` source tag.
- `src/lib/ai/kb/health.ts` — `complianceRuleCoverage {present, expected}`.
- `src/app/admin/knowledge-base/rules/page.tsx` — read-only card page (The rule / What that means for
  you / Citation / severity); KB-landing nav card ("WA rules & safety", orange). Route is `rules` to
  avoid colliding with the existing `compliance` banned-phrases page.
- `docs/KB_COMPLIANCE_RULES_SEED_SOURCES.md` — research notes + WA sources + the "don't duplicate the
  enforcement system" rationale.

**Compliance.** Factual legal/safety education only — no medical claim, no product-specific dosing
directive. All 8 rules (rule + house_note) pass `checkCompliance` with **0 blocking / 0 warnings**
(copy tightened: "everybody safe"→"above board", "child-resistant"/"children"→"resealable"/"anyone
underage", "treat it like"→"store it like", milligrams spelled in words).

**Verify.** tsc 0 · eslint 0 · `next build` OK · compliance gate 0 blocking / 0 warn. Commit
`cc7f7d2` on `feat/kb-hardening-v2`.

---

## Slice 5 — Terpene → aroma cross-map enrichment — SHIPPED

**Gap it filled (verified).** `kb_terpenes` (migration 0019) already carried `aroma_notes[]`,
`flavor_notes[]`, and an `also_found_in` botanical bridge, and `SEED_TERPENES` had 22 rich
entries. But retrieval grounding only fired terpene lines for terpenes the **strain** listed
(`strain.terpenes`), emitted bare comma-joined words, and had **no reverse map** — no way to go
from an aroma word a customer says ("something citrusy") back to the terpene that drives it.

**What shipped.** Sensory-only enrichment (no effects / no "entourage effect" / no medical
content — the rule since 0019 is preserved):
1. **`aroma_families text[]`** added to `kb_terpenes` (migration 0089, one nullable column,
   default `'{}'`) — normalized aroma-family tags per terpene (limonene → `{citrus}`, pinene →
   `{pine, herbal}`, myrcene → `{earthy, herbal, sweet, hoppy}`, …). All 22 seed terpenes enriched.
2. **Widened terpene trigger** in `retrieval.ts`: terpene grounding now fires for the terpenes on
   the exact **KB product record** (`kbProduct.row.terpenes`) as well as the strain's, so it grounds
   on whatever the customer is actually holding.
3. **Enriched forward lines**: each matched terpene now also emits its aroma family + a real-world
   hook from `also_found_in` ("Terpene Limonene sits in the citrus aroma family — the same terpene
   you'd also meet in citrus rind, juniper, peppermint (scent chemistry, not an effect claim)").
4. **Reverse aroma cross-map**: the aroma/flavor words already on the strain or product are resolved
   to normalized aroma families, then the terpenes that typically carry that family are named
   ("That citrus note usually traces back to terpenes like Limonene, Terpinolene … (aroma cross-map
   — describes smell, makes no effect claim)"), capped at three per family and preferring terpenes
   not already surfaced above.

**Degrade-safe (day-one correctness).** Both the seed upsert (`store.ts`) and the retrieval loader
(`retrieval.ts`) handle a database that has **not yet applied 0089**: the seed retries the terpene
upsert without `aroma_families` (and warns), and the loader falls back to the base select. So the
whole slice compiles and runs before the owner applies the migration; the cross-map simply lights
up once 0089 is applied and the KB is reseeded.

**Files.**
- `supabase/migrations/0089_kb_terpene_aroma_crossmap.sql` — idempotent, non-destructive single
  column add + comment. No value backfill (seed upserts families on `slug`, gap-fill style).
- `src/lib/ai/kb/seed.ts` — `aroma_families?: string[]` on `SeedTerpene`; all 22 `SEED_TERPENES`
  enriched with normalized families derived from each terpene's own notes.
- `src/lib/ai/kb/store.ts` — `terpeneRows` now upserts `aroma_families`; degrade retry if column
  absent.
- `src/lib/ai/kb/retrieval.ts` — enriched `loadTerpenes()` (with base-select fallback), widened
  trigger, forward aroma-family + botanical hook, reverse aroma→terpene cross-map.
- `docs/KB_TERPENE_AROMA_CROSSMAP_SOURCES.md` — cross-map table + rationale + sources.

**Verified.** `tsc --noEmit` clean · `eslint` 0 errors/0 warnings · `next build` compiled
successfully · `.next` removed (disk discipline).

---

## Slice 4 — Store/brand voice & FAQ pack — SHIPPED

**Gap it filled (verified).** The KB taught the AI the product world but nothing about GREENWAY
itself — so "you" questions (hours, payment, delivery, price match, loyalty, returns) had no
grounded source. Slice 4 adds an owner-extendable store-facts store + a curated FAQ pack.

**Owner-confirmed / site-verified facts (nothing guessed).** Hours 8am–11pm daily (closed
Christmas). Address 4851 Geiger Rd SE, Port Orchard, WA 98367. Phone 360-443-6988. Cash only + ATM
($2.50 fee). No delivery (illegal in WA). Price-match terms mirrored from the price-match page;
returns from the site FAQ (WAC 314-55-079, 15 days, original packaging + legible lot/batch +
receipt). See `docs/KB_STORE_VOICE_FAQ_SOURCES.md` for every source.

**Live, never hard-coded.** The loyalty earn rate lives in `loyalty_config` (owner-editable). The
loyalty FAQ carries NO hard-coded rate — `retrieval.ts` composes the live rate from `getConfig()`
at grounding time, so the concierge can never quote a stale number.

**Owner-extendable.** The owner can ADD / EDIT / HIDE both store facts (mission, about-us, parking,
discounts, ADA — anything) and FAQs from the admin UI without touching code.

**What shipped.**
1. **Migration 0090** (`0090_kb_store_voice_faq.sql`, MANUAL, idempotent, non-destructive):
   `kb_store_facts` (upsert on `key`) + `kb_faqs` (upsert on `slug`), both with drafts/provenance
   parity, RLS `is_staff()`, `set_updated_at()` trigger, status checks, indexes.
2. **seed.ts** — `SeedStoreFact` + `SeedFaq` types; `SEED_STORE_FACTS` (6) + `SEED_FAQS` (17). All
   pass compliance **0 blocking** (5 non-blocking price/loyalty "heads-up" warnings are inherent to
   the price-match/loyalty topic — documented in the sources doc).
3. **store.ts** — counts + seed upserts (r10/r11, degrade pre-0090) + full CRUD for both.
4. **retrieval.ts** — new store-wide `buildStoreContext()` (distinct from per-SKU
   `buildGroundedFacts()`), stitches the live loyalty rate onto the loyalty FAQ,
   `kb:fact:<key>` / `kb:faq:<slug>` provenance. For a future concierge (Slice 79).
5. **health.ts** — `storeFactCoverage` + `faqCoverage`.
6. **admin** — `/admin/knowledge-base/about` (store facts, add/edit/hide) +
   `/admin/knowledge-base/faqs` (FAQ, add/edit/hide) + two KB landing nav cards.
7. **docs** — `docs/KB_STORE_VOICE_FAQ_SOURCES.md` (sources + the flagged "Uncle Ike's / Seattle"
   copy error in the site's static FAQ, which the seed does NOT propagate).

**Verified.** `tsc --noEmit` clean · `eslint` 0/0 · `next build` compiled (both new routes present)
· `.next` removed. Compliance gate: **0 blocking** across all facts + FAQs.

> ⚠️ **Owner follow-up (not a code issue):** the static site FAQ price-match answer
> (`src/content/faq.ts`) still says "Uncle Ike's" / "Seattle" — a copy-paste from another shop. The
> KB seed uses the correct Greenway / Port Orchard wording; recommend fixing the site copy too.

---

## MANUAL STEPS FOR THE OWNER (do NOT skip)

The agent never applies migrations. After reviewing/merging this branch:

1. **Apply, in order, in the Supabase SQL editor (idempotent, safe to re-run):**
   - `0083_kb_cannabinoids.sql`, `0084_kb_products_potency.sql`, `0085_kb_strains_provenance.sql`
     (from PR #255) — if not already applied.
   - `0086_kb_effects.sql` (Slice 1).
   - `0087_kb_product_formats.sql` (Slice 2).
   - `0088_kb_compliance_rules.sql` (Slice 3).
   - `0089_kb_terpene_aroma_crossmap.sql` (Slice 5) — adds `aroma_families` to `kb_terpenes`.
   - `0090_kb_store_voice_faq.sql` (Slice 4) — `kb_store_facts` + `kb_faqs`.
2. **Reseed the KB** from `/admin/knowledge-base/setup` (the "Seed knowledge base" action). This
   idempotently upserts the 8 cannabinoids **with the new psychoactive/non-psychoactive labels**,
   the **16 effects**, the **14 product formats**, the **8 WA compliance/safety rules**, the
   **aroma-family tags on all 22 terpenes** (Slice 5), the **6 store facts**, and the **17 FAQs**
   (Slice 4). It never overwrites curated edits (upsert on `slug`/`key`). If a migration hasn't been
   applied yet, the reseed still succeeds and simply warns that that piece was skipped — apply it
   and reseed to light it up.
3. **Confirm** the pages render: `/admin/knowledge-base/cannabinoids` (new labels),
   `/admin/knowledge-base/effects` (16 cards), `/admin/knowledge-base/formats` (14 cards),
   `/admin/knowledge-base/rules` (8 cards), `/admin/knowledge-base/about` (store facts,
   owner-editable), and `/admin/knowledge-base/faqs` (FAQ pack, owner-editable). The KB landing
   shows live counts.

> Standing rule reminder: `main` is branch-protected (branch → PR → squash-merge). Money is in
> minor units (cents). AI copy is drafts-only and compliance-gated. Never overwrite curated data.
