/**
 * scripts/compliance/prove-0198-gates.ts
 *
 * THE CONSTRAINT THAT PARSES IS NOT THE CONSTRAINT THAT REFUSES.
 *
 * Migration 0198 is full of check constraints, unique indexes and RLS policies.
 * Every one of them is also mentioned in a comment, and comments are free. A
 * text test that greps the migration for the word "check" proves that somebody
 * TYPED a constraint, not that the database will ENFORCE it. Standing rule 16:
 * proving a gate exists is not proving it is wired. Standing rule 43: a refusal
 * code no path emits is decoration.
 *
 * So this script does not read the migration. It connects to a real PostgreSQL
 * that has had all 198 migrations applied, and it TRIES TO DO THE FORBIDDEN
 * THINGS. Each probe is expected to fail, by name. A probe that succeeds is a
 * hole in the schema.
 *
 * It also does the other half, which is the half usually skipped. Standing rule
 * 55: a fixture broken two ways proves nothing, and a suite where EVERYTHING is
 * refused proves nothing either -- it is indistinguishable from a database that
 * rejects all writes. So after the refusals there are ACCEPT CONTROLS: the same
 * rows, made lawful, must go in. Refusal has to discriminate or it is not a
 * gate, it is a wall.
 *
 * And standing rule 64a: detection is not explanation. The final block asserts
 * that the audit function's own refusal names a remedy rather than merely
 * saying no.
 *
 * WHY THIS SHELLS OUT TO psql RATHER THAN USING A DRIVER. There is no `pg`
 * package in this repo and adding a dependency to run a proof script would be
 * a poor trade. scripts/compliance/verify-migrations-execute.ts already
 * established the pattern: execFileSync the psql BINARY. This follows it, so
 * there is one way of talking to postgres in this repo rather than two.
 *
 * Run:
 *   PGURL='postgres://postgres:postgres@localhost:5432/greenway' \
 *     npx tsx scripts/compliance/prove-0198-gates.ts
 */
import { execFileSync } from "node:child_process";

const EXIT_OK = 0;
const EXIT_FAILED = 1;

const PGURL = process.env.PGURL ?? "";

if (!PGURL) {
  // Rule 48: say so loudly rather than pretending to have checked.
  console.log(
    [
      "",
      "  0198 GATE PROOF: SKIPPED (no PGURL set).",
      "",
      "  Nothing was proven. This is not a pass.",
      "  To actually run it, start a postgres with all 198 migrations applied:",
      "",
      "    PGURL='postgres://postgres:postgres@localhost:5432/greenway' \\",
      "      npx tsx scripts/compliance/prove-0198-gates.ts",
      "",
    ].join("\n"),
  );
  process.exit(EXIT_OK);
}

interface SqlResult {
  ok: boolean;
  out: string;
  err: string;
}

/**
 * Run one SQL string through psql. Never throws; reports instead.
 *
 * `quiet` controls whether psql prints its COMMAND TAGS ("INSERT 0 1"). The
 * probes need them. See the vacuity guard in mustFail.
 */
