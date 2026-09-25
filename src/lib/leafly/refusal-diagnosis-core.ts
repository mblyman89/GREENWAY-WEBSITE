/**
 * src/lib/leafly/refusal-diagnosis-core.ts
 *
 * SLICE L-16 — "SIX DELIVERIES REFUSED" IS NOT A DIAGNOSIS.
 *
 * ===========================================================================
 * WHAT THE OWNER SAW, AND WHY IT WAS NOT ENOUGH
 * ===========================================================================
 * The L-15 setup panel did its job: it caught Leafly reaching us and being
 * turned away, and it said so on screen. But what it said was:
 *
 *   > "Deliveries we refused: 6 — Leafly is reaching us but the signature
 *   >  didn't match. That almost always means the webhook HMAC key here
 *   >  doesn't match the one Leafly issued."
 *
 * That sentence contains a GUESS, and the guess is wrong often enough to
 * matter. "The signature didn't match" is only ONE of the reasons a delivery
 * gets refused. `hmac-core.ts` distinguishes seven, and they have completely
 * different owners and completely different fixes:
 *
 *   missing_header     → a request WITH A BODY carried no X-Leafly-Signature.
 *                        Leafly signs every delivery that has a body, so this
 *                        is almost never Leafly. It is a probe, a scanner, a
 *                        health check — or an engineer testing with curl.
 *                        (SLICE L-43: an EMPTY body with no header is Leafly's
 *                        expected unsigned delivery. It is answered 2xx and is
 *                        never recorded, so it never reaches this module.)
 *   empty_header       → header present but blank.
 *   missing_key        → OUR key is not configured. Ours to fix, and nothing
 *                        to do with Leafly.
 *   empty_body         → written only by builds before L-43, which refused a
 *                        signed empty body unread. Kept so those rows classify.
 *   malformed_header   → something posted a value that is not a SHA-256
 *                        digest at all. Again: not Leafly.
 *   digest_unavailable → our own crypto failed. Ours, and urgent.
 *   mismatch           → a real, well-formed signature that did not verify.
 *                        THIS is the one that means "the HMAC key is wrong".
 *
 * Telling the owner "the HMAC key doesn't match" when the six refusals were
 * actually six unsigned probes sends him to email Leafly about a key that is
 * perfectly fine. That is worse than saying nothing, because it burns his
 * credibility with his integration contact.
 *
 * ── THE CONTAMINATION PROBLEM ─────────────────────────────────────────────
 * There is a specific, embarrassing instance of this. While diagnosing the
 * owner's empty-cart bug I sent unsigned `curl` probes at the live webhook
 * routes to prove they were reachable. Every one of those was recorded as a
 * refused delivery. His dashboard read "6", and his `LAST CONTACT` line read
 * `order_preview, probe` — the word "probe" being the body I posted.
 *
 * So the headline number he was shown was partly MY traffic, and the
 * explanation attached to it accused Leafly of a key mismatch. This module
 * exists so that can never happen again: refusals are split by reason, and
 * only `mismatch` is allowed to support the sentence "the HMAC key is wrong".
 *
 * ── WHY A SEPARATE PURE MODULE ────────────────────────────────────────────
 * Zero imports, so it can be exercised directly by `tsx` with no database, no
 * network and no Next.js runtime. The server layer does one bounded read and
 * hands the rows here; every judgement lives in this file where it can be
 * tested exhaustively.
 *
 * House rules honoured: no invented data (an unknown reason stays unknown and
 * is counted as unknown, never bucketed into a convenient one); no throwing on
 * malformed input; plain English written for the shop owner, not for an
 * engineer.
 */

/* ------------------------------------------------------------------------- *
 * 1. The vocabulary — mirrored from hmac-core.ts
 * ------------------------------------------------------------------------- */

/**
 * The refusal reasons `hmac-core.ts` can produce.
 *
 * Duplicated as a literal rather than imported, because this module is
 * import-free by design. `tests/compliance/leafly-refusal-diagnosis.test.ts`
 * pins this list against the real `LEAFLY_HMAC_FAILURE_REASONS`, so the two
 * cannot drift apart silently — if someone adds an eighth reason to
 * hmac-core and forgets this file, that test fails.
 */
export const LEAFLY_REFUSAL_REASONS = [
  "missing_header",
  "empty_header",
  "missing_key",
  "empty_body",
  "malformed_header",
  "digest_unavailable",
  "mismatch",
] as const;

export type LeaflyRefusalReason = (typeof LEAFLY_REFUSAL_REASONS)[number];

/**
 * Who has to do something about it.
 *
 *   "leafly"    — the key Leafly signs with disagrees with ours. Needs an
 *                 email to Leafly, or a re-copy of the key.
 *   "us"        — our configuration or our crypto. We fix it, alone.
 *   "not_leafly"— the caller was not Leafly. Usually harmless background
 *                 noise, a scanner, or our own testing.
 *   "unknown"   — a reason string we do not recognise. Never guessed at.
 */
export type RefusalOwner = "leafly" | "us" | "not_leafly" | "unknown";

/**
 * Map a refusal reason to who owns the fix.
 *
 * `mismatch` is deliberately the ONLY reason that returns "leafly". That
 * narrowness is the entire point of this module.
 */
