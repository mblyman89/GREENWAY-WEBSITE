/**
 * src/lib/accounting/journal-specimen-core.ts   (slice books-91, D-71)
 *
 * WHAT A JOURNAL ENTRY LOOKS LIKE — BUILT BY THE REAL ENGINE, NOT TYPED.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 * ───────────────────────────────────────────────────────────────────────────
 * Michael, in books-91:
 *
 *   "I really want to see what a journal entry looks like in that page as well
 *    as the ledger after it's been approved. I want to see if the workflow
 *    process works end to end in some way."
 *
 * He is a visual learner and he asked to SEE the thing. The obvious way to
 * answer that is to type a pretty table of plausible numbers into a page. That
 * would be a lie with good intentions: it would show him what somebody HOPED
 * the engine does, and the moment the engine changed, the picture would keep
 * smiling. The books-44 learn page header records exactly this happening
 * before — "a worked example typed straight into markup once asserted a gross
 * margin of 47.9% when the arithmetic gave 42.71%".
 *
 * So nothing here is typed. This module states a small, explicit DELIVERY —
 * two lots, quantities, unit costs — and then hands it to the same three
 * functions that a real finalize hands a real delivery to:
 *
 *     translateLotsToBillLines()   (vendor-bill-service.ts)
 *     evaluateVendorBill()         (vendor-bill-core.ts)
 *     buildBillJournal()           (vendor-bill-core.ts)
 *
 * Every account code, every debit, every credit, every 280E cost class and the
 * memo on the specimen is whatever those functions RETURN. If the engine's
 * account mapping changes tomorrow, this specimen changes with it — and if the
 * engine starts refusing, the specimen refuses in front of Michael instead of
 * pretending. That is the difference between a picture of the feature and the
 * feature.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THIS IS A SPECIMEN, AND IT SAYS SO
 * ───────────────────────────────────────────────────────────────────────────
 * `SPECIMEN_NOTICE` is exported and the screen prints it. Nothing in here is
 * on Michael's books, nothing here posts, and no figure here is Greenway's
 * money. A teaching example that could be mistaken for a real balance is worse
 * than no teaching example at all.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY A PURCHASE SHOWS "POST", NOT "APPROVE AND POST"
 * ───────────────────────────────────────────────────────────────────────────
 * Migration 0174 exempts `purchase` from the second-approver rule, and
 * approval-core.ts mirrors that list. A vendor bill is therefore a one-button
 * entry however large it is. That surprises people who expect a big number to
 * demand a signature, so the specimen DERIVES the button label from
 * `isApprovalExempt()` rather than asserting one, and says why.
 *
 * The ledger half of the specimen is derived too: posting a balanced entry to
 * an empty account means the running balance IS that line's own amount, so the
 * "after approval" view is folded from the same lines rather than re-keyed.
 */

import {
  evaluateVendorBill,
  buildBillJournal,
  AP_ACCOUNT_CODE,
  IN_TRANSIT_ACCOUNT_CODE,
  type VendorBillInput,
  type BillJournal,
} from "@/lib/accounting/vendor-bill-core";
import { translateLotsToBillLines, type BillLotRow } from "@/lib/accounting/vendor-bill-service";
import { isApprovalExempt } from "@/lib/accounting/approval-core";
import { formatCents } from "@/lib/accounting/books-view-core";

/** Printed on the screen. The specimen must never be mistaken for real books. */
export const SPECIMEN_NOTICE =
  "This is a worked example, not your books. Nothing on this page has been " +
  "posted, no money here is Greenway's, and no figure below was typed by " +
  "hand — every account, debit and credit was produced by the same code that " +
  "runs when you finalize a real delivery.";

/**
 * The delivery the specimen describes. Deliberately small and boring: two
 * cannabis lots from one vendor, priced, with unit costs that are not round
 * dollars, so the arithmetic on screen is visibly real.
 *
 * Quantities are whole units; `unit_cost_minor_units` is integer cents. These
 * are the ONLY numbers stated in this file. Everything else is computed.
 */
export const SPECIMEN_LOTS: readonly BillLotRow[] = [
  {
    id: "specimen-lot-1",
    lot_code: "SPEC-FLOWER-001",
    category: "flower",
    received_qty: 12,
    unit_cost_minor_units: 87550,
    status: "active",
    is_sample: false,
  },
  {
    id: "specimen-lot-2",
    lot_code: "SPEC-CART-002",
    category: "cartridge",
    received_qty: 24,
    unit_cost_minor_units: 41225,
    status: "active",
    is_sample: false,
  },
  {
    // D-72 (books-92). A free trade sample rides in on the same manifest. It
    // is lawfully zero-cost, so it must NOT appear on the bill and must NOT be
    // mistaken for a lot whose price nobody keyed. The proof is arithmetic:
    // adding this row does not move the specimen total by one cent.
    id: "specimen-lot-3",
    lot_code: "SPEC-SAMPLE-003",
    category: "flower",
    received_qty: 2,
    unit_cost_minor_units: null,
    status: "active",
    is_sample: true,
  },
] as const;

