/**
 * src/lib/inventory/inbound-dedupe-core.ts  (R36 #2)
 *
 * PURE rules for "one email, one manifest row" (migration 0255). No I/O, no
 * server-only - unit-tested in tests/compliance/r36-inbound-dedupe.test.ts.
 *
 * THE OWNER'S REPORT: "I emailed the vendor_intake@ address as usual, I
 * waited, then two identical rows appeared in the receiving table, one broke,
 * the other not ... the broken one was assigned the correct invoice number,
 * and the not broken one was not."
 *
 * ROOT CAUSE (sourced, never guessed):
 *   - Resend delivers webhooks through Svix. An attempt that does not get a
 *     2xx within ~15 s is a failure and is retried on the schedule
 *     "Immediately, 5 seconds, 5 minutes, 30 minutes, 2 hours, 5 hours,
 *     10 hours, 10 hours" (resend.com/docs/webhooks/retries-and-replays;
 *     docs.svix.com/retries). Every retry carries the SAME svix-id header
 *     (docs.svix.com/receiving/verifying-payloads/how-manual: "svix-id: the
 *     unique message identifier ... the same when the message is resent").
 *   - Our webhook runs LlamaParse on the PDFs before it answers - well past
 *     15 s - so the retry arrives while the first call is still working.
 *   - The manifest dedupe was read-then-insert, so both calls saw "no row
 *     yet" and both inserted: two rows. The second call's documents then
 *     raced the first, which is how one row ended up with the invoice # and
 *     the other with nothing to re-read.
 *
 * THE FIX, in three layers (each enough on its own for its own race):
 *   1. DELIVERY CLAIM - the webhook inserts a claim row keyed by the provider's
 *      message identity BEFORE any work (unique index). A second delivery of
 *      the same message is answered without staging: decideClaim() below.
 *   2. ATOMIC MANIFEST KEY - inbound_manifests.dedupe_key is UNIQUE while the
 *      row is live, so even two different emails carrying the same manifest at
 *      the same instant cannot both insert (the loser becomes the duplicate).
 *   3. DISMISS DUPLICATE - for twins that already exist (the owner's pair), a
 *      button that removes the extra row WITHOUT rejecting it: its never-
 *      received quarantine lots are deleted (no inventory clutter), and the
 *      invoice #, documents and transport it carried move to the kept row.
 */
import {
  BLOCKING_STATUSES,
  buildManifestIdentity,
  compareOldestFirst,
  isBlockingStatus,
} from "@/lib/inventory/manifest-dedupe-core";

// ── 1. Delivery claim ───────────────────────────────────────────────────────

/** A claim older than this may be taken over (a crashed run). The route's
 * maxDuration is 300 s; 6 minutes leaves a full minute of margin so a slow
 * but healthy run is never doubled. */
export const CLAIM_STALE_MS = 6 * 60 * 1000;

/** Cap on a delivery key so a hostile header cannot bloat the index. */
const MAX_KEY_PART = 200;

function cleanPart(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.length > MAX_KEY_PART) return null;
  // Visible ASCII only - ids are opaque tokens (msg_..., UUIDs).
  if (!/^[\x21-\x7e]+$/.test(t)) return null;
  return t;
}

/**
 * The provider's identity for ONE message, or null when there is none (then
 * the claim is skipped and behaviour is exactly as before). The Resend
 * email_id is preferred: it is the same for a Svix retry AND for a manual
 * "replay" from the Resend dashboard. The svix-id is the fallback (same on
 * every automatic retry). PURE.
 */
export function deliveryKey(input: {
  emailId?: string | null;
  svixId?: string | null;
}): string | null {
  const emailId = cleanPart(input.emailId);
  if (emailId) return `resend:email:${emailId}`;
  const svixId = cleanPart(input.svixId);
  if (svixId) return `svix:${svixId}`;
  return null;
}

/** The claim row as read back after a unique-index conflict. */
export type ExistingClaim = {
  /** inbound_email_log.disposition - "received" means still being worked on. */
  disposition: string | null;
  claimed_at: string | null;
};

export type ClaimDecision =
  /** The first delivery finished: answer 200, stage nothing. */
  | { kind: "done" }
  /** The first delivery is still running: answer 409 so Svix retries later. */
  | { kind: "in_flight"; ageMs: number }
  /** The first delivery died (claim older than CLAIM_STALE_MS): take it over. */
  | { kind: "take_over"; ageMs: number };

/**
 * What to do when our claim insert hit the unique index. PURE.
 *  - any final disposition (staged, duplicate, parse_failed, ...) -> done;
 *  - "received" (the in-flight marker) younger than the stale limit -> in_flight;
 *  - "received" older than the limit, or with no/unreadable timestamp -> take_over
 *    (a claim nobody can date is treated as abandoned rather than blocking
 *    the email forever).
 */
