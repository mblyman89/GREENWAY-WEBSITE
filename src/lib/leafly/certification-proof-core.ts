/**
 * src/lib/leafly/certification-proof-core.ts
 *
 * SLICE L-47 — "prove every action" for Leafly certification.
 *
 * The owner:
 *
 *   > "Please now work on slice L-47: the screen showing proof that every
 *   >  Leafly action works for certification."
 *
 * PURE. No imports, no database, no network, no clock (the caller passes
 * `nowIso`). Everything the proof panel decides is decided here and proven by
 * the self-test at the bottom, registered in
 * `scripts/compliance/run-pure-selftests.ts`.
 *
 * ── THE ONE RULE ────────────────────────────────────────────────────────────
 * A row turns green ONLY from a recorded run that reached Leafly and got a
 * success back. Never from a setting, never from "the button exists", never
 * from a claim. Leafly's own words, for both APIs, are that certification is
 * "validated by review of logged activity" (Order API) / "verifying the logged
 * activity of your integration" (Menu API). Our panel holds itself to the same
 * standard Leafly's reviewer will.
 *
 * ── GROUND TRUTH ────────────────────────────────────────────────────────────
 * Order API requirement levels: the table in
 * docs/leafly-specs/order-api-v1.openapi.json, info.description, "Preparing for
 * Production" — copied into LEAFLY_PROOF_ACTIONS row by row, and a compliance
 * test re-reads the vendored spec and asserts every level still matches.
 *
 * Menu API: the "Certification Checklist" in
 * docs/leafly-specs/menu-integration-v2.openapi.json — Option 1 (Recommended):
 * "POST - Full menu updates across items at a cadence of once per day",
 * "PUT - Submission of item updates individually or in batches",
 * "DELETE - Removal of items from Leafly menus". Greenway follows Option 1, so
 * all three are graded as required for us.
 *
 * Ben (Leafly), answer 11: "Certification is assessed against a time window
 * the owner provides. Sandbox logs are retained for two weeks." That is where
 * the 14-day expiry comes from — LEAFLY_SANDBOX_LOG_RETENTION_DAYS.
 *
 * Ben, answer 7: pickup-only is fine; delivery is not a certification blocker.
 * So the spec's "both fulfillment mechanisms" line is recorded as a note, not
 * as a row that could never turn green for a pickup-only store.
 */

// ===========================================================================
// 1. Vocabulary
// ===========================================================================

export type ProofRequirement = "required" | "recommended" | "optional";
export type ProofGroup = "menu" | "order_webhook" | "order_endpoint" | "order_lifecycle";

export const LEAFLY_PROOF_ACTION_IDS = [
  "menu_post",
  "menu_put",
  "menu_delete",
  "menu_status",
  "menu_readback",
  "webhook_order_submit",
  "webhook_order_cancel",
  "webhook_order_status",
  "webhook_order_preview",
  "webhook_order_activate",
  "webhook_order_deactivate",
  "order_fetch",
  "order_acknowledge",
  "order_status_update",
  "order_government_id",
  "order_medical_id",
  "order_cart_update",
  "lifecycle_picked_up",
  "lifecycle_canceled",
] as const;
export type ProofActionId = (typeof LEAFLY_PROOF_ACTION_IDS)[number];

/**
 * Every operation value `leafly_outbound_attempts.operation` accepts after
 * migration 0231. A compliance test reads the migration's CHECK and asserts
 * this list matches it exactly, in both directions.
 */
export const LEAFLY_OUTBOUND_OPERATIONS = [
  "acknowledge",
  "status",
  "cart",
  "fetch_order",
  "government_id",
  "medical_id",
] as const;
export type LeaflyOutboundOperation = (typeof LEAFLY_OUTBOUND_OPERATIONS)[number];

/** The three operations that can only be recorded once 0231 is applied. */
export const LEAFLY_OPERATIONS_NEEDING_0231: readonly LeaflyOutboundOperation[] = [
  "fetch_order",
  "government_id",
  "medical_id",
];

export const LEAFLY_PROOF_MIGRATION_FILE = "0231_leafly_certification_proof.sql";

/** Ben, answer 11: "Sandbox logs are retained for two weeks." */
export const LEAFLY_SANDBOX_LOG_RETENTION_DAYS = 14;

/** The roadmap: "pick two business days, run each action once inside them". */
export const LEAFLY_PROOF_WINDOW_BUSINESS_DAYS = 2;

/** Mirrors certification-core's LEAFLY_CERTIFICATION_NOTICE_BUSINESS_DAYS (asserted equal in CI). */
export const LEAFLY_PROOF_NOTICE_BUSINESS_DAYS = 2;

export const LEAFLY_PROOF_STORE_TIME_ZONE = "America/Los_Angeles";

/** The exact sentence the roadmap specified for stale proof. */
export const LEAFLY_PROOF_EXPIRED_TEXT =
  "May have expired from Leafly's sandbox logs; run again inside your certification window.";

/** Leafly's webhook rule: "should only be responded to with status codes 200 or 201". */
export const LEAFLY_PROOF_WEBHOOK_OK_STATUSES: readonly number[] = [200, 201];

/**
 * hmac-core's reason for "no signature header at all". Duplicated (this file
 * has no imports) and asserted equal to hmac-core in CI. An unsigned request
 * did not come from Leafly — it is an internet probe — so it is neither proof
 * nor a failure of any Leafly action.
 */
export const LEAFLY_PROOF_UNSIGNED_REASON = "missing_header";

// ===========================================================================
// 2. The action table
// ===========================================================================

export type ProofActionDef = {
  id: ProofActionId;
  group: ProofGroup;
  /** Plain English, what the owner sees. */
  label: string;
  /** The HTTP shape, for the reviewer and for the owner's email to Leafly. */
  endpoint: string;
  requirement: ProofRequirement;
  /** Where the requirement level comes from — quoted, never paraphrased into a stronger claim. */
  source: string;
  /** Exactly which button or event produces the proof. Names match the screen. */
  howToProve: string;
  /** What counts as proof, in one sentence. */
  provenBy: string;
  sandboxOnly?: boolean;
};

const ORDER_TABLE = "Order API requirement table (\u201cvalidated by review of logged activity\u201d)";
const MENU_OPTION_1 = "Menu API certification checklist, Sync Frequency Option 1 (the profile Greenway follows)";

