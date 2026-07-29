/**
 * src/lib/payments/payee-banking-core.ts — SLICE 80 (PURE)
 *
 * The brain of the payee banking vault: validation, masking, audit-diff
 * building, and tamper detection. No I/O — fully unit-testable.
 *
 * Fraud model (WA State Auditor guidance, Apr 2023): ACH payment fraud almost
 * always starts as a bank-detail change. Controls implemented across the
 * vault: admin-only edit surface (segregation of duties), an audited diff for
 * every change (masked tails only — full numbers NEVER appear in audit logs),
 * an on-hold status for changes pending out-of-band verification, and a
 * tamper comparator that flags any attempt to submit bank details that differ
 * from the vault record during payment.
 */
import { isValidRouting } from "@/lib/payments/nacha-core";
import { maskAccountTail } from "@/lib/security/at-rest-crypto";

export type PayeeBankInput = {
  bankName: string;
  routing: string;
  accountNumber: string;
  accountType: "checking" | "savings";
};

export type PayeeBankValidation =
  | { ok: true; value: PayeeBankInput }
  | { ok: false; refusal: string };

/**
 * Validate a banking record before it may enter the vault. Plain-English
 * refusals; trims everything; strips spaces/dashes people paste from
 * statements out of routing/account numbers.
 */
export function validatePayeeBankInput(raw: {
  bankName?: string | null;
  routing?: string | null;
  accountNumber?: string | null;
  accountType?: string | null;
}): PayeeBankValidation {
  const bankName = (raw.bankName ?? "").trim();
  const routing = (raw.routing ?? "").replace(/[\s-]/g, "");
  const accountNumber = (raw.accountNumber ?? "").replace(/[\s-]/g, "");
  const typeRaw = (raw.accountType ?? "").trim();

  if (!routing) return { ok: false, refusal: "Enter the bank's 9-digit routing number." };
  if (!/^\d{9}$/.test(routing)) {
    return { ok: false, refusal: "Routing numbers are exactly 9 digits." };
  }
  if (!isValidRouting(routing)) {
    return {
      ok: false,
      refusal: `Routing number "${routing}" fails the ABA check digit — double-check it against the vendor's voided check or bank letter.`,
    };
  }
  if (!accountNumber) return { ok: false, refusal: "Enter the account number." };
  if (!/^[0-9]{4,17}$/.test(accountNumber)) {
    return {
      ok: false,
      refusal: "Account numbers are 4–17 digits (numbers only — no spaces or dashes).",
    };
  }
  if (typeRaw !== "checking" && typeRaw !== "savings") {
    return { ok: false, refusal: "Pick checking or savings." };
  }
  return {
    ok: true,
    value: { bankName, routing, accountNumber, accountType: typeRaw },
  };
}

/**
 * Masked audit diff for a vault change: SAFE to store in audit logs and show
 * on screen. Full account numbers never leave the vault; routing numbers are
 * public bank identifiers but we still show only a tail for consistency.
 */
export type MaskedBankSnapshot = {
  bank_name: string;
  routing_tail: string;
  account_tail: string;
  account_type: string;
  status: string;
};

export function maskedBankSnapshot(rec: {
  bankName: string;
  routing: string;
  accountNumber: string;
  accountType: string;
  status: string;
}): MaskedBankSnapshot {
  return {
    bank_name: rec.bankName,
    routing_tail: maskAccountTail(rec.routing),
    account_tail: maskAccountTail(rec.accountNumber),
    account_type: rec.accountType,
    status: rec.status,
  };
}

/**
 * Plain-English change lines for the audit trail ("routing ••••0021 → ••••0025").
 * Empty array = nothing changed.
 */
export function describeBankChange(
  before: MaskedBankSnapshot | null,
  after: MaskedBankSnapshot,
): string[] {
  if (!before) return [`banking added: ${after.bank_name || "bank"} ${after.account_tail} (${after.account_type})`];
  const lines: string[] = [];
  if (before.bank_name !== after.bank_name) lines.push(`bank: ${before.bank_name || "(empty)"} → ${after.bank_name || "(empty)"}`);
  if (before.routing_tail !== after.routing_tail) lines.push(`routing: ${before.routing_tail} → ${after.routing_tail}`);
  if (before.account_tail !== after.account_tail) lines.push(`account: ${before.account_tail} → ${after.account_tail}`);
  if (before.account_type !== after.account_type) lines.push(`type: ${before.account_type} → ${after.account_type}`);
  if (before.status !== after.status) lines.push(`status: ${before.status} → ${after.status}`);
  return lines;
}

/**
 * TAMPER DETECTION: during a payment, form-submitted bank fields are IGNORED —
 * the vault is the only source. But if someone DID submit values and they
 * differ from the vault, that's a deviation worth recording (attempted fraud
 * or a stale form). Returns null when there is nothing suspicious (fields
 * empty or matching the vault).
 */
export function detectBankTamper(params: {
  submittedRouting: string;
  submittedAccount: string;
  vaultRouting: string;
  vaultAccount: string;
}): { mismatchedFields: string[] } | null {
  const sr = params.submittedRouting.replace(/[\s-]/g, "");
  const sa = params.submittedAccount.replace(/[\s-]/g, "");
  const mismatched: string[] = [];
  if (sr && sr !== params.vaultRouting) mismatched.push("routing");
  if (sa && sa !== params.vaultAccount && !sa.includes("•")) mismatched.push("account");
  return mismatched.length > 0 ? { mismatchedFields: mismatched } : null;
}

