# SECURITY AUDIT — `is_admin()` AND THE ADMIN ACCESS CONTROL MODEL

**Subject:** Greenway Marijuana back-office application (`GREENWAY-WEBSITE`)
**Scope:** The database-level admin gate `public.is_admin()`, the roles that feed it,
every place it is relied upon, and every path that could bypass it.
**Audit type:** Substantive testing (execution-based), not inquiry or observation.
**Commit audited:** `f4f58b13` (merged `main`)
**Report date:** August 2026
**Prepared for:** Michael (Owner)

---

## HOW TO READ THIS REPORT

Every claim in this document is one of exactly two things:

1. **Anchored** — it points at a real file and line number you can open yourself, or
2. **Executed** — it was proven by running code against a real database and observing the result.

Nothing here is assumed, inferred, or remembered. Where I previously carried a number
in my head that turned out to be wrong, I corrected it and said so (see Appendix D).

Severity ratings follow standard audit practice:

| Rating | Meaning in plain English |
|---|---|
| **CRITICAL** | Money or regulated data can be reached by someone who should not reach it, today, with no special skill. |
| **HIGH** | A real weakness that requires a small extra step or a specific condition to exploit. |
| **MEDIUM** | Weakens the control environment; not directly exploitable alone. |
| **LOW** | Hygiene. Worth fixing, not worth losing sleep over. |
| **POSITIVE** | A control that was tested and *held*. |

---

## 1. EXECUTIVE SUMMARY

### 1.1 The one-paragraph version

The admin gate itself is **sound**. `is_admin()` is defined exactly once, has never been
edited since the day it was written, correctly refuses fired staff, correctly refuses
demoted staff, correctly ignores attacker-supplied signup data, and cannot be tricked by
the classic PostgreSQL schema-hijack attack. I tried to break it eleven different ways and
it held all eleven times. **The problem is not the lock. The problem is which doors have
that lock on them.** Twenty policies covering your personal banking, your mortgage, your
loans, your crypto and the ATM cash flow are gated with `is_staff()` — meaning *any active
employee*, including a brand-new budtender on their first shift, can read **and write**
them. I proved this by execution, not by reading.

### 1.2 Findings at a glance

| # | Finding | Severity | Proven by |
|---|---|---|---|
| **F-01** | 20 financial-table policies use `is_staff()` (any employee) instead of `is_admin()` — includes bank accounts, mortgage, loans, crypto, ATM | **CRITICAL** | Execution (Attack 11) |
| **F-02** | Service-role client used in 967 places across 208 files; service role bypasses RLS entirely | **HIGH** | Static census |
| **F-03** | Bootstrap-email path in `session.ts` self-promotes a user to `owner` using the service role, gated only by an env var | **HIGH** | Code trace |
| **F-04** | 26 of 41 API routes carry no admin guard; 8 carry no auth markers at all | **MEDIUM** | Static census + manual read |
| **F-05** | `is_admin()` is executable by the `anon` role (PostgreSQL default `PUBLIC EXECUTE`) | **LOW** | Execution (Attack 9) |
| **F-06** | Auto-provision trigger creates new profiles with `active = true` | **LOW** | Execution (Attack 6) |
| **F-07** | `isAdminRole()` exists in app code with zero call sites — dead twin of the DB gate | **LOW** | Static census |
| **F-08** | `search_path` pin on the gate functions is redundant given schema qualification | **INFORMATIONAL** | Mutation testing |

### 1.3 Controls tested that HELD

| Control | Result |
|---|---|
| Single authoritative definition, never modified | **PASS** |
| Fired (deactivated) admin loses access immediately | **PASS** |
| Demoted admin loses access immediately | **PASS** |
| Attacker-controlled signup metadata claiming `role=owner` is ignored | **PASS** |
| Employee cannot promote themselves via direct database write | **PASS** |
| Employee can only see their own profile row | **PASS** |
| Schema-hijack (`search_path`) attack fails | **PASS** |
| Anonymous visitors have no read/write on the deciding table | **PASS** |
| Malformed role values rejected by NOT NULL + enum | **PASS** |
| All 78 server-action files carry a permission guard | **PASS** |
| All 9 General Ledger policies are admin-gated | **PASS** |
| Staff magic-link login cannot create new accounts | **PASS** |

