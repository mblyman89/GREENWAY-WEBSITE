/**
 * src/lib/compliance/sample-cap-notice-core.ts
 *
 * PURE builder for the "we can't accept this sample delivery" notice we send a
 * processor when accepting their manifest would exceed the WAC 314-55-096
 * quarterly incoming sample cap (120 units per processor per quarter).
 *
 * Kept pure (no I/O, no server-only) so the exact wording — which is a
 * compliance communication — can be unit-tested and locked. The server helper
 * (sendSampleCapVendorNotice) does the Resend send; the server action gathers
 * the numbers.
 *
 * Owner-approved content rules: plain + professional, cite the rule, state the
 * quarter usage math, ask them to hold the remaining samples until next
 * quarter. NO dollar amounts and NO customer data.
 */

const WAC_CITATION = "WAC 314-55-096";
const RETAILER_NAME = "Greenway Marijuana";

export type SampleCapNoticeInput = {
  /** the supplying processor's display name (the manifest vendor label). */
  processorName: string | null;
  /** units already recorded incoming for this processor this quarter. */
  usedUnits: number;
  /** the quarterly cap in force (normally 120). */
  capUnits: number;
  /** units this blocked delivery would have added. */
  addUnits: number;
  /** quarter key the accept would land in, e.g. "2026-Q1" (for context). */
  quarterKey: string;
  /** manifest number for the vendor's reference, when known. */
  manifestNumber?: string | null;
};

export type SampleCapNotice = {
  subject: string;
  /** plain-text body (also used as the internal-copy body + pre block). */
  bodyText: string;
  /** HTML body for the vendor email. */
  html: string;
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Build the processor-facing sample-cap notice. PURE. */
export function buildSampleCapNotice(input: SampleCapNoticeInput): SampleCapNotice {
  const processor = (input.processorName ?? "").trim() || "your company";
  const used = Math.max(0, Math.trunc(input.usedUnits));
  const cap = Math.max(0, Math.trunc(input.capUnits));
  const add = Math.max(0, Math.trunc(input.addUnits));
  const projected = used + add;
  const remaining = Math.max(0, cap - used);
  const manifestRef = (input.manifestNumber ?? "").trim();

  const unit = (n: number) => `${n} ${n === 1 ? "unit" : "units"}`;

  const subject = `Sample delivery on hold — quarterly limit reached (${processor})`;

  const lines = [
    `Hello ${processor},`,
    ``,
    `We are unable to accept this sample delivery${
      manifestRef ? ` (manifest ${manifestRef})` : ""
    } because it would exceed the quarterly sample limit the WA LCB allows per processor.`,
    ``,
    `Under ${WAC_CITATION}, a processor may transfer no more than ${unit(
      cap,
    )} of samples to a retailer per quarter. For the ${input.quarterKey} quarter we have already recorded ${unit(
      used,
    )} from you, which leaves ${unit(
      remaining,
    )} available. This delivery of ${unit(
      add,
    )} would bring the total to ${unit(projected)} and put us over the limit.`,
    ``,
    `Please hold the remaining samples until next quarter, or send a smaller quantity that fits within the ${unit(
      remaining,
    )} still available this quarter. No product was received and nothing was entered into our inventory.`,
    ``,
    `Thank you for understanding,`,
    `${RETAILER_NAME}`,
  ];
  const bodyText = lines.join("\n");

  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;color:#111">
      <h2 style="color:#12351f">Sample delivery on hold — quarterly limit reached</h2>
      <p>Hello ${escapeHtml(processor)},</p>
      <p>We are unable to accept this sample delivery${
        manifestRef ? ` (manifest ${escapeHtml(manifestRef)})` : ""
      } because it would exceed the quarterly sample limit the WA LCB allows per processor.</p>
      <p>Under ${WAC_CITATION}, a processor may transfer no more than <strong>${unit(
        cap,
      )}</strong> of samples to a retailer per quarter. For the <strong>${escapeHtml(
        input.quarterKey,
      )}</strong> quarter we have already recorded <strong>${unit(
        used,
      )}</strong> from you, which leaves <strong>${unit(
        remaining,
      )}</strong> available. This delivery of <strong>${unit(
        add,
      )}</strong> would bring the total to <strong>${unit(
        projected,
      )}</strong> and put us over the limit.</p>
      <p>Please hold the remaining samples until next quarter, or send a smaller quantity that fits within the ${unit(
        remaining,
      )} still available this quarter. No product was received and nothing was entered into our inventory.</p>
      <p style="color:#555;font-size:13px">Thank you for understanding,<br/>${RETAILER_NAME}</p>
    </div>`;

  return { subject, bodyText, html };
}

/* ------------------------------------------------------------------------- *
 * Self-test — runnable in CI via tests/compliance/sample-cap-notice.test.ts. *
 * ------------------------------------------------------------------------- */
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`sample-cap-notice-core self-test: ${msg}`);
}

export function __runSampleCapNoticeCoreTests(): void {
  const n = buildSampleCapNotice({
    processorName: "High End Farms",
    usedUnits: 115,
    capUnits: 120,
    addUnits: 10,
    quarterKey: "2026-Q1",
    manifestNumber: "M-123",
  });
  assert(n.subject.includes("High End Farms"), "subject names the processor");
  assert(n.bodyText.includes("314-55-096"), "cites the WAC rule");
  assert(n.bodyText.includes("120 units"), "states the cap");
  assert(n.bodyText.includes("115 units"), "states units already used");
  assert(n.bodyText.includes("5 units available"), "states remaining (120-115=5)");
  assert(n.bodyText.includes("10 units"), "states this delivery's units");
  assert(n.bodyText.includes("125 units"), "states the projected total (115+10)");
  assert(n.bodyText.includes("manifest M-123"), "references the manifest number");
  assert(!/\$/.test(n.bodyText) && !/\$/.test(n.html), "no dollar amounts anywhere");

  // Singular unit grammar + null processor fallback + no manifest ref.
  const one = buildSampleCapNotice({
    processorName: null,
    usedUnits: 120,
    capUnits: 120,
    addUnits: 1,
    quarterKey: "2026-Q2",
  });
  assert(one.bodyText.includes("your company"), "null processor falls back");
  assert(one.bodyText.includes("1 unit "), "singular '1 unit' grammar");
  assert(one.bodyText.includes("0 units available"), "remaining floored at 0");
  assert(!one.bodyText.includes("manifest "), "no manifest ref when absent");
}
