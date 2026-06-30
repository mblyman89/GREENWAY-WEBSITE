# Greenway POS — Planning Docs (Slice 0)

This folder holds the research + planning for turning the Greenway back office into a full
**Point of Sale (POS) command center** that replaces Cultivera — built ourselves, one slice at a time.

> **Slice 0 = research/planning only.** No production feature code ships here. Implementation begins
> at Slice 1 **after the owner picks the starting point**.

## Read in this order

1. **`POS_RESEARCH.md`** — the foundation. Cannabis + retail POS feature domains, the **WA CCRS
   compliance backbone** (not Metrc), the dispensary KPI catalog, cash-handling realities, how it
   stacks on what we already have, and the design principles that carry into every slice.
2. **`POS_DATA_MODEL_GAP_ANALYSIS.md`** — our real 38-table schema mapped to POS needs; what exists,
   what's missing, and the proposed new tables (with KPI → data-source mapping so no metric is invented).
3. **`POS_ROADMAP.md`** — the slice-by-slice plan (Slices 1–12) with phases, dependencies, risk, and
   the recommended starting point.
4. **`POS_FEATURE_CHECKLIST.md`** — exhaustive, checkable feature inventory by domain, tagged with the
   slice that ships each item.
5. **`PAGE_ENHANCEMENT_PLAN.md`** — the owner's immediate ask: feature-rich products/vendors/brands
   pages with "exactly what's missing" + statistics (this is **Slice 1**, zero DB risk).

## How we work (standing rules baked in)
- One PR per slice (squash-merge, delete branch, sync main).
- Migrations/seeds are **idempotent** and **applied manually by the owner** in the Supabase SQL editor.
- New POS tables get **staff-only RLS**; sensitive actions write to `audit_logs`.
- **AI/crawler output is drafts-only** — an employee validates before anything goes live.
- Money in **minor units (cents)**; WA tax + purchase limits centralized in `site_settings`.
- **Re-pull the live WA LCB/CCRS spec** before finalizing any compliance-bound feature.

## Key architectural facts (don't forget)
- **WA = CCRS, not Metrc.** Compliance is a *report over real data* (CSV exports), not a bolt-on.
  Capture COA `LabtestexternalIdentifier`, manifest lineage, and lot data from the start.
- The current `orders` table is the **web pre-order/reservation** channel — **not** the in-store
  register ledger. The register (transactions/tenders/sessions) is new and arrives in Phase C.
- POS-imported price/inventory stays **source of truth for selling** until the register explicitly
  takes over (gated in Slice 8).

## Recommended starting point
**Slice 1 — Products/Vendors/Brands insight upgrade.** It answers the owner's immediate need, has
zero DB risk, and establishes the insight patterns every later POS screen reuses.