export function refusalOwner(reason: string | null | undefined): RefusalOwner {
  const r = typeof reason === "string" ? reason.trim() : "";
  switch (r) {
    case "mismatch":
      return "leafly";
    case "missing_key":
    case "digest_unavailable":
      return "us";
    case "missing_header":
    case "empty_header":
    case "empty_body":
    case "malformed_header":
      return "not_leafly";
    default:
      return "unknown";
  }
}

/**
 * One sentence per reason, written for the shop owner.
 *
 * No jargon that cannot be acted on. Each says what happened AND what to do.
 */
export function refusalMeaning(reason: string | null | undefined): string {
  const r = typeof reason === "string" ? reason.trim() : "";
  switch (r) {
    case "mismatch":
      return (
        "A properly formed signature arrived but did not match. This is the one " +
        "that really does mean the webhook HMAC key saved here is not the key " +
        "Leafly is signing with."
      );
    case "missing_key":
      return (
        "No webhook HMAC key is saved here, so nothing could be checked. This is " +
        "ours to fix, on the Integrations page — it is not a Leafly problem."
      );
    case "digest_unavailable":
      return (
        "Our own system could not compute a signature to compare against. This is " +
        "a fault on our side and needs a developer."
      );
    case "missing_header":
      return (
        "The caller sent a body with no signature header. Leafly signs every " +
        "delivery that has a body, so this was almost certainly not Leafly — a scanner, a " +
        "health check, or someone testing the address by hand."
      );
    case "empty_header":
      return (
        "A signature header arrived but was blank. Leafly does not send blank " +
        "signatures, so this was not a real delivery."
      );
    case "empty_body":
      return (
        "An older build refused this because the body was empty. Since the " +
        "signature-rules update, an empty unsigned delivery is accepted quietly " +
        "(Leafly says it is expected) and a signed one is checked like any other, " +
        "so no new refusal will ever carry this reason."
      );
    case "malformed_header":
      return (
        "The signature was not even shaped like a signature. Something other than " +
        "Leafly is posting to this address."
      );
    default:
      return (
        "This refusal has a reason we do not recognise, so it is being reported " +
        "as-is rather than guessed at."
      );
  }
}

/* ------------------------------------------------------------------------- *
 * 2. Counting
 * ------------------------------------------------------------------------- */

/** The shape the server hands us. Deliberately minimal and all-nullable. */
export type RefusalRow = {
  reason: string | null;
  eventType?: string | null;
  receivedAt?: string | null;
};

export type RefusalBucket = {
  reason: string;
  count: number;
  owner: RefusalOwner;
  meaning: string;
};

export type RefusalBreakdown = {
  /** Every refusal we were given. */
  total: number;
  /** Refusals that genuinely implicate the HMAC key (`mismatch` only). */
  keyMismatchCount: number;
  /** Refusals that are our own configuration or crypto. */
  oursCount: number;
  /** Refusals that were not Leafly at all (probes, scanners, curl). */
  notLeaflyCount: number;
  /** Refusals whose reason string we do not recognise. */
  unknownCount: number;
  /** Per-reason detail, largest first, then alphabetically for stability. */
  buckets: RefusalBucket[];
};

/**
 * Bucket refusals by reason.
 *
 * Deterministic ordering: count descending, then reason ascending. Without the
 * tie-break the panel would reshuffle between renders for equal counts, which
 * reads as flicker and makes screenshots incomparable.
 */
export function breakdownRefusals(rows: readonly RefusalRow[] | null | undefined): RefusalBreakdown {
  const empty: RefusalBreakdown = {
    total: 0,
    keyMismatchCount: 0,
    oursCount: 0,
    notLeaflyCount: 0,
    unknownCount: 0,
    buckets: [],
  };
  if (!Array.isArray(rows) || rows.length === 0) return empty;

  const counts = new Map<string, number>();
  let total = 0;
  let keyMismatchCount = 0;
  let oursCount = 0;
  let notLeaflyCount = 0;
  let unknownCount = 0;

  for (const row of rows) {
    if (row === null || typeof row !== "object") continue;
    total += 1;

    const raw = typeof row.reason === "string" ? row.reason.trim() : "";
    // An absent reason is its own fact, not a synonym for any known reason.
    const key = raw === "" ? "(no reason recorded)" : raw;
    counts.set(key, (counts.get(key) ?? 0) + 1);

    switch (refusalOwner(raw)) {
      case "leafly":
        keyMismatchCount += 1;
        break;
      case "us":
        oursCount += 1;
        break;
      case "not_leafly":
        notLeaflyCount += 1;
        break;
      default:
        unknownCount += 1;
        break;
    }
  }

  const buckets: RefusalBucket[] = [...counts.entries()]
    .map(([reason, count]) => ({
      reason,
      count,
      owner: refusalOwner(reason),
      meaning: refusalMeaning(reason),
    }))
    .sort((a, b) => (b.count - a.count) || a.reason.localeCompare(b.reason));

  return { total, keyMismatchCount, oursCount, notLeaflyCount, unknownCount, buckets };
}

/* ------------------------------------------------------------------------- *
 * 3. The headline
 * ------------------------------------------------------------------------- */

