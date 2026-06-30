# Greenway POS — Feature Checklist (by domain)

> Exhaustive, checkable feature inventory for the POS command center. Each item has a short
> acceptance hint. Items are tagged with the slice that ships them (see `POS_ROADMAP.md`).
> Unchecked = not built yet. This is a living checklist updated as slices land.

Legend: `[S#]` = target slice. All sensitive actions must write to `audit_logs`.

---

## 1. Insight & analytics on existing pages `[S1]`
- [ ] Products page shows total products, % enriched, missing description count, missing image count `[S1]`
- [ ] Products page: missing brand-link, missing COA, missing price, out-of-stock breakdowns `[S1]`
- [ ] Products page: category mix, price range, stock-status distribution stats `[S1]`
- [ ] Vendors page: per-vendor completeness %, product/brand counts, top gaps `[S1]`
- [ ] Vendors page: aggregate stats (published vs draft, avg completeness, vendors missing logo) `[S1]`
- [ ] Brands page: completeness %, product counts, missing logo/about/philosophy `[S1]`
- [ ] "What's missing" actionable lists with deep links per entity `[S1]`
- [ ] Detail pages surface the full completeness breakdown + next-best action `[S1]`

## 2. Customer / patient management `[S2]`
- [ ] Create/edit customer profiles (name, contact, birthdate, consent) `[S2]`
- [ ] Medical patient authorizations (id, issue/expiry, limits) `[S2]`
- [ ] Link loyalty signups + web orders to customer records `[S2]`
- [ ] Customer purchase history view `[S2]` (history populates from `[S8]`)
- [ ] Do-not-contact / marketing consent flags respected `[S2]`
- [ ] PII protected by strict staff-only RLS + audit on access changes `[S2]`

## 3. Age / ID verification & purchase limits `[S8]`
- [ ] 21+ recreational age check at register `[S8]`
- [ ] Medical patient authorization check + expiry enforcement `[S8]`
- [ ] WA daily purchase-limit equivalency math across categories `[S8]`
- [ ] Basket blocks/warns when limit exceeded (config in `site_settings`) `[S8]`

## 4. Roles, permissions & approvals `[S3]`
- [ ] POS permission keys defined on `staff_profiles` (owner/manager/budtender/inventory) `[S3]`
- [ ] Manager-approval workflow primitive (`approval_requests`) `[S3]`
- [ ] Discount override above threshold requires approval `[S8]`
- [ ] Void/return requires approval `[S9]`
- [ ] Every approval recorded with requester + approver + context `[S3]`

## 5. Inventory lots, COA & lineage `[S4]`
- [ ] Inventory lots with lot code, vendor, brand, product ref, expiry, status `[S4]`
- [ ] Lab results (COA) incl. `labtest_external_identifier` (CCRS) + potency/terpenes/pass-fail `[S4]`
- [ ] Inbound manifests captured; lots link to manifest + COA `[S4]`
- [ ] Inventory adjustments with reason codes (shrink/damage/sample/destruction/count) `[S4]`
- [ ] Lot status lifecycle: active / quarantine / recalled / destroyed `[S4]`
- [ ] All adjustments audited + CCRS-reportable `[S4]`

## 6. Purchasing (POs) `[S5]`
- [ ] Create PO; assign vendor; add lines (product, qty, unit cost) `[S5]`
- [ ] PO lifecycle: draft → sent → partial → received → closed → cancelled `[S5]`
- [ ] Vendor terms / lead time / contacts `[S5]`
- [ ] Expected delivery + cost totals `[S5]`

## 7. Receiving & on-hand `[S6]`
- [ ] Receive against PO and/or manifest `[S6]`
- [ ] Partial receiving + backorder tracking `[S6]`
- [ ] Receiving creates inventory lots with cost + COA `[S6]`
- [ ] `inventory_levels` on-hand by item/lot/location `[S6]`
- [ ] Reorder-point / low-stock alerts `[S6]`
- [ ] Expiring-lot alerts (FEFO awareness) `[S6]`

## 8. Cash management `[S7]`
- [ ] Open register session with starting float `[S7]`
- [ ] Paid-in / paid-out / drop / skim movements `[S7]`
- [ ] Blind close (count without expected) + over/short variance `[S7]`
- [ ] Denomination counting helper `[S7]`
- [ ] Vault/safe reconciliation + bank deposit records `[S7]`
- [ ] Multi-drawer / multi-register support `[S7]`
- [ ] Full drawer audit trail `[S7]`

## 9. Selling (the register) `[S8]`
- [ ] Fast cart/basket UI (touch + keyboard) `[S8]`
- [ ] Barcode scanning for items/lots `[S8]`
- [ ] Variant + quantity selection `[S8]`
- [ ] Line + cart discounts (reuse promotions engine) `[S8]`
- [ ] Loyalty attach + redemption `[S8]`
- [ ] WA excise + sales tax (config-driven) `[S8]`
- [ ] Mixed/split tender (cash/debit/loyalty) + change `[S8]`
- [ ] Receipt print / email / SMS `[S8]`
- [ ] Inventory deducts from `inventory_levels` by lot (FIFO/FEFO) `[S8]`
- [ ] Fulfill a web reservation (`orders`) at the register `[S8]`
- [ ] Offline resilience (keep selling during network blips) `[S8]`

## 10. Returns / voids / exchanges `[S9]`
- [ ] Returns with reason codes + manager approval `[S9]`
- [ ] Voids with approval + audit `[S9]`
- [ ] Exchanges `[S9]`
- [ ] Inventory restock on return (with reason) `[S9]`

## 11. Compliance & CCRS `[S10]`
- [ ] CCRS Sales report export `[S10]`
- [ ] CCRS Inventory adjustment report export `[S10]`
- [ ] CCRS Manifest/transfer report (incl. `labtest_external_identifier`) `[S10]`
- [ ] Compliance report jobs tracked (`compliance_reports`) with submitted_at `[S10]`
- [ ] Product recall / hold workflow (lot quarantine) `[S10]`
- [ ] Re-pull live LCB CCRS spec at build time before finalizing exporters `[S10]`

## 12. Dashboards & KPIs `[S11]`
- [ ] Daily sales dashboard (sales, returns, voids, discounts, tax, cash variance) `[S11]`
- [ ] Sales KPIs (ATV, by category, SGR, conversion) `[S11]`
- [ ] Inventory health (turnover, age, stock-outs, shrink, carrying cost) `[S11]`
- [ ] Customer KPIs (CLV, CRR, loyalty participation, new acquisition) `[S11]`
- [ ] Compliance KPIs (return rate, recall freq, batch testing) `[S11]`
- [ ] Date-range filters + drill-down + export `[S11]`
- [ ] No metric shown without a real data source `[S11]`

## 13. Forecasting, optimization & hardening `[S12]`
- [ ] Demand forecasting from sales velocity (drafts-only suggestions) `[S12]`
- [ ] Reorder-point automation + safety stock `[S12]`
- [ ] Cycle-count scheduling + variance reconciliation `[S12]`
- [ ] ABC inventory classification `[S12]`
- [ ] Performance + offline + security review; audit completeness pass `[S12]`

## Cross-cutting acceptance (all slices)
- [ ] New tables idempotent + owner-applied; RLS staff-only on POS internals
- [ ] Sensitive actions write `audit_logs`
- [ ] AI/crawler output drafts-only; employee validates before publish
- [ ] Money in minor units; tax/limits centralized in `site_settings`