function sql(text: string, quiet = true): SqlResult {
  const args = quiet
    ? ["-v", "ON_ERROR_STOP=1", "-q", "-X", "-A", "-t", "-c", text, PGURL]
    : ["-v", "ON_ERROR_STOP=1", "-X", "-A", "-t", "-c", text, PGURL];
  try {
    const out = execFileSync("psql", args, {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    return { ok: true, out: out.trim(), err: "" };
  } catch (e) {
    const x = e as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      out: (x.stdout ?? "").trim(),
      err: (x.stderr ?? x.message ?? String(e)).trim(),
    };
  }
}

let checks = 0;
let failures = 0;

function ok(name: string, condition: boolean, detail: string): void {
  checks += 1;
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${detail.replace(/\n/g, "\n        ")}`);
  }
}

/**
 * A write that MUST be refused, and must be refused for the STATED REASON.
 *
 * Matching on the constraint name rather than merely on "it errored" is the
 * whole point. A typo that makes the INSERT fail for an unrelated reason would
 * otherwise look exactly like a working gate -- which is how a suite ends up
 * green while the constraint it claims to test does not exist.
 *
 * THE VACUITY GUARD, AND WHY IT IS HERE.
 *
 * The first run of this script reported three "holes in the schema" that were
 * nothing of the sort. Those probes were written as INSERT ... SELECT ... FROM
 * public.staff_profiles LIMIT 1, against a freshly migrated database where
 * staff_profiles is EMPTY. The select returned no rows, the insert wrote no
 * rows, and psql cheerfully reported success. A constraint cannot be violated
 * by a row that was never inserted.
 *
 * That is standing rule 39 -- guard the vacuous read -- arriving from the
 * opposite direction to the usual one: not a check that passes because it read
 * nothing, but a check that FAILS because it wrote nothing. Either way the
 * result is a number nobody should trust.
 *
 * So a mustFail probe that "succeeds" is now interrogated before it is
 * believed. If the command tags say zero rows were affected, the probe is
 * reported as BROKEN rather than as a schema hole, and it says which of the two
 * it is. Standing rule 64a: detection is not explanation, and "THE WRITE
 * SUCCEEDED" is a detection that would have sent me editing a migration that
 * was correct all along.
 */
function mustFail(name: string, statement: string, expectNamed: string): void {
  // Not quiet: we need psql's command tags to tell "refused" from "wrote
  // nothing at all".
  const r = sql(`begin; ${statement}; rollback;`, false);

  if (r.ok) {
    const tags = r.out.match(/^(INSERT|UPDATE|DELETE)\s+\d+\s+(\d+)$/gm) ?? [];
    const rowsTouched = tags.reduce((n, t) => n + Number(t.trim().split(/\s+/).pop()), 0);

    if (tags.length > 0 && rowsTouched === 0) {
      ok(
        name,
        false,
        `THE PROBE IS BROKEN, NOT THE SCHEMA. The statement ran but touched ZERO rows ` +
          `(${tags.join("; ")}), so ${expectNamed} was never given anything to reject. ` +
          `This is almost always an INSERT ... SELECT whose source table is empty on a ` +
          `freshly migrated database. Fix the probe to insert a literal row. ` +
          `Standing rule 39: a check that examined nothing has not passed or failed, it has not run.`,
      );
      return;
    }

    ok(
      name,
      false,
      `THE WRITE SUCCEEDED and touched ${rowsTouched} row(s). Expected refusal by ` +
        `${expectNamed}. This is a hole in the schema, not a test failure.`,
    );
    return;
  }

  const named = r.err.toLowerCase().includes(expectNamed.toLowerCase());
  ok(
    name,
    named,
    named
      ? ""
      : `Refused, but NOT by ${expectNamed}. Postgres said:\n${r.err}\nA refusal for the wrong reason is not the gate we think we have.`,
  );
}

/** A write that MUST be accepted. Rule 55: refusal has to discriminate. */
function mustPass(name: string, statement: string): void {
  const r = sql(`begin; ${statement}; rollback;`);
  ok(
    name,
    r.ok,
    r.ok ? "" : `A LAWFUL write was refused. The constraint is too tight:\n${r.err}`,
  );
}

/** IDs for the throwaway rows every probe hangs off. */
const EMP = "'11111111-1111-4111-8111-111111111111'";
const EMP2 = "'22222222-2222-4222-8222-222222222222'";
const REQ = "'33333333-3333-4333-8333-333333333333'";
const STAFF = "'44444444-4444-4444-8444-444444444444'";

function main(): void {
  // ── 0. THE ENVIRONMENT IS WHAT WE THINK IT IS ────────────────────────────
  // Rule 39: guard the vacuous read. If 0198 never applied, every mustFail
  // below would "pass" by erroring on a missing table, and the script would
  // report a green run against a database that has none of this in it.
  const tables = sql(
    `select count(*) from information_schema.tables
      where table_schema='public'
        and table_name in ('sick_leave_policy','sick_leave_requests',
                           'sick_leave_ledger','wage_orders')`,
  );
  if (!tables.ok || tables.out !== "4") {
    console.error(
      `\n  REFUSING TO RUN: expected the four 0198 tables, found ${tables.out || "none"}.` +
        `\n  Apply all 198 migrations first. A gate proof against an empty database` +
        `\n  proves nothing and would report a false green.\n`,
    );
    process.exit(EXIT_FAILED);
  }

  console.log("\n0198 GATE PROOF -- trying to do the forbidden things.\n");

  // Seed two employees and ONE OWNER to hang the probes off. Committed, then
  // removed at the end, because the probes each run in their own rolled-back
  // transaction.
  //
  // WHY AN OWNER HAS TO BE CREATED FOR REAL.
  //
  // is_owner() is `exists(select 1 from staff_profiles where id = auth.uid()
  // and active and role = 'owner')`. On a freshly migrated database there are
  // no staff at all, so is_owner() is false for everyone and the audit function
  // refuses -- correctly. The first run of this script read that correct
  // refusal as a failure of the audit.
  //
  // The fix is to make a genuine owner and become them, NOT to relax the gate.
  // A proof that has to weaken the thing it is proving has proven the opposite.
  // auth.uid() reads request.jwt.claim.sub, so setting that setting is exactly
  // how a Supabase session identifies itself -- this is the real path, not a
  // bypass.
  const seed = sql(
    `insert into auth.users (id, email) values (${STAFF}, 'probe-owner@example.test')
       on conflict (id) do nothing;
     insert into public.staff_profiles (id, email, full_name, role, active)
     values (${STAFF}, 'probe-owner@example.test', 'PROBE Owner', 'owner', true)
       on conflict (id) do update set role = 'owner', active = true;
     insert into public.employees (id, full_name, job_role, active)
     values (${EMP}, 'PROBE Employee One', 'sales', true),
            (${EMP2}, 'PROBE Employee Two', 'sales', true)
       on conflict (id) do nothing`,
  );
  if (!seed.ok) {
    console.error(`  Could not seed probe rows:\n${seed.err}`);
    process.exit(EXIT_FAILED);
  }

  // Rule 39, applied to the fixture itself. If the owner did not actually take,
  // every owner-context assertion below would fail for the wrong reason and
  // send the next reader hunting through a migration that is fine.
  const ownerReal = sql(
    `select public.is_owner() from (select set_config('request.jwt.claim.sub', ${STAFF}, false)) _`,
  );
  ok(
    "the probe owner is a REAL owner -- is_owner() returns true for them",
    ownerReal.ok && ownerReal.out === "t",
    `is_owner() returned "${ownerReal.out}" for the seeded owner. Every owner-context check below would then fail for a fixture reason rather than a schema reason. ${ownerReal.err}`,
  );

  // ── 1. THE POLICY SINGLETON ──────────────────────────────────────────────
  console.log("§1 the policy is a singleton with no defaults");

  mustFail(
    "a second sick_leave_policy row is refused",
    `insert into public.sick_leave_policy (id) values (2)`,
    "sick_leave_policy_id_check",
  );

  mustFail(
    "an accrual rate below the statutory floor is refused",
    `update public.sick_leave_policy set accrual_hundredth_minutes_per_hour = 149 where id = 1`,
    "sick_leave_policy_accrual_hundredth_minutes_per_hour_check",
  );

  mustPass(
    "ACCEPT CONTROL: the statutory floor itself, 150, is allowed",
    `update public.sick_leave_policy set accrual_hundredth_minutes_per_hour = 150 where id = 1`,
  );

  mustPass(
    "ACCEPT CONTROL: a MORE GENEROUS rate is allowed -- RCW 49.46.210(1)(e)",
    `update public.sick_leave_policy set accrual_hundredth_minutes_per_hour = 200 where id = 1`,
  );

  mustFail(
    "a carryover cap below forty hours is refused -- WAC 296-128-620(4)",
    `update public.sick_leave_policy set carryover_cap_minutes = 2399 where id = 1`,
    "sick_leave_policy_carryover_cap_minutes_check",
  );

  mustFail(
    "a usable-after date past the ninetieth day is refused -- RCW 49.46.210(1)(d)",
    `update public.sick_leave_policy set usable_after_days = 91 where id = 1`,
    "sick_leave_policy_usable_after_days_check",
  );

  mustFail(
    "a usage increment above one hour is refused -- WAC 296-128-630(4)",
    `update public.sick_leave_policy set usage_increment_minutes = 61 where id = 1`,
    "sick_leave_policy_usage_increment_minutes_check",
  );

  mustFail(
    "verification demanded at three days or fewer is refused -- WAC 296-128-660(1)",
    `update public.sick_leave_policy set verification_after_days = 3 where id = 1`,
    "sick_leave_policy_verification_after_days_check",
  );

  mustPass(
    "ACCEPT CONTROL: verification after FOUR days is allowed",
    `update public.sick_leave_policy set verification_after_days = 4 where id = 1`,
  );

  // The policy row must exist and hold NOTHING. This is the rule 62d claim,
  // tested rather than asserted in a comment.
  const blank = sql(
    `select count(*) from public.sick_leave_policy
      where id = 1
        and accrual_hundredth_minutes_per_hour is null
        and carryover_cap_minutes is null
        and usable_after_days is null
        and usage_increment_minutes is null
        and verification_after_days is null
        and verification_required is null`,
  );
  ok(
    "the seeded policy row is entirely UNANSWERED, not pre-filled with the floor",
    blank.ok && blank.out === "1",
    `Expected one wholly-NULL policy row, got ${blank.out}. A pre-filled floor would record a statutory minimum as Michael's deliberate election (rule 62d).`,
  );

  // ── 2. THE REQUEST ───────────────────────────────────────────────────────
  console.log("\n§2 the request records what was asked and what was decided");

  mustFail(
    "a purpose outside the statutory list is refused",
    `insert into public.sick_leave_requests
       (employee_id, leave_date, minutes_requested, purpose, notice_kind)
     values (${EMP}, '2027-02-01', 480, 'hangover', 'unforeseeable')`,
    "sick_leave_requests_purpose_check",
  );

  mustPass(
    "ACCEPT CONTROL: each of the five statutory purposes is allowed",
    `insert into public.sick_leave_requests
       (employee_id, leave_date, minutes_requested, purpose, notice_kind)
     values (${EMP}, '2027-02-01', 480, 'own_health', 'unforeseeable'),
            (${EMP}, '2027-02-02', 480, 'family_care', 'foreseeable'),
            (${EMP}, '2027-02-03', 480, 'closure', 'unforeseeable'),
            (${EMP}, '2027-02-04', 480, 'immigration', 'foreseeable'),
            (${EMP}, '2027-02-05', 480, 'domestic_violence', 'unforeseeable')`,
  );

  mustFail(
    "a zero-minute request is refused",
    `insert into public.sick_leave_requests
       (employee_id, leave_date, minutes_requested, purpose, notice_kind)
     values (${EMP}, '2027-02-01', 0, 'own_health', 'unforeseeable')`,
    "sick_leave_requests_minutes_requested_check",
  );

  mustFail(
    "a DENIAL with no reason is refused -- the record that answers a retaliation claim",
    `insert into public.sick_leave_requests
       (employee_id, leave_date, minutes_requested, purpose, notice_kind,
        status, decided_by_staff_id, decided_at)
     values (${EMP}, '2027-02-06', 480, 'own_health', 'unforeseeable',
             'denied', null, now())`,
    "sick_leave_requests_decided_together",
  );

  mustFail(
    "a denial with a decider but a BLANK reason is still refused",
    // Literal STAFF, not a SELECT from staff_profiles: on a freshly migrated
    // database that table is empty, the select yields nothing, and the probe
    // proves nothing while looking like a schema hole. That exact mistake is
    // what the vacuity guard in mustFail now catches.
    `insert into public.sick_leave_requests
       (employee_id, leave_date, minutes_requested, purpose, notice_kind,
        status, decided_by_staff_id, decided_at, decision_note)
     values (${EMP}, '2027-02-07', 480, 'own_health', 'unforeseeable',
             'denied', ${STAFF}, now(), '   ')`,
    "sick_leave_requests_denial_has_reason",
  );

  mustPass(
    "ACCEPT CONTROL: the same denial WITH a real reason is allowed",
    `insert into public.sick_leave_requests
       (employee_id, leave_date, minutes_requested, purpose, notice_kind,
        status, decided_by_staff_id, decided_at, decision_note)
     values (${EMP}, '2027-02-07', 480, 'own_health', 'unforeseeable',
             'denied', ${STAFF}, now(),
             'Balance exhausted and no award granted; unpaid leave offered instead.')`,
  );

  mustFail(
    "an APPROVAL with no decider is refused -- half a decision is worse than none",
    `insert into public.sick_leave_requests
       (employee_id, leave_date, minutes_requested, purpose, notice_kind,
        status, decided_at)
     values (${EMP}, '2027-02-08', 480, 'own_health', 'unforeseeable',
             'approved', now())`,
    "sick_leave_requests_decided_together",
  );

  mustFail(
    "a PENDING request that already carries a decision is refused",
    `insert into public.sick_leave_requests
       (employee_id, leave_date, minutes_requested, purpose, notice_kind,
        status, decided_at)
     values (${EMP}, '2027-02-09', 480, 'own_health', 'unforeseeable',
             'pending', now())`,
    "sick_leave_requests_decided_together",
  );

  mustPass(
    "ACCEPT CONTROL: a request from an employee with NO staff profile is allowed",
    // This is the whole reason the column is nullable. Most Greenway employees
    // have no back-office login (0037 made employees.staff_id nullable "for
    // floor-only staff who just clock in at a shared station"). If this row
    // were refused, the statute's protection would be unreachable for exactly
    // the people it protects.
    `insert into public.sick_leave_requests
       (employee_id, leave_date, minutes_requested, purpose, notice_kind,
        requested_by_staff_id)
     values (${EMP2}, '2027-03-01', 240, 'own_health', 'unforeseeable', null)`,
  );

  // ── 3. THE LEDGER ────────────────────────────────────────────────────────
  console.log("\n§3 the ledger is the balance, and every row explains itself");

  mustFail(
    "a zero-minute ledger entry is refused -- a row that changes nothing",
    `insert into public.sick_leave_ledger
       (employee_id, entry_date, entry_kind, minutes, reason)
     values (${EMP}, '2027-02-01', 'accrual', 0, 'nothing happened')`,
    "sick_leave_ledger_minutes_check",
  );

  mustFail(
    "a NEGATIVE accrual is refused -- the sign must match the kind",
    `insert into public.sick_leave_ledger
       (employee_id, entry_date, entry_kind, minutes, reason)
     values (${EMP}, '2027-02-01', 'accrual', -90, 'accrual cannot reduce')`,
    "sick_leave_ledger_sign_matches_kind",
  );

  mustFail(
    "a POSITIVE usage is refused -- usage cannot add to a balance",
    `insert into public.sick_leave_ledger
       (employee_id, entry_date, entry_kind, minutes, request_id, drawn_from, reason)
     values (${EMP}, '2027-02-01', 'usage', 480, null, 'statutory', 'wrong sign')`,
    "sick_leave_ledger_sign_matches_kind",
  );

  mustFail(
    "usage with NO request behind it is refused -- nobody asked, nobody approved",
    `insert into public.sick_leave_ledger
       (employee_id, entry_date, entry_kind, minutes, request_id, drawn_from, reason)
     values (${EMP}, '2027-02-01', 'usage', -480, null, 'statutory', 'unauthorised deduction')`,
    "sick_leave_ledger_usage_has_request",
  );

  mustFail(
    "usage that does not say which POT it came from is refused",
    // Again literal, not SELECT ... LIMIT 1 from a table that is empty on a
    // freshly migrated database. The request is created in the same rolled-back
    // transaction so the foreign key is satisfied by a row that certainly
    // exists.
    `insert into public.sick_leave_requests
       (id, employee_id, leave_date, minutes_requested, purpose, notice_kind)
     values (${REQ}, ${EMP}, '2027-02-01', 480, 'own_health', 'unforeseeable');
     insert into public.sick_leave_ledger
       (employee_id, entry_date, entry_kind, minutes, request_id, drawn_from, reason)
     values (${EMP}, '2027-02-01', 'usage', -480, ${REQ}, null, 'no pot named')`,
    "sick_leave_ledger_draw_only_on_usage",
  );

  mustFail(
    "an ACCRUAL that claims a pot is refused -- only usage draws",
    `insert into public.sick_leave_ledger
       (employee_id, entry_date, entry_kind, minutes, drawn_from, reason)
     values (${EMP}, '2027-02-01', 'accrual', 90, 'statutory', 'accrual does not draw')`,
    "sick_leave_ledger_draw_only_on_usage",
  );

  mustFail(
    "a ledger row with a BLANK reason is refused -- rule 64a",
    `insert into public.sick_leave_ledger
       (employee_id, entry_date, entry_kind, minutes, reason)
     values (${EMP}, '2027-02-01', 'accrual', 90, '  ')`,
    "sick_leave_ledger_reason_check",
  );

  mustPass(
    "ACCEPT CONTROL: a lawful accrual, a lawful AWARD, and a lawful usage all go in",
    // The award is Michael giving more than is owed. It is a different
    // entry_kind on purpose, so the statutory carryover floor stays measurable.
    `insert into public.sick_leave_requests
       (id, employee_id, leave_date, minutes_requested, purpose, notice_kind)
     values (${REQ}, ${EMP}, '2027-04-01', 480, 'own_health', 'unforeseeable');
     insert into public.sick_leave_ledger
       (employee_id, entry_date, entry_kind, minutes, reason)
     values (${EMP}, '2027-01-15', 'accrual', 90,
             'Accrued on 60 hours worked in the period ending 15 Jan 2027.');
     insert into public.sick_leave_ledger
       (employee_id, entry_date, entry_kind, minutes, reason)
     values (${EMP}, '2027-01-15', 'award', 480,
             'Michael awarded a day beyond accrual. RCW 49.46.210(1)(e).');
     insert into public.sick_leave_ledger
       (employee_id, entry_date, entry_kind, minutes, request_id, drawn_from, reason)
     values (${EMP}, '2027-04-01', 'usage', -480, ${REQ}, 'statutory',
             'Approved sick day, drawn from statutory accrual first.')`,
  );

  mustFail(
    "the SAME request cannot be deducted twice -- the double-click defence",
    `insert into public.sick_leave_requests
       (id, employee_id, leave_date, minutes_requested, purpose, notice_kind)
     values (${REQ}, ${EMP}, '2027-04-01', 480, 'own_health', 'unforeseeable');
     insert into public.sick_leave_ledger
       (employee_id, entry_date, entry_kind, minutes, request_id, drawn_from, reason)
     values (${EMP}, '2027-04-01', 'usage', -480, ${REQ}, 'statutory', 'first deduction');
     insert into public.sick_leave_ledger
       (employee_id, entry_date, entry_kind, minutes, request_id, drawn_from, reason)
     values (${EMP}, '2027-04-01', 'usage', -480, ${REQ}, 'statutory', 'second deduction')`,
    "sick_leave_ledger_one_usage_per_request",
  );

  // ── 4. WAGE ORDERS ───────────────────────────────────────────────────────
  console.log("\n§4 a wage order cannot be ambiguous about how much to take");

  mustFail(
    "an order stating BOTH a dollar amount and a percentage is refused",
    `insert into public.wage_orders
       (employee_id, order_kind, case_number, issuing_authority, order_date,
        payee_name, amount_cents_per_period, percent_of_disposable_basis_points,
        supports_second_family, effective_from)
     values (${EMP}, 'creditor', 'C-1', 'Kitsap County Superior Court', '2027-01-05',
             'Acme Collections', 25000, 1500, null, '2027-01-10')`,
    "wage_orders_states_one_measure",
  );

  mustFail(
    "an order stating NEITHER measure is refused",
    `insert into public.wage_orders
       (employee_id, order_kind, case_number, issuing_authority, order_date,
        payee_name, supports_second_family, effective_from)
     values (${EMP}, 'creditor', 'C-2', 'Kitsap County Superior Court', '2027-01-05',
             'Acme Collections', null, '2027-01-10')`,
    "wage_orders_states_one_measure",
  );

  mustFail(
    "a SUPPORT order that cannot say whether a second family is supported is refused",
    // 15 USC 1673(b)(2): 50 per centum versus 60. Ten points of somebody's
    // take-home pay turns on this answer, so an unanswered order must not be
    // storable at all.
    `insert into public.wage_orders
       (employee_id, order_kind, case_number, issuing_authority, order_date,
        payee_name, percent_of_disposable_basis_points, supports_second_family,
        effective_from)
     values (${EMP}, 'child_support', 'CS-1', 'WA Division of Child Support',
             '2027-01-05', 'WA SDU', 2000, null, '2027-01-10')`,
    "wage_orders_support_needs_family_answer",
  );

  mustPass(
    "ACCEPT CONTROL: the same support order WITH the answer is allowed",
    `insert into public.wage_orders
       (employee_id, order_kind, case_number, issuing_authority, order_date,
        payee_name, percent_of_disposable_basis_points, supports_second_family,
        arrears_over_twelve_weeks, effective_from)
     values (${EMP}, 'child_support', 'CS-1', 'WA Division of Child Support',
             '2027-01-05', 'WA SDU', 2000, true, false, '2027-01-10')`,
  );

  mustPass(
    "ACCEPT CONTROL: a tax levy needs no second-family answer, and is allowed",
    // The CCPA cap does not apply to a tax debt at all -- 15 USC 1673(b)(1)(C)
    // -- so the support-order question is not asked of it.
    `insert into public.wage_orders
       (employee_id, order_kind, case_number, issuing_authority, order_date,
        payee_name, amount_cents_per_period, supports_second_family, effective_from)
     values (${EMP}, 'federal_tax_levy', 'LV-1', 'Internal Revenue Service',
             '2027-01-05', 'United States Treasury', 40000, null, '2027-01-10')`,
  );

  mustFail(
    "a percentage above one hundred percent is refused",
    `insert into public.wage_orders
       (employee_id, order_kind, case_number, issuing_authority, order_date,
        payee_name, percent_of_disposable_basis_points, supports_second_family,
        effective_from)
     values (${EMP}, 'creditor', 'C-3', 'Kitsap County Superior Court', '2027-01-05',
             'Acme Collections', 10001, null, '2027-01-10')`,
    "wage_orders_percent_of_disposable_basis_points_check",
  );

  mustFail(
    "an order that ends before it begins is refused",
    `insert into public.wage_orders
       (employee_id, order_kind, case_number, issuing_authority, order_date,
        payee_name, amount_cents_per_period, supports_second_family,
        effective_from, effective_to)
     values (${EMP}, 'creditor', 'C-4', 'Kitsap County Superior Court', '2027-01-05',
             'Acme Collections', 25000, null, '2027-06-01', '2027-01-10')`,
    "wage_orders_dates_ordered",
  );

  mustFail(
    "a TERMINATED order with no note is refused -- rule 64a again",
    `insert into public.wage_orders
       (employee_id, order_kind, case_number, issuing_authority, order_date,
        payee_name, amount_cents_per_period, supports_second_family,
        effective_from, status)
     values (${EMP}, 'creditor', 'C-5', 'Kitsap County Superior Court', '2027-01-05',
             'Acme Collections', 25000, null, '2027-01-10', 'terminated')`,
    "wage_orders_terminated_has_note",
  );

  mustFail(
    "the SAME writ entered twice is refused -- the double-withholding defence",
    `insert into public.wage_orders
       (employee_id, order_kind, case_number, issuing_authority, order_date,
        payee_name, amount_cents_per_period, supports_second_family, effective_from)
     values (${EMP}, 'creditor', 'C-6', 'Kitsap County Superior Court', '2027-01-05',
             'Acme Collections', 25000, null, '2027-01-10');
     insert into public.wage_orders
       (employee_id, order_kind, case_number, issuing_authority, order_date,
        payee_name, amount_cents_per_period, supports_second_family, effective_from)
     values (${EMP}, 'creditor', 'C-6', 'Kitsap County Superior Court', '2027-01-05',
             'Acme Collections', 25000, null, '2027-02-10')`,
    "wage_orders_one_live_per_case",
  );

  mustPass(
    "ACCEPT CONTROL: the same case number is allowed again once the first is TERMINATED",
    // Because an order really can be reissued, and a schema that made that
    // impossible would be a schema Michael has to work around.
    `insert into public.wage_orders
       (employee_id, order_kind, case_number, issuing_authority, order_date,
        payee_name, amount_cents_per_period, supports_second_family,
        effective_from, status, termination_note)
     values (${EMP}, 'creditor', 'C-7', 'Kitsap County Superior Court', '2027-01-05',
             'Acme Collections', 25000, null, '2027-01-10', 'terminated',
             'Debt satisfied in full 14 May 2027, release filed.');
     insert into public.wage_orders
       (employee_id, order_kind, case_number, issuing_authority, order_date,
        payee_name, amount_cents_per_period, supports_second_family, effective_from)
     values (${EMP}, 'creditor', 'C-7', 'Kitsap County Superior Court', '2027-06-05',
             'Acme Collections', 25000, null, '2027-06-10')`,
  );

  // ── 5. NO DELETE, ANYWHERE ───────────────────────────────────────────────
  console.log("\n§5 evidence is not deletable through the application");

  const delPolicies = sql(
    `select count(*) from pg_policies
      where schemaname='public'
        and tablename in ('sick_leave_policy','sick_leave_requests',
                          'sick_leave_ledger','wage_orders')
        and cmd = 'DELETE'`,
  );
  ok(
    "not one of the four tables has a DELETE policy",
    delPolicies.ok && delPolicies.out === "0",
    `Found ${delPolicies.out} DELETE policies. Under RLS the ABSENCE of a policy is what denies the operation; adding one reopens it.`,
  );

  const delGrants = sql(
    `select count(*) from information_schema.role_table_grants
      where table_schema='public'
        and table_name in ('sick_leave_policy','sick_leave_requests',
                           'sick_leave_ledger','wage_orders')
        and privilege_type = 'DELETE'
        and grantee in ('authenticated','anon')`,
  );
  ok(
    "neither authenticated nor anon holds a DELETE grant",
    delGrants.ok && delGrants.out === "0",
    `Found ${delGrants.out} DELETE grants. Enabling RLS does NOT revoke grants, which is why this is checked separately.`,
  );

  const anonGrants = sql(
    `select count(*) from information_schema.role_table_grants
      where table_schema='public'
        and table_name in ('sick_leave_policy','sick_leave_requests',
                           'sick_leave_ledger','wage_orders')
        and grantee = 'anon'`,
  );
  ok(
    "anon holds NO privilege at all on any of the four tables",
    anonGrants.ok && anonGrants.out === "0",
    `anon holds ${anonGrants.out} privileges. Payroll and medical-adjacent data must never be reachable unauthenticated.`,
  );

  // ── 6. THE DELIBERATE ASYMMETRY, IN BOTH DIRECTIONS ──────────────────────
  console.log("\n§6 requesting is open at the clock, deciding is owner-only");

  const insOpen = sql(
    `select count(*) from pg_policies
      where schemaname='public' and tablename='sick_leave_requests'
        and cmd in ('INSERT','ALL')
        and coalesce(with_check,'') like '%authenticated%'`,
  );
  ok(
    "an authenticated session CAN insert a request -- floor staff have no login",
    insOpen.ok && Number(insOpen.out) >= 1,
    `No authenticated INSERT policy found. employees.staff_id is nullable by design in 0037 for floor-only staff; gating this on is_owner() makes the statute's protection unreachable for the people it protects.`,
  );

  const updClosed = sql(
    `select count(*) from pg_policies
      where schemaname='public' and tablename='sick_leave_requests'
        and cmd in ('UPDATE','ALL')
        and coalesce(qual,'') like '%is_owner%'
        and coalesce(with_check,'') like '%is_owner%'`,
  );
  ok(
    "but only the owner can DECIDE one, gated on both qual and with_check",
    updClosed.ok && Number(updClosed.out) >= 1,
    `UPDATE is not owner-gated on both sides. Gating only 'using' is the classic RLS hole: a permitted row can be updated into a shape the policy would never have allowed -- here, an employee approving their own request.`,
  );

  // ── 7. THE AUDIT FUNCTION ────────────────────────────────────────────────
  console.log("\n§7 the audit function refuses a non-owner, and EXPLAINS why");

  const AS_OWNER = `select set_config('request.jwt.claim.sub', ${STAFF}, false);`;

  const asOwner = sql(
    `${AS_OWNER} select count(*) from public.gl_audit_sick_and_orders();`,
  );
  // set_config prints its own row, so the count is the LAST line.
  const auditCount = asOwner.out.split("\n").pop()?.trim() ?? "";
  ok(
    "as owner the audit runs and returns ZERO findings -- an empty result is the pass",
    asOwner.ok && auditCount === "0",
    asOwner.ok
      ? `The audit reported ${auditCount} findings:\n${
          sql(`${AS_OWNER} select finding || ' -- ' || detail from public.gl_audit_sick_and_orders();`).out
        }`
      : `The audit would not run at all:\n${asOwner.err}`,
  );

  // The other half of rule 55. The owner check above and this one must run in
  // the SAME session shape, differing only in WHO the session claims to be.
  // Otherwise "owner passes, non-owner fails" could be explained by anything.
  const asNonOwner = sql(
    `select set_config('request.jwt.claim.sub', gen_random_uuid()::text, false);
     select * from public.gl_audit_sick_and_orders();`,
  );
  ok(
    "as a non-owner the audit REFUSES -- same session shape, different identity",
    !asNonOwner.ok,
    "The audit ran for a non-owner. is_owner() is not load-bearing here, and rule 43 says a refusal code no path emits is decoration.",
  );

  // Rule 64a. Detection is not explanation. A refusal that says only "no" sends
  // the reader hunting; a refusal that names itself can be looked up.
  ok(
    "and the refusal NAMES ITSELF -- GL_NOT_OWNER, not a bare permission error",
    !asNonOwner.ok && asNonOwner.err.includes("GL_NOT_OWNER"),
    `The refusal did not carry the GL_NOT_OWNER code the refusal catalogue translates into plain English. Postgres said:\n${asNonOwner.err}`,
  );

  ok(
    "and it says WHAT was refused, not merely that something was",
    !asNonOwner.ok && /owner-only/i.test(asNonOwner.err),
    `The refusal text does not explain the restriction. Michael should never have to read a stack trace to learn that a screen is owner-only. Postgres said:\n${asNonOwner.err}`,
  );

  // ── CLEAN UP ─────────────────────────────────────────────────────────────
  sql(
    `delete from public.employees where id in (${EMP}, ${EMP2});
     delete from public.staff_profiles where id = ${STAFF};
     delete from auth.users where id = ${STAFF};`,
  );

  // ── VERDICT ──────────────────────────────────────────────────────────────
  console.log(`\n  ${checks - failures} of ${checks} checks passed.`);
  if (failures > 0) {
    console.error(`\n0198 GATE PROOF FAILED: ${failures} of ${checks}.\n`);
    process.exit(EXIT_FAILED);
  }
  // Rule 39 once more, applied to this script itself: a proof that ran no
  // probes is not a proof.
  if (checks < 40) {
    console.error(
      `\n0198 GATE PROOF INCONCLUSIVE: only ${checks} checks ran. Expected at least 40.` +
        `\nA suite that shrinks silently is a suite that stops proving things.\n`,
    );
    process.exit(EXIT_FAILED);
  }
  console.log("0198 GATE PROOF PASSED.\n");
  process.exit(EXIT_OK);
}

if (require.main === module) {
  main();
}
