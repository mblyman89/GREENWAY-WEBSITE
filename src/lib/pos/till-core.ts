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
 *           Owner D121 (2026-11-01, supersedes the Phase 2.2 on-iPad second
 *           count): the close is ONE person — count the bills, enter tips,
 *           enter your own PIN, done. The second count happens later in the
 *           back office (D122). A second PIN / count sent by an old cached
 *           register build is ignored, never required.
 *
 * Money is always MINOR UNITS (cents) as integers. Denomination math is
 * shared with the back office via src/lib/registers/cash.ts (also pure).
 */

import { type DenomCounts, EMPTY_DENOMS, denomTotalMinor } from "@/lib/registers/cash";
import { validateAtmDropFields } from "@/lib/registers/atm-drop-core";
import { validateSwapAmount } from "@/lib/registers/safe-core";
import { checkSwapDenoms } from "@/lib/registers/little-safe-core";
import { splitTipPool } from "@/lib/registers/shift-end-core";
import { checkZeroClose } from "@/lib/registers/drawer-correction-core";

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
  /**
   * D198: where the cash went. Absent = "safe" (every build before D198). For "atm" the amount is
   * ALWAYS twentiesCount x $20 (the ATM holds $20s only; the count is what the employee types).
   */
  destination?: "safe" | "atm";
  twentiesCount?: number;
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
  /**
   * Fix Phase 6 (G-64, owner D89 / Q-E-10): the crew's pooled tip jar and how
   * many people share it. When present, the SERVER works out this cashier's
   * even share (shift-end-core#splitTipPool) and that share is `tipsMinor`;
   * a tipsMinor sent alongside is ignored, so the screen cannot record a
   * different figure from the split.
   */
  tipPool?: { poolMinor: number; people: number; shareMinor: number; leftoverMinor: number };
  /**
   * Owner D125 (2026-11-02): a $0.00 close is only accepted when the closer
   * ticked "The drawer is really empty". Present (true) only on a $0.00 close.
   */
  confirmedEmpty?: true;
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
  /**
   * Fix Phase 2.7b (F-01-8, owner D3): the bills both ways. inDenoms = big
   * bills from the till to the master till; outDenoms = change back. Each
   * must equal amountMinor. Both absent from an iPad build made before 2.7b.
   */
  inDenoms?: DenomCounts;
  outDenoms?: DenomCounts;
};

/**
 * Owner D130 (2026-11-02): open the drawer for the blind count. Only the
 * cashier working the drawer (drawer-pop-core#custodianOf) may; the route
 * checks the PIN. A repeat open on the same drawer needs a reason (D131).
 * Moves no cash and never returns an expected figure.
 */
export type TillPopRequest = {
  action: "pop";
  pin: string;
  reason?: string;
};

