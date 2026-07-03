# KB Backbone Research & Audit — Toward an "Adamantium/Uru" Data Command Center

> Purpose: Ground (in verified fact) the decision of how to evolve Greenway's knowledge base (KB)
> from a set of admin forms into an indestructible, single-source-of-truth **data backbone** — the
> command center that feeds the website, POS, intake, vendors/brands, images, and all back-office data.
>
> Method (per standing rules): deep research from authoritative industry sources + a full audit of the
> actual file tree. Nothing here is guessed; every claim about the codebase was verified by reading files,
> and every industry principle is cited to its source.

---

## Part 1 — What the industry calls what we are building

The owner's instinct ("backbone / source of truth for all vendors, brands, products") maps **exactly** onto
two mature, well-documented enterprise disciplines. We are not inventing a concept — we are building a
domain-specific instance of an established pattern, which means we can lean on decades of proven practice.

### 1.1 PIM — Product Information Management (this is the closest fit)
Per Pimcore's PIM guide (pimcore.com/en/resources/insights/what-is-pim, May 2024): a PIM "collects,
consolidates, enriches, and manages product information in a single place… to standardize, and manage the
delivery of your product information to different selling channels." A PIM is formally "a subcategory of the
comprehensive Master Data Management (MDM) domain." Its core lifecycle is:

> **collect (import, map, transform) → synchronize (cleanse, merge, consolidate) → centralize → enrich
> (categorize, classify, relate, augment) → disseminate (customize, export, publish)**

Key PIM principles that apply directly to Greenway:
- **Single version of truth.** "Organizations become centered around a single version of product data… while
  the back-end workflows get streamlined." Our KB should be the one place a strain/brand/product fact lives.
- **Product experience is directly linked to data quality.** Pimcore: great product experience — not just
  price — is "one of the key differentiators for customers." Our menu quality is a function of KB quality.
- **Data governance with workflows + access control.** "An organization may not prefer just about anyone…
  to update data pertaining to compliance of a product, as it might create legal complications." This is
  literally our CCRS/DOH problem: compliance-sensitive fields must be governed.
- **DAM (Digital Asset Management) belongs with PIM.** "Most DAMs are already a part of PIM platforms" —
  linking images/media to products is a first-class PIM job. We already have `media_assets` +
  `kb_image_substitutes`; the research says these should be unified into the KB entity view.

### 1.2 MDM — Master Data Management & the "Golden Record"
Per Profisee (profisee.com/blog/what-is-a-golden-record, Aug 2025), a **golden record** is "a complete and
accurate version of a data point… accessed by all connected business systems." A golden record is identified
by five measurable characteristics — these become our KB's north-star quality metrics:

| Characteristic | Definition (Profisee) | Our KB application |
| --- | --- | --- |
| **Accuracy** | Verified for correctness, documented where accessible to all | provenance (`sources[]`, `confidence`) already on kb_* |
| **Completeness** | Has as much info as available (at least the essentials) | **GAP: we don't score/show completeness today** |
| **Uniqueness** | Each record unique, no duplicates/near-duplicates | strain-matcher fuzzy-matches; brands have slug UNIQUE |
| **Timeliness** | Updated as soon as new/changed data is verified | write-back on publish exists (Request G) |
| **Trustworthiness** | Treated as the SSOT, consistently used by the business | **GAP: menu/website only partially read the KB** |

MDM's operational model that we should adopt:
- **Medallion architecture (Bronze → Silver → Gold).** Bronze = raw source data (POS/Cultivera export, vendor
  manifest). Silver = processed/mapped/staged. Gold = mastered golden records in the KB. This gives everyone a
  "common language for data's readiness." Our `product_enrichments` (draft) → `ai_suggestions` (proposed) →
  `kb_products` (published) already resembles Bronze→Silver→Gold; we should name and surface it that way.
- **Survivorship rules** decide which value wins when sources conflict (recency, source priority, most-complete,
  aggregate). Our write-back currently does non-destructive gap-fill + union; we should make the survivorship
  policy explicit and visible.
- **Human-in-the-loop approval.** Profisee: "computers can't do analysis and inference that's sometimes needed…
  Human-in-the-loop approval workflows that flag potential mismatches for validation" plus "audit trails and
  change logs." This is our standing rule (AI = drafts-only) — the research validates it as best practice.
- **Match techniques** — rule-based, probabilistic, fuzzy. We already do fuzzy matching in `strain-matcher.ts`.
- **Publish to downstream via APIs.** Golden records are pushed to downstream systems; "APIs build a continuous
  connection… that removes manual labor." Our downstream = website menu, POS, blog, marketing.

