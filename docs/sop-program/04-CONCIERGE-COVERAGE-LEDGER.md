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

6. **Owner requirement: cover every feature, now and future** (decision D42, slice SOP-05b: *"I want to upgrade the concierge to use all features including future ones we will build after the sop is finished."*). The concierge upgrade starts **after the last SOP is written**. Its scope:
   - (a) points 1–5 above;
   - (b) every SOP, every help panel, every page helper and every SOP sheet as sources;
   - (c) a **feature registry**: one entry per back-office feature, with its route, permission, SOP section and concierge facts. The freshness test (point 5) fails the build when a route has no entry. A feature built **after** the upgrade therefore cannot ship without its concierge entry;
   - (d) when a gap is fixed, the same change updates the SOP and the concierge entry (charter §3 rule 9, decision D41).

   The concierge stays **read-only and advisory**. It explains features; it does not run them.

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

**Must ship with caveats:** the concierge has to repeat the SOP's known-problem warnings (F-01-3 "expected $0.00", F-01-5 "leave Reconciled by blank", F-00-3 "paper slip is the record") until those findings are fixed. Otherwise it will give advice that fails. *(Phase 2.1: F-01-3 FIXED and the reconcile part of F-01-5 FIXED, so those two caveats are retired; the `registers` entry in `concierge-kb.ts` now explains the system figure. F-00-3 and "leave Verified by blank" still apply.)*

**Phase 2.1 (G-05 per-drawer figure) answers, managers only (`inventory.manage`):**

| Question | Answer (built, Phase 2.1) |
|---|---|
| How do I work out cash sales at reconcile? | You don't. The Reconcile card shows the drawer's system figure: sales on this drawer, rounding, employee tab, cash sales, refunds paid from this drawer, drops, expected, counted, over/short (SOP-01 §4.30) |
| Why is the Reconcile button greyed out? | The red box **Reconcile waits until:** lists what the system cannot know yet: a sale still processing, a refund not tied to a drawer or the safe, a read that did not finish, or no opening count (§4.30 step 3) |
| A refund says "not tied to a drawer" | Pick the drawer it was paid from (or **Store safe**) under **Paid from…** and tap **Tie refund**; check the close slips and receipts first, never guess (§4.30 step 4) |
| Who is recorded as the reconciler? | You, the signed-in manager (no name box any more) (§4.30 step 5) |
| Do I still need an X report when a register has two drawers? | No; each sale carries its drawer, so each drawer's figure is exact (SOP-01 §4.27 step 9) |
| At the Returns desk, what is "Cash paid from"? | The open register drawer you take the refund out of, or **Store safe**; required, never defaulted (SOP-15 §4.5 step 7) |

**Phase 2.2 (G-01 second-person count) answers, every register user:**

| Question | Answer (built, Phase 2.2) |
|---|---|
| Who does the second count at close? | **Any** other employee (owner D2: *"close only, and it can be any second employee"*), never the closer; not needed at count-in (SOP-01 §4.27 step 9) |
| How do I close now? | Count, enter tips and your PIN, tap **Next: second count**, hand over the iPad; the second person counts blind, types their PIN, taps **Record blind count & close** (§4.27 steps 8–11) |
| It says the second count must be a different employee | You typed the closer's PIN in the second box; hand it to someone else (§4.27 step 9) |
| The two counts differ | Warning only: the drawer is closed, both counts are saved, over / short uses the closer's count; tell a manager, who sees both on the Reconcile card (§4.27 step 12, §4.30) |
| The iPad will not close and asks for a second employee but shows no second step | That iPad runs an older app build; close from the browser register or the back office and tell the owner (§4.27, "The iPad app must be updated") |
| Closing the Manager Till from the back office | Pick **Counted by**, then the second person fills **Second count (required)** and their PIN (§4.27 "Closing from the back office") |

**Phase 2.3 (G-03 over/short warnings) answers, managers (reconcile, safe) and owner/admin (warnings screen):**

| Question | Answer (built, Phase 2.3) |
|---|---|
| When do I have to write a reason? | Only when the drawer or the master till is **more than $5.00** over or short (owner D7, D21); at $5.00 or less it is optional (SOP-01 §4.30 step 6, SOP-02 §4.8) |
| Reconcile says the drawer is short by more than $5.00 and nothing was saved | Write why it is over or short in the reason box and tap Reconcile again; the server checks its own figure, so the box is needed even if the page looked fine (SOP-01 §4.30 step 6) |
| Does a warning stop anything? | No. Warnings only: the drawer reconciles and the count saves; the owner sees it on the warnings screen |
| Where are the warnings? | **Employee → Over / Short Warnings** (owner and admin only), or the **Over / short warnings** button on Register Activity: who counted, who signed off, when, how much, the reason, with a link to the record (SOP-01 §4.30, SOP-02 §2) |
| The master till count says pick who counted | **Counted by** is required now; pick the employee who actually counted (SOP-02 §4.5 step 10) |
| The warnings screen says the reason column is missing | Migration 0315 is not applied yet; reasons are still required and kept in the audit log. Tell the owner |

**Running score:** topics with complete SOP source material: `pos`, `registers`, plus 3 proposed new topics. The concierge itself is still at the baseline until the integration phase.

### SOP-02 Master Till / Store Safe (`docs/sop/SOP-02-master-till-safe.md`, verified at `0055f06c`)

Concierge code is **unchanged** (record-only). Today the concierge and `help-content.ts` have **no** master till / safe content. The `registers` help entry (L227–262) does not mention the Store safe page, the $1,000 target, the AM/PM counts or the little safe (finding **F-02-12**). What SOP-02 now provides as source material for the integration phase:

| Concierge topic | SOP-02 sections that ground it | Rating today → after integration (target) |
|---|---|---|
| *new* `master-till` (Store safe page) | §4.1 (where the money lives), §4.2 (the D11 $1,000 standard by denomination), §4.3–4.7 (open the page, AM/PM/Extra counts), §4.8 (Balanced/Over/Short), §4.9 (mix check), §4.16–4.18 (history, corrections, print), §8.1/8.6 forms, §9 quick card | — → ✅ |
| *new* `little-safe` (D3 exchanges) | §4.10, form §8.2 | — → ✅ |
| `registers` (addition) | §4.11 (register change swaps, master till side, $200 cap), §4.12 (drops are not in the master till), §4.14 (three till floats, D10 $167.50), §4.15 (safe section of the EOD report), §5.2 messages | 🔴 → ✅ (together with SOP-01) |
| `register-messages` (addition) | §5.1 Store safe page messages, §5.2 swap messages | — → ✅ |
| Petty cash / supply runs | §4.13 (screen built, Phase 2.7c; form §8.4 is the paper backup) | ✅ (G-11 BUILT) |