export const LEAFLY_PROOF_ACTIONS: readonly ProofActionDef[] = [
  // ── Menu API ──────────────────────────────────────────────────────────────
  {
    id: "menu_post",
    group: "menu",
    label: "Menu: replace the whole menu (POST)",
    endpoint: "POST /{menu_integration_key}/menu/items",
    requirement: "required",
    source: `${MENU_OPTION_1}: \u201cPOST - Full menu updates across items at a cadence of once per day\u201d`,
    howToProve:
      "Press \u201cReplace my whole Leafly menu (POST)\u201d on this page, or let the automatic daily sync run on a day when nothing is held back.",
    provenBy: "A POST that Leafly answered with a 2xx.",
  },
  {
    id: "menu_put",
    group: "menu",
    label: "Menu: add and update products (PUT)",
    endpoint: "PUT /{menu_integration_key}/menu/items",
    requirement: "required",
    source: `${MENU_OPTION_1}: \u201cPUT - Submission of item updates individually or in batches\u201d`,
    howToProve:
      "Press \u201cSend my whole menu, hold back only the bad ones\u201d or \u201cSend only certain products\u201d, or let an automatic in-between update run.",
    provenBy: "A PUT that Leafly answered with a 2xx.",
  },
  {
    id: "menu_delete",
    group: "menu",
    label: "Menu: remove products (DELETE)",
    endpoint: "DELETE /{menu_integration_key}/menu/items",
    requirement: "required",
    source: `${MENU_OPTION_1}: \u201cDELETE - Removal of items from Leafly menus\u201d`,
    howToProve:
      "Remove one product from \u201cWhat is on your Leafly menu\u201d or with \u201cRemove by product ID (advanced)\u201d, or let the automatic sync remove a product you stopped listing.",
    provenBy: "A DELETE that Leafly answered with a 2xx.",
  },
  {
    id: "menu_status",
    group: "menu",
    label: "Menu: check integration status (GET)",
    endpoint: "GET /{menu_integration_key}/status",
    requirement: "recommended",
    source:
      "Menu API certification checklist, Correct Requests: \u201cIntegration client successfully authenticates to the API\u201d (any successful call also proves this)",
    howToProve: "Press \u201cCheck integration status\u201d on this page.",
    provenBy: "A status check that Leafly answered with a 2xx.",
  },
  {
    id: "menu_readback",
    group: "menu",
    label: "Menu: read the menu back (GET)",
    endpoint: "GET /{menu_integration_key}/menu",
    requirement: "optional",
    source: "Not on Leafly's checklist. Offered by Leafly for validating menu data; sandbox only.",
    howToProve: "Press \u201cRead the menu back from Leafly and check it\u201d on this page (sandbox only).",
    provenBy: "A read-back that Leafly answered with a 2xx.",
    sandboxOnly: true,
  },
  // ── Order API webhooks (Leafly calls us) ─────────────────────────────────
  {
    id: "webhook_order_submit",
    group: "order_webhook",
    label: "Order arrives (Order Submission webhook)",
    endpoint: "POST /api/webhooks/leafly/order-submit",
    requirement: "required",
    source: `${ORDER_TABLE}: Order Submission \u2014 \u201c200 Ok, empty response bodies\u201d \u2014 Required`,
    howToProve: "Place a sandbox test order on Leafly (Ben, answer 6: we place our own sandbox test orders).",
    provenBy: "A signed delivery we verified and answered 200/201.",
  },
  {
    id: "webhook_order_cancel",
    group: "order_webhook",
    label: "Shopper cancels (Order Cancelation webhook)",
    endpoint: "POST /api/webhooks/leafly/order-cancel",
    requirement: "required",
    source: `${ORDER_TABLE}: Order Cancelation \u2014 \u201c200 Ok, empty response bodies\u201d \u2014 Required`,
    howToProve: "Place a sandbox test order, then cancel it from the shopper side on Leafly.",
    provenBy: "A signed delivery we verified and answered 200/201.",
  },
  {
    id: "webhook_order_status",
    group: "order_webhook",
    label: "Leafly status change (Order Status webhook)",
    endpoint: "POST /api/webhooks/leafly/order-status",
    requirement: "recommended",
    source: `${ORDER_TABLE}: Order Status \u2014 \u201c200 Ok, empty response bodies\u201d \u2014 Recommended`,
    howToProve: "Leafly sends this when an order's status changes on their side during a sandbox test order.",
    provenBy: "A signed delivery we verified and answered 200/201.",
  },
  {
    id: "webhook_order_preview",
    group: "order_webhook",
    label: "Checkout price check (Order Preview webhook)",
    endpoint: "POST /api/webhooks/leafly/order-preview",
    requirement: "recommended",
    source: `${ORDER_TABLE}: Order Preview \u2014 \u201c200 Ok, response bodies matching the specification\u201d \u2014 Recommended`,
    howToProve: "Go to checkout with a sandbox test cart on Leafly; Leafly asks us to price it.",
    provenBy: "A signed delivery we verified and answered 200/201.",
  },
  {
    id: "webhook_order_activate",
    group: "order_webhook",
    label: "Store switched on (Retailer Activation webhook)",
    endpoint: "POST /api/webhooks/leafly/order-activate",
    requirement: "optional",
    source: `${ORDER_TABLE}: Retailer Activation \u2014 Optional`,
    howToProve: "Leafly sends this when they activate ordering for the store. Nothing to press.",
    provenBy: "A signed delivery we verified and answered 200/201.",
  },
  {
    id: "webhook_order_deactivate",
    group: "order_webhook",
    label: "Store switched off (Retailer Deactivation webhook)",
    endpoint: "POST /api/webhooks/leafly/order-deactivate",
    requirement: "optional",
    source: `${ORDER_TABLE}: Retailer Deactivation \u2014 Optional`,
    howToProve: "Leafly sends this when they deactivate ordering for the store. Nothing to press.",
    provenBy: "A signed delivery we verified and answered 200/201.",
  },
  // ── Order API endpoints (we call Leafly) ─────────────────────────────────
  {
    id: "order_fetch",
    group: "order_endpoint",
    label: "Collect the order (Fetch Order by ID)",
    endpoint: "GET /{order_integration_key}/orders/{id}",
    requirement: "required",
    source: `${ORDER_TABLE}: Fetch Order by ID \u2014 \u201cSuccessful retrievals\u201d \u2014 Required`,
    howToProve:
      "Happens automatically when a sandbox test order arrives, or press \u201cCheck this order with Leafly\u201d on the order.",
    provenBy: "A retrieval Leafly answered with 200.",
  },
  {
    id: "order_acknowledge",
    group: "order_endpoint",
    label: "Acknowledge the order",
    endpoint: "POST /{order_integration_key}/orders/{id}/acknowledge",
    requirement: "required",
    source: `${ORDER_TABLE}: Acknowledge Order \u2014 \u201cSuccessful requests\u201d \u2014 Required`,
    howToProve: "Happens automatically on arrival when auto-acknowledge is on, or press Acknowledge on the order.",
    provenBy: "An acknowledgement Leafly answered with 204.",
  },
  {
    id: "order_status_update",
    group: "order_endpoint",
    label: "Move the order along (Update Order Status)",
    endpoint: "POST /{order_integration_key}/orders/{id}/status",
    requirement: "required",
    source: `${ORDER_TABLE}: Update Order Status \u2014 \u201cSuccessful motion through order lifecycles\u201d \u2014 Required`,
    howToProve: "Press Confirm, Ready and Picked up on a sandbox test order.",
    provenBy: "A status update Leafly answered with 200.",
  },
  {
    id: "order_government_id",
    group: "order_endpoint",
    label: "View the government ID image",
    endpoint: "GET /{order_integration_key}/government_id/{id}",
    requirement: "recommended",
    source: `${ORDER_TABLE}: Retrieve Government ID Image \u2014 \u201cSuccessful retrievals\u201d \u2014 Recommended`,
    howToProve:
      "Open a sandbox test order and view its ID image BEFORE acknowledging it (acknowledging ends access). Turn auto-acknowledge off for this test.",
    provenBy: "A retrieval Leafly answered with 200.",
  },
  {
    id: "order_medical_id",
    group: "order_endpoint",
    label: "View the medical ID image",
    endpoint: "GET /{order_integration_key}/medical_id/{id}",
    requirement: "recommended",
    source: `${ORDER_TABLE}: Retrieve Medical ID Image \u2014 \u201cSuccessful retrievals\u201d \u2014 Recommended`,
    howToProve:
      "Only medical orders carry one. Greenway has no medical endorsement yet (Ben, answer 5), so this row can stay open.",
    provenBy: "A retrieval Leafly answered with 200.",
  },
  {
    id: "order_cart_update",
    group: "order_endpoint",
    label: "Change the order's items (Update Order's Cart)",
    endpoint: "POST /{order_integration_key}/orders/{id}/cart",
    requirement: "optional",
    source: `${ORDER_TABLE}: Update Order's Cart \u2014 \u201cSuccessful updates of cart contents, taxes, delivery fees\u201d \u2014 Optional`,
    howToProve: "Change a line on a sandbox test order and send the change to Leafly.",
    provenBy: "A cart update Leafly answered with 200.",
  },
  // ── Lifecycle (spec: "both terminal states") ─────────────────────────────
  {
    id: "lifecycle_picked_up",
    group: "order_lifecycle",
    label: "An order finished as picked up",
    endpoint: "status \u2192 picked_up",
    requirement: "required",
    source:
      "Preparing for Production: \u201cmove orders from inception to completion for both terminal states ([picked_up, canceled])\u201d",
    howToProve: "Take a sandbox test order all the way through: Confirm \u2192 Ready \u2192 Picked up.",
    provenBy: "A status update to picked_up that Leafly answered with 200.",
  },
  {
    id: "lifecycle_canceled",
    group: "order_lifecycle",
    label: "An order finished as canceled",
    endpoint: "status \u2192 canceled",
    requirement: "required",
    source:
      "Preparing for Production: \u201cmove orders from inception to completion for both terminal states ([picked_up, canceled])\u201d",
    howToProve: "Cancel a sandbox test order from the store side, or have the shopper cancel one.",
    provenBy:
      "A status update to canceled that Leafly answered with 200, or a verified shopper cancelation webhook.",
  },
];

export function proofActionDef(id: ProofActionId): ProofActionDef {
  const def = LEAFLY_PROOF_ACTIONS.find((a) => a.id === id);
  if (!def) throw new Error(`unknown proof action ${id}`);
  return def;
}

// ===========================================================================
// 3. Recorded-evidence input shapes (what the server loader hands in)
// ===========================================================================

/** leafly_sync_runs — one scheduled or manual menu run. */
export type ProofSyncRunRow = {
  method: string | null;
  disposition: string | null;
  httpStatus: number | null;
  triggerSource: string | null;
  at: string | null;
};

/** audit_logs — one menu action, with the httpStatus/method read from after_json. */
export type ProofAuditRow = {
  action: string;
  httpStatus: number | null;
  method: string | null;
  at: string | null;
};

/** syndication_logs — one automatic run; only the DELETE half is read from it. */
export type ProofAutoRunRow = {
  status: string | null;
  deleteCount: number;
  at: string | null;
};

/** leafly_webhook_events — one inbound delivery. */
export type ProofWebhookRow = {
  eventType: string | null;
  signatureVerified: boolean;
  rejectionReason: string | null;
  responseStatus: number | null;
  at: string | null;
};

/** leafly_outbound_attempts — one outbound call (or refusal). */
export type ProofOutboundRow = {
  operation: string | null;
  requestedStatus: string | null;
  disposition: string | null;
  responseStatus: number | null;
  refusalCode: string | null;
  at: string | null;
};

export type ProofSource = "sync_runs" | "audit" | "auto_runs" | "webhooks" | "outbound";

export type ProofInput = {
  nowIso: string;
  environment: "sandbox" | "production";
  syncRuns: readonly ProofSyncRunRow[];
  audits: readonly ProofAuditRow[];
  autoRuns: readonly ProofAutoRunRow[];
  webhooks: readonly ProofWebhookRow[];
  outbound: readonly ProofOutboundRow[];
  /** Sources whose read FAILED. A failed read is "unknown", never "nothing happened". */
  unreadable?: readonly ProofSource[];
  /** Rows whose newest-N read came back full, so older proof may exist beyond it. */
  saturated?: readonly ProofActionId[];
};

// ===========================================================================
// 4. Turning rows into per-action events
// ===========================================================================

export type ProofEvent = {
  action: ProofActionId;
  ok: boolean;
  at: string;
  httpStatus: number | null;
  /** Plain English: which button / run / delivery produced it. */
  via: string;
  source: ProofSource;
};

export function isHttp2xx(status: number | null | undefined): boolean {
  return typeof status === "number" && Number.isFinite(status) && status >= 200 && status < 300;
}

