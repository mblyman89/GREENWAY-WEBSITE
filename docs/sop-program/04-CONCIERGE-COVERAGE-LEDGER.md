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

## 6. Slice log

### SOP-01 Register Operations (`docs/sop/SOP-01-register-operations.md`, verified at `d03fe15b`)

Concierge code is **unchanged** (record-only). What SOP-01 now provides as source material for the integration phase:

| Concierge topic | SOP-01 sections that ground it | Rating today → after integration (target) |
|---|---|---|
| `pos` (replace "planned") | §4.1–4.24, §4.31–4.34, §5 (every block message: why, what to do, who to call), §9 quick card | 🔴 → ✅ |
| `registers` | §4.3, §4.25–4.30 (count-in, drop, swap, blind close, X/Z, reconcile, verify, related pages) | 🔴 → ✅ |
| *new* `register-messages` (message lookup) | §5.1–5.9, 100+ exact messages | — → ✅. This is the highest-value concierge use: "the register says X, what do I do?" |
| *new* `discounts-at-register` | §4.11–4.14 (six kinds, one-reward rule, best deal wins, floors, PIN matrix) | — → ✅ |
| *new* `returns-voids-nosale` | §4.21–4.24 | 🔴 → ✅ |
| `time-clock` | §4.2 (register clock-in, offline punches) | 🟡 → 🟡 (SOP-05 finishes it) |
| Handbook gate | §4.1, §5.1 | 🔴 → 🟡 (SOP-05/SOP-06 finish it) |
| `medical`, `sales-limits` | §4.6, §4.10, §7 | 🟡 → 🟡 (SOP-19 finishes them) |
| Online orders (register handover only) | §4.20 | 🔴 → 🟡 (SOP-13 finishes it) |

**Role filter needed (strategy item 3):** §4.30 (reconcile/verify) is for `inventory.manage` only. The concierge must not walk a `staff` user through it, only tell them "ask a manager to sign off" (which is what the page itself says).

**Must ship with caveats:** the concierge has to repeat the SOP's known-problem warnings (F-01-3 "expected $0.00", F-01-5 "leave Reconciled by blank", F-00-3 "paper slip is the record") until those findings are fixed. Otherwise it will give advice that fails.

**Running score:** topics with complete SOP source material: `pos`, `registers`, plus 3 proposed new topics. The concierge itself is still at the baseline until the integration phase.

### SOP-02 Master Till / Store Safe (`docs/sop/SOP-02-master-till-safe.md`, verified at `0055f06c`)

Concierge code is **unchanged** (record-only). Today the concierge and `help-content.ts` have **no** master till / safe content. The `registers` help entry (L227–262) does not mention the Store safe page, the $1,000 target, the AM/PM counts or the little safe (finding **F-02-12**). What SOP-02 now provides as source material for the integration phase:

| Concierge topic | SOP-02 sections that ground it | Rating today → after integration (target) |
|---|---|---|
| *new* `master-till` (Store safe page) | §4.1 (where the money lives), §4.2 (the D11 $1,000 standard by denomination), §4.3–4.7 (open the page, AM/PM/Extra counts), §4.8 (Balanced/Over/Short), §4.9 (mix check), §4.16–4.18 (history, corrections, print), §8.1/8.6 forms, §9 quick card | — → ✅ |
| *new* `little-safe` (D3 exchanges) | §4.10, form §8.2 | — → ✅ |
| `registers` (addition) | §4.11 (register change swaps, master till side, $200 cap), §4.12 (drops are not in the master till), §4.14 (three till floats, D10 $167.50), §4.15 (safe section of the EOD report), §5.2 messages | 🔴 → ✅ (together with SOP-01) |
| `register-messages` (addition) | §5.1 Store safe page messages, §5.2 swap messages | — → ✅ |
| Petty cash / supply runs | §4.13, form §8.4 (no screen today, F-02-11 / G-11; screen approved D17) | 🔴 → 🟡 → ✅ once G-11 is built |

**Role filter needed (strategy item 3):** recording safe counts and swaps needs `inventory.manage` (`safe/actions.ts` L29). The concierge must not walk a `staff` user through submitting a count. It should tell them "a manager records the count" and note that staff can see the Safe/EOD buttons but are refused (F-02-10).

**Must ship with caveats** until the findings are fixed:
- ~~F-02-2~~ withdrawn in SOP-03 (D19): the Manager Till float **is** $300.00, and the system agrees. The concierge should say "sales tills $167.50, Manager Till $300.00".
- F-02-3: the page does not compare the mix to the D11 standard, so use the §4.2 table.
- F-02-5: only the newest AM/PM count shows on the EOD report, and the window defaults to AM, so pick the right one.
- F-02-7: do **not** count drops or the little safe into the master till, whatever the page help text and placeholder say.
- F-02-1: drops are not posted to the books (accounting only, not floor advice).

