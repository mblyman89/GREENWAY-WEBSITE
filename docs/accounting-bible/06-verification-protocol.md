# 06 — Verification Protocol (how I prove every accounting slice before Michael sees it)

> **Audience: me (the agent).** This part covers how to prove a slice. It does not cover what to build; that is parts 08/09.
> Rule of thumb: **a slice is not done until a gate that would fail on the old code passes on the new code.**
> Every pin below was verified on branch `docs/accounting-bible` at commit `1f3e258a`. Re-verify pins whose lines moved (rule 4).

---

## 0. The five gates (all must be green before a PR, in this order)

| # | Gate | Command | What it catches | Where it runs in CI |
|---|------|---------|-----------------|---------------------|
| G1 | Type check | `npm run typecheck` (= `tsc --noEmit`, includes `tests/`) | wrong shapes and missing exports across the TS posting cores | `compliance-tests.yml` "Type check" step |
| G2 | Lint | `npm run lint` (= `eslint`) | unused imports, `any`, hooks misuse | `compliance-tests.yml` "Lint (compliance scope)" |
| G3 | Pure tests | `npm run test:compliance` (= `vitest run tests/compliance`) **and** `npx tsx scripts/compliance/run-pure-selftests.ts` | the logic inside every `*-core.ts` | `compliance-tests.yml` lines 50-53 |
| G4 | SQL in real Postgres | `bash scripts/accounting/verify-*.sh` (PG15, throwaway) **and** `npx tsx scripts/compliance/verify-migrations-execute.ts` | an RPC that refuses, an RLS hole, a non-idempotent migration | `migrations` job in `compliance-tests.yml` (~lines 170-237) |
| G5 | Build | `npm run build` (= `NODE_OPTIONS=--max-old-space-size=7168 next build`) | client-bundle impurity (`node:fs` in client chunks), server/client boundary | `build` job (standing rule 65 comment at ~line 239) |

**Merge gate (AGENTS.md:54):** CI `build`, `compliance` and `migrations` must be green. After merge, check that production is green with
`gh api repos/mblyman89/GREENWAY-WEBSITE/commits/<sha>/status --jq '.statuses[]|select(.context=="Vercel – greenway_website")|.state'`.
Never read the combined `.state`, which is permanently `failure` while staging is paused.

**Commit identity is a gate too.** CI runs `scripts/compliance/verify-commit-authorship.ts`. Every commit must be
`Greenway Dev <dev@greenwaymarijuana.com>`. I use
`git -c user.name="Greenway Dev" -c user.email="dev@greenwaymarijuana.com" commit ...` every time.

**Verbatim quotes are a gate.** `scripts/verify-verbatim-quotes.ts` (rule 24/35) runs in CI. Any owner quote I put in a code comment must match its source.
In this bible, every OD-xx quote in part 05 was copied, not paraphrased.

---

## 1. Inventory of what already exists (reuse it; do not rebuild it — rule 4)

### 1.1 PG15 SQL verifiers in `scripts/accounting/` (verified listing)

| Script | Migrations it loads | Test SQL it runs | Proves |
|---|---|---|---|
| `verify-gl-schema.sh` | 0172 (twice = idempotent) | `gl-schema-tests.sql`, `gl-seed-checks.sql` | balanced-only, immutability of posted lines, numbering |
| `verify-coa-schema.sh` | 0172, 0173 | `coa-schema-tests.sql`, `coa-seed-checks.sql` | 120-code seed of 0173, parent/child integrity |
| `verify-posting-service.sh` | 0172-0174 | `posting-service-tests.sql` | idempotency on (entity, source_kind, source_ref), GL_POST_CONFLICT |
| `verify-trial-balance.sh` | 0172-0175 | `trial-balance-tests.sql` | TB = 0, periods seeding (0175:567-576) |
| `verify-opening-balances.sh` | 0172-0176 | `opening-balance-tests.sql` | OB worksheet, bless, 40400 plug (N-06) |
| `verify-owner-override.sh` | 0172-0177 | `owner-override-tests.sql` | override and the opening_balance self-approval exemption |
| `verify-fixed-assets.sh` | 0172-0178 | `fixed-assets-tests.sql` | 21xxx block, depreciation schedule |
| `verify-inventory-audit-post.sh` | 0191, 0192 (+harness) | `inventory-audit-post-*.sql` | audit posting (migration-stock-core counterpart) |
| `verify-shareholder-roster-fix.sh` | 0172 … 0205 | — | roster correction |
| `verify-empty-roster-guard.sh` | 0172, 0205, 0206 | — | ownership requires roster |
| `prove-books-lockout{,-part2,-part3}.sh` | 0185 era | — | owner-only lockout (`is_owner()`) |
| `prove-gl-indelible.sql` | — | — | posted rows cannot be updated or deleted |
| `sql-editor-context-tests.sql` | — | — | behaviour when `auth.uid()` is null (the SQL editor) — **relevant to part 07's periods insert** |
| `gl-schema-harness.sql` | — | — | Supabase stand-in: roles anon/authenticated/service_role, auth schema, is_admin helpers. **Never run in prod.** |