function validAt(at: string | null | undefined): string | null {
  if (typeof at !== "string" || at.trim() === "") return null;
  return Number.isFinite(Date.parse(at)) ? at : null;
}

/**
 * Audit action name → which row it proves, and how.
 *
 * `methodFrom: "recorded"` means the HTTP method is read from the audit row
 * (the selection push records it); otherwise it is fixed by the code path
 * that writes that action — verified by reading the writer, and pinned by a
 * compliance test so a writer change cannot silently re-label evidence:
 *   - passing-only pushes are PUT (full-menu-server.ts `method: "PUT"`,
 *     selection-server.ts "only ever hands it PUT");
 *   - replace is POST (actions.ts writes `method: "POST"`).
 */
export const LEAFLY_PROOF_AUDIT_ACTIONS: Readonly<
  Record<string, { action: ProofActionId | "by_method"; ok: boolean | "by_status"; via: string }>
> = {
  "leafly.push.replace.success": { action: "menu_post", ok: true, via: "Replace my whole Leafly menu (POST)" },
  "leafly.push.replace.error": { action: "menu_post", ok: false, via: "Replace my whole Leafly menu (POST)" },
  "leafly.push.passing_only.success": { action: "menu_put", ok: true, via: "Send my whole menu, hold back only the bad ones" },
  "leafly.push.passing_only.error": { action: "menu_put", ok: false, via: "Send my whole menu, hold back only the bad ones" },
  "leafly.selection.push.success": { action: "by_method", ok: true, via: "Send only certain products" },
  "leafly.selection.push.error": { action: "by_method", ok: false, via: "Send only certain products" },
  "leafly.selection.push.passing_only.success": { action: "menu_put", ok: true, via: "Send only certain products (passing only)" },
  "leafly.selection.push.passing_only.error": { action: "menu_put", ok: false, via: "Send only certain products (passing only)" },
  "leafly.delete.success": { action: "menu_delete", ok: true, via: "Remove by product ID" },
  "leafly.delete.error": { action: "menu_delete", ok: false, via: "Remove by product ID" },
  "leafly.menu.delete.success": { action: "menu_delete", ok: true, via: "What is on your Leafly menu (remove)" },
  "leafly.menu.delete.error": { action: "menu_delete", ok: false, via: "What is on your Leafly menu (remove)" },
  "leafly.status.fetch": { action: "menu_status", ok: "by_status", via: "Check integration status" },
  "leafly.menu.readback": { action: "menu_readback", ok: "by_status", via: "Read the menu back" },
};

export const LEAFLY_PROOF_AUDIT_ACTION_NAMES: readonly string[] = Object.keys(LEAFLY_PROOF_AUDIT_ACTIONS);

export function auditRowToEvent(row: ProofAuditRow): ProofEvent | null {
  const at = validAt(row.at);
  if (!at) return null;
  const rule = LEAFLY_PROOF_AUDIT_ACTIONS[row.action];
  if (!rule) return null;

  let action: ProofActionId;
  if (rule.action === "by_method") {
    const m = (row.method ?? "").trim().toUpperCase();
    // The selection push records its method. Absent → PUT, because that
    // writer never sends anything else (see the note on the table above).
    action = m === "POST" ? "menu_post" : "menu_put";
  } else {
    action = rule.action;
  }

  let ok: boolean;
  if (rule.ok === "by_status") {
    // Mixed action (one name for success and failure): the recorded status
    // is the ONLY judge. A missing status is not a success.
    ok = isHttp2xx(row.httpStatus);
  } else if (rule.ok) {
    // A ".success" action is written only when the push returned ok. If a
    // status was recorded it must also agree; a ".success" row carrying a
    // 4xx/5xx is contradictory and is NOT counted as proof.
    ok = row.httpStatus === null || isHttp2xx(row.httpStatus);
  } else {
    ok = false;
  }

  return { action, ok, at, httpStatus: row.httpStatus, via: rule.via, source: "audit" };
}

export function syncRunToEvent(row: ProofSyncRunRow): ProofEvent | null {
  const at = validAt(row.at);
  if (!at) return null;
  const method = (row.method ?? "").trim().toUpperCase();
  const action: ProofActionId | null =
    method === "POST" ? "menu_post" : method === "PUT" ? "menu_put" : method === "DELETE" ? "menu_delete" : null;
  if (!action) return null;
  const disposition = (row.disposition ?? "").trim();
  // "skipped" and "refused" transmitted nothing: neither proof nor failure.
  if (disposition !== "success" && disposition !== "failed") return null;
  const ok =
    disposition === "success" && (row.httpStatus === null || isHttp2xx(row.httpStatus));
  const via = row.triggerSource === "schedule" ? "Automatic sync" : "Manual send";
  return { action, ok, at, httpStatus: row.httpStatus, via, source: "sync_runs" };
}

/**
 * An automatic run's DELETE half. `pushLeaflyAutomatic` only attempts the
 * DELETE after the upsert succeeded, and records status "ok" only when BOTH
 * halves succeeded — so "ok with deleteIds" proves a successful DELETE.
 *
 * An "error" row with deleteIds is AMBIGUOUS: the upsert may have failed
 * first, in which case no DELETE was ever sent. It is therefore not counted
 * as a DELETE failure — that would be a guess.
 */
export function autoRunToEvent(row: ProofAutoRunRow): ProofEvent | null {
  const at = validAt(row.at);
  if (!at) return null;
  if (!(row.deleteCount > 0)) return null;
  if (row.status !== "ok") return null;
  return {
    action: "menu_delete",
    ok: true,
    at,
    httpStatus: null,
    via: "Automatic sync (safe delete)",
    source: "auto_runs",
  };
}

const WEBHOOK_EVENT_TO_ACTION: Readonly<Record<string, ProofActionId>> = {
  order_submit: "webhook_order_submit",
  order_cancel: "webhook_order_cancel",
  order_status: "webhook_order_status",
  order_preview: "webhook_order_preview",
  order_activate: "webhook_order_activate",
  order_deactivate: "webhook_order_deactivate",
};

export function webhookRowToEvents(row: ProofWebhookRow): ProofEvent[] {
  const at = validAt(row.at);
  if (!at) return [];
  const type = (row.eventType ?? "").trim();
  const action = WEBHOOK_EVENT_TO_ACTION[type];
  if (!action) return [];
  if (!row.signatureVerified && (row.rejectionReason ?? "").trim() === LEAFLY_PROOF_UNSIGNED_REASON) {
    // Not from Leafly. Neither proof nor failure.
    return [];
  }
  const ok =
    row.signatureVerified === true &&
    typeof row.responseStatus === "number" &&
    LEAFLY_PROOF_WEBHOOK_OK_STATUSES.includes(row.responseStatus);
  const via = ok ? "Leafly delivery, signature verified" : "Leafly delivery we refused";
  const out: ProofEvent[] = [
    { action, ok, at, httpStatus: row.responseStatus, via, source: "webhooks" },
  ];
  // A verified shopper cancelation IS an order reaching the canceled
  // terminal state. A refused one proves nothing about the lifecycle.
  if (ok && action === "webhook_order_cancel") {
    out.push({
      action: "lifecycle_canceled",
      ok: true,
      at,
      httpStatus: row.responseStatus,
      via: "Shopper canceled on Leafly (verified webhook)",
      source: "webhooks",
    });
  }
  return out;
}

const OUTBOUND_TO_ACTION: Readonly<Record<LeaflyOutboundOperation, ProofActionId>> = {
  acknowledge: "order_acknowledge",
  status: "order_status_update",
  cart: "order_cart_update",
  fetch_order: "order_fetch",
  government_id: "order_government_id",
  medical_id: "order_medical_id",
};

export function outboundRowToEvents(row: ProofOutboundRow): ProofEvent[] {
  const at = validAt(row.at);
  if (!at) return [];
  const op = (row.operation ?? "").trim() as LeaflyOutboundOperation;
  const action = OUTBOUND_TO_ACTION[op];
  if (!action) return [];
  // A refusal never reached Leafly, so Leafly's reviewer cannot see it.
  if ((row.refusalCode ?? "").trim() !== "") return [];
  const disposition = (row.disposition ?? "").trim();
  if (disposition === "") return [];
  const ok = disposition === "success";
  const via =
    op === "status" && row.requestedStatus
      ? `Status \u2192 ${row.requestedStatus}`
      : ok
        ? "Leafly accepted"
        : `Leafly answered ${row.responseStatus ?? "nothing"}`;
  const out: ProofEvent[] = [
    { action, ok, at, httpStatus: row.responseStatus, via, source: "outbound" },
  ];
  if (op === "status" && ok) {
    const s = (row.requestedStatus ?? "").trim();
    if (s === "picked_up" || s === "canceled") {
      out.push({
        action: s === "picked_up" ? "lifecycle_picked_up" : "lifecycle_canceled",
        ok: true,
        at,
        httpStatus: row.responseStatus,
        via: `Status \u2192 ${s}`,
        source: "outbound",
      });
    }
  }
  return out;
}

export function collectProofEvents(input: ProofInput): ProofEvent[] {
  const events: ProofEvent[] = [];
  for (const r of input.syncRuns) {
    const e = syncRunToEvent(r);
    if (e) events.push(e);
  }
  for (const r of input.audits) {
    const e = auditRowToEvent(r);
    if (e) events.push(e);
  }
  for (const r of input.autoRuns) {
    const e = autoRunToEvent(r);
    if (e) events.push(e);
  }
  for (const r of input.webhooks) events.push(...webhookRowToEvents(r));
  for (const r of input.outbound) events.push(...outboundRowToEvents(r));
  return events;
}