---

## 2. AUDIT METHODOLOGY

### 2.1 Standard applied

This audit follows the structure a Big Four firm uses for an IT General Controls (ITGC)
review of logical access, adapted for a PostgreSQL/Supabase application:

1. **Understand the control** — read the definition, not the documentation.
2. **Define the population** — find *every* instance, not a sample.
3. **Test design effectiveness** — does the control, as written, do what it claims?
4. **Test operating effectiveness** — does it actually behave that way when executed?
5. **Test for bypass** — can the control be routed around?
6. **Validate the test itself** — prove the test can fail (negative control / mutation testing).

Step 6 is the one most reviews skip. A test that cannot fail proves nothing. Every
conclusion below rests on a test I deliberately broke first, to confirm it was watching.

### 2.2 Evidence environment

All execution testing was done against a **throwaway PostgreSQL instance** created for
this audit and destroyed at the end. It was never connected to production. No production
data was read, copied, or modified. The instance reproduced the exact function definitions
verbatim from the migration files, plus a stub of Supabase's `auth.uid()` that reads the
session's JWT subject the same way Supabase's does.

**Why a rebuild instead of testing production:** testing authorization against live data
would require creating real privileged accounts, which is itself the risk being audited.
Reconstructing the control from its source of truth is the standard approach and is
defensible because the reconstruction is verbatim.

### 2.3 Assertion count

- **11 attack scenarios**
- **30 assertions**
- **Result: 30 pass, 0 fail, 0 errors**
- **Idempotency: suite run twice back-to-back, identical result both times**
- **Negative control: mutation applied, suite failed (exit 3); mutation reverted, file
  confirmed byte-identical, suite passed again (exit 0)**

---

## 3. THE CONTROL ITSELF

### 3.1 What `is_admin()` actually is

Anchor: `supabase/migrations/0001_slice1_foundation.sql:138`

```sql
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.staff_profiles
    where id = auth.uid() and active = true and role in ('owner','admin')
  );
$$;
```

In plain English: *"Is the person making this request a currently-employed owner or admin?"*
Three conditions, all required: it's you, you're active, and your role is owner or admin.

### 3.2 Its two siblings

Anchor: `0001_slice1_foundation.sql:133` and `0130_security_rls_hardening.sql:55`

```sql
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.staff_profiles where id = auth.uid() and active = true);
$$;
```

`is_staff()` asks only *"are you any active employee?"* — it does **not** look at role at
all. This distinction is the entire basis of Finding F-01.

`is_manager()` (added later, in migration 0130) covers owner/admin/manager.

### 3.3 Population testing — is there only one definition?

I searched all 175 migration files for every definition of these functions.

| Function | Definitions found | Winning definition |
|---|---|---|
| `is_admin` | **1** | `0001_slice1_foundation.sql:138` |
| `is_staff` | **1** | `0001_slice1_foundation.sql:133` |
| `is_manager` | **1** | `0130_security_rls_hardening.sql:55` |
| `current_staff_role` | **1** | `0001_slice1_foundation.sql:128` |

Migrations run in filename order, so a later redefinition would silently win. **There are
none.** I also confirmed via `git log -S` that the `is_admin()` body has **never been
modified** since commit `9dc0400b` (2026-06-27). There are no `alter function` statements
and no later grants or revokes against it.

**Why this matters:** the most common way an access-control function goes bad is that
someone "temporarily" loosens it in a later migration and nobody notices. That has not
happened here. This is a genuine strength.

### 3.4 The deciding table

Anchor: `0001_slice1_foundation.sql:22`

```sql
create table if not exists public.staff_profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  full_name     text,
  role          staff_role not null default 'readonly',
  active        boolean not null default true,
  ...
);
```

One table decides everything. `role` is a database enum (`owner, admin, manager,
content_editor, staff, readonly`) and is `not null` with a **safe default of `readonly`** —
the least-privileged value. That is the correct default and it was tested (Attack 10).

---

