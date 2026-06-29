# AI Enhancement Roadmap — Cannabis-focused enrichment + crawl4ai foundation

> **Status:** RESEARCH + PLAN ONLY. No AI feature code or crawl4ai is built in this document's
> scope. This is the blueprint the owner asked for *before* we build the crawler, so the GPT layer
> is "well built" first and the crawler has the best chance of producing usable data.
>
> **Owner's goals (verbatim intent):**
> 1. An *amazing GPT setup* so the web crawler has the best chance of scraping relevant, usable info.
> 2. The AI must be *hyper-focused on cannabis and cannabis products*.
> 3. The AI must be *hyper-focused on product enrichment* — meaningful edits/suggestions, not money
>    wasted on output that gets rejected.
>
> **Standing rules respected here:** AI output is **drafts only** (an employee validates before
> anything publishes). Supabase is the backend. WA I-502 advertising compliance is non-negotiable.

---

## 0. TL;DR — the plan in one paragraph

We already have a solid, provider-agnostic AI core (`src/lib/ai/provider.ts`), a WA-compliance layer
(`src/lib/ai/compliance.ts`), a draft→review lifecycle with provenance (`src/lib/ai/suggestions.ts`
+ the `ai_suggestions` table), and a cost ledger (`src/lib/ai/usage.ts` + `ai_usage`). The upgrade
path is **not** "add more AI calls" — it is **make every AI call grounded, structured, validated,
cheap, and measurable**. Concretely: (1) move to **strict structured outputs** (JSON Schema /
constrained decoding) with **Pydantic/Zod validation** so the model can't return junk; (2) build a
**cannabis knowledge base** the model is *grounded in* (terpenes, strain families, category rules,
brand facts) so suggestions are factual, not invented; (3) split AI work into a **tiered router**
(cheap deterministic work first, small model next, big model only when needed) so we don't burn
money; (4) add a **golden eval set + LLM-as-judge** so we can prove a prompt change improves accept
rate before shipping; and (5) design the crawler so the **LLM is the last resort** — CSS/markdown
extraction does the bulk, the LLM only interprets, and everything it returns is verified against the
page before it ever becomes a draft. The crawler then feeds the *same* enrichment pipeline, so
crawled facts get the same grounding, compliance scan, and human review as everything else.

---

## 1. What we already have (grounding the plan in the real codebase)

Read before planning (every session — standing rule). Current AI subsystem:

| File | What it does today | Keep / Evolve |
| --- | --- | --- |
| `src/lib/ai/provider.ts` | OpenAI-compatible `generate` / `generateJSON` / `generateVision` / `generateStream`; logs every call to `ai_usage`; graceful no-op when no key; `looseJsonParse` fallback. | **KEEP & extend.** Add a strict JSON-Schema path + retry-on-invalid-JSON + a model router. |
| `src/lib/ai/compliance.ts` | `COMPLIANCE_SYSTEM` prompt (WA I-502 rules) + `checkCompliance()` regex post-filter; `PROMPT_VERSION = "v1"`. | **KEEP & expand.** Add more patterns, per-field severity, and bump prompt versioning into a registry. |
| `src/lib/ai/suggestions.ts` | Builds product-description / tags prompts from POS facts (no PII); persists drafts to `ai_suggestions` with `model` + `prompt_version` + `input_summary`; accept/reject/edited lifecycle. | **KEEP.** This is exactly the human-in-the-loop pattern best-practice demands. Extend with confidence + source provenance. |
| `src/lib/ai/usage.ts` + `ai_usage` table | Token + cost ledger per call/feature/actor; `/admin/ai-usage` dashboard. | **KEEP & extend.** Add per-feature budgets/alerts and accept-rate as a first-class metric. |
| `src/lib/enrichment/types.ts` + `store.ts` | `product_enrichment` keyed by stable POS key (`menu_items.source_item_id`); merged over POS at read time; **never** overrides price/stock; `AssetStatus` draft/published. | **KEEP.** Crawler output lands here as drafts, same as AI suggestions. |
| `src/lib/cms/ai-content.ts`, `ai-blog.ts`, `ai-seo.ts`, `src/lib/reports/ai-insights.ts`, `src/lib/ai/ai-vendor.ts` | Feature-specific AI helpers (content, blog, SEO, insights, vendor enrichment). | **KEEP.** Migrate each onto the new structured + grounded core as we touch them. |

**Key architectural truths to preserve:**

- AI is **server-only** and **drafts only**. Nothing the model writes is published without an
  employee clicking accept. This roadmap never changes that.