**Role filter needed (strategy item 3):** recording safe counts and swaps needs `inventory.manage` (`safe/actions.ts` L41). The concierge must not walk a `staff` user through submitting a count. It should tell them "a manager records the count" and note that staff can see the Safe/EOD buttons but are refused (F-02-10).

**Must ship with caveats** until the findings are fixed:
- ~~F-02-2~~ withdrawn in SOP-03 (D19): the Manager Till float **is** $300.00, and the system agrees. The concierge should say "sales tills $167.50, Manager Till $300.00".
- F-02-3: the page does not compare the mix to the D11 standard, so use the §4.2 table.
- F-02-5: only the newest AM/PM count shows on the EOD report, and the window defaults to AM, so pick the right one.
- F-02-7: do **not** count drops or the little safe into the master till, whatever the page help text and placeholder say.
- ~~F-02-1: drops are not posted to the books~~ **FIXED (Phase 2.4):** the close entry books drops to the safe (accounting only, not floor advice).

**Phase 2.4 (G-12 post drops) answers, owner and bookkeeper:**

| Question | Answer (built, Phase 2.4) |
|---|---|
| Are cash drops in the books? | Yes, from Phase 2.4. When the drawer is reconciled, the close entry moves the takings **and** the drops to 10100 (the safe) and relieves 10110 Tills by the same (SOP-02 §4.12) |
| Why does 10110 Tills look high for older days? | Drawers reconciled before Phase 2.4 posted without their drops; those entries are not re-posted. New reconciles include drops |
| Do staff do anything differently? | No. Drop as before (SOP-01); the books change only at reconcile |
| What does the close line say? | *"Cash from Register 1 to safe (incl. $200.00 dropped during the shift)"* when there were drops |

**Running score:** topics with complete SOP source material: `pos`, `registers`, `master-till`, `little-safe`, plus the SOP-01 proposed topics. The concierge itself is still at the baseline until the integration phase.

**Phase 2.7a (G-08 mix standard, G-13 any-employee count, G-09 printable sheet) answers:**

| Question | Answer (built, Phase 2.7a) |
|---|---|
| Can I record the master till count with a staff login? | Yes (D15). Any back-office login opens Register Activity → **Safe** and saves the count; the counter types **their own PIN** in **Counted by: your PIN (required)** (SOP-02 §2, §4.5) |
| It says "No active employee has that PIN" | Wrong PIN, or the employee is not active. Re-enter carefully; repeated wrong PINs lock the pad for a short time. Nothing was saved |
| What is the standard mix? | 32 × $10, 64 × $5, 318 × $1, 95 × 25¢, 120 × 10¢, 100 × 5¢, 125 × 1¢ = $1,000.00 (D11). The grid shows **Standard** and **Diff** under every box (SOP-02 §4.2) |
| It says Balanced but Mix off | The total is right but the denominations are not. Balance with the little safe and log both sides on form 8.2 (SOP-02 §4.9–4.10) |
| The window says PM in the morning | It starts on the next count due: AM until today's AM is saved, then PM, then Extra. Check it before saving (SOP-02 §4.5–4.6) |
| Where are older counts? | Managers: **Count history**, pick **From** / **To** (up to 366 days) (SOP-02 §4.16) |
| How do I print the master till sheet? | Managers: **Printable sheet (to)** on the Store safe page, or **Master till sheet for this day** on the end-of-day report, then **Print**; sign the three lines; attach form 8.2 (SOP-02 §4.18) |
| Does the end-of-day report show the mix? | Yes: each AM / PM line ends with *"mix on standard: yes"* or *"no"* (SOP-02 §4.15) |

The caveats *"F-02-3: the page does not compare the mix to the D11 standard, so use the §4.2 table."* and *"F-02-7: do **not** count drops or the little safe into the master till, whatever the page help text and placeholder say."* above are **retired** by Phase 2.7a (the rule stays: drops never go in the master till; the page now says so). The caveat *"F-02-5: only the newest AM/PM count shows on the EOD report, and the window defaults to AM, so pick the right one."* is **partly retired**: the window no longer defaults to AM, but the EOD still shows only the newest count. The role-filter note *"The concierge must not walk a `staff` user through submitting a count."* is **retired**: staff may record a count (D15); history, sheet and export stay manager-only. The answer *"The master till count says pick who counted"* (Phase 2.3) is replaced by the PIN answer above. `concierge-kb.ts` `registers` carries the Phase 2.7a fact.

**Phase 2.7b (G-02 little safe exchange and register swap bills) answers:**

| Question | Answer (built, Phase 2.7b) |
|---|---|
| How do I record a little safe exchange? | Register Activity → **Safe** → **Little safe exchange**: enter **OUT of master till → little safe** (the big bills) and **IN from little safe → master till** (the small bills and coin) by denomination, type your PIN in **Done by**, then **Record exchange** (SOP-02 §4.10) |
| Record exchange is greyed out | The two sides are not the same value yet. The line above the button says which side is more. Recount both sides |
| Who can record an exchange? | Any employee with a back-office login and their own PIN (D3, D15). Managers see the **Little safe exchanges** log |
| Do we track how much is in the little safe? | No (D3). Only each exchange is recorded |
| It says the exchange log is not set up yet | Migration 0317 has not been run. Use paper form 8.2 and tell the owner (SOP-02 §4.10) |
| The register change swap asks for bills | From Phase 2.7b: **Big bills to the safe (from this till)** and **Change back (from the master till)**, each the same value as the swap (SOP-01 §4.26, SOP-02 §4.11) |
| The register swap does not ask for bills | That iPad app was built before Phase 2.7b; the swap saves as value only. Fill in form 8.3 and ask the owner to rebuild the iPad app |
| Where do exchanges show on the master till sheet? | The printable sheet has a **Master till ↔ little safe exchanges** section, and the CSV / Excel export an **Exchanges** sheet (SOP-02 §4.18) |

The Phase 2.7a answers *"Balance with the little safe and log both sides on form 8.2 (SOP-02 §4.9–4.10)"* and *"sign the three lines; attach form 8.2 (SOP-02 §4.18)"* are **superseded**: record the exchange on the Store safe page; form 8.2 is only the paper backup when the page is down or migration 0317 has not been run. `concierge-kb.ts` `registers` carries the Phase 2.7b fact.

**Phase 2.7c (G-11 supply-run screen) answers:**