## 4. EXECUTION TESTING — THE ELEVEN ATTACKS

Each attack below states what I tried, what happened, and what it means for you.

### Attack 1 — The truth table
**Tried:** Called `is_admin()` as an active owner, a budtender, an **inactive** admin, and
a brand-new signup with the default role.
**Result:** `true`, `false`, `false`, `false`. All correct.
**The important one:** the **inactive admin returns false**. If you fire an admin and flip
`active` to false, they are locked out — the role alone is not enough.

### Attack 2 — No session / garbage session
**Tried:** Called the gate with no logged-in user, and with a valid-looking but unknown user ID.
**Result:** `false` in both cases, and specifically `false` rather than `null`.
**Why that matters:** a `null` return would make policy expressions behave unpredictably.
Returning a hard `false` is the correct, safe behavior.

### Attack 3 — Self-escalation
**Tried:** As a budtender, ran a direct database update setting my own role to `owner`.
Then tried inserting a brand-new fake admin profile for myself.
**Result:** The update silently affected **zero rows**. The insert was blocked. A budtender
querying the profiles table sees **only their own row**.
**Note on rigor:** this test includes a guard that fails the test if it is accidentally run
as a superuser, because superusers bypass row-level security and would make the test pass
for the wrong reason.

### Attack 4 — Does firing someone take effect immediately?
**Tried:** Confirmed owner is admin; set `active = false`; asked again — *in the same
session, same statement stream*, no logout, no cache clear.
**Result:** `true` → `false` immediately.
**Plain English:** there is no window where a fired employee keeps database access because
of a cached session. **However**, see Finding F-09 in Section 6 regarding the application
layer, which is a different story.

### Attack 5 — Demotion
**Tried:** Demoted an owner to manager, asked again, then restored.
**Result:** `true` → `false` → `true`. Immediate.

### Attack 6 — Auto-provision safety ⚠️ (the one I most wanted to break)
There is a trigger that creates a staff profile automatically whenever a new auth user
appears (`0001_slice1_foundation.sql`, `handle_new_auth_user()`):

```sql
insert into public.staff_profiles (id, email, full_name)
values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
on conflict (id) do nothing;
```

**Tried:** Created a new auth user whose signup metadata *claimed* `role: owner` —
metadata a client can control.
**Result:** **The claim is completely ignored.** The trigger only ever reads `full_name`.
The new profile came out as `readonly`. Re-running the trigger against an existing user
does **not** downgrade or alter their role (thanks to `on conflict do nothing`).
**Verdict:** this is the single most dangerous-looking thing in the schema and it is
written correctly. Good.

### Attack 7 — Schema hijack (`search_path`)
**Tried:** The classic PostgreSQL privilege-escalation move — create a schema called `evil`
containing a fake `staff_profiles` table that says I'm an owner, then put `evil` first in
the search path and call the gate.
**Result:** Still `false`. The function is pinned to the `public` schema *and* its body
fully qualifies the table name, so the fake table is never consulted.

### Attack 8 — Privilege enumeration
**Tried:** Checked what the anonymous (logged-out) role can do to `staff_profiles`.
**Result:** No select, no update. The `authenticated` role can reach the table, at which
point row-level security filters it down to their own row (proven in Attack 3).

### Attack 9 — Who is allowed to call the gate?
**Result:** `authenticated` can (required — the policies need it). **`anon` can too**,
because PostgreSQL grants `EXECUTE` to `PUBLIC` on new functions by default.
**Impact:** Low. An anonymous caller has no `auth.uid()`, so it always returns `false`
(proven in Attack 2). It leaks no data. It is logged as **F-05** for hygiene only.

### Attack 10 — Can the deciding row be malformed?
**Tried:** Insert a profile with a `null` role; insert one with a made-up role like
`'superadmin'`.
**Result:** Both rejected — by the `NOT NULL` constraint and by the enum respectively.
There is no way to smuggle an unrecognized role into the table.

