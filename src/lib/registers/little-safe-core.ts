/**
 * src/lib/registers/little-safe-core.ts  (Fix Phase 2.7b: G-02, F-00-7, F-01-8)
 *
 * PURE rules for the two cash exchanges around the master till. Zero I/O.
 *
 * Owner, verbatim:
 *   request "Either morning or night employee can balance the master till
 *            using small bills from the little safe in exchange for big bills
 *            from the master."
 *   D3      "I just want to know when big bills leave the master till and go
 *            into the little safe. And what the small bills and coin are that
 *            came out of the little safe."
 *   D14     "Q02-1- yes you have that correct" (register swaps go till <->
 *            master till)
 *
 * 1. Master till <-> little safe exchange (form 8.2): OUT = big bills out of
 *    the master till into the little safe; IN = small bills and coin from the
 *    little safe into the master till. The two sides must be equal.
 *    There is NO little-safe balance or target (D3): nothing here adds one up.
 * 2. Register change swap (form 8.3), seen from the master till: IN = big
 *    bills in from the till; OUT = change out to the till. Equal, and equal
 *    to the swap amount.
 *
 * The database checks the same equality (0317 cash_denoms_total_minor).

 *
 * This module is bundled into the iPad register (till-core imports
 * checkSwapDenoms), so it must never import the workbook module or anything
 * server-only (tests/compliance/pos-register-app-guard.test.ts). The
 * "Exchanges" sheet is built in master-till-core.
 */

import { DENOM_FIELDS, EMPTY_DENOMS, denomTotalMinor, formatCents, type DenomCounts } from "@/lib/registers/cash";
import { MAX_SWAP_MINOR, SAFE_NOTES_MAX_LEN } from "@/lib/registers/safe-core";

/** PIN throttle scope for the little-safe exchange (separate from the count). */
export const LITTLE_SAFE_PIN_SCOPE = "backoffice-little-safe";

/** Per-denomination cap, the same as the till (till-core MAX_DENOM_COUNT) and the 0317 check. */
export const EXCHANGE_MAX_PIECES = 99_999;

/** Form field prefixes on the Store safe page. */
export const OUT_PREFIX = "out_";
export const IN_PREFIX = "in_";

/** Read 13 counts from untrusted input. Refuses (null) anything not a whole number 0..99,999. */
export function readDenoms(get: (key: keyof DenomCounts) => unknown): { ok: true; denoms: DenomCounts } | { ok: false; error: string } {
  const out: DenomCounts = { ...EMPTY_DENOMS };
  for (const d of DENOM_FIELDS) {
    const raw = get(d.key);
    if (raw === null || raw === undefined || raw === "") continue;
    const s = typeof raw === "number" ? String(raw) : String(raw).trim();
    if (s === "") continue;
    if (!/^\d+$/.test(s)) return { ok: false, error: `${d.label}: "${s}" is not a whole number of pieces.` };
    const n = Number(s);
    if (n > EXCHANGE_MAX_PIECES) return { ok: false, error: `${d.label}: ${n} pieces is more than ${EXCHANGE_MAX_PIECES.toLocaleString("en-US")}. Check the count.` };
    out[d.key] = n;
  }
  return { ok: true, denoms: out };
}

/** "5 × $20, 2 × $10" (high to low, non-zero only); "nothing" when empty. */
export function denomWords(d: Partial<DenomCounts> | null | undefined): string {
  if (!d) return "\u2014";
  const parts = DENOM_FIELDS.filter((f) => Math.floor(Number(d[f.key] ?? 0)) > 0).map(
    (f) => `${Math.floor(Number(d[f.key]))} \u00d7 ${f.label}`,
  );
  return parts.length === 0 ? "nothing" : parts.join(", ");
}

/** Only the non-zero denominations, as stored in jsonb (keeps rows small and readable). */
export function compactDenoms(d: DenomCounts): Partial<DenomCounts> {
  const out: Partial<DenomCounts> = {};
  for (const f of DENOM_FIELDS) if (d[f.key] > 0) out[f.key] = d[f.key];
  return out;
}

export type ExchangeInput = {
  outDenoms: DenomCounts;
  inDenoms: DenomCounts;
  valueMinor: number;
  notes: string | null;
};

