/**
 * src/lib/payroll/employee-ach-card-core.ts — R39 S4 (PURE)
 *
 * The employee file's "Direct deposit (ACH)" card. It answers, on the
 * employee's own page and with masked tails only:
 *   - Will the next payroll pay this person, and to where?
 *   - If not, why, and what does an admin do next?
 *   - What older authorizations are kept (revoked / archived, Q7 + Q11)?
 *
 * It uses the SAME decision as payroll (planPayrollEntries) so the card can
 * never say "will be paid" when payroll would refuse: we run the planner on a
 * $1,000.00 sample net and show its split.
 *
 * Owner answers behind it: Q4 (credits only, split accounts), Q10 (every
 * employee signs; the form goes in the file and the vault), Q11 (up to 3
 * accounts; inactive ones hidden behind a button).
 */
import { maskAccountTail } from "@/lib/security/at-rest-crypto";
import { planPayrollEntries, type EmployeeDepositPlan, type SplitDepositAccount } from "@/lib/payroll/payroll-core";

export const SAMPLE_NET_CENTS = 100_000;

export type EmployeeAchCardState =
  | "not_ready" // 0258 not applied
  | "legacy_only" // no signed authorization; payroll uses the employee record (and says so)
  | "no_banking" // no authorization and no banking: dropped from the file
  | "payable" // active + all accounts verified
  | "blocked"; // an open authorization payroll refuses (draft, verifying, on hold, unverified, bad data)

export type EmployeeAchCardAccount = {
  priority: number;
  where: string; // "•••• 1234 (checking)"
  rule: string; // "$200.00 fixed" / "25% of net" / "the rest"
  verified: boolean;
  sampleCents: number | null; // what it gets on a $1,000 net (null when blocked)
};

export type EmployeeAchCard = {
  state: EmployeeAchCardState;
  label: string;
  tone: "neutral" | "green" | "gold" | "orange";
  detail: string;
  authorizationState: string | null;
  accounts: EmployeeAchCardAccount[];
  /** Revoked / archived authorizations kept for the record (hidden table). */
  historyCount: number;
  /** Q10: every employee signs. True when this active employee still needs a signed form. */
  needsSignedForm: boolean;
};

function money(c: number): string {
  return `$${(c / 100).toFixed(2)}`;
}

export function describeRule(rule: SplitDepositAccount["rule"]): string {
  switch (rule.kind) {
    case "fixed":
      return `${money(rule.cents)} fixed`;
    case "percent":
      return `${(rule.basisPoints / 100).toFixed(rule.basisPoints % 100 === 0 ? 0 : 2)}% of net`;
    case "remainder":
      return "the rest";
  }
}