/** Which sources can prove each row. Used to decide "unreadable" honestly. */
export const LEAFLY_PROOF_SOURCES_BY_ACTION: Readonly<Record<ProofActionId, readonly ProofSource[]>> = {
  menu_post: ["sync_runs", "audit"],
  menu_put: ["sync_runs", "audit"],
  menu_delete: ["audit", "auto_runs"],
  menu_status: ["audit"],
  menu_readback: ["audit"],
  webhook_order_submit: ["webhooks"],
  webhook_order_cancel: ["webhooks"],
  webhook_order_status: ["webhooks"],
  webhook_order_preview: ["webhooks"],
  webhook_order_activate: ["webhooks"],
  webhook_order_deactivate: ["webhooks"],
  order_fetch: ["outbound"],
  order_acknowledge: ["outbound"],
  order_status_update: ["outbound"],
  order_government_id: ["outbound"],
  order_medical_id: ["outbound"],
  order_cart_update: ["outbound"],
  lifecycle_picked_up: ["outbound"],
  lifecycle_canceled: ["outbound", "webhooks"],
};

// ===========================================================================
// 5. Per-row verdict
// ===========================================================================

export type ProofState =
  | "proven"
  | "expired"
  | "failing"
  | "none"
  | "unreadable"
  | "not_applicable";

export type ProofRow = {
  def: ProofActionDef;
  state: ProofState;
  latestSuccess: ProofEvent | null;
  latestFailure: ProofEvent | null;
  /** Whole days since the latest success (floor). Null when no success. */
  ageDays: number | null;
  /** The latest attempt FAILED after an earlier success: Leafly sees an uncorrected error. */
  regressed: boolean;
  /** The newest-N read was full, so an older success may exist that was not read. */
  saturated: boolean;
  /** Needs migration 0231 to be recordable, and nothing has been recorded yet. */
  mayNeedMigration: boolean;
  /** One sentence for the owner. */
  note: string;
};

const DAY_MS = 86_400_000;

function laterOf(a: ProofEvent | null, b: ProofEvent): ProofEvent {
  if (!a) return b;
  return Date.parse(b.at) > Date.parse(a.at) ? b : a;
}

export function ageInDays(atIso: string, nowIso: string): number {
  const diff = Date.parse(nowIso) - Date.parse(atIso);
  if (!Number.isFinite(diff) || diff <= 0) return 0;
  return Math.floor(diff / DAY_MS);
}

/** Proof is stale when strictly older than the retention period. */
export function isProofExpired(atIso: string, nowIso: string): boolean {
  const diff = Date.parse(nowIso) - Date.parse(atIso);
  return Number.isFinite(diff) && diff > LEAFLY_SANDBOX_LOG_RETENTION_DAYS * DAY_MS;
}

const OUTBOUND_OP_FOR_ACTION: Partial<Record<ProofActionId, LeaflyOutboundOperation>> = {
  order_fetch: "fetch_order",
  order_government_id: "government_id",
  order_medical_id: "medical_id",
};

export function assessProofRow(
  def: ProofActionDef,
  events: readonly ProofEvent[],
  ctx: {
    nowIso: string;
    environment: "sandbox" | "production";
    unreadable: readonly ProofSource[];
    saturated: readonly ProofActionId[];
  },
): ProofRow {
  let latestSuccess: ProofEvent | null = null;
  let latestFailure: ProofEvent | null = null;
  for (const e of events) {
    if (e.action !== def.id) continue;
    if (e.ok) latestSuccess = laterOf(latestSuccess, e);
    else latestFailure = laterOf(latestFailure, e);
  }

  const regressed =
    latestSuccess !== null &&
    latestFailure !== null &&
    Date.parse(latestFailure.at) > Date.parse(latestSuccess.at);
  const saturated = ctx.saturated.includes(def.id);
  const op = OUTBOUND_OP_FOR_ACTION[def.id];
  const mayNeedMigration =
    op !== undefined &&
    LEAFLY_OPERATIONS_NEEDING_0231.includes(op) &&
    latestSuccess === null &&
    latestFailure === null;
  const sourcesUnreadable = LEAFLY_PROOF_SOURCES_BY_ACTION[def.id].some((s) =>
    ctx.unreadable.includes(s),
  );

  const base = {
    def,
    latestSuccess,
    latestFailure,
    ageDays: latestSuccess ? ageInDays(latestSuccess.at, ctx.nowIso) : null,
    regressed,
    saturated,
    mayNeedMigration,
  };

  if (def.sandboxOnly && ctx.environment === "production") {
    return {
      ...base,
      state: "not_applicable",
      note: "Sandbox only. Leafly does not offer this in production, so there is nothing to prove here.",
    };
  }

  if (latestSuccess) {
    if (isProofExpired(latestSuccess.at, ctx.nowIso)) {
      return { ...base, state: "expired", note: LEAFLY_PROOF_EXPIRED_TEXT };
    }
    return {
      ...base,
      state: "proven",
      note: regressed
        ? "Proven, but the most recent attempt FAILED. Leafly looks for errors being corrected on later requests, so run it again and get a success."
        : "Proven by a recorded success.",
    };
  }

  if (sourcesUnreadable) {
    return {
      ...base,
      state: "unreadable",
      note: "The records for this action could not be read just now. That is not the same as \u201cnever done\u201d. Refresh to try again.",
    };
  }

  if (latestFailure) {
    return {
      ...base,
      state: "failing",
      note: saturated
        ? "Every recent attempt we read failed. An older success may exist beyond what was read, but it would not help: Leafly wants the errors corrected."
        : "Tried, but no success has been recorded yet. Fix the error shown and run it again.",
    };
  }

  return {
    ...base,
    state: "none",
    note: mayNeedMigration
      ? `No record yet. This action is recorded only after migration ${LEAFLY_PROOF_MIGRATION_FILE} has been run in Supabase. Run it once, then do this action again.`
      : "No record yet. Do this action once to prove it.",
  };
}

// ===========================================================================
// 6. The whole checklist
// ===========================================================================

export type ProofTally = { total: number; proven: number };

export type CertificationProof = {
  rows: ProofRow[];
  required: ProofTally;
  recommended: ProofTally;
  optional: ProofTally;
  /** Every required row freshly proven, and none of them regressed. */
  readyToNominate: boolean;
  /** Required rows that are not freshly proven (or regressed), by label. */
  missingRequired: string[];
  headline: string;
  /** Things a reviewer should know that are not rows. */
  notes: string[];
};

function tallyFor(rows: readonly ProofRow[], level: ProofRequirement): ProofTally {
  const scoped = rows.filter((r) => r.def.requirement === level && r.state !== "not_applicable");
  return { total: scoped.length, proven: scoped.filter((r) => r.state === "proven").length };
}

export function isRowCertReady(row: ProofRow): boolean {
  return row.state === "proven" && !row.regressed;
}

export function assessCertificationProof(input: ProofInput): CertificationProof {
  const events = collectProofEvents(input);
  const ctx = {
    nowIso: input.nowIso,
    environment: input.environment,
    unreadable: input.unreadable ?? [],
    saturated: input.saturated ?? [],
  };
  const rows = LEAFLY_PROOF_ACTIONS.map((def) => assessProofRow(def, events, ctx));
  const requiredRows = rows.filter((r) => r.def.requirement === "required");
  const missingRequired = requiredRows.filter((r) => !isRowCertReady(r)).map((r) => r.def.label);
  const readyToNominate = requiredRows.length > 0 && missingRequired.length === 0;

  const required = tallyFor(rows, "required");
  const headline = readyToNominate
    ? `All ${required.total} required actions are proven inside Leafly's two-week log window. You can pick your certification window.`
    : `${required.proven} of ${required.total} required actions are proven inside Leafly's two-week log window. ` +
      `Still to do: ${missingRequired.join("; ")}.`;

  const notes = [
    "Green means a recorded run reached Leafly and succeeded. Nothing on this card turns green from a setting or a claim.",
    `Leafly keeps sandbox logs for ${LEAFLY_SANDBOX_LOG_RETENTION_DAYS} days (Ben, answer 11). Proof older than that is shown as possibly expired.`,
    "Leafly's spec also mentions both fulfilment types (pickup and delivery). Ben confirmed pickup-only is fine (answer 7), so delivery is not listed.",
    "Menu and order certification are separate submissions. Your window email can cover both, or you can do them one at a time.",
    "Leafly issues production credentials separately later (Ben, answers 9 and 12). Everything here is sandbox proof.",
  ];

  return {
    rows,
    required,
    recommended: tallyFor(rows, "recommended"),
    optional: tallyFor(rows, "optional"),
    readyToNominate,
    missingRequired,
    headline,
    notes,
  };
}

// ===========================================================================
// 7. Dates in the store's time zone, and business days
// ===========================================================================

export type Ymd = { y: number; m: number; d: number };

/** The calendar date of an instant in a time zone. Uses the global Intl, not an import. */
export function zonedYmd(iso: string, timeZone: string = LEAFLY_PROOF_STORE_TIME_ZONE): Ymd {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return { y: get("year"), m: get("month"), d: get("day") };
}

export function ymdToString(v: Ymd): string {
  return `${v.y}-${String(v.m).padStart(2, "0")}-${String(v.d).padStart(2, "0")}`;
}