### 1.3 UX — how a command center should feel (clean, not cluttered)
Per Nielsen Norman Group, "Progressive Disclosure" (Jakob Nielsen, definitive source): the way to satisfy the
tension between **power** and **simplicity** is to **"initially, show users only a few of the most important
options"** and **"offer a larger set of specialized options upon request."** This improves three of usability's
five components: **learnability, efficiency, and error rate.** Two rules must be gotten right:
1. **The right split** between initial vs. secondary features (show what's frequently needed up front).
2. **Obvious progression** with strong "information scent" (clear labels that set expectations).

NN/g also describes **staged disclosure** (wizards) — a linear sequence with a subset per step — which is the
correct pattern for our multi-field **entity editors** (strain/brand/product) and for the **review queue**.

**Verdict:** the current KB page violates progressive disclosure — it stacks 8 heavy sections on one screen
(help panel, 6 stat cards, seed form, notes, library, substitutes, a bare brand-facts form, banned phrases).
Everything is "up front," so nothing is prioritized. This is precisely the clutter the owner flagged.

---

## Part 2 — Full file-tree audit (verified, current state)

### 2.1 KB data model (verified from migrations + `src/lib/ai/kb/store.ts`)
- **Entities:** `kb_strains` (+effects[]), `kb_terpenes`, `kb_category_terms`, `kb_brands`,
  `kb_product_categories` (+effects[]), `kb_products` (per-SKU, migration 0071 — **owner must apply manually**),
  `kb_banned_phrases`, `kb_image_substitutes`, `kb_notes`.
- **Provenance already present:** `sources[]`, `confidence`, `active`, audit columns on most kb_* tables.
- **Governance already present:** RLS staff-only on all kb_*; `is_staff()`; compliance gate in `compliance.ts`
  (medical claims blocked, experiential effects allow-listed).

### 2.2 KB WRITE surfaces (who creates/updates golden records)
- `src/app/admin/knowledge-base/actions.ts` — upsert strain/brand/category, add banned phrase, notes,
  substitutes; review kb_products; seed medical blocklist.
- `src/app/admin/products/actions.ts` — `writeBackOnPublish()` + `generateProductEffects()` (Request G):
  validated enrichment flows INTO the KB brain on publish.
- `src/app/admin/products/bulk-ai/actions.ts` — bulk accept → write-back.
- `src/lib/ai/kb/writeback.ts` — the write-back service (compliance-gated, drafts-only, non-destructive union).
- `src/lib/ai/kb/store.ts` — all upserts + review functions.

### 2.3 KB READ surfaces (who consumes golden records today)
- `src/app/admin/inventory/intake/[id]/page.tsx` — `matchIntakeLinesToKb()` suggests the known strain per
  manifest line (drafts-only; never writes). **This is the intake ↔ KB bridge.**
- `src/lib/enrichment/image-resolver.ts` — resolves product images via `kb_image_substitutes`
  (brand/vendor/category/inventory_type/global scope). **This is the images ↔ KB bridge.**
- `src/lib/menu/strain-terpenes-server.ts` — overlays live `kb_strains` onto the customer menu index.
  **This is the website/menu ↔ KB bridge (partial).**
- `src/lib/ai/kb/retrieval.ts` — loads banned phrases + grounding for AI generation.
- `src/lib/marketing/strategy-ai.ts`, `src/lib/cms/ai-blog.ts` — layer owner banned phrases onto compliance.
- `src/lib/admin/concierge-kb.ts` — a **separate** static ops "how-to" KB (staff help), not the data KB.

### 2.4 KB admin UI (the clutter)
- `page.tsx` — 311 lines, 8 stacked sections (see verdict in 1.3).
- Components: `StrainEditor` (515L), `ProductCategoryEditor` (434L), `SubstituteManager` (265L),
  `NotesManager` (173L), `KbLibrary` (80L); plus `review/page.tsx` (isolated write-back review queue).

### 2.5 Gaps vs. golden-record / PIM / UX best practice (this is the roadmap fuel)
1. **No completeness/quality signal.** Golden records require measurable completeness; we neither compute nor
   show "how complete is this strain/brand/product?" — so stewards can't see what to fix next.
2. **No unified entity workspace.** PIM centralizes; we have one form per type on one crowded page instead of a
   searchable, filterable list → detail (drill-down) view per entity.
3. **No KB-wide search.** A command center must let you find any entity fast (information scent). Absent today.
4. **Brands/vendors are second-class in the UI.** "Brand facts" is a bare 2-column form; vendors aren't a KB
   entity in the UI at all — yet they're a core master-data domain (the "for all my vendors and brands" ask).
5. **Provenance/versioning not visible.** We store `sources[]`/`confidence` but never show a per-entity
   history/audit view; MDM mandates audit trails + change logs.
6. **Trustworthiness gap (downstream reads are partial).** The menu overlays strains but products/brands aren't
   fully KB-driven; the golden record isn't yet "consistently used by the business" everywhere.
7. **Medallion stages not surfaced.** Bronze→Silver→Gold exists implicitly (enrichment→suggestion→kb_products)
   but isn't named/visible, so the review workflow feels disconnected (isolated `review/` page).
8. **Page violates progressive disclosure** (clutter) — established above.

---

## Part 3 — Expert recommendation: the next several slices

Grounded in the above, here is the recommended sequence. Each is a self-contained slice (standing rules:
slices, drafts-only AI, idempotent manual migrations, branch+PR+squash, verify TSC+build).

### Slice 1 — Rework the KB page into a clean "command center" hub (progressive disclosure)
Replace the 8-section stack with a lean hub: (a) a compact health strip (the 5 golden-record signals, not 6
raw counts), (b) prominent **search**, (c) an **entity navigator** (Strains · Brands · Vendors · Categories ·
Products · Terpenes · Images · Banned phrases · Notes) as cards/tabs that drill into focused sub-pages, (d)
a "Needs attention" queue (drafts to review, low-completeness records). Move every heavy editor OFF the hub
into its own route (staged disclosure). Pure UI/route refactor — no schema change. *Grounds: NN/g progressive
+ staged disclosure; PIM centralize; MDM golden-record signals.*

### Slice 2 — Data completeness & quality scoring (the golden-record health system)
Add a pure, testable scoring module that, per entity, computes completeness (% of essential fields present) and
a quality/trust score (confidence + source presence + compliance-clean). Surface as badges in lists and a bar
on each editor. Drives the "Needs attention" queue. *Grounds: golden-record Completeness/Accuracy/Trust;
data-quality dashboards.* (Likely no migration — computed; optional generated column later.)

### Slice 3 — Unified entity workspace: search + list→detail for Strains & Brands first
Build the reusable "list (searchable/filterable, with completeness badges) → detail editor" pattern and apply
to Strains and Brands. Show provenance (sources, confidence) and a change/audit trail per record. *Grounds:
PIM single repository + governance; MDM audit trails; NN/g information scent.*

### Slice 4 — Promote Vendors & Brands to first-class KB master-data (with hierarchy)
Make Vendor → Brand → Product a visible parent/child hierarchy (referential integrity already via FKs). Bring
vendor facts into the KB workspace (today only brands have facts). Add the same list→detail + completeness.
*Grounds: MDM referential checks / parent-child; owner's explicit "all my vendors and brands" ask.*

### Slice 5 — Unify images/DAM into the entity view + strengthen substitute governance
Show, on each brand/vendor/category/product, its resolved image (real vs. substitute vs. needs-online) and let
stewards fix it in place; consolidate `kb_image_substitutes` management into the entity workspace rather than a
separate manager. *Grounds: PIM+DAM unification; product-experience-quality.*

### Slice 6 — Make the medallion pipeline explicit + one governed review inbox
Rename/surface Bronze (intake/import) → Silver (enrichment/AI suggestions) → Gold (published kb_products), and
fold the isolated `review/` page into a single governed **review inbox** with survivorship shown, approve/reject,
and full audit. *Grounds: MDM medallion + survivorship + human-in-the-loop + audit trails.*

### (Later / dependent on owner) Slice 7 — Downstream trust: make website/menu fully KB-driven
Extend the menu/website to read brand + product golden records (not just strain overlay), closing the
Trustworthiness gap so the KB is "consistently used by the business." *Grounds: golden-record Trustworthiness;
PIM disseminate; APIs to downstream.* (Sequenced later because it touches the live customer site.)

---

## Sources (verified this session)
- Pimcore, "What is Product Information Management (PIM)? A Beginner's Guide" (May 2, 2024) —
  https://pimcore.com/en/resources/insights/what-is-pim
- Profisee, "What Is a Golden Record in MDM?" (Aug 26, 2025) — https://profisee.com/blog/what-is-a-golden-record
- Nielsen Norman Group, Jakob Nielsen, "Progressive Disclosure" (Dec 3, 2006) —
  https://www.nngroup.com/articles/progressive-disclosure
- Codebase: verified by direct file reads (migrations 0001–0071, `src/lib/ai/kb/*`,
  `src/app/admin/knowledge-base/*`, intake/products/vendors actions, image-resolver, strain-terpenes-server).
