# Product Mastering — Super-Intelligent Design (Slice 7f)

> Owner directive (verbatim): *"make the ai as smart as possible… super intelligent
> about product mastering. It's meant to take the same strain from the same vendor
> in the same type/category and marry them together, 1g, 3.5g, etc… make sure the
> logic is very sound… make product mastering a super intelligent arm of this backbone."*

This document grounds the mastering engine in verified master-data / entity-resolution
and UX research, then specifies the exact algorithm. It is the reference for
`src/lib/products/masters-cluster.ts` + `src/lib/products/masters-store.ts`.

---

## 1. What "mastering" means here

A **product master** is one public menu card that rolls up several POS SKUs that are
**the same product sold at different sizes/forms** — e.g. a brand's *Blue Dream* flower
sold as 1g, 3.5g (eighth), 7g, 14g, 28g. Each SKU stays a purchasable **variant**; the
customer sees **one card** with a size selector.

This is the *golden record* pattern from Master Data Management (one authoritative
record per real-world entity) applied to the retail catalog, and it matches the
Nielsen Norman Group e-commerce guideline: **product variations (differing by a single
attribute — here, size) belong under a single listing; genuinely different products get
separate listings.** (NN/g, "Design Guidelines for Selling Products with Multiple
Variants", 2022.)

## 2. Research grounding (verified)

**Entity resolution / MDM matching** (Mastech Digital, "Deterministic vs. Probabilistic
Matching"; Reltio / Profisee entity-resolution references):

- **Hybrid matching is the industry standard.** Use *deterministic* rules for
  high-confidence, unambiguous matches and *probabilistic / AI* similarity for the
  weaker, fuzzier cases. Neither alone is sufficient.
- **Blocking / bucketing first.** Never compare every record to every other record.
  Partition into small candidate blocks (here: brand + category family) *before* any
  expensive comparison. This is what keeps matching both scalable and accurate.
- **Equivalence values matter.** "Blue Dream" ≡ "Bluedream" ≡ a POS alias. Matching on a
  *canonical* identity (our kb_strains slug + aliases) beats matching on raw strings.
- **Error-cost asymmetry.** Deterministic matching skews toward *false negatives*
  (misses); probabilistic toward *false positives* (wrong merges). On a **public menu a
  false positive is the expensive error** — marrying two different products misprices or
  misrepresents them to a customer. Therefore: deterministic identity must be **strict**,
  the AI pass must be **conservative**, and **every** proposal is a **draft** a human
  approves. (Standing rule: AI output = drafts-only.)
- **Golden-record + human data-steward review** is a required part of any sound MDM
  pipeline — not an optional nicety.

## 3. The backbone-grounded identity (the core idea)

The previous engine grouped on the **normalized product-name string**. That is fragile:
it misses alias/spelling variance and it ignores the master data we already curate.

7f re-grounds the identity on the **backbone**:

```
mastering identity  =  BRAND-IDENTITY  ×  CATEGORY-FAMILY  ×  CANONICAL-STRAIN  ×  MARKET
```

- **BRAND-IDENTITY** — resolved against the operational `brands` master table (a brand's
  canonical slug), falling back to the normalized brand string. ("Same vendor/brand.")
- **CATEGORY-FAMILY** — resolved against `kb_product_categories.group_key`
  (flower / concentrate / vape / edible / liquid / topical) so "Flower" and "Popcorn Bud"
  land in the same family, but flower never marries a vape. ("Same type/category.")
- **CANONICAL-STRAIN** — resolved against `kb_strains` **slug + aliases** so spelling and
  alias variants of one cultivar collapse to one identity. This is the single biggest
  intelligence upgrade. ("Same strain.")
- **MARKET** — adult-use vs medical are never married (regulatory + pricing correctness).

Two SKUs with the **same** identity across all four axes, **differing only by size**, are
the same product → marry them.

## 4. The algorithm (hybrid, drafts-only)

1. **Load candidates** — the live published menu items not already assigned to a master.
2. **Resolve backbone facts once** — build lookup maps: brand string → canonical brand
   slug (`brands`), category → family (`kb_product_categories`), strain string → canonical
   strain slug (`kb_strains` incl. aliases). All best-effort; a missing backbone row
   degrades gracefully to the normalized string.
3. **Block** — bucket candidates by `brandIdentity | categoryFamily` (cheap, scalable).
4. **Deterministic pass (high confidence, no AI cost)** — within each block, group by the
   full backbone identity (adds canonical strain + market). Groups of 2+ SKUs that differ
   only by size become **high-confidence** draft suggestions (conf ≈ 0.9–0.97). Confidence
   is *higher* when the strain matched a curated kb_strains row (verified canonical) than
   when it fell back to a raw string.
5. **AI pass (conservative, finer cases)** — only for the SKUs a block could **not**
   resolve deterministically. The model is given the backbone facts (canonical brand,
   family, resolved strain) and asked, conservatively, whether 2+ remaining items are the
   same product at different sizes. Never invents sizes/names; never health claims.
6. **Persist as pending suggestions** — deduped by member-key set. **Nothing publishes.**
7. **Human validation** — staff accept → a `draft` master + members is created; staff
   still publishes. Reject/edit supported. (Existing accept/reject flow, unchanged.)

### Why this is "sound" (guards against the expensive error)

- Deterministic marriages require an **exact** identity match on all four axes — brand,
  family, canonical strain, and market — so two different strains or a flower vs. a vape
  can never merge.
- Size is the **only** attribute allowed to differ within a group (verified against the
  variant-label parser). This is exactly NN/g's single-attribute-variation rule.
- The AI is fenced to the leftover items only, runs at low temperature, is told to be
  conservative, and its output is a **draft** — a human is always the final gate.
- Everything is **idempotent** and **non-destructive**: re-running proposes the same sets
  and never touches published masters or the live menu.

## 5. Variant labels

Size/format variant labels (1g, 3.5g, 7g, 10pk, 100mg, …) are parsed deterministically
from the SKU name by `deriveVariantLabel()` and shown as the selectable attribute on the
card. If a SKU has no parseable size it still joins the master but with a null label
(staff can label it).

## 6. Compliance & standing rules

- Sensory/experiential only in any AI rationale; **no** medical/curative claims
  (`checkCompliance` governs any surfaced copy elsewhere; the mastering prompt forbids it).
- Money stays in **minor units**; mastering never changes price/stock (POS truth).
- **Drafts-only**; migrations owner-applied; idempotent; hand-off ready.
