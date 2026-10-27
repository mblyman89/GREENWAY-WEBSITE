# SOP Program — Greenway Concierge Coverage Ledger

Owner: *"keep track of what it knows and what it needs to have included still … the global system wide helpers like the concierge might be lacking in knowledge."*

## 1. How the concierge works today (verified)

| Piece | File | What it does |
|---|---|---|
| Widget | `src/components/admin/ConciergeWidget.tsx` (136 lines) | Floating chat bubble, mounted in `src/app/admin/layout.tsx` |
| Server action | `src/app/admin/concierge-actions.ts` (55 lines) | Calls the assistant |
| Assistant | `src/lib/admin/concierge-assistant.ts` (135 lines) | One `generate()` call. temperature 0.3, **maxTokens 400**, last 6 turns of history |
| Grounding | `src/lib/admin/concierge-kb.ts` (519 lines) | `CONCIERGE_KB`, **33 topics**, rendered by `conciergeGroundingBlock()` |
| Grounding | `src/lib/admin/setup-status.ts` | `setupGroundingBlock()` (first-time setup state) |

It is read-only and advisory. It changes nothing. That is correct and stays.

## 2. Help sources that exist but the concierge cannot see

| Source | Size | Fed to concierge? |
|---|---|---|
| `src/lib/admin/help-content.ts` (Help & FAQ, `/admin/help`) | 34 sections, 1,098 lines | ❌ |
| `src/lib/admin/page-helpers-core.ts` (`/admin/helpers`) | 19 helpers | ❌ |
| `src/lib/catalog/sop-core.ts` (`/admin/sop`) | 10 SOP sheets | ❌ |
| `src/lib/staffing/handbook-content.ts` | Handbook v2.0 | ❌ |
| Page `<HelpPanel>`s | 104 pages | ❌ (inline JSX, not data) |
| Domain mentors (`books-guidance-core`, payroll mentors, `reports-presentation-mentor`) | large | ❌ (owner-only domains, so this is deliberate for now) |

## 3. Coverage by topic (baseline at commit 54445a68)

Legend: ✅ adequate · 🟡 thin (≤3 facts or missing procedures) · 🔴 wrong or missing

| Back-office area | Concierge topic id | Facts | Rating | Gap |
|---|---|---|---|---|
| Register / POS (sales, till, drawer, clock-in at register) | `pos` | 4 | 🔴 | Says "PLANNED, not built" (F-00-1) |
| Register Activity / cash oversight | `registers` | 2 | 🔴 | No count-in, drop, swap, blind close, reconcile, verify, EOD or safe content |
| Store safe / master till | — | 0 | 🔴 | No topic |
| EOD report / Undeposited funds / deposit bags | — | 0 | 🔴 | No topic |
| Returns, voids, no-sale, price override (manager PIN) | — | 0 | 🔴 | No topic |
| Time clock | `time-clock` | 2 | 🟡 | No register clock-in, no PIN rules, no punch edits |
| New hire / onboarding / users & roles | `users` | 3 | 🟡 | No onboarding checklist, PIN setup, handbook gate or role matrix |
| Schedule | — | 0 | 🔴 | No topic |
| Handbook acknowledgment gate | — | 0 | 🔴 | Gate blocks register unlock; concierge can't explain why |
| Receiving intake | `product-intake` | 9 | 🟡 | Journey-level only; no manifest/WCIA steps, quarantine, match |
| Inventory management | `inventory` | 6 | 🟡 | No labels, tags, expiration rules, recall holds, labs |
| Cycle counts / inventory audits | — | 0 | 🔴 | No topic (blind count, owner-only approval) |
| Returns to vendor / destruction | — | 0 | 🔴 | No topic (WAC 314-55-097 hold, CCRS adjustment) |
| Purchasing / POs | (in product-intake) | — | 🟡 | No PO lifecycle, vendor menus (Cultivera/GrowFlow/LeafLink/email) |
| Product enrichment / mastering | (in product-intake) | — | 🟡 | No Bulk AI, Batch Lookups, drafts-only review |
| Vendor enrichment / merge | — | 0 | 🔴 | No topic |
| Knowledge base | `knowledge-base` | 4 | 🟡 | |
| Leafly | `integrations` | 3 | 🔴 | No order ack window, menu sync, order-to-cart |
| Online orders | — | 0 | 🔴 | No pickup flow, announcer, ticket, Leafly orders |
| CCRS | `ccrs`, `compliance-health` | 4+3 | 🟡 | No weekly upload procedure, error triage, records |
| Hardware (printer, scanner, iPad pairing, announcer) | `equipment` | 3 | 🟡 | No pair/re-pair, heartbeat or troubleshooting |
| Creative Studio | `image-generator` | 6 | ✅ | Check against current studio during SOP-11 |
| Merch Studio (garments) | — | 0 | 🔴 | No topic |
| Digital assets / media library | — | 0 | 🔴 | Folded into marketing only |
| Website editors / content schedule | `website-pages` | 4 | 🟡 | |
| Promotions | `promotions` | 2 | 🟡 | |
| Medical | `medical` | 3 | 🟡 | |
| Sales limits | `sales-limits` | 2 | 🟡 | |
| Cleaning / daily checklists | — | 0 | 🔴 | Feature does not exist (F-00-9) |
| SOP library itself | — | 0 | 🔴 | Concierge doesn't know `/admin/sop` exists |

**Baseline score:** 33 topics. 1 ✅, 15 🟡, 15 🔴 + several missing areas.

## 4. Strategy (recorded now, built in the integration phase)

1. **One source of truth per fact.** Each SOP slice writes its SOP as data in a pure `*-core.ts` (the `sop-core.ts` pattern). The concierge grounding is then *generated* from SOP data + `help-content.ts` + `page-helpers-core.ts`, so paper, screen and concierge cannot disagree. Hand-written facts in `concierge-kb.ts` shrink to orientation only.
2. **Retrieval, not one giant prompt.** All SOPs together will exceed what fits in one prompt. Pick the relevant SOP sections by keyword/topic match (a pure ranker, unit-tested) and pass only those. Raise `maxTokens` above 400 for procedural answers.
3. **Role-aware answers.** The concierge should not tell a `staff` user how to approve an audit (owner-only). Ground with the asker's role and filter SOP sections by `permission`.
4. **"Where do I click" links.** Every SOP step carries its `href`, so the concierge can answer with a link.
5. **Freshness test.** A compliance test asserting every `href` in SOP/concierge data is a real `page.tsx` route, and that no topic is `planned` when its route exists. This test would have caught F-00-1.

## 5. Per-slice update rule

At the end of every SOP slice, update §3 above with: (a) the facts the new SOP adds, (b) rating changes, and (c) new gaps found. The concierge code itself is **not** edited until the integration phase (owner: no fixes yet).