| Question | Answer (built, Phase 2.7c) |
|---|---|
| Someone needs cash for supplies | Use the shop card first. If it cannot be used: Register Activity → **Supply runs** → **Cash out of the master till (two PINs)**: amount, **Why not the shop card**, the taker's PIN, then a manager or lead's PIN (not the taker). **Record cash out** (SOP-02 §4.13) |
| They came back with a receipt and change | On **Supply runs**, find the open run: enter **Receipt total**, **Change handed back**, **What the receipt was for**, and the PIN of the employee who counted the change (not the taker). Receipt + change must equal the cash taken. Press **Settle**. Receipt to the owner the same day |
| The receipt is more than the cash taken | The screen refuses: that is money owed TO the employee. Give the receipt to the owner to pay (SOP-02 §4.13) |
| Receipt + change does not add up | The screen says how much is missing or too much. Recount; if money really is missing, give the receipt and change to the owner the same day and write it on form 8.4 |
| The master till is short and a supply run is open | Expected: the Store safe page says how much is out with employees. It counts short until the run is settled |
| It says NOT POSTED | The record is kept. Press **Post to the books** on that run (the cash out first, then the settle) |

The SOP-02 answer *"Until the screen exists, use form 8.4"* (§4.13, v1.7) and the row *"§4.13, form §8.4 (no screen today, F-02-11 / G-11; screen approved D17)"* are **superseded**: record supply runs on the screen; form 8.4 is only for when the page is down or migration 0318 is not applied.

### SOP-03 End-of-Day Close & Deposit Bag (`docs/sop/SOP-03-eod-close-deposit.md`, verified at `3385bfa9`)

Concierge code is **unchanged** (record-only). Today neither the concierge nor `help-content.ts` has **any** end-of-day or deposit-bag content. The only "deposit" hits are payroll direct deposit (`help-content.ts` L725–742; `concierge-kb.ts` L265–283), so a question like "how do I do the deposit?" risks a payroll ACH answer (finding **F-03-11**). The Registers page help (L117–120) still says sales shown are online pickup only (F-03-4). What SOP-03 now provides as source material for the integration phase:

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

**Phase 2.5 (G-14 deposit-to-bank books) answers, owner only:**

| Question | Answer (built, Phase 2.5) |
|---|---|
| Where do I clear a bank deposit? | Books → Bank, section **Clear store cash deposits against the sealed bags**: press **Clear against bags** on the deposit line (owner only; SOP-03 §4.13) |
| Why does it say "Nothing is sitting in Undeposited Funds"? | Cash reaches 10400 only when a bag is sealed in the app, and the bag screen comes in Phase 2.6. Until then every press is refused and nothing is written; keep the bank receipt with the bag log |
| Which lines can be cleared? | Money in on the account marked **Main operating**, last 60 days. Never a transfer between your own accounts, an ATM settlement or money you put in yourself |
| What if I press it twice? | Nothing is written twice; the line shows **cleared** |
| Can I trust the green box on the EOD panel? | It now says what it means: every **sealed bag** in the books has been matched. Unsealed cash in the safe is not counted there; use the bag log and the safe (SOP-03 §4.15) |

The caveat *"F-03-1: do not trust the Undeposited Funds panel's green 'all matched'"* above is narrowed: the wording is fixed; the panel still counts sealed bags only. `concierge-kb.ts` `registers` carries the Phase 2.5 fact.

**Phase 2.6a (G-04 deposit bag screen, G-14 seal) answers:**

| Question | Answer (built, Phase 2.6a) |
|---|---|
| Where do I record the deposit bag? | Register Activity → **Deposit bags** (SOP-03 §4.5) |
| Who counts at night? | One person (D24). Enter the count by denomination, the pre-printed **Bag #** and your PIN, tap **Save night count**; the bag stays unsealed in the safe (D23) |
| Can I do the morning recount if I counted last night? | No. A different employee must; the server refuses your PIN and logs the attempt (D24; SOP-03 §4.10) |
| Why can't I see last night's figure? | The recount is blind; the screen shows it after you save (SOP-03 §4.10 step 2) |
| The counts differ — what now? | $5.00 or less: nothing more. Over $5.00: recount with the manager, then write the reason; both counts are kept (D21) |
| Who can seal? | Anyone, with their own PIN, after the recount (D25). The seal posts 10400 up / 10100 down |
| It says NOT POSTED | The bag is sealed but the books entry failed. Tap **Post to the books**; it never books twice |
| Who takes the bags to the bank? | Only the owner (D25), who records the bank run on the same screen, ticking every sealed bag |
| Does an unrecounted bag stop the till close? | No. It shows a gold warning on Register Activity only (D27) |
| Can I print or export the bag log? | Yes: **Deposit bag log** → print, or **Download CSV** (SOP-03 §4.17) |

The caveat *"The bag screen does not exist (F-00-6 / G-04), so never tell anyone to 'seal the bag in the app'"* above is **retired** by Phase 2.6a. `concierge-kb.ts` `registers` carries the two Phase 2.6 facts.

**Phase 2.6b (G-15 end-of-day sheet) answers:**

| Question | Answer (built, Phase 2.6b) |
|---|---|
| How do I see an earlier day's end-of-day report? | Register Activity → **End-of-day report**, pick the day in **Business day**, tap **Show day** (SOP-03 §4.8) |
| I typed a wrong date and it shows an error | Correct: a bad date is never replaced by today. Use the date picker |
| How much should be in the bag? | **Deposit: what goes in the bag** → **Expected deposit** (closing count − float + drops, per till) |
| Is Gross sales the cash I should have? | No. Use **Net cash from sales** in **Cash check (refunds taken off)**: cash sales minus refunds paid from drawers |
| Why is Net cash a dash? | A refund is not tied to a drawer or the safe, or a record could not be read; the reason is under it |
| Why does the bag say "hidden until the morning recount"? | So the printed report does not spoil the blind recount (D24). It shows once the recount is saved |
| Who signs the report? | The night closer (**Night count, prepared by**) and, after the recount, a different morning employee (**Morning recount and verify**) |
| It says "This report may be incomplete. Do not file it." | A record failed to read. Reload; still failing → tell the owner, use the close slips. Export is off until it reads |
| Can I export the end-of-day report? | Yes: **Export: CSV · Excel**, six sheets (Deposit, Cash check, Refunds, Bag, Sales, Signatures) (SOP-03 §4.9) |
| Can I export the master till sheet? | Yes, from Phase 2.7a: Store safe → **Count history** → **CSV** / **Excel**, or the printable sheet (see below) |

The caveats F-03-6 (*"Use the Z report's net figure"*), F-03-5 (*"The night sheet is the record"*), F-03-7 (*"'No drawer sessions' may be a failed read"*) and F-03-8 (*"a typo silently shows today"*) above are **retired** by Phase 2.6b. `concierge-kb.ts` `registers` carries the Phase 2.6b fact.

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

### SOP-05a Inventory Core (`docs/sop/SOP-05a-inventory-core.md`, verified at `ac251766`)