/**
 * Master till <-> little safe (D3). Both sides by denomination, both more
 * than zero, the two exactly equal, no more than $2,000.00 (the swap cap).
 */
export function validateExchange(input: { outDenoms: DenomCounts; inDenoms: DenomCounts; notes?: string | null }):
  | { ok: true; exchange: ExchangeInput }
  | { ok: false; error: string } {
  const outMinor = denomTotalMinor(input.outDenoms);
  const inMinor = denomTotalMinor(input.inDenoms);
  if (outMinor <= 0) {
    return { ok: false, error: "Enter the big bills OUT of the master till (into the little safe), by denomination. Nothing was saved." };
  }
  if (inMinor <= 0) {
    return { ok: false, error: "Enter the small bills and coin IN from the little safe (into the master till), by denomination. Nothing was saved." };
  }
  if (outMinor !== inMinor) {
    const diff = outMinor - inMinor;
    return {
      ok: false,
      error:
        `The two sides are not equal: OUT of the master till ${formatCents(outMinor)}, IN from the little safe ${formatCents(inMinor)} ` +
        `(${diff > 0 ? "OUT" : "IN"} is ${formatCents(Math.abs(diff))} more). An exchange must be the same value both ways. Recount both sides. Nothing was saved.`,
    };
  }
  if (outMinor > MAX_SWAP_MINOR) {
    return { ok: false, error: `${formatCents(outMinor)} is more than ${formatCents(MAX_SWAP_MINOR)} for one exchange. Check the counts. Nothing was saved.` };
  }
  const notes = (input.notes ?? "").trim();
  if (notes.length > SAFE_NOTES_MAX_LEN) {
    return { ok: false, error: `Notes must be ${SAFE_NOTES_MAX_LEN} characters or fewer. Nothing was saved.` };
  }
  return { ok: true, exchange: { outDenoms: input.outDenoms, inDenoms: input.inDenoms, valueMinor: outMinor, notes: notes || null } };
}

/**
 * Register change swap (F-01-8). Before Phase 2.7b the register sent a value
 * only; an iPad app built before then still does, so a swap with NO bills is
 * still accepted (SOP-02 form 8.3 covers it until the iPad is rebuilt). When
 * bills are sent, BOTH sides are required and each must equal the amount.
 */
export function checkSwapDenoms(
  amountMinor: number,
  inRaw: unknown,
  outRaw: unknown,
): { ok: true; inDenoms: DenomCounts | null; outDenoms: DenomCounts | null } | { ok: false; error: string } {
  const none = (v: unknown) => v === undefined || v === null;
  if (none(inRaw) && none(outRaw)) return { ok: true, inDenoms: null, outDenoms: null };
  if (none(inRaw) || none(outRaw) || typeof inRaw !== "object" || typeof outRaw !== "object") {
    return { ok: false, error: "Enter the bills both ways: the big bills going to the safe and the change coming back." };
  }
  const a = readDenoms((k) => (inRaw as Record<string, unknown>)[k]);
  if (!a.ok) return { ok: false, error: `Big bills to the safe: ${a.error}` };
  const b = readDenoms((k) => (outRaw as Record<string, unknown>)[k]);
  if (!b.ok) return { ok: false, error: `Change back: ${b.error}` };
  const inMinor = denomTotalMinor(a.denoms);
  const outMinor = denomTotalMinor(b.denoms);
  if (inMinor !== amountMinor) {
    return { ok: false, error: `The big bills to the safe add up to ${formatCents(inMinor)}, not the swap amount ${formatCents(amountMinor)}.` };
  }
  if (outMinor !== amountMinor) {
    return {
      ok: false,
      error: `The change back adds up to ${formatCents(outMinor)}, but the big bills are ${formatCents(amountMinor)}. A swap must be the same value both ways.`,
    };
  }
  return { ok: true, inDenoms: a.denoms, outDenoms: b.denoms };
}

/* ── Rows for the page, the sheet and the export ── */

export type LittleSafeExchangeRowLike = {
  id: string;
  business_day: string;
  out_denoms: unknown;
  in_denoms: unknown;
  value_minor: number;
  recorded_by: string | null;
  notes: string | null;
  occurred_at: string;
};

