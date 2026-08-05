/**
 * src/lib/compliance/excise-send-core.ts
 *
 * PURE helpers for the "Send to WSLCB" action on the LIQ-1295 excise return.
 * No I/O — directly unit-testable with tsx.
 *
 * Two responsibilities, both pure:
 *   1. sendEligibility(...) — decide whether the "Send to WSLCB" button may
 *      light up. The completed return is a legal filing "Certified True and
 *      Correct Under Penalty of Perjury" (the LIQ-1295 signature block), so we
 *      only allow a send when the identity/header is complete, no data-load
 *      warning is present, and the owner has ticked the perjury certification.
 *   2. buildExciseEmail(...) — assemble the subject / plain-text / HTML body for
 *      the submission email (recipients live in excise-payment-core). No secrets,
 *      no network — just strings, so the wording is locked by tests.
 *
 * The DESTINATION address (cannabistaxes@lcb.wa.gov) and the sender/CC live in
 * excise-payment-core.ts; this module never hardcodes them.
 */

/** The minimal shape of a return needed to judge send-eligibility (from ExciseReturnData). */
export type ExciseSendCandidate = {
  identity: {
    licenseNumber: string;
    tradeName: string;
    locationAddress: string;
    city: string;
    phone: string;
    email: string;
  };
  boxes: { month: number; year: number; box10_amountToPay: number; noSales: boolean };
  dueDate: string;
  /** Human warnings from the compute step; some are BLOCKING (data-load failures). */
  warnings: string[];
};

export type SendEligibility = {
  /** True only when the button may be enabled. */
  canSend: boolean;
  /** Plain-English reasons the button is disabled (empty when canSend). */
  blockers: string[];
};

/**
 * A warning is BLOCKING when it means the figures may be wrong / incomplete —
 * i.e. the compute step could not load the underlying data. Advisory warnings
 * (non-cannabis excluded, manual override, no-sales, missing e-mail — handled
 * separately as a hard field check) do NOT block on their own.
 */
export function isBlockingWarning(w: string): boolean {
  const s = w.toLowerCase();
  return s.includes("could not load");
}

/**
 * Decide whether the return may be sent to the WSLCB.
 *
 * @param candidate  the resolved return (identity + boxes + warnings)
 * @param certified  the owner ticked "Certified True and Correct Under Penalty
 *                   of Perjury" for THIS return, this session.
 */
export function sendEligibility(candidate: ExciseSendCandidate, certified: boolean): SendEligibility {
  const blockers: string[] = [];
  const id = candidate.identity;

  if (!id.licenseNumber?.trim()) blockers.push("License number is missing.");
  if (!id.tradeName?.trim()) blockers.push("Trade name is missing.");
  if (!id.locationAddress?.trim()) blockers.push("Location address is missing.");
  if (!id.city?.trim()) blockers.push("City is missing.");
  // The LIQ-1295 signature block requires a contact e-mail; it's also our reply-to.
  if (!id.email?.trim()) blockers.push("Contact e-mail is missing (required on the form's signature block).");

  for (const w of candidate.warnings) {
    if (isBlockingWarning(w)) blockers.push(w);
  }

  if (!certified) {
    blockers.push('You must certify the return is "true and correct under penalty of perjury" before sending.');
  }

  return { canSend: blockers.length === 0, blockers };
}