/** Payment-time gate: may this vault record be paid to right now? */
export type VaultPayVerdict = { ok: true } | { ok: false; refusal: string };

export function canPayWithVaultRecord(rec: {
  status: string;
  routing: string;
  accountNumber: string;
} | null, vendorName: string): VaultPayVerdict {
  if (!rec) {
    return {
      ok: false,
      refusal: `${vendorName} has no banking on file. An admin must add it in Admin → Banking (the vault) before this invoice can be paid.`,
    };
  }
  if (rec.status === "on_hold") {
    return {
      ok: false,
      refusal: `${vendorName}'s banking is ON HOLD pending verification. Confirm the details with the vendor by phone (using a number you already have on file), then release the hold in Admin → Banking.`,
    };
  }
  if (!rec.routing || !rec.accountNumber) {
    return {
      ok: false,
      refusal: `${vendorName}'s banking record is incomplete. An admin must finish it in Admin → Banking.`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Self-tests (pure runner)
// ---------------------------------------------------------------------------
export function __runPayeeBankingCoreTests(): void {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  FAIL payee-banking-core: ${label}`);
    }
  };

  // validatePayeeBankInput
  const good = validatePayeeBankInput({
    bankName: "Timberland Bank",
    routing: "021000021",
    accountNumber: "12345678",
    accountType: "checking",
  });
  ok(good.ok === true, "valid input accepted");
  const spaced = validatePayeeBankInput({
    bankName: "x",
    routing: "021-000-021",
    accountNumber: "1234 5678",
    accountType: "savings",
  });
  ok(spaced.ok === true && spaced.ok && spaced.value.routing === "021000021", "spaces/dashes stripped");
  ok(validatePayeeBankInput({ routing: "021000022", accountNumber: "1234", accountType: "checking" }).ok === false, "bad ABA check digit refused");
  ok(validatePayeeBankInput({ routing: "12345", accountNumber: "1234", accountType: "checking" }).ok === false, "short routing refused");
  ok(validatePayeeBankInput({ routing: "021000021", accountNumber: "123", accountType: "checking" }).ok === false, "3-digit account refused");
  ok(validatePayeeBankInput({ routing: "021000021", accountNumber: "123456789012345678", accountType: "checking" }).ok === false, "18-digit account refused");
  ok(validatePayeeBankInput({ routing: "021000021", accountNumber: "1234", accountType: "money-market" }).ok === false, "unknown type refused");
  ok(validatePayeeBankInput({ routing: "", accountNumber: "1234", accountType: "checking" }).ok === false, "empty routing refused");

  // maskedBankSnapshot never leaks full numbers
  const snap = maskedBankSnapshot({ bankName: "B", routing: "021000021", accountNumber: "12345678", accountType: "checking", status: "active" });
  ok(!JSON.stringify(snap).includes("12345678"), "snapshot omits full account");
  ok(snap.account_tail.endsWith("5678"), "snapshot keeps tail");

  // describeBankChange
  const before = maskedBankSnapshot({ bankName: "B", routing: "021000021", accountNumber: "12345678", accountType: "checking", status: "active" });
  const after = maskedBankSnapshot({ bankName: "B", routing: "021000021", accountNumber: "87654321", accountType: "checking", status: "active" });
  const lines = describeBankChange(before, after);
  ok(lines.length === 1 && lines[0].includes("account:"), "account change described");
  ok(describeBankChange(before, before).length === 0, "no-change diff is empty");
  ok(describeBankChange(null, after)[0].startsWith("banking added"), "first add described");

  // detectBankTamper
  ok(detectBankTamper({ submittedRouting: "", submittedAccount: "", vaultRouting: "021000021", vaultAccount: "12345678" }) === null, "empty submission = no tamper");
  ok(detectBankTamper({ submittedRouting: "021000021", submittedAccount: "12345678", vaultRouting: "021000021", vaultAccount: "12345678" }) === null, "matching submission = no tamper");
  const tamper = detectBankTamper({ submittedRouting: "999999992", submittedAccount: "666", vaultRouting: "021000021", vaultAccount: "12345678" });
  ok(tamper !== null && tamper.mismatchedFields.length === 2, "mismatched routing+account flagged");
  ok(detectBankTamper({ submittedRouting: "", submittedAccount: "••••5678", vaultRouting: "021000021", vaultAccount: "12345678" }) === null, "masked echo is not tamper");

  // canPayWithVaultRecord
  ok(canPayWithVaultRecord(null, "Acme").ok === false, "missing record blocks");
  ok(canPayWithVaultRecord({ status: "on_hold", routing: "021000021", accountNumber: "1234" }, "Acme").ok === false, "on_hold blocks");
  const hold = canPayWithVaultRecord({ status: "on_hold", routing: "021000021", accountNumber: "1234" }, "Acme");
  ok(hold.ok === false && !hold.ok && /ON HOLD/.test(hold.refusal), "on_hold refusal explains the verification step");
  ok(canPayWithVaultRecord({ status: "active", routing: "", accountNumber: "1234" }, "Acme").ok === false, "incomplete record blocks");
  ok(canPayWithVaultRecord({ status: "active", routing: "021000021", accountNumber: "1234" }, "Acme").ok === true, "active complete record pays");

  if (failed > 0) throw new Error(`payee-banking-core: ${failed} test(s) failed`);
  console.log(`payee-banking-core: ${passed} passed, 0 failed`);
}
