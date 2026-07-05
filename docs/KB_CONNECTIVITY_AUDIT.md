# KB Connectivity Audit + Cannabinoid Compounds Plan (ANALYSIS ONLY — no code edits yet)

> Owner request (verbatim): "Before we merge the last or, Will you add the kb
> cannabis cannabinoid compounds. Will you also walk the file tree to make sure
> the kb is fully connected to everything and all validated information is
> flowing into it. Please provide a comprehensive report for yourself to patch
> all the gaps you find, if any. No code edits yet. Please proceed, follow the
> standing rules and never guess."

This document began as a self-directed patch plan. Every claim below is grounded
in a file read (path + line cited). Nothing is guessed. PR #254 (Slice B KB
enrichment) has since been merged (main `1ea485b`).

---

## STATUS — implemented on branch `feat/kb-cannabinoids-and-potency`

The plan below has been BUILT (code held for owner review; migrations 0083 +
0084 are MANUAL/idempotent, applied by the owner):

- [x] **GAP 1** — `kb_cannabinoids` reference table (migration 0083, mirrors
      kb_terpenes 0019: RLS `is_staff()`, `set_updated_at()` trigger, indexes).
      Pre-seeded with exactly the 8 verified-vocabulary compounds (thc, thca,
      cbd, cbda, cbg, cbn, cbdv, cbc) — full research-backed factual descriptions
      + cited sources (`SEED_CANNABINOIDS` in `src/lib/ai/kb/seed.ts`,
      `docs/CANNABINOID_SEED_SOURCES.md`). THCV NOT seeded (absent from code
      vocabulary — never guess).
- [x] **GAP 2** — `kb_products.cannabinoids[]` + `kb_strains.cannabinoids[]`
      link columns (migration 0083, `not null default '{}'`).
- [x] **GAP 3** — retrieval brain surfaces a cannabinoid map: `loadCannabinoids()`
      (falls back to seed pre-migration) + a grounding block emitting
      `kb:cannabinoid:<slug>` tags with FACTUAL intoxicating/non-intoxicating/
      mildly-psychoactive + acidic-precursor→decarb lines (`retrieval.ts`).
- [x] **GAP 4** — admin surface parity with terpenes: read-only
      `/admin/knowledge-base/cannabinoids` factual cards (name, full name,
      intoxication badge, acidic→decarbs_to chemistry, notes, description,
      cited sources, non-medical footer) + KB-landing nav card + seed via the
      existing `seedKbAction`.
- [x] **GAP 5** — validated POTENCY inflow: migration 0084 adds
      `potency_json / total_thc_pct / total_cbd_pct / potency_source /
      potency_confidence` to `kb_products`; `writeback.ts` gap-fills them from
      the linked COA (VERIFIED chain
      `inventory_lots.pos_product_key → lab_result_id → lab_results`) on
      publish — drafts-only, never clobbers a populated value,
      `potency_source='lab_results:<id>'`; retrieval emits a measured-potency
      FACT line + `kb:potency:lab_results`; the review page shows a
      "Potency (COA)" chip.
- [x] **GAP 6** — `kb_strains` drafts lifecycle + provenance parity
      (migration 0085, mirrors 0082 for `kb_brands`): adds `status`
      (default `'published'`, check `draft|published|archived`) + a `source`
      provenance scalar (`sources[]`/`confidence` already existed from 0020),
      backfills curated rows to `source='manual'`, and indexes `status`.
      `writeback.ts` now stamps provenance on every machine touch of a strain
      (source only when empty → never overwrites curated; `sources[]` unioned;
      status never touched — it only enriches existing published rows).
      `retrieval.loadStrains()` filters out `archived` strains (defensive
      fallback pre-migration). The strains manage table shows a Draft/Archived
      pill + provenance source; `health.strainDrafts` counts any strain drafts.
      NOTE: no standalone promote-queue was built because the write-back path
      only ever *enriches an existing published* strain — it never creates a
      strain draft today — so a review queue would be speculative; parity +
      auditability + the Draft signal fully satisfy the gap.
- [x] **GAP 7** — coverage matrix rows for measured potency + cannabinoid
      vocabulary now flow into the KB (were the two remaining **NO** rows).

