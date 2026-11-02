/**
 * R41 round 9: the ACH Payments report (Reports tab, owner and admin only).
 *   - the REAL store over the REAL postgrest-js client against FakePostgrest
 *     (reads, failures reported, no account numbers or file bytes read);
 *   - the REAL pure core end to end on what the store returns;
 *   - who can see it: the permission matrix, the page/export guards, the tab;
 *   - the mutation log (test the tests).
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({ db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", async (orig) => ({ ...((await orig()) as object), isSupabaseServiceConfigured: true }));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  return {
    createSupabaseAdminClient: () => {
      const pg = new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch });
      return { from: (t: string) => pg.from(t), rpc: (fn: string, args: Record<string, unknown>) => pg.rpc(fn, args) };
    },
  };
});

const store = await import("@/lib/reports/ach-payments-report-store");
const core = await import("@/lib/reports/ach-payments-report-core");
const roles = await import("@/lib/auth/roles");
const tabs = await import("@/components/admin/reports/ReportTabs");

const read = (p: string) => readFileSync(p, "utf8");

const RUN = "11111111-1111-4111-8111-111111111111";
const FILE_P = "22222222-2222-4222-8222-222222222222";
const FILE_V = "33333333-3333-4333-8333-333333333333";
const FILE_UP = "44444444-4444-4444-8444-444444444444";

function seed(db: FakePostgrest) {
  db.tables.set("ach_files", [
    { id: FILE_P, kind: "payroll", source_id: RUN, filename: "payroll-2026-10-23.ach", effective_date: "2026-10-23", entry_count: 2, total_cents: 250_000, status: "bank_approved", released_at: "2026-10-20T18:00:00Z", uploaded_at: "2026-10-20T19:00:00Z", approved_at_bank_at: "2026-10-20T19:05:00Z", voided_at: null, voided_reason: null, body_enc: "SECRET-BYTES" },
    { id: FILE_V, kind: "vendor", source_id: "vendor-ach-1", filename: "vendor-ach-1.ach", effective_date: "2026-10-23", entry_count: 2, total_cents: 30_000, status: "bank_approved", released_at: "2026-10-20T18:00:00Z", uploaded_at: "2026-10-20T19:00:00Z", approved_at_bank_at: "2026-10-20T19:05:00Z", voided_at: null, voided_reason: null, body_enc: "SECRET-BYTES" },
    { id: FILE_UP, kind: "vendor", source_id: "vendor-ach-2", filename: "vendor-ach-2.ach", effective_date: "2026-11-06", entry_count: 1, total_cents: 12_345, status: "uploaded", released_at: "2026-10-29T18:00:00Z", uploaded_at: "2026-10-29T19:00:00Z", approved_at_bank_at: null, voided_at: null, voided_reason: null, body_enc: "SECRET-BYTES" },
  ]);
  db.tables.set("payroll_runs", [
    { id: RUN, label: "Oct 23 payroll", pay_date: "2026-10-23", status: "file_generated", total_net_cents: 250_000, entry_count: 2 },
    { id: "draft-1", label: "Nov 6 payroll", pay_date: "2026-11-06", status: "draft", total_net_cents: 180_000, entry_count: 2 },
  ]);
  db.tables.set("payroll_run_lines", [
    { run_id: RUN, employee_name: "A. Worker", net_pay_cents: 150_000, bank_account_number: "ENC-SECRET" },
    { run_id: RUN, employee_name: "B. Worker", net_pay_cents: 100_000, bank_account_number: "ENC-SECRET" },
    { run_id: "draft-1", employee_name: "Draft Person", net_pay_cents: 180_000, bank_account_number: "ENC-SECRET" },
  ]);
  db.tables.set("vendor_manifest_payments", [
    { id: "p1", manifest_id: "m1", noncannabis_invoice_id: null, vendor_name: "Farm One", manifest_number: "M-1", amount_minor_units: 10_000, payment_method: "ach", ach_batch_ref: "vendor-ach-1", reference: null, created_at: "2026-10-20T18:00:00Z" },
    { id: "p2", manifest_id: "m2", noncannabis_invoice_id: null, vendor_name: "Farm Two", manifest_number: "M-2", amount_minor_units: 20_000, payment_method: "ach", ach_batch_ref: "vendor-ach-1", reference: null, created_at: "2026-10-20T18:00:00Z" },
    { id: "p3", manifest_id: "m3", noncannabis_invoice_id: null, vendor_name: "Farm Three", manifest_number: "M-3", amount_minor_units: 12_345, payment_method: "ach", ach_batch_ref: "vendor-ach-2", reference: null, created_at: "2026-10-29T18:00:00Z" },
    { id: "p4", manifest_id: null, noncannabis_invoice_id: "inv1", vendor_name: "Supply Co", manifest_number: "INV-9", amount_minor_units: 500, payment_method: "check", ach_batch_ref: null, reference: "chk 101", created_at: "2026-10-10T18:00:00Z" },
  ]);
  db.tables.set("inbound_manifests", [
    { id: "m1", manifest_number: "M-1", vendor_id: "v1", vendor_label: "Farm One", status: "accepted", accepted_at: "2026-10-01T18:00:00Z", raw_payload: { kind: "wcia" } },
    { id: "m4", manifest_number: "M-4", vendor_id: "v1", vendor_label: "Farm One", status: "accepted", accepted_at: "2026-07-01T18:00:00Z", raw_payload: null },
    { id: "mig", manifest_number: "CV-1", vendor_id: "v1", vendor_label: "Farm One", status: "accepted", accepted_at: "2026-05-01T18:00:00Z", raw_payload: { kind: "cultivera-reconstructed" } },
  ]);
  db.tables.set("inventory_lots", [
    { manifest_id: "m1", received_qty: 10, unit_cost_minor_units: 1_500, status: "active" },
    { manifest_id: "m4", received_qty: 4, unit_cost_minor_units: 2_500, status: "active" },
    { manifest_id: "m4", received_qty: 100, unit_cost_minor_units: 100, status: "rejected" },
    { manifest_id: "mig", received_qty: 100, unit_cost_minor_units: 100, status: "active" },
  ]);
  db.tables.set("vendors", [{ id: "v1", display_name: "Farm One LLC" }]);
  db.tables.set("noncannabis_invoices", [{ id: "inv1", invoice_number: "INV-9", vendor_name: "Supply Co", invoice_date: "2026-10-05", total_minor_units: 2_000, status: "open" }]);
  db.tables.set("plaid_accounts", [
    { account_id: "acct-main", name: "Checking", official_name: null, custom_name: "Timberland Main", role: "main", active: true, available_balance_cents: 1_000_000, mask: "1234" },
    { account_id: "acct-atm", name: "ATM", official_name: null, custom_name: null, role: "atm", active: true, available_balance_cents: 5, mask: "9999" },
  ]);
  db.tables.set("plaid_transactions", [
    { transaction_id: "t-pay", account_id: "acct-main", amount_cents: 250_000, date: "2026-10-23", name: "ACH SETTLEMENT", merchant_name: null, pending: false, removed: false },
    { transaction_id: "t-ven", account_id: "acct-main", amount_cents: 30_000, date: "2026-10-23", name: "ACH SETTLEMENT", merchant_name: null, pending: false, removed: false },
    { transaction_id: "t-in", account_id: "acct-main", amount_cents: -900_000, date: "2026-10-22", name: "DEPOSIT", merchant_name: null, pending: false, removed: false },
    { transaction_id: "t-gone", account_id: "acct-main", amount_cents: 250_000, date: "2026-10-23", name: "REMOVED DUP", merchant_name: null, pending: false, removed: true },
    { transaction_id: "t-atm", account_id: "acct-atm", amount_cents: 30_000, date: "2026-10-23", name: "ATM", merchant_name: null, pending: false, removed: false },
  ]);
}

beforeEach(() => {
  st.db = new FakePostgrest();
  seed(st.db);
  // The fake cannot parse the migration-stock or= (commas inside in.(...));
  // drop it so the code-side filter (withoutMigrationManifests) is what is tested.
  st.db.before = (req) => {
    if (req.table === "inbound_manifests") req.url.searchParams.delete("or");
  };
});

const build = async (today = "2026-10-30") => {
  const load = await store.loadAchReportInputs();
  return { load, r: core.buildAchReport({ ...load.input, todayIso: today, fromDate: "2026-10-01", toDate: "2026-10-31" }) };
};

describe("the store, for real", () => {
  it("reads files, runs, lines, payments, bills and the Main account; no problems", async () => {
    const { load } = await build();
    expect(load.problems).toEqual([]);
    expect(load.tableReady).toBe(true);
    expect(load.input.files.map((f) => f.id).sort()).toEqual([FILE_P, FILE_V, FILE_UP].sort());
    expect(load.input.lines.map((l) => l.employeeName).sort()).toEqual(["A. Worker", "B. Worker"]); // draft run lines not read
    expect(load.input.hasMainAccount).toBe(true);
    expect(load.mainAccountNames).toEqual(["Timberland Main"]);
    expect(load.input.mainAvailableCents).toBe(1_000_000);
    expect(load.input.withdrawals.map((w) => w.transactionId).sort()).toEqual(["t-pay", "t-ven"]); // no inflow, no removed, no ATM account
  });

  it("never asks for file bytes or account numbers", async () => {
    await build();
    for (const req of st.db.log) {
      const sel = req.url.searchParams.get("select") ?? "";
      expect(sel).not.toMatch(/body_enc|bank_account_number|bank_routing|mask|access_token/);
    }
  });

  it("outstanding: owed from non-rejected lots minus payments; migration stock left out; paper invoices included", async () => {
    const { load } = await build();
    const byKey = new Map(load.input.payables.map((p) => [p.key, p]));
    expect(byKey.get("manifest:m1")).toMatchObject({ owedCents: 15_000, paidCents: 10_000, vendorName: "Farm One LLC", sinceDate: "2026-10-01" });
    expect(byKey.get("manifest:m4")).toMatchObject({ owedCents: 10_000, paidCents: 0 });
    expect(byKey.has("manifest:mig")).toBe(false);
    expect(byKey.get("ncinv:inv1")).toMatchObject({ owedCents: 2_000, paidCents: 500, sinceDate: "2026-10-05" });
  });

  it("a failed read is reported, never shown as empty-and-fine", async () => {
    st.db.before = (req) => {
      if (req.table === "inbound_manifests") req.url.searchParams.delete("or");
      if (req.table === "vendor_manifest_payments" && req.method === "GET" && (req.url.searchParams.get("select") ?? "").includes("payment_method"))
        return { status: 500, body: { message: "boom", code: "XX000" } };
    };
    const { load } = await build();
    expect(load.problems.some((p) => p.includes("Vendor payments could not be read"))).toBe(true);
  });

  it("each read failure has its own message (files, runs, accounts, transactions)", async () => {
    for (const [table, needle] of [
      ["ach_files", "ACH file list could not be read"],
      ["payroll_runs", "Payroll runs could not be read"],
      ["plaid_accounts", "bank accounts (Plaid) could not be read"],
      ["plaid_transactions", "Bank transactions for Timberland Main could not be read"],
      ["noncannabis_invoices", "Paper invoices could not be read"],
      ["inventory_lots", "Lot costs or payments for manifests"],
    ] as const) {
      st.db = new FakePostgrest();
      seed(st.db);
      st.db.before = (req) => {
        if (req.table === "inbound_manifests") req.url.searchParams.delete("or");
        if (req.table === table) return { status: 500, body: { message: "boom", code: "XX000" } };
      };
      const load = await store.loadAchReportInputs();
      expect(load.problems.join(" | "), table).toContain(needle);
    }
  });

  it("before migration 0273 the ledger is 'not ready', not an error", async () => {
    st.db.missing.add("ach_files");
    const load = await store.loadAchReportInputs();
    expect(load.tableReady).toBe(false);
    expect(load.problems).toEqual([]);
    expect(load.input.files).toEqual([]);
  });

  it("a cap that is hit is reported (older totals may be short)", async () => {
    const rows = st.db.rows("payroll_runs");
    for (let i = 0; i < store.REPORT_CAPS.runs + 1; i++) rows.push({ id: `x${i}`, label: null, pay_date: "2025-01-01", status: "void", total_net_cents: 0, entry_count: 0 });
    const load = await store.loadAchReportInputs();
    expect(load.problems.some((p) => p.includes(`More than ${store.REPORT_CAPS.runs} payroll runs`))).toBe(true);
  });

  it("an unreadable file row is left out and counted", async () => {
    st.db.rows("ach_files").push({ id: "bad", kind: "mystery", source_id: "z", filename: "z", effective_date: "2026-10-01", entry_count: 1, total_cents: 1, status: "released" });
    const load = await store.loadAchReportInputs();
    expect(load.problems).toContain("1 ACH file row(s) could not be read and are left out.");
  });
});

describe("store + core end to end", () => {
  it("matches the payroll and vendor files to the exact bank debits; employees and vendors cleared", async () => {
    const { r } = await build();
    const p = r.files.find((f) => f.id === FILE_P)!;
    const v = r.files.find((f) => f.id === FILE_V)!;
    expect(p.stage).toBe("cleared");
    expect(p.match?.transactionId).toBe("t-pay");
    expect(v.stage).toBe("cleared");
    expect(v.match?.transactionId).toBe("t-ven");
    expect(r.bankMatches.map((m) => m.transactionId).sort()).toEqual(["t-pay", "t-ven"]);
    const paid = r.payments.filter((x) => x.status === "cleared").map((x) => x.payee).sort();
    expect(paid).toEqual(["A. Worker", "B. Worker", "Farm One", "Farm Two"]);
  });

  it("the uploaded file is processing, with its deadline; the check is outside the bank feed", async () => {
    const { r } = await build();
    const up = r.files.find((f) => f.id === FILE_UP)!;
    expect(up.stage).toBe("uploaded");
    expect(up.deadlineDay).toBe("2026-11-04");
    expect(r.summary.processingCents).toBe(12_345);
    expect(r.payments.find((x) => x.payee === "Supply Co")?.status).toBe("outside_bank");
  });

  it("outstanding, drafts and funding come through", async () => {
    const { r } = await build();
    expect(r.summary.outstandingCents).toBe(5_000 + 10_000 + 1_500);
    expect(r.summary.agingCents["90+"]).toBe(10_000);
    expect(r.summary.draftPayrollCents).toBe(180_000);
    expect(r.funding).toEqual([{ date: "2026-11-06", cents: 12_345, files: 1 }]);
    expect(r.attention).toEqual([]);
  });

  it("after the deadline day the uploaded-not-approved file is flagged overdue", async () => {
    const { r } = await build("2026-11-05");
    expect(r.files.find((f) => f.id === FILE_UP)!.overdue).toBe(true);
    expect(r.attention.some((a) => a.includes("vendor-ach-2.ach") && a.includes("has passed"))).toBe(true);
  });
});

describe("owner and admin only", () => {
  it("ach.request is exactly owner and admin (managers and read-only cannot see it)", () => {
    expect(roles.rolesForPermission("ach.request").sort()).toEqual(["admin", "owner"]);
    for (const r of ["manager", "readonly", "budtender", "consultant"] as const) expect(roles.can(r as never, "ach.request")).toBe(false);
  });

  it("the page and the export check ach.request themselves (the layout's reports.view is not enough)", () => {
    const page = read("src/app/admin/reports/ach-payments/page.tsx");
    const exp = read("src/app/admin/reports/ach-payments/export/route.ts");
    expect(page).toMatch(/await requirePermission\("ach\.request"\);/);
    expect(page).not.toMatch(/requirePermission\("reports\.view"\)/);
    expect(exp).toMatch(/await requirePermission\("ach\.request"\);/);
    expect(exp).not.toMatch(/requirePermission\("reports\.view"\)/);
    expect(page.indexOf('requirePermission("ach.request")')).toBeLessThan(page.indexOf("loadAchReportInputs()"));
    expect(exp.indexOf('requirePermission("ach.request")')).toBeLessThan(exp.indexOf("loadAchReportInputs()"));
  });

  it("the tab is not in the shared list; it is added only when the layout says so", () => {
    expect(tabs.REPORT_TABS.some((t) => t.href === "/admin/reports/ach-payments")).toBe(false);
    expect(tabs.reportTabsFor(false).some((t) => t.href === "/admin/reports/ach-payments")).toBe(false);
    expect(tabs.reportTabsFor(true).at(-1)).toEqual(tabs.ACH_REPORT_TAB);
    const layout = read("src/app/admin/reports/layout.tsx");
    expect(layout).toContain('const showAchTab = can(session.profile.role, "ach.request");');
    // CVB-6: the layout also passes the owner-only Cultivera Benchmark flag; ACH stays last.
    expect(layout).toContain("<ReportTabs showAchTab={showAchTab} showCultiveraTab={showCultiveraTab} />");
    expect(tabs.reportTabsFor(true, true).at(-1)).toEqual(tabs.ACH_REPORT_TAB);
  });
});

describe("test the tests", () => {
  it("scripts/r41/mutate-ach-report.last.log: every mutant killed, controls passed, the log covers the script's full list", () => {
    const script = read("scripts/r41/mutate-ach-report.py");
    const log = read("scripts/r41/mutate-ach-report.last.log");
    const start = script.indexOf("\nM = [");
    const listed = script.slice(start, script.indexOf("\n]\n", start)).split("\n").filter((x) => /^\s{4}\("/.test(x)).length;
    const m = /total (\d+) killed (\d+) survivors \[\]/.exec(log);
    expect(m, "clean summary line").not.toBeNull();
    expect(Number(m![1])).toBe(listed);
    expect(Number(m![2])).toBe(listed);
    expect(listed).toBeGreaterThanOrEqual(12);
    for (const plan of ["page-reports-view", "tab-always", "window-wider", "voided-matched", "read-error-silent"]) expect(script).toContain(`("${plan}"`);
    expect(log).toContain("control (before) pass");
    expect(log).toContain("control (after) pass");
    expect(log).not.toMatch(/SURVIVED|ANCHOR/);
  });
});
