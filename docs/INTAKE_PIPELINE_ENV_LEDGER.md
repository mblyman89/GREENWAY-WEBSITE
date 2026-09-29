# Intake Pipeline — Vercel Environment Ledger

> **Owner request (Round 5, verbatim):** "Will you add to the roadmap strategy to provide for me all of the vercel env variables to add to vercel at the very end of this whole pipeline build."

This is the one list of every environment variable the receiving-intake pipeline build (roadmap slices S00–S33) reads. **Each slice that adds or reads a variable adds a row here in the same PR.** `tests/compliance/intake-env-ledger.test.ts` fails the build if a pipeline flag in the code is missing from this ledger or from `.env.example`, or if a "shipped" row names a variable the code no longer reads.

**The final roadmap step (after S25)** is the **Vercel handoff**: the last PR of the build refreshes this file, and the owner gets the "Final Vercel checklist" at the bottom as a copy-paste list. Nothing in this pipeline needs a variable to be *set* to work. Every flag has a safe default when unset. So this list is about choosing values on purpose, not about fixing breakage.

How to set one in Vercel: Project → Settings → Environment Variables → add the name and value for **Production** (and Preview, if you test there) → **Redeploy**. Vercel only applies variables to new deployments.

---

## 1. Shipped pipeline flags (read by code on `main` today)

Every flag here is safe unset. Anything **not** listed as an off-word keeps the feature ON (or, for the ring, in shadow), so a typo can never silently switch a feature off.

| Variable | Slice | Unset means | Values | What it does | Rollback |
|---|---|---|---|---|---|
| `INTAKE_IDENTITY_STAMP` | S05 | on | `on` · off-words `off` `0` `false` `no` `disabled` | Stamps `identity_key` / `kb_product_id` on new lots and drafts at the receiving door. Needs migration 0234. | Set `off` |
| `LOOKUP_SCHEMA_V2` | S06 | on | `on` · same off-words | The AI lookup asks for every fact in its own field with its own confidence and sources. | Set `off` (v1 prompt, byte-identical) |
| `ATTACH_POLICY_RING` | S10 | `1` (shadow) | `0`/`off` · `1` · `2` · `3` (junk → `1`) | The per-field 90% auto-attach policy. `1` computes and previews, writes nothing, and fills the Product Onboarding footer counters. `2`/`3` write, but only once S07 (the single write door) ships. Until then they behave like `1`. | Set `0` |
| `INTAKE_BATCH_STAGING` | S17 | on | `on` · same off-words | One menu update per approve batch: the "Approve all N priced" button on a focused delivery, and a single Approve within 20 s of the last one replaces that still-unpublished update instead of adding another (only when the new one provably contains every product of the old). | Set `off` (no button; every Approve adds its own update, as before S17) |
| `INTAKE_CUTOVER_GUARD` | S18 | on | `on` · same off-words | Publish Cultivera first, then receive. While a real (not Test-mode) Cultivera upload is staged, a new receiving update is saved but held; a hand publish of anything else is refused; publishing the Cultivera upload rebuilds the held deliveries on top of it (up to 10 per click; the rest are listed on `/admin/menu-imports/cutover`); after cutover a second real upload is refused (S21: the Menu Imports page says "refused" only when this guard would refuse). A failed read never holds or refuses. Runbook: `docs/CULTIVERA_CUTOVER_RUNBOOK.md`. | Set `off` (no hold, no refusals, exactly as before S18) |
| `INTAKE_VENDOR_ID_IDENTITY` | S19 | on | `on` · same off-words | Restock merge also recognises the same product by the vendor RECORD (`inventory_lots.vendor_id`), so a different spelling of the vendor name joins the live card instead of adding a second one. It only fills gaps: when the name rule already finds a card, that answer stands. Product Onboarding (one delivery picked, review tab) shows what Approve will do on each row: `Restock → joins live card '…' (from Cultivera import)`, `New card`, `Ambiguous: … adds a new card` (links to each matching live card to compare; Product Mastering is not read by the merge, bible F-096), `Already on the live menu`. Any incomplete read uses the name rule and says so on screen. | Set `off` (name rule only, no preview, exactly as before S19) |

