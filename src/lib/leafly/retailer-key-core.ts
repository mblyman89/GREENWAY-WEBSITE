/**
 * src/lib/leafly/retailer-key-core.ts  (SLICE L-45)
 * =========================================================================
 * Which key identifies THIS store to Leafly's Order API, and does every
 * webhook Leafly sends us actually carry it?
 *
 * ── WHAT LEAFLY TOLD US (Ben, item 2, recorded in
 *    docs/leafly-ben-email-integration-round.md) ─────────────────────────────
 *
 *   "`orderIntegrationKey` is the SAME VALUE as the Dispensary Menu Key we
 *    already hold. It is one per-retailer key, and that same key appears in
 *    the `orderIntegrationKey` field on every webhook."
 *
 * ── THE TWO BUGS THIS FILE EXISTS TO FIX (both verified in code) ──────────
 *
 * 1. `loadLeaflyOrderIntegrationKey()` read ONLY the "Order integration key"
 *    box. With that box blank, every caller - collecting the order's
 *    contents, acknowledging it, pushing its status - refused with "fix your
 *    credentials", even though the Menu key (the SAME value, per Leafly) was
 *    saved and working for menu sync. The owner's own screenshot of the
 *    credentials page showed exactly that state: ORDER INTEGRATION KEY - NOT
 *    SET. A blank box must therefore fall back to the Menu key.
 *
 * 2. The `orderIntegrationKey` inside each webhook body was stored but never
 *    compared with ours, so a typo in either box could not be detected from
 *    the one source of truth we have: what Leafly itself sends.
 *
 * ── WHY A MISMATCH IS REPORTED, NEVER USED TO DROP AN ORDER ──────────────
 *
 * The roadmap first proposed "on a mismatch, answer 2xx and do not create the
 * order". That was reconsidered against the facts, and rejected:
 *
 *   - Greenway is BOTH the integrator AND its only retailer. The HMAC key is
 *     per-integrator (spec: "The OAuth2 credentials and HMAC key are unique to
 *     each integrator"), so a delivery whose signature verified came from
 *     Leafly, for one of OUR retailers - and there is exactly one.
 *   - A mismatch can therefore only mean OUR saved key is wrong (a typo, a
 *     stale value), never "an order for somebody else's store".
 *   - Dropping the order would turn our own typo into a silently lost,
 *     auto-cancelled customer order - the one outcome the whole integration
 *     is built to prevent. Leafly's spec also says webhook events "are not the
 *     place to apply business rules or validations".
 *
 * So the rule is: ALWAYS process a verified delivery, and make any mismatch
 * loud - in the server log for that delivery, and on the setup panel, with a
 * plain-English instruction naming which box to fix. `WEBHOOK_KEY_CHECK_ACTION`
 * is a constant precisely so that a future "just drop mismatches" change has
 * to edit (and fail) a pinned value rather than slip in quietly.
 *
 * ── WHY THE ORDER BOX STILL WINS WHEN BOTH ARE FILLED ─────────────────────
 *
 * If both boxes are filled and differ, one of them is wrong and this code
 * cannot know which. Switching to the Menu key would silently change the
 * behaviour of a configuration that may be working today. So the explicit
 * Order box keeps priority (no behaviour change for anyone who filled it),
 * the disagreement is reported, and the webhook evidence - what Leafly
 * actually sends - is what tells the owner which box is wrong.
 *
 * PURITY: one import (the constant-time comparer, itself pure). No I/O, no
 * clock, no environment.
 */

import { timingSafeStringEqual } from "./hmac-core";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Where Leafly's answer came from. Quoted so tests can pin it. */
export const LEAFLY_RETAILER_KEY_SOURCE =
  "Ben (Leafly), item 2: orderIntegrationKey is the same value as the Dispensary Menu Key.";

/**
 * What the webhook handler does with a verified delivery, whatever the key
 * check says. See the file header for why this is "process" and not "drop".
 */
export const WEBHOOK_KEY_CHECK_ACTION = "process" as const;

export const RETAILER_KEY_SOURCES = ["order_key", "menu_key", "none"] as const;
export type RetailerKeySource = (typeof RETAILER_KEY_SOURCES)[number];

/**
 * How the two saved boxes relate to each other.
 *   same       both filled, identical (what Leafly says they should be)
 *   different  both filled, NOT identical - one of them is wrong
 *   order_only only the Order box is filled
 *   menu_only  only the Menu box is filled (we use it for orders too)
 *   neither    nothing saved
 */
