/**
 * src/lib/registers/drop-bills-core.ts  (D217)
 *
 * Owner (verbatim in docs/sop-program/00-OWNER-REQUEST-VERBATIM.md, D217):
 *   "the register told the employee to withdraw x amount of money, but it told
 *    them it needed to be in 20s. ... When the register tells the employee to
 *    make a drop, it should be more clear about how it wants that removed.
 *    Should we require they enter the quantities of the bills taken?"
 *
 * Production (2026-11-08): two safe drops were TYPED as dollar amounts. One
 * recorded $2,080.00 (the suggested figure) while its own note says "actual
 * amount dropped 1540". The other wrote the bills into the note by hand
 * ("3-$100. 1-$50 103-$20 10-$1"). A typed total cannot be checked; a bill
 * count can (it is what the safe count and the deposit are counted in).
 *
 * So a SAFE drop from the iPad is now a COUNT of bills, like the ATM drop is a
 * count of $20s: the employee enters how many of each bill they took, and the
 * amount is ADDED UP, never typed. The server re-adds the bills and refuses a
 * drop whose amount disagrees.
 *
 * PURE and framework-free: bundled into the iPad register app.
 */
import type { DenomCounts } from "./cash";

/** Bills a safe drop may carry (coins stay in the drawer). Largest first. */
export const DROP_BILL_FIELDS: readonly { key: DropBillKey; label: string; cents: number }[] = [
  { key: "hundreds", label: "$100", cents: 10000 },
  { key: "fifties", label: "$50", cents: 5000 },
  { key: "twenties", label: "$20", cents: 2000 },
  { key: "tens", label: "$10", cents: 1000 },
  { key: "fives", label: "$5", cents: 500 },
  { key: "twos", label: "$2", cents: 200 },
  { key: "ones", label: "$1", cents: 100 },
];

export type DropBillKey = "hundreds" | "fifties" | "twenties" | "tens" | "fives" | "twos" | "ones";
export type DropBills = Partial<Record<DropBillKey, number>>;

/** Most of one bill in a single drop (far above any real drawer). */
export const MAX_DROP_BILLS_EACH = 2500;

/** Total of a bill count, cents. */
export function dropBillsTotalMinor(b: DropBills | null | undefined): number {
  if (!b) return 0;
  let t = 0;
  for (const f of DROP_BILL_FIELDS) t += Math.max(0, Math.floor(Number(b[f.key] ?? 0) || 0)) * f.cents;
  return t;
}

/** Only the non-zero bills, largest first (what is stored and audited). */
export function compactDropBills(b: DropBills | null | undefined): DropBills {
  const out: DropBills = {};
  if (!b) return out;
  for (const f of DROP_BILL_FIELDS) {
    const n = Math.max(0, Math.floor(Number(b[f.key] ?? 0) || 0));
    if (n > 0) out[f.key] = n;
  }
  return out;
}

/** "3 x $100, 1 x $50, 103 x $20, 10 x $1" (or "no bills"). */
export function dropBillsWords(b: DropBills | null | undefined): string {
  const c = compactDropBills(b);
  const parts = DROP_BILL_FIELDS.filter((f) => c[f.key]).map((f) => `${c[f.key]} \u00d7 ${f.label}`);
  return parts.length ? parts.join(", ") : "no bills";
}

export type DropBillsParse = { ok: true; bills: DropBills; amountMinor: number } | { ok: false; error: string };

/**
 * Validate an untrusted bill count (server and iPad). Only bill keys, whole
 * numbers 0..MAX_DROP_BILLS_EACH, at least one bill. Coins are refused: they
 * stay in the drawer.
 */
export function parseDropBills(raw: unknown): DropBillsParse {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Enter how many of each bill you are taking out." };
  const r = raw as Record<string, unknown>;
  const allowed = new Set<string>(DROP_BILL_FIELDS.map((f) => f.key));
  for (const k of Object.keys(r)) {
    if (!allowed.has(k)) return { ok: false, error: `A drop carries bills only ($1 to $100); "${k}" is not one. Coins stay in the drawer.` };
  }
  const bills: DropBills = {};
  for (const f of DROP_BILL_FIELDS) {
    const v = r[f.key];
    if (v === undefined || v === null || v === "") continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) return { ok: false, error: `The ${f.label} count must be a whole number.` };
    if (n > MAX_DROP_BILLS_EACH) return { ok: false, error: `${n} \u00d7 ${f.label} is more than one drop can hold. Check the count.` };
    if (n > 0) bills[f.key] = n;
  }
  const amountMinor = dropBillsTotalMinor(bills);
  if (amountMinor <= 0) return { ok: false, error: "Enter how many of each bill you are taking out." };
  return { ok: true, bills, amountMinor };
}

