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
dangerously — several wires that *are* connected but **cannot succeed at runtime** (N-01, N-03, N-05).

---

## 0.2 The five things that will bite first (read before anything else)

| # | Finding | Severity | Where it is pinned | Fix part |
|---|---|---|---|---|
| **N-01** | Five call sites submit `autoPost: true` with **no `templateCode`**. `gl_submit_journal` raises `GL_AUTOPOST_NO_TEMPLATE` (0174:504-507). No migration seeds `gl_posting_templates`. **Every drawer reconcile, seal-bag, deposit-clear and supply-run post is refused.** Proven on PG15 (`scripts/accounting-bible/probe_autopost.sh`). | CRITICAL | drawer-posting-service.ts:236 · seal-bag-posting-service.ts:112 · deposit-clearing-service.ts:317 · supply-run-posting-service.ts:101,179 | 04 §N-01, 09 S-01 |
| **N-02** | Factory reset deletes every `gl_periods` row (0209:556, list 0240:257). Nothing re-seeds. `gl_open_fiscal_year` (0175:506) has **zero app callers**. Every post afterwards raises `GL_NO_PERIOD` (0172:789). | CRITICAL (pre-cut-over) | 0209:556, 0209:668, 0240:257, factory-reset-core.ts:313 | 04 §N-02, 07 §7.3, 09 S-02 |
| **N-03** | `postSaleForOrder` submits revenue + COGS **without autoPost** → 2 drafts per sale. ~200 in-store transactions/day (owner-stated, docs/slice-23…md:5) ⇒ **~400 drafts/day**, one button each; the drafts list is capped at 200 by default (approval-service.ts:188, 209). | HIGH (day 1 operational) | sale-posting-service.ts:245-277 | 04 §N-03, 05 Q-07, 09 S-03 |
| **N-05** | `approval-core.ts#planApproval` mirrors **0174** but not **0177**: it never consults `owner_override_enabled` and has **no opening_balance self-approval branch** (only appearance of "opening" is the SOURCE_KINDS list at :65). The service only selects `allow_self_approval` (approval-service.ts:282, 445). ⇒ The opening-balance journal (Michael-authored, ≫ $5,000) is refused in TypeScript with `GL_SELF_APPROVAL_REFUSED` **even though the database (0177:322-327, 0177:428) would accept it.** | CRITICAL (cut-over) | approval-core.ts:280-292 vs 0177_owner_override.sql:322, 428 | 04 §N-05, 07, 09 S-04 |
| **D-48/D-47** | No path writes `gl_opening_balances`; nothing calls `gl_bless_opening_balances` / `gl_close_opening_balance_equity`; nothing emits `sourceKind:"opening_balance"`. Inventory count is tonight; upload is tomorrow 06:50 (CUTOVER_WEEKEND_ONE_PAGE.md:42) — the one-pager has **no books steps**. | BLOCKING | DEFECTS.md:2105, :2132 | 07 |

**Practical consequence for 2026-11-01:** the store can open and sell. Operational inventory is
unaffected. The **books** will not have a usable opening balance, cash entries will be refused, and
sale entries will pile up as drafts. None of that loses data — every source table keeps its rows,
every refusal is recorded in `audit_log`/`order_events` (rule 134) — so the books can be **back-filled**
once the wiring lands, because each poster is idempotent on its `sourceRef`. Part 07 makes this the
explicit strategy: *capture tonight's evidence perfectly; post it when the door is safe.*

---

## 0.3 Reading order

| Part | File | What it is for | Approx lines |
|---|---|---|---|
| 00 | `00-INDEX.md` | This page. The request, the five fires, the map. | — |
| 01 | `01-standing-rules-and-handoff.md` | Digest of AGENTS.md rules 1–14 + todo.md bookkeeping rules 1–142 that govern this branch; session-start and recovery commands. | |
| 02 | `02-authoritative-spec.md` | The law and standards: 280E, Reg 1.471-3, Harborside, RCW 69.50.535, WAC 314-55-092, DOR B&O, Pub 15, 1099, FinCEN, S-corp (1120-S/K-1/7203), ASC topics, COSO, Plaid, NetSuite close. Each with what it forces in our code. | |
| 03 | `03-code-anchor-atlas.md` | **Generated** (scripts/accounting-bible/build_atlas.py). Every accounting file, export, RPC, caller with file:line. | 6,048 |
| 03b | `03b-schema-atlas.md` | **Generated.** Every `gl_*` table/function/trigger with migration:line. | 309 |
| 04 | `04-current-state-and-gap-matrix.md` | The 40-event census × 6 layers, the defect cross-reference, the new findings N-01…N-09 in full, docs drift. | |
| 05 | `05-owner-decisions-log.md` | Every owner decision/fact that constrains the books, verbatim where recorded, and the open questions Q-01…Q-12. | |
| 06 | `06-verification-protocol.md` | How to prove each slice: PG15 harness, probes, mutation, census flips, live-application checklist. | |
| 07 | `07-cutover-and-opening-balances.md` | **URGENT.** Tonight/tomorrow runbook for the books side of cut-over; opening-balance design; Sage parallel run. | |
| 08 | `08-target-architecture.md` | The finished enterprise system, tailored to Greenway: subledgers, posting engine, close, tax, reporting, controls. | |
| 09 | `09-slice-plan.md` | Ordered slices S-00…S-40 with file:line targets, acceptance criteria and gates. **The work queue.** | |
| 10 | `10-deferred-and-blocked.md` | What waits on Michael, on documents, or on law. | |
| 11 | `11-enterprise-capability-checklist.md` | "Power of the big boys" — every capability NetSuite/Intacct/QBO-Advanced has, mapped to Greenway status. | |
| 12 | `12-unverified-register.md` | Everything I believe but have not proven, with the probe that would prove it. | |
| 13 | `13-sources.md` | Every URL consulted, with date read. | |

Supporting scripts (committed): `scripts/accounting-bible/build_atlas.py`, `census_matrix.py`,
`probe_autopost.sh`.

---

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

## 0.6 Dates that govern everything

| Fact | Value | Pinned at |
|---|---|---|
| Line in the sand (schema) | 2026-01-01 | 0172:309-314, todo.md rule 10 |
| Opening balance date | **2026-10-31** | 0186 `gl_conversion_config`, cutover-core.ts:73 |
| Cut-over / first platform day | **2026-11-01** | cutover-core.ts:66 |
| Parallel run with Sage | 2026-11-01 → 2026-12-31 | cutover-core.ts:76-77 |
| Superseded opening date (do not use) | 2025-12-31 | cutover-core.ts:84 |
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
