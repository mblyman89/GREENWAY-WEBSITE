/**
 * tests/compliance/fix-p2-7b-little-safe.test.ts
 *
 * Fix Phase 2.7b (G-02; findings F-00-7, F-01-8, F-02-8).
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
 * What this file proves:
 *   1. The pure rules: both sides by denomination, both more than zero,
 *      exactly equal, within the swap cap; untrusted counts refused, never
 *      rounded; the register swap's bills must both equal the amount, and an
 *      iPad built before 2.7b (no bills) is still accepted, value only.
 *   2. The store: the exchange insert carries the business day and both
 *      sides; before 0317 it refuses with the migration hint (never
 *      best-effort); the database's sides-equal refusal reads plainly; the
 *      swap keeps its value when only the bill columns are missing, and ANY
 *      other error still fails it; the exchange log reads every page.
 *   3. The action: any login (orders.manage), the recorder proved by PIN on
 *      its own throttle scope, nothing saved on a bad PIN or unequal sides,
 *      the audit names the recorder and both sides.
 *   4. Migration 0317, the page, the sheet, the export, the till route and
 *      the iPad swap form (source).
 *   5. The living SOP and the ledgers (D41).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── fake database ─────────────────────────────────────────────────────────
type Err = { message: string; code?: string };
type Res = { data: unknown; error: Err | null };
const PAGES: Record<string, Res[]> = {};
const INSERTS: { table: string; row: Record<string, unknown> }[] = [];
const CALLS: { table: string; ops: string[] }[] = [];
function builder(table: string) {
  const ops: string[] = [];
  CALLS.push({ table, ops });
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "in", "gte", "lte", "limit", "range", "maybeSingle"]) {
    b[m] = (...args: unknown[]) => {
      ops.push(`${m}(${args.map((a) => JSON.stringify(a)).join(",")})`);
      return b;
    };
  }
  b.insert = (row: Record<string, unknown>) => {
    INSERTS.push({ table, row });
    ops.push("insert");
    return b;
  };
  b.then = (ok: (r: Res) => unknown, ko?: (e: unknown) => unknown) => {
    const q = PAGES[table] ?? [];
    const r = q.length > 0 ? (q.shift() as Res) : { data: [], error: null };
    return Promise.resolve(r).then(ok, ko);
  };
  return b;
}
vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ from: (t: string) => builder(t) }) }));

// ── action mocks ──────────────────────────────────────────────────────────
class Redirect extends Error {
  constructor(public url: string) {
    super(`REDIRECT ${url}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const PERMS: string[] = [];
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async (p: string) => {
    PERMS.push(p);
    return { userId: "u1", email: "staff@example.com", profile: { role: "staff" } };
  },
}));
const AUDITS: { action: string; entityType: string; entityId: unknown; after: Record<string, unknown> }[] = [];
vi.mock("@/lib/auth/audit", () => ({
  recordAudit: async (a: { action: string; entityType: string; entityId: unknown; after: Record<string, unknown> }) => {
    AUDITS.push(a);
  },
}));
let PIN_EMP: { id: string; full_name: string } | null = null;
vi.mock("@/lib/staffing/store", () => ({
  getEmployeeByPin: async () => PIN_EMP,
  listEmployees: async () => [],
}));
const THROTTLE: string[] = [];
let LOCKED: string | null = null;
vi.mock("@/lib/security/pin-throttle-store", () => ({
  pinPadBlocked: async (s: string) => {
    THROTTLE.push(`blocked?${s}`);
    return LOCKED;
  },
  notePinFailure: async (s: string) => {
    THROTTLE.push(`fail:${s}`);
  },
  notePinSuccess: async (s: string) => {
    THROTTLE.push(`ok:${s}`);
  },
}));

import {
  LITTLE_SAFE_PIN_SCOPE,
  EXCHANGE_MAX_PIECES,
  OUT_PREFIX,
  IN_PREFIX,
  VALUE_ONLY_WORDS,
  readDenoms,
  denomWords,
  compactDenoms,
  validateExchange,
  checkSwapDenoms,
  sheetExchangeFromRow,
  swapBillWords,
  __runLittleSafeTests,
} from "@/lib/registers/little-safe-core";
import { safeSheetWorkbook, sheetSwapFromRow, exchangesSheet } from "@/lib/registers/master-till-core";
import { EMPTY_DENOMS, type DenomCounts } from "@/lib/registers/cash";
import { validateTillRequest } from "@/lib/pos/till-core";
import { recordLittleSafeExchange, recordSwap, listLittleSafeExchangesRange } from "@/lib/registers/safe-store";
import { recordLittleSafeExchangeAction } from "@/app/admin/registers/safe/actions";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const MIG = "supabase/migrations/0317_little_safe_exchanges.sql";
const PAGE = "src/app/admin/registers/safe/page.tsx";
const SHEET = "src/app/admin/registers/safe/sheet/page.tsx";
const ROUTE = "src/app/admin/registers/safe/export/route.ts";
const ACTIONS = "src/app/admin/registers/safe/actions.ts";
const FORM = "src/components/admin/registers/LittleSafeExchangeForm.tsx";
const TILL_ROUTE = "src/app/api/pos/till/route.ts";
const SHELL = "src/app/(site)/pos/RegisterShell.tsx";
const STORE = "src/lib/registers/safe-store.ts";

const D = (p: Partial<DenomCounts>): DenomCounts => ({ ...EMPTY_DENOMS, ...p });

beforeEach(() => {
  for (const k of Object.keys(PAGES)) delete PAGES[k];
  INSERTS.length = 0;
  CALLS.length = 0;
  PERMS.length = 0;
  AUDITS.length = 0;
  THROTTLE.length = 0;
  PIN_EMP = { id: "emp-ann", full_name: "Ann Lee" };
  LOCKED = null;
});

// ── 1. Pure rules ─────────────────────────────────────────────────────────
describe("little-safe-core (G-02 / F-01-8)", () => {
  it("its own self-tests run and pass", () => {
    const r = __runLittleSafeTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(30);
  });

  it("the PIN scope and field prefixes are fixed", () => {
    expect(LITTLE_SAFE_PIN_SCOPE).toBe("backoffice-little-safe");
    expect(OUT_PREFIX).toBe("out_");
    expect(IN_PREFIX).toBe("in_");
    expect(EXCHANGE_MAX_PIECES).toBe(99_999);
  });

  it("readDenoms refuses what it cannot read, never rounds it", () => {
    expect(readDenoms(() => "")).toEqual({ ok: true, denoms: EMPTY_DENOMS });
    const frac = readDenoms((k) => (k === "fives" ? "2.5" : null));
    expect(frac).toEqual({ ok: false, error: '$5: "2.5" is not a whole number of pieces.' });
    const neg = readDenoms((k) => (k === "ones" ? "-3" : null));
    expect(neg.ok).toBe(false);
    const big = readDenoms((k) => (k === "twenties" ? "100000" : null));
    expect(big.ok).toBe(false);
    expect(!big.ok && big.error).toMatch(/more than 99,999\. Check the count\./);
    const good = readDenoms((k) => (k === "twenties" ? " 5 " : k === "quarters" ? 40 : null));
    expect(good.ok && good.denoms.twenties === 5 && good.denoms.quarters === 40).toBe(true);
  });

  it("denomWords lists high to low, non-zero only", () => {
    expect(denomWords(D({ twenties: 5, ones: 2, quarters: 40 }))).toBe("5 \u00d7 $20, 2 \u00d7 $1, 40 \u00d7 25\u00a2");
    expect(denomWords(EMPTY_DENOMS)).toBe("nothing");
    expect(denomWords(null)).toBe("\u2014");
    expect(compactDenoms(D({ twenties: 5 }))).toEqual({ twenties: 5 });
  });

  it("an exchange needs both sides, exactly equal, within the cap", () => {
    expect(validateExchange({ outDenoms: EMPTY_DENOMS, inDenoms: D({ fives: 20 }) })).toEqual({
      ok: false,
      error: "Enter the big bills OUT of the master till (into the little safe), by denomination. Nothing was saved.",
    });
    expect(validateExchange({ outDenoms: D({ twenties: 5 }), inDenoms: EMPTY_DENOMS })).toEqual({
      ok: false,
      error: "Enter the small bills and coin IN from the little safe (into the master till), by denomination. Nothing was saved.",
    });
    // Both sides empty are "equal" at $0.00, but still refused, never a $0 row.
    expect(validateExchange({ outDenoms: EMPTY_DENOMS, inDenoms: EMPTY_DENOMS })).toMatchObject({ ok: false, error: expect.stringMatching(/^Enter the big bills OUT/) });
    const unequal = validateExchange({ outDenoms: D({ twenties: 5 }), inDenoms: D({ fives: 19 }) });
    expect(unequal.ok).toBe(false);
    expect(!unequal.ok && unequal.error).toMatch(
      /^The two sides are not equal: OUT of the master till \$100\.00, IN from the little safe \$95\.00 \(OUT is \$5\.00 more\)/,
    );
    const over = validateExchange({ outDenoms: D({ hundreds: 21 }), inDenoms: D({ twenties: 105 }) });
    expect(over.ok).toBe(false);
    const longNotes = validateExchange({ outDenoms: D({ twenties: 5 }), inDenoms: D({ fives: 20 }), notes: "x".repeat(501) });
    expect(longNotes.ok).toBe(false);
    const good = validateExchange({ outDenoms: D({ twenties: 5 }), inDenoms: D({ fives: 10, ones: 50 }), notes: "  " });
    expect(good).toMatchObject({ ok: true, exchange: { valueMinor: 10_000, notes: null } });
  });

  it("the register swap: no bills = old iPad, accepted value-only; bills must be both ways and equal the amount", () => {
    expect(checkSwapDenoms(10_000, undefined, null)).toEqual({ ok: true, inDenoms: null, outDenoms: null });
    expect(checkSwapDenoms(10_000, { twenties: 5 }, null)).toMatchObject({ ok: false });
    const inWrong = checkSwapDenoms(10_000, { twenties: 4 }, { fives: 20 });
    expect(!inWrong.ok && inWrong.error).toBe("The big bills to the safe add up to $80.00, not the swap amount $100.00.");
    const outWrong = checkSwapDenoms(10_000, { twenties: 5 }, { fives: 19 });
    expect(!outWrong.ok && outWrong.error).toMatch(/^The change back adds up to \$95\.00/);
    expect(checkSwapDenoms(10_000, { twenties: 5 }, { fives: 20 })).toMatchObject({ ok: true });
  });

  it("till-core carries the bills and refuses unequal ones", () => {
    const ok = validateTillRequest({ action: "swap", pin: "1234", amountMinor: 10000, approverPin: "5678", inDenoms: { twenties: 5 }, outDenoms: { fives: 20 } });
    expect(ok.ok && ok.req.action === "swap" && ok.req.inDenoms?.twenties === 5).toBe(true);
    const bad = validateTillRequest({ action: "swap", pin: "1234", amountMinor: 10000, approverPin: "5678", inDenoms: { twenties: 5 }, outDenoms: { fives: 10 } });
    expect(bad.ok).toBe(false);
    const old = validateTillRequest({ action: "swap", pin: "1234", amountMinor: 10000, approverPin: "5678" });
    expect(old.ok).toBe(true);
  });

  it("rows, swap words and the workbook", () => {
    expect(swapBillWords(null, null)).toEqual({ inWords: VALUE_ONLY_WORDS, outWords: VALUE_ONLY_WORDS });
    const sw = sheetSwapFromRow(
      { id: "s1", amount_minor: 10_000, performed_by: null, approved_by: null, notes: null, occurred_at: "2026-11-02T20:00:00Z", in_denoms: { twenties: 5 }, out_denoms: { fives: 20 } },
      () => "\u2014",
    );
    expect(sw.inWords).toBe("5 \u00d7 $20");
    expect(sw.outWords).toBe("20 \u00d7 $5");
    const ex = sheetExchangeFromRow(
      { id: "x1", business_day: "2026-11-02", out_denoms: { twenties: 5 }, in_denoms: { fives: 20 }, value_minor: 10_000, recorded_by: "e1", notes: "n", occurred_at: "2026-11-02T20:00:00Z" },
      (id) => (id === "e1" ? "Ann" : "\u2014"),
    );
    expect(ex).toMatchObject({ recordedByName: "Ann", outWords: "5 \u00d7 $20", inWords: "20 \u00d7 $5", valueMinor: 10_000, notes: "n" });
    const wb = safeSheetWorkbook({ from: "2026-11-02", to: "2026-11-02" } as never, [], [sw], [ex]);
    expect(wb.sheets.map((s) => s.name)).toEqual(["Counts", "Swaps", "Exchanges"]);
    const swaps = wb.sheets[1];
    expect(swaps.columns.map((c) => c.header)).toEqual(expect.arrayContaining(["Big bills IN from till \u2192 master till", "Change OUT master till \u2192 till"]));
    const exs = exchangesSheet([ex]);
    expect(exs.totals).toMatchObject({ day: "1 exchanges", value: 100 });
    // No little-safe balance column (D3): the sheet lists exchanges, it never adds them up into a balance.
    expect(exs.columns.map((c) => c.header).join("|")).not.toMatch(/balance|target|expected/i);
  });
});

// ── 2. Store ──────────────────────────────────────────────────────────────
describe("safe-store: exchanges and swap bills", () => {
  it("an exchange insert carries the business day, both sides, value, recorder and notes", async () => {
    PAGES.little_safe_exchanges = [{ data: { id: "x-1" }, error: null }];
    const r = await recordLittleSafeExchange({ outDenoms: { twenties: 5 }, inDenoms: { fives: 20 }, valueMinor: 10_000, recordedBy: "emp-ann", notes: null });
    expect(r).toEqual({ ok: true, id: "x-1" });
    const row = INSERTS.find((i) => i.table === "little_safe_exchanges")?.row ?? {};
    expect(row).toMatchObject({ out_denoms: { twenties: 5 }, in_denoms: { fives: 20 }, value_minor: 10_000, recorded_by: "emp-ann", notes: null });
    expect(String(row.business_day)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("before 0317 it refuses with the migration hint, never best-effort", async () => {
    PAGES.little_safe_exchanges = [{ data: null, error: { message: "relation little_safe_exchanges does not exist", code: "42P01" } }];
    const r = await recordLittleSafeExchange({ outDenoms: { twenties: 5 }, inDenoms: { fives: 20 }, valueMinor: 10_000, recordedBy: "e", notes: null });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/run migration 0317_little_safe_exchanges\.sql.*Nothing was saved; use paper form 8\.2/);
  });

  it("the database's sides-equal refusal reads plainly", async () => {
    PAGES.little_safe_exchanges = [{ data: null, error: { message: 'new row violates check constraint "little_safe_exchanges_sides_equal"', code: "23514" } }];
    const r = await recordLittleSafeExchange({ outDenoms: { twenties: 5 }, inDenoms: { fives: 19 }, valueMinor: 10_000, recordedBy: "e", notes: null });
    expect(!r.ok && r.error).toBe("The database refused it: the two sides are not the same value. Recount both sides. Nothing was saved.");
  });

  it("a swap saves its bills; without the 0317 columns it keeps the value and says billsSaved false", async () => {
    PAGES.safe_swaps = [{ data: null, error: null }];
    const a = await recordSwap({ sessionId: "s", deviceId: "d", amountMinor: 10_000, performedBy: "p", approvedBy: "m", inDenoms: { twenties: 5 }, outDenoms: { fives: 20 } });
    expect(a).toEqual({ ok: true, billsSaved: true });
    expect(INSERTS[0].row).toMatchObject({ in_denoms: { twenties: 5 }, out_denoms: { fives: 20 }, amount_minor: 10_000 });

    INSERTS.length = 0;
    PAGES.safe_swaps = [
      { data: null, error: { message: "Could not find the 'in_denoms' column of 'safe_swaps' in the schema cache", code: "PGRST204" } },
      { data: null, error: null },
    ];
    const b = await recordSwap({ sessionId: "s", deviceId: "d", amountMinor: 10_000, performedBy: "p", approvedBy: "m", inDenoms: { twenties: 5 }, outDenoms: { fives: 20 } });
    expect(b).toEqual({ ok: true, billsSaved: false });
    expect(INSERTS).toHaveLength(2);
    expect(INSERTS[1].row).not.toHaveProperty("in_denoms");
    expect(INSERTS[1].row).toMatchObject({ amount_minor: 10_000, approved_by: "m" });
  });

  it("any OTHER swap error fails the swap; it never quietly drops the bills", async () => {
    PAGES.safe_swaps = [{ data: null, error: { message: 'new row violates check constraint "safe_swaps_denoms_equal"', code: "23514" } }];
    const r = await recordSwap({ sessionId: "s", deviceId: "d", amountMinor: 10_000, performedBy: "p", approvedBy: "m", inDenoms: { twenties: 5 }, outDenoms: { fives: 19 } });
    expect(r.ok).toBe(false);
    expect(INSERTS).toHaveLength(1);
  });

  it("an old iPad swap (no bills) inserts value only", async () => {
    PAGES.safe_swaps = [{ data: null, error: null }];
    const r = await recordSwap({ sessionId: "s", deviceId: "d", amountMinor: 2_000, performedBy: "p", approvedBy: "m" });
    expect(r).toEqual({ ok: true, billsSaved: false });
    expect(INSERTS[0].row).not.toHaveProperty("in_denoms");
  });

  it("the exchange log reads by business day, every page, unique tiebreak; failure and not-set-up are distinct", async () => {
    PAGES.little_safe_exchanges = [{ data: [{ id: "x1" }], error: null }];
    const r = await listLittleSafeExchangesRange("2026-11-01", "2026-11-30");
    expect(r).toMatchObject({ ready: true, error: null });
    expect(r.exchanges).toHaveLength(1);
    const ops = CALLS.find((c) => c.table === "little_safe_exchanges")?.ops.join(" ") ?? "";
    expect(ops).toContain('gte("business_day","2026-11-01")');
    expect(ops).toContain('lte("business_day","2026-11-30")');
    expect(ops).toContain('order("id",{"ascending":true})');
    expect(ops).toContain("range(");
    expect(ops).not.toContain("limit(");

    PAGES.little_safe_exchanges = [{ data: null, error: { message: "timeout" } }];
    const f = await listLittleSafeExchangesRange("2026-11-01", "2026-11-30");
    expect(f).toMatchObject({ ready: true, error: "timeout" });

    PAGES.little_safe_exchanges = [{ data: null, error: { message: "relation little_safe_exchanges does not exist", code: "42P01" } }];
    const m = await listLittleSafeExchangesRange("2026-11-01", "2026-11-30");
    expect(m).toEqual({ ready: false, exchanges: [], error: null });
  });
});

// ── 3. Action ─────────────────────────────────────────────────────────────
function form(p: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(p)) f.set(k, v);
  return f;
}
async function run(fd: FormData): Promise<string> {
  try {
    await recordLittleSafeExchangeAction(fd);
  } catch (e) {
    if (e instanceof Redirect) return decodeURIComponent(e.url);
    throw e;
  }
  return "";
}
const GOOD = { out_twenties: "5", in_fives: "10", in_ones: "50", exchange_pin: "1234" };

describe("recordLittleSafeExchangeAction: any employee, proved by PIN", () => {
  it("opens to every login (orders.manage), not managers only", async () => {
    PAGES.little_safe_exchanges = [{ data: { id: "x-9" }, error: null }];
    const url = await run(form(GOOD));
    expect(PERMS).toEqual(["orders.manage"]);
    expect(url).toBe(
      "/admin/registers/safe?counted=Little safe exchange recorded by Ann Lee: OUT of the master till 5 \u00d7 $20; IN from the little safe 10 \u00d7 $5, 50 \u00d7 $1; $100.00 each side.",
    );
  });

  it("the audit names the row, the recorder (PIN-verified) and both sides", async () => {
    PAGES.little_safe_exchanges = [{ data: { id: "x-9" }, error: null }];
    await run(form({ ...GOOD, exchange_notes: "for the AM" }));
    expect(AUDITS).toHaveLength(1);
    expect(AUDITS[0]).toMatchObject({
      action: "safe.little_safe_exchange",
      entityType: "little_safe_exchange",
      entityId: "x-9",
      after: {
        recorded_by: "emp-ann",
        recorded_by_name: "Ann Lee",
        recorder_verified: "pin",
        value_minor: 10_000,
        out_of_master_till: "5 \u00d7 $20",
        in_from_little_safe: "10 \u00d7 $5, 50 \u00d7 $1",
        notes: "for the AM",
      },
    });
    expect(THROTTLE).toEqual([`blocked?${LITTLE_SAFE_PIN_SCOPE}`, `ok:${LITTLE_SAFE_PIN_SCOPE}`]);
    expect(INSERTS[0].row).toMatchObject({ out_denoms: { twenties: 5 }, in_denoms: { fives: 10, ones: 50 } });
  });

  it("unequal sides save nothing and never reach the PIN check", async () => {
    const url = await run(form({ ...GOOD, in_ones: "45" }));
    expect(url).toMatch(/\?error=The two sides are not equal/);
    expect(INSERTS).toHaveLength(0);
    expect(THROTTLE).toEqual([]);
    expect(AUDITS).toHaveLength(0);
  });

  it("a bad count saves nothing and names the side", async () => {
    const url = await run(form({ ...GOOD, out_twenties: "5.5" }));
    expect(url).toMatch(/\?error=OUT of the master till: \$20: "5\.5" is not a whole number of pieces\. Nothing was saved\./);
    expect(INSERTS).toHaveLength(0);
  });

  it("no PIN, a malformed PIN or an unknown PIN saves nothing", async () => {
    expect(await run(form({ ...GOOD, exchange_pin: "" }))).toMatch(/Enter your PIN \(the employee who did the exchange\)\. Nothing was saved\./);
    expect(await run(form({ ...GOOD, exchange_pin: "12" }))).toMatch(/A PIN is 4\u20136 digits/);
    PIN_EMP = null;
    expect(await run(form(GOOD))).toMatch(/No active employee has that PIN\. The exchange must be recorded by an active employee\. Nothing was saved\./);
    expect(THROTTLE).toContain(`fail:${LITTLE_SAFE_PIN_SCOPE}`);
    expect(INSERTS).toHaveLength(0);
    expect(AUDITS).toHaveLength(0);
  });

  it("a locked PIN pad refuses before the PIN is checked", async () => {
    LOCKED = "Too many wrong PINs. Wait 5 minutes.";
    expect(await run(form(GOOD))).toMatch(/Too many wrong PINs/);
    expect(INSERTS).toHaveLength(0);
  });

  it("before 0317 the action shows the migration hint and audits nothing", async () => {
    PAGES.little_safe_exchanges = [{ data: null, error: { message: "relation little_safe_exchanges does not exist", code: "42P01" } }];
    const url = await run(form(GOOD));
    expect(url).toMatch(/run migration 0317_little_safe_exchanges\.sql/);
    expect(AUDITS).toHaveLength(0);
  });
});

// ── 4. Migration, pages, routes (source) ─────────────────────────────────
describe("migration 0317 and the screens (source)", () => {
  const m = read(MIG);

  it("0317: prechecks, the shared denomination total, both sides checked equal in the database", () => {
    expect(m).toMatch(/MIGRATION_OUT_OF_ORDER: 0317 depends on safe_swaps/);
    expect(m).toMatch(/create or replace function public\.cash_denoms_total_minor\(d jsonb\)\s+returns bigint/);
    expect(m).toMatch(/n < 0 or n > 99999 or n <> trunc\(n\)/);
    expect(m).toMatch(/coalesce\(public\.cash_denoms_total_minor\(out_denoms\), -1\) = value_minor/);
    expect(m).toMatch(/coalesce\(public\.cash_denoms_total_minor\(in_denoms\), -1\) = value_minor/);
    expect(m).toMatch(/check \(value_minor > 0 and value_minor <= 200000\)/);
    expect(m).toMatch(/check \(notes is null or length\(notes\) <= 500\)/);
  });

  it("0317: append-only, manager read only, no write policy for people", () => {
    expect(m).toMatch(/before update or delete on public\.little_safe_exchanges/);
    expect(m).toMatch(/LITTLE_SAFE_EXCHANGE_APPEND_ONLY/);
    expect(m).toMatch(/enable row level security/);
    expect(m).toMatch(/for select using \(public\.is_manager\(\)\)/);
    expect(stripComments(m.replace(/--.*$/gm, ""))).not.toMatch(/for (insert|update|delete|all)\b/i);
    expect(m).toMatch(/recorded_by\s+uuid references public\.employees\(id\) on delete set null/);
  });

  it("0317: the register swap's bills both ways, null on older swaps, equal to the amount when present", () => {
    expect(m).toMatch(/alter table public\.safe_swaps add column if not exists in_denoms jsonb;/);
    expect(m).toMatch(/alter table public\.safe_swaps add column if not exists out_denoms jsonb;/);
    expect(m).toMatch(/\(in_denoms is null and out_denoms is null\)/);
    expect(m).toMatch(/cash_denoms_total_minor\(in_denoms\), -1\) = amount_minor/);
  });

  it("no little-safe balance or target is created anywhere (D3)", () => {
    const code = m.replace(/--.*$/gm, "");
    expect(code).not.toMatch(/little_safe_(balance|target|expected)/i);
    expect(stripComments(read(PAGE))).not.toMatch(/littleSafe(Balance|Target)/);
  });

  it("the page: the exchange form for every login, the log manager-level, not-set-up said plainly", () => {
    const s = read(PAGE);
    expect(s).toMatch(/<LittleSafeExchangeForm action=\{recordLittleSafeExchangeAction\} \/>/);
    const formAt = s.indexOf("<LittleSafeExchangeForm");
    const mgrAt = s.indexOf("{!canManage ? (");
    expect(formAt).toBeGreaterThan(0);
    expect(formAt).toBeLessThan(mgrAt);
    expect(s).toMatch(/canManage && range\.ok \? listLittleSafeExchangesRange\(range\.from, range\.to\)/);
    expect(s).toMatch(/Little safe exchanges could not all be read/);
    expect(s).toMatch(/Not set up yet: run migration 0317_little_safe_exchanges\.sql/);
    expect(s).toMatch(/Big bills in/);
    expect(s).toMatch(/Change out/);
  });

  it("the form: both grids by denomination, PIN, notes, submit only when equal", () => {
    const f = read(FORM);
    expect(f).toMatch(/name=\{`\$\{prefix\}\$\{d\.key\}`\}/);
    expect(f).toMatch(/OUT of master till \\u2192 little safe/);
    expect(f).toMatch(/IN from little safe \\u2192 master till/);
    expect(f).toMatch(/name="exchange_pin"/);
    expect(f).toMatch(/name="exchange_notes"/);
    expect(f).toMatch(/disabled=\{!equal \|\| busy\}/);
  });

  it("the action: orders.manage, its own PIN scope, nothing saved before validation", () => {
    const a = stripComments(read(ACTIONS));
    const fn = a.slice(a.indexOf("export async function recordLittleSafeExchangeAction"));
    expect(fn).toMatch(/requirePermission\("orders\.manage"\)/);
    expect(fn).toMatch(/pinPadBlocked\(LITTLE_SAFE_PIN_SCOPE\)/);
    expect(fn.indexOf("validateExchange(")).toBeLessThan(fn.indexOf("getEmployeeByPin("));
    expect(fn.indexOf("getEmployeeByPin(")).toBeLessThan(fn.indexOf("recordLittleSafeExchange("));
  });

  it("the sheet: the exchanges replace the paper-form gap note; the swaps show the bills", () => {
    const s = read(SHEET);
    expect(s).not.toMatch(/Not recorded in the app yet \(gap G-02\)/);
    expect(s).toMatch(/Master till \u2194 little safe exchanges/);
    expect(s).toMatch(/The exchange log is not set up yet: run migration 0317_little_safe_exchanges\.sql/);
    expect(s).toMatch(/listLittleSafeExchangesRange\(day, day\)/);
  });

  it("the export: the exchanges are read in full and a failed read refuses the file", () => {
    const r = read(ROUTE);
    expect(r).toMatch(/listLittleSafeExchangesRange\(range\.from, range\.to\)/);
    expect(r).toMatch(/exportResponse\(safeSheetWorkbook\(range, counts, swaps, exchanges\)/);
  });

  it("the till route stores the bills and keeps them in the audit even before 0317", () => {
    const t = read(TILL_ROUTE);
    expect(t).toMatch(/inDenoms: till\.inDenoms \? compactDenoms\(till\.inDenoms\) : null/);
    expect(t).toMatch(/bills_in: till\.inDenoms \? denomWords\(till\.inDenoms\) : null/);
    expect(t).toMatch(/bills_saved: result\.billsSaved \?\? false/);
    expect(t).toMatch(/NextResponse\.json\(\{ ok: true, billsSaved: result\.billsSaved \?\? false \}\)/);
  });

  it("the iPad swap form: two denomination grids, equal before it can be sent, bills in the body", () => {
    const s = read(SHELL);
    expect(s).toMatch(/Big bills to the safe \(from this till\)/);
    expect(s).toMatch(/Change back \(from the master till\)/);
    expect(s).toMatch(/inDenoms: swapIn,/);
    expect(s).toMatch(/outDenoms: swapOut,/);
    expect(s).toMatch(/swapOutMinor === swapInMinor/);
    expect(s).toMatch(/Not equal yet: big bills/);
  });

  it("the swap retry only fires when the error names the new bill columns", () => {
    const s = read(STORE);
    expect(s).toMatch(/\/\\b\(in_denoms\|out_denoms\)\\b\/\.test\(err\.message \?\? ""\) && \/column\|schema cache\/i\.test/);
  });

  it("the register bundle never reaches the workbook (exchangesSheet lives in master-till-core)", () => {
    const core = read("src/lib/registers/little-safe-core.ts");
    expect(stripComments(core)).not.toMatch(/@\/lib\/reports\/workbook/);
  });

  it("factory reset: little_safe_exchanges is KEEP; safe_swaps stays WIPE", () => {
    const fr = read("src/lib/accounting/factory-reset-core.ts");
    expect(fr).toMatch(/\{ table: "little_safe_exchanges", disposition: "KEEP"/);
    expect(fr).toMatch(/\{ table: "safe_swaps", disposition: "WIPE"/);
    expect(read("src/lib/admin/schema-tables.ts")).toMatch(/"little_safe_exchanges",/);
  });
});

// ── 5. Living SOP and ledgers (D41) ──────────────────────────────────────
describe("Fix Phase 2.7b: living SOP and ledgers (D41)", () => {
  const sop = read("docs/sop/SOP-02-master-till-safe.md");
  it("SOP-02 is v1.7 or later and describes the built exchange and swap bills", () => {
    expect(sop).toMatch(/\| \*\*Version\*\* \| 1\.([7-9]|\d\d) /);
    expect(sop).toMatch(/\| 1\.7 draft \| Fix phase \| Phase 2\.7b/);
    expect(sop).toMatch(/Little safe exchange/);
    expect(sop).toMatch(/Record exchange/);
    expect(sop).toMatch(/Big bills to the safe \(from this till\)/);
    expect(sop).toMatch(/0317_little_safe_exchanges\.sql/);
    expect(sop).not.toMatch(/The app records \*\*none\*\* of this \(F-00-7, gap G-02\)/);
  });

  it("ledgers mark G-02 BUILT and the findings FIXED; the KB knows the exchange", () => {
    const gaps = read("docs/sop-program/05-GAP-REGISTER.md");
    expect(gaps).toMatch(/G-02[\s\S]{0,4000}BUILT[\s\S]{0,400}Fix Phase 2\.7b/);
    const find = read("docs/sop-program/03-FINDINGS-LEDGER.md");
    expect(find).toMatch(/F-00-7[\s\S]{0,3000}Fix Phase 2\.7b/);
    expect(find).toMatch(/F-01-8[\s\S]{0,3000}Fix Phase 2\.7b/);
    const plan = read("docs/sop-program/06-FIX-PHASE-PLAN.md");
    expect(plan).toMatch(/2\.7b[^\n]*G-02/);
    const kb = read("src/lib/admin/concierge-kb.ts");
    expect(kb).toMatch(/little safe exchange/i);
    expect(kb).toMatch(/0317/);
  });
});