Concierge code is **unchanged** (record-only). Today the concierge's `inventory` topic (`src/lib/admin/concierge-kb.ts` L163–181) has six one-line facts: lots and COAs, Other Inventory, Vendors & Brands, Types & Categories, Cycle Counts and Returns & Destruction. Nothing covers recalls, expiry, adjustments, lot status, the 86, restore to sale, tags, labs, labels or bulk fill (finding **F-05a-C**). The Inventory help panel is partly stale (F-05a-12), so it **must not** be used as grounding. What SOP-05a now provides:

| Concierge topic | SOP-05a sections that ground it | Rating today → after integration (target) |
|---|---|---|
| `inventory` (expand) | §4.1–§4.3 screens and statuses, §4.4 daily Issues check (every row and its fix), §4.5 lot page, §4.21 corrections, §5.1 messages, form 8.3 | 🟡 → ✅ |
| *new* `inventory-adjustments` | §4.6–§4.7 (procedure, reason → CCRS table, E13, forbidden reasons, theft/seizure), form 8.2 | 🔴 → ✅ (with caveats until G-23) |
| *new* `recalls` | §4.10 placing and releasing a hold, §4.11 register behaviour and messages, §4.13 the written plan, §6 rows, forms 8.4–8.5, WAC 314-55-225 quotes | 🔴 → ✅ (G-25 built, Phase 1.6c: Settings → Recall plan, Inventory → Recalls; concierge fact added) |
| `pos` / `registers` (addition) | §4.11 recall messages for budtenders, §4.12 the 86, §4.22 low stock, §5.3 | 🟡 → ✅ |
| *new* `expiry` | §4.14 sources, §4.15 Save / Preview / Apply, §4.16 expired and expiring soon, §5.2 messages incl. every skip reason | 🔴 → ✅ (expired-sale rule built, Phase 1.6b, G-24) |
| `inventory` (tags, labs, labels, bulk fill) | §4.17–§4.20, §5.4 | 🔴 → ✅ |

**Role filter needed (strategy item 3):**
- Every Inventory screen and action is `inventory.manage` (owner, admin, manager). Budtenders get §4.11 (recall messages), §4.12 (the 86) and §9 only.
- The Expiration report is `reports.view` (includes read-only).
- Releasing a recall hold: owner only by SOP rule (the app allows any manager; F-05a-2). Cannabis unit cost by bulk fill: owner or admin by SOP rule (F-05a-11).

**Must ship with caveats** until the findings are fixed:
- F-05a-1: never advise setting a lot to **Destroyed** on the lot page. Destruction is Returns & Destruction only.
- F-05a-2 / F-04-2: Lifecycle status checks nothing and logs nothing. Always tell the user to write form 8.1 first, and Active only from a "now clear" Issues row.
- F-05a-3 / F-05a-4: Adjust quantity does not stop at zero; always write a note.
- F-05a-5 / F-05a-7: never advise **Destruction**, **Recall removal** or **Receive (add)** as adjustment reasons, even though the Issues text suggests the first.
- F-05a-8: ~~the register sells expired lots~~ FIXED (Phase 1.6b, G-24): expired edibles, liquid edibles, tinctures, capsules and RSO are refused with no override; other expired items need **I told the customer**; the draw is FEFO; a nightly job quarantines the hard-block lots.
- F-05a-9: an 86 comes back on its own while units are on file.
- F-05a-16: ~~a recall hold does not hide the website card; advise **Always hide**~~ FIXED (Phase 1.6c, G-25): the website and online orders drop a recalled product by themselves; do not advise Always hide for a recall.
- Never tell anyone to destroy recalled product before the LCB is notified and the destruction is coordinated (WAC 314-55-225(3)(b)(i)(B)).

**Running score:** topics with complete SOP source material add `inventory` (lot core), `inventory-adjustments`, `recalls` (paper plan), `expiry` (rule pending Q-05a-1). Baseline row touched: Inventory management 🟡 (§3), unchanged in code.

### SOP-05b Non-Cannabis, Merch, Publish, Categories, Classification & Sell Price (`docs/sop/SOP-05b-noncannabis-menu-classification.md`, verified at `827facb5`)

The concierge code is **unchanged** (record-only). Today the `inventory` topic (`src/lib/admin/concierge-kb.ts` L163–181) has one line on Other Inventory (L172), which repeats the scan promise that F-05b-1 disproves, and one line on Types & Categories. There is nothing on merch, Publish Menu, the removal check, the cannabis line, classification or the sell price (finding **F-05b-C**). The owner wants the concierge to use every feature, including future ones (D42: *"I want to upgrade the concierge to use all features including future ones we will build after the sop is finished."*). What SOP-05b now provides:

| Concierge topic | SOP-05b sections that ground it | Rating today → after integration (target) |
|---|---|---|
| *new* `other-inventory` | §4.1–§4.9 (drafts, labels, Keypad selling, adjustments, Monday reconciliation, invoices, cost fill, price change), §5.1, form 8.1–8.2 | 🔴 → ✅ (Keypad rule until G-29) |
| *new* `merch` | §4.10–§4.11, §5.2 | 🔴 → ✅ |
| *new* `publish-menu` | §4.12–§4.14 (queue tags and buttons, removal check, publish-now, the 86 in plain words), §5.3 | 🔴 → ✅ |
| `inventory` (Types & Categories, expand) | §4.15–§4.17 (categories, types, Move products, lot re-file, the cannabis line), §5.4, form 8.3 | 🟡 → ✅ |
| *new* `sales-limit-classification` | §4.18–§4.19 (WAC 314-55-095 buckets, worklist, every gap text), §5.5, form 8.4 | 🔴 → ✅ |
| *new* `sell-price` | §4.20–§4.21 (out-the-door, floor ×1.463 / ×1.093, size link, every block message, cost unknown) | 🔴 → ✅ |

**Role filter needed:** Types & Categories and **Publish now and fix after** are owner/admin only. **Save cost** is owner/admin only. The rest is `inventory.manage` / `menu.publish`. Budtenders get §4.4 (Keypad) and §9 only. The SOP-only rules to enforce in answers: a non-cannabis price change is owner only; merch Remove is owner/admin only; a cost-unknown price is owner only; never cross the cannabis line.

**Must ship with caveats** until the findings are fixed:
- F-05b-1: **never** tell anyone the SKU label or the manufacturer barcode scans at the register. Ring on the Keypad with the SKU in the note.
- F-05b-9: never suggest moving or re-filing a product into or out of Accessories / Greenway Merch / Paraphernalia. If asked, explain the tax and limit effect and send the question to the owner.
- F-05b-6: there is no price edit. Give the form 8.2 procedure (owner, admin or manager, D46; non-cannabis cost may be changed, D48). Never offer the re-create route for a cannabis cost (D38).
- F-05b-10: after a hand publish, check **Live variants**.
- F-05b-12: on a cost-unknown lot, the floor is not enforced. **Nobody saves a price until the manifest cost is entered** (D49).
- F-05b-14: a manager can press merch **Remove**, but must not. Owner and admin only (D47). Suggest **Hide**.
- F-05b-15: non-cannabis keypad sales post no cost of goods; do not quote a non-cannabis margin from the books as true.
- Expiry (SOP-05a v1.8, D36, D44): expired edibles, liquid edibles, tinctures, capsules **and RSO** are never sold; the register refuses them (G-24 BUILT). RSO shows as *Concentrate for Inhalation* in CCRS; the app catches it by category and name (F-05a-20 FIXED).
- The 86 is never done on Publish Menu (SOP-05a §4.12).

