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

/** Every status vendor_bank_details may hold (0258 status check). */
export const VAULT_STATUSES = ["active", "on_hold", "revoked", "archived"] as const;
export type VaultStatus = (typeof VAULT_STATUSES)[number];

/**
 * FAIL CLOSED (R39 S3): only "active" pays. Before R39 the table could only
 * say active or on_hold, so refusing on_hold was enough; 0258 added revoked
 * and archived, and an allow-list is the only shape that cannot be widened
 * into paying a revoked account by a future status nobody handled.
 */
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
      refusal: `${vendorName}'s banking is ON HOLD pending verification. Confirm the details with the vendor by phone (using a number you already have on file) or in person, then release the hold in Admin → Banking.`,
    };
  }
  if (rec.status === "revoked") {
    return {
      ok: false,
      refusal: `${vendorName}'s ACH authorization was REVOKED. Pay another way, or get a new signed form and re-enter the banking (it will go on hold until verified).`,
    };
  }
  if (rec.status === "archived") {
    return {
      ok: false,
      refusal: `${vendorName}'s banking is ARCHIVED. Re-open it in Admin → Banking (it goes on hold until verified) before paying.`,
    };
  }
  if (rec.status !== "active") {
    return { ok: false, refusal: `${vendorName}'s banking has an unknown status ("${rec.status}"). Nothing is paid until an admin fixes it.` };
  }
  if (!rec.routing || !rec.accountNumber) {
    return {
      ok: false,
      refusal: `${vendorName}'s banking record is incomplete. An admin must finish it in Admin → Banking.`,
    };
  }
  return { ok: true };
}

/**
 * R39 S3: what the vendor-payments form shows for a vault record. Built ON
 * canPayWithVaultRecord, so the screen and the pay action can never disagree:
 * if the gate refuses, the form says blocked and shows the gate's own reason.
 */
export function vaultPayDisplay(rec: {
  status: string;
  routing: string;
  account_number: string;
  verified_at: string | null;
  vendor_name: string;
}): { payable: boolean; statusLabel: string; blockedReason: string | null } {
  const verdict = canPayWithVaultRecord(
    { status: rec.status, routing: rec.routing, accountNumber: rec.account_number },
    rec.vendor_name,
  );
  if (!verdict.ok) {
    const label =
      rec.status === "on_hold"
        ? "ON HOLD — payment blocked"
        : rec.status === "revoked"
          ? "REVOKED — payment blocked"
          : rec.status === "archived"
            ? "ARCHIVED — payment blocked"
            : "BLOCKED";
    return { payable: false, statusLabel: label, blockedReason: verdict.refusal };
  }
  return { payable: true, statusLabel: rec.verified_at ? "✓ verified" : "not yet verified", blockedReason: null };
}

/**
 * Did the BANK details really change? Compares DECRYPTED, normalised values.
 * encv1 ciphertext is different on every save (random IV), so comparing the
 * stored columns would call every save a change and put every vendor on hold
 * each time someone edited a note. Bank NAME is a label, not a payment
 * instruction, and does not count (routing identifies the bank).
 */
export function bankDetailsChanged(
  before: { routing: string; accountNumber: string; accountType: string } | null,
  after: { routing: string; accountNumber: string; accountType: string },
): boolean {
  if (!before) return true;
  const n = (v: string) => v.replace(/[\s-]/g, "");
  return (
    n(before.routing) !== n(after.routing) ||
    n(before.accountNumber) !== n(after.accountNumber) ||
    before.accountType !== after.accountType
  );
}

/**
 * What a save will do, decided before any write. The database (0259) enforces
 * the same outcome; this lets the screen say it plainly and lets the store
 * leave the encrypted columns alone when nothing changed.
 */
