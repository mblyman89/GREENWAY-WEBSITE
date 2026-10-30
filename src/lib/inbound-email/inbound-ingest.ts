/**
 * src/lib/inbound-email/inbound-ingest.ts  (Fix Phase 3.2a · G-17 · F-04-4)
 *
 * SERVER-ONLY. The one place an inbound email is ROUTED (vendor_intake@ /
 * lcb-watch@ / vendor_menu@), STAGED (manifests as pending drafts) and LOGGED
 * (inbound_email_log). Moved here unchanged from the webhook route's finish()
 * so every way an email reaches us runs the SAME steps:
 *   - the Resend / SendGrid webhook (api/webhooks/inbound-email/route.ts);
 *   - the 15-minute mailbox check and "Check the mailbox now" (reconcile);
 *   - "Try again" on a failed email;
 *   - "Find an email".
 * The owner, verbatim (owner message 7): "I want this table to receive every
 * manifest, no exceptions." One pipeline means a recovered email is read
 * exactly as a webhook delivery is - no second, weaker path.
 *
 * DRAFTS-ONLY: nothing here activates stock or files anything with CCRS.
 */
import "server-only";
import {
  isForIntakeMailbox,
  type NormalizedInboundEmail,
} from "@/lib/inbound-email/inbound-normalize-core";
import {
  logInboundEmail,
  stageManifestsFromEmail,
  type InboundDisposition,
} from "@/lib/inbound-email/inbound-store";
import { ingestFromText } from "@/lib/regulatory/regulatory-ingest";
import { processMenuEmail } from "@/lib/purchasing/emailed-menu-store";

export type IngestSource = "webhook" | "reconcile" | "retry" | "find";

/** What routeAndStage did (the webhook answers `body`; the reconcile reads the rest). */
export type IngestOutcome = {
  kind: "intake" | "regulatory" | "menu" | "ignored";
  disposition: InboundDisposition;
  staged: number;
  manifestIds: string[];
  logId: string | null;
  body: Record<string, unknown>;
};

export function intakeMailbox(): string {
  // Fix 3.5 (owner: "It should only target vendor_intake@ and none of my other
  // @greenwaymarijuana.com addresses."): the env may only name vendor_intake
  // (bare or on a domain); anything else falls back to vendor_intake.
  const v = (process.env.VENDOR_INTAKE_MAILBOX ?? "vendor_intake").trim().toLowerCase();
  return v.split("@")[0] === "vendor_intake" ? v : "vendor_intake";
}

// SLICE 37: second mailbox — forwarded LCB bulletins for Regulatory Watch.
function regulatoryMailbox(): string {
  return (process.env.REGULATORY_MAILBOX ?? "lcb-watch").trim();
}

// SLICE 83: third mailbox — emailed vendor menus. Only menus + spam land here;
// the parser classifies junk, scrapes body/HTML/CSV/PDF sources, and saves a
// browsable snapshot for /admin/purchasing/menus + the PO builder hand-off.
function vendorMenuMailbox(): string {
  return (process.env.VENDOR_MENU_MAILBOX ?? "vendor_menu").trim();
}

/**
 * Route + stage + log one email. When `logId` is set (a delivery claim was
 * taken), every log write COMPLETES that row (R36 #2: one email, one row).
 */