export const SPECIMEN_VENDOR = "Cascade Growers LLC";
export const SPECIMEN_MANIFEST_NUMBER = "SPEC-0000001";
export const SPECIMEN_INVOICE_DATE = "2026-11-02";

/** One row of the specimen, in the shape the drafts screen already renders. */
export type SpecimenLine = {
  readonly accountCode: string;
  readonly accountName: string;
  readonly description: string;
  readonly costClass: string;
  /** Signed integer cents: positive debit, negative credit. */
  readonly amountCents: number;
  readonly debitText: string;
  readonly creditText: string;
};

/** One row of the "after it posted" ledger view, with a running balance. */
export type SpecimenLedgerRow = {
  readonly accountCode: string;
  readonly accountName: string;
  readonly description: string;
  readonly debitText: string;
  readonly creditText: string;
  readonly balanceText: string;
};

export type JournalSpecimen =
  | {
      readonly ok: true;
      readonly notice: string;
      readonly memo: string;
      readonly sourceKind: string;
      readonly sourceRef: string;
      readonly journalDate: string;
      readonly entityCode: string;
      readonly lines: readonly SpecimenLine[];
      readonly totalCents: number;
      readonly totalText: string;
      readonly balanced: boolean;
      /** What the drafts screen's button will say for this source kind. */
      readonly buttonLabel: string;
      readonly buttonWhy: string;
      readonly ledgerRows: readonly SpecimenLedgerRow[];
      /** The gapless number a posted entry receives. Illustrative only. */
      readonly postedJournalNo: string;
    }
  | {
      readonly ok: false;
      readonly notice: string;
      /** Why the real engine refused to build the specimen. Never swallowed. */
      readonly message: string;
    };

/**
 * Names for the handful of accounts the specimen can touch, lifted from
 * migration 0173's seed text. Kept as an explicit map rather than a database
 * read so the specimen renders with no connection — and a self-test asserts
 * every account the engine actually returns has a name here, so a new mapping
 * cannot ship a blank label.
 */
const SPECIMEN_ACCOUNT_NAMES: Readonly<Record<string, string>> = {
  "20010": "Inventory — Flower",
  "20120": "Inventory — Cartridge",
  "20890": "Inventory — Unmapped Category",
  [IN_TRANSIT_ACCOUNT_CODE]: "Inventory — In Transit",
  [AP_ACCOUNT_CODE]: "Accounts Payable",
};

export function specimenAccountName(code: string): string | null {
  return SPECIMEN_ACCOUNT_NAMES[code] ?? null;
}

/**
 * Build the specimen by running the real engine.
 *
 * `goodsAlreadyReceived` is false here on purpose: it produces the SIMPLER of
 * the two shapes (debit the category inventory accounts, credit A/P) which is
 * the one to show somebody first. The other shape — relieving 20800 when a
 * goods-receipt entry already exists — is explained in words on the screen
 * rather than shown as a second table, because two tables side by side is how
 * you teach somebody that the books are confusing.
 */