### Attack 11 — Blast radius ⚠️ **THIS IS THE FINDING**
**Tried:** I rebuilt the exact policy *shape* used by your Plaid/banking tables —
`for all using (is_staff())` — on a table with the same column shape, put a row in it,
and queried it as a budtender. For contrast I built a second table gated with
`is_admin()`.
**Result:**
- Budtender **READ** the banking-shaped table. ✅ attack succeeded
- Budtender **WROTE** to the banking-shaped table. ✅ attack succeeded
- Budtender saw **zero rows** in the `is_admin()`-gated table. ✅ control held

This is not theory. This is the actual policy pattern from your migrations, executed.

---

## 5. FINDINGS IN DETAIL

### F-01 — CRITICAL — Personal financial data is gated to *all staff*, not admins

**Condition.** Twenty row-level security policies across seven migrations use
`for all using (public.is_staff())`. `for all` means SELECT, INSERT, UPDATE **and DELETE**.
`is_staff()` means any active employee of any role, down to `readonly`.

**The complete population (anchored):**

| Migration | Tables affected |
|---|---|
| `0156_atm_pai_foundation.sql` | `atm_connection`, `atm_settlements`, `atm_transactions`, `atm_cash_loads`, `atm_reconciliation` |
| `0157_plaid_foundation.sql` | `plaid_items`, `plaid_accounts`, `plaid_transactions`, `plaid_webhook_events` |
| `0160_crypto_foundation.sql` | `crypto_assets`, `crypto_wallets`, `crypto_balances`, `crypto_transactions`, `crypto_asset_migrations`, `crypto_sync_state`, `crypto_price_snapshots` |
| `0168_plaid_mortgages.sql` | `plaid_mortgages` |
| `0170_plaid_holdings.sql` | `plaid_holdings` |
| `0171_manual_loans.sql` | `manual_loans`, `manual_loan_payments` |

**Effect, in plain English.** A budtender you hired last week, using nothing more exotic
than the credentials you gave them, can retrieve your linked bank accounts and every
transaction in them, your mortgage balance, your investment holdings, your loan schedule,
your crypto wallets and balances, and the ATM's cash and settlement history. Because the
policy is `for all`, they can also **change or delete** those records. Deleting ATM
reconciliation or loan payment history is an accounting integrity problem on top of a
privacy problem.

**Why this is worse in your industry.** These tables mix personal owner finances with
business finances. In a cannabis business subject to WA LCB oversight and 280E scrutiny,
the ability of a non-owner to silently alter financial records undermines the credibility
of the books you will rely on at audit.

**Contrast that proves the codebase knows better.** All nine General Ledger policies in
`0172_gl_foundation.sql` (lines 1025–1057) are `is_admin()`-gated, as are the four in
`0173`, three in `0174`, three in `0175`, and both vendor bank-detail policies in
`0143_payee_banking_vault.sql`. The newer accounting work does this correctly. The
financial-integration work from the 0156–0171 range does not.

**Root cause (my read, stated as opinion not fact).** `is_staff()` is the codebase's
default habit — 247 uses across 94 migrations versus 55 uses of `is_admin()` across 27.
When these tables were added, the pattern was copied without asking whether *this
particular* data was staff-appropriate.

**Recommendation:** see Roadmap item **R1**.

---

### F-02 — HIGH — 967 service-role call sites bypass row-level security entirely

**Condition.** `createSupabaseAdminClient()` appears **967 times across 208 files**. The
Supabase service role **bypasses row-level security completely** — every policy discussed
in this report is irrelevant on a connection using it.

**Effect.** Your database policies are only as strong as the application code's discipline
about which client it picks. One route that uses the admin client where it should have used
the user client silently removes every protection.

**Mitigating factor (tested).** All **78 server-action files** open with a permission
guard — zero exceptions found. That is genuinely good and is why I rate this HIGH rather
than CRITICAL. The risk is concentrated in API routes (see F-04), not actions.

**Also verified:** the service key is not exposed to the browser; the file that references
it is `server-only` and the single mention is a documentation string listing environment
variable *names*, not values.

**Recommendation:** see Roadmap item **R4**.

---

### F-03 — HIGH — The bootstrap-email path can self-promote to owner

**Anchor:** `src/lib/auth/session.ts`, lines ~40–50.