**Future features (D41/D42):** when G-29…G-32 and G-30A are built (all **APPROVED**, D45–D49; G-29 widened to menu, books and reports), the topics above are updated in the same slice as the SOP (charter rules 9–10).

**Running score:** topics with complete SOP source material add `other-inventory`, `merch`, `publish-menu`, `sales-limit-classification` and `sell-price`, and complete `inventory` (Types & Categories). Baseline row touched: Inventory management 🟡 (§3), unchanged in code.

### SOP-06 Inventory Audits, Cycle Counts & Daily Checklists (`docs/sop/SOP-06-cycle-counts-audits-daily-checklists.md`, verified at `c976c7e4`)

The concierge code is **unchanged** (record-only). Today `src/lib/admin/concierge-kb.ts` mentions Cycle Counts in one line (L66, L73, L175) and the help centre has *"How do I do a cycle count?"* (`help-content.ts` L450–451). Nothing covers planning an audit, the scope reason, approving and pushing the scope, the blind count rules, second counts, reasons, approval, posting, the journal draft, the work paper, the cutoff rule or daily checklists (finding **F-06-C**). D42: *"I want to upgrade the concierge to use all features including future ones we will build after the sop is finished."*

| Concierge topic | SOP-06 sections that ground it | Rating today → after integration (target) |
|---|---|---|
| *new* `inventory-audits` (owner only) | §4.1–§4.7, §4.13–§4.19, §5.1, §5.3, forms 8.1, 8.3, §9.1 | 🔴 → ✅ |
| `cycle-counts` (expand; every employee) | §4.8–§4.12, §4.20–§4.22, §5.2, forms 8.2, 8.4, §9.2 | 🟡 → ✅ |
| *new* `daily-checklists` | §4.23, forms 8.5–8.7 | 🔴 → ✅ (paper until G-38) |

**Role filter needed:** audit planning, review, reasons, approval, posting, journal draft and the work paper are **owner only** (D50); never explain the expected quantity, costs or differences to a non-owner during an open count (blind count). Counting and the checklists are for every employee (D51).

**Must ship with caveats** until the findings are fixed:
- F-06-1: there is **no button** to push an audit to Cycle Counts; give the §4.7 paper interim; never suggest a database edit.
- F-06-3: a finished count does **not** leave the page by itself; tell the owner.
- F-06-4: hub and queue counted/difference figures read 0 until posting.
- F-06-5b: never scan a lot again once recorded; scans do not add up.
- F-06-7: create the audit right before counting, outside selling hours; never post if anything in scope sold. Do not repeat the explainer's "warns you" claim.
- F-06-13: never approve while a line says *"Do not average them."*
- F-06-14: type reason and note together; a saved reason cannot be changed.
- F-06-8: two schedules exist; don't quote one as the rule until Q-06-5.
- F-06-9: never use the old sessions' buttons.

**Future features (D41/D42):** when G-33…G-39 are built, the topics above are updated in the same slice as the SOP (charter rules 9–10).

**Running score:** topics with complete SOP source material add `inventory-audits`, `daily-checklists`, and complete `cycle-counts`.

#### SOP-06 v1.1 (slice SOP-15): owner answers D54–D61, and what the concierge must know before it is built

The owner, again: *"make sure the ai concierge is taught all the things we will build and fix in the future, so it's preemptively prepared."* (D62). The concierge must answer **both** "how does it work today" (interim) and "how will it work" (approved design), and must say which is which. Teaching content, grounded in SOP-06 v1.1:

| Question staff or the owner will ask | Answer today (interim) | Answer once built (approved) |
|---|---|---|
| How do I send an audit to Cycle Counts? (owner) | No button yet; paper count form 8.2 (§4.7) | Create → **Release to Cycle Counts** (separate button, signed) (G-33, D54) |
| Why isn't it automatic? | — | The enterprise pattern (NetSuite, Lightspeed): planning and releasing are separate so the owner can check the scope (D54) |
| Who can count? | Any employee with Cycle Counts; one per count is a store rule (§2 rule 3) | One employee claims a released count; only they can enter numbers (G-36, D56) |
| I finished, now what? | Tell the owner in person (§4.8) | Press **I'm done** → it leaves Cycle Counts, returns to the audit, and the owner sees it on the /admin cockpit (G-34, D55) |
| Do I scan every package? | No: scan one, type the total; never re-scan (§4.10) | Yes: each scan adds one (G-36, D60) |
| What is "Count again"? | The app's own recount at $50+ off; same counter (§4.12, D56) | Same; a recount that still disagrees blocks approval until the owner decides (G-36) |
| Can we count while open? | **No** until G-35: create and count outside selling hours (§4.11) | Yes, any time during open hours: each lot's quantity is captured when it is first counted, so sales are reconciled (G-35, D58, D61). Count each lot in one go; don't sell uncounted units of a lot mid-count |
| What should I count today? | The owner's vendor-of-the-day count (§4.24) | Generators propose: vendor of the day (chunked), ABC, exceptions, expiring, Cultivera, overdue (G-40) |
| Do we do a full count? | Year end; several audits the same day, outside hours (§4.24) | One annual full-count audit, sections, one review (G-41) |
| What's on today's checklist? | Forms 8.5–8.8 (§4.23) | In-app checklists seeded from 8.5–8.8 (G-38) |
| How do I mark down expiring stock? | List it for the owner; the owner sets the markdown (§4.23, F-06-17) | Expiring-soon list on the checklist with a markdown link (G-38) |
| Old cycle counts? | Read only; never use their buttons (§4.20) | All cancelled (D59) |

**Additional caveats (v1.1):** never tell anyone that counting in open hours is safe until G-35 ships; never say a second person must recount (D56 withdrew it); a count item on the cockpit does not exist yet (F-06-16).

### SOP-15 Returns to Vendor, Customer-Return Disposition & Product Destruction (`docs/sop/SOP-15-returns-vendor-destruction.md`, verified at `b8101abb`; v1.1 in slice SOP-08 at `bad718b4`)