**Coverage gap (verified):** no `verify-*.sh` loads **0185-0190, 0209, 0211, 0212, 0238, 0240, 0316 or 0318**.
Those are owner-only, cutover config, vendor bills→GL, payroll→GL, bank matching, owner-only financial tables, factory reset (and its 0238/0240 revisions), self-approval, deposit bags, deposit-bag custody and supply runs.
CI's `verify-migrations-execute.ts` proves they **apply**. It does not prove they **behave**.
Every slice that touches one of them must add a behavioural verifier, named `verify-<topic>.sh` with a matching `<topic>-tests.sql`.

### 1.2 The bible's own probes (`scripts/accounting-bible/`)

| Script | Purpose |
|---|---|
| `probe_autopost.sh` | **P-01.** Spins up PG15 on port 5499, loads harness+0172-0175, calls `gl_submit_journal(... auto_post=true, template=null)`. The result is GL_AUTOPOST_NO_TEMPLATE, which is the proof of N-01. It is also the template for every new probe. |
| `build_atlas.py` | Regenerates 03-code-anchor-atlas.md. |
| `census_matrix.py` | Regenerates the census matrix in part 04. |

### 1.3 Pure self-tests

- `scripts/compliance/run-pure-selftests.ts` imports **1,776 lines** of `__run…Tests` registrations across the repo. About 40 of them are accounting cores, including refund-journal, sale-journal, posting, cutover, cutover-inventory, vendor-bill, deposit-clearing, card-payment, bank-match, migration-stock and related-party-loan.
- `tests/compliance/` has **994** `*.test.ts(x)` files. The accounting-relevant ones include `sale-journal-core.test.ts`, `receipt-journal-core.test.ts`, `gl-refusal-core.test.ts`, `journal-advisor-core.test.ts`, `journal-specimen.test.ts`, `account-classification.test.ts`, `account-type-single-truth.test.ts`, `s29-accounting-tab.test.tsx` and `r19-quiet-accounting.test.tsx`.
- **Accounting cores that have NO `__run…Tests` registration** in run-pure-selftests.ts (verified by loop). The number in brackets is how many vitest files mention each one:
  basis-aaa-core(3), bo-tax-core(2), cogs-position-core(2), company-identity-core(4), financial-statements-core(6), financial-statements-ui-core(5), interest-core(3), internal-control-core(1), journal-specimen-core(2), learning-path-core(4), learning-path-ui-core(3), period-close-core(7), s-corporation-year-core(3), tax-penalty-core(3), worked-examples-core(1).
  → These are covered by vitest only. That is acceptable, but when I wire one (N-10), I add the `__run…Tests` registration in the same slice so both runners see it.

### 1.4 Mutation campaigns

`scripts/compliance/mutate-slice-books-01.sh` … `-08` (with `.py` twins). Header pattern (verbatim intent): *"MUTANT → a real defect. The gates MUST FAIL… CONTROL → a semantically neutral edit. The gates MUST PASS."*
Each mutant is applied to a scratch copy and reverted with `git checkout`.
**Every money-moving slice I ship gets a `mutate-slice-books-NN` campaign.** The next free number is **09**; check with `ls scripts/compliance/mutate-slice-books-*` first.

---

## 2. The per-slice proof recipe (copy into every slice's PR body)

```
PROOF — S-xx <title>
1. RED first: test/probe that FAILS on main (paste output, with the error code e.g. GL_AUTOPOST_NO_TEMPLATE).
2. GREEN: same test passes on branch (paste output).
3. G1 tsc 0 | G2 eslint 0 | G3 vitest N passed + selftests OK | G4 verify-<topic>.sh PASS + migrations-execute PASS (incl. re-apply) | G5 next build OK.
4. Mutation: mutate-slice-books-NN — K mutants killed / K, C controls quiet / C.
5. Money invariants (section 3) — each listed with the assertion that checks it.
6. Census flip: ledger-census-data.ts row <id> status <old> → <new>, evidence line <file:line>.
7. DEFECTS UPDATE block (rule 131) appended to DEFECTS.md.
8. Owner-run step (if any): exact SQL, read-only first, with expected result shown.
```