**Condition.** `getStaffSession()` contains a bootstrap branch: if the service role is
configured **and** the logged-in user's email appears in the `ADMIN_BOOTSTRAP_EMAILS`
environment variable **and** their profile is missing / not owner / not active, the code
uses the **service-role client** to upsert that user to `role: "owner", active: true`.

**Effect.** This is a legitimate and common chicken-and-egg solution (someone has to be the
first owner). But it is a permanent, always-on backdoor whose only lock is an environment
variable. Consequences:

1. Anyone who can edit environment variables — a hosting-panel login, a leaked CI secret,
   a contractor with deploy access — can grant themselves owner by adding an email and
   logging in.
2. It **overrides deliberate demotion**. If you ever demote or deactivate an account whose
   email is still in that list, the next login silently restores it to owner. Attack 5
   proved demotion works at the database level; this application path can undo it.

**Verified behavior of the parser** (`src/lib/supabase/env.ts:18`): splits on comma,
lowercases, trims whitespace, filters empty entries — all four confirmed. So it does what
it says; the issue is the design, not a bug.

**Recommendation:** see Roadmap item **R3**.

---

### F-04 — MEDIUM — API route guard coverage is inconsistent

**Census results:**

| Surface | Total | Without a recognized admin guard |
|---|---|---|
| Admin pages | 170 | **3** |
| Server action files | 78 | **0** |
| API routes | 41 | **26** |

**The 3 pages — reviewed individually, all benign:**
- `admin/settings/payees/page.tsx` (27 lines) — pure redirect
- `admin/content/carousel/page.tsx` (13 lines) — pure redirect
- `admin/account/set-password/page.tsx` (41 lines) — intentionally pre-authentication

**The 26 API routes.** 18 of them are POS routes that use a **different** authentication
scheme — a device key plus an `x-pos` header — which my guard-detector doesn't recognize as
an "admin guard" but which is a real control. That is a *different* control worth its own
audit, not an absence of control.

The 8 with **no auth markers at all**, reviewed individually:
- `orders/route.ts`, `orders/[token]/route.ts` — customer-facing order placement/lookup; public by design (token-scoped)
- `loyalty-signup/route.ts` — public signup by design
- `webauthn/authenticate/options` and `/verify` — necessarily pre-authentication (they *are* the login)
- `estimator/route.ts` — public calculator
- `pos/version/route.ts` — returns a service-worker version string
- `admin/preview/disable/route.ts` — **manually verified**: clears preview cookies and redirects; performs no reads and no writes

**Conclusion:** no unguarded admin route was found. The finding is that guard *style* is
inconsistent enough that a future gap would be hard to spot. This is a maintainability
risk, not an open door.

---

### F-05 — LOW — `is_admin()` is callable by anonymous users

PostgreSQL grants `EXECUTE` to `PUBLIC` by default and no migration revokes it (grant
census: 2 migrations grant to `authenticated`, 3 revoke from `authenticated`, 3 revoke from
`PUBLIC`, **0** grant to `anon`). An anonymous caller gets `false` every time because there
is no `auth.uid()`. No data leaks. Tidy-up only.

---

### F-06 — LOW — New profiles are created `active = true`

The auto-provision trigger creates profiles with `active` defaulting to `true`. Combined
with the `readonly` role this is harmless *today* — `readonly` grants nothing meaningful.
It becomes a real issue only if someone ever widens what `readonly` can do. Noting it so
that decision is made consciously.

---

### F-07 — LOW — `isAdminRole()` is dead code

`src/lib/auth/roles.ts` defines `isAdminRole()` (owner/admin) — a perfect mirror of the
database gate. **It has zero call sites outside its own file.** Dead code that mirrors a
security control is a trap: a future developer may "fix" one twin and assume both changed.
Either wire it up as the single app-side gate or delete it.

---

### F-08 — INFORMATIONAL — The `search_path` pin is redundant (and I proved it)

This one is included because it demonstrates the audit's rigor rather than a defect.