The concierge code is **unchanged** (record-only). Today it has two generic lines: `concierge-kb.ts` L66 (menu list) and L176 (*"Returns & Destruction handles vendor returns and compliant destruction with a quarantine hold, plus sample-pricing rules."*), and the help centre answer at `help-content.ts` L465–467 (*"Returns & Destruction handles customer returns, samples, and lawful destruction with the documentation WA compliance requires."*). Neither covers a single step, guard or interim rule (F-15-C). The L176 phrase "plus sample-pricing rules" implies protection that does not exist (F-15-16) and must be reworded at integration.

The owner (D62): *"make sure the ai concierge is taught all the things we will build and fix in the future, so it's preemptively prepared. We will rarely use these features, but they are necessary for our industry so we must have them and do them properly and accurately."* Because these events are rare, the concierge will often be the first place staff look. It must answer step by step, name the form, and always say which rule is law and which is store policy.

| Concierge topic | SOP-15 sections that ground it | Rating today → after integration (target) |
|---|---|---|
| *new* `customer-return-disposition` (restock / destroy, destroy bin, Sale correction) | §4.4–§4.8, §5.1, forms 8.1, 8.6, §9.1 (register steps stay with SOP-01 §4.23) | 🔴 → ✅ |
| *new* `vendor-returns` (RMA, CCRS manifest, pickup-day logging, packet) | §4.9–§4.13, §5.2, form 8.2, §9.2 | 🔴 → ✅ |
| *new* `product-destruction` (schedule, hold, render unusable, record, cancel, partial) | §4.14–§4.20, §4.22, §5.3, forms 8.3, 8.5, §9.3 | 🟡 (one line) → ✅ |
| *new* `recall-return` (v1.1, D65: recalls go back to the vendor, never destroyed by us; officer told at once, WAC 314-55-225) | §4.21, form 8.4; SOP-05a §4.9–§4.13 | 🔴 → ✅ |
| *new* `trade-samples-off-menu` (v1.1, D68: samples never sold or on the menu; interim weekly check) | §4.26; owner's samples rules | 🔴 → ✅ |
| *new* `disposition-money-and-tax` (refunds, 50910, excise, write-off) | §4.24, form 8.6 | 🔴 → ✅ (owner only) |
| `disposition-settings` (hold policy 0 h; legacy sample panel to be removed) | §4.26–§4.27, §5.4 | 🟡 (misleading) → ✅ |
| `disposition-advisor` | §4.25 | 🔴 → ✅ |

**Role filter needed:** the Returns & Destruction page and the Returns desk are **owner, admin, manager** (`inventory.manage`); a budtender asking how to destroy or return product to a vendor gets "tell the manager" plus the bin rule, never the screen steps. The hold policy and sample rules are **owner and admin** (`settings.manage`). Recall destruction is the **admin** (coordinator, D37) with the owner. Money, excise and books answers (§4.24, form 8.6) are **owner only** (books-23). Register returns remain open to budtenders with a manager or lead PIN (SOP-01 §4.23).

**Must ship with caveats** until the findings are fixed:
- F-15-1 (**S1**): **Log a vendor return** removes the stock at once. Always answer "log it only at departure, when the driver has the printed CCRS manifest PDF" (v1.1, D63). Never tell anyone to log it when the RMA arrives.
- F-15-2: say that RMA #, Manifest # and Processor license # and Detail are **required by the SOP** although the screen lets them be blank. A recall reason on a vendor return goes to the admin first.
- F-15-3: the pickup time on form 8.2 is the record; the screen's time has no zone.
- F-15-4, F-15-21: a destruction needs **two people**, and the **witness may be anyone** on staff except the person doing it (D64). It is done **on camera**: note the camera and times. **Witnessed by** holds both names and the camera; **Other method** needs prior written LCB approval.
- F-15-6 (**S1**): a Destroy return is **counted as sellable** by the app until completed; the unit goes into the sealed destroy bin immediately. Never say "the app quarantines it".
- F-15-7: any error after pressing a return button means **stop, do not retry, call the owner**.
- F-15-8: customer returns go through the register or the Returns desk only. The back-office wizard is **not used**: the owner decided to remove it (D66).
- F-15-10: do not press **Download Sale correction CSV** unless the owner is uploading by hand that day, despite the success message telling you to.
- F-05a-17/18/19, F-15-9, F-15-11: Recalled or Quarantine lots cannot be picked; **never schedule a recalled lot**; only the owner cancels; after a cancel or a partial destruction restore the earlier status by hand (form 8.5).
- F-15-12: check the quantity against on-hand before scheduling.
- F-15-16: the sample-pricing panel is dead legacy code; never say it protects anything (to be removed, G-47).
- F-15-20 (**S1**): the app does **not** yet keep samples off the menu or the register. Never say "the system blocks samples". Answer with the owner's rules (D68) and the §4.26 interim check: dismiss sample drafts, and run the weekly Samples-only check.
- F-15-18, F-15-19: never say the LCB "confirmed" Other for vendor returns (open question U-72), and never cite a 48–72 h lead time or Mon/Wed/Fri confirmation as LCB rules.
- F-15-15: never say returns reduce the excise return automatically.
- Law vs policy (v1.1, read from the state texts 2026-10-28): **no legal hold, notice or witness for destruction** (WAC 314-55-097); the store hold is **0 h** (D67); the witness and the camera are store rules (D64), and cameras are also required by WAC 314-55-083(3)(a). **Greenway files the CCRS manifest as origin** and the LCB replies with an automatic email and PDF that travels with the product (WAC 314-55-085; CCRS Manifest User Guide). There is **no LCB lead time**. The **recall prohibition** (WAC 314-55-225), **render unusable ≥50%** (WAC 314-55-097) and **samples may not be sold** (WAC 314-55-096(1)(i)) are law.

#### SOP-15: today vs once built (teach both now, D42 and D62)

The concierge must answer **both** "how does it work today" (interim) and "how will it work" (design; owner answers Q-15-1…Q-15-6 received in slice SOP-08 as D63–D68, so the gaps below are APPROVED). When a gap ships, the "today" column is deleted in the same slice (charter rules 9–10).

