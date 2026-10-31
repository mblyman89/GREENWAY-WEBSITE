# ACCOUNTING BIBLE — 00 · INDEX (read this first, every session)

> Audience: **the agent** (me, in a future session, with no memory of this one).
> Owner: Michael Lyman (`mblyman89`). Repo: `mblyman89/GREENWAY-WEBSITE`, branch `main`.
> Written: sandbox date **2026-10-31** (the opening-balance date; cut-over is tomorrow, 2026-11-01).
> Base commit audited: `aa1f7a8a` (main). Bible branch: `docs/accounting-bible`.
> Status of this document set: **documentation only. No application code was edited.**

---

## 0.1 The request, verbatim (standing rule 1 — AGENTS.md:12)

> "I need your help completing the bookkeeping and accounting branch of my back office. Please download a copy of the repo, read agents.md, the standing rules you must follow. Please recon and audit the bookkeeping code and logic, deep research the internet for enterprise grade solutions and logic, authoritative docs, etc. I want to create a plan for finishing it all. The foundation is set mostly I think, its connections that need to be made. We need to go slow and make sure we don't miss anything! Do thorough research. Document everything in a massive bible. It should be thousands of lines long, containing everything you need to stay focused without drifting. It needs to anchor lines and PIN code and record and document everything. This massive roadmap strategy bible is meant only for you. It will be your guide. So make certain it has everything you need to complete the accounting branch with everything a professional enterprise grade solution would have. But hyper tailored for greenway. The power of the big boys, all for one. No code edits. Read, recon, audit, research heavily, document and record, strategy. Massive report for you. Write it specifically for you. Go above and beyond please. Follow the standing rules. Thank you."

Michael's diagnosis — *"The foundation is set mostly I think, its connections that need to be made"* —
was **tested, not assumed**, and it is **correct**. The audit found a very strong database core
(gapless numbering, immutability, idempotency, approval policy, 280E cost classes, opening-balance
worksheet, bank matching, period table, reversal function) and a large number of **unwired doors**:
writer RPCs with zero callers, pure cores imported only by their own tests (rule 50), and — most
dangerously — several wires that *are* connected but **cannot succeed at runtime** (N-01, N-02, N-03, N-09; N-05 is a latent parity gap neutralised by 0211).

---

## 0.1b Round 2 (2026-10-31): the owner's answers

Michael answered all 16 questions and moved the books' go-live to **2027-01-01** (Sage stays the book through 2026). His full message is quoted in part 05 (OD-22…OD-39). **Start from part 15** (master plan) and part 14 (resolutions). The N-series fires below are still real, but they now burn in **rehearsal**, not on the official books, which buys time to fix them properly. **The exception is Q-05 (medical endorsement row), which affects live register sales from 11/01** (part 14 Q-05).

## 0.2 The five things that will bite first (read before anything else)