When I mutation-tested the control, removing `set search_path = public` **alone did not
break anything** — the test survived. A survived mutation is a red flag that a test isn't
watching, so I investigated rather than moving on. The answer: the function body already
fully qualifies `public.staff_profiles`, so the pin is belt-and-braces. To confirm, I ran a
second mutation removing **both** the pin *and* the qualification — and Attack 7 **killed
it**. The control is correct; the pin is defense in depth. Keep it.

---

## 6. THE CONTROL ENVIRONMENT — WHAT SITS AROUND THE GATE

### 6.1 Middleware does not enforce anything

`src/middleware.ts` matches `/admin/:path*` but its only action is
`await supabase.auth.getUser()` to refresh the session cookie. Its own comments say
page-level guards do the real enforcement — and the census confirms that is true in
practice. **This is fine, but you should know it:** there is no single perimeter wall. The
security model is per-page and per-action. That works only as long as coverage stays at
100%, which is why F-04's consistency point matters.

### 6.2 User management is well built

`src/app/admin/users/actions.ts` is the only write path for roles. Every one of its three
exported actions opens with `requirePermission('users.manage')`. It uses pure, separately
tested guard functions in `src/lib/auth/user-guards-core.ts`:

- refuses granting a role higher than your own (rank ceiling)
- refuses changing your own role
- refuses deactivating yourself
- **refuses removing the last active owner** (measured: last-owner block present, 2
  self-change refusals, 6 rank comparisons, 7 total refusal paths, self-tests present)

Invites were verified on five points: role validated against the known list, rank ceiling
enforced, granted role actually written to the profile, audit entry recorded, and the
invite goes out as an **email link** rather than minting a session directly. Eight audit
entries are recorded across the file. **This module is a model for the rest of the codebase.**

### 6.3 Login cannot create accounts — verified, not assumed

`src/components/admin/LoginForm.tsx` carries a comment stating the staff magic-link "must
never create an account." Per the standing rule that a comment is not a control, I checked
the code: `shouldCreateUser: false` is genuinely present and set. **The claim is wired.**
Had it not been, an attacker could self-provision an auth user, trigger auto-provisioning,
and obtain a `readonly` foothold. Closed.

### 6.4 No JWT-claims trust anywhere

Zero migrations reference `auth.jwt()` or `user_metadata` for authorization decisions, and
there are zero `rpc()` calls from application code to these gate functions. Authorization
is decided **only** by the `staff_profiles` table. That is the right architecture and it is
consistently followed.

---

## 7. RECOMMENDATIONS ROADMAP

Ordered by risk reduced per unit of effort. **No code has been changed** — this is strategy
only, as instructed.

### R1 — Re-gate the financial tables *(addresses F-01 — do this first)*

**What:** Change the 20 policies listed in F-01 from `is_staff()` to `is_admin()`, splitting
read from write where a business need exists.

**Sequencing, because this will break things if done blindly:**