/** Calendar arithmetic on a date with no time zone (UTC noon avoids DST edges). */
export function addDays(v: Ymd, days: number): Ymd {
  const t = new Date(Date.UTC(v.y, v.m - 1, v.d, 12) + days * DAY_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(v: Ymd): number {
  return new Date(Date.UTC(v.y, v.m - 1, v.d, 12)).getUTCDay();
}

export function isBusinessDay(v: Ymd): boolean {
  const w = weekday(v);
  return w >= 1 && w <= 5;
}

/** The first business day on or after `v`. */
export function nextBusinessDayOnOrAfter(v: Ymd): Ymd {
  let cur = v;
  while (!isBusinessDay(cur)) cur = addDays(cur, 1);
  return cur;
}

/** `n` business days after `v` (n >= 0); `v` itself need not be a business day. */
export function addBusinessDays(v: Ymd, n: number): Ymd {
  let cur = v;
  let left = Math.max(0, Math.floor(n));
  while (left > 0) {
    cur = addDays(cur, 1);
    if (isBusinessDay(cur)) left -= 1;
  }
  return cur;
}

/** `n` business days before `v`. */
export function subtractBusinessDays(v: Ymd, n: number): Ymd {
  let cur = v;
  let left = Math.max(0, Math.floor(n));
  while (left > 0) {
    cur = addDays(cur, -1);
    if (isBusinessDay(cur)) left -= 1;
  }
  return cur;
}

/** The UTC instant of local midnight at the start of `v` in `timeZone`. */
export function zonedMidnightUtcIso(v: Ymd, timeZone: string = LEAFLY_PROOF_STORE_TIME_ZONE): string {
  const guess = Date.UTC(v.y, v.m - 1, v.d, 0, 0, 0);
  const offsetAt = (t: number): number => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(t));
    const get = (k: string) => Number(parts.find((p) => p.type === k)?.value ?? "0");
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    return asUtc - t;
  };
  let t = guess - offsetAt(guess);
  // Once more, in case the first guess landed on the other side of a DST change.
  t = guess - offsetAt(t);
  return new Date(t).toISOString();
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function describeYmd(v: Ymd): string {
  return `${WEEKDAY_NAMES[weekday(v)]}, ${MONTH_NAMES[v.m - 1]} ${v.d}, ${v.y}`;
}

// ===========================================================================
// 8. Suggesting a window, and checking one
// ===========================================================================

export type WindowSuggestion = {
  start: Ymd;
  end: Ymd;
  startLabel: string;
  endLabel: string;
  /** Send the window to Leafly by the end of this day. */
  emailBy: Ymd;
  emailByLabel: string;
  /** The earliest Leafly could review, given two business days' notice. */
  reviewEarliest: Ymd;
  reviewEarliestLabel: string;
  /** Activity from the window's first day starts falling out of Leafly's logs after this day. */
  logsKeptUntil: Ymd;
  logsKeptUntilLabel: string;
  steps: string[];
  caveat: string;
};

/**
 * The next two business days, starting today if today is one (store time).
 *
 * The reviewer can only look at logs Leafly still holds, so the arithmetic is
 * shown, not implied: window → email → at least two business days' notice →
 * review, all well inside the fourteen days the logs are kept.
 */
export function suggestCertificationWindow(
  nowIso: string,
  timeZone: string = LEAFLY_PROOF_STORE_TIME_ZONE,
): WindowSuggestion {
  const today = zonedYmd(nowIso, timeZone);
  const start = nextBusinessDayOnOrAfter(today);
  const end = addBusinessDays(start, LEAFLY_PROOF_WINDOW_BUSINESS_DAYS - 1);
  const emailBy = end;
  const reviewEarliest = addBusinessDays(emailBy, LEAFLY_PROOF_NOTICE_BUSINESS_DAYS);
  const logsKeptUntil = addDays(start, LEAFLY_SANDBOX_LOG_RETENTION_DAYS);
  return {
    start,
    end,
    startLabel: describeYmd(start),
    endLabel: describeYmd(end),
    emailBy,
    emailByLabel: describeYmd(emailBy),
    reviewEarliest,
    reviewEarliestLabel: describeYmd(reviewEarliest),
    logsKeptUntil,
    logsKeptUntilLabel: describeYmd(logsKeptUntil),
    steps: [
      `Pick your window. Suggested: ${describeYmd(start)} to ${describeYmd(end)} (Pacific time).`,
      "Inside the window, do every required action on this card once, with no mistakes afterwards. Use a sandbox test order for the order rows.",
      `Check this card at the end of ${describeYmd(end)}: every required row should be green.`,
      `Email Leafly the window by the end of ${describeYmd(emailBy)}. The button below drafts the email for you.`,
      `Leafly needs ${LEAFLY_PROOF_NOTICE_BUSINESS_DAYS} business days' notice, so the earliest review is ${describeYmd(reviewEarliest)}. Your window's logs are kept until about ${describeYmd(logsKeptUntil)}.`,
    ],
    caveat:
      "Business days here are Monday to Friday. Public holidays are not known to this screen, so move the window if one falls inside it.",
  };
}

export type WindowCoverage = {
  fromIso: string;
  toIso: string;
  /** Required rows with a success inside [from, to]. */
  coveredRequired: string[];
  missingRequired: string[];
  /** Every action with its first success inside the window, for the email. */
  proofs: { label: string; endpoint: string; at: string }[];
  complete: boolean;
};

/**
 * "If I told Leafly this window, would it hold proof of everything?"
 *
 * A row counts only if it has a SUCCESS inside the window AND no failure
 * after that success inside the window (an uncorrected error inside the
 * assessed period is exactly what the reviewer marks down).
 */
export function assessWindowCoverage(
  input: ProofInput,
  fromIso: string,
  toIso: string,
): WindowCoverage {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  const events = collectProofEvents(input).filter((e) => {
    const t = Date.parse(e.at);
    return t >= from && t <= to;
  });
  const covered: string[] = [];
  const missing: string[] = [];
  const proofs: { label: string; endpoint: string; at: string }[] = [];
  for (const def of LEAFLY_PROOF_ACTIONS) {
    if (def.sandboxOnly && input.environment === "production") continue;
    const mine = events.filter((e) => e.action === def.id);
    let lastOk: ProofEvent | null = null;
    let lastBad: ProofEvent | null = null;
    let firstOk: ProofEvent | null = null;
    for (const e of mine) {
      if (e.ok) {
        lastOk = laterOf(lastOk, e);
        if (!firstOk || Date.parse(e.at) < Date.parse(firstOk.at)) firstOk = e;
      } else {
        lastBad = laterOf(lastBad, e);
      }
    }
    const clean = lastOk !== null && (lastBad === null || Date.parse(lastBad.at) < Date.parse(lastOk.at));
    if (clean && firstOk) proofs.push({ label: def.label, endpoint: def.endpoint, at: firstOk.at });
    if (def.requirement === "required") (clean ? covered : missing).push(def.label);
  }
  return {
    fromIso,
    toIso,
    coveredRequired: covered,
    missingRequired: missing,
    proofs,
    complete: missing.length === 0,
  };
}

/**
 * The window "the last two business days up to now". This is the window the
 * owner could email Leafly TODAY without doing anything else.
 */
export function recentBusinessWindow(
  nowIso: string,
  timeZone: string = LEAFLY_PROOF_STORE_TIME_ZONE,
): { fromIso: string; toIso: string; start: Ymd; end: Ymd } {
  const today = zonedYmd(nowIso, timeZone);
  // If today is a business day it is the window's last day; otherwise the
  // last business day before it is.
  const end = isBusinessDay(today) ? today : subtractBusinessDays(today, 1);
  const start = subtractBusinessDays(end, LEAFLY_PROOF_WINDOW_BUSINESS_DAYS - 1);
  return { fromIso: zonedMidnightUtcIso(start, timeZone), toIso: nowIso, start, end };
}

// ===========================================================================
// 9. Presentation helpers (here so they are testable, not in the component)
// ===========================================================================

export function formatProofWhen(iso: string, timeZone: string = LEAFLY_PROOF_STORE_TIME_ZONE): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "unknown time";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(t));
}

