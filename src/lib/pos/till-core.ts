/**
 * src/lib/pos/till-core.ts  (POS Slice B21)
 *
 * PURE request validation for the register-side till endpoint
 * (/api/pos/till). Zero I/O — unit-testable with tsx.
 *
 * The owner's direction (recorded in src/lib/registers/oversight.ts): the
 * hands-on count-in / drop / blind-close drawer workflow belongs on the
 * FRONT-END iPad POS — the cashier does it at the register; the back office
 * is oversight. This module is the contract between the register UI and the
 * server route: three actions, each PIN-attributed to a human.
 *
 *   open  — count-in: full denomination breakdown; the total IS the float.
 *   drop  — mid-shift safe drop: amount in MINOR UNITS + drop window;
 *           optionally witnessed by a SECOND person's PIN.
 *   close — count-out: full denomination breakdown, recorded BLIND. The
 *           server never returns expected/variance here — the manager
 *           reveals that at reconcile in the back office.
 *
 * Money is always MINOR UNITS (cents) as integers. Denomination math is
 * shared with the back office via src/lib/registers/cash.ts (also pure).
 */

import { type DenomCounts, EMPTY_DENOMS, denomTotalMinor } from "@/lib/registers/cash";
import { validateSwapAmount } from "@/lib/registers/safe-core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TillOpenRequest = {
  action: "open";
  pin: string;
  denoms: DenomCounts;
};

export type TillDropRequest = {
  action: "drop";
  pin: string;
  /** MINOR units (cents), integer > 0. */
  amountMinor: number;
  window: "afternoon" | "night" | "other";
  /** Optional second person vouching for the drop (verified server-side). */
  witnessPin?: string;
  notes?: string;
};

export type TillCloseRequest = {
  action: "close";
  pin: string;
  denoms: DenomCounts;
  /**
   * Tips counted out of the tip jar at close, MINOR units (cents).
   * OMITTED = not recorded (drawer_sessions.tips_minor stays NULL);
   * 0 = the cashier explicitly counted a zero jar. Tips are the
   * employee's money and NEVER enter expected-close / over-short math.
   */
  tipsMinor?: number;
};

export type TillSwapRequest = {
  action: "swap";
  pin: string;
  /**
   * Value swapped with the safe, MINOR units (cents), integer > 0.
   * Value-neutral: big bills go IN, the exact same value comes OUT in
   * change — drawer expected-close math and the safe total are untouched,
   * but every trip into the safe leaves this record.
   */
  amountMinor: number;
  /** Manager/lead approval PIN — verified and role-gated server-side. */
  approverPin: string;
  notes?: string;
};

export type TillRequest = TillOpenRequest | TillDropRequest | TillCloseRequest | TillSwapRequest;

export type TillValidation = { ok: true; req: TillRequest } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Limits (absurdity guards, not policy)
// ---------------------------------------------------------------------------

/** Per-denomination count cap — nobody counts 100k of one bill into a drawer. */
export const MAX_DENOM_COUNT = 99_999;

/** Single-drop cap: $50,000 in cents. A cash-only day never drops more at once. */
export const MAX_DROP_MINOR = 5_000_000;

export const MAX_NOTES_LEN = 500;

/** Single-shift tips cap: $10,000 in cents. Nothing above this is a typo-free count. */
export const MAX_TIPS_MINOR = 1_000_000;