export function employeeAchCard(input: {
  tableReady: boolean;
  employeeActive: boolean;
  employeeName: string;
  /** The ONE open authorization (not revoked/archived), or null. */
  plan: EmployeeDepositPlan | null;
  historyCount: number;
  legacy: { routing: string | null; accountNumber: string | null; accountType: string | null } | null;
}): EmployeeAchCard {
  const { tableReady, employeeActive, plan, historyCount } = input;
  const legacyHas = Boolean(input.legacy && ((input.legacy.routing ?? "").trim() || (input.legacy.accountNumber ?? "").trim()));
  const legacyType = input.legacy?.accountType === "savings" ? "savings" : "checking";

  if (!tableReady) {
    return {
      state: "not_ready",
      label: legacyHas ? "Direct deposit on file" : "No direct deposit on file",
      tone: legacyHas ? "green" : "neutral",
      detail: legacyHas
        ? `${maskAccountTail(input.legacy?.accountNumber ?? "")} (${legacyType}). Signed authorizations and split deposits turn on after migration 0258.`
        : "No banking on file. Signed authorizations and split deposits turn on after migration 0258.",
      authorizationState: null,
      accounts: [],
      historyCount: 0,
      needsSignedForm: false,
    };
  }

  if (!plan) {
    return {
      state: legacyHas ? "legacy_only" : "no_banking",
      label: legacyHas ? "No signed ACH form yet" : "No direct deposit",
      tone: legacyHas ? "gold" : "neutral",
      detail: legacyHas
        ? `Payroll pays ${maskAccountTail(input.legacy?.accountNumber ?? "")} (${legacyType}) from the employee record, and the run says so. Get a signed ACH authorization form for the file and the vault.`
        : "Not in the payroll ACH file. Get a signed ACH authorization form with their bank details.",
      authorizationState: null,
      accounts: [],
      historyCount,
      needsSignedForm: employeeActive,
    };
  }

  const sample = planPayrollEntries(
    [
      {
        employeeId: "sample",
        employeeName: input.employeeName || "Employee",
        netPayCents: SAMPLE_NET_CENTS,
        accountType: "checking",
        routing: "",
        accountNumber: "",
      },
    ],
    new Map([["sample", plan]]),
  );
  const accounts: EmployeeAchCardAccount[] = plan.accounts.map((a) => ({
    priority: a.priority,
    where: `${maskAccountTail(a.accountNumber)} (${a.accountType})`,
    rule: describeRule(a.rule),
    verified: a.verificationStatus === "verified",
    sampleCents: null,
  }));
  if (sample.ok) {
    // Match each account to its entry by exact (routing, account, type).
    // NOT by position: allocateSplit always puts the remainder account last,
    // whatever its priority, and $0 legs are skipped. validateSplits forbids
    // the same account twice, so the key is unique.
    const key = (r: string, a: string, t: string) => `${r}|${a}|${t}`;
    const got = new Map(sample.entries.map((e) => [key(e.routing, e.accountNumber, e.accountType), e.amountCents]));
    plan.accounts.forEach((a, i) => {
      accounts[i].sampleCents = got.get(key(a.routing, a.accountNumber, a.accountType)) ?? 0;
    });
    return {
      state: "payable",
      label: plan.accounts.length > 1 ? `Split deposit · ${plan.accounts.length} accounts` : "Direct deposit active",
      tone: "green",
      detail: `Signed and verified. On a ${money(SAMPLE_NET_CENTS)} paycheck the split would be as shown.`,
      authorizationState: plan.state,
      accounts,
      historyCount,
      needsSignedForm: false,
    };
  }
  const reason = sample.errors.map((e) => e.replace(/^[^:]*:\s*/, "")).join(" ");
  return {
    state: "blocked",
    label: "Payroll will refuse",
    tone: "orange",
    detail: `${reason} Until this is fixed, this employee blocks the payroll ACH file.`,
    authorizationState: plan.state,
    accounts,
    historyCount,
    needsSignedForm: false,
  };
}