| Question staff or the owner will ask | Answer today (interim) | Answer once built (G-nn) |
|---|---|---|
| When do I log a vendor return? | Retired (Phase 1.5): see the built answer | Built (Phase 1.5, G-42; migration 0309): log as soon as the RMA arrives; the units are **reserved** (not sellable) and come off on-hand, with the CCRS Other, only at **departure** (§4.11) |
| Who files the transport manifest, and how far ahead? | **Greenway**, as the origin: the owner/admin uploads Manifest.CSV to CCRS and waits for the LCB success email with the PDF. The LCB sets **no** lead time (§4.10) | Built (Phase 1.5, G-42): **Download Manifest.CSV** on the return builds it from the return, the lot and the settings; it refuses rather than guess a missing field (§4.10) |
| Does the manifest PDF have to go with the product? | **Yes**, printed, with an employee 21+ or a transport licensee; sealed, locked, direct route (WAC 314-55-085; §4.13) | Same |
| Which fields are required for a vendor return? | Retired (Phase 1.5): see the built answer | Built (Phase 1.5, G-42): the server checks each state step in order before it is recorded (§4.11–§4.12) |
| How do I move the manifest status? | Retired (Phase 1.5): see the built answer | Built (Phase 1.5, G-42): steps upload → LCB success email → departure, checked in order on the server, each audited with who and when (§4.12) |
| What do we do with a recall? | It is a **transfer back to the vendor** (D65): open the event in Inventory → Recalls, add the lots, the admin tells the LCB officer at once and records it on the event, then a vendor return with reason Recall (the officer and date come from the event, Phase 1.6c); never destroy it (§4.21) | Built (Phase 1.5, G-42; Phase 1.3, G-28): Recalled lots are listed for a vendor return and stay Recalled; they are never offered for destruction (§4.21) |
| A customer returned an opened item: what do I do with it? | **Destroy** → sealed destroy bin now → form 8.1 → check the event appeared; the app holds the unit (§4.7) | Built (Phase 1.4, G-44; migration 0308) |
| Is the destroy-return unit counted as stock? | On hand and in CCRS yes, but **held**: never sellable, never on the menu, until destroyed (§4.3; before 0308 the bin is the only control) | Built (Phase 1.4, G-44) |
| The return showed an error. Did it save? | No: it saves all or nothing, so nothing changed; keep the unit and cash aside and tell the owner before retrying (§4.7) | Built (Phase 1.4, G-44) |
| Can I use the back-office Customer return? | **No.** The owner decided to remove it (D66); use the register or the Returns desk (§4.6) | It is gone (G-45 APPROVED) |
| Should I download the Sale correction CSV? | **No**, unless the owner uploads by hand that day (§4.8) | The weekly CCRS file sends it; the download checks the ledger (or is gone) (G-45) |
| Who must be present at a destruction? | Retired (Phase 1.6a): see the built answer | Built (Phase 1.6a, G-43): **Witness (from the roster)** is required, anyone on staff except the person completing; the server refuses otherwise (§4.18) |
| Does a destruction have to be on camera? | **Yes** (D64; WAC 314-55-083(3)(a)). Check the camera records before starting (§4.17) | Built (Phase 1.6a, G-43): **Camera** with start and end time (Pacific) is required to complete and shows on the printable **Destruction log** (§4.18) |
| What goes on the destruction record? | Form 8.3 plus the screen fields; both facility and destination; camera (§4.18) | Same, plus required witness, camera reference, approval reference, printable destruction log, optional photo (G-43) |
| Can I add a photo or video of the destruction? | Built (Phase 1.7a, G-43 req 7): **Add photo or video (optional)** on the event; photo up to 50 MB, video up to 200 MB, kept privately five years, never editable (§4.18 step 8) | Same; **View / print this record** prints one event with its photos (§4.18) |
| Is there a printable vendor-return packet? | Built (Phase 1.7b, G-42 req 7): **Print packet (form 8.2)** on each vendor-return row; form 8.2 filled in from the app, blanks for what only paper holds (§4.13) | Same; staple the RMA, LCB email and manifest PDF and file five years (§4.13 step 3) |
| Can we use a waste contractor? | Only with **prior written LCB approval** filed with form 8.3 (§4.17) | The app asks for the approval reference and date (G-43) |
| Can I sell an expired gummy / tincture / capsule / RSO? | Built (Phase 1.6b, G-24; D36, D44): **No.** The register refuses it with no override and it is left off the register menu. Set the expired lot to **Quarantine**; the nightly job does this at 4:20 AM; then the fresh stock sells (SOP-05a §4.16) | Same |
| Can I sell expired flower / pre-rolls / vapes / other concentrates? | Built (Phase 1.6b, G-24; D36): only after telling the customer and ticking **I told the customer** (register payment screen or the order page); the sale is noted on the order (SOP-05a §4.16) | Same |
| Which lot does a sale draw from? | Built (Phase 1.6b, G-24): soonest-expiring first (FEFO), then oldest received (SOP-05a §4.16) | Same |
| How long is the hold? Is it the law? | The law has **no** hold; the store setting is **0 h** (D67, §4.27) | Default 0 in the code and the panel says so (G-50 APPROVED) |
| Why does the hold-not-elapsed time look wrong? | It is in the server's clock; use the event's time (F-15-5) | All times in Pacific (G-43) |
| The lot I need is not in the list | Active and Quarantine lots are listed; Recalled lots never (§4.21, vendor return) | Built (Phase 1.3, G-28) |
| Can I destroy recalled product? | **No, never** (D65). It goes back to the vendor (§4.21) | Same; the app offers recalled lots only for a vendor return (G-28) |
| Can I cancel a destruction? | Owner only, with a reason; the app restores the earlier status and says what it did (§4.19) | Built (Phase 1.3, G-28) |
| I destroyed part of a lot; why is the rest not for sale? | Since Phase 1.3 the lot returns to its earlier status by itself, unless another destruction holds it or it was in Quarantine before (§4.20) | Built (Phase 1.3, G-28) |
| I scheduled more than we have | Caught only on completion; owner (§4.18) | Refused at scheduling (G-43) |
| The page just says "qty" | A field was missing; fill it again (§4.15) | A full sentence (G-46) |
| Do the sample-pricing rules stop sales? | **No**, it is dead legacy code (§4.26) | Removed (G-47 APPROVED) |
| Can a sample be sold or show on the menu? | **Never** (law and owner, D68). The app does not block it yet: dismiss any sample draft on Product Onboarding; weekly **Samples only** check on Inventory; tell the owner if a sample lot went down at the register (§4.26) | Sample lots get no draft and are invisible to the register, barcodes and website (G-51 APPROVED) |
| How are samples given out? | Only on the **Employee Samples** hub (owner/admin), max 30 per employee per quarter; that is when inventory goes down (§4.26) | Same |
| Do refunds hit the books / excise? (owner) | No journal; excise Box 1 likely not reduced; form 8.6 and the excise override (§4.24) | Daily refund journal to 50910 for approval; Box 1 net of returns (G-48) |
| Stolen or seized product? | Not a destruction; SOP-20; call the owner, then lot page **Theft** / **Seizure** with the incident reference (SOP-05a §4.7) | Built (Phase 1.2, G-23) |

**Future features (D41/D42):** when G-42…G-51, G-28, G-25 or G-23 is built, the topics above and this table are updated in the same slice as SOP-15 (charter rules 9–10), and `concierge-kb.ts` L176 and `help-content.ts` L465–467 are rewritten to match.

**Running score:** topics with complete SOP source material add `customer-return-disposition`, `vendor-returns`, `product-destruction`, `recall-return`, `trade-samples-off-menu`, `disposition-money-and-tax`, `disposition-advisor`, and complete `disposition-settings`.