Source of truth for the names: `IDENTITY_STAMP_ENV` (`src/lib/inventory/identity-stamp-core.ts`), `LOOKUP_SCHEMA_V2_ENV` (`src/lib/inventory/lookup-facts-core.ts`), `ATTACH_POLICY_RING_ENV` (`src/lib/catalog/fact-attach-policy-core.ts`), `BATCH_STAGING_ENV` (`src/lib/inventory/batch-staging-core.ts`), `CUTOVER_GUARD_ENV` (`src/lib/inventory/cutover-guard-core.ts`), `VENDOR_ID_IDENTITY_ENV` (`src/lib/inventory/vendor-identity-core.ts`).

## 2. AI provider variables the pipeline's lookup uses

These are read by `src/lib/ai/provider.ts` and `src/lib/ai/router.ts`. They predate the pipeline build, but the onboarding lookup (S06/S10) depends on them. The `AI_*` name wins. The `OPENAI_*` name is the fallback.

| Variable | Fallback / default | What it does |
|---|---|---|
| `AI_API_KEY` | `OPENAI_API_KEY`, else unset (lookup soft-disables) | The model key. **Required for the lookup.** |
| `AI_BASE_URL` | `OPENAI_BASE_URL`, else `https://api.openai.com/v1` | Chat endpoint. |
| `AI_MODEL` | `OPENAI_MODEL`, else `gpt-4o-mini` | Light model. |
| `AI_VISION_MODEL` | `OPENAI_VISION_MODEL`, else `AI_MODEL` | Vision model. |
| `AI_MODEL_HEAVY` | `OPENAI_MODEL_HEAVY`, else `gpt-4o` | The web-search lookup model. An id starting with `gemini` switches to Google `google_search` grounding. |
| `AI_GEMINI_API_KEY` | `AI_API_KEY` | Google key for the Gemini path. |
| `AI_GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/interactions` | Gemini Interactions endpoint. |
| `AI_GEMINI_OPENAI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai` | Gemini built-in-knowledge fallback. |
| `AI_THINKING_LEVEL` | `low` | Gemini thinking level. |
| `AI_WEBSEARCH_TIMEOUT_MS` | `290000` | One lookup's HTTP ceiling. Keep it below the drafts page `maxDuration` (300 s). |
| `AI_MODE` | `maintenance` | `sprint` sends heavy tasks to `AI_MODEL_HEAVY`. |
| `AI_MONTHLY_TOKEN_BUDGET` | `0` (no cap) | Monthly token cap. |
| `AI_MONTHLY_USD_BUDGET` | `0` (no cap) | Monthly $ cap. |
| `AI_PRICE_PER_1K_PROMPT` | `0` | Feeds the $ estimate on AI Usage. |
| `AI_PRICE_PER_1K_COMPLETION` | `0` | Feeds the $ estimate on AI Usage. |

## 3. Platform variables the pipeline cannot run without

These are already set on a working deployment. They are listed so the final checklist is complete.

| Variable | What it does |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public (RLS) key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server key. Every intake read/write uses it. |

## 4. Planned flags (named by the roadmap; NOT in code yet)

When the slice ships, its row moves to §1 with the real constant. Names are the bible's, word for word. Where the bible only says "Flag", the name is chosen in that slice's PR, never here (never guess).

| Slice | Bible rollback line | Planned name |
|---|---|---|
| S07 | "Flag ATTACH_FACTS_V2=off restores old actions" | `ATTACH_FACTS_V2` |
| S09 | "Flag KB_FIRST_ONBOARDING=off" | `KB_FIRST_ONBOARDING` |
| S11 | "Flag ONBOARDING_V2_ROW=off renders today's row" | `ONBOARDING_V2_ROW` |
| S12 | "Flag; boilerplate path retained" | named in S12 |
| S13 | "Feature flag; per-row lookup remains" | named in S13 |
| S20 | "Flag" | named in S20 |