/**
 * What the panel should actually say at the top.
 *
 *   "key_mismatch"  — at least one real mismatch. Email Leafly.
 *   "our_config"    — our key is missing or our crypto is broken.
 *   "noise_only"    — refusals exist but none of them were Leafly.
 *   "healthy"       — nothing was refused.
 *   "unknown"       — refusals we cannot classify.
 */
export type RefusalVerdict =
  | "healthy"
  | "key_mismatch"
  | "our_config"
  | "noise_only"
  | "unknown";

export type RefusalDiagnosis = {
  verdict: RefusalVerdict;
  /** One-line summary for the panel heading. */
  headline: string;
  /** The longer explanation underneath. */
  detail: string;
  /** True when the owner should contact Leafly. */
  contactLeafly: boolean;
  /** True when this is ours alone to fix. */
  actionIsOurs: boolean;
  breakdown: RefusalBreakdown;
};

/**
 * Turn a breakdown into advice.
 *
 * ── PRECEDENCE, AND WHY IT IS THIS WAY ────────────────────────────────────
 * `our_config` is checked BEFORE `key_mismatch`. If no key is saved at all,
 * every signature will also fail to match, so both buckets fill up — but
 * telling the owner to email Leafly when he simply has not pasted the key yet
 * would be a wild goose chase. The cheapest, most-certainly-ours cause wins.
 *
 * `noise_only` is last among the failures, because a single genuine mismatch
 * buried under fifty scanner hits still matters more than the scanners.
 */
export function diagnoseRefusals(input: {
  breakdown: RefusalBreakdown;
  /** Has a signature EVER verified? Changes the meaning of a mismatch. */
  verifiedDeliveryEverReceived: boolean;
  /** Is an HMAC key saved at all? */
  hmacKeyPresent: boolean;
}): RefusalDiagnosis {
  const b = input.breakdown;

  if (b.total === 0) {
    return {
      verdict: "healthy",
      headline: "Nothing has been turned away.",
      detail:
        "No delivery from Leafly has been refused, so there is no signature problem to fix.",
      contactLeafly: false,
      actionIsOurs: false,
      breakdown: b,
    };
  }

  if (!input.hmacKeyPresent || b.oursCount > 0) {
    return {
      verdict: "our_config",
      headline: "This is ours to fix, not Leafly's.",
      detail:
        !input.hmacKeyPresent
          ? "No webhook HMAC key is saved here, so no delivery can be verified. Save the " +
            "HMAC key Leafly issued on the Integrations page. Do not email Leafly about " +
            "this one — nothing is wrong on their side."
          : "Some deliveries were refused because of our own configuration or a fault in " +
            "our signature check. Fix that before looking at anything on Leafly's side.",
      contactLeafly: false,
      actionIsOurs: true,
      breakdown: b,
    };
  }

  if (b.keyMismatchCount > 0) {
    const everWorked = input.verifiedDeliveryEverReceived;
    return {
      verdict: "key_mismatch",
      headline:
        b.keyMismatchCount === 1
          ? "One real signature did not match."
          : `${b.keyMismatchCount} real signatures did not match.`,
      detail: everWorked
        ? "A signature from Leafly verified correctly at some point, and now signatures are " +
          "failing. That pattern points at a key that was rotated on Leafly's side after it " +
          "was first issued. Ask Leafly to confirm the current webhook HMAC key."
        : "A properly formed signature arrived and did not match the key saved here. The key " +
          "on file is not the one Leafly is signing with. Ask Leafly to confirm the webhook " +
          "HMAC key for this store, then re-save it.",
      contactLeafly: true,
      actionIsOurs: false,
      breakdown: b,
    };
  }

  if (b.unknownCount > 0) {
    return {
      verdict: "unknown",
      headline: "Some refusals could not be explained.",
      detail:
        "Deliveries were refused for reasons this system does not recognise. They are listed " +
        "below exactly as recorded, rather than guessed at.",
      contactLeafly: false,
      actionIsOurs: true,
      breakdown: b,
    };
  }

  return {
    verdict: "noise_only",
    headline: "Nothing here was actually Leafly.",
    detail:
      "Every refused request was missing a signature, blank, or malformed. Genuine Leafly " +
      "deliveries always carry a proper signature, so these were scanners, health checks, or " +
      "hand-run tests against the address. There is no key problem to chase, and no reason to " +
      "contact Leafly about these.",
    contactLeafly: false,
    actionIsOurs: false,
    breakdown: b,
  };
}

/* ------------------------------------------------------------------------- *
 * 3b. Recency — "is this still happening, or is it old history?"
 * ------------------------------------------------------------------------- */

/**
 * How recent a refusal has to be before it is treated as a live fault.
 *
 * WHY A WINDOW AT ALL. Every refusal ever recorded stays in the log on
 * purpose, so a key rotation leaves a visible trace. But an owner setting the
 * integration up WILL generate refusals — the key is not saved yet, a URL gets
 * probed, a test is run by hand — and those are the record of the setup
 * happening, not a fault. Without a window, the panel would accuse the system
 * of being broken forever on the strength of history that has already been
 * fixed, and advice that never clears is advice that gets ignored.
 *
 * WHY 120 MINUTES. It must comfortably exceed Leafly's own 15-minute
 * auto-cancel window (spec: an unacknowledged order is cancelled after 15
 * minutes), so anything still inside the window could plausibly relate to an
 * order the owner is testing right now. Two hours gives the owner time to read
 * the panel, change a setting and retry without the evidence ageing out from
 * under him mid-diagnosis.
 */
