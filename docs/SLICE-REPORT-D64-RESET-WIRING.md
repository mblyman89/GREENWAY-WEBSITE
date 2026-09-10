# Slice report — D-64: the factory reset button was wired to the old reset

**Question asked:** *"Before I reset, will you confirm that we don't need to update the reset since we last updated it?"*

**Answer:** The reset's **rules** did not need updating. Its **wiring** did. The button ran the superseded function, which would have left the entire general ledger on your books.

---

## 1. What I checked, and what each check measured

Everything below was measured from the files on disk. Nothing was taken on trust.

| Check | Result |
|---|---|
| Migrations on disk | **224** (0001–0224); the reset was built at 0209, so **15 migrations ago** |
| Tables in the schema | **258** |
| Tables with no reset rule (the D-62 failure mode) | **0** |
| Plan resolution | **138 WIPE / 120 KEEP**, no refusals |
| Tables created after 0209 | **8**, all classified: `employee_provisioning_policy`, `deposit_bag_sessions`, `deposit_bags`, `announcer_devices`, `announcer_pairings`, `announcer_queue`, `announcer_settings`, `announcer_sounds` |
| SQL ↔ rules parity | **138 WIPE tables ↔ 138 DELETE statements**, no gaps either direction |
| Foreign keys parsed | **440 edges** |
| KEPT rows left pointing at WIPED rows | **0** |
| Blocking delete-order edges (RESTRICT) | **5**, every child deleted before its parent — correct |
| Ledger immutability escape hatch | Intact; no migration after 0209 re-creates the triggers it works around |

**So the answer to the staleness question is no — the rules had not rotted.** The drift guard that fails the build when a table is unclassified has been holding across all 15 newer migrations.

---

## 2. The defect that audit found instead (D-64)

The rules were current and the SQL matched them. Nothing checked the third link — **the button**.

```
src/app/admin/settings/reset/page.tsx
  -> resetOperationalDataAction()             settings/actions.ts:194
  -> resetOperationalData()                   lib/admin/reset-service.ts:49
  -> supabase.rpc("reset_operational_data")   <- the 0069/0097/0140 function
```

`gl_factory_reset` — the function built in migration 0209 to fix D-62, tested, reviewed and merged — appeared in **zero lines of application code**.

**Measured consequence:**

| | tables |
|---|---|
| The rules say should be emptied | 138 |
| `reset_operational_data()` actually deletes | 66 |
| **Would have survived a "factory reset"** | **72** |

Among the 72 survivors:

`gl_journals`, `gl_journal_lines`, `gl_periods`, `gl_audit_events`, `gl_opening_balances`, `gl_bank_matches`, `gl_bank_reconciliations`, `gl_override_log`, `gl_payroll_allocations`, `gl_template_changes`, `gl_account_proposals`, `gl_classification_suggestions`, `pay_periods`, `payroll_ytd_accumulators`, `sick_leave_ledger`, `sick_leave_requests`.

That is the **whole general ledger** plus the **year-to-date payroll figures a W-2 is computed from**. You would have pressed reset, been told it succeeded, and carried rehearsal numbers into your first real year — the exact outcome D-62 was raised to prevent, reached by a different route.

This is why the instruction was "test the reset first." Had you run it and only spot-checked sales and inventory, it would have looked like it worked.

### A second defect in the same screen

The reset page described itself with two **hand-typed lists** of category names. They were accurate for the old function. They never mentioned the general ledger. So the screen was also telling you the wrong thing about what it was going to do.

---

## 3. What was changed

**`src/lib/admin/reset-service.ts`** — rewritten to call `gl_factory_reset`, plus `gl_factory_reset_preview` (read-only evidence) and `gl_audit_factory_reset` (post-reset verification).

It now uses **your signed-in session, not the service-role key**. This matters and is not a style choice: `gl_factory_reset` gates on `is_owner()`, which reads `auth.uid()`. The service-role key carries no user, so `auth.uid()` is NULL and `is_owner()` is false. Calling the reset with the admin client would have failed with `RESET_NOT_OWNER` **100% of the time**, no matter who was signed in. That is the identical defect already diagnosed and written up in `books-client.ts`, where the master key made every books screen refuse you personally.

**`src/app/admin/settings/actions.ts`** — routes to the new function; forwards the typed phrase **verbatim**. The old action upper-cased before comparing; the SQL trims but does **not** upper-case, so upper-casing would accept phrases the database then rejects, and would let a casual "erase all test data" count as deliberate intent for the most destructive operation in the system. It also now runs the post-reset audit automatically and surfaces any problem to you. *"It said it succeeded"* is precisely the assurance that let D-62 sit unnoticed.

