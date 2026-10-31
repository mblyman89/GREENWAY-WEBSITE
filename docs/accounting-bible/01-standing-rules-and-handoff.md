# ACCOUNTING BIBLE — 01 · STANDING RULES DIGEST AND HANDOFF

> These are **summaries with pins**. The binding text is the source: `AGENTS.md` (193 lines) and
> `todo.md` (3,577 lines, **append-only**, rule 32). When a summary here and the source disagree, the
> source wins, and this file is wrong. Fix it.

---

## 1.1 AGENTS.md — the repository-wide rules (all binding)

| # | Rule (short) | Pin | What it means for accounting slices |
|---|---|---|---|
| 1 | Record every request verbatim | AGENTS.md:12 | Every owner instruction goes into the slice doc and, when it is a fact, into `OWNER_STATED_FACTS` (todo rule 100). |
| 2 | Deep-research, never guess, cite | :13 | Every rate, threshold and deadline cites part 02/13. A literal with no citation is a defect. |
| 3 | Machine output is drafts only | :14 | Bank-feed classification, AI category guesses and the Cultivera import **propose**; a human posts. This is why `bank` is autopost-eligible only through an approved template. |
| 4 | Walk the tree; reuse | :15 | Before building anything, grep part 03. Almost every core already exists (rule 50 list in 04 §4.6). |
| 5 | 6 slices at a time; ground → pure core + `__run…Tests()` → tsc 0, eslint 0, `next build` OK → branch → PR → rebase-merge | :16 | The slice shape in part 09 follows this exactly. |
| 6 | `main` protected; **rebase merge only**: `gh pr merge <n> --rebase --delete-branch --admin`; **never squash** | :17-27 | Squash rewrites the author to `superninja-app[bot]` and Vercel BLOCKS. After merge: `git fetch origin && git reset --hard origin/main`. |
| 7 | Every commit authored `Greenway Dev <dev@greenwaymarijuana.com>` | :29-36 | Set it before the first commit of every session. Enforced by `scripts/compliance/verify-commit-authorship.ts`. |
| 8 | Money in minor units | :37 | `bigint` cents in SQL, `number` (safe-integer-checked) cents in TS. Rates in **millionths** for B&O (todo 114), **milli-percent** for tolerances (0174:145). |
| 9 | Pacific time is the business clock | :38 | Journal dates, period boundaries, the "business day" for drawer/bag/deposit posts are all `America/Los_Angeles`. UTC dates are a defect. |
| 10 | Prefer narrative updates; `ask` only for essential decisions | :39 | |
| 11 | Receiving intake is the only way products enter; Cultivera import is one-time | :40-45 | The inventory-receipt → GL path is permanent infrastructure. The cut-over load is a **one-time opening_balance**, never a purchase (D-48). |
| 12 | Vercel Pro; crons ≤ 1/min, idempotent, claim-locked; a tick is a request to consider | :46-52 | Every accounting cron (S-30 onward) must claim in a table (compare-and-swap / insert-then-verify), be redundant across skipped ticks, and keep timing decisions in a pure core. Cadence pinned by `tests/compliance/leafly-certification.test.ts`. |
| 13 | Staging paused; production is the only deploy gate | :54-60 | Merge gate: CI `build`, `compliance`, `migrations` green. Verify prod via the `Vercel – greenway_website` status context. |
| 14 | `/workspace` is mine; commit and push early and often | :62-66 | Push after every step; the sandbox has been reset mid-session before. |

Also in AGENTS.md: CCRS compliance block (:62-153, read `docs/ccrs-bible/00-INDEX.md` before touching CCRS code) and DOH medical compliance (:155+). Accounting slices that touch inventory movement (receipt, adjustment, destruction) **are** CCRS-adjacent. Read the CCRS bible's part 04 before editing `inventory-audit-store.ts` or the receiving door.

## 1.2 todo.md — bookkeeping standing rules (the ones that bind this branch)

Index file: `/workspace/notes/rules_index.txt` (142 rules with line numbers). The critical ones, grouped:

### A. Truth and evidence
| Rule | Pin | Essence |
|---|---|---|
| 1 | todo.md:4 | Never guess. Verify from authoritative sources or actual data. |
| 2 | :5 | **Drift = catastrophic.** Any drift between books and reality (Sage, bank, count) is the worst outcome. |
| 3 | :8 | Stop and talk to Michael (`ask`) if anything feels off. |
| 11 | :29 | Opening balances come from **evidence** (bank statements, counts, lender statements), never from Sage's drifted balances. |
| 12 | :32 | Every assumption is logged where it applies (`assumption_note` column exists on journals and OB rows). |
| 24 | :311 | Verbatim authority or no feature. |
| 35 | :450 | Verbatim must be mechanically verified. |
| 59 | :953 | A printout is not a filing; rank the evidence. |
| 100 | :2443 | Record the owner's spoken facts **in the repo**, together with the document that would prove them. |
| 109 | :2700 | The owner's filed documents are evidence, never authority. |
| 115 | :2909 | A filed return is the best authority there is, and it must be reconciled. |

### B. Refuse, never plug
| Rule | Pin | Essence |
|---|---|---|
| 14 | :62 | Gate everything, lock everything, block everything. |
| 27 | :360 | **Refuse, don't warn; never, ever plug.** (The OB bless does plug residuals to 40400 *with an assumption note*. That is the designed OBE mechanism, but the slice must surface any non-zero plug as a blocker, not a success. See 07 §7.6.) |
| 46 / 96 / 135 | :623, :2371, :3374 | **Zero is an answer; missing is a question.** A total of 0 because nothing was read must never render as $0.00. |
| 51 | :733 | A write that can be blocked without error must be counted. |
| 134 | :3325 | A refusal that is not written down did not happen. Every ledger refusal lands in `audit_log`/`order_events`. |
| 136 | :3421 | An event with no economic consequence must say so. |

### C. Wiring and dead code
| Rule | Pin | Essence |
|---|---|---|
| 16 | :87 | Prove the gate is wired, not merely registered. |
| 40 | :513 | An unreachable guard is an untested guard. Give it a door. |
| 43 | :561 | A refusal code no code path emits is not protection. |
| 50 | :713 | **A module that only its own test imports is dead code wearing a green check mark.** |
| 56 | :853 | An exported server action with no caller is a door nobody guards. |
| 63 | :1122 | **One platform, one ledger.** Every subsystem is a feeder to the books. |
| 92 | :2305 | A feature gated on data that does not exist yet does not exist. |
| 133 | :3270 | **Nothing ships half-wired** (books-89). Builder + caller + screen + refusal surfacing in one slice. |
| 140 | :3507 | A half-loop is a defect, not a milestone. |

### D. Testing discipline
| Rule | Pin | Essence |
|---|---|---|
| 13 | :35 | Real-world battle testing before shipping; for SQL, run it on **real PG15**. |
| 15 | :70 | Every test proven capable of failing (negative control). |
| 22 / 23 / 33 | :236, :274, :428 | Test the tests; try hardest to break it; attack after green. |
| 38 | :487 | A green suite on the first run is suspect. |
| 49 | :689 | When right and wrong return the same value today, test the structure. |
| 58 | :911 | A test that reads SQL as text has not run the SQL. |
| 72 / 99 / 112 / 138 | | Mutation discipline: a mutation that never applied accuses an innocent gate; equivalent mutants are replaced. |
| 107 | :2663 | Ask Postgres what it permits before designing around belief. |
| 129 / 130 | :3213, :3235 | One assertion per risk. Measure once, in code. |
| 137 | :3452 | A probe with an ambiguous anchor is not a probe. |
| 139 | :3491 | Fixing the test is not fixing the code. |
| 141 | :3531 | Source-text tests are a last resort. |
| 142 | :3547 | A fix that restates the bug's own assumption is not a fix. |