export const RETAILER_KEY_AGREEMENTS = [
  "same",
  "different",
  "order_only",
  "menu_only",
  "neither",
] as const;
export type RetailerKeyAgreement = (typeof RETAILER_KEY_AGREEMENTS)[number];

/**
 * The per-delivery comparison result.
 *   match           the body's key equals the key we use
 *   match_other_box the body's key equals the box we are NOT using (only
 *                   possible when the boxes differ) - tells the owner which
 *                   box is wrong
 *   mismatch        the body's key equals neither saved box
 *   body_missing    the body carried no orderIntegrationKey
 *   not_configured  we have no key saved at all, so nothing to compare
 */
export const WEBHOOK_KEY_OUTCOMES = [
  "match",
  "match_other_box",
  "mismatch",
  "body_missing",
  "not_configured",
] as const;
export type WebhookKeyOutcome = (typeof WEBHOOK_KEY_OUTCOMES)[number];

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Trim; blank becomes null. NOT case-folded: nothing in Leafly's spec or in
 * Ben's answer says the key is case-insensitive, so two keys that differ only
 * in case are treated as different. Guessing the other way could hide a real
 * typo.
 */
export function normalizeRetailerKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v === "" ? null : v;
}

function sameKey(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  return timingSafeStringEqual(a, b);
}

// ---------------------------------------------------------------------------
// 1. Resolve the key we use
// ---------------------------------------------------------------------------

export type ResolvedRetailerKey = {
  /** The key to use for the Order API, or null when neither box is filled. */
  key: string | null;
  source: RetailerKeySource;
  agreement: RetailerKeyAgreement;
};

export function resolveLeaflyRetailerKey(input: {
  orderKey: unknown;
  menuKey: unknown;
}): ResolvedRetailerKey {
  const order = normalizeRetailerKey(input.orderKey);
  const menu = normalizeRetailerKey(input.menuKey);

  let agreement: RetailerKeyAgreement;
  if (order !== null && menu !== null) agreement = sameKey(order, menu) ? "same" : "different";
  else if (order !== null) agreement = "order_only";
  else if (menu !== null) agreement = "menu_only";
  else agreement = "neither";

  if (order !== null) return { key: order, source: "order_key", agreement };
  if (menu !== null) return { key: menu, source: "menu_key", agreement };
  return { key: null, source: "none", agreement };
}

// ---------------------------------------------------------------------------
// 2. Check one webhook body
// ---------------------------------------------------------------------------

export type WebhookKeyCheck = {
  outcome: WebhookKeyOutcome;
  /** Always "process". Pinned; see the file header. */
  action: typeof WEBHOOK_KEY_CHECK_ACTION;
  /** True when the owner should be told something is wrong. */
  alarm: boolean;
  /** One line for the server log. Never contains either key's value. */
  note: string;
};

export function checkWebhookRetailerKey(input: {
  bodyKey: unknown;
  orderKey: unknown;
  menuKey: unknown;
}): WebhookKeyCheck {
  const body = normalizeRetailerKey(input.bodyKey);
  const resolved = resolveLeaflyRetailerKey({ orderKey: input.orderKey, menuKey: input.menuKey });
  const order = normalizeRetailerKey(input.orderKey);
  const menu = normalizeRetailerKey(input.menuKey);

  const make = (outcome: WebhookKeyOutcome, alarm: boolean, note: string): WebhookKeyCheck => ({
    outcome,
    action: WEBHOOK_KEY_CHECK_ACTION,
    alarm,
    note,
  });

  if (resolved.key === null) {
    return make(
      "not_configured",
      false,
      "retailer key: none saved here, so the webhook's orderIntegrationKey was not compared",
    );
  }
  if (body === null) {
    return make(
      "body_missing",
      true,
      "retailer key: Leafly's delivery carried no orderIntegrationKey (Leafly marks it required); processed anyway",
    );
  }
  if (sameKey(body, resolved.key)) {
    return make("match", false, `retailer key: matches the saved ${label(resolved.source)}`);
  }
  // The key we use did not match. Does the OTHER box match? Only possible when
  // both are filled and different.
  const other = resolved.source === "order_key" ? menu : order;
  if (sameKey(body, other)) {
    return make(
      "match_other_box",
      true,
      `retailer key: Leafly sent the value in your ${label(
        resolved.source === "order_key" ? "menu_key" : "order_key",
      )} box, NOT the ${label(resolved.source)} we use - fix the ${label(resolved.source)} box; processed anyway`,
    );
  }
  return make(
    "mismatch",
    true,
    "retailer key: Leafly sent an orderIntegrationKey that matches NEITHER saved key - re-copy it from Leafly; processed anyway",
  );
}