// ---------------------------------------------------------------------------
// Email body assembly (pure strings).
// ---------------------------------------------------------------------------

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Format a dollar number as $#,###.##. */
export function fmtDollars(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The month name for a 1-12 month number (safe fallback). */
export function monthName(month: number): string {
  return MONTHS[month - 1] ?? String(month);
}

export type ExciseEmailInput = {
  identity: ExciseSendCandidate["identity"];
  boxes: ExciseSendCandidate["boxes"];
  dueDate: string;
  flags?: { isRevised?: boolean; isNoSales?: boolean; isFinal?: boolean };
  /** The attached file name (LIQ-1295_<license>_<YYYY>-<MM>.xlsx). */
  fileName: string;
};

export type ExciseEmail = { subject: string; text: string; html: string };

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Build the submission email. The body summarizes the return so a human at the
 * Tax & Fee Unit sees the key figures at a glance, and names the attached form.
 */
export function buildExciseEmail(input: ExciseEmailInput): ExciseEmail {
  const { identity, boxes, dueDate, flags, fileName } = input;
  const period = `${monthName(boxes.month)} ${boxes.year}`;
  const kind = flags?.isRevised
    ? "REVISED "
    : flags?.isFinal
    ? "FINAL "
    : "";
  const noSalesTag = boxes.noSales || flags?.isNoSales ? " — NO SALES" : "";

  const subject =
    `${kind}Cannabis Retailer Sales & Excise Tax (LIQ-1295) — ` +
    `License ${identity.licenseNumber} — ${period}${noSalesTag}`;

  const lines = [
    `Washington Cannabis Retailer Sales & Excise Tax return (Form LIQ-1295)`,
    ``,
    `License number: ${identity.licenseNumber}`,
    `Trade name:     ${identity.tradeName}`,
    `Location:       ${identity.locationAddress}, ${identity.city}`,
    `Reporting period: ${period}`,
    `Due date:       ${dueDate}`,
    ``,
    flags?.isRevised ? `This is a REVISED report.` : ``,
    flags?.isFinal ? `This is a FINAL report (business closed/sold).` : ``,
    boxes.noSales || flags?.isNoSales ? `No cannabis sales to report this period.` : ``,
    ``,
    `Amount to pay (Box 10): ${fmtDollars(boxes.box10_amountToPay)}`,
    `(Payment is being submitted separately per WSLCB instructions.)`,
    ``,
    `The completed LIQ-1295 is attached as: ${fileName}`,
    ``,
    `Contact: ${identity.phone || "(phone not set)"} · ${identity.email || "(e-mail not set)"}`,
  ].filter((l) => l !== "");

  const text = lines.join("\n");

  const html =
    `<div style="font-family:system-ui,Arial,sans-serif;color:#111;font-size:14px;line-height:1.5">` +
    `<h2 style="color:#12351f;margin:0 0 8px">Cannabis Retailer Sales &amp; Excise Tax (LIQ-1295)</h2>` +
    `<table style="border-collapse:collapse;font-size:14px">` +
    row("License number", identity.licenseNumber) +
    row("Trade name", identity.tradeName) +
    row("Location", `${identity.locationAddress}, ${identity.city}`) +
    row("Reporting period", period) +
    row("Due date", dueDate) +
    row("Amount to pay (Box 10)", fmtDollars(boxes.box10_amountToPay)) +
    `</table>` +
    (flags?.isRevised ? `<p style="margin:8px 0 0"><strong>This is a REVISED report.</strong></p>` : ``) +
    (flags?.isFinal ? `<p style="margin:8px 0 0"><strong>This is a FINAL report (business closed/sold).</strong></p>` : ``) +
    (boxes.noSales || flags?.isNoSales ? `<p style="margin:8px 0 0"><strong>No cannabis sales to report this period.</strong></p>` : ``) +
    `<p style="margin:12px 0 0;color:#555">Payment is being submitted separately per WSLCB instructions. ` +
    `The completed LIQ-1295 is attached as <code>${escapeHtml(fileName)}</code>.</p>` +
    `<p style="margin:12px 0 0;color:#555;font-size:13px">Contact: ${escapeHtml(identity.phone || "(phone not set)")} &middot; ` +
    `${escapeHtml(identity.email || "(e-mail not set)")}</p>` +
    `</div>`;

  return { subject, text, html };
}

function row(label: string, value: string): string {
  return (
    `<tr>` +
    `<td style="padding:2px 12px 2px 0;color:#555">${escapeHtml(label)}</td>` +
    `<td style="padding:2px 0;font-weight:600">${escapeHtml(value)}</td>` +
    `</tr>`
  );
}

// ---------------------------------------------------------------------------
// Self-tests (tsx-runnable; PURE).
// ---------------------------------------------------------------------------

export function __runExciseSendCoreTests(): void {
  let pass = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
    pass += 1;
  };
  const eq = (a: unknown, b: unknown, msg: string) =>
    ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`);

  const goodId = {
    licenseNumber: "413541",
    tradeName: "Greenway Marijuana",
    locationAddress: "1234 Bethel Ave",
    city: "Port Orchard",
    phone: "360-555-0100",
    email: "michael@greenwaymarijuana.com",
  };
  const base: ExciseSendCandidate = {
    identity: goodId,
    boxes: { month: 5, year: 2025, box10_amountToPay: 3700, noSales: false },
    dueDate: "2025-06-20",
    warnings: [],
  };

  // Not certified → blocked, with the perjury reason.
  const e0 = sendEligibility(base, false);
  ok(!e0.canSend, "not certified → cannot send");
  ok(e0.blockers.some((b) => b.toLowerCase().includes("perjury")), "perjury blocker present");

  // Certified + complete → can send.
  const e1 = sendEligibility(base, true);
  ok(e1.canSend, "certified + complete → can send");
  eq(e1.blockers, [], "no blockers when ready");

  // Missing identity fields each block.
  const missing = sendEligibility(
    { ...base, identity: { ...goodId, licenseNumber: "", email: "" } },
    true,
  );
  ok(!missing.canSend, "missing license+email → blocked");
  ok(missing.blockers.some((b) => b.toLowerCase().includes("license")), "license blocker");
  ok(missing.blockers.some((b) => b.toLowerCase().includes("e-mail")), "email blocker");

  // A "Could not load" warning is blocking; advisory warnings are not.
  ok(isBlockingWarning("Could not load orders: boom"), "load failure is blocking");
  ok(!isBlockingWarning("Non-cannabis (merch/accessory) sales of $10.00 were excluded from Box 1"), "merch exclusion is advisory");
  ok(!isBlockingWarning("Box 1 was manually overridden — it does not match the live completed-sales total."), "override advisory");
  const blocked = sendEligibility({ ...base, warnings: ["Could not load order lines: timeout"] }, true);
  ok(!blocked.canSend, "load-failure warning blocks send");

  // No-sales month is still sendable (the form must be filed even with $0).
  const noSales = sendEligibility(
    { ...base, boxes: { month: 2, year: 2025, box10_amountToPay: 0, noSales: true } },
    true,
  );
  ok(noSales.canSend, "no-sales month can still be filed");

  // Email body: subject + attachment name + key figures.
  const em = buildExciseEmail({
    identity: goodId,
    boxes: base.boxes,
    dueDate: base.dueDate,
    fileName: "LIQ-1295_413541_2025-05.xlsx",
  });
  ok(em.subject.includes("LIQ-1295"), "subject names the form");
  ok(em.subject.includes("413541"), "subject has license");
  ok(em.subject.includes("May 2025"), "subject has period");
  ok(em.text.includes("LIQ-1295_413541_2025-05.xlsx"), "text names the attachment");
  ok(em.text.includes("$3,700.00"), "text shows amount to pay");
  ok(em.html.includes("Greenway Marijuana"), "html shows trade name");
  ok(!em.html.includes("<script"), "html has no script");

  // Revised / final / no-sales tags in the subject.
  const emRev = buildExciseEmail({
    identity: goodId,
    boxes: base.boxes,
    dueDate: base.dueDate,
    flags: { isRevised: true },
    fileName: "f.xlsx",
  });
  ok(emRev.subject.startsWith("REVISED "), "revised subject prefix");
  const emNo = buildExciseEmail({
    identity: goodId,
    boxes: { month: 2, year: 2025, box10_amountToPay: 0, noSales: true },
    dueDate: "2025-03-20",
    fileName: "f.xlsx",
  });
  ok(emNo.subject.includes("NO SALES"), "no-sales subject tag");

  eq(fmtDollars(3700), "$3,700.00", "fmtDollars thousands");
  eq(monthName(5), "May", "month name");

  console.log(`excise-send-core: ${pass} assertions passed`);
}
