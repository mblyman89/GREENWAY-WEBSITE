/**
 * src/lib/integrations/syndication-playbook.ts  (Task X)
 *
 * PURE single source of truth for the Leafly / Weedmaps connection playbook:
 * connect steps, stay-connected practices, and the verified recovery runbook.
 * Rendered by the Connection Wizard on both channel pages AND injected into
 * the integrations AI helper's grounding so the assistant is "deep-trained"
 * on the same verified facts (docs/LEAFLY_WEEDMAPS_INTEGRATION_RESEARCH.md).
 *
 * Every entry is a VERIFIED fact from the research doc — never invented.
 * No DB, no network, no "server-only" — unit-testable with tsx.
 */

export type SyndicationChannelId = "leafly" | "weedmaps";

export type PlaybookStep = {
  title: string;
  detail: string;
};

export type RunbookEntry = {
  channel: SyndicationChannelId | "both";
  /** What the owner sees (symptom). */
  symptom: string;
  /** What it means (verified). */
  meaning: string;
  /** How to fix it (verified). */
  fix: string;
};

// ---------------------------------------------------------------------------
// GET CONNECTED — verified onboarding steps per channel
// ---------------------------------------------------------------------------

export const LEAFLY_CONNECT_STEPS: PlaybookStep[] = [
  {
    title: "Get your Leafly API credentials",
    detail:
      "Email partners@leafly.com (or your Leafly rep) to enroll in the Menu Integration API v2.0. Leafly issues an OAuth Client ID + Client Secret and a per-environment menu integration key — the SANDBOX key and the PRODUCTION key are different keys.",
  },
  {
    title: "Enter credentials in the back office",
    detail:
      "Integrations → Credentials: set the Leafly environment (start with sandbox), the menu integration key, and the OAuth Client ID + Secret, then Save. Saving sends nothing to Leafly.",
  },
  {
    title: "Preview the exact payload (always safe)",
    detail:
      "On this page, review the payload preview and the Data quality panel. Fix any preflight ERRORS — live pushes are blocked until the feed is clean.",
  },
  {
    title: "Certify in sandbox",
    detail:
      "Run a live POST (full sync) against SANDBOX and verify the menu renders correctly (allow ~2.5 minutes for sandbox latency). Leafly certification reviews data quality: stable ids, integer-cent prices, ≥1 variant per item, null (never \"NA\"/0) for absent strain/cannabinoids, plain-text descriptions.",
  },
  {
    title: "Go to production",
    detail:
      "After Leafly certifies, switch the environment to production, enter the PRODUCTION menu integration key, and push. Allow ~5 minutes for production menu latency.",
  },
];

export const WEEDMAPS_CONNECT_STEPS: PlaybookStep[] = [
  {
    title: "Get API access from Weedmaps",
    detail:
      "Email integrations@weedmaps.com to be onboarded as a menu integration partner. You receive an OAuth Client ID + Client Secret (or a direct access token). Required scopes for menu writes: menu_items and menus:write.",
  },
  {
    title: "Find your Menu ID and get linked to the listing",
    detail:
      "The retailer listing must add you as its menu integrator, and you need the listing's Menu ID from the Weedmaps back office. Without the integrator link the API returns 404 on your menu.",
  },
  {
    title: "Enter credentials in the back office",
    detail:
      "Integrations → Credentials: set the Weedmaps Menu ID and the OAuth Client ID + Secret (or access token), then Save. Saving sends nothing to Weedmaps.",
  },
  {
    title: "Verify menu access",
    detail:
      "Click 'Verify menu access' on this page — it calls GET /menus/{menu_id}: 200 = access, 404 = no access/wrong id, 423 = the listing paused the integration.",
  },
  {
    title: "Preview, fix data quality, then sync",
    detail:
      "Review the payload preview and Data quality panel; fix preflight ERRORS (they block live syncs). The live sync writes one item at a time (PUT by external_id) paced under Weedmaps' 420-requests/10-seconds limit.",
  },
];

// ---------------------------------------------------------------------------
// STAY CONNECTED — verified operating practices
// ---------------------------------------------------------------------------

export const STAY_CONNECTED_PRACTICES: { channel: SyndicationChannelId | "both"; practice: string }[] = [
  {
    channel: "both",
    practice:
      "Sync after menu publishes so third-party menus never drift from the store. Nothing syncs automatically — every live push is owner-confirmed.",
  },
  {
    channel: "both",
    practice:
      "Keep ids stable forever: items are keyed by the POS product key. Never re-key products — id churn destroys curated Weedmaps data and fails Leafly certification.",
  },
  {
    channel: "both",
    practice:
      "Watch the Connection health panel: 1 failure = degraded, 3 consecutive = down, and no successful sync in 48h = stale. Investigate degraded before it becomes down.",
  },
  {
    channel: "leafly",
    practice:
      "Leafly's recommended cadence: a POST full sync at least daily (it also removes items that left the menu), PUT upserts for incremental updates in between. The engine skips the entire request when nothing changed.",
  },
  {
    channel: "weedmaps",
    practice:
      "Weedmaps tokens live 14 days and /auth/token allows 1 request/minute — the engine caches and reuses the token automatically; you never need to touch it.",
  },
  {
    channel: "weedmaps",
    practice:
      "Out-of-stock items are unpublished (hidden), never deleted, so Weedmaps-side curation survives restocks. This is tunable in Transmission parameters.",
  },
  {
    channel: "both",
    practice:
      "Use the Data quality panel to push richness toward 100% — brand, strain, THC/CBD, description, and (Weedmaps) exact product photos drive ranking and conversion on both platforms.",
  },
];