const DROP_WINDOWS = new Set(["afternoon", "night", "other"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a cashier-typed dollar string ("120", "$1,250.50") into MINOR units.
 * Returns null (never 0) for blank/invalid/negative input so the UI can
 * disable submit instead of silently recording a $0 drop.
 */
export function dollarsToMinor(raw: string): number | null {
  const cleaned = String(raw ?? "").replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/**
 * Parse a cashier-typed tips dollar string into MINOR units. Unlike
 * dollarsToMinor (where a $0 drop is meaningless), "0" here is a REAL
 * answer — the cashier counted an empty tip jar — so zero parses to 0.
 * Blank also returns 0 (treat an untouched field as "no tips").
 * Garbage, negatives, and sub-cent precision return null so the UI can
 * block submit instead of silently recording a wrong number.
 */
export function tipsToMinor(raw: string): number | null {
  const cleaned = String(raw ?? "").replace(/[$,\s]/g, "");
  if (!cleaned) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/**
 * Coerce an untrusted denoms object into a clamped DenomCounts: every known
 * key becomes a non-negative integer (capped), unknown keys are dropped.
 */
export function sanitizeDenoms(raw: unknown): DenomCounts {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: DenomCounts = { ...EMPTY_DENOMS };
  for (const k of Object.keys(out) as (keyof DenomCounts)[]) {
    const n = Math.floor(Number(src[k] ?? 0));
    out[k] = Number.isFinite(n) ? Math.min(MAX_DENOM_COUNT, Math.max(0, n)) : 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate an untrusted request body into a typed TillRequest. PIN FORMAT is
 * checked by the route with the shared isValidPin (same as /api/pos/unlock);
 * here we only require presence so this module stays free of staffing deps.
 */
export function validateTillRequest(body: unknown): TillValidation {
  if (!body || typeof body !== "object") return { ok: false, error: "Body must be JSON." };
  const b = body as Record<string, unknown>;

  const action = String(b.action ?? "");
  const pin = typeof b.pin === "string" ? b.pin.trim() : "";
  if (!pin) return { ok: false, error: "PIN is required." };

  if (action === "open" || action === "close") {
    const denoms = sanitizeDenoms(b.denoms);
    if (action === "open" && denomTotalMinor(denoms) <= 0) {
      return { ok: false, error: "Count in at least one bill or coin — an empty float cannot open a drawer." };
    }
    // A blind close of a genuinely empty drawer is legitimate (all cash was
    // dropped) — no minimum on close.
    if (action === "close" && b.tipsMinor !== undefined) {
      const tipsMinor = Number(b.tipsMinor);
      if (!Number.isInteger(tipsMinor) || tipsMinor < 0) {
        return { ok: false, error: "Tips must be zero or a positive whole number of cents." };
      }
      if (tipsMinor > MAX_TIPS_MINOR) {
        return { ok: false, error: "Tips amount is implausibly large — check the number." };
      }
      return { ok: true, req: { action, pin, denoms, tipsMinor } };
    }
    return { ok: true, req: { action, pin, denoms } };
  }

  if (action === "drop") {
    const amountMinor = Number(b.amountMinor);
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      return { ok: false, error: "Drop amount must be a positive whole number of cents." };
    }
    if (amountMinor > MAX_DROP_MINOR) {
      return { ok: false, error: "Drop amount is implausibly large — check the number." };
    }
    const window = String(b.window ?? "");
    if (!DROP_WINDOWS.has(window)) {
      return { ok: false, error: "Pick a drop window (afternoon, night, or other)." };
    }
    const witnessPin = typeof b.witnessPin === "string" && b.witnessPin.trim() ? b.witnessPin.trim() : undefined;
    const notesRaw = typeof b.notes === "string" ? b.notes.trim() : "";
    if (notesRaw.length > MAX_NOTES_LEN) {
      return { ok: false, error: `Notes must be ${MAX_NOTES_LEN} characters or fewer.` };
    }
    return {
      ok: true,
      req: {
        action,
        pin,
        amountMinor,
        window: window as "afternoon" | "night" | "other",
        ...(witnessPin ? { witnessPin } : {}),
        ...(notesRaw ? { notes: notesRaw } : {}),
      },
    };
  }

  if (action === "swap") {
    const amount = validateSwapAmount(b.amountMinor);
    if (!amount.ok) return { ok: false, error: amount.error };
    const approverPin = typeof b.approverPin === "string" ? b.approverPin.trim() : "";
    if (!approverPin) {
      return { ok: false, error: "A manager or lead must approve the swap with their PIN." };
    }
    const notesRaw = typeof b.notes === "string" ? b.notes.trim() : "";
    if (notesRaw.length > MAX_NOTES_LEN) {
      return { ok: false, error: `Notes must be ${MAX_NOTES_LEN} characters or fewer.` };
    }
    return {
      ok: true,
      req: {
        action,
        pin,
        amountMinor: amount.amountMinor,
        approverPin,
        ...(notesRaw ? { notes: notesRaw } : {}),
      },
    };
  }

  return { ok: false, error: "Unknown till action." };
}

// ---------------------------------------------------------------------------
// Self-tests (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runTillCoreTests(): void {
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`FAIL: ${msg}`);
    console.log(`PASS: ${msg}`);
  };

  // dollarsToMinor
  ok(dollarsToMinor("120") === 12000, "dollarsToMinor: whole dollars");
  ok(dollarsToMinor("$1,250.50") === 125050, "dollarsToMinor: strips $ and commas, keeps cents");
  ok(dollarsToMinor("0.05") === 5, "dollarsToMinor: nickels parse");
  ok(dollarsToMinor("") === null, "dollarsToMinor: blank is null, never 0");
  ok(dollarsToMinor("0") === null, "dollarsToMinor: zero rejected (a $0 drop is not a drop)");
  ok(dollarsToMinor("-20") === null, "dollarsToMinor: negatives rejected");
  ok(dollarsToMinor("12.345") === null, "dollarsToMinor: sub-cent precision rejected");
  ok(dollarsToMinor("abc") === null, "dollarsToMinor: garbage rejected");

  // sanitizeDenoms
  const d1 = sanitizeDenoms({ twenties: "3", ones: 4.9, pennies: -5, bogus: 99 });
  ok(d1.twenties === 3 && d1.ones === 4 && d1.pennies === 0, "sanitizeDenoms: coerces, floors, clamps negatives to 0");
  ok(!("bogus" in d1), "sanitizeDenoms: unknown keys dropped");
  ok(sanitizeDenoms({ hundreds: 1_000_000 }).hundreds === MAX_DENOM_COUNT, "sanitizeDenoms: caps absurd counts");
  ok(denomTotalMinor(sanitizeDenoms(null)) === 0, "sanitizeDenoms: non-object becomes empty denoms");

  // validateTillRequest — open
  const open1 = validateTillRequest({ action: "open", pin: "1234", denoms: { twenties: 5, ones: 10 } });
  ok(open1.ok && open1.req.action === "open" && denomTotalMinor(open1.req.denoms) === 11000,
    "open: valid count-in accepted with $110.00 float");
  const open2 = validateTillRequest({ action: "open", pin: "1234", denoms: {} });
  ok(!open2.ok, "open: empty float rejected");
  const open3 = validateTillRequest({ action: "open", pin: "", denoms: { ones: 1 } });
  ok(!open3.ok, "open: missing PIN rejected");

  // validateTillRequest — drop
  const drop1 = validateTillRequest({ action: "drop", pin: "1234", amountMinor: 50000, window: "afternoon" });
  ok(drop1.ok && drop1.req.action === "drop" && drop1.req.amountMinor === 50000 && drop1.req.witnessPin === undefined,
    "drop: valid unwitnessed $500.00 drop accepted");
  const drop2 = validateTillRequest({
    action: "drop", pin: "1234", amountMinor: 20000, window: "night", witnessPin: "5678", notes: "  end of night  ",
  });
  ok(drop2.ok && drop2.req.action === "drop" && drop2.req.witnessPin === "5678" && drop2.req.notes === "end of night",
    "drop: witness PIN and trimmed notes carried");
  ok(!validateTillRequest({ action: "drop", pin: "1234", amountMinor: 0, window: "other" }).ok,
    "drop: zero amount rejected");
  ok(!validateTillRequest({ action: "drop", pin: "1234", amountMinor: 100.5, window: "other" }).ok,
    "drop: non-integer cents rejected");
  ok(!validateTillRequest({ action: "drop", pin: "1234", amountMinor: MAX_DROP_MINOR + 1, window: "other" }).ok,
    "drop: implausibly large amount rejected");
  ok(!validateTillRequest({ action: "drop", pin: "1234", amountMinor: 500, window: "morning" }).ok,
    "drop: unknown window rejected");
  ok(!validateTillRequest({ action: "drop", pin: "1234", amountMinor: 500, window: "other", notes: "x".repeat(501) }).ok,
    "drop: oversized notes rejected");

  // validateTillRequest — close (BLIND: an all-dropped empty drawer may close at 0)
  const close1 = validateTillRequest({ action: "close", pin: "1234", denoms: {} });
  ok(close1.ok && close1.req.action === "close" && denomTotalMinor(close1.req.denoms) === 0,
    "close: zero-count blind close accepted (all cash was dropped)");
  ok(close1.ok && close1.req.action === "close" && close1.req.tipsMinor === undefined,
    "close: tips omitted stays omitted (tips_minor stays NULL — not recorded)");

  // tipsToMinor — "0" and blank are REAL answers (counted-zero / not recorded)
  ok(tipsToMinor("42.50") === 4250, "tipsToMinor: dollars and cents parse");
  ok(tipsToMinor("$1,250.50") === 125050, "tipsToMinor: strips $ and commas");
  ok(tipsToMinor("0") === 0, "tipsToMinor: zero is a real answer (empty jar counted)");
  ok(tipsToMinor("") === 0, "tipsToMinor: blank means no tips (0), never blocks close");
  ok(tipsToMinor("-5") === null, "tipsToMinor: negatives rejected");
  ok(tipsToMinor("12.345") === null, "tipsToMinor: sub-cent precision rejected");
  ok(tipsToMinor("abc") === null, "tipsToMinor: garbage rejected");

  // validateTillRequest — close with tips (employee money, separate from drawer)
  const closeTips = validateTillRequest({ action: "close", pin: "1234", denoms: { twenties: 2 }, tipsMinor: 4250 });
  ok(closeTips.ok && closeTips.req.action === "close" && closeTips.req.tipsMinor === 4250,
    "close: $42.50 tips carried through validation");
  const closeTips0 = validateTillRequest({ action: "close", pin: "1234", denoms: {}, tipsMinor: 0 });
  ok(closeTips0.ok && closeTips0.req.action === "close" && closeTips0.req.tipsMinor === 0,
    "close: explicit zero tips preserved (counted-zero, distinct from omitted)");
  ok(!validateTillRequest({ action: "close", pin: "1234", denoms: {}, tipsMinor: -1 }).ok,
    "close: negative tips rejected");
  ok(!validateTillRequest({ action: "close", pin: "1234", denoms: {}, tipsMinor: 10.5 }).ok,
    "close: non-integer tips cents rejected");
  ok(!validateTillRequest({ action: "close", pin: "1234", denoms: {}, tipsMinor: MAX_TIPS_MINOR + 1 }).ok,
    "close: implausibly large tips rejected");
  const openNoTips = validateTillRequest({ action: "open", pin: "1234", denoms: { ones: 1 }, tipsMinor: 500 });
  ok(openNoTips.ok && openNoTips.req.action === "open" && !("tipsMinor" in openNoTips.req),
    "open: stray tipsMinor ignored (tips only exist at close)");

  // validateTillRequest — swap (value-neutral change trade with the safe)
  const swap1 = validateTillRequest({ action: "swap", pin: "1234", amountMinor: 10000, approverPin: "5678" });
  ok(swap1.ok && swap1.req.action === "swap" && swap1.req.amountMinor === 10000 && swap1.req.approverPin === "5678",
    "swap: $100.00 change swap with manager approval accepted");
  const swap2 = validateTillRequest({
    action: "swap", pin: "1234", amountMinor: 2000, approverPin: "5678", notes: "  needed quarters  ",
  });
  ok(swap2.ok && swap2.req.action === "swap" && swap2.req.notes === "needed quarters",
    "swap: trimmed notes carried");
  ok(!validateTillRequest({ action: "swap", pin: "1234", amountMinor: 10000 }).ok,
    "swap: missing approver PIN rejected (every safe trip needs a manager)");
  ok(!validateTillRequest({ action: "swap", pin: "1234", amountMinor: 0, approverPin: "5678" }).ok,
    "swap: zero amount rejected");
  ok(!validateTillRequest({ action: "swap", pin: "1234", amountMinor: 200_001, approverPin: "5678" }).ok,
    "swap: implausibly large amount rejected");
  ok(!validateTillRequest({ action: "swap", pin: "1234", amountMinor: 100.5, approverPin: "5678" }).ok,
    "swap: non-integer cents rejected");
  ok(!validateTillRequest({ action: "swap", pin: "1234", amountMinor: 500, approverPin: "5678", notes: "x".repeat(501) }).ok,
    "swap: oversized notes rejected");

  // shape guards
  ok(!validateTillRequest(null).ok, "null body rejected");
  ok(!validateTillRequest({ action: "reconcile", pin: "1234" }).ok,
    "unknown action rejected (reconcile is a back-office manager step, never register-side)");

  console.log("till-core self-tests passed");
}