### E. Process
| Rule | Pin | Essence |
|---|---|---|
| 21 | :204 | The books-slice method is law. |
| 26 | :346 | The mentor layer is mandatory. Michael is being taught (lessons are cited and computed, rule 82). |
| 29 | :393 | Plain English is a deliverable. |
| 30 | :400 | **Mandated build order** for the tax chain: 1 statements → 2 period close → 3 basis/AAA → 4 1120-S/K-1 → 5 1040/§199A → 6 941/940/W-2/W-3 → 7 B&O → 8 forms builder. (Feeder wiring, which is this bible's main subject, sits *under* item 1. Statements are only true if the feeders post.) |
| 31 | :419 | Continuity: every commitment goes in a tracked file. |
| 32 | :479 | **Never overwrite todo.md. Append only.** |
| 62 | :1089 | Build for the slice after next. |
| 73 | :1938 | Two documents describing one plan is how a plan forks. **This bible's slice plan (09) must be cross-referenced from `docs/BOOKS_ROADMAP.md` when adopted, not duplicated.** |
| 114 | :2874 | Tax rates may be finer than a basis point. Use millionths. |
| 128 | :3193 | Three-line docblock: prose is capped. |
| 131 | :3246 | **Defect register = `docs/DEFECTS.md`.** Write each finding once. (N-xx findings in this bible must be entered there as D-83+ by the first slice that touches them.) |
| 132 | :3253 | Slice shape and the stop rule. |

## 1.3 Session-start checklist (do every time)

```bash
cd /workspace/GREENWAY-WEBSITE
git config user.name "Greenway Dev"; git config user.email "dev@greenwaymarijuana.com"
git fetch origin && git status -sb && git log --oneline -5 origin/main
# 1. Has anything landed in accounting since this bible (aa1f7a8a)?
git log --oneline aa1f7a8a..origin/main -- src/lib/accounting supabase/migrations src/app/admin/books docs/DEFECTS.md | head -50
# 2. Newest defects
grep -n "^## D-" docs/DEFECTS.md | tail -10
# 3. Re-verify the five fires (part 00 §0.2) are still true:
grep -n "autoPost: true" -r src/lib                    # N-01: expect the 5 sites until S-01
grep -rn "templateCode" src/lib --include=*.ts | grep -v posting-core   # N-01 fix evidence
grep -rn "gl_open_fiscal_year" src | head              # N-02: expect empty until S-02
grep -n "autoPost" src/lib/accounting/sale-posting-service.ts   # N-03
grep -n "owner_override\|opening_balance" src/lib/accounting/approval-core.ts  # N-05
grep -rn 'sourceKind: "opening_balance"\|gl_bless_opening_balances' src | head  # D-47/48
```

## 1.4 Slice ritual (per AGENTS.md rule 5 and todo rule 21/132)

1. `git checkout -b books-NNN-<slug>` off fresh main.
2. Write the slice header doc (verbatim request if any, defects addressed, files to touch from 09).
3. Pure core first (`*-core.ts` + `__run…Tests()`), with a negative control for every assertion.
4. Migration (if any): idempotent (`create or replace`, `if not exists`, `on conflict do nothing`), ordering guard (0211:62-81 pattern), **run on PG15** via the harness (06 §6.2). The owner applies it manually in the Supabase SQL editor. Write the exact paste order in the PR body.
5. Service + caller + screen + refusal surfacing in the same slice (rule 133).
6. Census row flipped with evidence (`ledger-census-data.ts`), and the test that pinned the "MISSING" state inverted rather than deleted (D-67 precedent).
7. DEFECTS.md: append the RESOLVED block under the original entry; never edit the history away.
8. `npx tsc --noEmit` = 0, `npx eslint .` = 0, `npx next build` OK, the vitest suites pass, mutation probe log saved.
9. Commit (authored per rule 7), push, PR, wait for `build`/`compliance`/`migrations`, then `gh pr merge <n> --rebase --delete-branch --admin`, reset main, and verify the prod status context.
10. Owner report in plain English (rule 29): what changed, what he must apply (migration paste order), what he must click, and what is still not proven.

## 1.5 Recovery commands

```bash
# Sandbox reset: re-clone (part 00 §0.7). Bible branch:
git fetch origin docs/accounting-bible && git checkout docs/accounting-bible
# Push (token form used in this session):
git push -q https://x-access-token:$GITHUB_TOKEN@github.com/mblyman89/GREENWAY-WEBSITE.git HEAD
# PG15 lives at /usr/lib/postgresql/15/bin; run as postgres:
su postgres -c "/usr/lib/postgresql/15/bin/pg_ctl --version"
# If a shell session goes silent (seen this session after a long sed), open a new session name.
```

## 1.6 Things I must never do on this branch

- Never squash-merge; never push to main; never commit as anything but Greenway Dev.
- Never overwrite `todo.md` (append only).
- Never invent an opening balance, a unit cost, a rate or a due date.
- Never add `autoPost: true` without a seeded, approved template, a stable `sourceRef` and a PG15 probe proving that both acceptance and refusal work.
- Never let a ledger failure block a sale, a drawer reconcile or a receipt (existing pattern: orders-store.ts:915-937, registers/actions.ts:246-250). Record it; never swallow it.
- Never touch the `gl_journals_line_in_the_sand` CHECK (0172:313) on a table with live rows.
- Never "fix" a posted entry by editing it. Use reversal (`gl_reverse_journal`, 0172:826) plus a corrected entry (ASC 250 for error corrections).
- Never treat the census as a test. It is evidence. Each flip needs real evidence text.