export function buildJournalSpecimen(): JournalSpecimen {
  const translated = translateLotsToBillLines(SPECIMEN_LOTS);
  if (translated.kind === "refused") {
    return { ok: false, notice: SPECIMEN_NOTICE, message: translated.message };
  }

  const bill: VendorBillInput = {
    entityCode: "greenway",
    vendorName: SPECIMEN_VENDOR,
    vendorId: null,
    invoiceNumber: SPECIMEN_MANIFEST_NUMBER,
    invoiceDate: SPECIMEN_INVOICE_DATE,
    statedTotalCents: translated.totalCents,
    lines: translated.lines,
    fromAcceptedManifest: true,
    manifestNumber: SPECIMEN_MANIFEST_NUMBER,
    goodsAlreadyReceived: false,
  };

  const verdict = evaluateVendorBill(bill, { vendorIsLicensedCannabis: true });
  const journal: BillJournal | null = buildBillJournal(bill, verdict);

  if (journal === null) {
    const blocks = verdict.findings
      .filter((f) => f.severity === "block")
      .map((f) => `${f.concern} ${f.fix}`)
      .join(" ");
    return {
      ok: false,
      notice: SPECIMEN_NOTICE,
      message:
        "The engine refused to build even this worked example: " +
        (blocks || "the bill was not postable."),
    };
  }

  const lines: SpecimenLine[] = journal.lines.map((l) => ({
    accountCode: l.accountCode,
    accountName: specimenAccountName(l.accountCode) ?? l.accountCode,
    description: l.description,
    costClass: l.costClass,
    amountCents: l.amountCents,
    debitText: l.amountCents > 0 ? formatCents(l.amountCents) : "",
    creditText: l.amountCents < 0 ? formatCents(-l.amountCents) : "",
  }));

  const signedSum = lines.reduce((s, l) => s + l.amountCents, 0);
  const debitTotal = lines.reduce((s, l) => (l.amountCents > 0 ? s + l.amountCents : s), 0);

  // The ledger view: each account starts empty in this example, so the running
  // balance on a single posted entry is simply that line's own signed amount.
  // Shown in the ledger's own convention — parentheses for a credit balance.
  const ledgerRows: SpecimenLedgerRow[] = lines.map((l) => ({
    accountCode: l.accountCode,
    accountName: l.accountName,
    description: l.description,
    debitText: l.debitText,
    creditText: l.creditText,
    balanceText: formatCents(l.amountCents),
  }));

  const exempt = isApprovalExempt(journal.sourceKind);

  return {
    ok: true,
    notice: SPECIMEN_NOTICE,
    memo: journal.memo,
    sourceKind: journal.sourceKind,
    sourceRef: journal.sourceRef,
    journalDate: journal.journalDate,
    entityCode: journal.entityCode,
    lines,
    totalCents: debitTotal,
    totalText: formatCents(debitTotal),
    balanced: signedSum === 0,
    buttonLabel: exempt ? "Post to the ledger" : "Approve and post",
    buttonWhy: exempt
      ? `A "${journal.sourceKind}" entry is exempt from the second-approver rule ` +
        "in migration 0174, so this one posts on a single click however large it " +
        "is. The signature requirement exists to stop somebody quietly approving " +
        "their own unusual entry — a vendor bill is not unusual, it is evidenced " +
        "by a state manifest and an invoice."
      : `A "${journal.sourceKind}" entry is NOT exempt from the second-approver ` +
        "rule, so it must be approved before it can post.",
    ledgerRows,
    postedJournalNo: "(assigned on posting)",
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * SELF-TESTS
 *
 * Invoked from tests/compliance/journal-specimen.test.ts rather than from
 * scripts/compliance/run-pure-selftests.ts. That is deliberate and the runner
 * says so at the import site: this module reaches the real engine, which
 * reaches supabase/admin, which imports the "server-only" marker — and only
 * the vitest harness aliases that marker to a stub. Reimplementing the bill
 * engine in marker-free form purely to satisfy the other runner would create a
 * SECOND implementation that could disagree with the one Michael uses, which
 * is precisely what this specimen exists to prevent.
 * ═══════════════════════════════════════════════════════════════════════════ */

export function __runJournalSpecimenCoreTests(): void {
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`journal-specimen-core: ${msg}`);
  };

  const s = buildJournalSpecimen();
  ok(s.ok, "the specimen must build; the real engine refused it");
  if (!s.ok) return;

  // The whole point: it balances, because the real builder built it.
  ok(s.balanced, "specimen must balance");
  ok(
    s.lines.reduce((a, l) => a + l.amountCents, 0) === 0,
    "signed amounts must sum to zero",
  );

  // One credit to A/P, and it is the total.
  const credits = s.lines.filter((l) => l.amountCents < 0);
  ok(credits.length === 1, `expected exactly one credit line, got ${credits.length}`);
  ok(credits[0].accountCode === AP_ACCOUNT_CODE, "the credit must be Accounts Payable");
  ok(-credits[0].amountCents === s.totalCents, "the payable must equal the debits");

  // The arithmetic is the DELIVERY's arithmetic, computed here independently of
  // the engine (rule 39 — this does not re-run translateLotsToBillLines, it
  // multiplies the stated quantities and costs by hand).
  const expected = SPECIMEN_LOTS.reduce(
    (a, l) => a + Math.round((l.received_qty ?? 0) * (l.unit_cost_minor_units ?? 0)),
    0,
  );
  ok(
    s.totalCents === expected,
    `specimen total ${s.totalCents} should be ${expected} (qty x unit cost)`,
  );

  // Every account the engine returned must have a readable name, or the screen
  // shows a bare number to a man who asked to SEE what an entry looks like.
  for (const l of s.lines) {
    ok(
      specimenAccountName(l.accountCode) !== null,
      `account ${l.accountCode} has no name in SPECIMEN_ACCOUNT_NAMES`,
    );
  }

  // Debits and credits never share a column.
  for (const l of s.lines) {
    ok(
      !(l.debitText !== "" && l.creditText !== ""),
      `line ${l.accountCode} is in both columns`,
    );
  }

  // The button label is DERIVED from the exempt list, not asserted.
  ok(s.sourceKind === "purchase", `expected a purchase, got ${s.sourceKind}`);
  ok(
    s.buttonLabel === "Post to the ledger",
    `a purchase is approval-exempt, so the button must say Post; got "${s.buttonLabel}"`,
  );

  // The ledger view carries one row per journal line and repeats the amounts.
  ok(
    s.ledgerRows.length === s.lines.length,
    "the ledger view must show every line of the entry",
  );

  // A credit balance is shown in parentheses, never as a minus sign.
  const apRow = s.ledgerRows.find((r) => r.accountCode === AP_ACCOUNT_CODE);
  ok(apRow !== undefined, "the ledger view must include the payable");
  ok(
    apRow!.balanceText.startsWith("(") && !apRow!.balanceText.includes("-"),
    `a credit balance must read as (n), got ${apRow!.balanceText}`,
  );

  // The specimen must announce itself.
  ok(/not your books/i.test(s.notice), "the specimen must say it is not real");
}