/** Do the bills add up to the amount? (server check; the amount must come from the bills). */
export function billsMatchAmount(bills: DropBills, amountMinor: number): boolean {
  return dropBillsTotalMinor(bills) === amountMinor;
}

/** Bills as a full DenomCounts row (coins 0), for code that takes a drawer count. */
export function dropBillsAsDenoms(b: DropBills): DenomCounts {
  const c = compactDropBills(b);
  return {
    pennies: 0, nickels: 0, dimes: 0, quarters: 0, half_dollars: 0, dollar_coins: 0,
    ones: c.ones ?? 0, twos: c.twos ?? 0, fives: c.fives ?? 0, tens: c.tens ?? 0,
    twenties: c.twenties ?? 0, fifties: c.fifties ?? 0, hundreds: c.hundreds ?? 0,
  };
}

/** Note tag used until migration 0349 (drawer_drops.bills) is applied, so the count is never lost. */
const BILLS_TAG_RE = /\[bills: [^\]]{1,200}\]/;

/** Append "[bills: 3 \u00d7 $100, ...]" to a drop note (once). Notes stay within 500 chars. */
export function withDropBillsNoteTag(notes: string | null | undefined, bills: DropBills): string {
  const base = String(notes ?? "").trim();
  if (BILLS_TAG_RE.test(base)) return base;
  const tag = `[bills: ${dropBillsWords(bills)}]`;
  const joined = base ? `${base} ${tag}` : tag;
  return joined.length <= 500 ? joined : `${base.slice(0, Math.max(0, 499 - tag.length))} ${tag}`.trim();
}

/** Read the bill tag back (null when absent). */
export function hasDropBillsNoteTag(notes: string | null | undefined): boolean {
  return BILLS_TAG_RE.test(String(notes ?? ""));
}

/**
 * Add a safe drop's bills to the insert rows built by atm-drop-core's buildDropInsertRows (kept
 * separate so atm-drop-core still imports nothing). The rows a writer then tries, in order:
 *   full        - with bills (migration 0349 applied)
 *   fullNoBills - the 0346 shape, the bills kept in the note tag (0346 applied, 0349 not yet)
 *   fallback    - the pre-0346 shape, the bills kept in the note tag
 * An ATM drop (destination "atm") or no bills: the rows are returned unchanged.
 */
export function addBillsToDropRows(
  rows: { full: Record<string, unknown>; fallback: Record<string, unknown> },
  bills: DropBills | null | undefined,
): { full: Record<string, unknown>; fullNoBills?: Record<string, unknown>; fallback: Record<string, unknown> } {
  const c = compactDropBills(bills);
  if (rows.full.destination === "atm" || Object.keys(c).length === 0) return rows;
  const notes = withDropBillsNoteTag(rows.full.notes as string | null | undefined, c);
  return {
    full: { ...rows.full, bills: c },
    fullNoBills: { ...rows.full, notes },
    fallback: { ...rows.fallback, notes: withDropBillsNoteTag(rows.fallback.notes as string | null | undefined, c) },
  };
}

/** The "how to take it out" sentence the drop reminder and the drop screen show. */
export const DROP_HOW_TO =
  "Take the big bills first ($100s, $50s, then $20s). Leave about $500 plus the starting cash ($10s, $5s, $1s and coins) in the drawer for change; never empty it. " +
  "To the safe: enter how many of each bill you took and the register adds it up. " +
  "To the ATM: $20 bills only, enter how many.";