**Which shipped slice added which variable** (checked against `git show` of each merged commit):

- Slices that **added** a variable: S05 (`INTAKE_IDENTITY_STAMP`), S06 (`LOOKUP_SCHEMA_V2`), S10 (`ATTACH_POLICY_RING`), S17 (`INTAKE_BATCH_STAGING`), S18 (`INTAKE_CUTOVER_GUARD`), S19 (`INTAKE_VENDOR_ID_IDENTITY`).
- Slices that added **no** variable: S00, S01, S02, S03, S04, S08, S14, S15, S16, S21, S22, S24, S26. Their bible rollback lines are "Revert…" (S00, S01, S02, S14) or "Revert." (S16, S21, S22, S24), "Delete the new core + test; revert the optional ctx param." (S26), "Delete module" (S03), leave or drop the schema (S04, S08), or "Re-apply previous RPC body" (S15, shipped as `supabase/rollbacks/0236_publish_archive_rule.rollback.sql`). None of those rollbacks names a flag.

`tests/compliance/intake-env-ledger.test.ts` checks these two lists against the Slice column of §1. So a slice that quietly adds a flag, or a §1 row whose slice is filed under "no variable", fails the build.

When S07 ships, it must also flip `ATTACH_WRITER_SHIPPED` in `fact-attach-policy-core.ts`. That is what lets `ATTACH_POLICY_RING=2` actually write.

---

## Final Vercel checklist (the end-of-build handoff)

The final PR of the build rewrites this block with the complete list. As of **S26** it reads (S14, S15, S16, S21, S22, S24 and S26 added no variable; S17 added `INTAKE_BATCH_STAGING`; S18 added `INTAKE_CUTOVER_GUARD`; S19 added `INTAKE_VENDOR_ID_IDENTITY`):

**Set on purpose (recommended values):**
- `INTAKE_IDENTITY_STAMP` = `on` (same as unset. Setting it makes the choice visible in Vercel.)
- `LOOKUP_SCHEMA_V2` = `on` (same as unset)
- `INTAKE_BATCH_STAGING` = `on` (same as unset)
- `INTAKE_CUTOVER_GUARD` = `on` (same as unset). Keep it on through the Cultivera cutover and after; it costs one small read per approval and nothing when no Cultivera upload is waiting. Opening Menu Imports also runs its two-read cutover check (S21), only to pick the upload-note wording.
- (S22 needs nothing set. Opening Product Enrichment now also makes two bounded, named-column reads, the cards' lots and their deliveries, to power the "From invoice/manifest:" filter and the "newest from receiving" sort. If either read fails, those filters switch off and the page says so.)
- (S24 needs nothing set. The menu, the product page and the enrichment command center now also look up kb_products the way the manifest bridge wrote them, through the card's own lots: a bounded, named-column read of those lots, then their brands and KB rows. When a card has no lots, it makes exactly the reads it made before. If a read fails, the page falls back to the copy it showed before S24.)
- (S26 needs nothing set. The menu-draft page's "How to fix it" buttons now land on the exact control: a bounded, named-column read of the warned drafts (by id, and by key inside that delivery's approved drafts) plus the published-menu check for the keys a link points at. Opening a lot page also makes one published-menu check for its own key, so the enrichment button never opens a 404. If a read fails, every button falls back to the list link it showed before.)
- `INTAKE_VENDOR_ID_IDENTITY` = `on` (same as unset). It costs a few bounded reads per menu update (only the lots that could change a match) and per Onboarding view of one delivery.
- `ATTACH_POLICY_RING` = `1` for now. Change it to `2` only after S07 ships **and** you have read about a week of footer counters on Product Onboarding (bible §0.5: "run in shadow for a week").

**Must already be set (secrets, so there is no recommended value):** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `AI_API_KEY` (or `OPENAI_API_KEY`), and `AI_GEMINI_API_KEY` if `AI_MODEL_HEAVY` is a Gemini model.

**Optional tuning:** everything else in §2 keeps its default when unset.
