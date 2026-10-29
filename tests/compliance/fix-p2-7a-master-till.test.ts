/**
 * tests/compliance/fix-p2-7a-master-till.test.ts
 *
 * Fix Phase 2.7a (G-08 mix standard, G-09 printable sheet and export, G-13
 * any employee counts; findings F-02-3, F-02-4 PIN part, F-02-5 default
 * window, F-02-7 help text, F-02-10, F-02-13, F-00-8 safe part).
 *
 * Owner, verbatim:
 *   D11  "The master till has 1000. 32 tens, 64 fives, 318 ones, 95 quarters,
 *         120 dimes, 100 nickels, and 125 pennies."
 *   G-09 "I want to make sure the master till spreadsheet is built … This
 *         should be exportable and printable."
 *   D15  "Q02-2- anyone can count and record the master count"
 *
 * What this file proves:
 *   1. The pure rules: one D11 constant (the EOD specimen uses it), the
 *      per-denomination Standard/Diff, the mix kept apart from the total,
 *      the date range (bad dates refused, never replaced), the workbook.
 *   2. The ranged readers page through every row and RETURN a failed read.
 *   3. The action: any login (orders.manage), the counter proved by PIN on
 *      its own throttle scope, nothing saved on a bad PIN, the audit names
 *      the counter and the mix.
 *   4. The pages and route: the gates, the live Standard/Diff grid, the
 *      printable sheet, the export refusing an incomplete read, the EOD
 *      "mix on standard: yes/no", the help text no longer telling counters
 *      to keep drop cash in the master till.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── fake database (ranged readers) ──────────────────────────────────────
type Res = { data: unknown; error: { message: string; code?: string } | null };
const PAGES: Record<string, Res[]> = {};
const CALLS: { table: string; ops: string[] }[] = [];
function builder(table: string) {
  const ops: string[] = [];
  CALLS.push({ table, ops });
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "in", "gte", "lte", "limit", "range"]) {
    b[m] = (...args: unknown[]) => {
      ops.push(`${m}(${args.map((a) => JSON.stringify(a)).join(",")})`);
      return b;
    };
  }
  b.then = (ok: (r: Res) => unknown, ko?: (e: unknown) => unknown) => {
    const q = PAGES[table] ?? [];
    const r = q.length > 0 ? (q.shift() as Res) : { data: [], error: null };
    return Promise.resolve(r).then(ok, ko);
  };
  return b;
}
vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ from: (t: string) => builder(t) }) }));

// ── action mocks ────────────────────────────────────────────────────────
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
const AUDITS: { action: string; entityId: unknown; after: Record<string, unknown> }[] = [];
vi.mock("@/lib/auth/audit", () => ({
  recordAudit: async (a: { action: string; entityId: unknown; after: Record<string, unknown> }) => {
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
const SAVED: unknown[] = [];
let SAVE_RESULT: unknown = { ok: true, varianceMinor: 0, id: "count-1", reason: null, reasonSaved: true, warning: false };
vi.mock("@/lib/registers/safe-store", async (orig) => {
  const real = await orig<typeof import("@/lib/registers/safe-store")>();
  return {
    ...real,
    recordSafeCount: async (o: unknown) => {
      SAVED.push(o);
      return SAVE_RESULT;
    },
  };
});

import {
  MASTER_TILL_STANDARD,
  SAFE_COUNT_PIN_SCOPE,
  mixRows,
  mixCheck,
  mixSentence,
  countResultWords,
  parseDayRange,
  defaultCountWindow,
  safeSheetWorkbook,
  sheetCountFromRow,
  sortForSheet,
  __runMasterTillTests,
  type SheetCount,
} from "@/lib/registers/master-till-core";
import { SPECIMEN_MASTER_COUNTS } from "@/lib/accounting/register-cash-specimen-core";
import { denomTotalMinor, EMPTY_DENOMS } from "@/lib/registers/cash";
import { listSafeCountsRange, listSwapsRange } from "@/lib/registers/safe-store";
import { recordSafeCountAction } from "@/app/admin/registers/safe/actions";
import { GET as exportGET } from "@/app/admin/registers/safe/export/route";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const PAGE = "src/app/admin/registers/safe/page.tsx";
const SHEET = "src/app/admin/registers/safe/sheet/page.tsx";
const ROUTE = "src/app/admin/registers/safe/export/route.ts";
const ACTIONS = "src/app/admin/registers/safe/actions.ts";
const GRID = "src/components/admin/registers/CountGrid.tsx";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
const STD_FIELDS: Record<string, string> = Object.fromEntries(
  Object.entries(MASTER_TILL_STANDARD).map(([k, v]) => [k, String(v)]),
);
async function runAction(fields: Record<string, string>): Promise<string> {
  try {
    await recordSafeCountAction(form(fields));
  } catch (e) {
    if (e instanceof Redirect) return decodeURIComponent(e.url);
    throw e;
  }
  return "(no redirect)";
}

beforeEach(() => {
  for (const k of Object.keys(PAGES)) delete PAGES[k];
  CALLS.length = 0;
  PERMS.length = 0;
  AUDITS.length = 0;
  THROTTLE.length = 0;
  SAVED.length = 0;
  LOCKED = null;
  PIN_EMP = { id: "e7", full_name: "Sam Sales" };
  SAVE_RESULT = { ok: true, varianceMinor: 0, id: "count-1", reason: null, reasonSaved: true, warning: false };
});

// ── 1. Pure rules ───────────────────────────────────────────────────────
describe("master-till-core (G-08 / G-09)", () => {
  it("self-tests pass", () => {
    const r = __runMasterTillTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(38);
  });

  it("D11 verbatim, $1,000.00 exactly, and the one source (rule 25)", () => {
    expect(MASTER_TILL_STANDARD).toMatchObject({ tens: 32, fives: 64, ones: 318, quarters: 95, dimes: 120, nickels: 100, pennies: 125 });
    expect(MASTER_TILL_STANDARD.twenties + MASTER_TILL_STANDARD.fifties + MASTER_TILL_STANDARD.hundreds).toBe(0);
    expect(denomTotalMinor(MASTER_TILL_STANDARD)).toBe(100_000);
    expect(SPECIMEN_MASTER_COUNTS).toBe(MASTER_TILL_STANDARD);
    expect(read("src/lib/accounting/register-cash-specimen-core.ts")).not.toMatch(/tens:\s*32/);
  });

  it("the owner's example: $1,000.00 but off the mix (F-02-3)", () => {
    const c = { ...MASTER_TILL_STANDARD, twenties: 10, tens: 12 };
    const m = mixCheck(c);
    expect(m.varianceMinor).toBe(0);
    expect(m.onStandard).toBe(false);
    expect(m.offText).toBe("+10 \u00d7 $20, \u221220 \u00d7 $10");
    expect(countResultWords(c)).toBe("Balanced \u00b7 mix off: +10 \u00d7 $20, \u221220 \u00d7 $10");
    expect(mixSentence(MASTER_TILL_STANDARD)).toBe("Mix on standard.");
  });

  it("Standard / Counted / Diff per denomination", () => {
    const rows = mixRows({ ...MASTER_TILL_STANDARD, quarters: 87 });
    const q = rows.find((r) => r.key === "quarters");
    expect(q).toMatchObject({ standard: 95, counted: 87, diff: -8, diffMinor: -200 });
    expect(rows).toHaveLength(13);
    expect(mixCheck(EMPTY_DENOMS).varianceMinor).toBe(-100_000);
  });

  it("date range: defaults, refusals, never replaced (F-02-13)", () => {
    expect(parseDayRange("", "", "2026-11-30")).toEqual({ ok: true, from: "2026-11-01", to: "2026-11-30" });
    const bad = parseDayRange("2026-13-01", "", "2026-11-30");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.startsWith("From: ")).toBe(true);
    const flipped = parseDayRange("2026-11-30", "2026-11-01", "2026-11-30");
    expect(flipped.ok).toBe(false);
    const long = parseDayRange("2024-01-01", "2026-11-30", "2026-11-30");
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.error).toMatch(/366 days or fewer/);
  });

  it("default window: the first official count not yet done (F-02-5)", () => {
    expect(defaultCountWindow(false, false)).toBe("am");
    expect(defaultCountWindow(true, false)).toBe("pm");
    expect(defaultCountWindow(true, true)).toBe("other");
  });

  it("workbook: Standard row first, every denomination, mix, swaps total", () => {
    const names = () => "Ann";
    const pm = sheetCountFromRow(
      { id: "b", business_day: "2026-11-02", count_window: "pm", counted_by: "e1", total_minor: 100000, expected_minor: 100000, variance_minor: 0, notes: null, counted_at: "2026-11-03T04:00:00Z", ...MASTER_TILL_STANDARD },
      names,
    );
    const am = sheetCountFromRow(
      { id: "a", business_day: "2026-11-02", count_window: "am", counted_by: "e1", total_minor: 99800, expected_minor: 100000, variance_minor: -200, notes: "n", variance_reason: null, counted_at: "2026-11-02T16:00:00Z", ...MASTER_TILL_STANDARD, quarters: 87 },
      names,
    );
    const sorted: SheetCount[] = sortForSheet([pm, am]);
    expect(sorted.map((c) => c.window)).toEqual(["am", "pm"]);
    const wb = safeSheetWorkbook({ from: "2026-11-02", to: "2026-11-02" }, sorted, [
      { id: "s", occurredAt: "2026-11-02T20:00:00Z", amountMinor: 5000, performedByName: "Ann", approvedByName: "Bo", notes: null },
    ]);
    expect(wb.filename).toBe("master-till-2026-11-02-to-2026-11-02");
    expect(wb.sheets.map((s) => s.name)).toEqual(["Counts", "Swaps"]);
    const rows = wb.sheets[0].rows;
    expect(rows[0]).toMatchObject({ window: "Standard (D11)", tens: 32, ones: 318, total: 1000 });
    expect(rows[1]).toMatchObject({ window: "AM", quarters: 87, variance: -2, mix: "off: \u22128 \u00d7 25\u00a2" });
    expect(rows[2]).toMatchObject({ window: "PM", mix: "on standard" });
    expect(wb.sheets[1].totals).toMatchObject({ amount: 50 });
  });

  it("row mapping carries the saved reason (Phase 2.3) and the counter's name", () => {
    const c = sheetCountFromRow(
      { id: "r", business_day: "2026-11-02", count_window: "other", counted_by: "e1", total_minor: 99000, expected_minor: 100000, variance_minor: -1000, notes: "recount", variance_reason: "rolls short", counted_at: "2026-11-02T18:00:00Z", ...MASTER_TILL_STANDARD },
      (id) => (id === "e1" ? "Ann" : "?"),
    );
    expect(c).toMatchObject({ reason: "rolls short", notes: "recount", countedByName: "Ann", window: "other" });
    const wb = safeSheetWorkbook({ from: "2026-11-02", to: "2026-11-02" }, [c], []);
    expect(wb.sheets[0].rows[1]).toMatchObject({ reason: "rolls short", window: "Extra" });
  });
});

// ── 2. Ranged readers (F-02-13: no 30-row cap; failed reads returned) ──
describe("safe-store ranged readers", () => {
  it("filters by business day and orders on a unique tiebreak", async () => {
    PAGES.safe_counts = [{ data: [{ id: "c1" }], error: null }];
    const r = await listSafeCountsRange("2026-11-01", "2026-11-30");
    expect(r).toMatchObject({ ready: true, error: null });
    expect(r.counts).toHaveLength(1);
    const ops = CALLS.find((c) => c.table === "safe_counts")?.ops.join(" ") ?? "";
    expect(ops).toContain('gte("business_day","2026-11-01")');
    expect(ops).toContain('lte("business_day","2026-11-30")');
    expect(ops).toContain('order("id",{"ascending":true})');
    expect(ops).toContain("range(");
    expect(ops).not.toContain("limit(");
  });

  it("a failed read is returned, never shown as a short list", async () => {
    PAGES.safe_counts = [{ data: null, error: { message: "timeout" } }];
    const r = await listSafeCountsRange("2026-11-01", "2026-11-30");
    expect(r.ready).toBe(true);
    expect(r.error).toBe("timeout");
  });

  it("a missing table means not set up (0135), not an error", async () => {
    PAGES.safe_swaps = [{ data: null, error: { message: "relation safe_swaps does not exist", code: "42P01" } }];
    const r = await listSwapsRange("2026-11-01", "2026-11-30");
    expect(r).toEqual({ ready: false, swaps: [], error: null });
  });

  it("swaps are read by Pacific day bounds", async () => {
    PAGES.safe_swaps = [{ data: [], error: null }];
    await listSwapsRange("2026-11-02", "2026-11-02");
    const ops = CALLS.find((c) => c.table === "safe_swaps")?.ops.join(" ") ?? "";
    expect(ops).toContain('gte("occurred_at","2026-11-02T08:00:00.000Z")');
    expect(ops).toContain('lte("occurred_at","2026-11-03T07:59:59.999Z")');
  });
});

// ── 3. The action (G-13 / D15; F-02-4 PIN part) ──────────────────────────
describe("recordSafeCountAction: any employee, proved by PIN", () => {
  it("opens to every login (orders.manage), not managers only", async () => {
    const msg = await runAction({ ...STD_FIELDS, count_window: "am", counter_pin: "1234" });
    expect(PERMS).toEqual(["orders.manage"]);
    expect(msg).toMatch(/counted=Safe counted — balanced on the \$1,000 target\. Counted by Sam Sales\. Mix on standard\./);
    expect(SAVED).toHaveLength(1);
    expect(SAVED[0]).toMatchObject({ countedBy: "e7", window: "am" });
  });

  it("no PIN, a malformed PIN or an unknown PIN saves nothing", async () => {
    expect(await runAction({ ...STD_FIELDS, count_window: "am" })).toMatch(/Enter your PIN .*Nothing was saved\./);
    expect(await runAction({ ...STD_FIELDS, count_window: "am", counter_pin: "12" })).toMatch(/A PIN is 4–6 digits\. Nothing was saved\./);
    PIN_EMP = null;
    expect(await runAction({ ...STD_FIELDS, count_window: "am", counter_pin: "9999" })).toMatch(
      /No active employee has that PIN\. Counted by must be an active employee\. Nothing was saved\./,
    );
    expect(SAVED).toHaveLength(0);
    expect(THROTTLE).toContain(`fail:${SAFE_COUNT_PIN_SCOPE}`);
  });

  it("a locked PIN pad refuses before the PIN is checked", async () => {
    LOCKED = "Too many wrong PINs. Try again in 5 minutes.";
    expect(await runAction({ ...STD_FIELDS, count_window: "am", counter_pin: "1234" })).toMatch(/Too many wrong PINs/);
    expect(SAVED).toHaveLength(0);
  });

  it("the audit names the count row, the counter, PIN-verified, and the mix", async () => {
    await runAction({ ...STD_FIELDS, twenties: "10", tens: "12", count_window: "pm", counter_pin: "1234" });
    const a = AUDITS.find((x) => x.action === "safe.counted");
    expect(a?.entityId).toBe("count-1");
    expect(a?.after).toMatchObject({ counted_by: "e7", counted_by_name: "Sam Sales", counter_verified: "pin", mix: "Balanced \u00b7 mix off: +10 \u00d7 $20, \u221220 \u00d7 $10" });
    expect(THROTTLE).toEqual([`blocked?${SAFE_COUNT_PIN_SCOPE}`, `ok:${SAFE_COUNT_PIN_SCOPE}`]);
  });

  it("a refused over-$5 count is still audited with the counter", async () => {
    SAVE_RESULT = { ok: false, error: "The master till is short by $10.00, more than $5.00. Write the reason (why it is over or short) and try again. Nothing was saved.", varianceMinor: -1000 };
    const msg = await runAction({ ...STD_FIELDS, ones: "308", count_window: "am", counter_pin: "1234" });
    expect(msg).toMatch(/Nothing was saved\./);
    const a = AUDITS.find((x) => x.action === "safe.count_refused");
    expect(a?.after).toMatchObject({ counted_by: "e7", counter_verified: "pin", reason_required: true });
  });
});

// ── 3b. The export route, run (door: never a partial file) ──────────────
describe("GET /admin/registers/safe/export", () => {
  const url = (q: string) => new Request(`http://x/admin/registers/safe/export?${q}`);

  it("a failed read is refused with 409, no file", async () => {
    PAGES.safe_counts = [{ data: null, error: { message: "statement timeout" } }];
    const res = await exportGET(url("from=2026-11-01&to=2026-11-02&format=csv"));
    expect(res.status).toBe(409);
    expect(await res.text()).toMatch(/not exported because some records could not be read: statement timeout/);
    expect(PERMS).toEqual(["inventory.manage"]);
  });

  it("a bad range is refused with 400, never replaced", async () => {
    const res = await exportGET(url("from=2026-11-30&to=2026-11-01"));
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/is after To/);
  });

  it("before migration 0135: refused, nothing exported", async () => {
    PAGES.safe_counts = [{ data: null, error: { message: "relation safe_counts does not exist", code: "42P01" } }];
    const res = await exportGET(url("from=2026-11-01&to=2026-11-02"));
    expect(res.status).toBe(409);
    expect(await res.text()).toMatch(/0135/);
  });

  it("a complete read exports CSV with the standard row and the count", async () => {
    PAGES.safe_counts = [
      {
        data: [
          { id: "c1", business_day: "2026-11-02", count_window: "am", counted_by: null, total_minor: 100000, expected_minor: 100000, variance_minor: 0, notes: null, variance_reason: null, counted_at: "2026-11-02T16:00:00Z", ...MASTER_TILL_STANDARD },
        ],
        error: null,
      },
    ];
    const res = await exportGET(url("from=2026-11-02&to=2026-11-02&format=csv"));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/Standard \(D11\)/);
    expect(body).toMatch(/on standard/);
  });
});

// ── 4. Pages, route, EOD, help text ─────────────────────────────────────
describe("pages and route (source)", () => {
  const page = stripComments(read(PAGE));
  it("the page opens to every login; history, sheet and export are manager-level", () => {
    expect(page).toMatch(/requirePermission\("orders\.manage"\)/);
    expect(page).not.toMatch(/requirePermission\("inventory\.manage"\)/);
    expect(page).toMatch(/const canManage = can\(session\.profile\.role, "inventory\.manage"\)/);
    expect(page).toMatch(/canManage && range\.ok \? listSafeCountsRange/);
    expect(page).toMatch(/!canManage \?/);
  });

  it("the count form takes the counter's PIN, not a picked name (F-02-4)", () => {
    expect(page).toMatch(/name="counter_pin"/);
    expect(page).not.toMatch(/name="counted_by"/);
    expect(page).toMatch(/showStandard/);
    expect(page).toMatch(/defaultValue=\{startWindow\}/);
    expect(page).toMatch(/SaveButton label="Record safe count"/);
  });

  it("history: date range, mix column, denominations, export off on a failed read", () => {
    expect(page).toMatch(/RangePicker/);
    expect(page).toMatch(/range\.error/);
    expect(page).toMatch(/Off: \$\{m\.offText\}/);
    expect(page).toMatch(/mixRows\(c\.denoms\)/);
    expect(page).toMatch(/readErrors\.length === 0 \?/);
    expect(page).toMatch(/\/admin\/registers\/safe\/export\?\$\{rangeQs\}&format=csv/);
    expect(page).toMatch(/\/admin\/registers\/safe\/sheet\?day=/);
  });

  it("F-02-7: the help and placeholder no longer tell counters to keep drop cash", () => {
    const raw = read(PAGE);
    expect(raw).not.toMatch(/drops waiting to be banked/);
    expect(raw).not.toMatch(/bank the overage/);
    expect(raw).toMatch(/Drops and close takings are <strong>not<\/strong> master till money/);
  });

  it("CountGrid shows Standard and Diff live, and the mix apart from the total", () => {
    const g = read(GRID);
    expect(g).toMatch(/showStandard = false/);
    expect(g).toMatch(/Standard \{r\.standard\}/);
    expect(g).toMatch(/Mix on standard/);
    expect(g).toMatch(/Mix off: \$\{mixLine\.offText\}/);
  });

  it("the printable sheet: manager-level, bad day refused, standard + diff, swaps, little-safe note, signatures", () => {
    expect(existsSync(join(ROOT, SHEET))).toBe(true);
    const s = stripComments(read(SHEET));
    expect(s).toMatch(/requirePermission\("inventory\.manage"\)/);
    expect(s).toMatch(/parseBusinessDay\(sp\.day, pacificToday\(\)\)/);
    expect(s).toMatch(/Nothing is shown in its place/);
    expect(s).toMatch(/Standard \(D11\)/);
    expect(s).toMatch(/signedDiff\(d\)/);
    expect(s).toMatch(/PrintButton/);
    expect(s).toMatch(/This sheet may be incomplete\. Do not file it\./);
    expect(s).toMatch(/gap G-02/);
    expect(s).toMatch(/AM counter — signature/);
  });

  it("the export route: manager-level, bad range 400, failed read 409, never a partial file", () => {
    const r = stripComments(read(ROUTE));
    expect(r).toMatch(/requirePermission\("inventory\.manage"\)/);
    expect(r).toMatch(/if \(!range\.ok\) return bad\(range\.error\)/);
    expect(r).toMatch(/some records could not be read.*409/);
    expect(r).toMatch(/exportResponse\(safeSheetWorkbook\(range, counts, swaps\)/);
  });

  it("the action keeps the Phase 2.3 strings and audits", () => {
    const a = read(ACTIONS);
    expect(a).toMatch(/requirePermission\("orders\.manage"\)/);
    expect(a).toMatch(/pinPadBlocked\(SAFE_COUNT_PIN_SCOPE\)/);
    expect(a).toMatch(/Counted by must be an active employee\. Nothing was saved\./);
    expect(a).toMatch(/entityId: result\.id/);
  });

  it("EOD: the safe lines say mix on standard yes/no (G-08 req. 5) and link the sheet", () => {
    const store = read("src/lib/registers/eod-store.ts");
    expect(store).toMatch(/\.\.\.DENOM_FIELDS\.map\(\(d\) => d\.key\)/);
    expect(store).toMatch(/mixOnStandard: mixCheck\(denomsOf\(/);
    const eod = read("src/app/admin/registers/eod/page.tsx");
    expect(eod).toMatch(/mix on standard: yes/);
    expect(eod).toMatch(/mixWords\(safe\.amCount\.mixOnStandard\)/);
    expect(eod).toMatch(/mixWords\(safe\.pmCount\.mixOnStandard\)/);
    expect(eod).toMatch(/\/safe\/sheet\?day=\$\{businessDay\}/);
  });
});