**Running score:** topics with complete SOP source material: `pos`, `registers`, `master-till`, `little-safe`, plus the SOP-01 proposed topics. The concierge itself is still at the baseline until the integration phase.

### SOP-03 End-of-Day Close & Deposit Bag (`docs/sop/SOP-03-eod-close-deposit.md`, verified at `3385bfa9`)

Concierge code is **unchanged** (record-only). Today neither the concierge nor `help-content.ts` has **any** end-of-day or deposit-bag content. The only "deposit" hits are payroll direct deposit (`help-content.ts` L725–742; `concierge-kb.ts` L262–280), so a question like "how do I do the deposit?" risks a payroll ACH answer (finding **F-03-11**). The Registers page help (L117–120) still says sales shown are online pickup only (F-03-4). What SOP-03 now provides as source material for the integration phase:

| Concierge topic | SOP-03 sections that ground it | Rating today → after integration (target) |
|---|---|---|
| *new* `end-of-day` (night close and the EOD report) | §4.1 (what goes in the bag; the float stays), §4.2 timeline, §4.3–4.5 (close drawers, pull takings, night sheet), §4.7 reconcile, §4.8–4.9 (read and print the EOD report, `?day=`), §4.16 (no-sales days), §5 messages, form 8.1 part A, 8.3, 8.5, §9 quick card | 🔴 → ✅ |
| *new* `deposit-bag` (morning recount, seal, bag log, bank run) | §4.6 (unsealed overnight), §4.10–4.11 (recount, seal, log), §4.13 bank day, §4.14 ($10,000 line), forms 8.1 parts B/C, 8.2, 8.4, 8.6 | 🔴 → 🟡 (paper only) → ✅ once G-04 is built |
| `registers` (addition) | §4.4 floats ($167.50 sales tills, $300.00 Manager Till, D19), §4.8 EOD report columns | 🔴 → ✅ (with SOP-01/02) |
| Disambiguation | "deposit" means the **cash deposit bag** in register/safe context and **payroll direct deposit** only in payroll context | — → ✅ |

**Role filter needed (strategy item 3):**
- The EOD report, reconcile and the Verify till are `inventory.manage` only, and the books side (`/admin/books/bank`, Undeposited Funds) is owner/bookkeeper only (`requireBooksAccess`). For staff the concierge covers only the counting steps any employee does: night sheet part A, morning recount part B and seal part C, per SOP-03 §2.
- Banking (form 8.6) is the owner's (Q-03-5).

**Must ship with caveats** until the findings are fixed:
- F-03-1: do **not** trust the Undeposited Funds panel's green "all matched". Use the bag log and the safe.
- F-03-6: EOD "Gross" is **not** cash. Use the Z report's net figure.
- F-03-5: the EOD print has no deposit figure or second signature. The night sheet is the record.
- F-03-7: "No drawer sessions" may be a failed read. Reload, then use the close slips.
- F-03-8: to see another day, add `?day=YYYY-MM-DD`; a typo silently shows today.
- F-00-3: the Verify till records $0. The paper slip is the record (from SOP-01/02).
- The bag screen does not exist (F-00-6 / G-04), so never tell anyone to "seal the bag in the app".

**Running score:** topics with complete SOP source material: `pos`, `registers`, `master-till`, `little-safe`, `end-of-day`, plus the SOP-01 proposed topics; `deposit-bag` is paper-only. The concierge itself is still at the baseline until the integration phase.

### SOP-04 Receiving Intake & Monthly CCRS Public Records Request (`docs/sop/SOP-04-receiving-intake.md`, verified at `5299660b`)

Concierge code is **unchanged** (record-only). Today the concierge's `product-intake` topic (`src/lib/admin/concierge-kb.ts` L132–148) is journey-level only. Its one Receiving fact is the transport-manifest details. The `ccrs` topic (L349–360) covers the weekly upload and the LIQ-1295 only. Nothing covers dock counting, refusing lines, Finalize, held lots, the monthly public records request or the zip drop (finding **F-04-C**). The in-app SOP sheets in `src/lib/catalog/sop-core.ts` and the Receiving help panel describe the pre-R31 flow (F-04-5), so they **must not** be used as grounding. What SOP-04 now provides as source material for the integration phase:

| Concierge topic | SOP-04 sections that ground it | Rating today → after integration (target) |
|---|---|---|
| `product-intake` → split out *new* `receiving` (truck day) | §4.1 pipeline, §4.3 morning list check, §4.4–4.5 email and manual import, §4.6 staged manifest, §4.7 duplicates/overdue, §4.8 transport details, §4.9 count every line, §4.10–4.12 refusals, §4.11 short counts (interim rule), §4.17–4.18 Finalize and result banner, §5.1–5.2 messages, forms 8.1, 8.2, 8.5, §9 quick card | 🟡 → ✅ (🟡 for short counts until G-16 is built) |
| `receiving` (after the truck) | §4.13 trade samples and quarterly cap, §4.14 vendor inventory ids, §4.15 COAs, §4.16 PO link, §4.19 Issues tab and held lots, §4.20 Accounting tab, §4.21 lot labels, §4.24 vendor follow-up, form 8.3 | 🔴 → ✅ |
| `product-intake` (Onboarding addition) | §4.22 Product Onboarding, §4.23 "looks like more than one card" | 🟡 → ✅ |
| *new* `ccrs-records-request` (monthly PRR → benchmarks) | §4.25 why, §4.26 timeline, §4.27 file the request (wording, phone **664-1753**), §4.28 track, §4.29 store the zip untouched, §4.30 competitor roster first, §4.31 zip drop (up to ~1.5 h, keep the tab open), §4.32 check the dataset, §4.33 read the benchmarks, §4.34 redo/remove/off, §5.3 messages, form 8.4 | 🔴 → 🟡 (paper reminder only) → ✅ once G-18 is built |
| `ccrs` (addition) | Disambiguation: the **weekly CCRS upload** (outbound report) vs the **monthly public records request** (inbound state data for benchmarks); §4.14 vendor inventory ids feed the weekly report | 🟡 → ✅ |

**Role filter needed (strategy item 3):**
- Any trained employee may **count** at the dock on paper (form 8.1). All Receiving screen work, including Finalize, is `inventory.manage` (owner/admin/manager). For staff the concierge covers only the counting and refusal-noting steps, per SOP-04 §2.
- The zip drop, competitor roster and Statewide Benchmarks are `inventory.manage`. Reports → Benchmarks is `reports.view`. The Discovery switch is `settings.manage`.
- Filing the monthly records request is the **admin's** job, on the 10th (D32). Only managers process manifests (D30). Accounting review (Waiting to Post) is `books.view` (owner).

**Must ship with caveats** until the findings are fixed:
- F-04-2: the lot page's "Lifecycle status" skips the go-live check and writes no audit row. A manager may set a held lot Active **only** from an Issues row that says "now clear", logged on paper (SOP-04 §4.19). Never advise setting any other lot Active that way.
- F-04-1: there is no partial-quantity receive. Follow the interim short-count rule (§4.11) and log it on form 8.2.
- F-04-3: an undecided line is **accepted** on Finalize. Decide every line first (form 8.5).
- F-04-4: a vendor email that failed to stage does not appear on the Receiving list. If a truck is expected and no manifest is staged, use the manual import (§4.5).
- F-04-13: the WSLCB public records phone on the CCRS page (…664-1769) is wrong. Use **(360) 664-1753**.
- F-04-14 / F-04-17: ignore the page's per-file CSV steps and "a few minutes". Drop the single monthly zip and allow up to ~1.5 h.
- F-04-15 / F-04-16: on monthly-zip datasets do **not** press Generate vendor leads, Enrich KB, Compute or Delete. Delete has no confirmation.
- F-04-20: there is no "turn Discovery off" control on any screen. Never tell anyone to switch it off in the app.
- F-04-5: never quote the in-app SOP sheets or the Receiving help panel for receiving steps.

**Running score:** topics with complete SOP source material: `pos`, `registers`, `master-till`, `little-safe`, `end-of-day`, `receiving`, `product-intake` (receiving and onboarding portion), plus the SOP-01 proposed topics. `deposit-bag` and `ccrs-records-request` are paper-reminder only. The concierge itself is still at the baseline until the integration phase. Baseline rows touched: Receiving intake 🟡 and CCRS 🟡 (§3), both unchanged in code.

**SOP-05a update to the SOP-04 row (owner answers D29–D34).**
- **New facts for `receiving`:** a second count is strongly recommended and expected on a vendor's first delivery (D31). Short lines are still refused whole until G-16 is built (D29, now serious).
- **New facts for `ccrs-records-request`:**
  - The admin files on the 10th using the built-in text; each month arrives as its own zip and is dropped one at a time (D32).
  - Months are kept 18 months from the end of the data month, then removed with owner approval (D33).
  - On monthly cards, Generate vendor leads and Enrich KB do nothing. Point people to **Draft vendor leads from these suppliers** (D34).
- **Standing-request answer must be sourced:** WAC 44-14-04004(4) says an agency need not supply records created after the request. The concierge must not promise that the WSLCB will honor a standing request.