**Rule 133 (no half-wiring):** a slice that adds a template must also make a caller pass it, and prove that a posted (not draft) journal results end to end in PG15.
A core that is merely importable is not wired; reachability from `src/app` is the test (section 5).

---

## 3. Money invariants (every posting slice asserts the applicable ones)

| ID | Invariant | How to assert |
|---|---|---|
| INV-01 | Every journal balances: Σ amount_cents = 0 (integer cents, never floats) | pure test on the core's line builder, plus PG15 (0172 refuses unbalanced) |
| INV-02 | Idempotency: re-submitting the same (entity, source_kind, source_ref) with the same lines returns the same journal id; different lines → GL_POST_CONFLICT | PG15 call twice; third call with altered lines expects the error |
| INV-03 | No plug (rule 27): no line to 40400/89xxx/"suspense" unless the slice is the OB bless (N-06, recorded) | grep test over the core's output account codes |
| INV-04 | Trust liabilities never hit revenue: excise 20xxx-liability / sales tax / tips / loyalty go to their liability accounts | pure test: revenue account total equals the pre-tax net |
| INV-05 | Excise 37% is on the selling price (RCW 69.50.535) and is computed as the tax-inclusive divisor 14630 in millionths (rule 114) | pure test with a golden ticket; medical-exempt line ⇒ 0 excise **and** 0 sales tax (N-09) |
| INV-06 | Period exists and is open for the entry date, unless source_kind=opening_balance (0172:780-782) | PG15: post into a closed/locked period → `GL_PERIOD_CLOSED` (0172:793); missing → `GL_NO_PERIOD` (0172:789); reopen a locked period → `GL_PERIOD_LOCKED` (0172:946) |
| INV-07 | Draft vs posted: autopost-eligible kinds land **posted** with a gapless journal_no; drafts have journal_no null (0172:319) | PG15 select journal_no is not null after autopost |
| INV-08 | Owner gate: a non-owner authenticated user cannot read or post gl_* (0185) | PG15 `set role authenticated` with a non-owner sub → permission/RLS refusal |
| INV-09 | Pacific-time dating: a sale at 23:30 PT on the 31st books on the 31st, not on the 1st UTC | pure test with explicit `America/Los_Angeles` |
| INV-10 | Subledger = GL control: Σ open vendor bills = 22xxx AP; Σ lots × unit_cost = 200xx inventory; Σ undeposited bags = clearing | read-only reconciliation query, shown in the PR |
| INV-11 | Reversal is a new journal with negated lines that links to the original; the original is never edited | PG15 (prove-gl-indelible.sql pattern) |
| INV-12 | Every 280E-relevant line is classified COGS (26 CFR 1.471-3/-11 inventoriable) vs non-deductible | pure test on lot-cost-classification-core / payroll-cogs-core output |

---

## 4. Proving SQL without touching production

1. **Template:** copy `scripts/accounting-bible/probe_autopost.sh`. Change the port, the migration list and the `q.sql` heredoc. Always use `\set ON_ERROR_STOP 0` inside probe queries so that an expected refusal prints instead of aborting.
2. **Order of loading:** harness → 0172 → 0173 → 0174 → 0175 → … in numeric order. For anything after 0178, simplest is `verify-migrations-execute.ts` against a local PGURL (it applies all ~328). Then run probe SQL against that database.
3. **Acting as owner:** `select set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', false);`. The harness's `is_admin()`/`is_owner()` stand-ins key off this sub. Re-read the harness when 0185's `is_owner()` matters; the harness predates 0185.
4. **Acting as the SQL editor:** leave claims unset, so `auth.uid()` is null. This is what Michael's paste does. `sql-editor-context-tests.sql` shows which RPCs refuse (e.g. `gl_open_fiscal_year`). That is why part 07 gives him a plain idempotent INSERT for periods.
5. **Never:** connect to production from the sandbox, or put the harness into `supabase/migrations/`.

### 4.1 Read-only production queries (Michael runs them; I only write them)