export type SheetExchange = {
  id: string;
  businessDay: string;
  occurredAt: string;
  valueMinor: number;
  outWords: string;
  inWords: string;
  recordedByName: string;
  notes: string | null;
};

function asDenoms(v: unknown): Partial<DenomCounts> | null {
  return v && typeof v === "object" ? (v as Partial<DenomCounts>) : null;
}

export function sheetExchangeFromRow(r: LittleSafeExchangeRowLike, nameFor: (id: string | null) => string): SheetExchange {
  return {
    id: r.id,
    businessDay: r.business_day,
    occurredAt: r.occurred_at,
    valueMinor: r.value_minor,
    outWords: denomWords(asDenoms(r.out_denoms)),
    inWords: denomWords(asDenoms(r.in_denoms)),
    recordedByName: nameFor(r.recorded_by),
    notes: r.notes,
  };
}

/** A swap's bills in words, or the plain note that it was recorded as a value only. */
export const VALUE_ONLY_WORDS = "not recorded (value only)";

export function swapBillWords(inRaw: unknown, outRaw: unknown): { inWords: string; outWords: string } {
  const a = asDenoms(inRaw);
  const b = asDenoms(outRaw);
  if (!a || !b) return { inWords: VALUE_ONLY_WORDS, outWords: VALUE_ONLY_WORDS };
  return { inWords: denomWords(a), outWords: denomWords(b) };
}

/* ── Self-tests (scripts/compliance/run-pure-selftests.ts) ── */