export const REFUSAL_RECENCY_MINUTES = 120;

/**
 * Keep only the refusals that happened inside the window.
 *
 * A row with no timestamp, or an unparseable one, is KEPT. Dropping it would
 * be deciding it is old on no evidence, and this module does not guess. A row
 * dated in the future is also kept — clock skew on our side must not be able
 * to hide a live fault.
 */
export function refusalsWithinWindow(
  rows: readonly RefusalRow[] | null | undefined,
  nowIso: string,
  windowMinutes: number = REFUSAL_RECENCY_MINUTES,
): RefusalRow[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const nowMs = Date.parse(nowIso);
  // An unusable "now" means we cannot judge age at all. Returning everything
  // is the honest answer: we would rather over-report than silently conclude
  // that a live problem is ancient.
  if (!Number.isFinite(nowMs)) return rows.filter((r) => r !== null && typeof r === "object");

  const minutes = Number.isFinite(windowMinutes) && windowMinutes > 0
    ? windowMinutes
    : REFUSAL_RECENCY_MINUTES;
  const cutoff = nowMs - minutes * 60_000;

  const kept: RefusalRow[] = [];
  for (const row of rows) {
    if (row === null || typeof row !== "object") continue;
    const at = typeof row.receivedAt === "string" ? Date.parse(row.receivedAt) : NaN;
    if (!Number.isFinite(at)) {
      kept.push(row);
      continue;
    }
    if (at >= cutoff) kept.push(row);
  }
  return kept;
}

/**
 * Is a signature refusal blocking checkout RIGHT NOW?
 *
 * Deliberately narrow: only refusals that Leafly itself could be responsible
 * for (`mismatch`) or that are ours (`missing_key`, `digest_unavailable`)
 * count. An unsigned scanner hit inside the window does NOT make this true,
 * because a scanner being turned away has no bearing on whether a real
 * shopper's cart survives. That distinction is the whole reason this module
 * exists — the owner was told his key was wrong on the strength of six
 * unsigned probes, four of which were mine.
 */
export function signatureRefusalBlockingNow(
  rows: readonly RefusalRow[] | null | undefined,
  nowIso: string,
  windowMinutes: number = REFUSAL_RECENCY_MINUTES,
): boolean {
  const recent = refusalsWithinWindow(rows, nowIso, windowMinutes);
  for (const row of recent) {
    const owner = refusalOwner(row.reason);
    if (owner === "leafly" || owner === "us") return true;
  }
  return false;
}

/* ------------------------------------------------------------------------- *
 * 4. Why a cart can empty — the OTHER failure the owner hit
 * ------------------------------------------------------------------------- */

/**
 * Reasons the preview webhook can hand Leafly an empty cart.
 *
 * Proven by execution against the real `buildLeaflyPreviewResponse`, not
 * inferred:
 *
 *   pickupEnabled=false  → every line removed_not_orderable → cart empties
 *   unknown variant id   → removed_unknown_variant          → cart empties
 *   refused signature    → 401, no body at all              → cart empties
 *
 * All three look IDENTICAL to the shopper: "Empty stash?". That is precisely
 * why they must be named separately here.
 */
export type EmptyCartCause =
  | "signature_refused"
  | "pickup_disabled"
  | "menu_unavailable"
  | "variants_unknown"
  | "none";

export type EmptyCartAdvice = {
  cause: EmptyCartCause;
  headline: string;
  detail: string;
  /** Blocks a successful checkout right now. */
  blocking: boolean;
};

/**
 * Work out why a shopper's cart would empty at "proceed to preorder".
 *
 * Ordered by what fires FIRST in the real request path, so the advice matches
 * the order the system actually fails in:
 *   1. signature check (route rejects with 401 before any pricing)
 *   2. menu load       (no feed → echo, but with zero variants → removal)
 *   3. pickup toggle   (orderable=false → every line removed)
 *   4. variant lookup  (ids we do not recognise → removed)
 */
export function explainEmptyCart(input: {
  signatureRefusalsRecent: boolean;
  pickupAvailabilityEnabled: boolean;
  menuVariantCount: number;
  everyLineUnknown?: boolean;
}): EmptyCartAdvice {
  if (input.signatureRefusalsRecent) {
    return {
      cause: "signature_refused",
      headline: "The cart empties because we are turning Leafly away.",
      detail:
        "When a shopper taps “proceed to preorder”, Leafly asks us to confirm the cart and " +
        "waits for the answer. We are refusing that request over its signature, so Leafly " +
        "receives no cart back and the basket empties. Fix the signature first — nothing else " +
        "can be tested until this one is cleared.",
      blocking: true,
    };
  }

  if (!input.pickupAvailabilityEnabled) {
    return {
      cause: "pickup_disabled",
      headline: "Pickup ordering is switched off, so every item is removed.",
      detail:
        "Leafly asks us to confirm the cart, and with pickup ordering turned off we answer that " +
        "none of the items may be sold through a marketplace. Leafly honours that answer and " +
        "empties the basket. Turn on “send pickup availability” in the Leafly sync settings.",
      blocking: true,
    };
  }

  if (!Number.isFinite(input.menuVariantCount) || input.menuVariantCount <= 0) {
    return {
      cause: "menu_unavailable",
      headline: "We have no published menu to price the cart against.",
      detail:
        "Leafly asks us to confirm the cart and we have no menu loaded to check it against, so " +
        "nothing can be confirmed. Push the menu to Leafly, then try the order again.",
      blocking: true,
    };
  }

  if (input.everyLineUnknown === true) {
    return {
      cause: "variants_unknown",
      headline: "Leafly is asking about items we do not recognise.",
      detail:
        "Every item in the cart came back as unknown to our catalogue, so all of them were " +
        "removed rather than priced from a guess. This usually means the shopper is buying an " +
        "item that was never pushed to Leafly, or was pushed under a different id. Re-push the " +
        "menu and try again with an item you can see in the published menu.",
      blocking: true,
    };
  }

  return {
    cause: "none",
    headline: "Nothing should be emptying the cart.",
    detail:
      "Signatures are being accepted, pickup ordering is on, and the published menu is loaded. " +
      "A cart that still empties is worth reporting with the exact item that was in it.",
    blocking: false,
  };
}

