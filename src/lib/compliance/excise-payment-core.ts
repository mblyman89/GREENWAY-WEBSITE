/**
 * src/lib/compliance/excise-payment-core.ts  (Slice 55)
 *
 * PURE helpers for the WA cannabis excise PAYMENT workflow. No I/O — directly
 * unit-testable with tsx.
 *
 * There is NO public payment API for the WA cannabis excise tax. A licensee pays
 * through one of the LCB's human portals or by mail/in-person. This module builds
 * a GUIDED payment workflow: a deep-link into the Retail Lockbox / PayStation
 * portal that is pre-filled with the license number, amount due, and due date, so
 * an employee only has to review and confirm. It never fabricates a payment
 * integration or auto-submits a payment.
 *
 * All facts below are grounded in docs/excise-payment-methods.md (verified):
 *   - PayStation deep-link base: https://www.paystation.com/TokenPayment/WSLCB
 *   - Token params (product/biller identifiers + editable account/amount/date):
 *       custom.productCode      = MarijuanaExciseTax
 *       custom.billerID         = EXC
 *       custom.billerGroupID    = WSL
 *       custom.accountidentifier1 = <license number>
 *       custom.amountdue        = <dollars, 2dp>
 *       static.transactionamount = <dollars, 2dp>
 *       custom.dueDate          = <YYYY-MM-DD>
 *       custom.disallowLogin    = N
 *   - The PayStation token is a comma-joined list of `key~value~<editableFlag>`.
 *   - Report is ALWAYS emailed to cannabistaxes@lcb.wa.gov.
 *   - Mail address (check / cashier's check / money order):
 *       Washington State Liquor and Cannabis Board, PO Box 3724, Seattle WA 98124-3724
 */

/** The canonical destination for the completed LIQ-1295 form. */
export const EXCISE_REPORT_EMAIL = "cannabistaxes@lcb.wa.gov";

/** CCRS portal (SAW login) — "Make a Payment" ACH path. */
export const CCRS_PORTAL_URL = "https://cannabisreporting.lcb.wa.gov/";

/** Retail Lockbox / PayStation deep-link base. */
export const PAYSTATION_BASE_URL = "https://www.paystation.com/TokenPayment/WSLCB";

/** Mailing address for paper payment. */
export const EXCISE_MAIL_ADDRESS =
  "Washington State Liquor and Cannabis Board, PO Box 3724, Seattle WA 98124-3724";

/**
 * PayStation "editable" flag per token field.
 *   Y = the field is shown pre-filled AND the user may edit it in the portal.
 *   N = the field is fixed / hidden.
 * We keep the account/amount/date editable (Y) so the employee can correct them
 * in the portal if the computed figure needs a manual adjustment, and lock the
 * product/biller identifiers (N) so the payment is always routed correctly.
 */
type PayStationField = { key: string; value: string; editable: "Y" | "N" };

/** Format a dollar amount to a plain 2dp string (no thousands separators). */
export function payAmountString(dollars: number): string {
  const n = Number.isFinite(dollars) ? dollars : 0;
  return (Math.round(n * 100) / 100).toFixed(2);
}

/** Sanitize a license number to digits/letters for the account identifier. */
export function cleanLicense(license: string): string {
  return (license || "").replace(/[^A-Za-z0-9]/g, "");
}

export type PayStationLinkInput = {
  licenseNumber: string;
  /** Amount to pay, in DOLLARS (LIQ-1295 Box 10). */
  amountDueDollars: number;
  /** Tax due date, ISO YYYY-MM-DD. */
  dueDateISO: string;
};

/**
 * Build the PayStation token field list. Exposed for testing so we can assert
 * each field/flag independently of URL encoding.
 */
export function payStationFields(input: PayStationLinkInput): PayStationField[] {
  const amount = payAmountString(input.amountDueDollars);
  return [
    { key: "custom.productCode", value: "MarijuanaExciseTax", editable: "N" },
    { key: "custom.billerID", value: "EXC", editable: "N" },
    { key: "custom.billerGroupID", value: "WSL", editable: "N" },
    { key: "custom.accountidentifier1", value: cleanLicense(input.licenseNumber), editable: "Y" },
    { key: "custom.amountdue", value: amount, editable: "Y" },
    { key: "static.transactionamount", value: amount, editable: "Y" },
    { key: "custom.dueDate", value: input.dueDateISO, editable: "Y" },
    { key: "custom.disallowLogin", value: "N", editable: "N" },
  ];
}

/**
 * Assemble the PayStation deep link. The token is the comma-joined list of
 * `key~value~editableFlag` triples, URL-encoded and passed as `?token=`.
 */
export function buildPayStationLink(input: PayStationLinkInput): string {
  const token = payStationFields(input)
    .map((f) => `${f.key}~${f.value}~${f.editable}`)
    .join(",");
  return `${PAYSTATION_BASE_URL}?token=${encodeURIComponent(token)}`;
}

