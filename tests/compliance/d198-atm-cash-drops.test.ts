/**
 * tests/compliance/d198-atm-cash-drops.test.ts   (D198 - ATM cash drops from the tills)
 *
 * Owner (2026-11-07): "the ipad should only accept whole 20 dollar amounts. i want the number of
 * 20s taken from the till to be entered on the register. ... the atm drops count toward the 2k
 * drop. any register can do an atm drop. ... it is a lot of money and is easy to steal. so matching
 * is essential."
 *
 * S1 pins: migration 0346 (destination / twenties_count CHECKs, write-once money trigger, the owner's
 * append-only atm_drop_reviews, grants), the PG check, the rollback, the owner hand-off, the pure
 * core's self-tests and that the core stays bundle-safe for the iPad (no imports at all).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { __runAtmDropCoreTests, ATM_BILL_MINOR, splitDrops, validateAtmDropFields } from "@/lib/registers/atm-drop-core";
import { POST_APPLY_CHECKS } from "../../scripts/compliance/verify-migrations-execute";
import { classifyTable } from "@/lib/accounting/factory-reset-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const MIG = read("supabase/migrations/0346_atm_cash_drops.sql");

describe("D198 S1 migration 0346", () => {
  it("adds the five drawer_drops columns idempotently", () => {
    for (const c of ["destination text not null default 'safe'", "twenties_count integer", "atm_terminal_id text", "device_id text", "recorded_via text"]) {
      expect(MIG).toContain(`alter table public.drawer_drops add column if not exists ${c};`);
    }
  });

  it("an ATM drop is a $20 count and the amount is count x 2000, enforced by the database", () => {
    expect(MIG).toMatch(/check \(destination in \('safe', 'atm'\)\)/);
    expect(MIG).toMatch(/destination = 'safe' and twenties_count is null/);
    expect(MIG).toMatch(/amount_minor = twenties_count \* 2000/);
    expect(ATM_BILL_MINOR).toBe(2000);
  });

  it("the money on a drop is write-once", () => {
    expect(MIG).toMatch(/create or replace function public\.drawer_drops_money_immutable\(\)/);
    for (const col of ["session_id", "amount_minor", "destination", "twenties_count", "atm_terminal_id", "dropped_at"]) {
      expect(MIG).toContain(`new.${col} is distinct from old.${col}`);
    }
    expect(MIG).toMatch(/before update on public\.drawer_drops/);
    expect(MIG).not.toMatch(/before delete on public\.drawer_drops/);
    expect(MIG).toMatch(/revoke all on function public\.drawer_drops_money_immutable\(\) from public, anon, authenticated;/);
  });

  it("atm_drop_reviews is append-only for the server, invisible to app roles, kept by the reset, no FK", () => {
    expect(MIG).toMatch(/create table if not exists public\.atm_drop_reviews/);
    expect(MIG).toMatch(/alter table public\.atm_drop_reviews enable row level security;/);
    expect(MIG).toMatch(/revoke all on table public\.atm_drop_reviews from public, anon, authenticated;/);
    expect(MIG).toMatch(/revoke update, delete, truncate, references, trigger on table public\.atm_drop_reviews from service_role;/);
    expect(MIG).toMatch(/grant select, insert on table public\.atm_drop_reviews to service_role;/);
    const table = MIG.slice(MIG.indexOf("create table if not exists public.atm_drop_reviews"), MIG.indexOf("comment on table public.atm_drop_reviews"));
    expect(table).not.toMatch(/references/i);
    expect(classifyTable("atm_drop_reviews")?.disposition).toBe("KEEP");
    expect(classifyTable("drawer_drops")?.disposition).toBe("WIPE");
  });

  it("has a pg-check, a rollback and an owner hand-off", () => {
    expect(POST_APPLY_CHECKS).toContainEqual({ file: "scripts/recon/atm-cash-drops-0346-pg-check.sql", mustPrint: "ATM CASH DROPS 0346 CHECK PASSED" });
    expect(read("scripts/recon/atm-cash-drops-0346-pg-check.sql")).toContain("\\echo 'ATM CASH DROPS 0346 CHECK PASSED'");
    const rb = read("supabase/rollbacks/0346_atm_cash_drops.rollback.sql");
    expect(rb).toMatch(/\[ATM drop: /); // ATM details written into notes before the columns go
    expect(rb).toMatch(/if not exists \(select 1 from public\.atm_drop_reviews\)/); // sign-offs never destroyed
    expect(existsSync(join(ROOT, "supabase/rollbacks/0346_atm_cash_drops.rollback.sql"))).toBe(true);
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toContain("0346_atm_cash_drops.sql");
    expect(read("docs/sop-program/00-OWNER-REQUEST-VERBATIM.md")).toContain("i want the number of 20s taken from the till to be entered on the register");
  });
});

describe("D198 S1 pure core", () => {
  it("self-tests pass and are registered", () => {
    const r = __runAtmDropCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(53);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("atm-drop-core", __runAtmDropCoreTests()');
  });

  it("is bundle-safe for the iPad: imports nothing", () => {
    const src = read("src/lib/registers/atm-drop-core.ts");
    expect(src).not.toMatch(/^import /m);
  });

  it("old builds send no destination and stay safe drops; an ATM drop never trusts a typed amount", () => {
    const v = validateAtmDropFields({ amountMinor: 12345 });
    expect(v.ok && v.destination).toBe("safe");
    expect(validateAtmDropFields({ destination: "atm", twentiesCount: 3, amountMinor: 6001 }).ok).toBe(false);
  });

  it("drawer + drop-due count every drop; deposit / EOD count safe drops only", () => {
    const s = splitDrops([{ amount_minor: 100000 }, { amount_minor: 40000, destination: "atm", twenties_count: 20 }]);
    expect(s.totalMinor).toBe(140000);
    expect(s.safeMinor).toBe(100000);
    expect(s.atmMinor).toBe(40000);
  });
});

describe("D198 S2 register ATM drop (online + offline)", () => {
  it("till-core derives the ATM amount from the $20 count and passes destination through", async () => {
    const { validateTillRequest } = await import("@/lib/pos/till-core");
    const v = validateTillRequest({ action: "drop", pin: "1234", destination: "atm", twentiesCount: 80, window: "night" });
    expect(v.ok && v.req.action === "drop" && v.req.amountMinor).toBe(80 * ATM_BILL_MINOR);
    expect(v.ok && v.req.action === "drop" && v.req.destination).toBe("atm");
    expect(validateTillRequest({ action: "drop", pin: "1234", destination: "atm", twentiesCount: 80, amountMinor: 160001, window: "night" }).ok).toBe(false);
  });

  it("offline replay keeps the same rule", async () => {
    const { validateTillPayload } = await import("@/lib/pos/offline-till-core");
    const pin = { employeeId: "11111111-1111-4111-8111-111111111111", armedAt: "2026-11-07T10:00:00Z", keyId: "e1" };
    const v = validateTillPayload({ action: "drop", drawerRef: "22222222-2222-4222-8222-222222222222", reason: "offline", actor: pin, destination: "atm", twentiesCount: 10, window: "other" });
    expect(v.ok && v.req.action === "drop" && v.req.amountMinor).toBe(20000);
  });

  it("route, offline store and back office write the 0346 columns with a note-tag fallback and a detailed audit", () => {
    const route = read("src/app/api/pos/till/route.ts");
    expect(route).toContain('action: "drawer.atm_drop"');
    expect(route).toContain("atmWitnessCheck(");
    expect(route).toContain("getAtmDropSettings()");
    const off = read("src/lib/pos/offline-till-store.ts");
    expect(off).toContain('audit("drawer.atm_drop"');
    expect(off).toContain('recordedVia: "offline"');
    const store = read("src/lib/registers/store.ts");
    expect(store).toContain("export async function insertDrawerDropRow");
    expect(store).toMatch(/42703|PGRST204/);
    expect(read("src/app/admin/registers/actions.ts")).toContain('recordedVia: "back_office"');
  });

  it("the register asks for the NUMBER of $20 bills and the settings ride the bundle", () => {
    const shell = read("src/app/(site)/pos/RegisterShell.tsx");
    expect(shell).toContain("How many $20 bills are you taking for the ATM?");
    expect(shell).toContain("parseTwentiesInput(twenties, atmDrop.maxTwentiesPerDrop)");
    expect(read("src/app/api/pos/menu/route.ts")).toContain("getAtmDropSettings()");
  });
});

describe("D198 S3 ATM cash never counts toward the safe / bag", () => {
  it("deposit bag + night sheet use SAFE drops only; drop-due + drawer expected keep ALL drops", () => {
    const bag = read("src/lib/registers/deposit-bag-store.ts");
    expect(bag).toContain('readDropDestination(x).destination === "safe"');
    const eod = read("src/lib/registers/eod-store.ts");
    expect(eod).toContain('readDropDestination(d).destination === "safe"');
    // the drawer figure (drop-due $2,000 + expected close) still sums every drop
    expect(read("src/lib/registers/drawer-figure-store.ts")).toContain("totalDropsMinor(session.id)");
  });

  it("EOD + day report split the ATM drops out, oversight labels them", async () => {
    const { summarizeDrawerDay } = await import("@/lib/pos/day-report-core");
    const d = summarizeDrawerDay([], [{ amountMinor: 50000 }, { amountMinor: 40000, destination: "atm" }]);
    expect([d.dropsMinor, d.atmDropsMinor, d.atmDropCount]).toEqual([90000, 40000, 1]);
    expect(read("src/lib/registers/oversight.ts")).toContain("dropDestinationLabel(d)");
    expect(read("src/app/admin/registers/eod/page.tsx")).toContain("not in the bag");
  });
});

describe("D198 S4 drop <-> load matching engine (pure)", () => {
  it("self-tests pass and the engine stays pure (only the reconcile core import)", async () => {
    const m = await import("@/lib/atm/atm-drop-match-core");
    const r = m.__runAtmDropMatchCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(56);
    const src = read("src/lib/atm/atm-drop-match-core.ts");
    const imports = src.split("\n").filter((l) => /^import /.test(l));
    expect(imports.every((l) => l.includes("atm-reconcile-core"))).toBe(true);
  });

  it("two $20 drops that add up to one PAI load match exactly; a short load is flagged", async () => {
    const { matchAtmDrops } = await import("@/lib/atm/atm-drop-match-core");
    const drop = (id: string, at: string, n: number) => ({
      id, droppedAt: at, amountCents: n * 2000, twenties: n, terminalId: "HG26499", registerName: "R1",
      employeeId: "e1", employeeName: "Alex", witnessId: "e2", witnessName: "Sam",
      recordedVia: "register" as const, storedAs: "columns" as const, notes: null,
    });
    const load = (id: string, at: string, cents: number) => ({
      id, terminalId: "HG26499", loadedAt: at, loadDate: at.slice(0, 10), cashLoadCents: cents, balanceAfterCents: null, source: "pai" as const,
    });
    const options = { matchWindowMinutes: 120, terminalId: "HG26499", witnessPolicy: "recommended" as const, nowIso: "2026-11-07T20:00:00Z", plaidLastSyncedAt: "2026-11-07T14:00:00Z", hasAtmAccount: true };
    const good = matchAtmDrops({ drops: [drop("a", "2026-11-06T20:00:00Z", 10), drop("b", "2026-11-06T20:10:00Z", 15)], loads: [load("l", "2026-11-06T20:30:00Z", 50000)], settlements: [], deposits: [], reviews: [], options });
    expect(good.loads[0].status).toBe("matched");
    expect(good.drops.every((d) => d.status === "matched")).toBe(true);
    const short = matchAtmDrops({ drops: [drop("a", "2026-11-06T20:00:00Z", 25)], loads: [load("l", "2026-11-06T20:30:00Z", 48000)], settlements: [], deposits: [], reviews: [], options });
    expect(short.signals.some((s) => s.code === "LOAD_SHORT" && s.severity === "high")).toBe(true);
  });
});

describe("D198 S5 the owner's match page /admin/atm/drops", () => {
  it("is owner only (finances.view) everywhere: page, actions, CSV, nav", () => {
    expect(read("src/app/admin/atm/drops/page.tsx")).toContain('await requirePermission("finances.view")');
    const actions = read("src/app/admin/atm/drops/actions.ts");
    expect(actions.match(/requirePermission\("finances\.view"\)/g)?.length).toBe(2);
    expect(read("src/app/admin/atm/drops/csv/route.ts")).toContain('requirePermission("finances.view")');
    const nav = read("src/components/admin/admin-nav-data.ts").split("\n").find((l) => l.includes('href: "/admin/atm/drops"'));
    expect(nav).toContain('permission: "finances.view"');
    expect(nav).toContain('group: "Lyman"');
  });

  it("every sign-off is append-only, needs a reason, and is mirrored in the Security Log", () => {
    const actions = read("src/app/admin/atm/drops/actions.ts");
    expect(actions).toContain("validateAtmDropReview(");
    expect(actions).toContain('action: "atm.drop_review"');
    expect(actions).toContain('action: "atm.drop_settings"');
    const store = read("src/lib/atm/atm-drop-match-store.ts");
    expect(store).toContain('.from("atm_drop_reviews")');
    expect(store).not.toMatch(/atm_drop_reviews"\)\s*\.(update|delete|upsert)/);
    expect(read("src/app/admin/atm/drops/csv/route.ts")).toContain('action: "atm.drop_match_export"');
  });

  it("the page reads all four legs: till drops, PAI loads, settlements, the Plaid ATM account", () => {
    const store = read("src/lib/atm/atm-drop-match-store.ts");
    for (const s of ['.from("drawer_drops")', '.from("atm_cash_loads")', "listAtmSettlements(", "getAtmReconcileInputs(", "lastSuccessfulSync"]) expect(store).toContain(s);
    // ATM drops are picked by readDropDestination, so pre-0346 note-tagged drops are not lost
    expect(store).toContain('readDropDestination(r).destination === "atm"');
  });
});

describe("D198 S6 the ATM bank account auto-syncs; SOP + concierge", () => {
  it("the daily ATM cron refreshes every ATM-role Plaid connection after the PAI pull, never failing it", () => {
    const cron = read("src/app/api/cron/atm-sync/route.ts");
    expect(cron).toContain('.eq("role", "atm")');
    expect(cron).toContain("runPlaidSyncForItem(id)");
    expect(cron.indexOf("runAtmLiveSync()")).toBeLessThan(cron.indexOf("syncAtmBankAccount()"));
    expect(cron).toContain(".catch((e: unknown)");
    expect(cron).toContain("export const maxDuration = 300;");
    // still scheduled every morning
    expect(read("vercel.json")).toMatch(/"path": "\/api\/cron\/atm-sync",\s*"schedule": "0 14 \* \* \*"/);
  });

  it("SOP-01 4.25a, SOP-02 4.12 and the concierge describe ATM drops with the owner's words", () => {
    const sop1 = read("docs/sop/SOP-01-register-operations.md");
    expect(sop1).toContain("### 4.25a Cash drops to the ATM (owner D198)");
    expect(sop1).toMatch(/\| \*\*Version\*\* \| [^\n]*1\.23 \(draft/); // later versions keep 1.23 in the history
    expect(sop1).toContain("How many $20 bills are you taking for the ATM?");
    const sop2 = read("docs/sop/SOP-02-master-till-safe.md");
    expect(sop2).toMatch(/\| \*\*Version\*\* \| 1\.9 /);
    expect(sop2).toContain("**ATM drops (D198)**");
    expect(sop2).toContain("ATM drops in the books (D198, NOT BUILT on purpose)");
    const kb = read("src/lib/admin/concierge-kb.ts");
    expect(kb).toContain("ATM cash drops (D198;");
    expect(kb).toContain("/admin/atm/drops");
  });
});
