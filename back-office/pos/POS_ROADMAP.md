# Greenway POS — Roadmap (Slice-by-Slice)

> The sequenced plan to grow the back office into a full POS command center, **one PR per slice**
> (squash-merge, delete branch, sync main). Each slice ships migrations idempotent + owner-applied,
> RLS on new tables, audit on sensitive actions, and AI/crawler output drafts-only.
>
> Slice 0 (this PR) = research + planning only. Implementation begins at Slice 1 **after owner picks
> the starting point**. The owner can re-order slices; dependencies are noted so we don't break that.

---

## Phase map (themes)

- **Phase A — Insight & foundation** (Slices 1–3): make the existing pages POS-grade and lay the
  customer + roles groundwork. Low risk, high immediate value, no change to "source of truth."
- **Phase B — Inventory truth & purchasing** (Slices 4–6): lots, COA/manifest lineage, purchase
  orders, receiving. This is where compliance lineage is born.
- **Phase C — The register** (Slices 7–9): sessions, transactions, tenders, returns/voids, cash
  management. This is where the POS becomes a POS.
- **Phase D — Compliance & analytics** (Slices 10–12): CCRS export, KPI dashboards, forecasting,
  hardening. This is the "command center."

---

## Slice-by-slice

### Slice 1 — Products/Vendors/Brands insight upgrade (recommended start)
**Goal:** Deliver the owner's immediate ask — feature-rich pages that show *exactly what's missing*,
plus statistics and detailed insight. Pure UI + read-only analytics over existing data.
- Extend `completeness.ts` (vendor/brand) + products `computeGaps` into a richer scoring model.
- Add statistics panels (counts, % complete, missing-field breakdowns, top gaps, brand/vendor
  coverage, category mix, price ranges, stock status) to `/admin/products`, `/admin/vendors`,
  `/admin/brands` (and detail pages).
- "What's missing" actionable lists with deep links (e.g., missing image / description / COA / logo).
**Depends on:** nothing. **Risk:** low. **DB:** none (read-only).

### Slice 2 — Customer & patient records
**Goal:** Real `customers` (+ `patient_authorizations`); link `loyalty_signups` and web `orders`.
- Migration `0022`: `customers`, `patient_authorizations` (RLS staff-only).
- Admin CRUD + customer profile (history, loyalty, consent). Backfill from loyalty/orders (draft).
**Depends on:** Slice 1 patterns. **Risk:** low–med (PII → strict RLS, audit).

### Slice 3 — Roles, permissions & approval workflow
**Goal:** Formalize POS roles on `staff_profiles`; add `approval_requests` for overrides/voids/returns.
- Migration `0023`: `approval_requests`. Define POS permission keys; manager-approval UI primitives.
**Depends on:** existing `requirePermission`. **Risk:** low.

### Slice 4 — Inventory lots, COA & manifest lineage
**Goal:** Birth of compliance traceability. Lots tie product ↔ vendor ↔ COA ↔ manifest.
- Migration `0024`: `inventory_lots`, `lab_results` (incl. `labtest_external_identifier`),
  `inbound_manifests`, `inventory_adjustments`.
- Admin: lot list/detail, COA capture, adjustment with reason codes (audited).
**Depends on:** Slices 2–3. **Risk:** med (data model is the compliance backbone — get it right).

### Slice 5 — Purchase orders
**Goal:** Create/manage POs to vendors; lifecycle draft→sent→partial→received→closed.
- Migration `0025`: `purchase_orders`, `purchase_order_lines`; extend vendor terms/lead time.
- Admin: PO builder, status board, cost capture.
**Depends on:** Slice 4 (lots created on receipt). **Risk:** med.

### Slice 6 — Receiving + on-hand truth
**Goal:** Receive against PO/manifest (partial + backorder); create lots; establish `inventory_levels`.
- Migration `0026`: `receivings`, `receiving_lines`, `inventory_levels` (on-hand by item/lot/location).
- Reorder alerts, low-stock, expiring-lot alerts (read-only initially).
**Depends on:** Slices 4–5. **Risk:** med–high (this is when on-hand starts to matter).

### Slice 7 — Register sessions + cash management
**Goal:** Open/close drawers with float, blind close, variance; cash movements + deposits.
- Migration `0027`: `register_sessions`, `cash_drawers`, `cash_movements`, `deposits`.
- Register-open / close UI; denomination counting; audited.
**Depends on:** Slice 3 (roles). **Risk:** med.

### Slice 8 — The sell flow (transactions)
**Goal:** Ring a sale: cart, scan, variants, discounts (reuse promotions), tax, loyalty attach,
purchase-limit enforcement, mixed tender, receipts.
- Migration `0028`: `transactions`, `transaction_lines`, `transaction_tenders`.
- Register UI (touch + scanner). **Inventory deducts from `inventory_levels` by lot (FIFO/FEFO).**
- **Switch of source-of-truth for selling is explicit and gated here.**
**Depends on:** Slices 6 + 7. **Risk:** high (core POS; needs offline resilience + careful testing).

### Slice 9 — Returns, voids, exchanges
**Goal:** First-class returns/voids with reason codes, manager approval, inventory restock, audit.
- Extends `transactions` (type) + `inventory_adjustments`. Uses `approval_requests`.
**Depends on:** Slice 8. **Risk:** med.

### Slice 10 — CCRS compliance export
**Goal:** Generate WA CCRS-shaped reports (sales, inventory adjustments, manifests/transfers) over
real tables. Re-pull the live LCB CCRS Reporting Guide spec at build time.
- Migration `0029`: `compliance_reports` (export jobs). Report builders + downloadable CSVs.
**Depends on:** Slices 4–9 (needs lots, manifests, transactions). **Risk:** high (regulatory accuracy).

### Slice 11 — Command-center dashboards (KPIs)
**Goal:** Owner/manager dashboards for the KPI catalog (sales, inventory health, cash, customer,
compliance). Drill-downs + date ranges + export.
**Depends on:** Slices 8–10 (needs transactional + inventory data). **Risk:** med.

### Slice 12 — Forecasting, optimization & hardening
**Goal:** Demand forecasting, reorder-point automation, cycle-count scheduling, ABC analysis;
performance, offline resilience, security review, audit completeness.
**Depends on:** all prior. **Risk:** med.

---

## Dependency graph (quick view)

```
S1 (insight) ─┐
              ├─> S2 (customers) ─> S3 (roles) ─┐
              │                                  ├─> S4 (lots/COA) ─> S5 (POs) ─> S6 (receiving/on-hand)
              │                                  │                                      │
              │                                  └────────────> S7 (register+cash) ─────┤
              │                                                                          ├─> S8 (sell)
              │                                                                          │      │
              │                                                                          │      └─> S9 (returns)
              │                                                                          │
              └──────────────────────────────────────> S10 (CCRS) <─────────────────────┘
                                                          │
                                          S11 (dashboards) ┘ ──> S12 (forecast/harden)
```

## Cross-cutting (every slice)
- Idempotent, owner-applied SQL; RLS staff-only on POS internals.
- Reuse `audit_logs` for sensitive mutations; reuse `staff_profiles` permissions.
- AI/crawler output drafts-only; employee validates before publish/commit.
- Money in minor units (cents); WA tax handled centrally via `site_settings`.
- Re-pull live WA LCB/CCRS specs before implementing compliance-bound features.

## Recommended starting point
**Slice 1** — it directly answers the owner's stated immediate need (feature-rich pages with
"exactly what's missing" + statistics), carries zero DB risk, and establishes the insight patterns
every later admin screen reuses.