function label(source: RetailerKeySource): string {
  if (source === "order_key") return "Order integration key";
  if (source === "menu_key") return "Menu integration key";
  return "key";
}

// ---------------------------------------------------------------------------
// 3. Summarise the evidence across recent deliveries
// ---------------------------------------------------------------------------

export type RetailerKeyEvidenceRow = {
  signatureVerified: boolean | null;
  orderIntegrationKey: string | null;
};

export const RETAILER_KEY_VERDICTS = [
  "no_evidence",
  "all_match",
  "fix_order_box",
  "fix_menu_box",
  "mismatch",
  "not_configured",
] as const;
export type RetailerKeyVerdict = (typeof RETAILER_KEY_VERDICTS)[number];

export type RetailerKeyEvidence = {
  verdict: RetailerKeyVerdict;
  /** Verified deliveries that carried a key and were compared. */
  compared: number;
  counts: Record<WebhookKeyOutcome, number>;
  /** True when the panel should show a warning. */
  warn: boolean;
  headline: string;
  detail: string;
};

/**
 * Only VERIFIED rows count. An unverified body is untrusted - anybody can
 * type any key into a request - so letting it drive advice would let a
 * stranger tell the owner to change a working credential.
 */
export function summarizeRetailerKeyEvidence(input: {
  rows: readonly RetailerKeyEvidenceRow[];
  orderKey: unknown;
  menuKey: unknown;
}): RetailerKeyEvidence {
  const counts: Record<WebhookKeyOutcome, number> = {
    match: 0,
    match_other_box: 0,
    mismatch: 0,
    body_missing: 0,
    not_configured: 0,
  };
  const resolved = resolveLeaflyRetailerKey({ orderKey: input.orderKey, menuKey: input.menuKey });
  let compared = 0;
  for (const row of input.rows) {
    if (row.signatureVerified !== true) continue;
    const c = checkWebhookRetailerKey({
      bodyKey: row.orderIntegrationKey,
      orderKey: input.orderKey,
      menuKey: input.menuKey,
    });
    counts[c.outcome] += 1;
    if (c.outcome !== "body_missing" && c.outcome !== "not_configured") compared += 1;
  }

  const base = { compared, counts };

  if (resolved.key === null) {
    return {
      ...base,
      verdict: "not_configured",
      warn: false,
      headline: "No store key saved yet",
      detail:
        "Neither the Menu integration key nor the Order integration key is saved, so there is " +
        "nothing to compare Leafly's deliveries against. Leafly uses your Menu integration key " +
        "for orders too.",
    };
  }
  if (compared === 0) {
    return {
      ...base,
      verdict: "no_evidence",
      warn: false,
      headline: "Not checked yet",
      detail:
        "No verified Leafly delivery has carried a store key yet, so there is nothing to compare. " +
        "This checks itself the moment the first order or cart preview arrives.",
    };
  }
  if (counts.mismatch > 0) {
    return {
      ...base,
      verdict: "mismatch",
      warn: true,
      headline: "Leafly is sending a store key that matches neither saved key",
      detail:
        `${counts.mismatch} of the last ${compared} checked deliveries carried a store key that ` +
        "matches neither your Menu integration key nor your Order integration key. The orders " +
        "were still received, but collecting and accepting them may fail. Re-copy your Menu " +
        "integration key from Leafly, character for character, and leave the Order integration " +
        "key box blank (Leafly uses the same value for both).",
    };
  }
  if (counts.match_other_box > 0) {
    const wrongBox = resolved.source === "order_key" ? "fix_order_box" : "fix_menu_box";
    return {
      ...base,
      verdict: wrongBox,
      warn: true,
      headline:
        wrongBox === "fix_order_box"
          ? "Your Order integration key box holds the wrong value"
          : "Your Menu integration key box holds the wrong value",
      detail:
        wrongBox === "fix_order_box"
          ? `${counts.match_other_box} of the last ${compared} checked deliveries carried your ` +
            "MENU integration key, which is what Leafly uses for orders. The Order integration key " +
            "box holds something different, and it is the one used to collect and accept orders. " +
            "Clear the Order integration key box (blank means \u201cuse the Menu key\u201d) or paste " +
            "the Menu key into it."
          : `${counts.match_other_box} of the last ${compared} checked deliveries carried the value ` +
            "in your Order integration key box, but your Menu integration key box holds something " +
            "different. Leafly says the two are the same value. Check the Menu integration key " +
            "against Leafly's email.",
    };
  }
  return {
    ...base,
    verdict: "all_match",
    warn: false,
    headline: "Leafly's deliveries carry your store key",
    detail:
      `All ${compared} checked deliveries carried the store key saved here, which is what Leafly ` +
      "confirmed it would send.",
  };
}