// ---------------------------------------------------------------------------
// GET RECONNECTED — verified recovery runbook (symptom → meaning → fix)
// ---------------------------------------------------------------------------

export const RECOVERY_RUNBOOK: RunbookEntry[] = [
  {
    channel: "leafly",
    symptom: "Leafly 403 Forbidden",
    meaning: "Invalid or missing menu integration key for this environment.",
    fix: "Re-copy the key from your Leafly business portal into Integrations → Credentials and save. Remember sandbox and production keys are different.",
  },
  {
    channel: "leafly",
    symptom: "Leafly 404 Not Found",
    meaning: "The menu integration key is not recognized — usually an environment mismatch (sandbox key against production, or vice versa).",
    fix: "Check the environment toggle matches the key you entered, then re-verify with 'Check integration status'.",
  },
  {
    channel: "leafly",
    symptom: "Leafly token request fails",
    meaning: "Bad OAuth Client ID/Secret, or the wrong environment token URL (sso-sandbox vs sso).",
    fix: "Re-enter the OAuth pair in Credentials and confirm the environment; the token URL follows the environment automatically.",
  },
  {
    channel: "weedmaps",
    symptom: "Weedmaps 401 Unauthorized",
    meaning: "Access token missing, invalid, or expired.",
    fix: "The engine clears its token cache and retries once automatically. If it persists, re-check the Client ID/Secret (or refresh the direct access token) in Credentials.",
  },
  {
    channel: "weedmaps",
    symptom: "Weedmaps 403 Forbidden",
    meaning: "The token is missing a required scope (menu_items / menus:write) — you are not guaranteed every scope you request — or the listing hasn't authorized you.",
    fix: "The engine surfaces the granted scope. Ask integrations@weedmaps.com to grant the menu scopes and confirm the listing added you as its integrator.",
  },
  {
    channel: "weedmaps",
    symptom: "Weedmaps 404 on the menu",
    meaning: "Wrong Menu ID, or the listing has not linked you as its menu integrator.",
    fix: "Verify the Menu ID in the Weedmaps back office and confirm the integrator link, then click 'Verify menu access'.",
  },
  {
    channel: "weedmaps",
    symptom: "Weedmaps 423 Locked",
    meaning: "The RETAILER paused the integration from the listing settings. All writes are blocked; nothing is wrong code-side.",
    fix: "Unpause the integration in the Weedmaps listing settings, then re-run the sync.",
  },
  {
    channel: "weedmaps",
    symptom: "Weedmaps 422 Unprocessable",
    meaning: "Payload validation failed — prohibited terms in name/description, the one-root-category rule, or an unsupported image (must be https JPG/PNG whose host answers HEAD with 200).",
    fix: "Read errors[].detail in the per-item results, fix the flagged product data, and re-sync — only failed items are retried.",
  },
  {
    channel: "both",
    symptom: "429 Too Many Requests",
    meaning: "Rate limited (Weedmaps enforces 420 requests/10s globally).",
    fix: "The engine backs off exponentially and retries automatically. If it persists, raise the pacing delay in Transmission parameters.",
  },
  {
    channel: "both",
    symptom: "Sustained 5xx errors",
    meaning: "A platform-side incident at Leafly/Weedmaps.",
    fix: "The engine retries with backoff; failed items auto-retry on the next sync. If sustained, contact api-support@leafly.com or integrations@weedmaps.com.",
  },
  {
    channel: "both",
    symptom: "Third-party menu looks out of sync with the store",
    meaning: "A partial failure or missed sync left stale items on the platform.",
    fix: "Use 'Resend everything next sync' (reset sync state) in Transmission parameters, then run a live sync — every item is retransmitted.",
  },
];

export const SYNDICATION_CONTACTS = [
  "Leafly production/certification: partners@leafly.com",
  "Leafly technical support: api-support@leafly.com",
  "Weedmaps integrations: integrations@weedmaps.com",
] as const;

/** Runbook rows relevant to one channel (channel-specific + shared). */
export function runbookFor(channel: SyndicationChannelId): RunbookEntry[] {
  return RECOVERY_RUNBOOK.filter((r) => r.channel === channel || r.channel === "both");
}

/** Stay-connected practices relevant to one channel. */
export function practicesFor(channel: SyndicationChannelId): string[] {
  return STAY_CONNECTED_PRACTICES.filter((p) => p.channel === channel || p.channel === "both").map(
    (p) => p.practice,
  );
}

