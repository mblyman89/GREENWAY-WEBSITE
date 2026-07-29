/**
 * src/lib/payments/banking-vault-ui-core.ts — SLICE 94 (PURE)
 *
 * The presentation brain of the Banking vault door (/admin/settings/banking):
 * badge states, coverage lines, the honest security-posture strip, and tab
 * resolution. No I/O — fully unit-testable.
 *
 * Why badges exist (owner's request, Round 7): Michael needs to KNOW, at a
 * glance on a vendor's or employee's own page, whether their bank details are
 * saved in the vault — without ever printing a full number outside the vault.
 * Enterprise rule enforced here: every string this module produces carries AT
 * MOST a masked tail (••••1234). Full routing/account numbers can be passed IN
 * (the callers hold decrypted values server-side) but can never appear in any
 * output — the self-tests pin that with JSON.stringify sweeps.
 *
 * Industry grounding: this mirrors how Stripe/Plaid-class dashboards present
 * stored payment credentials — status chip + last-4 only, edit behind a
 * dedicated vault surface, and a security posture readout that tells the
 * truth (if at-rest encryption is off because DATA_ENCRYPTION_KEY isn't set,
 * we SAY so instead of pretending).
 */
import { maskAccountTail } from "@/lib/security/at-rest-crypto";

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

/** The vault door's three tabs. Vendors opens first (owner's spec). */
export type VaultTab = "vendors" | "employees" | "company";

/**
 * Resolve the ?tab= query param. Unknown/missing → vendors (the default the
 * owner asked to open on). Legacy "payees" links land on vendors too.
 */