export function decideClaim(
  existing: ExistingClaim,
  now: Date = new Date(),
  staleMs: number = CLAIM_STALE_MS,
): ClaimDecision {
  const disp = (existing.disposition ?? "").trim().toLowerCase();
  if (disp && disp !== "received") return { kind: "done" };
  const t = Date.parse(existing.claimed_at ?? "");
  if (!Number.isFinite(t)) return { kind: "take_over", ageMs: Number.POSITIVE_INFINITY };
  const ageMs = Math.max(0, now.getTime() - t);
  return ageMs >= staleMs ? { kind: "take_over", ageMs } : { kind: "in_flight", ageMs };
}

/** HTTP answer for a duplicate delivery (the route returns it verbatim). */
export function claimResponse(decision: ClaimDecision): {
  status: 200 | 409;
  body: { ok: boolean; duplicateDelivery: true; note: string };
} {
  if (decision.kind === "done") {
    return {
      status: 200,
      body: {
        ok: true,
        duplicateDelivery: true,
        note: "This email was already received and processed - nothing staged again.",
      },
    };
  }
  return {
    status: 409,
    body: {
      ok: false,
      duplicateDelivery: true,
      note: "This email is still being processed by an earlier delivery - retry later.",
    },
  };
}

// ── 3. Twins + Dismiss duplicate ────────────────────────────────────────────

/** Stages a duplicate can be DISMISSED from. Never accepted / partially
 * accepted: those activated stock (that is a real receipt, not a duplicate
 * row) - a duplicate that was accepted must be handled as an inventory
 * correction instead. A rejected twin CAN be dismissed: that is exactly the
 * owner's case (he rejected the extra row and its refused lots cluttered
 * Inventory). */
export const DISMISSABLE_STATUSES = ["pending", "in_transit", "received", "rejected"] as const;

export function isDismissableStatus(status: string | null | undefined): boolean {
  const s = (status ?? "").trim().toLowerCase();
  return (DISMISSABLE_STATUSES as readonly string[]).includes(s);
}

/** The subset of an inbound_manifests row twin detection needs. */
export type TwinRow = {
  id: string;
  manifest_number: string | null;
  vendor_label: string | null;
  status: string | null;
  created_at?: string | null;
};

/** Identity key for grouping, or null (no manifest number = never a twin). */
function groupKey(r: TwinRow): string | null {
  const id = buildManifestIdentity({ manifest_number: r.manifest_number, vendor_label: r.vendor_label });
  return id ? `${id.manifestNumber}|${id.vendorKey}` : null;
}

/**
 * For every row that is a DISMISSABLE duplicate, the id of the row that would
 * be KEPT. PURE.
 *
 * A row is a duplicate when another row shares its identity (normalized
 * manifest # + vendor - the same identity the staging dedupe uses) and that
 * other row is LIVE. The kept row is the OLDEST live row other than itself,
 * so in the owner's pair EACH row offers "Dismiss" pointing at the other:
 * he chooses which one to keep (the healthy one), and because the dismiss
 * carries the invoice #, documents and transport over, either choice keeps
 * everything that was found.
 *
 * Dismissed rows never take part (they are already gone from the table).
 */
export function findDuplicateTwins(rows: readonly TwinRow[]): Map<string, string> {
  const groups = new Map<string, TwinRow[]>();
  for (const r of rows) {
    if ((r.status ?? "").trim().toLowerCase() === "dismissed") continue;
    const k = groupKey(r);
    if (!k) continue;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const out = new Map<string, string>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const live = g.filter((r) => isBlockingStatus(r.status)).sort(compareOldestFirst);
    for (const r of g) {
      if (!isDismissableStatus(r.status)) continue;
      const keep = live.find((l) => l.id !== r.id);
      if (keep) out.set(r.id, keep.id);
    }
  }
  return out;
}

/** Fields the dismiss may carry from the dismissed row onto the kept row. */
export const TRANSPORT_CARRY_FIELDS = [
  "transporter_name",
  "transporter_license",
  "driver_name",
  "driver_license_number",
  "vehicle_description",
  "vehicle_plate",
  "vehicle_vin",
  "departed_at",
  "route_notes",
  "eta_date",
] as const;

export type DismissCheckRow = TwinRow & { dedupe_key?: string | null };

export type DismissCheck = { ok: true } | { ok: false; reason: string };

/**
 * Validate a dismiss request BEFORE touching anything (the SQL function
 * repeats every check under row locks; this gives the owner a clear message
 * and is what the tests pin). PURE.
 */