1. **Decide the policy per table, with you, before touching anything.** ATM cash loads and
   reconciliation may legitimately need manager-level *write* access (someone loads the ATM
   and it isn't always you). Your mortgage and personal crypto almost certainly need
   owner-only. This is a business decision, not a technical one.
2. **Introduce read/write asymmetry.** Today one `for all` policy governs both. The
   replacement should generally be: read = `is_admin()` (or `is_manager()` where justified),
   write = `is_admin()`.
3. **Inventory the callers first.** Some background sync jobs may run under a non-admin
   identity. Tightening policies without checking will break Plaid or crypto sync silently.
   Those jobs should move to an explicit service-role path with its own guard.
4. **Ship as one slice with an idempotent migration**, per repo law, for you to apply
   manually.
5. **Extend the attack suite before merging:** add a test per table asserting a budtender
   gets zero rows and a refused write. These tests must be proven capable of failing.

**Definition of done:** budtender-role execution test shows zero rows and a refused write on
every one of the 20 tables; owner still sees everything; sync jobs still run.

---

### R2 — Adopt a "sensitivity tier" convention *(prevents F-01 recurring)*

The underlying cause is that `is_staff()` is the path of least resistance. Recommendation:
write down, in the repo, a short classification that every new table must be assigned to:

- **Tier 0 Public** — no policy needed
- **Tier 1 Operational** — `is_staff()` (menu, inventory, POS day-to-day)
- **Tier 2 Managerial** — `is_manager()` (schedules, discounts, safe counts)
- **Tier 3 Financial/Personal** — `is_admin()` (banking, loans, crypto, GL, payroll)

Then add a **CI check** that fails the build when a new migration creates a table matching
financial name patterns (`plaid_%`, `crypto_%`, `atm_%`, `gl_%`, `payroll_%`, `%loan%`,
`%bank%`) with an `is_staff()` policy. Cheap to build, and it makes the mistake
structurally impossible rather than relying on memory.

---

### R3 — Contain the bootstrap backdoor *(addresses F-03)*

Options, in ascending order of strength:

1. **Minimum:** make bootstrap fire only when there are **zero active owners** in the
   system. This preserves the legitimate first-run purpose and eliminates the
   "silently restores a demoted account" behavior entirely.
2. **Better:** additionally require an explicit `ALLOW_BOOTSTRAP=true` flag that you turn
   off after initial setup, so the path is dormant in normal operation.
3. **Best:** always write an audit entry when the bootstrap path fires, so a
   silent promotion becomes a visible event.

I recommend **1 + 3** together. Option 1 alone is a small change with a large risk
reduction.

---

### R4 — Justify the service-role surface *(addresses F-02)*

967 call sites is too many to review by hand in one pass, so make it tractable:

1. **Triage by directory** — API routes first (highest risk, per F-04), then libraries,
   then pages.
2. **Establish the rule:** the admin client is permitted only where the operation
   legitimately must cross a user's row-level boundary (background sync, webhooks,
   cross-user reporting). Everywhere else should use the user-scoped client so policies
   apply.
3. **Add a lint rule** requiring an explicit justification comment above each
   `createSupabaseAdminClient()` call. New violations get caught at review time; the
   existing 967 get annotated as they're touched, rather than in one heroic sweep.

---

### R5 — Standardize guard style *(addresses F-04)*

Adopt one recognizable guard call for admin API routes (mirroring `requirePermission` in
actions) so that "does this route have a guard?" is answerable by search. Then add the
census script from this audit to CI so the counts (170 / 78 / 41) are asserted every build
and any new unguarded route fails the pipeline.

---

### R6 — Housekeeping *(addresses F-05, F-06, F-07)*

- `revoke execute on function public.is_admin(), public.is_staff(), public.is_manager() from public;` then grant explicitly to `authenticated`.
- Decide consciously whether new auto-provisioned profiles should start `active = false`.
- Either wire up `isAdminRole()` as the single app-side gate or delete it. Do not leave a
  dead twin of a security control in the tree.

---

### R7 — Make this audit permanent *(standing rules 13 and 19)*

The attack suite built for this audit should become a committed, CI-run artifact rather than
a one-off. Once R1 lands, the suite becomes a **regression net**: any future migration that
re-loosens a financial table fails the build. Per rule 19, F-01 now belongs in the permanent
test corpus.

---

## 8. AUDIT OPINION

Based on the testing performed, in my opinion:

**The `is_admin()` control is designed correctly and operates effectively.** It resisted all
eleven attack scenarios, including the metadata-injection and schema-hijack attacks that
most commonly defeat this pattern. Its single-definition, never-modified history is
evidence of good change discipline.

**However, the control is not applied consistently to the assets that most require it.**
The existence of twenty policies granting all employees full read/write access to owner
personal financial data and business banking records is a **material weakness** in the
access control environment. It is material not because the lock is broken but because it
was never fitted to those doors.

**Overall conclusion: the foundation is sound; the application of it is uneven.** The
remediation is well-scoped, low-risk, and can be delivered as one slice (R1) that removes
the critical exposure, followed by structural changes (R2, R3) that prevent recurrence.

---

## APPENDIX A — POPULATION AND CENSUS DATA