export function resolveVaultTab(param: string | null | undefined): VaultTab {
  const p = (param ?? "").trim().toLowerCase();
  if (p === "employees") return "employees";
  if (p === "company" || p === "mine" || p === "my-banking") return "company";
  return "vendors";
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export type VaultBadgeState = "none" | "unverified" | "verified" | "on_hold";

export type VaultBadge = {
  state: VaultBadgeState;
  /** Short chip text, e.g. "Banking in vault · verified". */
  label: string;
  /** Tone matching the shared <Badge> component. */
  tone: "neutral" | "green" | "gold" | "orange";
  /** One plain-English line with AT MOST a masked tail. */
  detail: string;
};

/**
 * Badge for a vendor's profile page. Accepts the DECRYPTED account number
 * (server-side only) and masks it itself, so callers can't accidentally leak
 * a full number into the badge.
 */
export function vendorBankingBadge(input: {
  hasRecord: boolean;
  status?: "active" | "on_hold" | string | null;
  verifiedAt?: string | null;
  accountNumber?: string | null;
  bankName?: string | null;
}): VaultBadge {
  if (!input.hasRecord) {
    return {
      state: "none",
      label: "No banking on file",
      tone: "neutral",
      detail:
        "This vendor can't be paid by ACH until their bank details are added to the vault.",
    };
  }
  const tail = maskAccountTail(input.accountNumber ?? "");
  const bank = (input.bankName ?? "").trim();
  const where = bank ? `${bank} ${tail}` : tail;
  if (input.status === "on_hold") {
    return {
      state: "on_hold",
      label: "Banking ON HOLD",
      tone: "orange",
      detail: `${where} — payments are blocked until the hold is released in the vault.`,
    };
  }
  if (input.verifiedAt) {
    return {
      state: "verified",
      label: "Banking in vault · verified",
      tone: "green",
      detail: `${where} — verified ${new Date(input.verifiedAt).toLocaleDateString("en-US")}.`,
    };
  }
  return {
    state: "unverified",
    label: "Banking in vault · not yet verified",
    tone: "gold",
    detail: `${where} — call the vendor at a number you already have to verify, then mark it verified in the vault.`,
  };
}

/**
 * Badge for an employee's file page (direct deposit lives on the employees
 * table — no verified/on-hold lifecycle there, just on file / not on file).
 */
export function employeeBankingBadge(input: {
  routing?: string | null;
  accountNumber?: string | null;
  accountType?: string | null;
}): VaultBadge {
  const has = Boolean((input.routing ?? "").trim() || (input.accountNumber ?? "").trim());
  if (!has) {
    return {
      state: "none",
      label: "No direct deposit on file",
      tone: "neutral",
      detail:
        "This employee drops off the payroll NACHA file until banking is added in the vault.",
    };
  }
  const tail = maskAccountTail(input.accountNumber ?? "");
  const type = input.accountType === "savings" ? "savings" : "checking";
  return {
    state: "verified",
    label: "Direct deposit on file",
    tone: "green",
    detail: `${tail} (${type}) — payroll runs pull this automatically.`,
  };
}

// ---------------------------------------------------------------------------
// Coverage lines
// ---------------------------------------------------------------------------

/**
 * Honest coverage sentence for the vault door header, e.g.
 * "3 of 14 vendors have banking on file (1 on hold, 1 not yet verified)".
 */
export function vendorCoverageLine(input: {
  vendorsTotal: number;
  withBanking: number;
  onHold: number;
  unverified: number;
}): string {
  const extras: string[] = [];
  if (input.onHold > 0) extras.push(`${input.onHold} on hold`);
  if (input.unverified > 0) extras.push(`${input.unverified} not yet verified`);
  const tail = extras.length > 0 ? ` (${extras.join(", ")})` : "";
  return `${input.withBanking} of ${input.vendorsTotal} vendors have banking on file${tail}`;
}

/** "5 of 6 active employees have direct deposit on file". */
export function employeeCoverageLine(input: {
  activeTotal: number;
  withBanking: number;
}): string {
  return `${input.withBanking} of ${input.activeTotal} active employees have direct deposit on file`;
}

// ---------------------------------------------------------------------------
// Security posture strip — tells the truth, never decorates
// ---------------------------------------------------------------------------

export type PostureItem = {
  ok: boolean;
  label: string;
  detail: string;
};

/**
 * The vault door's security readout. Every line is COMPUTED, not asserted:
 * if at-rest encryption is off (DATA_ENCRYPTION_KEY unset) or the vendor
 * vault table is missing (migration 0143), the strip says so in plain
 * English with the exact fix. The always-true lines (RLS, audit, masking,
 * segregation of duties) describe controls that are enforced in code and
 * SQL that ships with the app — they are listed so the owner can hand this
 * page to a bank, auditor, or Plaid/PAI reviewer as the vault's posture.
 */
export function vaultSecurityPosture(input: {
  encryptionConfigured: boolean;
  vendorTableReady: boolean;
}): PostureItem[] {
  return [
    {
      ok: input.encryptionConfigured,
      label: "Encrypted at rest",
      detail: input.encryptionConfigured
        ? "Routing and account numbers are AES-256-GCM envelope-encrypted before they touch the database."
        : "NOT ACTIVE — set the DATA_ENCRYPTION_KEY environment variable (any long random string) so bank numbers are encrypted before storage. Values re-encrypt as they are next saved.",
    },
    {
      ok: input.vendorTableReady,
      label: "Database lock (admin-only RLS)",
      detail: input.vendorTableReady
        ? "The vendor vault table refuses reads AND writes for everyone but owner/admin — even a direct database connection with a staff login sees nothing."
        : "The vendor vault table doesn't exist yet — run migration 0143_payee_banking_vault.sql in the Supabase SQL editor.",
    },
    {
      ok: true,
      label: "Masked everywhere",
      detail:
        "Screens, badges, and audit entries only ever show the last 4 digits (••••1234). Full numbers exist only inside the vault's server-side read path.",
    },
    {
      ok: true,
      label: "Audited",
      detail:
        "Every add, change, hold, release, verification, and delete writes a who-did-what audit entry with masked old → new values.",
    },
    {
      ok: true,
      label: "Segregation of duties",
      detail:
        "Only owner/admin can edit banking; staff who run payments can never change where money goes. Payments resolve details from the vault — pay screens have no bank-number fields to tamper with.",
    },
  ];
}

// ---------------------------------------------------------------------------
// Self-tests (pure runner)
// ---------------------------------------------------------------------------

export function __runBankingVaultUiTests(): void {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  FAIL banking-vault-ui-core: ${label}`);
    }
  };

  // resolveVaultTab
  ok(resolveVaultTab(undefined) === "vendors", "no param → vendors (owner's default)");
  ok(resolveVaultTab("") === "vendors", "empty → vendors");
  ok(resolveVaultTab("vendors") === "vendors", "vendors passes through");
  ok(resolveVaultTab("employees") === "employees", "employees passes through");
  ok(resolveVaultTab("company") === "company", "company passes through");
  ok(resolveVaultTab("COMPANY") === "company", "case-insensitive");
  ok(resolveVaultTab("mine") === "company", "'mine' alias → company");
  ok(resolveVaultTab("payees") === "vendors", "legacy 'payees' → vendors");
  ok(resolveVaultTab("garbage") === "vendors", "junk → vendors, never crashes");

  // vendorBankingBadge — the four states
  const none = vendorBankingBadge({ hasRecord: false });
  ok(none.state === "none" && none.tone === "neutral", "no record → neutral none");
  const hold = vendorBankingBadge({
    hasRecord: true,
    status: "on_hold",
    accountNumber: "123456789",
    bankName: "Umpqua Bank",
  });
  ok(hold.state === "on_hold" && hold.tone === "orange", "on_hold → orange");
  ok(hold.detail.includes("Umpqua Bank"), "bank name shown (not a secret)");
  ok(hold.detail.includes("••••6789"), "on_hold detail shows masked tail");
  const verified = vendorBankingBadge({
    hasRecord: true,
    status: "active",
    verifiedAt: "2026-01-15T10:00:00Z",
    accountNumber: "987654321",
  });
  ok(verified.state === "verified" && verified.tone === "green", "verified → green");
  const unverified = vendorBankingBadge({
    hasRecord: true,
    status: "active",
    verifiedAt: null,
    accountNumber: "987654321",
  });
  ok(unverified.state === "unverified" && unverified.tone === "gold", "unverified → gold");
  ok(/verify/i.test(unverified.detail), "unverified detail tells the phone-verification step");

  // LEAK GUARD: a full account number must NEVER appear in any badge output.
  for (const badge of [hold, verified, unverified]) {
    const s = JSON.stringify(badge);
    ok(!s.includes("123456789") && !s.includes("987654321"), `no full number leaks (${badge.state})`);
  }

  // employeeBankingBadge
  const empNone = employeeBankingBadge({ routing: null, accountNumber: null });
  ok(empNone.state === "none", "employee without banking → none");
  ok(/NACHA/.test(empNone.detail), "employee none explains the payroll consequence");
  const empHas = employeeBankingBadge({
    routing: "021000021",
    accountNumber: "555666777",
    accountType: "savings",
  });
  ok(empHas.state === "verified" && empHas.tone === "green", "employee with banking → green");
  ok(empHas.detail.includes("••••6777") && empHas.detail.includes("savings"), "masked tail + type shown");
  ok(!JSON.stringify(empHas).includes("555666777"), "employee badge never leaks the full number");
  ok(!JSON.stringify(empHas).includes("021000021"), "employee badge never leaks the routing number");
  const empBlank = employeeBankingBadge({ routing: "  ", accountNumber: "" });
  ok(empBlank.state === "none", "whitespace-only banking counts as none");

  // Coverage lines
  ok(
    vendorCoverageLine({ vendorsTotal: 14, withBanking: 3, onHold: 1, unverified: 1 }) ===
      "3 of 14 vendors have banking on file (1 on hold, 1 not yet verified)",
    "vendor coverage with extras",
  );
  ok(
    vendorCoverageLine({ vendorsTotal: 10, withBanking: 10, onHold: 0, unverified: 0 }) ===
      "10 of 10 vendors have banking on file",
    "vendor coverage clean",
  );
  ok(
    employeeCoverageLine({ activeTotal: 6, withBanking: 5 }) ===
      "5 of 6 active employees have direct deposit on file",
    "employee coverage line",
  );

  // Security posture — honest states
  const allOn = vaultSecurityPosture({ encryptionConfigured: true, vendorTableReady: true });
  ok(allOn.length === 5, "posture has 5 items");
  ok(allOn.every((i) => i.ok), "all-green when encryption + table ready");
  const degraded = vaultSecurityPosture({ encryptionConfigured: false, vendorTableReady: false });
  ok(degraded[0].ok === false && degraded[0].detail.includes("DATA_ENCRYPTION_KEY"), "missing key named honestly");
  ok(degraded[1].ok === false && degraded[1].detail.includes("0143_payee_banking_vault.sql"), "missing table names the migration");
  ok(degraded[2].ok && degraded[3].ok && degraded[4].ok, "code-enforced controls stay true");
  ok(
    allOn.some((i) => /segregation/i.test(i.label)) && allOn.some((i) => /audit/i.test(i.label)),
    "posture covers segregation of duties + audit",
  );

  if (failed > 0) throw new Error(`banking-vault-ui-core: ${failed} test(s) failed`);
  console.log(`banking-vault-ui-core: ${passed} passed, 0 failed`);
}