export function checkDismiss(dup: DismissCheckRow | null, keep: DismissCheckRow | null): DismissCheck {
  if (!dup) return { ok: false, reason: "That manifest no longer exists." };
  if (!keep) return { ok: false, reason: "The manifest to keep no longer exists." };
  if (dup.id === keep.id) return { ok: false, reason: "A manifest cannot be a duplicate of itself." };
  const ds = (dup.status ?? "").trim().toLowerCase();
  if (ds === "dismissed") return { ok: false, reason: "This duplicate was already dismissed." };
  if (!isDismissableStatus(dup.status)) {
    return {
      ok: false,
      reason:
        "This manifest was accepted - its stock is live, so it is a real receipt, not a duplicate row. Use an inventory adjustment instead.",
    };
  }
  if (!isBlockingStatus(keep.status)) {
    return {
      ok: false,
      reason: `The manifest to keep must still be live (${BLOCKING_STATUSES.join(", ")}).`,
    };
  }
  const a = groupKey(dup);
  const b = groupKey(keep);
  if (!a || !b || a !== b) {
    return {
      ok: false,
      reason: "These two manifests are not the same transfer (manifest # and vendor differ) - not a duplicate.",
    };
  }
  return { ok: true };
}

/** Plain-English summary of what the dismiss did (for the banner + event). */
export function describeDismissResult(r: {
  lots_removed?: number | null;
  labs_removed?: number | null;
  drafts_dismissed?: number | null;
  docs_moved?: number | null;
  invoice_carried?: boolean | null;
  transport_fields_carried?: number | null;
}): string {
  const parts: string[] = [];
  const n = (v: number | null | undefined) => (typeof v === "number" && v > 0 ? v : 0);
  const lots = n(r.lots_removed);
  parts.push(
    lots > 0
      ? `${lots} never-received line${lots === 1 ? "" : "s"} removed (nothing reaches Inventory)`
      : "no lines to remove",
  );
  if (r.invoice_carried) parts.push("invoice # moved to the kept manifest");
  const docs = n(r.docs_moved);
  if (docs > 0) parts.push(`${docs} document${docs === 1 ? "" : "s"} moved to the kept manifest`);
  const tf = n(r.transport_fields_carried);
  if (tf > 0) parts.push(`${tf} empty transport field${tf === 1 ? "" : "s"} filled on the kept manifest`);
  const drafts = n(r.drafts_dismissed);
  if (drafts > 0) parts.push(`${drafts} onboarding draft${drafts === 1 ? "" : "s"} dismissed`);
  return parts.join("; ") + ".";
}

// ── Narrow error classifiers (unit-tested) ──────────────────────────────────

type PgLikeError = { code?: unknown; message?: unknown; details?: unknown } | null | undefined;

function errText(e: PgLikeError): string {
  if (!e || typeof e !== "object") return "";
  const m = typeof e.message === "string" ? e.message : "";
  const d = typeof e.details === "string" ? e.details : "";
  return `${m} ${d}`;
}

/** Postgres unique_violation (23505) on a NAMED unique index - and only that
 * index, so an unrelated unique violation is never mistaken for a duplicate. */
function isUniqueViolationOn(e: PgLikeError, index: string, column: string): boolean {
  if (!e || typeof e !== "object") return false;
  if (String(e.code ?? "") !== "23505") return false;
  const t = errText(e);
  return t.includes(index) || t.includes(`(${column})=`);
}

/** The manifest insert lost the dedupe_key race (migration 0255). PURE. */
export function isDedupeKeyConflict(e: PgLikeError): boolean {
  return isUniqueViolationOn(e, "inbound_manifests_dedupe_key_uidx", "dedupe_key");
}

/** The webhook's claim insert hit an existing claim (migration 0255). PURE. */
export function isDeliveryKeyConflict(e: PgLikeError): boolean {
  return isUniqueViolationOn(e, "inbound_email_log_delivery_key_uidx", "delivery_key");
}

/**
 * Turn the dismiss RPC's error into the sentence the owner sees. The SQL
 * function raises "DISMISS: <plain English>" (errcode P0001) for every
 * refusal; anything else is an unexpected failure and is reported as such
 * (never dressed up as a refusal). The function missing (migration 0255 not
 * applied) gets its own message. PURE.
 */
export function dismissErrorMessage(e: PgLikeError): string {
  const msg = e && typeof e === "object" && typeof e.message === "string" ? e.message : "";
  const code = e && typeof e === "object" ? String(e.code ?? "") : "";
  const m = /DISMISS:\s*([\s\S]+)$/.exec(msg);
  if (m) {
    const t = m[1].trim();
    return t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : ".");
  }
  if (code === "PGRST202" || code === "42883" || (/dismiss_duplicate_manifest/.test(msg) && /not find|does not exist/i.test(msg))) {
    return "The Dismiss duplicate feature needs database migration 0255 - apply it in the Supabase SQL editor, then try again.";
  }
  return `The duplicate could not be dismissed - nothing was changed (${(msg || "unknown error").slice(0, 200)}).`;
}