Rules for any SQL I hand Michael:
- **SELECT-only unless the slice says otherwise.** Label it "READ-ONLY" in the first comment line.
- Show the **expected** result next to it, so he can tell me "matches" or paste the difference.
- Any write SQL must be idempotent (`insert … on conflict do nothing`, `create … if not exists`) and must survive a second paste. CI re-applies the last migration to prove the same property.
- Migrations that need the SQL editor and are long or contain `$$` get an `editor-safe/*.EDITOR_SAFE.sql` twin (see `supabase/migrations/editor-safe/0195…0202`). The 0195 incident showed that SQL can get mangled in transit.

Standing read-only checks (queued in part 12 as U-xx):

```sql
-- READ-ONLY U-01: which posting templates exist live? (table: 0174 gl_posting_templates)
select t.code, e.code as entity, t.source_kind, t.*
from public.gl_posting_templates t join public.gl_entities e on e.id = t.entity_id
order by 2, 3;
-- READ-ONLY U-02: periods present per entity/year (table: 0172 gl_periods; entity is entity_id uuid)
select e.code as entity, p.fiscal_year, count(*), min(p.start_date), max(p.end_date),
       count(*) filter (where p.status <> 'open') as not_open
from public.gl_periods p join public.gl_entities e on e.id = p.entity_id
group by 1,2 order by 1,2;
-- READ-ONLY U-03: was 0211 applied? (table: 0174 gl_approval_policy)
select count(*) filter (where allow_self_approval) as self_ok, count(*) as total
from public.gl_approval_policy;
-- READ-ONLY D-day: drafts piling up (N-03) (gl_journals.journal_date, not entry_date)
select source_kind, status, count(*) from public.gl_journals
where journal_date >= date '2026-11-01' group by 1,2 order by 3 desc;
```
(Table and column names were verified against 0172/0174 `create table` statements on 1f3e258a: gl_posting_templates, gl_periods(entity_id, fiscal_year, period_no, start_date, end_date, status), gl_approval_policy(allow_self_approval), gl_journals(journal_date, journal_no, status, source_kind, source_ref). `gl_entities.code` is verified at 0172:75-76 (greenway|atm|landholding|personal).)

---

## 5. Reachability proof (N-10 / rule 50 / rule 133)

"Wired" means reachable by import from `src/app/**` or `src/middleware`. Method (the logic of /tmp/reach.py, to be saved as `scripts/accounting-bible/reachability.py` in the docs PR):
walk `src` for `.ts/.tsx` → regex `(?:from|import)\s*\(?\s*['"]([^'"]+)['"]` → resolve `@/`→`src/` and relative paths (+`.ts`,`.tsx`,`/index.*`) → DFS from every file under `src/app` and from `src/middleware.ts` → list `src/lib/accounting/*` not reached.
Baseline: **91 of 111 reachable, 20 unreachable.** Every slice that wires a dead core must show the count dropping, with the named module leaving the list.

---

## 6. Census and DEFECTS discipline

- `src/lib/accounting/ledger-census-data.ts` is the census, and is itself unreachable from `src/app` (part 04).
  A row may change status only with an `evidence:` file:line that a reviewer can open. Per N-04, the census must distinguish **approval-exempt** from **autopost-eligible**; S-00 adds that column first.
- DEFECTS.md: every slice appends a `DEFECTS UPDATE` block (rule 131) naming the D-xx closed or opened, with pins.
  Refusals (rule 134) are recorded as well, e.g. "I did not wire X because Q-07 is unanswered".

---

## 7. What "done" looks like for the whole accounting branch (exit criteria)

1. Probe P-01 inverted: autopost with a template → posted, journal_no assigned, for every one of the system-originated kinds (sale, refund, drawer close, safe bag, deposit, card settlement, supply run, vendor bill, payroll, count adjustment).
2. Zero drafts older than 1 business day except human-entered manual journals.
3. Daily: Σ sales subledger = GL revenue + trust liabilities; Σ deposits = bank feed (Plaid) within tolerance 0 after clearing.
4. Monthly close checklist (part 11) runs green: TB=0, every control account reconciled, 20890 clearing = 0, excise return (LIQ-1295, due the 20th) equals the GL excise liability rollforward, DOR combined excise return (due the 25th) equals the GL sales-tax liability and B&O base.
5. Year-end: 1120-S support (S-27), Form 7203 basis per shareholder, 280E COGS position (S-20), fixed-asset rollforward (S-25).
6. Reachability: 0 unreachable accounting modules, or each remaining one listed in part 10 with a reason.
7. Every verifier gap in §1.1 is closed by a behavioural `verify-*.sh`.