// ---------------------------------------------------------------------------
// Self-tests (scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runDropBillsTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`  FAIL - ${name}`);
    }
  };

  // The owner's 2026-11-08 SR1 drop, as written in the note by hand.
  const sr1 = { hundreds: 3, fifties: 1, twenties: 103, ones: 10 };
  ok("SR1 note adds up to $2,420.00 (what was recorded)", dropBillsTotalMinor(sr1) === 242000);
  ok("words read like the note", dropBillsWords(sr1) === "3 \u00d7 $100, 1 \u00d7 $50, 103 \u00d7 $20, 10 \u00d7 $1");
  const p = parseDropBills(sr1);
  ok("parse: ok and amount derived", p.ok && p.amountMinor === 242000);
  ok("parse: strings from inputs accepted", (() => { const q = parseDropBills({ twenties: "77" }); return q.ok && q.amountMinor === 154000; })());
  ok("parse: empty refused", !parseDropBills({}).ok);
  ok("parse: all zero refused", !parseDropBills({ twenties: 0 }).ok);
  ok("parse: null refused", !parseDropBills(null).ok);
  ok("parse: array refused", !parseDropBills([1]).ok);
  ok("parse: coins refused", !parseDropBills({ twenties: 5, quarters: 4 }).ok);
  ok("parse: negative refused", !parseDropBills({ twenties: -1 }).ok);
  ok("parse: fraction refused", !parseDropBills({ twenties: 1.5 }).ok);
  ok("parse: too many refused", !parseDropBills({ twenties: MAX_DROP_BILLS_EACH + 1 }).ok);
  ok("parse: zeros dropped from the stored row", (() => { const q = parseDropBills({ twenties: 3, tens: 0 }); return q.ok && Object.keys(q.bills).join(",") === "twenties"; })());
  ok("match: equal", billsMatchAmount(sr1, 242000));
  ok("match: the SR2 case ($2,080 typed, $1,540 in bills) refused", !billsMatchAmount({ twenties: 77 }, 208000));
  ok("as denoms: coins zero, bills carried", (() => { const d = dropBillsAsDenoms(sr1); return d.hundreds === 3 && d.ones === 10 && d.quarters === 0; })());
  ok("words: none", dropBillsWords({}) === "no bills");
  ok("how-to never says twenties only for the safe", /To the safe: enter how many of each bill/.test(DROP_HOW_TO) && /ATM: \$20 bills only/.test(DROP_HOW_TO));

  ok("note tag appended once", withDropBillsNoteTag("busy", { twenties: 5 }) === "busy [bills: 5 \u00d7 $20]" && withDropBillsNoteTag("busy [bills: 5 \u00d7 $20]", { twenties: 5 }) === "busy [bills: 5 \u00d7 $20]");
  ok("note tag on empty note, readable", withDropBillsNoteTag(null, { hundreds: 1 }) === "[bills: 1 \u00d7 $100]" && hasDropBillsNoteTag("[bills: 1 \u00d7 $100]"));
  ok("note tag stays within 500 chars", withDropBillsNoteTag("x".repeat(600), sr1).length <= 500 && hasDropBillsNoteTag(withDropBillsNoteTag("x".repeat(600), sr1)));

  // addBillsToDropRows (storage before / after 0349)
  const rows = { full: { session_id: "s", amount_minor: 154000, notes: "hi", destination: "safe" }, fallback: { session_id: "s", amount_minor: 154000, notes: "hi" } };
  const rB = addBillsToDropRows(rows, { twenties: 77, tens: 0 });
  ok("rows: bills column, zeros dropped, notes untouched", JSON.stringify(rB.full.bills) === '{"twenties":77}' && rB.full.notes === "hi");
  ok("rows: pre-0349 keeps 0346 columns, bills in the note tag", rB.fullNoBills !== undefined && rB.fullNoBills.bills === undefined && rB.fullNoBills.destination === "safe" && rB.fullNoBills.notes === "hi [bills: 77 \u00d7 $20]");
  ok("rows: pre-0346 fallback carries the tag", rB.fallback.notes === "hi [bills: 77 \u00d7 $20]" && rB.fallback.bills === undefined);
  const rA = addBillsToDropRows({ full: { destination: "atm", notes: null }, fallback: { notes: "[ATM drop: 5 x $20]" } }, { twenties: 5 });
  ok("rows: ATM drop and no-bills drop unchanged", rA.full.bills === undefined && rA.fullNoBills === undefined && addBillsToDropRows(rows, null).fullNoBills === undefined);

  return { passed, failed };
}