/**
 * The CCRS ACH "Make a Payment" checklist. CCRS auto-fills the license number and
 * the current date; the employee enters the rest. We return the exact values they
 * will need on hand so they can copy them straight in.
 */
export type CcrsAchChecklist = {
  portalUrl: string;
  /** What CCRS auto-fills for you. */
  autoFilled: string[];
  /** What you must enter (with the values we can pre-compute). */
  youEnter: { label: string; value?: string }[];
};

export function buildCcrsAchChecklist(input: {
  licenseNumber: string;
  amountDueDollars: number;
  contactPhone?: string;
  contactEmail?: string;
}): CcrsAchChecklist {
  return {
    portalUrl: CCRS_PORTAL_URL,
    autoFilled: ["License number", "Payment date (today)"],
    youEnter: [
      { label: "Payment amount", value: `$${payAmountString(input.amountDueDollars)}` },
      { label: "Contact phone", value: input.contactPhone || undefined },
      { label: "Contact email (receipt sent here)", value: input.contactEmail || undefined },
      { label: "Bank routing number" },
      { label: "Bank account number" },
    ],
  };
}

/** Payment method labels for the reconciliation record. */
export const PAYMENT_METHODS = [
  { value: "ccrs_ach", label: "CCRS ACH (Make a Payment)" },
  { value: "paystation", label: "Retail Lockbox / PayStation" },
  { value: "mail", label: "Mail (check / money order)" },
  { value: "in_person", label: "In person" },
  { value: "other", label: "Other" },
] as const;

export type PaymentMethodValue = (typeof PAYMENT_METHODS)[number]["value"];

export function paymentMethodLabel(value: string | null | undefined): string {
  const m = PAYMENT_METHODS.find((x) => x.value === value);
  return m ? m.label : "—";
}

export function isPaymentMethod(v: string): v is PaymentMethodValue {
  return PAYMENT_METHODS.some((m) => m.value === v);
}

// ---------------------------------------------------------------------------
// Self-tests (tsx-runnable; PURE).
// ---------------------------------------------------------------------------

export function __runExcisePaymentCoreTests(): void {
  let pass = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
    pass += 1;
  };
  const eq = (a: unknown, b: unknown, msg: string) =>
    ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`);

  eq(payAmountString(3700), "3700.00", "amount 3700.00");
  eq(payAmountString(3005.6765), "3005.68", "amount rounds to 2dp");
  eq(payAmountString(0), "0.00", "zero amount");
  eq(cleanLicense("412345 -X"), "412345X", "license cleaned");

  const fields = payStationFields({ licenseNumber: "412345", amountDueDollars: 3700, dueDateISO: "2025-06-20" });
  eq(fields.length, 8, "8 token fields");
  eq(fields[0], { key: "custom.productCode", value: "MarijuanaExciseTax", editable: "N" }, "product code fixed");
  eq(fields[3], { key: "custom.accountidentifier1", value: "412345", editable: "Y" }, "account editable");
  eq(fields[4].value, "3700.00", "amountdue dollars");
  eq(fields[5].value, "3700.00", "transactionamount matches");
  eq(fields[6].value, "2025-06-20", "due date");

  const link = buildPayStationLink({ licenseNumber: "412345", amountDueDollars: 3700, dueDateISO: "2025-06-20" });
  ok(link.startsWith("https://www.paystation.com/TokenPayment/WSLCB?token="), "link base");
  const token = decodeURIComponent(link.split("token=")[1]);
  ok(token.includes("custom.productCode~MarijuanaExciseTax~N"), "token has product code");
  ok(token.includes("custom.accountidentifier1~412345~Y"), "token has account");
  ok(token.includes("custom.amountdue~3700.00~Y"), "token has amount");
  ok(token.includes("custom.dueDate~2025-06-20~Y"), "token has due date");
  ok(token.split(",").length === 8, "token has 8 triples");

  const chk = buildCcrsAchChecklist({
    licenseNumber: "412345",
    amountDueDollars: 3700,
    contactPhone: "360-555-0100",
    contactEmail: "owner@greenway.example",
  });
  eq(chk.portalUrl, "https://cannabisreporting.lcb.wa.gov/", "ccrs url");
  eq(chk.youEnter[0].value, "$3700.00", "checklist amount");
  eq(chk.youEnter[1].value, "360-555-0100", "checklist phone");

  eq(paymentMethodLabel("ccrs_ach"), "CCRS ACH (Make a Payment)", "method label");
  eq(paymentMethodLabel("nope"), "—", "unknown method dash");
  ok(isPaymentMethod("paystation"), "paystation is valid");
  ok(!isPaymentMethod("venmo"), "venmo invalid");

  console.log(`excise-payment-core: ${pass} assertions passed`);
}