| # | Finding | Severity | Where it is pinned | Fix part |
|---|---|---|---|---|
| **N-01** | Five call sites submit `autoPost: true` with **no `templateCode`**. `gl_submit_journal` raises `GL_AUTOPOST_NO_TEMPLATE` (0174:504-507). No migration seeds `gl_posting_templates`. **Every drawer reconcile, seal-bag, deposit-clear and supply-run post is refused.** Proven on PG15 (`scripts/accounting-bible/probe_autopost.sh`). | CRITICAL | drawer-posting-service.ts:236 · seal-bag-posting-service.ts:112 · deposit-clearing-service.ts:317 · supply-run-posting-service.ts:101,179 | 04 §N-01, 09 S-01 |
| **N-02** | Factory reset deletes every `gl_periods` row (0209:556, list 0240:257). Nothing re-seeds. `gl_open_fiscal_year` (0175:506) has **zero app callers**. Every post afterwards raises `GL_NO_PERIOD` (0172:789). | CRITICAL (pre-cut-over) | 0209:556, 0209:668, 0240:257, factory-reset-core.ts:313 | 04 §N-02, 07 §7.3, 09 S-02 |
| **N-03** | `postSaleForOrder` submits revenue + COGS **without autoPost** → 2 drafts per sale. ~200 in-store transactions/day (owner-stated, docs/slice-23…md:5) ⇒ **~400 drafts/day**, one button each; the drafts list is capped at 200 by default (approval-service.ts:188, 209). | HIGH (day 1 operational) | sale-posting-service.ts:245-277 | 04 §N-03, 05 Q-07, 09 S-03 |
| **N-05** | `approval-core.ts#planApproval` mirrors **0174** but not **0177**: it never reads `owner_override_enabled` and has **no opening_balance self-approval branch**. The service selects only `threshold_cents, allow_self_approval` (approval-service.ts:282, 445). **CORRECTED during recon:** migration **0211_owner_operator_self_approval.sql:97-104** sets `allow_self_approval = true` on every policy row and aborts if any row still blocks (0211 §2). So **if 0211 is applied** (U-03) the TS gate passes and nothing is refused today. The gap is **LATENT**: it fires the day a second books user exists and `allow_self_approval` goes back to false, because TS will then refuse the opening-balance journal that 0177:322-327 / :428 would accept. The `needs_second_approver` flag also has **no screen** (0211 header, "PR D" in todo.md). | HIGH (latent parity) | approval-core.ts:280-292 vs 0177:322,428; 0211:97-104 | 04 §N-05, 09 S-04 |
| **D-48/D-47** | No path writes `gl_opening_balances`; nothing calls `gl_bless_opening_balances` / `gl_close_opening_balance_equity`; nothing emits `sourceKind:"opening_balance"`. Inventory count is tonight; upload is tomorrow 06:50 (CUTOVER_WEEKEND_ONE_PAGE.md:42) — the one-pager has **no books steps**. | BLOCKING | DEFECTS.md:2105, :2132 | 07 |

**Practical consequence for 2026-11-01:** the store can open and sell. Operational inventory is
unaffected. The **books** will not have a usable opening balance, cash entries will be refused, and
sale entries will pile up as drafts. None of that loses data — every source table keeps its rows,
every refusal is recorded in `audit_log`/`order_events` (rule 134) — so the books can be **back-filled**
once the wiring lands, because each poster is idempotent on its `sourceRef`. Part 07 makes this the
explicit strategy: *capture tonight's evidence perfectly; post it when the door is safe.*

---

## 0.3 Reading order

| Part | File | What it is for |
|---|---|---|
| 00 | `00-INDEX.md` | This page. The request, the five fires, the map, the findings index. |
| 01 | `01-standing-rules-and-handoff.md` | Digest of AGENTS.md rules and the todo.md bookkeeping rules that govern this branch; session-start and recovery commands. |
| 02 | `02-authoritative-spec.md` | The law and standards (280E, 1.471-3, Harborside, RCW 69.50.535 incl. (2) medical, WAC 314-55-092, DOR B&O and due dates, Pub 15, 1099, FinCEN, 1120-S/7203, ASC, COSO, Plaid, NetSuite close). Each gives what it says → what it forces → Greenway pin. Accounting basis = **ACCRUAL** (cutover-core.ts:91-99). |
| 03 | `03-code-anchor-atlas.md` | **Generated** (build_atlas.py). Every accounting file, export, RPC and caller with file:line. 6,048 lines. |
| 03b | `03b-schema-atlas.md` | **Generated.** Every `gl_*` table, function and trigger with migration:line. |
| 03c | `03c-chart-of-accounts.md` | The full 193-code COA from every migration. **Use it before writing any account code.** (10100 = vault, 10200 = operating bank, 12100 = employee advances, inventory = 200xx.) |
| 04 | `04-current-state-and-gap-matrix.md` | 40-event census × 6 layers; findings N-01…N-13; dead cores DC-01…DC-11; uncalled writer RPCs; trust-liability flow map; DEFECTS cross-reference D-30…D-82; docs drift. |
| 05 | `05-owner-decisions-and-open-questions.md` | OD-01…OD-39 verbatim with pins; Q-01…Q-16 all **ANSWERED** (2026-10-31). |
| 06 | `06-verification-protocol.md` | Five gates; the existing PG15 verifiers and their coverage gaps; invariants INV-01…12; read-only query rules; reachability; exit criteria. |
| 07 | `07-cutover-and-opening-balances.md` | **URGENT.** 10/31–11/01 books runbook: evidence, 07:30 read-only lot snapshot, periods check/insert, OB mechanics, N-13, backfill, parallel run. |
| 08 | `08-target-architecture.md` | The finished system: principles, entities, flow map, posting contract, source_kind table, templates (verified columns; no account restriction, Q-15), daily rhythm, close calendar (20th/25th), controls, reports, scope guardrails. |
| 09 | `09-slice-plan.md` | **The work queue.** Waves W0–W6, slices S-00…S-40 with pins, RED/GREEN proofs and "waits on". |
| 10 | `10-deferred-and-blocked.md` | Blocked on the owner (B-xx), deferred by design (F-xx), accepted risks (R-xx). |
| 11 | `11-enterprise-capability-checklist.md` | HAVE/PART/GAP scorecard, COSO control matrix (C-TAX-1, C-CASH-1, C-EQ-2 …), the 15-step computed month-end checklist. |
| 12 | `12-unverified-register.md` | U-01…U-20: what I have not proven, with the exact read-only query or owner question. |
| 13 | `13-sources.md` | Every authority URL, grouped, with what it was used for (§R2 = round 2). |
| 14 | `14-owner-answers-and-expert-resolutions.md` | **Round 2.** Plain-English answer + expert resolution for every Q; the URGENT medical-endorsement SQL (Q-05). |
| 15 | `15-master-plan.md` | **THE ROADMAP OF RECORD.** 70 slices in 10 blocks (A Foundations … J Teaching), timeline Nov 2026 → Feb 2027, old→new ID map. Supersedes 09's order. |