| Measure | Count |
|---|---|
| Migration files examined | 175 |
| `is_admin()` call sites | 55 across 27 migrations |
| — of which RLS policies | 41 |
| — of which inside functions | 3 (all in `0175`) |
| — policy continuation lines | 11 |
| `is_staff()` call sites | 247 across 94 migrations |
| `is_manager()` call sites | 10 across 3 migrations |
| `createSupabaseAdminClient()` call sites | 967 across 208 files |
| Admin pages | 170 |
| Server action files | 78 |
| API routes | 41 |
| `isAdminRole()` call sites (app twin) | **0** |
| Migrations granting to `authenticated` | 2 |
| Migrations revoking from `authenticated` | 3 |
| Migrations revoking from `PUBLIC` | 3 |
| Migrations granting to `anon` | 0 |

The near-total absence of explicit grants confirms the system relies on Supabase's default
grants, which means **row-level security policies are the only meaningful gate** — which is
precisely why F-01 is rated CRITICAL.

---

## APPENDIX B — MUTATION TESTING LOG

A test that cannot fail is not evidence. Each mutation below was applied to a control, the
suite re-run to confirm it **failed**, then reverted and confirmed **byte-identical** with
`cmp` before the suite was re-run to confirm it passed again.

| # | Mutation applied | Expected | Result |
|---|---|---|---|
| 1 | Removed `active = true` from the gate | Fired-admin test fails | **KILLED** ✅ |
| 2 | Widened role list to include `staff` | Budtender test fails | **KILLED** ✅ |
| 3 | Removed `set search_path = public` only | Hijack test fails | **SURVIVED** ⚠️ → investigated, see F-08 |
| 3b | Removed pin **and** schema qualification | Hijack test fails | **KILLED** ✅ |
| 4 | Made the profile write policy permissive | Self-promotion test fails | **KILLED** ✅ |
| 5 | Changed simulated financial gate to `is_admin` | Blast-radius test fails | **KILLED** ✅ |

Mutation 3 is the most valuable entry in this table. A survived mutation was treated as a
finding to investigate rather than a nuisance to ignore, and it produced a correct
explanation confirmed by mutation 3b.

---

## APPENDIX C — TEST EXECUTION RECORD

```
Attack scenarios:        11
Assertions:              30
Result:                  30 pass, 0 fail, 0 errors
Idempotency:             suite executed twice, identical results
Negative control:        mutation applied  -> exit 3 (suite failed as required)
                         mutation reverted -> cmp byte-identical
                         re-run            -> exit 0, 30/30 pass
Environment:             throwaway PostgreSQL, created and destroyed for this audit
Production data touched: none
```

---

## APPENDIX D — CORRECTIONS TO MY OWN WORKING NOTES

Audit integrity requires disclosing errors in the audit itself.

**Correction 1 — assertion count.** During earlier work I recorded the suite as having
**31 assertions**. On final verification the true count is **30**. The discrepancy was my
own counting method: I had counted lines matching `PASS`, which also matched the closing
banner line reading `SUITE PASSED`. Verified three ways: 30 `NOTICE ... PASS` lines, 28
`audit_assert` calls plus 2 assertions made inline, and 11 attack banners. **All figures in
this report use the corrected count of 30.** No conclusion changes; every assertion still
passes.

This is disclosed rather than quietly fixed because a number I carried from memory turned
out to be wrong, and the standing instruction is never to guess.

---

## APPENDIX E — WHAT THIS AUDIT DID NOT COVER

Stated explicitly so the scope limits are not mistaken for clean opinions:

1. **POS device-key authentication** (18 API routes) — a separate control, not tested here.
2. **The 967 service-role call sites individually** — counted and risk-rated, not each read.
3. **Supabase platform configuration** — dashboard settings, key rotation, MFA on your
   Supabase account. These live outside the repository and I cannot see them.
4. **Production database state** — this audit tested the control *as defined in source*.
   It cannot confirm that production matches source. If a policy was ever changed by hand
   in the SQL editor, this audit would not detect it. **Recommend a one-time comparison of
   live policies against the migrations** as part of R1.
5. **Network, hosting, and secret storage** — out of scope.

Item 4 is the most important limitation. Everything in this report describes what the code
says. Confirming production agrees requires a read-only comparison you can run when ready.

---

*Prepared under the standing rules: never guess, never assume, validate everything, prove
every test capable of failing.*