export function __runLittleSafeTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`FAIL little-safe-core: ${m}`);
    }
  };
  const D = (p: Partial<DenomCounts>): DenomCounts => ({ ...EMPTY_DENOMS, ...p });

  // D3: 5 × $20 out, 10 × $5 + 40 × $1 + 40 × 25¢ in = $100.00 each side.
  const good = validateExchange({ outDenoms: D({ twenties: 5 }), inDenoms: D({ fives: 10, ones: 40, quarters: 40 }), notes: "  pm  " });
  ok(good.ok && good.exchange.valueMinor === 10_000 && good.exchange.notes === "pm", "equal $100.00 exchange accepted, notes trimmed");
  const uneq = validateExchange({ outDenoms: D({ twenties: 5 }), inDenoms: D({ fives: 10, ones: 40 }) });
  ok(!uneq.ok && uneq.error.startsWith("The two sides are not equal: OUT of the master till $100.00, IN from the little safe $90.00 (OUT is $10.00 more)"), "unequal refused with both totals");
  const uneq2 = validateExchange({ outDenoms: D({ twenties: 1 }), inDenoms: D({ tens: 3 }) });
  ok(!uneq2.ok && uneq2.error.includes("(IN is $10.00 more)"), "IN larger named");
  ok(!validateExchange({ outDenoms: D({}), inDenoms: D({ ones: 5 }) }).ok, "empty OUT refused");
  ok(!validateExchange({ outDenoms: D({ fives: 1 }), inDenoms: D({}) }).ok, "empty IN refused");
  const big = validateExchange({ outDenoms: D({ hundreds: 21 }), inDenoms: D({ twenties: 105 }) });
  ok(!big.ok && big.error.includes("more than $2,000.00"), "over $2,000.00 refused");
  ok(validateExchange({ outDenoms: D({ hundreds: 20 }), inDenoms: D({ twenties: 100 }) }).ok, "exactly $2,000.00 allowed");
  ok(!validateExchange({ outDenoms: D({ ones: 1 }), inDenoms: D({ quarters: 4 }), notes: "x".repeat(501) }).ok, "long notes refused");
  ok(validateExchange({ outDenoms: D({ ones: 1 }), inDenoms: D({ quarters: 4 }), notes: "x".repeat(500) }).ok, "500-char notes allowed");
  const blankNotes = validateExchange({ outDenoms: D({ ones: 1 }), inDenoms: D({ quarters: 4 }), notes: "   " });
  ok(blankNotes.ok && blankNotes.exchange.notes === null, "blank notes become null");

  const r1 = readDenoms((k) => ({ twenties: "5", ones: "", tens: 2 } as Record<string, unknown>)[k]);
  ok(r1.ok && r1.denoms.twenties === 5 && r1.denoms.tens === 2 && r1.denoms.ones === 0, "readDenoms reads strings, numbers and blanks");
  const r2 = readDenoms((k) => (k === "fives" ? "2.5" : undefined));
  ok(!r2.ok && r2.error === '$5: "2.5" is not a whole number of pieces.', "readDenoms refuses fractions");
  ok(!readDenoms((k) => (k === "ones" ? "-1" : undefined)).ok, "readDenoms refuses negatives");
  const r3 = readDenoms((k) => (k === "ones" ? "100000" : undefined));
  ok(!r3.ok && r3.error.startsWith("$1: 100000 pieces is more than 99,999"), "readDenoms refuses absurd counts");
  ok(readDenoms((k) => (k === "ones" ? "99999" : undefined)).ok, "99,999 pieces allowed");

  ok(denomWords(D({ twenties: 5, quarters: 40, ones: 2 })) === "5 \u00d7 $20, 2 \u00d7 $1, 40 \u00d7 25\u00a2", "words high to low");
  ok(denomWords(D({})) === "nothing" && denomWords(null) === "\u2014", "words for empty and missing");
  ok(JSON.stringify(compactDenoms(D({ fives: 3 }))) === '{"fives":3}', "compact keeps non-zero only");

  // Register swap bills (F-01-8).
  const s0 = checkSwapDenoms(10_000, undefined, undefined);
  ok(s0.ok && s0.inDenoms === null && s0.outDenoms === null, "old iPad build: no bills still accepted");
  const s1 = checkSwapDenoms(10_000, { twenties: 5 }, { fives: 10, ones: 50 });
  ok(s1.ok && s1.inDenoms?.twenties === 5 && s1.outDenoms?.ones === 50, "swap with equal bills accepted");
  ok(!checkSwapDenoms(10_000, { twenties: 5 }, undefined).ok, "one side only refused");
  ok(!checkSwapDenoms(10_000, "x", { twenties: 5 }).ok, "non-object refused");
  const s2 = checkSwapDenoms(10_000, { twenties: 4 }, { fives: 16 });
  ok(!s2.ok && s2.error === "The big bills to the safe add up to $80.00, not the swap amount $100.00.", "IN side must equal the amount");
  const s3 = checkSwapDenoms(10_000, { twenties: 5 }, { fives: 19 });
  ok(!s3.ok && s3.error.startsWith("The change back adds up to $95.00"), "OUT side must equal the amount");
  const s4 = checkSwapDenoms(10_000, { twenties: "x" }, { fives: 20 });
  ok(!s4.ok && s4.error.startsWith("Big bills to the safe: $20"), "bad piece count refused");
  const s5 = checkSwapDenoms(10_000, { twenties: 5 }, { fives: -20 });
  ok(!s5.ok && s5.error.startsWith("Change back: $5"), "bad change count refused");

  const w0 = swapBillWords(null, null);
  ok(w0.inWords === VALUE_ONLY_WORDS && w0.outWords === VALUE_ONLY_WORDS, "pre-0317 swap shows value only");
  const w1 = swapBillWords({ twenties: 5 }, { fives: 20 });
  ok(w1.inWords === "5 \u00d7 $20" && w1.outWords === "20 \u00d7 $5", "swap bill words");

  const names = (id: string | null) => (id === "e1" ? "Ann" : "\u2014");
  const ex = sheetExchangeFromRow(
    { id: "x1", business_day: "2026-11-02", out_denoms: { twenties: 5 }, in_denoms: { fives: 20 }, value_minor: 10_000, recorded_by: "e1", notes: null, occurred_at: "2026-11-02T20:00:00Z" },
    names,
  );
  ok(ex.recordedByName === "Ann" && ex.outWords === "5 \u00d7 $20" && ex.inWords === "20 \u00d7 $5" && ex.valueMinor === 10_000, "row mapping");
  ok(LITTLE_SAFE_PIN_SCOPE === "backoffice-little-safe" && OUT_PREFIX === "out_" && IN_PREFIX === "in_", "scope and prefixes");

  return { passed, failed };
}