export function planVaultSave(
  before: { routing: string; accountNumber: string; accountType: string; status: string } | null,
  after: { routing: string; accountNumber: string; accountType: string },
): { writeBankColumns: boolean; resultingStatus: VaultStatus | "unchanged"; holdReason: string | null } {
  if (!before) return { writeBankColumns: true, resultingStatus: "on_hold", holdReason: "New banking added" };
  if (bankDetailsChanged(before, after)) {
    return { writeBankColumns: true, resultingStatus: "on_hold", holdReason: "Bank details changed" };
  }
  return { writeBankColumns: false, resultingStatus: "unchanged", holdReason: null };
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
  // R39 S3: fail closed on every non-active status
  ok(canPayWithVaultRecord({ status: "revoked", routing: "021000021", accountNumber: "1234" }, "Acme").ok === false, "revoked blocks");
  ok(canPayWithVaultRecord({ status: "archived", routing: "021000021", accountNumber: "1234" }, "Acme").ok === false, "archived blocks");
  ok(canPayWithVaultRecord({ status: "paused", routing: "021000021", accountNumber: "1234" }, "Acme").ok === false, "unknown status blocks");
  ok(canPayWithVaultRecord({ status: "", routing: "021000021", accountNumber: "1234" }, "Acme").ok === false, "empty status blocks");
  const rv = canPayWithVaultRecord({ status: "revoked", routing: "021000021", accountNumber: "1234" }, "Acme");
  ok(!rv.ok && /REVOKED/.test(rv.refusal), "revoked refusal names the status");
  const ar = canPayWithVaultRecord({ status: "archived", routing: "021000021", accountNumber: "1234" }, "Acme");
  ok(!ar.ok && /ARCHIVED/.test(ar.refusal), "archived refusal names the status");

  // bankDetailsChanged / planVaultSave (decrypted comparison)
  const b0 = { routing: "021000021", accountNumber: "12345678", accountType: "checking", status: "active" };
  ok(bankDetailsChanged(null, b0) === true, "no prior record = change");
  ok(bankDetailsChanged(b0, { ...b0 }) === false, "same values = no change");
  ok(bankDetailsChanged(b0, { ...b0, routing: "021-000-021", accountNumber: "1234 5678" }) === false, "formatting only = no change");
  ok(bankDetailsChanged(b0, { ...b0, routing: "325081403" }) === true, "routing only = change");
  ok(bankDetailsChanged(b0, { ...b0, accountNumber: "12345679" }) === true, "account only = change");
  ok(bankDetailsChanged(b0, { ...b0, accountType: "savings" }) === true, "type only = change");
  // vaultPayDisplay agrees with canPayWithVaultRecord for every status.
  const vd = (status: string, verified_at: string | null = null) =>
    vaultPayDisplay({ status, routing: "021000021", account_number: "12345678", verified_at, vendor_name: "V" });
  ok(vd("active", "2026-01-01").payable && vd("active", "2026-01-01").statusLabel === "✓ verified", "active verified → payable");
  ok(vd("active").payable && vd("active").statusLabel === "not yet verified", "active unverified → payable, says not verified");
  for (const st of ["on_hold", "revoked", "archived", "Active", ""]) {
    const d = vd(st, "2026-01-01");
    ok(!d.payable && d.blockedReason !== null && /blocked|BLOCKED/.test(d.statusLabel), `${st || "(empty)"} → blocked with reason`);
  }
  ok(vd("revoked").statusLabel.startsWith("REVOKED") && vd("archived").statusLabel.startsWith("ARCHIVED"), "revoked/archived named");
  const pNew = planVaultSave(null, b0);
  ok(pNew.writeBankColumns && pNew.resultingStatus === "on_hold" && pNew.holdReason === "New banking added", "new banking plan");
  const pSame = planVaultSave(b0, b0);
  ok(!pSame.writeBankColumns && pSame.resultingStatus === "unchanged" && pSame.holdReason === null, "no-change plan keeps columns + status");
  const pChg = planVaultSave(b0, { ...b0, accountNumber: "999999" });
  ok(pChg.writeBankColumns && pChg.resultingStatus === "on_hold" && pChg.holdReason === "Bank details changed", "change plan re-holds");

  if (failed > 0) throw new Error(`payee-banking-core: ${failed} test(s) failed`);
  console.log(`payee-banking-core: ${passed} passed, 0 failed`);
}