// ---------------------------------------------------------------------------
// 4. Plain-English copy for the credentials page
// ---------------------------------------------------------------------------

export function describeRetailerKeyAgreement(agreement: RetailerKeyAgreement): {
  tone: "good" | "warn" | "info";
  text: string;
} {
  switch (agreement) {
    case "same":
      return {
        tone: "good",
        text: "Both boxes hold the same value, which is what Leafly confirmed.",
      };
    case "menu_only":
      return {
        tone: "good",
        text:
          "The Order box is blank, so your Menu integration key is used for orders too. That is " +
          "correct: Leafly confirmed they are the same value.",
      };
    case "order_only":
      return {
        tone: "warn",
        text:
          "Only the Order box is filled. Leafly uses the same value as your Menu integration key, " +
          "so menu sync still needs the Menu integration key box filled in too.",
      };
    case "different":
      return {
        tone: "warn",
        text:
          "The two boxes hold DIFFERENT values, but Leafly confirmed they are the same key. The " +
          "Order box is the one used for orders. Unless Leafly told you otherwise, clear the " +
          "Order box so the Menu key is used for both.",
      };
    default:
      return {
        tone: "info",
        text: "Nothing saved yet. Paste your Menu integration key; it is used for orders too.",
      };
  }
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runLeaflyRetailerKeyTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  FAIL leafly-retailer-key-core: ${msg}`);
    }
  };

  // ── constants ──
  ok(WEBHOOK_KEY_CHECK_ACTION === "process", "a verified delivery is always processed");
  ok(LEAFLY_RETAILER_KEY_SOURCE.includes("Ben"), "source cites Ben");
  ok(LEAFLY_RETAILER_KEY_SOURCE.includes("same value"), "source quotes the answer");
  ok(WEBHOOK_KEY_OUTCOMES.length === 5, "five outcomes");
  ok(RETAILER_KEY_AGREEMENTS.length === 5, "five agreements");

  // ── normalise ──
  ok(normalizeRetailerKey("  abc ") === "abc", "trims");
  ok(normalizeRetailerKey("") === null, "blank is null");
  ok(normalizeRetailerKey("   ") === null, "whitespace is null");
  ok(normalizeRetailerKey(undefined) === null, "undefined is null");
  ok(normalizeRetailerKey(42) === null, "non-string is null");
  ok(normalizeRetailerKey("ABC") === "ABC", "not case-folded");

  // ── resolve ──
  const r1 = resolveLeaflyRetailerKey({ orderKey: "", menuKey: "MENU-1" });
  ok(r1.key === "MENU-1", "BUG 1 FIX: blank order box falls back to the menu key");
  ok(r1.source === "menu_key", "and says so");
  ok(r1.agreement === "menu_only", "agreement menu_only");
  const r2 = resolveLeaflyRetailerKey({ orderKey: "ORD", menuKey: "MENU-1" });
  ok(r2.key === "ORD", "a filled order box keeps priority");
  ok(r2.source === "order_key", "source order_key");
  ok(r2.agreement === "different", "different flagged");
  const r3 = resolveLeaflyRetailerKey({ orderKey: " K ", menuKey: "K" });
  ok(r3.agreement === "same" && r3.key === "K", "same after trimming");
  const r4 = resolveLeaflyRetailerKey({ orderKey: "K", menuKey: undefined });
  ok(r4.agreement === "order_only" && r4.key === "K", "order only");
  const r5 = resolveLeaflyRetailerKey({ orderKey: null, menuKey: "  " });
  ok(r5.key === null && r5.source === "none" && r5.agreement === "neither", "neither");
  ok(
    resolveLeaflyRetailerKey({ orderKey: "k", menuKey: "K" }).agreement === "different",
    "case difference is a difference",
  );

  // ── check one body ──
  const m = checkWebhookRetailerKey({ bodyKey: "MENU-1", orderKey: "", menuKey: "MENU-1" });
  ok(m.outcome === "match" && !m.alarm, "body = menu key (order blank) is a match");
  ok(m.action === "process", "match processes");
  const m2 = checkWebhookRetailerKey({ bodyKey: " K ", orderKey: "K", menuKey: "K" });
  ok(m2.outcome === "match", "trimmed body matches");
  const ob = checkWebhookRetailerKey({ bodyKey: "MENU-1", orderKey: "TYPO", menuKey: "MENU-1" });
  ok(ob.outcome === "match_other_box", "body = menu while order box differs");
  ok(ob.alarm, "that alarms");
  ok(ob.action === "process", "and STILL processes");
  ok(ob.note.includes("fix the Order integration key box"), "and names the box to fix");
  const mb = checkWebhookRetailerKey({ bodyKey: "ORD", orderKey: "ORD", menuKey: "OTHER" });
  ok(mb.outcome === "match", "body = order key we use is a match even if menu differs");
  const mm = checkWebhookRetailerKey({ bodyKey: "ZZZ", orderKey: "ORD", menuKey: "MENU" });
  ok(mm.outcome === "mismatch" && mm.alarm && mm.action === "process", "neither -> mismatch, processed");
  const mmOne = checkWebhookRetailerKey({ bodyKey: "ZZZ", orderKey: "", menuKey: "MENU" });
  ok(mmOne.outcome === "mismatch", "single key mismatch");
  const bm = checkWebhookRetailerKey({ bodyKey: "", orderKey: "K", menuKey: "K" });
  ok(bm.outcome === "body_missing" && bm.alarm && bm.action === "process", "missing body key");
  const nc = checkWebhookRetailerKey({ bodyKey: "X", orderKey: "", menuKey: "" });
  ok(nc.outcome === "not_configured" && !nc.alarm, "nothing saved -> not_configured, no alarm");
  const caseDiff = checkWebhookRetailerKey({ bodyKey: "menu-1", orderKey: "", menuKey: "MENU-1" });
  ok(caseDiff.outcome === "mismatch", "case difference is not a match");
  const prefix = checkWebhookRetailerKey({ bodyKey: "MENU", orderKey: "", menuKey: "MENU-1" });
  ok(prefix.outcome === "mismatch", "a prefix is not a match");
  const longer = checkWebhookRetailerKey({ bodyKey: "MENU-12", orderKey: "", menuKey: "MENU-1" });
  ok(longer.outcome === "mismatch", "a longer key is not a match");
  // Notes never leak key values.
  for (const c of [m, ob, mm, bm, nc, mb]) {
    ok(!/MENU-1|TYPO|ZZZ|ORD\b|OTHER/.test(c.note), `note leaks no key value (${c.outcome})`);
  }
  // Every outcome processes, exhaustively over a grid.
  const vals = ["", "A", "B", " A "];
  let allProcess = true;
  for (const b of vals) for (const o of vals) for (const mk of vals) {
    const c = checkWebhookRetailerKey({ bodyKey: b, orderKey: o, menuKey: mk });
    if (c.action !== "process") allProcess = false;
    if (!(WEBHOOK_KEY_OUTCOMES as readonly string[]).includes(c.outcome)) allProcess = false;
    if (c.note.trim() === "") allProcess = false;
  }
  ok(allProcess, "grid: every combination processes, has a known outcome and a note");

  // ── evidence ──
  const ev = (verified: boolean | null, key: string | null): RetailerKeyEvidenceRow => ({
    signatureVerified: verified,
    orderIntegrationKey: key,
  });
  const e0 = summarizeRetailerKeyEvidence({ rows: [], orderKey: "", menuKey: "K" });
  ok(e0.verdict === "no_evidence" && !e0.warn, "no rows -> no_evidence");
  const eNc = summarizeRetailerKeyEvidence({ rows: [ev(true, "K")], orderKey: "", menuKey: "" });
  ok(eNc.verdict === "not_configured" && !eNc.warn, "no keys -> not_configured");
  const eAll = summarizeRetailerKeyEvidence({
    rows: [ev(true, "K"), ev(true, "K"), ev(false, "EVIL")],
    orderKey: "",
    menuKey: "K",
  });
  ok(eAll.verdict === "all_match" && !eAll.warn, "all verified match");
  ok(eAll.compared === 2, "unverified rows are ignored");
  ok(eAll.detail.includes("All 2"), "detail counts");
  const eUnv = summarizeRetailerKeyEvidence({
    rows: [ev(false, "EVIL"), ev(null, "EVIL")],
    orderKey: "",
    menuKey: "K",
  });
  ok(eUnv.verdict === "no_evidence", "a stranger's unverified key cannot trigger advice");
  const eFixOrder = summarizeRetailerKeyEvidence({
    rows: [ev(true, "MENU"), ev(true, "MENU")],
    orderKey: "TYPO",
    menuKey: "MENU",
  });
  ok(eFixOrder.verdict === "fix_order_box" && eFixOrder.warn, "fix the order box");
  ok(eFixOrder.detail.includes("Clear the Order integration key box"), "tells how");
  const eFixMenu = summarizeRetailerKeyEvidence({
    rows: [ev(true, "ORD")],
    orderKey: "ORD",
    menuKey: "WRONG",
  });
  ok(eFixMenu.verdict === "all_match", "body = order key in use is healthy for orders");
  const eFixMenu2 = summarizeRetailerKeyEvidence({
    rows: [ev(true, "ORD2")],
    orderKey: "",
    menuKey: "ORD2",
  });
  ok(eFixMenu2.verdict === "all_match", "menu-only healthy");
  const eMis = summarizeRetailerKeyEvidence({
    rows: [ev(true, "MENU"), ev(true, "ZZZ")],
    orderKey: "",
    menuKey: "MENU",
  });
  ok(eMis.verdict === "mismatch" && eMis.warn, "any mismatch warns");
  ok(eMis.detail.includes("1 of the last 2"), "mismatch detail counts");
  ok(eMis.counts.match === 1 && eMis.counts.mismatch === 1, "counts split");
  const eMissing = summarizeRetailerKeyEvidence({
    rows: [ev(true, null), ev(true, "")],
    orderKey: "",
    menuKey: "K",
  });
  ok(eMissing.verdict === "no_evidence" && eMissing.counts.body_missing === 2, "missing keys are not compared");
  // Mismatch outranks match_other_box.
  const eBoth = summarizeRetailerKeyEvidence({
    rows: [ev(true, "MENU"), ev(true, "ZZZ")],
    orderKey: "TYPO",
    menuKey: "MENU",
  });
  ok(eBoth.verdict === "mismatch", "a total mismatch outranks the wrong-box diagnosis");
  for (const e of [e0, eNc, eAll, eFixOrder, eMis, eMissing]) {
    ok(e.headline.trim() !== "" && e.detail.trim() !== "", `evidence ${e.verdict} has copy`);
    ok(!/TYPO|ZZZ|EVIL/.test(e.detail + e.headline), `evidence ${e.verdict} leaks no key`);
  }
  // fix_menu_box branch: using menu key (order blank) can't produce other-box
  // match; reachable only when order box used and body = menu... covered above.
  // Construct it directly: order box used, body equals menu -> fix_order_box.
  // fix_menu_box arises when the MENU key is in use and the body equals the
  // order box - impossible because a filled order box always wins. Pinned so a
  // priority flip is caught:
  const flip = resolveLeaflyRetailerKey({ orderKey: "A", menuKey: "B" });
  ok(flip.source === "order_key", "priority: the order box wins when both are filled");

  // ── agreement copy ──
  for (const a of RETAILER_KEY_AGREEMENTS) {
    const d = describeRetailerKeyAgreement(a);
    ok(d.text.trim().length > 20, `agreement ${a} has copy`);
  }
  ok(describeRetailerKeyAgreement("different").tone === "warn", "different warns");
  ok(describeRetailerKeyAgreement("menu_only").tone === "good", "menu_only is good");
  ok(describeRetailerKeyAgreement("same").tone === "good", "same is good");
  ok(describeRetailerKeyAgreement("order_only").tone === "warn", "order_only warns (menu sync)");
  ok(describeRetailerKeyAgreement("menu_only").text.includes("same value"), "menu_only cites Leafly");

  return { passed, failed };
}