export function describeAge(days: number | null): string {
  if (days === null) return "";
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

export type ProofTone = "green" | "gold" | "orange" | "danger" | "neutral";

export function proofStateTone(row: ProofRow): ProofTone {
  switch (row.state) {
    case "proven":
      return row.regressed ? "orange" : "green";
    case "expired":
      return "gold";
    case "failing":
      return "danger";
    case "unreadable":
      return "orange";
    case "not_applicable":
    case "none":
    default:
      return "neutral";
  }
}

export function proofStateLabel(row: ProofRow): string {
  switch (row.state) {
    case "proven":
      return row.regressed ? "Proven \u2014 last try failed" : "Proven";
    case "expired":
      return "May have expired";
    case "failing":
      return "Failing";
    case "unreadable":
      return "Could not read";
    case "not_applicable":
      return "Not needed here";
    case "none":
    default:
      return "No record yet";
  }
}

export function requirementLabel(r: ProofRequirement): string {
  return r === "required" ? "Required" : r === "recommended" ? "Recommended" : "Optional";
}

// ===========================================================================
// 10. The email to Leafly
// ===========================================================================

/**
 * A plain-text draft of the "here is our certification window" email. It
 * lists ONLY actions with a clean recorded success inside the window, with
 * the time of that success, so Leafly's reviewer can find each one. Required
 * actions without proof are listed as missing — the draft never implies more
 * than the records show.
 */
export function buildCertificationWindowEmail(input: {
  coverage: WindowCoverage;
  windowStartLabel: string;
  windowEndLabel: string;
  storeName?: string;
  timeZone?: string;
}): string {
  const tz = input.timeZone ?? LEAFLY_PROOF_STORE_TIME_ZONE;
  const store = (input.storeName ?? "").trim() || "Greenway Marijuana";
  const lines: string[] = [];
  lines.push(`Subject: ${store} \u2014 certification window for our Leafly sandbox integration`);
  lines.push("");
  lines.push("Hi,");
  lines.push("");
  lines.push(
    `${store} would like to request certification. Please assess our sandbox activity from ` +
      `${input.windowStartLabel} through ${input.windowEndLabel} (Pacific time).`,
  );
  lines.push("");
  if (input.coverage.proofs.length > 0) {
    lines.push("Inside that window our records show a successful request for each of these:");
    for (const p of input.coverage.proofs) {
      lines.push(`  - ${p.label} (${p.endpoint}) \u2014 ${formatProofWhen(p.at, tz)}`);
    }
  } else {
    lines.push("Our records do not yet show any successful requests inside that window.");
  }
  if (input.coverage.missingRequired.length > 0) {
    lines.push("");
    lines.push("Not yet shown inside the window (we will complete these before the review):");
    for (const m of input.coverage.missingRequired) lines.push(`  - ${m}`);
  }
  lines.push("");
  lines.push("We are a pickup-only store, as discussed. Thank you!");
  return lines.join("\n");
}

// ===========================================================================
// 11. Self-test
// ===========================================================================

export function __runLeaflyCertificationProofTests(): { passed: number; failed: number } {
  let passed = 0;
  const failures: string[] = [];
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else failures.push(msg);
  };

  const NOW = "2026-09-25T19:00:00.000Z"; // Friday, noon Pacific (PDT)
  const daysAgo = (n: number) => new Date(Date.parse(NOW) - n * DAY_MS).toISOString();
  const empty = (): ProofInput => ({
    nowIso: NOW,
    environment: "sandbox",
    syncRuns: [],
    audits: [],
    autoRuns: [],
    webhooks: [],
    outbound: [],
  });
  const rowOf = (p: CertificationProof, id: ProofActionId) => {
    const r = p.rows.find((x) => x.def.id === id);
    if (!r) throw new Error(id);
    return r;
  };

  // ── the table ─────────────────────────────────────────────────────────────
  ok(LEAFLY_PROOF_ACTIONS.length === LEAFLY_PROOF_ACTION_IDS.length, "one def per id");
  ok(new Set(LEAFLY_PROOF_ACTIONS.map((a) => a.id)).size === LEAFLY_PROOF_ACTIONS.length, "ids unique");
  ok(LEAFLY_PROOF_ACTION_IDS.every((id) => proofActionDef(id).id === id), "every id resolves");
  ok(proofActionDef("order_fetch").requirement === "required", "fetch order is Required (spec)");
  ok(proofActionDef("order_acknowledge").requirement === "required", "acknowledge is Required");
  ok(proofActionDef("order_status_update").requirement === "required", "status update is Required");
  ok(proofActionDef("webhook_order_submit").requirement === "required", "submission webhook Required");
  ok(proofActionDef("webhook_order_cancel").requirement === "required", "cancelation webhook Required");
  ok(proofActionDef("webhook_order_preview").requirement === "recommended", "preview Recommended");
  ok(proofActionDef("webhook_order_status").requirement === "recommended", "status webhook Recommended");
  ok(proofActionDef("order_government_id").requirement === "recommended", "gov id Recommended");
  ok(proofActionDef("order_medical_id").requirement === "recommended", "medical id Recommended");
  ok(proofActionDef("webhook_order_activate").requirement === "optional", "activation Optional");
  ok(proofActionDef("webhook_order_deactivate").requirement === "optional", "deactivation Optional");
  ok(proofActionDef("order_cart_update").requirement === "optional", "cart Optional");
  ok(proofActionDef("menu_readback").sandboxOnly === true, "readback is sandbox only");
  ok(LEAFLY_PROOF_ACTIONS.every((a) => a.howToProve.length > 20 && a.source.length > 20), "every row explains itself");
  ok(LEAFLY_PROOF_ACTIONS.filter((a) => a.requirement === "required").length === 10, "ten required rows");
  let threw = false;
  try {
    proofActionDef("nope" as ProofActionId);
  } catch {
    threw = true;
  }
  ok(threw, "unknown id throws");
  ok(LEAFLY_OUTBOUND_OPERATIONS.length === 6, "six outbound operations");
  ok(
    Object.keys(OUTBOUND_TO_ACTION).length === LEAFLY_OUTBOUND_OPERATIONS.length,
    "every outbound operation maps to a row",
  );
  ok(LEAFLY_SANDBOX_LOG_RETENTION_DAYS === 14, "two weeks of sandbox logs");

  // ── empty: nothing is proven, nothing is claimed ─────────────────────────
  const e0 = assessCertificationProof(empty());
  ok(e0.rows.every((r) => r.state === "none"), "empty → every row none");
  ok(!e0.readyToNominate, "empty → not ready");
  ok(e0.required.proven === 0 && e0.required.total === 10, "empty tally 0/10");
  ok(e0.missingRequired.length === 10, "all required missing");
  ok(rowOf(e0, "order_fetch").mayNeedMigration, "fetch row points at the migration");
  ok(rowOf(e0, "order_fetch").note.includes(LEAFLY_PROOF_MIGRATION_FILE), "names the migration file");
  ok(!rowOf(e0, "order_acknowledge").mayNeedMigration, "acknowledge never needed 0231");
  ok(!rowOf(e0, "menu_post").note.includes("migration"), "menu row does not mention a migration");

  // ── audit mapping ────────────────────────────────────────────────────────
  const a = (action: string, httpStatus: number | null, at = daysAgo(1), method: string | null = null) =>
    auditRowToEvent({ action, httpStatus, method, at });
  ok(a("leafly.push.replace.success", 202)?.action === "menu_post", "replace → POST");
  ok(a("leafly.push.replace.success", 202)?.ok === true, "replace success 202 ok");
  ok(a("leafly.push.replace.success", null)?.ok === true, "success with no status recorded is ok");
  ok(a("leafly.push.replace.success", 500)?.ok === false, "success row with 500 is NOT proof");
  ok(a("leafly.push.replace.error", 400)?.ok === false, "replace error is failure");
  ok(a("leafly.push.passing_only.success", 200)?.action === "menu_put", "passing only → PUT");
  ok(a("leafly.selection.push.success", 200, daysAgo(1), "POST")?.action === "menu_post", "selection POST recorded");
  ok(a("leafly.selection.push.success", 200, daysAgo(1), "put")?.action === "menu_put", "selection put (any case)");
  ok(a("leafly.selection.push.success", 200, daysAgo(1), null)?.action === "menu_put", "selection with no method → PUT");
  ok(a("leafly.selection.push.passing_only.success", 200)?.action === "menu_put", "selection passing → PUT");
  ok(a("leafly.delete.success", 200)?.action === "menu_delete", "ID box delete → DELETE");
  ok(a("leafly.menu.delete.success", 200)?.action === "menu_delete", "browser delete → DELETE");
  ok(a("leafly.menu.delete.error", 404)?.ok === false, "browser delete error fails");
  ok(a("leafly.status.fetch", 200)?.ok === true, "status 200 ok");
  ok(a("leafly.status.fetch", 401)?.ok === false, "status 401 fails");
  ok(a("leafly.status.fetch", null)?.ok === false, "status with no code is not proof");
  ok(a("leafly.status.fetch", 299)?.ok === true, "299 is 2xx");
  ok(a("leafly.status.fetch", 300)?.ok === false, "300 is not 2xx");
  ok(a("leafly.status.fetch", 199)?.ok === false, "199 is not 2xx");
  ok(a("leafly.menu.readback", 200)?.action === "menu_readback", "readback maps");
  ok(a("leafly.sync_settings.save", 200) === null, "settings save is not evidence");
  ok(a("leafly.selection.preview", 200) === null, "preview (no send) is not evidence");
  ok(a("leafly.status.fetch", 200, "not a date") === null, "bad timestamp dropped");
  ok(a("leafly.status.fetch", 200, "") === null, "empty timestamp dropped");

  // ── sync runs ────────────────────────────────────────────────────────────
  const s = (method: string | null, disposition: string, httpStatus: number | null = 200, trig = "schedule") =>
    syncRunToEvent({ method, disposition, httpStatus, triggerSource: trig, at: daysAgo(2) });
  ok(s("POST", "success")?.action === "menu_post", "run POST");
  ok(s("PUT", "success")?.action === "menu_put", "run PUT");
  ok(s("DELETE", "success")?.action === "menu_delete", "run DELETE");
  ok(s("POST", "success")?.via === "Automatic sync", "schedule labelled automatic");
  ok(s("POST", "success", 200, "manual")?.via === "Manual send", "manual labelled manual");
  ok(s("PUT", "failed", 500)?.ok === false, "failed run is a failure");
  ok(s("PUT", "skipped") === null, "skipped run is not evidence");
  ok(s("PUT", "refused") === null, "refused run is not evidence");
  ok(s(null, "success") === null, "no method → not evidence");
  ok(s("PUT", "success", 500)?.ok === false, "success with 500 contradicts → not proof");
  ok(s("PUT", "success", null)?.ok === true, "success with no status → proof");

  // ── automatic deletes ────────────────────────────────────────────────────
  ok(autoRunToEvent({ status: "ok", deleteCount: 2, at: daysAgo(1) })?.action === "menu_delete", "auto ok with deletes → DELETE");
  ok(autoRunToEvent({ status: "ok", deleteCount: 0, at: daysAgo(1) }) === null, "no deletes → nothing");
  ok(autoRunToEvent({ status: "error", deleteCount: 3, at: daysAgo(1) }) === null, "error with deletes is ambiguous → nothing");

  // ── webhooks ─────────────────────────────────────────────────────────────
  const w = (eventType: string, signatureVerified: boolean, responseStatus: number | null, rejectionReason: string | null = null) =>
    webhookRowToEvents({ eventType, signatureVerified, rejectionReason, responseStatus, at: daysAgo(1) });
  ok(w("order_submit", true, 200)[0]?.ok === true, "verified submit 200 proves");
  ok(w("order_submit", true, 201)[0]?.ok === true, "201 also accepted");
  ok(w("order_submit", true, 202)[0]?.ok === false, "202 is not a Leafly-accepted webhook answer");
  ok(w("order_submit", false, 401, "missing_header").length === 0, "unsigned probe ignored");
  ok(w("order_submit", false, 401, "mismatch")[0]?.ok === false, "bad signature is a failure");
  ok(w("order_cancel", true, 200).some((e) => e.action === "lifecycle_canceled"), "verified cancel also proves canceled state");
  ok(!w("order_cancel", false, 401, "mismatch").some((e) => e.action === "lifecycle_canceled"), "refused cancel does not");
  ok(w("order_status", true, 200)[0]?.action === "webhook_order_status", "status webhook maps");
  ok(w("order_preview", true, 200)[0]?.action === "webhook_order_preview", "preview maps");
  ok(w("order_activate", true, 200)[0]?.action === "webhook_order_activate", "activate maps");
  ok(w("order_deactivate", true, 200)[0]?.action === "webhook_order_deactivate", "deactivate maps");
  ok(w("something_new", true, 200).length === 0, "unknown event type ignored");
  ok(w("order_submit", true, null)[0]?.ok === false, "verified but no status recorded is not proof");

  // ── outbound ─────────────────────────────────────────────────────────────
  const o = (operation: string, disposition: string | null, requestedStatus: string | null = null, refusalCode: string | null = null, responseStatus: number | null = 200) =>
    outboundRowToEvents({ operation, disposition, requestedStatus, refusalCode, responseStatus, at: daysAgo(1) });
  ok(o("acknowledge", "success", null, null, 204)[0]?.action === "order_acknowledge", "ack maps");
  ok(o("fetch_order", "success")[0]?.action === "order_fetch", "fetch maps");
  ok(o("government_id", "success")[0]?.action === "order_government_id", "gov maps");
  ok(o("medical_id", "success")[0]?.action === "order_medical_id", "medical maps");
  ok(o("cart", "success")[0]?.action === "order_cart_update", "cart maps");
  ok(o("status", "success", "picked_up").some((e) => e.action === "lifecycle_picked_up"), "picked_up proves terminal");
  ok(o("status", "success", "canceled").some((e) => e.action === "lifecycle_canceled"), "canceled proves terminal");
  ok(!o("status", "success", "ready").some((e) => e.action.startsWith("lifecycle_")), "ready is not terminal");
  ok(!o("status", "fix_request", "picked_up").some((e) => e.action === "lifecycle_picked_up"), "failed picked_up is not proof");
  ok(o("status", null, "confirmed", "not_acknowledged").length === 0, "refusal never reached Leafly");
  ok(o("status", null).length === 0, "no disposition → nothing");
  ok(o("acknowledge", "retry", null, null, 500)[0]?.ok === false, "retry is failure");
  ok(o("acknowledge", "gone", null, null, 404)[0]?.ok === false, "gone is failure");
  ok(o("bogus", "success").length === 0, "unknown operation ignored");

  // ── row states ───────────────────────────────────────────────────────────
  const withAudit = (rows: ProofAuditRow[]): ProofInput => ({ ...empty(), audits: rows });
  const fresh = assessCertificationProof(withAudit([{ action: "leafly.status.fetch", httpStatus: 200, method: null, at: daysAgo(3) }]));
  ok(rowOf(fresh, "menu_status").state === "proven", "3 days → proven");
  ok(rowOf(fresh, "menu_status").ageDays === 3, "age is 3");
  const edge = assessCertificationProof(withAudit([{ action: "leafly.status.fetch", httpStatus: 200, method: null, at: daysAgo(14) }]));
  ok(rowOf(edge, "menu_status").state === "proven", "exactly 14 days is still inside");
  const old = assessCertificationProof(withAudit([{ action: "leafly.status.fetch", httpStatus: 200, method: null, at: daysAgo(14.01) }]));
  ok(rowOf(old, "menu_status").state === "expired", "past 14 days → expired");
  ok(rowOf(old, "menu_status").note === LEAFLY_PROOF_EXPIRED_TEXT, "expired uses the roadmap sentence");
  const fut = assessCertificationProof(withAudit([{ action: "leafly.status.fetch", httpStatus: 200, method: null, at: daysAgo(-1) }]));
  ok(rowOf(fut, "menu_status").state === "proven" && rowOf(fut, "menu_status").ageDays === 0, "future stamp (skew) → age 0");
  const fail = assessCertificationProof(withAudit([{ action: "leafly.status.fetch", httpStatus: 401, method: null, at: daysAgo(1) }]));
  ok(rowOf(fail, "menu_status").state === "failing", "only failures → failing");
  const regr = assessCertificationProof(
    withAudit([
      { action: "leafly.status.fetch", httpStatus: 200, method: null, at: daysAgo(3) },
      { action: "leafly.status.fetch", httpStatus: 500, method: null, at: daysAgo(1) },
    ]),
  );
  ok(rowOf(regr, "menu_status").state === "proven", "success then failure is still proven");
  ok(rowOf(regr, "menu_status").regressed, "…but regressed");
  ok(proofStateTone(rowOf(regr, "menu_status")) === "orange", "regressed tone orange");
  const fixed = assessCertificationProof(
    withAudit([
      { action: "leafly.status.fetch", httpStatus: 500, method: null, at: daysAgo(3) },
      { action: "leafly.status.fetch", httpStatus: 200, method: null, at: daysAgo(1) },
    ]),
  );
  ok(!rowOf(fixed, "menu_status").regressed, "failure then success is corrected");
  ok(rowOf(fixed, "menu_status").latestSuccess?.at === daysAgo(1), "latest success is the newest");
  // Order of input rows does not matter.
  const reversed = assessCertificationProof(
    withAudit([
      { action: "leafly.status.fetch", httpStatus: 200, method: null, at: daysAgo(1) },
      { action: "leafly.status.fetch", httpStatus: 200, method: null, at: daysAgo(5) },
    ]),
  );
  ok(rowOf(reversed, "menu_status").latestSuccess?.at === daysAgo(1), "input order irrelevant");

  // unreadable vs none
  const unread = assessCertificationProof({ ...empty(), unreadable: ["outbound"] });
  ok(rowOf(unread, "order_acknowledge").state === "unreadable", "failed read → unreadable, not none");
  ok(rowOf(unread, "menu_post").state === "none", "other sources unaffected");
  ok(rowOf(unread, "lifecycle_canceled").state === "unreadable", "row with an unreadable source is unreadable");
  const unreadButProven = assessCertificationProof({
    ...empty(),
    unreadable: ["webhooks"],
    outbound: [{ operation: "status", requestedStatus: "canceled", disposition: "success", responseStatus: 200, refusalCode: null, at: daysAgo(1) }],
  });
  ok(rowOf(unreadButProven, "lifecycle_canceled").state === "proven", "a success from a readable source still proves");
  const unreadFail = assessCertificationProof({
    ...empty(),
    unreadable: ["sync_runs"],
    audits: [{ action: "leafly.push.replace.error", httpStatus: 400, method: null, at: daysAgo(1) }],
  });
  ok(rowOf(unreadFail, "menu_post").state === "unreadable", "a failure plus an unreadable source is unknown, not failing");

  // saturation
  const sat = assessCertificationProof({
    ...withAudit([{ action: "leafly.status.fetch", httpStatus: 500, method: null, at: daysAgo(1) }]),
    saturated: ["menu_status"],
  });
  ok(rowOf(sat, "menu_status").saturated, "saturated flag carried");
  ok(rowOf(sat, "menu_status").note.includes("older success"), "saturated note is honest");

  // production
  const prod = assessCertificationProof({
    ...withAudit([{ action: "leafly.menu.readback", httpStatus: 200, method: null, at: daysAgo(1) }]),
    environment: "production",
  });
  ok(rowOf(prod, "menu_readback").state === "not_applicable", "readback N/A in production");
  ok(prod.optional.total === 3, "N/A rows excluded from the tally");

  // migration hint disappears once anything is recorded
  const recorded = assessCertificationProof({
    ...empty(),
    outbound: [{ operation: "fetch_order", requestedStatus: null, disposition: "retry", responseStatus: 500, refusalCode: null, at: daysAgo(1) }],
  });
  ok(!rowOf(recorded, "order_fetch").mayNeedMigration, "a recorded fetch proves 0231 is applied");
  ok(rowOf(recorded, "order_fetch").state === "failing", "…and shows failing");

  // ── the whole thing, fully proven ────────────────────────────────────────
  const full: ProofInput = {
    ...empty(),
    syncRuns: [
      { method: "POST", disposition: "success", httpStatus: 202, triggerSource: "manual", at: daysAgo(1) },
      { method: "PUT", disposition: "success", httpStatus: 202, triggerSource: "schedule", at: daysAgo(1) },
    ],
    audits: [{ action: "leafly.menu.delete.success", httpStatus: 200, method: null, at: daysAgo(1) }],
    webhooks: [
      { eventType: "order_submit", signatureVerified: true, rejectionReason: null, responseStatus: 200, at: daysAgo(1) },
      { eventType: "order_cancel", signatureVerified: true, rejectionReason: null, responseStatus: 200, at: daysAgo(1) },
    ],
    outbound: [
      { operation: "fetch_order", requestedStatus: null, disposition: "success", responseStatus: 200, refusalCode: null, at: daysAgo(1) },
      { operation: "acknowledge", requestedStatus: null, disposition: "success", responseStatus: 204, refusalCode: null, at: daysAgo(1) },
      { operation: "status", requestedStatus: "picked_up", disposition: "success", responseStatus: 200, refusalCode: null, at: daysAgo(1) },
    ],
  };
  const fp = assessCertificationProof(full);
  ok(fp.readyToNominate, "all required proven → ready");
  ok(fp.required.proven === 10, "10/10");
  ok(fp.missingRequired.length === 0, "nothing missing");
  ok(fp.headline.startsWith("All 10"), "ready headline");
  ok(rowOf(fp, "lifecycle_canceled").latestSuccess?.source === "webhooks", "canceled proven by the shopper webhook");
  // one regressed required row blocks
  const blocked = assessCertificationProof({
    ...full,
    outbound: [
      ...full.outbound,
      { operation: "acknowledge", requestedStatus: null, disposition: "retry", responseStatus: 500, refusalCode: null, at: daysAgo(0.5) },
    ],
  });
  ok(!blocked.readyToNominate, "a regressed required row blocks nomination");
  ok(blocked.missingRequired.includes(proofActionDef("order_acknowledge").label), "…and is named");
  ok(blocked.headline.includes("9 of 10") === false && blocked.headline.includes("Still to do"), "not-ready headline lists what is left");
  // an expired required row blocks
  const expiredFull = assessCertificationProof({
    ...full,
    syncRuns: [{ ...full.syncRuns[0], at: daysAgo(20) }, full.syncRuns[1]],
  });
  ok(!expiredFull.readyToNominate, "expired required row blocks");
  ok(expiredFull.required.proven === 9, "expired is not counted as proven");
  // optional rows never block
  ok(rowOf(fp, "order_cart_update").state === "none" && fp.readyToNominate, "optional row open does not block");

  // ── labels & tones ───────────────────────────────────────────────────────
  ok(proofStateLabel(rowOf(e0, "menu_post")) === "No record yet", "none label");
  ok(proofStateTone(rowOf(e0, "menu_post")) === "neutral", "none tone");
  ok(proofStateTone(rowOf(fresh, "menu_status")) === "green", "proven tone");
  ok(proofStateTone(rowOf(old, "menu_status")) === "gold", "expired tone");
  ok(proofStateTone(rowOf(fail, "menu_status")) === "danger", "failing tone");
  ok(proofStateLabel(rowOf(old, "menu_status")) === "May have expired", "expired label");
  ok(requirementLabel("required") === "Required" && requirementLabel("optional") === "Optional", "requirement labels");
  ok(describeAge(0) === "today" && describeAge(1) === "1 day ago" && describeAge(5) === "5 days ago", "ages");
  ok(describeAge(null) === "", "no age");
  ok(formatProofWhen("nope") === "unknown time", "bad date formats safely");
  ok(formatProofWhen("2026-09-25T19:00:00.000Z").includes("12:00"), "formatted in Pacific time");

  // ── dates ────────────────────────────────────────────────────────────────
  const fri = zonedYmd(NOW);
  ok(ymdToString(fri) === "2026-09-25", "Pacific date");
  ok(ymdToString(zonedYmd("2026-09-26T05:00:00.000Z")) === "2026-09-25", "late evening UTC is still the 25th in Pacific");
  ok(weekday(fri) === 5, "Friday");
  ok(isBusinessDay(fri) && !isBusinessDay(addDays(fri, 1)) && !isBusinessDay(addDays(fri, 2)), "weekend is not business");
  ok(ymdToString(addBusinessDays(fri, 1)) === "2026-09-28", "Fri + 1 business day = Mon");
  ok(ymdToString(addBusinessDays(fri, 0)) === "2026-09-25", "+0 is identity");
  ok(ymdToString(subtractBusinessDays({ y: 2026, m: 9, d: 28 }, 1)) === "2026-09-25", "Mon - 1 = Fri");
  ok(ymdToString(nextBusinessDayOnOrAfter({ y: 2026, m: 9, d: 26 })) === "2026-09-28", "Sat → Mon");
  ok(ymdToString(addDays({ y: 2026, m: 12, d: 31 }, 1)) === "2027-01-01", "year rollover");
  ok(zonedMidnightUtcIso({ y: 2026, m: 9, d: 25 }) === "2026-09-25T07:00:00.000Z", "PDT midnight is 07:00Z");
  ok(zonedMidnightUtcIso({ y: 2026, m: 12, d: 1 }) === "2026-12-01T08:00:00.000Z", "PST midnight is 08:00Z");
  ok(zonedMidnightUtcIso({ y: 2026, m: 11, d: 1 }) === "2026-11-01T07:00:00.000Z", "DST-change day midnight is still PDT");
  ok(describeYmd(fri) === "Friday, September 25, 2026", "long date");

  // ── window suggestion ────────────────────────────────────────────────────
  const sw = suggestCertificationWindow(NOW);
  ok(ymdToString(sw.start) === "2026-09-25", "Friday: window starts today");
  ok(ymdToString(sw.end) === "2026-09-28", "…and ends Monday (two business days)");
  ok(ymdToString(sw.reviewEarliest) === "2026-09-30", "review ≥ 2 business days after the email");
  ok(ymdToString(sw.logsKeptUntil) === "2026-10-09", "logs kept 14 days from the start");
  ok(Date.UTC(sw.reviewEarliest.y, sw.reviewEarliest.m - 1, sw.reviewEarliest.d) < Date.UTC(sw.logsKeptUntil.y, sw.logsKeptUntil.m - 1, sw.logsKeptUntil.d), "review lands inside log retention");
  ok(sw.steps.length === 5, "five steps");
  ok(sw.caveat.includes("holidays"), "holiday caveat is stated, not hidden");
  const sat2 = suggestCertificationWindow("2026-09-26T19:00:00.000Z");
  ok(ymdToString(sat2.start) === "2026-09-28" && ymdToString(sat2.end) === "2026-09-29", "Saturday → Mon–Tue");
  const wed = suggestCertificationWindow("2026-09-23T19:00:00.000Z");
  ok(ymdToString(wed.start) === "2026-09-23" && ymdToString(wed.end) === "2026-09-24", "Wednesday → Wed–Thu");

  // ── recent window & coverage ─────────────────────────────────────────────
  const rw = recentBusinessWindow(NOW);
  ok(ymdToString(rw.end) === "2026-09-25" && ymdToString(rw.start) === "2026-09-24", "Friday: Thu–Fri");
  ok(rw.fromIso === "2026-09-24T07:00:00.000Z", "from Thursday midnight Pacific");
  const rwSun = recentBusinessWindow("2026-09-27T19:00:00.000Z");
  ok(ymdToString(rwSun.end) === "2026-09-25" && ymdToString(rwSun.start) === "2026-09-24", "Sunday: previous Thu–Fri");
  const cov = assessWindowCoverage(full, rw.fromIso, rw.toIso);
  ok(cov.complete, "fully proven yesterday → window complete");
  ok(cov.proofs.length >= 10, "proofs listed");
  const covOld = assessWindowCoverage({ ...full, syncRuns: [{ ...full.syncRuns[0], at: daysAgo(4) }, full.syncRuns[1]] }, rw.fromIso, rw.toIso);
  ok(!covOld.complete && covOld.missingRequired.includes(proofActionDef("menu_post").label), "proof outside the window does not count");
  const covDirty = assessWindowCoverage(
    {
      ...full,
      outbound: [
        ...full.outbound,
        { operation: "acknowledge", requestedStatus: null, disposition: "retry", responseStatus: 500, refusalCode: null, at: daysAgo(0.5) },
      ],
    },
    rw.fromIso,
    rw.toIso,
  );
  ok(covDirty.missingRequired.includes(proofActionDef("order_acknowledge").label), "an uncorrected failure inside the window disqualifies");
  const covProd = assessWindowCoverage({ ...full, environment: "production", audits: [...full.audits, { action: "leafly.menu.readback", httpStatus: 200, method: null, at: daysAgo(1) }] }, rw.fromIso, rw.toIso);
  ok(!covProd.proofs.some((p) => p.label === proofActionDef("menu_readback").label), "sandbox-only row excluded in production");

  // ── email ────────────────────────────────────────────────────────────────
  const mail = buildCertificationWindowEmail({ coverage: cov, windowStartLabel: "Thursday", windowEndLabel: "Friday" });
  ok(mail.startsWith("Subject: Greenway Marijuana"), "email subject");
  ok(mail.includes("Thursday through Friday (Pacific time)"), "window named");
  ok(mail.includes("POST /{menu_integration_key}/menu/items"), "endpoints listed");
  ok(!mail.includes("Not yet shown"), "complete window lists nothing missing");
  const mail2 = buildCertificationWindowEmail({ coverage: covOld, windowStartLabel: "A", windowEndLabel: "B", storeName: "Test Shop" });
  ok(mail2.includes("Not yet shown") && mail2.includes(proofActionDef("menu_post").label), "missing required named in email");
  ok(mail2.startsWith("Subject: Test Shop"), "store name used");
  const mail3 = buildCertificationWindowEmail({ coverage: assessWindowCoverage(empty(), rw.fromIso, rw.toIso), windowStartLabel: "A", windowEndLabel: "B" });
  ok(mail3.includes("do not yet show any successful requests"), "empty window says so");

  if (failures.length > 0) {
    throw new Error(`leafly-certification-proof-core self-test failed:\n  - ${failures.join("\n  - ")}`);
  }
  return { passed, failed: 0 };
}