### SOP-08 New Hire Onboarding, System Access & Offboarding (`docs/sop/SOP-08-onboarding-system-access-offboarding.md`, verified at `bad718b4`)

The concierge code is **unchanged** (record-only). Today it has two thin entries: `concierge-kb.ts` `time-clock` (L248–258, *"Employee -> Time Clock lets staff clock in and out and tracks shifts."*) and `users` (L415–425). The `users` entry is **wrong in two places**: it lists the roles as *"Owner/Manager (most things), Content/Editor (content only), or Read-only (view)"*, but the app has six roles (owner, admin, manager, content_editor, staff, readonly; `roles.ts` L5–29), and it never mentions the employee file, the onboarding checklist, PINs, the handbook gate or offboarding. The baseline rows above (`users` 3, handbook gate 0, time clock 2) are confirmed.

| Concierge topic | SOP-08 sections that ground it | Rating today -> after integration (target) |
|---|---|---|
| `users` (roles, invite, change role, deactivate; six roles and what each can do) | §2, §4.4, §4.14–§4.17, §5, forms 8.4, 8.6 | 3 (wrong role list) -> 9 |
| *new* `two-identity-systems` (employee file vs sign-in; books-87; how they link) | §4.1–§4.2, §4.4 | 0 -> 9 |
| *new* `employee-onboarding` (Add to roster, the 16-step checklist, I-9/W-4/21+, document tracker, Activate) | §4.2–§4.13, form 8.1, card 9.1 | 0 -> 9 |
| *new* `clock-pin` (when a PIN is set, lockout after 5 tries, clearing a PIN) | §4.6, §4.13, §4.15, §5, card 9.3 | 0 -> 9 |
| `handbook-gate` (back office vs register; paper route; version change) | §4.10, §4.18, §5 | 0 -> 9 |
| *new* `employee-training-records` (training log, 5-year retention, required topics) | §4.11, §6 | 0 -> 9 |
| *new* `badges-and-visitors` (employee badge text, visitor badge and log, 3 years) | §4.12, §4.19, forms 8.2, 8.5 | 0 -> 9 |
| *new* `employee-offboarding` (both halves, dismissal order, offboarding checklist, final pay hand-off) | §4.20–§4.23, form 8.3, card 9.2 | 0 -> 9 |
| *new* `employee-rehire` | §4.24, form 8.1 (new sign-off) | 0 -> 9 |

**Role filter needed:** the employee files and Terminate are **owner, admin, manager** (`staffing.manage`, `roles.ts` L261); Users is **owner, admin** (`users.manage`, L221). A budtender who asks how to add someone or remove access gets "ask the manager / owner", never the steps. Anyone may be told what they must bring on day one (form 8.1 list) and why the register says the handbook must be signed. Document numbers (SSN, I-9 document numbers) are **never** repeated by the concierge.

**Must ship with caveats** until the findings are fixed:
- F-08-1 (**S1**): new people are created **Active**. Never say "the app won't let them work until the checklist is done". Answer: **no PIN until form 8.1 is signed**, and the PIN is the only thing that lets them clock in or open a register.
- F-08-2: never say "link their login to their employee file": no screen does it. The employee file and the sign-in are separate on purpose (books-87).
- F-08-3: "Letting someone go" is always **both halves the same day**: Terminate on the employee file **and** Deactivate on Users; delete future shifts; close an open punch. For a dismissal, deactivate the sign-in first.
- F-08-4: when the register says the handbook must be signed, the fix is the **Document tracker** row *Employee handbook acknowledgment = Read & signed*, not the checklist box. After a handbook version change, paper signers re-sign by hand.
- F-08-5: no training-log line, no training checkmark.
- F-08-6: before Rehire, print the status card (Rehire erases the old termination date and reason), then uncheck every onboarding step.
- F-08-8: the visitor log is **paper** (form 8.5) until the owner answers Q-08-3; kept three years.
- F-08-9: say which role to pick; don't rely on the default.
- Law vs policy: under 21 never works (RCW 69.50.357(2)); training is required (RCW 69.50.357(3)); badge and visitor log (WAC 314-55-083(1)); training, payroll and hire records kept 5 years (WAC 314-55-087(1)(e)). "No PIN before form 8.1" and "both halves the same day" are store rules.

#### SOP-08: today vs once built (teach both now, D42)

The concierge must answer **both** "how does it work today" (interim) and "how will it work" (design; gaps PROPOSED, Q-08-1…Q-08-5 open). When a gap ships, the "today" column is deleted in the same slice as the SOP update.

| Question | Answer today (interim) | Answer once built (G-nn) |
|---|---|---|
| How do I add a new hire? | Employees -> Add to roster with **no PIN**; work the checklist and form 8.1 (§4.3–§4.13) | Same, and the person starts as **Candidate**; the PIN field unlocks on Activate (G-52) |
| When can they clock in? | Only after form 8.1 is signed and a manager sets the PIN (§4.13) | Only after Activate, which checks the critical steps, hire date, badge and training log (G-52, G-55) |
| Why does the register say the handbook must be signed? | Set the Document tracker row to **Read & signed** (§4.10 step 4) | Checking the handbook step sets it; a linked sign-in's digital acknowledgment counts too (G-55, G-53) |
| How do I give them back-office access? | Users -> Invite with the lowest role that does the job (§4.14–§4.16) | Same, then link the sign-in to the file (G-53, if Q-08-1 is yes) |
| How do I record training? | Training log line first, then the checkmark (§4.11) | Activate requires a log line per required topic (G-55) |
| Where is the visitor log? | Paper form 8.5 at the back door, kept 3 years (§4.19) | Visitor sign-in screen and badges in the app (G-57, if Q-08-3 is "build it") |
| How do I let someone go? | Both halves the same day: Terminate, then Deactivate on Users; delete future shifts; close an open punch (§4.21–§4.22, form 8.3) | Terminate offers to deactivate the linked sign-in and clears future shifts (G-54) |
| How do I rehire someone? | Print the status card, Rehire, uncheck every step, start Part 2 again (§4.24) | Rehire keeps the history and starts a fresh checklist (G-56) |
| Who changed this person's job role? | Form 8.4 (the audit has no old/new values) | Audit shows old and new values (G-58) |

**Future features (D41/D42):** when G-52…G-58 is built, the topics above and this table are updated in the same slice as SOP-08, and `concierge-kb.ts` `users` (L415–425) and `time-clock` (L248–258) are rewritten from SOP-08.

**Running score:** topics with complete SOP source material add `users` (fix), `two-identity-systems`, `employee-onboarding`, `clock-pin`, `handbook-gate`, `employee-training-records`, `badges-and-visitors`, `employee-offboarding`, `employee-rehire`.