export async function routeAndStage(
  email: NormalizedInboundEmail | null,
  signatureOk: boolean | null,
  fetchNote?: string,
  /** R36 #2: the delivery-claim row to complete (null = no claim taken). */
  logId: string | null = null,
  /** Fix Phase 3.2a: how this email reached us (recorded on the row, 0320). */
  ingestSource: IngestSource = "webhook",
): Promise<IngestOutcome> {
  if (!email) {
    if (logId) {
      // Close the claim so a retry of this delivery is answered "done".
      await logInboundEmail({
        email: { provider: "resend", from: "", to: [], subject: "", receivedAt: new Date().toISOString(), attachments: [] },
        signatureOk,
        toIntake: false,
        disposition: "ignored",
        manifestId: null,
        note: "not an email payload",
        logId,
        ingestSource,
      });
    }
    return { kind: "ignored", disposition: "ignored", staged: 0, manifestIds: [], logId, body: { ok: true, ignored: "not-an-email" } };
  }

  const toIntake = isForIntakeMailbox(email, intakeMailbox());
  if (!toIntake) {
    // SLICE 37: forwarded LCB bulletins route to Regulatory Watch instead.
    if (isForIntakeMailbox(email, regulatoryMailbox())) {
      const body = (email.bodyText ?? "").trim();
      const res = await ingestFromText(email.subject || "Forwarded LCB bulletin", body);
      await logInboundEmail({
        email,
        signatureOk,
        toIntake: false,
        disposition: "ignored",
        manifestId: null,
        logId,
        ingestSource,
        note: res.ok
          ? `regulatory watch: ingested (${res.created ? "new" : "duplicate"}${res.analyzed ? ", analyzed" : ""})`
          : `regulatory watch: ${res.error}`,
      });
      return {
        kind: "regulatory",
        disposition: "ignored",
        staged: 0,
        manifestIds: [],
        logId: logId, // (explicit: the R36 pin counts bare `logId,` as log writes)
        body: { ok: true, regulatory: res.ok, created: res.ok ? res.created : false },
      };
    }
    // SLICE 83: emailed vendor menus route to the menu parser instead. Every
    // arrival is still logged; junk/spam is classified and recorded, a real
    // menu becomes a browsable snapshot on /admin/purchasing/menus.
    if (isForIntakeMailbox(email, vendorMenuMailbox())) {
      const menu = await processMenuEmail(email);
      await logInboundEmail({
        email,
        signatureOk,
        toIntake: false,
        disposition: "ignored",
        manifestId: null,
        logId,
        ingestSource,
        note: `vendor menu: ${menu.outcome}${menu.snapshotId ? ` (snapshot ${menu.snapshotId})` : ""} — ${menu.note}${fetchNote ? ` — ${fetchNote}` : ""}`,
      });
      return {
        kind: "menu",
        disposition: "ignored",
        staged: 0,
        manifestIds: [],
        logId: logId, // (explicit: the R36 pin counts bare `logId,` as log writes)
        body: { ok: true, menu: menu.outcome, snapshotId: menu.snapshotId, items: menu.itemCount },
      };
    }
    await logInboundEmail({
      email,
      signatureOk,
      toIntake: false,
      disposition: "ignored",
      manifestId: null,
      logId,
      ingestSource,
      note: "not addressed to the intake mailbox",
    });
    return { kind: "ignored", disposition: "ignored", staged: 0, manifestIds: [], logId, body: { ok: true, ignored: "not-intake-mailbox" } };
  }

  // Stage any manifest attachments as DRAFTS (webhook has no signed-in user).
  const staged = await stageManifestsFromEmail(email, null);

  let disposition: InboundDisposition;
  if (staged.staged > 0) disposition = "staged";
  else if (staged.parseFailures > 0) disposition = "parse_failed";
  else if (staged.duplicates > 0) disposition = "duplicate";
  else disposition = "no_manifest";

  const dupSuffix =
    staged.duplicates > 0 ? ` (${staged.duplicates} duplicate manifest(s) already in intake \u2014 skipped)` : "";
  // H18: a duplicate re-send can REPAIR empty transport fields on the existing
  // manifest (fill-only-empty). Say so in the log note so the owner can see the
  // re-forward actually did something.
  const backfillSuffix =
    staged.transportBackfills > 0
      ? ` (${staged.transportBackfills} transport field(s) backfilled on the existing manifest)`
      : "";
  const baseNote =
    (staged.staged > 0
      ? `staged ${staged.staged} draft manifest(s)${dupSuffix}`
      : staged.parseFailures > 0
        ? `${staged.parseFailures} attachment(s) failed to parse${dupSuffix}`
        : staged.duplicates > 0
          ? `${staged.duplicates} duplicate manifest(s) already in intake \u2014 skipped`
          : "no manifest attachment found") + backfillSuffix;

  await logInboundEmail({
    email,
    signatureOk,
    toIntake: true,
    disposition,
    manifestId: staged.manifestIds[0] ?? null,
    logId,
    ingestSource,
    // Append the fetch trail (what we pulled from Resend's receiving API + any
    // invoice/manifest links) so a human reviewing the inbound panel can see
    // exactly what arrived even when nothing parsed into a manifest.
    note: [baseNote, ...staged.notes, fetchNote].filter(Boolean).join(" — "),
  });

  return {
    kind: "intake",
    disposition,
    staged: staged.staged,
    manifestIds: staged.manifestIds,
    logId: logId,
    body: { ok: true, staged: staged.staged, manifestIds: staged.manifestIds },
  };
}
