/**
 * tests/compliance/r74-s11-vendor-onboarding.test.tsx   (R74 S11, round 7)
 *
 * Owner: "i want to see the manifests in full in the receiving table under the
 * cultivera tab. i want to see the manifests in onboarding, grouped or
 * groupable by vendor. i want to see gemini telling me it can lookup all
 * products from a vendor. if you can increase the limits for the cultivera
 * look ups, please increase them ... i want to see the onboard page showing me
 * all the mastering it is doing to the products. i want to see the coas being
 * attached and the facts from them getting attached to the products."
 *
 * Pins:
 *   1. the pure vendor core at its measured count, registered in the runner;
 *   2. "Start every manifest from <vendor>": only that vendor, only not-done
 *      (unknown is worked), id order, stops on the time budget and resumes
 *      from the cursor without re-running, failures reported not hidden;
 *   3. "Look up all products from <vendor>": the SAME per-manifest enqueue,
 *      once per manifest in review, created/exists/nothing/error tallied, a
 *      missing migration stops loud;
 *   4. the mastering read: facts by source, KB links, lab + certificate
 *      coverage, Gemini progress, timeline; an unreadable part is reported,
 *      never zero;
 *   5. the receiving store reads group_kind into the Source column;
 *   6. the rendered UI: source chips, group-by-vendor roll-up, the vendor
 *      section's two buttons and the mastering panel;
 *   7. the two actions: inventory.manage, closed-set banners, no process.env;
 *   8. the lookup limits were raised (1000 per manifest, 30 per run, 4
 *      manifests at once by default).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  isSupabaseServiceConfigured: true,
}));

type Row = Record<string, unknown>;
const st: {
  rows: Row[];
  tallyRead: boolean;
  loadFails: boolean;
  started: string[];
  startFailFor: Set<string>;
  enq: string[];
  enqResult: (id: string) => unknown;
  audits: Row[];
  tables: Record<string, Row[]>;
  failTable: string | null;
} = {
  rows: [],
  tallyRead: true,
  loadFails: false,
  started: [],
  startFailFor: new Set(),
  enq: [],
  enqResult: () => ({ ok: true, kind: "created", jobId: "j", total: 3, truncated: 0 }),
  audits: [],
  tables: {},
  failTable: null,
};

vi.mock("@/lib/inventory/receiving-cultivera-store", () => ({
  loadReceivingCultiveraRows: async () =>
    st.loadFails ? { ok: false, error: "boom" } : { ok: true, rows: st.rows, tallyRead: st.tallyRead, truncated: false },
}));
vi.mock("@/lib/inventory/cultivera-onboarding", () => ({
  startCultiveraManifestOnboarding: async (id: string) => {
    st.started.push(id);
    if (st.startFailFor.has(id)) return { ok: false, error: `nope ${id.slice(-2)}` };
    return { ok: true, note: "n", seeded: 2 };
  },
}));
vi.mock("@/lib/catalog/lookup-job-server", () => ({
  enqueueManifestLookup: async (id: string) => {
    st.enq.push(id);
    return st.enqResult(id);
  },
}));
vi.mock("@/lib/auth/audit", () => ({
  recordAudit: async (e: Row) => {
    st.audits.push(e);
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from(table: string) {
      const f: { in: [string, unknown[]][]; notNull: string[] } = { in: [], notNull: [] };
      const run = (from = 0, to = 1e9) => {
        if (st.failTable === table) return Promise.resolve({ data: null, error: { message: `${table} boom` } });
        let rows = (st.tables[table] ?? []).filter((r) => f.in.every(([c, vals]) => vals.includes(r[c])));
        rows = rows.filter((r) => f.notNull.every((c) => r[c] != null));
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
      };
      const b = {
        select: () => b,
        in: (c: string, vals: unknown[]) => {
          f.in.push([c, vals]);
          return b;
        },
        not: (c: string) => {
          f.notNull.push(c);
          return b;
        },
        order: () => b,
        range: (a: number, z: number) => run(a, z),
        limit: (n: number) => run(0, n - 1),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run().then(res, rej),
      };
      return b;
    },
  }),
}));

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function row(n: number, vendor: string, state: "not_started" | "in_review" | "done", completion?: string, inReview = 0): Row {
  return {
    id: id(n),
    number: `CV-${n}`,
    vendor,
    day: "2024-07-01",
    lots: 2,
    state,
    stateLabel: state,
    inReview,
    approved: 0,
    dayKey: "2024-07-01",
    completion: completion ?? (state === "done" ? "complete" : "not_complete"),
    source: "transfer",
  };
}

beforeEach(() => {
  st.rows = [];
  st.tallyRead = true;
  st.loadFails = false;
  st.started = [];
  st.startFailFor = new Set();
  st.enq = [];
  st.enqResult = () => ({ ok: true, kind: "created", jobId: "j", total: 3, truncated: 0 });
  st.audits = [];
  st.tables = {};
  st.failTable = null;
});

describe("R74 S11 - the pure vendor core", () => {
  it("self-tests run at the measured 63 and are registered", async () => {
    const { __runCultiveraVendorCoreTests } = await import("@/lib/inventory/cultivera-vendor-core");
    const r = __runCultiveraVendorCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(63);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toMatch(/assertRan\("cultivera-vendor-core", __runCultiveraVendorCoreTests\(\), 63\)/);
  });
});

describe("R74 S11 - Start every manifest from a vendor", () => {
  it("starts only that vendor's not-done manifests, in id order; unknown is worked", async () => {
    st.rows = [row(3, "Ace Farms", "not_started"), row(1, "ace farms", "in_review"), row(2, "Ace Farms", "done"), row(4, "Ace Farms", "done", "unknown"), row(5, "Other", "not_started")];
    const { startCultiveraVendorOnboarding } = await import("@/lib/inventory/cultivera-vendor");
    const r = await startCultiveraVendorOnboarding("ACE FARMS", null, "u1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(st.started).toEqual([id(1), id(3), id(4)]);
    expect(r.run.planned).toBe(3);
    expect(r.run.started).toBe(3);
    expect(r.run.seeded).toBe(6);
    expect(r.run.done).toBe(true);
    expect(st.audits.at(-1)?.action).toBe("cultivera_onboarding.vendor_started");
    expect((st.audits.at(-1)?.after as Row).live_menu_changed).toBe(false);
  });

  it("stops on the time budget, then Continue resumes after the cursor without re-running", async () => {
    st.rows = [row(1, "Ace", "not_started"), row(2, "Ace", "not_started"), row(3, "Ace", "not_started")];
    const { startCultiveraVendorOnboarding } = await import("@/lib/inventory/cultivera-vendor");
    let t = 0;
    const now = () => t;
    // Each Start "takes" 70 s via the mocked clock: budget 200 s, needs 75 s left.
    const orig = st.started.push.bind(st.started);
    st.started.push = (...ids: string[]) => {
      t += 70_000;
      return orig(...ids);
    };
    const r1 = await startCultiveraVendorOnboarding("Ace", null, "u1", { now });
    expect(r1.ok && r1.run.started).toBe(2);
    expect(r1.ok && r1.run.done).toBe(false);
    expect(r1.ok && r1.run.next).toBe(id(2));
    t = 0;
    const r2 = await startCultiveraVendorOnboarding("Ace", r1.ok ? r1.run.next : null, "u1", { now });
    expect([...st.started]).toEqual([id(1), id(2), id(3)]);
    expect(r2.ok && r2.run.started).toBe(3); // 2 earlier + 1 now, of 3 planned
    expect(r2.ok && r2.run.planned).toBe(3);
    expect(r2.ok && r2.run.done).toBe(true);
  });

  it("reports failures, never hides them; unknown vendor / unreadable list fail loud", async () => {
    st.rows = [row(1, "Ace", "not_started"), row(2, "Ace", "not_started")];
    st.startFailFor = new Set([id(1)]);
    const { startCultiveraVendorOnboarding } = await import("@/lib/inventory/cultivera-vendor");
    const r = await startCultiveraVendorOnboarding("Ace", null, null);
    expect(r.ok && r.run.failed).toBe(1);
    expect(r.ok && r.run.started).toBe(1);
    expect(r.ok && r.run.errors[0]).toContain("nope");
    expect(await startCultiveraVendorOnboarding("Nobody", null, null)).toMatchObject({ ok: false });
    expect(await startCultiveraVendorOnboarding("  ", null, null)).toMatchObject({ ok: false });
    st.loadFails = true;
    expect(await startCultiveraVendorOnboarding("Ace", null, null)).toMatchObject({ ok: false, error: expect.stringContaining("boom") });
  });
});

describe("R74 S11 - Look up all products from a vendor with Gemini", () => {
  it("one SAME per-manifest enqueue per manifest in review (or unknown), tallied", async () => {
    st.rows = [row(1, "Ace", "in_review", undefined, 4), row(2, "Ace", "not_started"), row(3, "Ace", "done"), row(4, "Ace", "in_review"), row(5, "Ace", "in_review"), row(6, "Ace", "done", "unknown"), row(7, "B", "in_review")];
    st.enqResult = (m) =>
      m === id(4)
        ? { ok: true, kind: "exists", jobId: "j" }
        : m === id(5)
          ? { ok: false, code: "nothing", message: "x" }
          : m === id(6)
            ? { ok: false, code: "db", message: "down" }
            : { ok: true, kind: "created", jobId: "j", total: 7, truncated: 1 };
    const { enqueueVendorLookup } = await import("@/lib/inventory/cultivera-vendor");
    const r = await enqueueVendorLookup("ace", { userId: "u", email: "e" });
    expect(st.enq).toEqual([id(1), id(4), id(5), id(6)]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.run).toMatchObject({ created: 1, queuedProducts: 7, truncated: 1, alreadyRunning: 1, nothing: 1 });
    expect(r.run.errors[0]).toContain("CV-6: down");
    expect(st.audits.at(-1)?.action).toBe("catalog_draft.vendor_lookup_enqueued");
  });

  it("a missing migration stops loud", async () => {
    st.rows = [row(1, "Ace", "in_review")];
    st.enqResult = () => ({ ok: false, code: "migration", message: "" });
    const { enqueueVendorLookup } = await import("@/lib/inventory/cultivera-vendor");
    expect(await enqueueVendorLookup("Ace", { userId: null, email: null })).toMatchObject({ ok: false, migration: true });
  });
});

describe("R74 S11 - the mastering read", () => {
  it("facts by source, KB links, lab/certificate coverage, Gemini progress, timeline", async () => {
    st.rows = [row(1, "Ace", "in_review"), row(2, "Ace", "done"), row(3, "Other", "done")];
    st.tables = {
      catalog_product_drafts: [
        { id: "d1", manifest_id: id(1), status: "draft", kb_product_id: "k", attached_facts: { potency: { source: "coa" }, effects: { source: "gemini" } } },
        { id: "d2", manifest_id: id(2), status: "approved", kb_product_id: null, attached_facts: { potency: { source: "cultivera" } } },
        { id: "d3", manifest_id: id(3), status: "draft", kb_product_id: "k", attached_facts: { potency: { source: "coa" } } },
      ],
      inventory_lots: [
        { id: "l1", manifest_id: id(1), lab_result_id: "r1" },
        { id: "l2", manifest_id: id(1), lab_result_id: null },
        { id: "l3", manifest_id: id(2), lab_result_id: "r2" },
        { id: "l9", manifest_id: id(3), lab_result_id: "r1" },
      ],
      lab_results: [
        { id: "r1", coa_storage_path: "coa/x.pdf" },
        { id: "r2", coa_storage_path: null },
      ],
      lookup_jobs: [{ id: "j1", manifest_id: id(1), status: "running", total: 10, done: 4 }],
      manifest_events: [
        { manifest_id: id(1), event_type: "lab_facts_attach", note: "3 facts", created_at: "2024-07-02T10:00:00Z" },
        { manifest_id: id(2), event_type: "cultivera_onboarding", note: "seeded", created_at: "2024-07-03T10:00:00Z" },
      ],
    };
    const { loadVendorMastering } = await import("@/lib/inventory/cultivera-vendor");
    const m = await loadVendorMastering("Ace", st.rows as never);
    expect(m.errors).toEqual([]);
    expect(m.summary).toMatchObject({ drafts: 2, inReview: 1, approved: 1, linkedToKb: 1, withCoa: 1, withGemini: 1, withCultivera: 1, facts: 3 });
    expect(m.lab).toEqual({ lots: 3, withLab: 2, withCertificate: 1 });
    expect(m.lookup).toEqual({ jobs: 1, total: 10, done: 4 });
    expect(m.events?.map((e) => e.type)).toEqual(["cultivera_onboarding", "lab_facts_attach"]);
  });

  it("an unreadable part is reported, never shown as zero", async () => {
    st.rows = [row(1, "Ace", "in_review")];
    st.failTable = "inventory_lots";
    const { loadVendorMastering } = await import("@/lib/inventory/cultivera-vendor");
    const m = await loadVendorMastering("Ace", st.rows as never);
    expect(m.lab).toBeNull();
    expect(m.errors.join()).toContain("lab links");
    expect(m.summary).not.toBeNull();
  });
});

describe("R74 S11 - wiring and UI", () => {
  it("the receiving store reads group_kind and feeds the Source column", () => {
    const src = read("src/lib/inventory/receiving-cultivera-store.ts");
    expect(src).toContain("group_kind:raw_payload->>group_kind");
    expect(src).toMatch(/sourceOfGroupKind\(m\.group_kind\)/);
    expect(src).toMatch(/cultiveraTableRows\(views, dayKeys, tallyRead, sources\)/);
  });

  it("the Cultivera receiving table renders source chips, the Source badge and the vendor roll-up", async () => {
    const { CultiveraManifestTable } = await import("@/components/admin/inventory/CultiveraManifestTable");
    const { parseReceivingFilters, countSources } = await import("@/lib/inventory/receiving-table-core");
    const { groupByVendor } = await import("@/lib/inventory/cultivera-vendor-core");
    const rows = [{ ...row(1, "Ace", "in_review"), source: "email" }, { ...row(2, "Bee", "done"), source: "unmatched" }] as never[];
    const load = { ok: true as const, rows, tallyRead: true, truncated: false };
    const flat = renderToStaticMarkup(
      createElement(CultiveraManifestTable, {
        load,
        rows,
        summary: { total: 2, complete: 1, notComplete: 1, unknown: 0 },
        sources: countSources(rows),
        filters: parseReceivingFilters({ view: "cultivera" }),
        page: 1,
        pageCount: 1,
      }),
    );
    expect(flat).toContain('data-testid="cultivera-source-chips"');
    expect(flat).toContain("Emailed manifest (1)");
    expect(flat).toContain("Unmatched stock (1)");
    expect(flat).toContain('data-source="email"');
    expect(flat).toContain("Group by vendor");
    const grouped = renderToStaticMarkup(
      createElement(CultiveraManifestTable, {
        load,
        rows,
        summary: null,
        sources: countSources(rows),
        vendorGroups: groupByVendor(rows),
        filters: parseReceivingFilters({ view: "cultivera", group: "vendor" }),
        page: 1,
        pageCount: 3,
      }),
    );
    expect(grouped).toContain('data-testid="cultivera-vendor-groups"');
    expect((grouped.match(/data-testid="cultivera-vendor-group"/g) ?? []).length).toBe(2);
    expect(grouped).toContain("cv_vendor=Ace#cultivera-vendor");
    expect(grouped).not.toContain('aria-label="Cultivera manifest pages"');
    expect(grouped).not.toContain('data-testid="cultivera-receiving-row"');
  });

  it("the filter bar offers the source filter only on the Cultivera view", async () => {
    const { ReceivingFilterBar } = await import("@/components/admin/inventory/ReceivingFilterBar");
    const { parseReceivingFilters } = await import("@/lib/inventory/receiving-table-core");
    const cv = renderToStaticMarkup(createElement(ReceivingFilterBar, { filters: parseReceivingFilters({ view: "cultivera", group: "vendor" }), viewLinks: [], vendors: [], summary: null, capNote: null }));
    expect(cv).toContain('data-testid="receiving-filter-source"');
    expect(cv).toContain('name="group" value="vendor"');
    const all = renderToStaticMarkup(createElement(ReceivingFilterBar, { filters: parseReceivingFilters({ view: "all" }), viewLinks: [], vendors: [], summary: null, capNote: null }));
    expect(all).not.toContain("receiving-filter-source");
  });

  it("the onboarding vendor section shows the two buttons, Gemini's offer and the mastering panel", async () => {
    const { CultiveraVendorOnboarding } = await import("@/components/admin/inventory/CultiveraVendorOnboarding");
    const { groupByVendor, masteringSummary, vendorLookupBanner } = await import("@/lib/inventory/cultivera-vendor-core");
    const rows = [row(1, "Ace", "in_review", undefined, 5), row(2, "Ace", "not_started")] as never[];
    const vendors = groupByVendor(rows);
    const noop = async () => {};
    const html = renderToStaticMarkup(
      createElement(CultiveraVendorOnboarding, {
        error: null,
        vendors,
        selected: vendors[0],
        selectedRows: rows,
        mastering: {
          vendor: "Ace",
          manifestIds: [id(1), id(2)],
          summary: masteringSummary([{ status: "draft", kb_product_id: "k", attached_facts: { potency: { source: "coa" } } }]),
          lab: { lots: 4, withLab: 3, withCertificate: 2 },
          lookup: { jobs: 1, total: 5, done: 2 },
          events: [{ manifestId: id(1), type: "lab_facts_attach", note: "2 facts attached", at: "2024-07-02T10:00:00Z" }],
          errors: [],
        },
        startBanner: null,
        lookupBanner: vendorLookupBanner("ok", "Ace: Gemini is looking up 5 products"),
        startCursor: null,
        startAction: noop,
        lookupAction: noop,
        open: true,
      }),
    );
    expect(html).toContain("Start every manifest from Ace (2)");
    expect(html).toContain("Look up all 5 products from Ace with Gemini");
    expect(html).toContain("Gemini can look up every product from this vendor");
    expect(html).toContain("saved to the knowledge base");
    expect(html).toContain("3 of 4 lots linked to a lab result, 2 with the certificate file kept.");
    expect(html).toContain("Gemini is working: 2 of 5 products looked up across 1 manifest");
    expect(html).toContain("Lab certificate: 1 product");
    expect(html).toContain("Facts from lab certificates");
    expect(html).toContain('data-testid="cultivera-vendor-lookup-banner"');
    const cont = renderToStaticMarkup(
      createElement(CultiveraVendorOnboarding, {
        error: null, vendors, selected: vendors[0], selectedRows: rows, mastering: null, startBanner: null, lookupBanner: null,
        startCursor: id(1), startAction: noop, lookupAction: noop, open: true,
      }),
    );
    expect(cont).toContain("Continue starting Ace");
    expect(cont).toContain(`name="cursor" value="${id(1)}"`);
    expect(cont).toContain("The onboarding rows could not be read.");
  });

  it("the drafts page loads the vendor section only when asked, and the two actions are guarded", () => {
    const page = read("src/app/admin/inventory/drafts/page.tsx");
    expect(page).toMatch(/wantVendors = !focus\.draftId && !focus\.manifestId && \(Boolean\(cvVendorParam\) \|\| sp\.cv_vendors === "1"\)/);
    expect(page).toContain("startAction={startCultiveraVendorAction}");
    expect(page).toContain("lookupAction={lookupCultiveraVendorAction}");
    const actions = read("src/app/admin/inventory/drafts/actions.ts");
    for (const name of ["startCultiveraVendorAction", "lookupCultiveraVendorAction"]) {
      const body = actions.slice(actions.indexOf(`export async function ${name}`));
      const fn = body.slice(0, body.indexOf("\n}\n") + 2);
      expect(fn).toMatch(/requirePermission\("inventory\.manage"\)/);
      expect(fn).not.toMatch(/process\.env/);
      expect(fn).toContain("#cultivera-vendor");
    }
  });
});

describe("R74 S11 - the lookup limits were raised", () => {
  it("1000 products per manifest, 30 per run, 4 manifests at once (max 8)", async () => {
    const core = await import("@/lib/catalog/lookup-job-core");
    expect(core.LOOKUP_MAX_JOB_ITEMS).toBe(1000);
    expect(core.LOOKUP_MAX_ITEMS_PER_TICK).toBe(30);
    expect(core.lookupParallelJobs(undefined)).toBe(4);
    expect(core.lookupParallelJobs("99")).toBe(8);
    expect(core.lookupParallelJobs("0")).toBe(4);
    const server = read("src/lib/catalog/lookup-job-server.ts");
    expect(server).toContain("pickTickJob(open, t0, lookupParallelJobs(process.env[LOOKUP_PARALLEL_JOBS_ENV]))");
  });
});