**`src/app/admin/settings/reset/page.tsx`** — the two hand-typed lists are gone. The screen now computes its counts from the same decision layer the SQL is tested against, so it cannot describe a reset different from the one the button runs. It also shows the four evidence counts **before** you type anything.

**`src/lib/admin/schema-tables.ts`** (new, generated) + **`scripts/generate-schema-tables.ts`** — the screen needs the real table list at runtime, and reading `supabase/migrations` works locally but fails on Vercel where the SQL files are not deployed. It is generated, not typed, and a test fails the build if it drifts from disk in either direction.

**Confirmation phrase changed** from `RESET OPERATIONAL DATA (WAC 314-55-087)` to **`ERASE ALL TEST DATA`** — because that is what migration 0209 actually compares against. The old screen asked for a phrase the new function would have refused.

---

## 4. Three things the reset cannot reach

A reset that works table by table structurally cannot touch these. All three verified against migration 0209, and all three are now stated **on the screen** rather than left for you to discover:

1. **Uploaded files stay in storage buckets.** Emptying `manifest_documents`, `payroll_source_documents` and `sage_import_uploads` deletes the rows that point at the files, not the bytes. Tidy `intake-docs`, `sage-imports` and `pos-raw` by hand if you want the space.
2. **Login accounts in Supabase Auth are not deleted.** Deliberate: `employees` and `staff_profiles` are both KEEP, so wiping the logins underneath them would orphan your staff rows and lock you out. Delete throwaway test logins yourself.
3. **Auto-numbering counters do not restart.** Harmless — every table with one is either KEEP (where continuing is correct) or transient (where nobody sees the number). Order numbers are text with no sequence, and `gl_journal_sequences` is **kept on purpose** so a real journal entry can never reuse a rehearsal entry's number.

**None of the three can put a wrong number on a report or a tax form.**

---

## 5. Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | **0 errors** |
| `eslint` | **0 problems** |
| Full suite | **606 files, 15,533 tests, 0 failures** |
| This slice's tests | 45 → **78** |
| Mutation campaign | **23/23 killed** |

### Testing the tests

The first mutation run left **two survivors**: rewriting the phrase gate to `if (false)` and deleting the post-reset audit call both left the suite green. The tests could only grep the server action's source text, and the identifiers were still sitting there — a test that cannot tell a live guard from a dead one is decoration.

Per the standing preference, the mutants were **not weakened**. The decisions were extracted into pure functions (`evaluateResetRequest`, `summariseResetOutcome`) where they can be executed, and re-run reached 23/23.

Two mutants are recorded as **equivalent** and excluded rather than hidden: one inserts only a comment (a control proving the harness works), and one deletes an RPC call that cannot be executed in a unit test — the guard that its *result* is surfaced is asserted by execution instead.

### The guards now permanent in CI

The three cross-checks I ran by hand during this audit are now tests, so they run on every commit rather than only when someone thinks to look:

- the button calls the **current** function, and no file anywhere routes to the superseded one
- the runtime table snapshot matches the migrations exactly
- no KEPT table references a WIPED table (440 FK edges, balanced-paren parsed)
- every blocking delete happens child-before-parent
- the confirmation phrase in the app matches the phrase in the SQL
- the three blind spots are **really** blind spots (asserted against 0209, so if a future migration fixes one, the docs must be corrected rather than left overstating the limit)

**A note on the FK parser.** My first version used a naive regex and reported an edge from `gl_payroll_labor_roles` to `inbound_manifests`. I checked it against the DDL before reporting it: that table has no `references` clause at all — the regex had leaked past the end of the `create table` block. The parser now walks parentheses to find the true block end, and there is a test asserting that specific false positive cannot come back. I mention it because it would have been easy to hand you a "finding" that was an artefact of my own tooling.

---

## 6. What this means for your reset

**Apply nothing new.** Migration 0209 was already correct and you may already have applied it. If you have not, apply `supabase/migrations/0209_factory_reset.sql` in the SQL editor — the screen will tell you plainly if the function is missing rather than failing obscurely.

Then run the reset from **Settings → Factory reset** and check:

- the two lists show **138 emptied / 120 kept**
- the four evidence figures look right before you commit
- the phrase is `ERASE ALL TEST DATA`
- the success line mentions the general ledger
- **no `WARNING` follows it** — the post-reset check runs automatically and reports only problems
- the books show a blank trial balance; your login, chart of accounts, knowledge base, vendors and brands all survive

Step-by-step in `docs/BATTLE_TESTING_CHECKLIST.md` §0a.