- POS is the source of truth for **price and inventory** — AI/crawler enrichment never touches them.
- Everything is keyed by the **stable POS product key**, so enrichment survives menu re-imports.

---

## 2. Research findings that shape the design

Sourced from current (2024–2026) best-practice material; full citations in §11.

### 2.1 Structured outputs beat "ask for JSON"
- OpenAI **Structured Outputs** (constrained decoding via `response_format` with a JSON Schema, or
  function calling with `strict: true`) scores **~100% schema adherence** vs. plain JSON-mode, which
  only guarantees *valid* JSON, not *correct shape*. Plain prompting ("respond with JSON only")
  frequently breaks (e.g. ```` ```json ```` fences, extra prose).
- **Recommendation:** define every AI output as a **typed schema** (Zod on our TS side; mirror with
  Pydantic if/when the crawler runs in Python). Use `response_format`/strict for the *final*
  extraction step; use function calling only when the model must *choose a tool* (e.g. "look up this
  brand in the KB"). Always **post-validate** with the schema and **retry once** on failure before
  giving up gracefully.

### 2.2 Grounding kills hallucination (the "don't waste money rejecting everything" fix)
- The #1 reason enrichment gets rejected is **invented facts** (made-up terpenes, fake awards,
  effects claims). Best practice: **give the model the facts** (retrieval/RAG) and instruct it to
  **only use provided facts**, **extract not invent**, and **say "unknown" when unsure**.
- Add **confidence + source** to every field. If the model can't ground a value in the input/KB, it
  must return low confidence (or omit it) rather than guess. Low-confidence drafts get flagged for
  the reviewer, not auto-surfaced.

### 2.3 crawl4ai: LLM is the *last resort*, not the default
- crawl4ai's own docs: **use CSS/XPath (no-LLM) extraction first** for structured/repeatable pages
  (POS menus, brand sites with consistent layouts) — it's faster, free, and deterministic. Reserve
  `LLMExtractionStrategy` for **semantically complex / unstructured** content.
- When the LLM *is* used: feed **`fit_markdown`** (pruned content filter) not raw HTML to slash
  tokens; set **`temperature` ~0**; **chunk** large pages with small overlap; pass a **Pydantic
  schema** (`extraction_type="schema"`); track tokens with `show_usage()`; **post-validate** output.
- crawl4ai is **provider-agnostic via LiteLLM** — it can point at the *same* OpenAI-compatible
  endpoint/model our `provider.ts` already uses (`AI_BASE_URL` / `AI_MODEL`). One model config, two
  callers.

### 2.4 WA I-502 advertising compliance (hard guardrails baked into prompts AND post-filters)
From RCW 69.50.369 / WAC 314-55-155 (and the 2026 ESB 5206 update). The AI must **never** draft:
- **Health / medical / therapeutic claims** (treats, cures, relieves, helps with pain/anxiety/sleep…).
- **Safety / efficacy** claims ("safe", "healthy", "non-addictive").
- **Dosing advice** or consumption quantities.
- Anything **appealing to minors** (cartoons, candy/kid comparisons, youthful mascots).
- **False/misleading** statements — no invented lab results, awards, origins, or effects.
- **Below-cost** advertising; **out-of-state targeting**; associations with **alcohol/tobacco/vehicles**.
- Public-facing ad copy should be ready to carry the **21+ age disclosure** where the surface is an ad.
- These already live partly in `compliance.ts`; the roadmap hardens and expands them.

### 2.5 Cannabis domain knowledge the model needs (so it sounds like an expert)
- **Strain families** (indica / sativa / hybrid) and lineage; **terpene profiles** (myrcene, limonene,
  caryophyllene, pinene, linalool, terpinolene, humulene) and their *aroma/flavor* descriptors
  (NOT effect/medical claims). **Categories** (flower, pre-rolls, vape, concentrate, edible,
  topical, tincture, accessory) each with their own vocabulary. **Cannabinoids** (THC/CBD/CBG/CBN)
  as *facts to report*, never as benefit claims.
- The model should describe **aroma, flavor, format, lineage, craftsmanship** — the legal, expert,
  on-brand surface area — and avoid the body-effect surface entirely.

### 2.6 Evals make it safe to improve (and prove ROI)
- Maintain a **golden set** of representative products with human-approved "good" enrichment.
- Use **LLM-as-judge with a rubric** (accuracy/grounded, compliant, on-brand, right length, no
  hallucination) plus deterministic checks (length, allowed-tags-only, compliance regex).
- **Version prompts** and A/B them against the golden set; only ship a prompt if it raises
  **accept-rate** and **compliance pass-rate** without raising cost. Track accept-rate per
  `prompt_version` (we already store it on every suggestion — we just need to report on it).

---

## 3. Target architecture

```
                         ┌───────────────────────────────────────────────┐
                         │            AI CORE (server-only)               │
   POS facts ──┐         │  provider.ts  →  generateStructured<T>(schema) │
   KB facts ───┼──prompt─▶  + model router (cheap→small→big)              │
   Crawled ────┘  build  │  + retry-on-invalid + usage ledger            │
   facts                 └───────────────┬───────────────────────────────┘
                                         │ typed, schema-valid draft
                                         ▼
                         ┌───────────────────────────────────────────────┐
                         │   VALIDATE & GROUND                            │
                         │  • Zod schema parse (shape)                    │
                         │  • compliance.ts scan (WA I-502)               │
                         │  • grounding check (every fact traceable?)     │
                         │  • confidence + source attached                │
                         └───────────────┬───────────────────────────────┘
                                         │ pending suggestion (+flags)
                                         ▼
                         ┌───────────────────────────────────────────────┐
                         │   HUMAN-IN-THE-LOOP  (ai_suggestions)          │
                         │  employee accepts / edits / rejects in admin   │
                         └───────────────┬───────────────────────────────┘
                                         │ accepted → applied to
                                         ▼
                              product_enrichment (draft → published)
```

**Same pipeline for AI buttons and for the crawler.** The crawler is just another *source of facts*
feeding the identical Validate → Ground → Human-review → Enrichment flow. That's the whole point of
designing the AI well first: crawl4ai plugs into a pipeline that already grounds, validates, and
gates everything.

### 3.1 Model choice (provider-agnostic, tiered)
- Keep the OpenAI-compatible `AI_BASE_URL`/`AI_MODEL` env design (works with OpenAI, OpenRouter,
  Together, local). **Default `AI_MODEL` = a small, cheap model** (e.g. `gpt-4o-mini`-class) for the
  bulk of enrichment. Add an **`AI_MODEL_HEAVY`** for the rare hard case (ambiguous/messy crawl) and
  keep `AI_VISION_MODEL` for image alt-text/photo analysis.
- A **router** picks the tier by task: deterministic rules (tags from a fixed list, category
  normalization) need **no model at all**; short factual descriptions use the **small** model;
  only genuinely messy free-text uses the **heavy** model.

### 3.2 Structured outputs everywhere
- Add `generateStructured<T>(schema, …)` to `provider.ts`: sends a JSON Schema via `response_format`
  (strict where the provider supports it), parses with the matching **Zod** schema, **retries once**
  with the validation error appended on failure, then falls back to `looseJsonParse` + best-effort.
- Every enrichment field (description, short_description, tags, seo_title, seo_description, terpene
  notes, flavor notes) gets a typed schema with **field-level constraints** (max length, enum tags).

### 3.3 The cannabis knowledge base (grounding source)
- A curated, owner-editable KB (Supabase tables, idempotent migration): **strain families**,
  **terpene → aroma/flavor descriptor** map (explicitly *non-medical*), **category vocabularies**,
  **brand facts** (from vendors/brands we already manage), and **banned-phrase** lists.
- At enrichment time we **retrieve the relevant KB rows** for the product (by category/strain/brand)
  and inject them as *the only allowed facts*. The system prompt says: "Use ONLY these facts and the
  POS facts. If a detail isn't here, omit it or mark it unknown. Never invent."

### 3.4 Compliance: prompt + post-filter + severity
- Expand `compliance.ts`: keep the system rules, broaden `RISKY_PATTERNS`, add **severity**
  (block vs. warn), and surface flags prominently in the reviewer UI (we already render
  `AiComplianceFlags`). A *blocking* flag means the draft can't be accepted until edited.

### 3.5 Provenance, confidence & cost (already half-built)
- Extend `ai_suggestions` with **confidence** and **source** (`pos` | `kb` | `crawl:<url>` | `model`)
  per field, plus the **prompt_version** we already store. Extend `ai_usage` reporting with
  **accept-rate by prompt_version/feature** so we can see which prompts earn their keep.

---

## 4. How this powers crawl4ai (the owner's headline question)

**Design principle: the crawler produces *candidate facts*, the AI core *interprets and grounds*,
the employee *approves*. crawl4ai never writes to the live site.**

Recommended crawl pipeline (built in a *later* slice, after this AI core lands):

1. **Target & permission.** Crawl only sources we're allowed to (brand sites, our own POS export,
   public product pages). Respect robots; rate-limit; cache (crawl4ai `CacheMode`).
2. **Cheap extraction first.** For consistent layouts, use crawl4ai's **CSS/XPath (no-LLM)
   strategy** — free, fast, deterministic. This handles the bulk and avoids burning tokens.
3. **`fit_markdown` for the messy rest.** Apply a pruning content filter so only the relevant
   product section reaches the model. Massive token savings.
4. **Schema-based LLM extraction.** Point crawl4ai's `LLMExtractionStrategy` (via LiteLLM) at the
   **same model/endpoint** our `provider.ts` uses, with a **Pydantic schema mirroring our Zod
   enrichment schema**, `temperature≈0`, chunking + small overlap, `extraction_type="schema"`.
5. **Verify against the page (anti-hallucination).** Before a crawled fact becomes a draft, check it
   actually appears in / is supported by the fetched content. Unsupported → drop or low-confidence.
6. **Ground + compliance + map to POS key.** Run crawled facts through the *same* KB grounding and
   `compliance.ts` scan; map to the stable POS product key; store as `ai_suggestions` with
   `source = crawl:<url>` and a confidence score.
7. **Human review.** Crawled drafts land in the **same Bulk AI review** grid employees already use.
   Accept/edit/reject. Accepted → `product_enrichment` draft → publish.
8. **Measure.** Track crawl accept-rate, cost per accepted field, and source reliability per domain;
   down-rank domains that produce rejected junk.

**Why this gives the crawler "the best chance":** it's fed a tight schema, the cheapest viable
extraction path, pruned input, near-zero temperature, a curated cannabis KB to ground against, a
verify-against-source gate, and a compliance filter — *before* anything reaches a human. That is the
difference between a crawler that produces approvable drafts and one whose output gets rejected
(wasting money), which is exactly the owner's concern.

---

## 5. Phased slice plan (build order — AFTER this research is approved)

> One PR per slice. Migrations idempotent, applied manually by the owner. AI stays drafts-only.

- **AI-1 — Structured core.** Add `generateStructured<T>(zodSchema)` to `provider.ts` (strict
  `response_format` + Zod validate + retry-once). Migrate product description/tags to it. No new UI.
  *Exit:* same drafts, now schema-guaranteed; invalid-JSON failures ~0.

- **AI-2 — Compliance hardening.** Expand `compliance.ts` (more patterns, severity, blocking flags);
  surface blocking vs. warning in the reviewer UI. *Exit:* a non-compliant draft can't be accepted
  un-edited.

- **AI-3 — Cannabis knowledge base.** Idempotent migration for strain/terpene/category/brand-fact +
  banned-phrase tables; owner-editable in admin; retrieval helper that injects relevant KB rows into
  prompts. Re-prompt descriptions to "use only provided facts". *Exit:* measurably fewer invented
  facts (track on golden set).

- **AI-4 — Provenance + confidence + accept-rate reporting.** Add confidence/source columns to
  `ai_suggestions`; add accept-rate-by-prompt_version to `/admin/ai-usage`. *Exit:* we can prove a
  prompt change helps.

- **AI-5 — Eval harness.** Golden set table + an offline script (LLM-as-judge rubric + deterministic
  checks) that scores a prompt_version. *Exit:* prompts ship only if they beat the current accept-
  rate + compliance pass-rate at equal-or-lower cost.

- **AI-6 — Model router + budgets.** Tiered model selection (none → small → heavy); per-feature
  monthly budget + alerting in the usage dashboard. *Exit:* cost-per-accepted-field tracked & capped.

- **AI-7 — crawl4ai foundation.** Stand up crawl4ai (CSS-first, `fit_markdown`, schema extraction,
  verify-against-source) writing candidate facts into `ai_suggestions` with `source=crawl:<url>`.
  Reuses AI-1…AI-6 entirely. *Exit:* crawled drafts appear in Bulk AI review; nothing auto-publishes.

- **AI-8 — Crawl tuning.** Per-domain reliability scoring, scheduling, de-dup, image candidate
  capture (alt-text via vision). *Exit:* crawler maintained, high accept-rate, low cost.

---

## 6. Cost-control summary (the "don't waste money" mandate)
- **Do the cheapest thing that works:** deterministic rules → no-LLM CSS extraction → small model →
  heavy model (router). Most enrichment should never reach the heavy model.
- **Shrink the input:** `fit_markdown`/pruning, chunking, no raw HTML when markdown will do.
- **Make output cheap to trust:** strict schema + validate + retry-once (no expensive re-runs/manual
  cleanup). Low temperature for extraction.
- **Stop paying for rejects:** grounding + verify-against-source + compliance gate raise accept-rate;
  eval harness blocks regressions; accept-rate-by-prompt tells us what's working.
- **Budget & observe:** per-feature budgets + alerts on the existing `ai_usage` dashboard;
  cost-per-*accepted*-field is the metric that matters, not cost-per-call.

---

## 7. Risks & mitigations
- **Provider drift / strict-mode support varies** → keep `looseJsonParse` fallback; feature-detect.
- **KB goes stale** → owner-editable; flag low-confidence when KB lacks the fact.
- **Crawl sources change layout** → CSS strategy fails soft to LLM; per-domain reliability scoring.
- **Compliance edge cases** → blocking flags + human review are the backstop; regex is assistive only.
- **Over-automation temptation** → hard rule preserved: **drafts only, human accepts**. No auto-publish.

---

## 8. Open questions for the owner (to confirm before AI-1)
1. **Model budget / provider:** stay on the current `AI_MODEL` default, or set a heavy model for hard
   cases? Any monthly $ ceiling you want enforced with alerts?
2. **Crawl sources:** which brand/vendor sites are fair game first? (We'll respect robots + rate limits.)
3. **KB ownership:** happy for the cannabis KB (terpene/strain/category vocab) to be **owner-editable**
   in the admin, seeded by us with an expert starter set?
4. **Confidence threshold:** auto-surface only drafts above a confidence bar (e.g. only show high-conf
   in the default review queue, low-conf behind a "needs a closer look" filter)?

---

## 9. Definition of done for "AI is well built" (gate before crawl4ai)
- [ ] All enrichment outputs are typed + schema-validated (AI-1).
- [ ] Compliance has blocking severity + reviewer surfacing (AI-2).
- [ ] Cannabis KB exists, is editable, and grounds prompts (AI-3).
- [ ] Confidence/source on every suggestion + accept-rate reporting (AI-4).
- [ ] Golden set + eval harness gate prompt changes (AI-5).
- [ ] Model router + budgets/alerts (AI-6).
- Only THEN build crawl4ai (AI-7) onto this proven core.

---

## 10. Mapping to existing files (so AI-1 starts fast)
- Extend: `src/lib/ai/provider.ts` (add `generateStructured`), `src/lib/ai/compliance.ts`
  (patterns + severity), `src/lib/ai/suggestions.ts` (confidence/source), `src/lib/ai/usage.ts`
  (accept-rate), `src/lib/enrichment/*` (schema mirrors).
- New (later slices): `src/lib/ai/schemas/*` (Zod), `src/lib/ai/router.ts`, `src/lib/ai/kb/*`
  (knowledge base), `src/lib/ai/eval/*` (golden set + judge), `src/lib/crawl/*` (crawl4ai bridge).
- Migrations (idempotent, owner-applied): KB tables, `ai_suggestions` confidence/source columns,
  golden-set table.

---

## 11. Sources (consulted 2026)
- OpenAI — *Introducing Structured Outputs in the API* (constrained decoding, ~100% schema adherence).
- codeawake — *OpenAI's Structured Outputs for RAG and Data Extraction* (Pydantic + `response_format`,
  function-calling for retrieval, streaming).
- Vellum — *Function calling vs Structured Outputs vs JSON mode* (when to use each; use Structured
  Outputs over bare JSON mode; `response_format` for final-step extraction).
- crawl4ai docs — *LLM Strategies* and *LLM-Free Strategies* (CSS/XPath first, `fit_markdown`,
  `extraction_type="schema"`, chunking/overlap, `show_usage`, post-validate; LiteLLM provider-agnostic).
- Firecrawl / Red Hat / Microsoft / AWS Bedrock — hallucination mitigation (grounding, extract-don't-
  invent, confidence, human review).
- Gleam Law summary of ESB 5206 / WAC 314-55-155 + RCW 69.50.369 — WA cannabis advertising rules
  (no medical/safety claims, no minor appeal, 21+ disclosure, no below-cost/out-of-state/transit ads).
- Cannabis terpene/strain references (terpene→aroma/flavor descriptors; indica/sativa/hybrid; category
  vocabularies) — for the knowledge-base starter content (aroma/flavor only, never effects/medical).
- Arize / Patronus / Langfuse / DeepEval — LLM-as-judge + rubric evals, golden datasets, prompt
  versioning, accept-rate as the production metric.