/* ------------------------------------------------------------------------- *
 * 5. Self-tests
 * ------------------------------------------------------------------------- */

function rows(...reasons: (string | null)[]): RefusalRow[] {
  return reasons.map((reason) => ({ reason }));
}

export function __runLeaflyRefusalDiagnosisTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  ✗ ${name}`);
    }
  };
  const eq = (name: string, actual: unknown, expected: unknown) =>
    ok(`${name} (got ${JSON.stringify(actual)})`, Object.is(actual, expected));

  // ---- 1. Ownership --------------------------------------------------------
  eq("mismatch is Leafly's", refusalOwner("mismatch"), "leafly");
  eq("missing_key is ours", refusalOwner("missing_key"), "us");
  eq("digest_unavailable is ours", refusalOwner("digest_unavailable"), "us");
  eq("missing_header is not Leafly", refusalOwner("missing_header"), "not_leafly");
  eq("empty_header is not Leafly", refusalOwner("empty_header"), "not_leafly");
  eq("empty_body is not Leafly", refusalOwner("empty_body"), "not_leafly");
  eq("malformed_header is not Leafly", refusalOwner("malformed_header"), "not_leafly");
  eq("an invented reason is unknown", refusalOwner("banana"), "unknown");
  eq("null is unknown", refusalOwner(null), "unknown");
  eq("undefined is unknown", refusalOwner(undefined), "unknown");
  eq("blank is unknown", refusalOwner("   "), "unknown");
  ok("whitespace is trimmed, not mis-bucketed", refusalOwner("  mismatch  ") === "leafly");

  // THE central invariant of this module.
  ok(
    "mismatch is the ONLY reason that blames Leafly",
    LEAFLY_REFUSAL_REASONS.filter((r) => refusalOwner(r) === "leafly").join(",") === "mismatch",
  );

  // ---- 2. Meanings ---------------------------------------------------------
  ok(
    "every known reason has a real sentence",
    LEAFLY_REFUSAL_REASONS.every((r) => refusalMeaning(r).trim().length > 40),
  );
  ok(
    "only the mismatch sentence claims the key is wrong",
    LEAFLY_REFUSAL_REASONS.filter((r) => /key .*not the key|not the key/i.test(refusalMeaning(r)))
      .join(",") === "mismatch",
  );
  ok("an unknown reason says so", /do not recognise/i.test(refusalMeaning("banana")));

  // ---- 3. Breakdown --------------------------------------------------------
  const empty = breakdownRefusals([]);
  eq("no rows -> total 0", empty.total, 0);
  eq("no rows -> no buckets", empty.buckets.length, 0);
  eq("null input is safe", breakdownRefusals(null).total, 0);
  eq("undefined input is safe", breakdownRefusals(undefined).total, 0);

  const six = breakdownRefusals(
    rows("missing_header", "missing_header", "missing_header", "missing_header", "missing_header", "missing_header"),
  );
  eq("the owner's six probes count as six", six.total, 6);
  eq("...and NONE of them blame the key", six.keyMismatchCount, 0);
  eq("...they are all 'not Leafly'", six.notLeaflyCount, 6);
  eq("...in one bucket", six.buckets.length, 1);

  const mixed = breakdownRefusals(rows("missing_header", "mismatch", "mismatch", null, "banana"));
  eq("mixed total", mixed.total, 5);
  eq("mixed mismatch count", mixed.keyMismatchCount, 2);
  eq("mixed not-leafly count", mixed.notLeaflyCount, 1);
  eq("mixed unknown count (null + banana)", mixed.unknownCount, 2);
  eq("biggest bucket first", mixed.buckets[0]?.reason, "mismatch");
  ok(
    "a null reason is recorded as its own bucket, not merged",
    mixed.buckets.some((x) => x.reason === "(no reason recorded)"),
  );

  // Deterministic ordering on ties.
  const tie = breakdownRefusals(rows("mismatch", "empty_body"));
  eq("ties break alphabetically", tie.buckets[0]?.reason, "empty_body");

  // Totals must always reconcile — no row may be lost or double counted.
  for (const sample of [
    rows(),
    rows("mismatch"),
    rows("missing_header", "mismatch", "missing_key", "banana", null, "empty_body"),
    rows(...Array(50).fill("mismatch")),
  ]) {
    const b = breakdownRefusals(sample);
    ok(
      "every row lands in exactly one class",
      b.keyMismatchCount + b.oursCount + b.notLeaflyCount + b.unknownCount === b.total,
    );
    ok(
      "bucket counts sum to the total",
      b.buckets.reduce((a, x) => a + x.count, 0) === b.total,
    );
  }

  // Malformed rows must not throw or inflate the count wrongly.
  const junk = breakdownRefusals([
    null as unknown as RefusalRow,
    undefined as unknown as RefusalRow,
    { reason: "mismatch" },
  ]);
  eq("junk rows are skipped, real ones kept", junk.total, 1);
  eq("...and classified", junk.keyMismatchCount, 1);

  // ---- 4. The diagnosis ----------------------------------------------------
  const healthy = diagnoseRefusals({
    breakdown: breakdownRefusals([]),
    verifiedDeliveryEverReceived: true,
    hmacKeyPresent: true,
  });
  eq("nothing refused -> healthy", healthy.verdict, "healthy");
  ok("healthy does not send him to Leafly", healthy.contactLeafly === false);

  // THE OWNER'S ACTUAL CASE: six unsigned probes, key saved, one good delivery.
  const hisCase = diagnoseRefusals({
    breakdown: six,
    verifiedDeliveryEverReceived: true,
    hmacKeyPresent: true,
  });
  eq("six unsigned probes -> noise only", hisCase.verdict, "noise_only");
  ok("...and it does NOT tell him to email Leafly", hisCase.contactLeafly === false);
  ok("...and it does NOT claim a key mismatch", !/key/i.test(hisCase.headline));

  const realMismatch = diagnoseRefusals({
    breakdown: breakdownRefusals(rows("mismatch", "mismatch")),
    verifiedDeliveryEverReceived: false,
    hmacKeyPresent: true,
  });
  eq("real mismatches -> key_mismatch", realMismatch.verdict, "key_mismatch");
  ok("...and it DOES tell him to contact Leafly", realMismatch.contactLeafly === true);
  ok("...and it is not ours", realMismatch.actionIsOurs === false);

  // A mismatch AFTER a good delivery reads as a rotation, not a bad first paste.
  const rotated = diagnoseRefusals({
    breakdown: breakdownRefusals(rows("mismatch")),
    verifiedDeliveryEverReceived: true,
    hmacKeyPresent: true,
  });
  eq("a mismatch after success is still key_mismatch", rotated.verdict, "key_mismatch");
  ok("...and says 'rotated'", /rotat/i.test(rotated.detail));
  ok("singular wording for one", /One real signature/.test(rotated.headline));

  // No key saved wins over everything — precedence test.
  const noKey = diagnoseRefusals({
    breakdown: breakdownRefusals(rows("mismatch", "missing_key")),
    verifiedDeliveryEverReceived: false,
    hmacKeyPresent: false,
  });
  eq("missing key beats mismatch", noKey.verdict, "our_config");
  ok("...and does NOT send him to Leafly", noKey.contactLeafly === false);
  ok("...and says it is ours", noKey.actionIsOurs === true);

  const unknownOnly = diagnoseRefusals({
    breakdown: breakdownRefusals(rows("banana", "banana")),
    verifiedDeliveryEverReceived: true,
    hmacKeyPresent: true,
  });
  eq("unrecognised reasons -> unknown", unknownOnly.verdict, "unknown");
  ok("...never blames Leafly", unknownOnly.contactLeafly === false);

  // Invariant sweep: contactLeafly may ONLY ever be true for key_mismatch.
  const sweepSamples: RefusalRow[][] = [
    rows(),
    rows("mismatch"),
    rows("missing_header"),
    rows("missing_key"),
    rows("digest_unavailable"),
    rows("banana"),
    rows("mismatch", "missing_header"),
    rows("mismatch", "missing_key"),
    rows("empty_body", "empty_header", "malformed_header"),
  ];
  for (const sample of sweepSamples) {
    for (const verified of [true, false]) {
      for (const keyPresent of [true, false]) {
        const d = diagnoseRefusals({
          breakdown: breakdownRefusals(sample),
          verifiedDeliveryEverReceived: verified,
          hmacKeyPresent: keyPresent,
        });
        ok(
          "contactLeafly implies key_mismatch",
          d.contactLeafly === false || d.verdict === "key_mismatch",
        );
        ok(
          "key_mismatch implies at least one real mismatch",
          d.verdict !== "key_mismatch" || d.breakdown.keyMismatchCount > 0,
        );
        ok("headline is never empty", d.headline.trim().length > 10);
        ok("detail is never empty", d.detail.trim().length > 20);
        ok(
          "we never both blame Leafly and claim it is ours",
          !(d.contactLeafly && d.actionIsOurs),
        );
        ok(
          "a missing key is never blamed on Leafly",
          keyPresent || d.contactLeafly === false,
        );
      }
    }
  }

  // ---- 5. Empty cart -------------------------------------------------------
  const sig = explainEmptyCart({
    signatureRefusalsRecent: true,
    pickupAvailabilityEnabled: true,
    menuVariantCount: 100,
  });
  eq("a refused signature is the first cause", sig.cause, "signature_refused");
  ok("...and it blocks", sig.blocking === true);

  const pickup = explainEmptyCart({
    signatureRefusalsRecent: false,
    pickupAvailabilityEnabled: false,
    menuVariantCount: 100,
  });
  eq("pickup off empties the cart", pickup.cause, "pickup_disabled");
  ok("...and it blocks", pickup.blocking === true);
  ok("...and names the setting", /pickup availability/i.test(pickup.detail));

  const noMenu = explainEmptyCart({
    signatureRefusalsRecent: false,
    pickupAvailabilityEnabled: true,
    menuVariantCount: 0,
  });
  eq("no menu empties the cart", noMenu.cause, "menu_unavailable");

  const unknownVariants = explainEmptyCart({
    signatureRefusalsRecent: false,
    pickupAvailabilityEnabled: true,
    menuVariantCount: 10,
    everyLineUnknown: true,
  });
  eq("unknown variants empty the cart", unknownVariants.cause, "variants_unknown");

  const fine = explainEmptyCart({
    signatureRefusalsRecent: false,
    pickupAvailabilityEnabled: true,
    menuVariantCount: 10,
  });
  eq("otherwise nothing should empty it", fine.cause, "none");
  ok("...and that is not blocking", fine.blocking === false);

  // Precedence: the signature refusal must win even when everything else is
  // also wrong, because it happens first in the real request path.
  eq(
    "signature beats every other cause",
    explainEmptyCart({
      signatureRefusalsRecent: true,
      pickupAvailabilityEnabled: false,
      menuVariantCount: 0,
      everyLineUnknown: true,
    }).cause,
    "signature_refused",
  );
  eq(
    "pickup beats an empty menu",
    explainEmptyCart({
      signatureRefusalsRecent: false,
      pickupAvailabilityEnabled: false,
      menuVariantCount: 0,
    }).cause,
    "pickup_disabled",
  );

  // Exhaustive sweep: never throw, never return a blank explanation.
  for (const s of [true, false]) {
    for (const p of [true, false]) {
      for (const m of [-1, 0, 1, 1000, Number.NaN]) {
        for (const u of [true, false, undefined]) {
          const a = explainEmptyCart({
            signatureRefusalsRecent: s,
            pickupAvailabilityEnabled: p,
            menuVariantCount: m,
            everyLineUnknown: u,
          });
          ok("cause is always set", typeof a.cause === "string" && a.cause.length > 0);
          ok("headline always present", a.headline.trim().length > 10);
          ok("detail always present", a.detail.trim().length > 20);
          ok(
            "blocking is true for every cause except none",
            a.cause === "none" ? a.blocking === false : a.blocking === true,
          );
          ok(
            "a NaN or negative variant count never reads as a healthy menu",
            !(Number.isFinite(m) && m > 0) && !s && p && u !== true
              ? a.cause === "menu_unavailable"
              : true,
          );
        }
      }
    }
  }

  // ---- 6. Recency ----------------------------------------------------------
  {
    const NOW = "2026-09-22T17:00:00.000Z";
    const mins = (n: number) => new Date(Date.parse(NOW) - n * 60_000).toISOString();

    const at = (reason: string | null, receivedAt: string | null): RefusalRow => ({
      reason,
      receivedAt,
    });

    eq("empty input yields nothing", refusalsWithinWindow([], NOW).length, 0);
    eq("null input yields nothing", refusalsWithinWindow(null, NOW).length, 0);
    eq("undefined input yields nothing", refusalsWithinWindow(undefined, NOW).length, 0);

    eq(
      "a refusal one minute old is inside the window",
      refusalsWithinWindow([at("mismatch", mins(1))], NOW).length,
      1,
    );
    eq(
      "a refusal one minute before the cutoff is inside",
      refusalsWithinWindow([at("mismatch", mins(REFUSAL_RECENCY_MINUTES - 1))], NOW).length,
      1,
    );
    eq(
      "a refusal exactly at the cutoff is inside (>= not >)",
      refusalsWithinWindow([at("mismatch", mins(REFUSAL_RECENCY_MINUTES))], NOW).length,
      1,
    );
    eq(
      "a refusal one minute past the cutoff is outside",
      refusalsWithinWindow([at("mismatch", mins(REFUSAL_RECENCY_MINUTES + 1))], NOW).length,
      0,
    );
    eq(
      "a week-old refusal is outside",
      refusalsWithinWindow([at("mismatch", mins(60 * 24 * 7))], NOW).length,
      0,
    );

    // Never guess that untimestamped or skewed evidence is old.
    eq(
      "a refusal with no timestamp is KEPT, not assumed old",
      refusalsWithinWindow([at("mismatch", null)], NOW).length,
      1,
    );
    eq(
      "a refusal with an unparseable timestamp is KEPT",
      refusalsWithinWindow([at("mismatch", "not-a-date")], NOW).length,
      1,
    );
    eq(
      "a future-dated refusal is KEPT (clock skew must not hide a fault)",
      refusalsWithinWindow([at("mismatch", mins(-30))], NOW).length,
      1,
    );
    eq(
      "an unusable now returns every row rather than concluding they are old",
      refusalsWithinWindow(
        [at("mismatch", mins(60 * 24 * 365)), at("missing_header", mins(1))],
        "garbage",
      ).length,
      2,
    );
    eq(
      "a non-positive window falls back to the default rather than excluding everything",
      refusalsWithinWindow([at("mismatch", mins(1))], NOW, 0).length,
      1,
    );
    eq(
      "a negative window falls back to the default too",
      refusalsWithinWindow([at("mismatch", mins(1))], NOW, -5).length,
      1,
    );

    // Filtering must never invent or duplicate rows.
    {
      const many = [
        at("mismatch", mins(1)),
        at("missing_header", mins(5)),
        at("mismatch", mins(9999)),
        at("missing_key", mins(2)),
      ];
      const kept = refusalsWithinWindow(many, NOW);
      eq("filter keeps exactly the in-window rows", kept.length, 3);
      ok(
        "filter never returns more rows than it was given",
        refusalsWithinWindow(many, NOW).length <= many.length,
      );
      ok(
        "every kept row is one of the originals (no fabrication)",
        kept.every((k) => many.includes(k)),
      );
    }

    // ---- The central recency invariant ------------------------------------
    ok(
      "a recent unsigned probe does NOT block checkout",
      signatureRefusalBlockingNow([at("missing_header", mins(1))], NOW) === false,
    );
    ok(
      "a hundred recent unsigned probes still do not block checkout",
      signatureRefusalBlockingNow(
        Array.from({ length: 100 }, () => at("missing_header", mins(1))),
        NOW,
      ) === false,
    );
    ok(
      "every not_leafly reason is non-blocking even when recent",
      LEAFLY_REFUSAL_REASONS.filter((r) => refusalOwner(r) === "not_leafly").every(
        (r) => signatureRefusalBlockingNow([at(r, mins(1))], NOW) === false,
      ),
    );
    ok(
      "a recent mismatch DOES block checkout",
      signatureRefusalBlockingNow([at("mismatch", mins(1))], NOW) === true,
    );
    ok(
      "a recent missing_key DOES block checkout",
      signatureRefusalBlockingNow([at("missing_key", mins(1))], NOW) === true,
    );
    ok(
      "a recent digest_unavailable DOES block checkout",
      signatureRefusalBlockingNow([at("digest_unavailable", mins(1))], NOW) === true,
    );
    ok(
      "an OLD mismatch does not block checkout",
      signatureRefusalBlockingNow([at("mismatch", mins(60 * 24))], NOW) === false,
    );
    ok(
      "one real mismatch buried under recent noise still blocks",
      signatureRefusalBlockingNow(
        [
          at("missing_header", mins(1)),
          at("missing_header", mins(2)),
          at("empty_body", mins(3)),
          at("mismatch", mins(4)),
          at("malformed_header", mins(5)),
        ],
        NOW,
      ) === true,
    );
    ok(
      "the owner's exact reported situation — six unsigned probes — is NOT a key problem",
      signatureRefusalBlockingNow(
        Array.from({ length: 6 }, (_, i) => at("missing_header", mins(i + 1))),
        NOW,
      ) === false,
    );
    ok(
      "no refusals at all never blocks",
      signatureRefusalBlockingNow([], NOW) === false,
    );
    ok(
      "an unrecognised recent reason does not blame Leafly by blocking",
      signatureRefusalBlockingNow([at("banana", mins(1))], NOW) === false,
    );

    // Blocking must agree with ownership, for every reason, at both ages.
    for (const r of LEAFLY_REFUSAL_REASONS) {
      const owner = refusalOwner(r);
      const shouldBlock = owner === "leafly" || owner === "us";
      ok(
        `recent ${r} blocks iff its owner is leafly or us`,
        signatureRefusalBlockingNow([at(r, mins(1))], NOW) === shouldBlock,
      );
      ok(
        `stale ${r} never blocks`,
        signatureRefusalBlockingNow([at(r, mins(60 * 24 * 30))], NOW) === false,
      );
    }

    // Cross-check against the breakdown: if nothing recent is owned by leafly
    // or us, nothing may block. Stated as an independent computation so a bug
    // in one function cannot satisfy the other.
    {
      const sample = [
        at("missing_header", mins(3)),
        at("empty_header", mins(4)),
        at("mismatch", mins(60 * 48)),
      ];
      const recentBreakdown = breakdownRefusals(refusalsWithinWindow(sample, NOW));
      ok(
        "breakdown of the recent window agrees with the blocking verdict",
        (recentBreakdown.keyMismatchCount + recentBreakdown.oursCount > 0) ===
          signatureRefusalBlockingNow(sample, NOW),
      );
      eq("the stale mismatch is excluded from the recent window", recentBreakdown.keyMismatchCount, 0);
      eq("the two recent probes are counted as not-Leafly", recentBreakdown.notLeaflyCount, 2);
    }

    // The window constant must be usable and must exceed Leafly's own
    // 15-minute auto-cancel, or a live order could age out mid-diagnosis.
    ok("the recency window is a positive number", Number.isFinite(REFUSAL_RECENCY_MINUTES) && REFUSAL_RECENCY_MINUTES > 0);
    ok("the recency window comfortably exceeds Leafly's 15-minute cancel", REFUSAL_RECENCY_MINUTES > 15);
  }

  console.log(`leafly-refusal-diagnosis-core: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} assertion(s) failed`);
  return { passed, failed };
}