Supporting scripts (committed, read-only): `scripts/accounting-bible/build_atlas.py`, `census_matrix.py`, `probe_autopost.sh` (probe P-01), `reachability.py` (baseline 91/111 reachable).

## 0.3a Findings index (N-series; numbering is permanent)

| ID | One line | Severity | Slice |
|---|---|---|---|
| N-01 | Cash autoposts carry no template and are refused (GL_AUTOPOST_NO_TEMPLATE, 0174:504-511); PG15-proven | CRITICAL | S-01 (+S-01b backfill) |
| N-02 | Factory reset wipes gl_periods; nothing reseeds; GL_NO_PERIOD (0172:789) | CRITICAL | S-02 |
| N-03 | Every sale = 2 drafts (~400/day) | HIGH | S-03 |
| N-04 | Census conflates approval-exempt with autopost-eligible | MEDIUM | S-00 |
| N-05 | TS approval parity with 0177, neutralised by 0211 | HIGH (latent) | S-04 |
| N-06 | OB bless plugs to 40400 (tension with rule 27) | MEDIUM | S-07 |
| N-07 | B&O service tiers above $1M not modelled | LOW | deferred F-05 |
| N-08 | Sales tax rate has no effective date | MEDIUM | S-03c |
| N-09 | GL ignores medical exemptions (sale-journal-core.ts:239-243; refund :292/:305); the **return** honours them (excise-return-core.ts:39-40) | HIGH | S-03b |
| N-10 | 20 of 111 accounting modules unreachable | MEDIUM | per DC slice |
| N-11 | Excise/sales-tax payment writes no journal except via a manual vendor bill | MEDIUM | S-12 |
| N-12 | Non-current liabilities shown as current | LOW | accepted R-03 |
| N-13 | EXPECTED_OPENING_ACCOUNTS mislabels 10100/12100 (cutover-core.ts:247-265) | MEDIUM | S-07a |

Resolved during recon: U-09 (Plaid pending handled), U-10 (gapless numbering), U-11 (loyalty = discount), U-12/U-14 (no callers), U-15 (inventory audit never autoposts), U-17 (return already has the exemption line).

## 0.4 One-paragraph mental model of the ledger (so I do not have to re-derive it)