/**
 * Grounding block for the integrations AI helper — the "deep training" on the
 * verified Leafly v2 / Weedmaps 2025-07 facts. Injected alongside the setup
 * guides so the assistant can walk the owner through connecting, staying
 * connected, and reconnecting without inventing anything.
 */
export function syndicationPlaybookBlock(): string {
  const lines: string[] = [
    "MENU SYNDICATION PLAYBOOK (verified against the Leafly Menu API v2.0 docs and the live Weedmaps 2025-07 OpenAPI — treat as the source of truth):",
    "",
    "## Leafly — get connected",
    ...LEAFLY_CONNECT_STEPS.map((s, i) => `${i + 1}. ${s.title}: ${s.detail}`),
    "",
    "## Weedmaps — get connected",
    ...WEEDMAPS_CONNECT_STEPS.map((s, i) => `${i + 1}. ${s.title}: ${s.detail}`),
    "",
    "## Stay connected",
    ...STAY_CONNECTED_PRACTICES.map((p) => `- [${p.channel}] ${p.practice}`),
    "",
    "## Recovery runbook (symptom → meaning → fix)",
    ...RECOVERY_RUNBOOK.map((r) => `- [${r.channel}] ${r.symptom}: ${r.meaning} FIX: ${r.fix}`),
    "",
    "## Key engine facts",
    "- Live syncs are owner-confirmed only; previews are always safe and never contact the platforms.",
    "- Preflight ERRORS (duplicate ids, missing names, non-positive prices) BLOCK live pushes until fixed; warnings never block.",
    "- The engine only sends items that changed since the last successful sync ('skipped — no changes'); 'Resend everything next sync' forces a full retransmit once.",
    "- Weedmaps has NO bulk endpoint: a live sync is one PUT per item by stable external_id, paced (default 150ms) under the 420-requests/10s limit, with explicit per-item DELETEs for items that left the menu.",
    "- Leafly POST = full sync (deletes omitted items, so the full menu is always sent); PUT = upsert only, with explicit DELETE {ids} for removed items. Prices are integer cents; inventoryLevel is a real stock quantity; absent strain/cannabinoids are null, never 'NA' or 0.",
    "- Transmission parameters (Integrations → channel page) let the owner tune pacing (0–5000ms), retries (0–5), and which enrichment fields transmit (descriptions, cannabinoids, images, strains).",
    `- Contacts: ${SYNDICATION_CONTACTS.join(" · ")}`,
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
export function __runSyndicationPlaybookTests(): void {
  let passed = 0;
  let failed = 0;
  const ok = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL: ${label}`);
    }
  };

  ok("leafly connect steps present", LEAFLY_CONNECT_STEPS.length === 5);
  ok("weedmaps connect steps present", WEEDMAPS_CONNECT_STEPS.length === 5);
  ok(
    "leafly steps mention per-environment keys",
    LEAFLY_CONNECT_STEPS.some((s) => s.detail.includes("SANDBOX key") || s.detail.includes("environment")),
  );
  ok(
    "weedmaps steps mention required scopes",
    WEEDMAPS_CONNECT_STEPS.some((s) => s.detail.includes("menu_items") && s.detail.includes("menus:write")),
  );

  // Runbook filtering: channel-specific + shared rows only.
  const leaflyRun = runbookFor("leafly");
  ok("leafly runbook has leafly + both rows", leaflyRun.every((r) => r.channel !== "weedmaps"));
  ok("leafly runbook includes 403", leaflyRun.some((r) => r.symptom.includes("403")));
  const wmRun = runbookFor("weedmaps");
  ok("wm runbook has no leafly rows", wmRun.every((r) => r.channel !== "leafly"));
  ok("wm runbook includes 423 paused", wmRun.some((r) => r.symptom.includes("423")));
  ok("both runbooks share the 429 row", leaflyRun.some((r) => r.symptom.includes("429")) && wmRun.some((r) => r.symptom.includes("429")));

  const leaflyPractices = practicesFor("leafly");
  ok("leafly practices exclude wm-only", leaflyPractices.every((p) => !p.includes("14 days")));
  ok("leafly practices include cadence", leaflyPractices.some((p) => p.includes("POST full sync")));

  // Grounding block carries the critical verified facts.
  const block = syndicationPlaybookBlock();
  ok("block mentions no-bulk-endpoint", block.includes("NO bulk endpoint"));
  ok("block mentions 420/10s limit", block.includes("420"));
  ok("block mentions integer cents", block.includes("integer cents"));
  ok("block mentions never 'NA'", block.includes("never 'NA'"));
  ok("block includes contacts", block.includes("api-support@leafly.com") && block.includes("integrations@weedmaps.com"));
  ok("block mentions preflight blocking", block.includes("BLOCK live pushes"));
  ok("block mentions owner confirmation", block.includes("owner-confirmed"));

  console.log(`syndication-playbook: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} syndication-playbook test(s) failed`);
}