export type TillRequest = TillOpenRequest | TillDropRequest | TillCloseRequest | TillSwapRequest | TillPopRequest;

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
    if (action === "open") return { ok: true, req: { action, pin, denoms } };
    // A blind close of a genuinely empty drawer is legitimate (all cash was
    // dropped), but owner D125: a $0.00 close must be CONFIRMED. On
    // 2026-11-01 SR2 was closed at $0.00 by mistake with $2,678.10 in it.
    const zero = checkZeroClose(denomTotalMinor(denoms), b.confirmEmpty);
    if (!zero.ok) return { ok: false, error: zero.error };
    const empty = zero.confirmedEmpty ? { confirmedEmpty: true as const } : {};
    // Owner D121: one person closes. No second PIN or second count here; the
    // second count is done in the back office (D122). Anything an old
    // register build still sends for a second count is ignored.
    // Fix Phase 6 (G-64, owner D89): crew tip pool -> this cashier's share.
    if (b.tipPool !== undefined && b.tipPool !== null) {
      const tp = b.tipPool as { poolMinor?: unknown; people?: unknown };
      const poolMinor = Number(tp.poolMinor);
      if (Number.isInteger(poolMinor) && poolMinor > MAX_TIPS_MINOR) {
        return { ok: false, error: "Tip pool amount is implausibly large \u2014 check the number." };
      }
      const split = splitTipPool(poolMinor, Number(tp.people));
      if (!split.ok) return { ok: false, error: split.error };
      return {
        ok: true,
        req: {
          action,
          pin,
          denoms,
          tipsMinor: split.shareMinor,
          tipPool: { poolMinor: split.poolMinor, people: split.people, shareMinor: split.shareMinor, leftoverMinor: split.leftoverMinor },
          ...empty,
        },
      };
    }
    if (b.tipsMinor !== undefined) {
      const tipsMinor = Number(b.tipsMinor);
      if (!Number.isInteger(tipsMinor) || tipsMinor < 0) {
        return { ok: false, error: "Tips must be zero or a positive whole number of cents." };
      }
      if (tipsMinor > MAX_TIPS_MINOR) {
        return { ok: false, error: "Tips amount is implausibly large — check the number." };
      }
      return { ok: true, req: { action, pin, denoms, tipsMinor, ...empty } };
    }
    return { ok: true, req: { action, pin, denoms, ...empty } };
  }

  if (action === "drop") {
    // D198: an ATM drop is a COUNT of $20 bills; the amount is derived from it, never trusted.
    const atm = validateAtmDropFields({ destination: b.destination, twentiesCount: b.twentiesCount, amountMinor: b.amountMinor });
    if (!atm.ok) return { ok: false, error: atm.error };
    const amountMinor = atm.destination === "atm" ? atm.amountMinor : Number(b.amountMinor);
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
        ...(atm.destination === "atm" ? { destination: "atm" as const, twentiesCount: atm.twentiesCount } : {}),
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
    // Fix Phase 2.7b (F-01-8): bills both ways, each equal to the amount.
    const bills = checkSwapDenoms(amount.amountMinor, b.inDenoms, b.outDenoms);
    if (!bills.ok) return { ok: false, error: bills.error };
    return {
      ok: true,
      req: {
        action,
        pin,
        amountMinor: amount.amountMinor,
        approverPin,
        ...(notesRaw ? { notes: notesRaw } : {}),
        ...(bills.inDenoms && bills.outDenoms ? { inDenoms: bills.inDenoms, outDenoms: bills.outDenoms } : {}),
      },
    };
  }

  if (action === "pop") {
    // Owner D130/D131: the reason is checked against the drawer's history in
    // the route (drawer-pop-core#checkPop); here only its shape.
    const reasonRaw = typeof b.reason === "string" ? b.reason.trim() : "";
    if (reasonRaw.length > MAX_NOTES_LEN) {
      return { ok: false, error: `The reason must be ${MAX_NOTES_LEN} characters or fewer.` };
    }
    return { ok: true, req: { action, pin, ...(reasonRaw ? { reason: reasonRaw } : {}) } };
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
  ok(drop1.ok && drop1.req.action === "drop" && drop1.req.destination === undefined,
    "drop (D198): no destination = a safe drop, exactly as every older build sends it");
  const atmDrop = validateTillRequest({ action: "drop", pin: "1234", destination: "atm", twentiesCount: 80, window: "afternoon" });
  ok(atmDrop.ok && atmDrop.req.action === "drop" && atmDrop.req.destination === "atm" && atmDrop.req.twentiesCount === 80 && atmDrop.req.amountMinor === 160000,
    "drop (D198): ATM drop of 80 x $20 -> $1,600.00, amount derived from the count");
  ok(validateTillRequest({ action: "drop", pin: "1234", destination: "atm", twentiesCount: 5, amountMinor: 10000, window: "other" }).ok,
    "drop (D198): ATM drop with a matching amount accepted");
  ok(!validateTillRequest({ action: "drop", pin: "1234", destination: "atm", twentiesCount: 5, amountMinor: 10500, window: "other" }).ok,
    "drop (D198): ATM drop whose amount is not count x $20 refused");
  ok(!validateTillRequest({ action: "drop", pin: "1234", destination: "atm", window: "other", amountMinor: 2000 }).ok,
    "drop (D198): ATM drop without a $20 count refused");
  ok(!validateTillRequest({ action: "drop", pin: "1234", destination: "atm", twentiesCount: 2.5, window: "other" }).ok,
    "drop (D198): half a bill refused");
  ok(!validateTillRequest({ action: "drop", pin: "1234", destination: "vault", amountMinor: 2000, window: "other" }).ok,
    "drop (D198): unknown destination refused");
  ok(!validateTillRequest({ action: "drop", pin: "1234", destination: "safe", twentiesCount: 3, amountMinor: 6000, window: "other" }).ok,
    "drop (D198): a safe drop does not carry a $20 count");
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
  const close1 = validateTillRequest({ action: "close", pin: "1234", denoms: {}, confirmEmpty: true });
  ok(close1.ok && close1.req.action === "close" && denomTotalMinor(close1.req.denoms) === 0 && close1.req.confirmedEmpty === true,
    "close: zero-count blind close accepted when confirmed empty (all cash was dropped, D125)");
  ok(!validateTillRequest({ action: "close", pin: "1234", denoms: {} }).ok,
    "close: a $0.00 close WITHOUT the 'really empty' tick is refused (D125)");
  const notZero = validateTillRequest({ action: "close", pin: "1234", denoms: { ones: 1 }, confirmEmpty: true });
  ok(notZero.ok && notZero.req.action === "close" && notZero.req.confirmedEmpty === undefined,
    "close: the tick is ignored on a non-zero count (D125)");
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

  // Fix Phase 6 (G-64, owner D89): crew tip pool, split by the server
  const pool = validateTillRequest({ action: "close", pin: "1234", denoms: {}, confirmEmpty: true, tipPool: { poolMinor: 8501, people: 2 }, tipsMinor: 99999 });
  ok(pool.ok && pool.req.action === "close" && pool.req.tipsMinor === 4250 && pool.req.tipPool?.leftoverMinor === 1,
    "close: tip pool $85.01 / 2 -> $42.50 share recorded, typed tipsMinor ignored, 1 cent left in the jar");
  ok(!validateTillRequest({ action: "close", pin: "1234", denoms: {}, confirmEmpty: true, tipPool: { poolMinor: 100, people: 0 } }).ok,
    "close: tip pool with zero people refused");
  ok(!validateTillRequest({ action: "close", pin: "1234", denoms: {}, confirmEmpty: true, tipPool: { poolMinor: MAX_TIPS_MINOR + 1, people: 2 } }).ok,
    "close: implausibly large tip pool refused");

  // validateTillRequest — close with tips (employee money, separate from drawer)
  const closeTips = validateTillRequest({ action: "close", pin: "1234", denoms: { twenties: 2 }, tipsMinor: 4250 });
  ok(closeTips.ok && closeTips.req.action === "close" && closeTips.req.tipsMinor === 4250,
    "close: $42.50 tips carried through validation");
  const closeTips0 = validateTillRequest({ action: "close", pin: "1234", denoms: {}, confirmEmpty: true, tipsMinor: 0 });
  ok(closeTips0.ok && closeTips0.req.action === "close" && closeTips0.req.tipsMinor === 0,
    "close: explicit zero tips preserved (counted-zero, distinct from omitted)");
  ok(!validateTillRequest({ action: "close", pin: "1234", denoms: {}, confirmEmpty: true, tipsMinor: -1 }).ok,
    "close: negative tips rejected");
  ok(!validateTillRequest({ action: "close", pin: "1234", denoms: {}, confirmEmpty: true, tipsMinor: 10.5 }).ok,
    "close: non-integer tips cents rejected");
  ok(!validateTillRequest({ action: "close", pin: "1234", denoms: {}, confirmEmpty: true, tipsMinor: MAX_TIPS_MINOR + 1 }).ok,
    "close: implausibly large tips rejected");
  const openNoTips = validateTillRequest({ action: "open", pin: "1234", denoms: { ones: 1 }, tipsMinor: 500 });
  ok(openNoTips.ok && openNoTips.req.action === "open" && !("tipsMinor" in openNoTips.req),
    "open: stray tipsMinor ignored (tips only exist at close)");

  // validateTillRequest — close is ONE person (owner D121, 2026-11-01)
  const solo = validateTillRequest({ action: "close", pin: "1234", denoms: { ones: 3 } });
  ok(solo.ok && solo.req.action === "close" && denomTotalMinor(solo.req.denoms) === 300,
    "close: count + own PIN is enough (no second PIN, owner D121)");
  const oldBuild = validateTillRequest({ action: "close", pin: "1234", secondPin: " 5678 ", secondDenoms: { twenties: 2 }, denoms: { twenties: 2 } });
  ok(oldBuild.ok && oldBuild.req.action === "close" && !("secondPin" in oldBuild.req) && !("secondDenoms" in oldBuild.req),
    "close: a second PIN / count from an old register build is ignored, never stored");
  const openNoSecond = validateTillRequest({ action: "open", pin: "1234", denoms: { ones: 1 }, secondPin: "5678" });
  ok(openNoSecond.ok && openNoSecond.req.action === "open" && !("secondPin" in openNoSecond.req),
    "open: no second count at count-in");

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
  // Fix Phase 2.7b (F-01-8): bills both ways.
  const swapBills = validateTillRequest({
    action: "swap", pin: "1234", amountMinor: 10000, approverPin: "5678",
    inDenoms: { twenties: 5 }, outDenoms: { fives: 10, ones: 50 },
  });
  ok(swapBills.ok && swapBills.req.action === "swap" && swapBills.req.inDenoms?.twenties === 5 && swapBills.req.outDenoms?.ones === 50,
    "swap: bills both ways carried");
  ok(!validateTillRequest({ action: "swap", pin: "1234", amountMinor: 10000, approverPin: "5678", inDenoms: { twenties: 5 }, outDenoms: { fives: 19 } }).ok,
    "swap: unequal change refused");
  ok(!validateTillRequest({ action: "swap", pin: "1234", amountMinor: 10000, approverPin: "5678", inDenoms: { twenties: 5 } }).ok,
    "swap: one side only refused");

  // Owner D130/D131: open the drawer for the blind count.
  const pop1 = validateTillRequest({ action: "pop", pin: "1234" });
  ok(pop1.ok && pop1.req.action === "pop" && !("reason" in pop1.req), "pop: PIN only accepted");
  const pop2 = validateTillRequest({ action: "pop", pin: "1234", reason: "  it shut  " });
  ok(pop2.ok && pop2.req.action === "pop" && pop2.req.reason === "it shut", "pop: trimmed reason carried");
  ok(!validateTillRequest({ action: "pop", pin: "1234", reason: "x".repeat(501) }).ok, "pop: oversized reason rejected");
  ok(!validateTillRequest({ action: "pop", pin: "" }).ok, "pop: PIN required");

  // shape guards
  ok(!validateTillRequest(null).ok, "null body rejected");
  ok(!validateTillRequest({ action: "reconcile", pin: "1234" }).ok,
    "unknown action rejected (reconcile is a back-office manager step, never register-side)");

  console.log("till-core self-tests passed");
}