export function __runEmployeeAchCardTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL employee-ach-card: ${msg}`);
    }
  };
  const acct = (o: Partial<SplitDepositAccount> = {}): SplitDepositAccount => ({
    priority: 1,
    rule: { kind: "remainder" },
    routing: "125000105",
    accountNumber: "123456789",
    accountType: "checking",
    verificationStatus: "verified",
    ...o,
  });
  const legacy = { routing: "125000105", accountNumber: "555554321", accountType: "savings" };
  const base = { tableReady: true, employeeActive: true, employeeName: "Ann", plan: null, historyCount: 0, legacy: null };

  ok(describeRule({ kind: "fixed", cents: 20000 }) === "$200.00 fixed", "fixed rule");
  ok(describeRule({ kind: "percent", basisPoints: 2500 }) === "25% of net", "whole percent");
  ok(describeRule({ kind: "percent", basisPoints: 1250 }) === "12.50% of net", "fraction percent");
  ok(describeRule({ kind: "remainder" }) === "the rest", "remainder rule");

  const nr = employeeAchCard({ ...base, tableReady: false, legacy });
  ok(nr.state === "not_ready" && nr.detail.includes("••••4321") && nr.detail.includes("savings"), "not ready shows legacy masked");
  ok(!nr.needsSignedForm, "not ready never nags");
  ok(employeeAchCard({ ...base, tableReady: false }).label === "No direct deposit on file", "not ready no banking");

  const lo = employeeAchCard({ ...base, legacy });
  ok(lo.state === "legacy_only" && lo.needsSignedForm && lo.tone === "gold", "legacy only nags active employee");
  ok(!employeeAchCard({ ...base, legacy, employeeActive: false }).needsSignedForm, "inactive employee not nagged");
  ok(employeeAchCard({ ...base }).state === "no_banking", "nothing -> no_banking");
  ok(employeeAchCard({ ...base, legacy: { routing: " ", accountNumber: "", accountType: null } }).state === "no_banking", "blank legacy = none");

  const one = employeeAchCard({ ...base, plan: { state: "active", accounts: [acct()] }, historyCount: 2 });
  ok(one.state === "payable" && one.label === "Direct deposit active", "single payable");
  ok(one.accounts[0].sampleCents === SAMPLE_NET_CENTS && one.accounts[0].where === "••••6789 (checking)", "single sample + mask");
  ok(one.historyCount === 2, "history count passes through");

  const split = employeeAchCard({
    ...base,
    plan: {
      state: "active",
      accounts: [
        acct({ priority: 1, rule: { kind: "fixed", cents: 20000 }, accountNumber: "11112222" }),
        acct({ priority: 2, rule: { kind: "percent", basisPoints: 1000 }, accountNumber: "33334444", accountType: "savings" }),
        acct({ priority: 3, rule: { kind: "remainder" }, accountNumber: "55556666" }),
      ],
    },
  });
  ok(split.label === "Split deposit · 3 accounts", "split label");
  ok(split.accounts.map((a) => a.sampleCents).join() === "20000,10000,70000", "split sample amounts");

  const zeroLeg = employeeAchCard({
    ...base,
    plan: {
      state: "active",
      accounts: [
        acct({ priority: 1, rule: { kind: "fixed", cents: 200000 }, accountNumber: "11112222" }),
        acct({ priority: 2, rule: { kind: "remainder" }, accountNumber: "55556666" }),
      ],
    },
  });
  const remFirst = employeeAchCard({
    ...base,
    plan: {
      state: "active",
      accounts: [
        acct({ priority: 1, rule: { kind: "remainder" }, accountNumber: "11112222" }),
        acct({ priority: 2, rule: { kind: "fixed", cents: 25000 }, accountNumber: "55556666" }),
      ],
    },
  });
  ok(remFirst.accounts.map((a) => a.sampleCents).join() === "75000,25000", "remainder at priority 1 still gets its share");
  ok(zeroLeg.state === "payable" && zeroLeg.accounts.map((a) => a.sampleCents).join() === "100000,0", "$0 leg shown as 0");

  const held = employeeAchCard({ ...base, plan: { state: "on_hold", accounts: [acct()] } });
  ok(held.state === "blocked" && held.detail.startsWith("On hold"), "on hold blocked with payroll's reason (name stripped)");
  ok(held.accounts[0].sampleCents === null, "blocked shows no sample");
  const unv = employeeAchCard({ ...base, plan: { state: "active", accounts: [acct({ verificationStatus: "pending" })] } });
  ok(unv.state === "blocked" && unv.detail.includes("not verified") && !unv.accounts[0].verified, "unverified blocked");
  const weird = employeeAchCard({ ...base, plan: { state: "paused", accounts: [acct()] } });
  ok(weird.state === "blocked" && weird.authorizationState === "paused", "unknown state blocked");
  const empty = employeeAchCard({ ...base, plan: { state: "active", accounts: [] } });
  ok(empty.state === "blocked", "no accounts blocked");

  const full = ["123456789", "555554321", "11112222", "33334444", "55556666", "125000105"];
  for (const c of [one, split, held, lo, nr, zeroLeg]) {
    const j = JSON.stringify(c);
    ok(!full.some((n) => j.includes(n)), "no full account or routing number in card");
  }

  console.log(`employee-ach-card: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