Every economic event is a **feeder** (rule 63). A feeder's pure `*-core.ts` builds a balanced draft
(`ledger-core.ts#validateJournalDraft`), its `*-service.ts` calls the **one door**
`posting-service.ts#submitJournal` (:277) → RPC `gl_submit_journal` (0174:344), which writes a
`draft` journal + lines with an idempotency key `entity|source_kind|source_ref` and a line
fingerprint. If `p_auto_post` is true **and** the kind is in `('pos_sale','excise','purchase','bank')`
**and** (purchase ⇒ 3-way matched) **and** an approved, active, effective, same-entity, same-kind
template exists **and** the amount ≤ `max_autopost_cents` and within tolerance, it calls
`gl_post_journal` (0172:668), which assigns the gapless number and enforces balance, period
(`GL_NO_PERIOD` :789), control-account, 280E cost-class and approval-trigger rules. Otherwise the
draft waits for `/admin/books/drafts` → `approval-service.ts#approveAndPostJournal` (:371), which
plans per entry (`approval-core.ts#planApproval`) between `post_only`, `approve_then_post` and
`refuse`, then calls `gl_approve_journal` (0177:274 latest) and/or `gl_post_journal` on the
**session** client (`createBooksClient`, auth.uid() = Michael). Posted rows are immutable; corrections
are `gl_reverse_journal` (0172:826) — currently **uncalled**. Periods (`gl_periods`) are monthly per
entity; `gl_close_period` (0172:891) / `gl_reopen_period` (:929) — **uncalled**. Reads: trial balance
(0175), financial statements (`financial-statements-store.ts`), census (`ledger-census-data.ts`).

## 0.5 Entities (crossed names are deliberate — do not "fix" them)

| gl_entities.code | Legal name | DBA | Tax | Basis (cutover-core.ts:94) |
|---|---|---|---|---|
| `greenway` | LYMAN'S MARIJUANA (S-corp) EIN 46-4217016 | Greenway Marijuana | 1120-S, §280E applies | accrual |
| `atm` | LYMAN'S ENTERPRISES LLC | GREENWAY MERCHANDISE | Schedule C (Michael) | see cutover-core.ts:94 |
| `landholding` | GREENWAY ENTERPRISES LLC | LYMAN'S LANDHOLDING | Schedule C | see cutover-core.ts:94 |
| `personal` | Michael personally | — | 1040 | — |

Shareholders of `greenway`: Michael 85 %, Nicholas C Mullan 5 %, James H Becker 5 %, Theresa L Becker 5 %.

## 0.6 Dates that govern everything (REVISED 2026-10-31 by OD-22/OD-24)

| Fact | Value | Pinned at |
|---|---|---|
| Line in the sand (schema) | 2026-01-01 | 0172:309-314, todo.md rule 10 |
| Store / POS go-live (sub-ledgers only) | 2026-11-01 | OD-22 |
| Book of record Nov–Dec 2026 | **Sage 50** (exports via sage-exports-core.ts) | OD-24 |
| Rehearsal posting window (config unchanged until I-01) | 2026-11-01 → 2026-12-31 | 0186 row as seeded; 15 §0 |
| **Opening balance date (target)** | **2026-12-31** | OD-24; set by 15 I-01 (config UPDATE) |
| **Books go-live / cut-over (target)** | **2027-01-01** | OD-22; 15 I-01 |
| Parallel proof with Sage | January 2027 (light) or none | 14 Q-02; 15 I-06 |
| First live close | January 2027, by ~2/25 | 15 §1 |
| Old dates (superseded, do not use) | OB 2026-10-31 / cut-over 2026-11-01 (cutover-core.ts:66,:73); 2025-12-31 (cutover-core.ts:84, ledger-core.ts:166) | A-01 removes the literals |
| Business clock | America/Los_Angeles | AGENTS.md rule 9 |

## 0.7 How to resume (copy-paste)

```bash
cd /workspace && [ -d GREENWAY-WEBSITE ] || git clone https://x-access-token:$GITHUB_TOKEN@github.com/mblyman89/GREENWAY-WEBSITE.git
cd GREENWAY-WEBSITE && git fetch origin && git checkout main && git reset --hard origin/main
git config user.name "Greenway Dev"; git config user.email "dev@greenwaymarijuana.com"
sed -n 1,200p docs/accounting-bible/00-INDEX.md      # this file
sed -n 1,400p docs/accounting-bible/09-slice-plan.md # next slice
grep -n "^## D-" docs/DEFECTS.md | tail -20           # newest defects since this bible
```
Then: re-run `python3 scripts/accounting-bible/build_atlas.py` and diff part 03 — **line numbers in
this bible are as of aa1f7a8a and drift with every merge.** Re-anchor by grepping the quoted
identifier, never by trusting a stale number (rule 66: a document makes checkable claims, so check them).
