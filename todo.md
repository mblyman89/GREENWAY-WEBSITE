# Command Center Enhancements — Slices 65–80 (build 6 at a time)

Full verbatim list, owner decisions, deep-research log, and finalized roadmap:
see `docs/COMMAND_CENTER_ENHANCEMENTS_TASKLIST.md`.

## BATCH 1 — foundation & high-value UI (existing tables; no external accounts)

### Slice 65 — Nav → top tabs w/ dropdowns [item 16]
- [ ] Ground: AdminSidebar + admin-nav-data + layout + permission gating + current mobile hamburger
- [ ] Core: pure grouping/active-tab logic + tests
- [ ] Build: top tab bar with grouped dropdown menus (keep perms + mobile)
- [ ] Verify: tsc 0, eslint 0, next build ok
- [ ] Commit → push → PR → merge → sync main

### Slice 66 — Site Content page: all pages [item 9]
- [ ] Ground: /admin/content hub + which pages are listed vs which exist on live site
- [ ] Build: add Blog + legal/info pages (Consumer Health Data, Privacy Policy, Terms of Use, Unsubscribe, Vendor Delivery); group sensibly; exclude transactional Checkout
- [ ] Verify + Commit → push → PR → merge → sync main

### Slice 67 — Loyalty customizer [item 2]
- [ ] Ground: loyalty_config/tiers/promotions tables + existing /admin/loyalty
- [ ] Build: full editor (earn rate, point value, min redeem, signup bonus, expiry, tiers, promos) + live preview + audited actions
- [ ] Verify + Commit → push → PR → merge → sync main

### Slice 68 — Cycle counts barcode + hardening [item 3]
- [ ] Ground: cycle_counts/lines/adjustment tables + existing page
- [ ] Build: barcode scan (USB wedge + camera), blind-count, variance flags, session lock, audit
- [ ] Verify + Commit → push → PR → merge → sync main

### Slice 69 — Schedule builder [item 4]
- [ ] Ground: shifts table + staffing page
- [ ] Build: week grid create/copy/publish scheduled shifts per employee/role + coverage view
- [ ] Verify + Commit → push → PR → merge → sync main

### Slice 70 — Phone clock-in + hour adjustments [item 8]
- [ ] Ground: employees/time_punches + staffing actions
- [ ] Build: mobile self clock in/out (PIN) + owner/manager punch edit w/ reason + audit
- [ ] Verify + Commit → push → PR → merge → sync main

## BATCH 2 — AI enrichment, compliance, marketing, seeds, mobile
- [ ] Slice 71 — Sample compliance WAC 314-55-096 (hard blocks) [item 6]
- [ ] Slice 72 — Midjourney prompt builder + media overhaul [items 7+17]
- [ ] Slice 73 — Sage 50 KB enrichment + Chart of Accounts upload [items 1+13]
- [ ] Slice 74 — Manifest pipeline pending/in-transit/awaiting-intake [item 10]
- [ ] Slice 75 — KB seed coverage + owner uploads [item 14]
- [ ] Slice 76 — Mobile-friendly pass [item 15]

## BATCH 3 — money movement & customer AI
- [ ] Slice 77 — Vendor ACH: banking + approval model [items 5/11]
- [ ] Slice 78 — Vendor ACH: NACHA batch generation [items 5/11]
- [ ] Slice 79 — Customer-facing AI concierge [item 18]
- [ ] Slice 80 — Customer AI knowledge seeding [item 18 cont.]

- OUT OF SCOPE: item 12 (employee ACH payroll) — owner uses Sage.