Health: `getKbHealth().cannabinoidCoverage = { present, expected: 8 }`
(`health.ts`). Verify on this branch: `tsc` 0, `eslint` 0, `next build` OK.

---

## 0. How the KB is wired today (verified)

**KB tables (migrations):**

| Table | Migration | Purpose | Provenance / lifecycle |
| --- | --- | --- | --- |
| `kb_strains` | 0019 (+0020, +0073, +0074, +0075) | strain families: type, lineage, aroma/flavor, terpenes[], summary, `dominant_cannabinoid`, `potency_note`, bud_structure, origin, indica/sativa/ruderalis %, leaning, `sources[]`, `confidence` | has `sources[]`+`confidence` (0020); NO `status` |
| `kb_terpenes` | 0019 | terpene → aroma/flavor map, `also_found_in` | none (curated only) |
| `kb_category_terms` | 0019 | per-category vocabulary | none |
| `kb_brands` | 0019 (+0082 in PR #254) | brand facts; PR #254 adds `source`/`confidence`/`sources[]`/`status` | drafts-only AFTER 0082 |
| `kb_banned_phrases` | 0019 | owner blocklist | none |
| `kb_product_categories` | 0070 | deep product-type taxonomy | own scheme |
| `kb_products` | 0071 | per-SKU golden record: brand_slug/product_slug/variant, category, aroma/flavor/terpenes/effects, description, `source`/`confidence`/`sources[]`, `status` draft\|published\|archived, `active`, FKs to kb_strain/kb_brand/vendor/brand | full drafts-only lifecycle |
| `kb_notes` | 0056 | free-form owner reference notes | own scheme |
| `kb_image_substitutes` | (image module) | fallback image rules | own scheme |

**KB readers / the "brain":** `src/lib/ai/kb/retrieval.ts` → `buildGroundedFacts()`
(line ~339) reads strains, terpenes, categories, brand facts, notes, the exact
`kb_products` record, and `kb_product_categories`, and assembles the grounded
line block the AI must stay within. Terpene aroma/flavor is injected only for
terpenes named on the matched strain (retrieval.ts ~412–423).

**KB writers (every inflow — verified via grep `.from("kb_*").{upsert,insert,update}`):**

| Writer | File | Target | Guarantees |
| --- | --- | --- | --- |
| Seed | `store.ts` seedKnowledgeBase (~194–200) | kb_strains/terpenes/category_terms/banned | idempotent upsert on natural key |
| Strain editor | `store.ts` upsertKbStrain (~556) | kb_strains | manual, owner-curated |
| Brand facts | `store.ts` upsertKbBrand (~764), reviewKbBrand (~672) | kb_brands | manual/curated |
| Notes | `store.ts` (~839/854) | kb_notes | manual |
| Product review | `store.ts` reviewKbProduct (~990) | kb_products | publish/archive gate |
| Image substitutes | `image-substitutes.ts` (~309/327) | kb_image_substitutes | manual |
| **Enrichment (writeback)** | `writeback.ts` writeBackProductFacts (~156) | kb_strains (gap-fill), kb_products (drafts) | drafts-only, gap-fill, compliance-gated, idempotent |
| **CCRS enrichment (PR #254)** | `kb/enrich-from-discovery.ts` | kb_brands + kb_products drafts | drafts-only, gap-fill, compliance-gated, paged, idempotent |

**Who triggers enrichment writeback into the KB (verified):**
- `writeBackOnPublish(key, userId)` is called from
  `src/app/admin/products/actions.ts` (~138, ~228) and
  `src/app/admin/products/bulk-ai/actions.ts` (~92) — i.e. when a product
  enrichment is **published** in the back office, its validated facts flow into
  `kb_products` (draft) + `kb_strains` (gap-fill).
- `enrichKbFromCcrsDataset(...)` is called from
  `src/app/admin/discovery/actions.ts` (~405 auto after upload, ~505 manual
  button) — PR #254.

---

## 1. Does a "cannabinoid compounds" concept exist? — NO (verified)

- `grep -rn "kb_cannabinoid" supabase/ src/` → **zero hits.** There is no
  `kb_cannabinoids` table and no KB cannabinoid reference module.
- What DOES exist (so we don't duplicate):
  - `kb_strains.dominant_cannabinoid` (0020) — a single label per strain
    ('thc' | 'cbd' | 'balanced' | 'cbg' | 'cbn' | 'cbc'), injected by retrieval
    (retrieval.ts ~376–388).
  - `kb_strains.potency_note` (0020) — factual market descriptor, injected too.
  - Operational potency lives on `lab_results` (0024): `thca_pct`, `cbda_pct`,
    `total_cannabinoids_pct`, `potency_json`, plus COA url/dates. This is
    per-lot measured data, NOT KB reference data.
  - Canonical compound vocabulary already used across the app:
    `src/lib/naming/convention-core.ts` `CannabinoidType` =
    **thc | thca | cbd | cbda | cbg | cbn | cbdv | cbc** (line 36–44), and
    `src/lib/leafly/types.ts` `GreenwayCannabinoid.type` = thc | thca | cbd |
    cbda | cbg | cbn | cbdv (line 37). Menu card display logic:
    `src/lib/menu/card-cannabinoids.ts`.

**Conclusion:** the system reasons about cannabinoids operationally (naming,
menu cards, COA potency) but the **KB has no cannabinoid reference table** that
parallels `kb_terpenes`. That is the gap the owner is asking to close.

**Never-guess note:** THCV appears NOWHERE in the codebase; it will NOT be
seeded. The seed set is exactly the 8 compounds already recognized by the app.

---

## 2. Gaps found (grounded) + patch plan

### GAP 1 — No `kb_cannabinoids` reference table  (PRIMARY REQUEST)
**Evidence:** section 1 above.
**Patch (new migration, next number after 0082 → `0083_kb_cannabinoids.sql`, idempotent):**
- `create table if not exists public.kb_cannabinoids` mirroring `kb_terpenes`:
  `id uuid pk`, `slug text unique` ('thc'), `name text` ('THC'),
  `full_name text` ('Tetrahydrocannabinol' — factual chemical name),
  `abbrev text` ('THC'), `is_acidic boolean` (true for THCA/CBDA — factual),
  `decarbs_to text` (slug of the neutral form; THCA→thc, CBDA→cbd — factual
  chemistry, non-medical), `character_notes text[]` (SENSORY/legal descriptors
  only — e.g. "non-intoxicating" is a FACT allowed by WA for CBD; but we will
  keep this to neutral, non-medical descriptors and route every value through
  the existing compliance gate before it can be published),
  `also_found_in text`, `sources text[] default '{}'`, `confidence numeric`,
  `active boolean default true`, created_by/updated_by/created_at/updated_at.
- Index on slug + active (mirrors kb_terpenes).
- `set_updated_at` trigger (mirror 0019 block).
- RLS: enable + `kb_cannabinoids_staff_all` staff-only policy (mirror 0019).
- **Manual apply by owner; idempotent.** Standing rule respected.

**Compliance guardrail (critical, never-guess):** WA I-502 forbids medical/
therapeutic claims. Cannabinoid rows must carry ONLY factual/chemical facts
(name, acidic form, decarb target, "also found in") and legal sensory/character
descriptors. NO effects, NO "helps with", NO medical language. The seed values
will be run past `checkCompliance` before publish, and the seed itself contains
no medical claims. `character_notes` is optional and may ship empty to be safe.

### GAP 2 — `kb_products` / `kb_strains` don't link to cannabinoids
**Evidence:** `kb_products` (0071) has terpenes[] but no cannabinoids[]; retrieval
injects terpene notes but never a cannabinoid map.
**Patch:**
- Migration 0083 also: `alter table public.kb_products add column if not exists
  cannabinoids text[] not null default '{}';` (parallel to `terpenes text[]`).
- Optionally `alter table public.kb_strains add column if not exists
  cannabinoids text[] not null default '{}';` (strains already have
  dominant_cannabinoid; the array lets a strain list minor compounds when a
  VERIFIED source provides them — gap-fill only, never guessed).
- Seed the join lightly and only from verified sources; default empty.

### GAP 3 — Retrieval brain never surfaces a cannabinoid map
**Evidence:** `retrieval.ts buildGroundedFacts` has a terpene block (~412) but no
cannabinoid block; `dominant_cannabinoid` is surfaced as a one-liner only.
**Patch (code, after migration approved):**
- Add `loadCannabinoids()` (mirror `loadTerpenes()` ~100) reading `kb_cannabinoids`
  with a code fallback to a new `SEED_CANNABINOIDS` (mirror SEED_TERPENES).
- In `buildGroundedFacts`, add a cannabinoid block that fires for cannabinoids
  named on the matched product (`kb_products.cannabinoids`) or strain
  (`kb_strains.dominant_cannabinoid` + optional `kb_strains.cannabinoids`),
  emitting factual, non-medical lines (e.g. "CBG is a non-acidic minor
  cannabinoid; also found in early-harvest hemp." — factual only). Push a
  `kb:cannabinoid:<slug>` source tag for auditability (matches the terpene tag
  pattern ~420).

### GAP 4 — No admin surface for cannabinoids (parity with terpenes)
**Evidence:** `/admin/knowledge-base/terpenes/page.tsx` exists (reads
`listKbTerpenesFull`); no cannabinoids page; KB landing (`page.tsx` ~166) has a
Terpenes nav card but no Cannabinoids card; `getKbCounts` (store.ts ~46) counts
terpenes but not cannabinoids; `KbCounts` type + health strip omit cannabinoids.
**Patch (code, after migration approved):**
- `store.ts`: add `listKbCannabinoidsFull()`, `upsertKbCannabinoid()`,
  `setCannabinoidActive()`, and extend `getKbCounts()` + `KbCounts` type to
  include `cannabinoids`.
- New page `/admin/knowledge-base/cannabinoids/page.tsx` (mirror terpenes page)
  with an editor + "Seed cannabinoids" action (idempotent, drafts-safe).
- Add a Cannabinoids `KbNavCard` on the KB landing page.
- Add `seedKbCannabinoids` into the existing "Seed knowledge base" action so a
  fresh install gets the baseline (idempotent upsert on slug), and extend
  `seed.ts` with `SEED_CANNABINOIDS` (the 8 verified compounds; factual only).
- Extend `health.ts` to include cannabinoid coverage in the KB health snapshot.

### GAP 5 — Validated POTENCY (lab_results) does not flow into the KB
**Evidence:** `lab_results` (0024) holds measured THC/THCA/CBD/CBDA/total +
`potency_json` + COA url, but `kb_products` has **no potency columns** (verified
by grep of 0071 — confirmed again during PR #254 Slice B; the enrichment engine
emits an explicit "potency NOT attached" warning rather than guess a home).
So the single most valuable validated fact — actual measured potency — never
reaches the KB golden record.
**Patch (schema + code, sequenced AFTER the cannabinoid table so the compound
vocabulary exists to key it):**
- Migration `0084_kb_products_potency.sql` (idempotent): add to `kb_products`
  a normalized potency map + headline columns, e.g.
  `potency_json jsonb`, `total_thc_pct numeric`, `total_cbd_pct numeric`,
  `potency_source text`, `potency_confidence numeric` — mirroring the
  provenance discipline already on the table. (Exact columns to be finalized by
  reading how `lab_results.potency_json` is shaped before writing — never
  guess; this audit flags the need, the build step will verify the shape.)
- Extend `writeBackProductFacts` / `writeBackOnPublish` to gap-fill potency from
  the product's linked `lab_results` on publish (drafts-only, never clobber a
  human-entered value), with `potency_source='lab_results:<id>'`.
- Surface potency in the retrieval brain as a FACT line (measured %/mg, not a
  claim) and in the KB product review card.
- This also retroactively satisfies the PR #254 potency follow-up.

### GAP 6 — `kb_strains` enrichment has no drafts lifecycle
**Evidence:** `kb_strains` has `sources[]`+`confidence` (0020) but no `status`
column; `writeBackProductFacts` gap-fills strains directly (writeback.ts ~217)
with no draft gate. Curated strains are protected by gap-fill (never clobber),
so this is LOW risk, but it is an inconsistency vs kb_products/kb_brands.
**Patch (optional, low priority):** add `status` to `kb_strains` for full
parity, OR document that strain gap-fill is intentionally non-destructive and
needs no draft gate. Recommend: document, defer the column unless the owner
wants strain-level draft review.

**RESOLVED (Slice 6, migration 0085):** the owner asked to complete it, so we
brought `kb_strains` to full parity with `kb_brands` (mirroring 0082) rather
than only documenting. See the STATUS section above for the exact build. The
strain gap-fill remains non-destructive; the new lifecycle simply makes every
machine touch auditable and lets retrieval exclude archived strains.

### GAP 7 — Coverage of "all validated information flowing in" — summary matrix
Verified inflow status of each validated data source:

| Validated source | Flows into KB today? | Where / gap |
| --- | --- | --- |
| Published product enrichment (aroma/flavor/terpenes/effects/description) | YES | writeBackOnPublish → kb_products draft + kb_strains gap-fill |
| CCRS state data (brands, products, categories) | YES (PR #254) | enrich-from-discovery → kb_brands + kb_products drafts |
| Operational brand facts | PARTIAL | brand facts live on operational `brands` post-0072; kb_brands linked but enriched separately (documented in Slice A/B) |
| Measured potency (lab_results / COA) | **NO** | GAP 5 — no kb_products potency columns |
| Cannabinoid reference vocabulary | **NO** | GAP 1 — no kb_cannabinoids table |
| Strain ratios / leaning | YES | kb_strains (0073/0074) |
| Terpenes | YES | kb_terpenes + retrieval block |
| Non-cannabis products | separate | noncannabis_products (0076), by design |
| Menu / POS live items | INDIRECT | drives enrichment which then writes back on publish |

---

## 3. Proposed build order (when approved — NO code yet)

1. **Merge PR #254** (Slice B) first, or hold — owner decides. This audit does
   not modify it.
2. **Migration 0083** `kb_cannabinoids` + `kb_products.cannabinoids[]`
   (+ optional `kb_strains.cannabinoids[]`). Idempotent. Owner applies manually.
3. **Code (Slice C1 — cannabinoid KB):** `SEED_CANNABINOIDS`, store CRUD +
   counts, retrieval `loadCannabinoids()` + grounding block, admin page + nav
   card + seed action, health strip. All drafts/seed-safe, compliance-gated.
4. **Migration 0084** `kb_products` potency columns (shape verified against
   `lab_results.potency_json` first). Idempotent.
5. **Code (Slice C2 — potency inflow):** writeback gap-fills potency from
   lab_results on publish; retrieval + review card surface it. Closes GAP 5 and
   the PR #254 potency follow-up.
6. GAP 6 documented (defer unless owner wants strain draft review).

Each code slice: own branch → tsc → eslint → next build → PR **HELD for owner
review** (KB is the backbone). Each migration: idempotent, applied manually by
the owner.

---

## 4. Standing-rules compliance of this plan
- **Never guess:** seed compounds = only the 8 already in the codebase; potency
  column shape will be verified before writing; no medical/effect content.
- **Drafts-only / gap-fill:** every new inflow follows the writeback pattern —
  never clobbers curated data.
- **Idempotent manual migrations:** 0083/0084 use `if not exists` throughout.
- **Money in minor units:** N/A here (no money touched).
- **Compliance:** cannabinoid + potency copy is factual only, routed through the
  existing `checkCompliance` gate; WA I-502 medical-claim ban respected.
- **No code edits in this step:** this file is the only artifact.

---

## 5. Open questions for the owner (before building)
1. **Cannabinoid `character_notes`:** ship empty (safest) or pre-seed with
   strictly factual, non-medical descriptors (e.g. THC "intoxicating cannabinoid",
   CBD "non-intoxicating")? These are widely-accepted FACTS, not medical claims,
   but I will only seed them on your say-so.
2. **`kb_strains.cannabinoids[]`:** add it now for future minor-cannabinoid
   listing, or keep strain-level to `dominant_cannabinoid` only for now?
3. **Potency in KB (GAP 5):** proceed with 0084 + writeback potency inflow in
   the same effort, or ship the cannabinoid table first and do potency as a
   follow-up?
4. **PR #254:** merge before starting Slice C, or stack Slice C on top?
