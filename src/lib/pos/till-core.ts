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
};

export type TillRequest = TillOpenRequest | TillDropRequest | TillCloseRequest;

export type TillValidation = { ok: true; req: TillRequest } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Limits (absurdity guards, not policy)
// ---------------------------------------------------------------------------

/** Per-denomination count cap — nobody counts 100k of one bill into a drawer. */
export const MAX_DENOM_COUNT = 99_999;

/** Single-drop cap: $50,000 in cents. A cash-only day never drops more at once. */
export const MAX_DROP_MINOR = 5_000_000;

export const MAX_NOTES_LEN = 500;

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

  // shape guards
  ok(!validateTillRequest(null).ok, "null body rejected");
  ok(!validateTillRequest({ action: "reconcile", pin: "1234" }).ok,
    "unknown action rejected (reconcile is a back-office manager step, never register-side)");

  console.log("till-core self-tests passed");
}
