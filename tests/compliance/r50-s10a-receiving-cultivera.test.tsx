/**
 * tests/compliance/r50-s10a-receiving-cultivera.test.ts   (R50 S10a, bible §0.5)
 *
 * Owner follow-up #5: "add an option to the receiving pages table that lets me
 * see all the Cultivera manifests in there, I can open the manifest like ones
 * we intake. It should have a completed not complete status ... better filters
 * and sorting so I can organize the list however I need."
 *
 * Pins:
 *   1. the pure core runs at its measured self-test count;
 *   2. the store reads EVERY rebuilt manifest (paged past the 1,000 cap, kind
 *      filter, chunked tally) and never guesses: a failed tally = Unknown,
 *      a failed manifest read = an error, not an empty list;
 *   3. the page: default view unchanged (rebuilt manifests stay out of the
 *      work queue and counts), the Cultivera view opens the same manifest page,
 *      and filters / sorting reach the table;
 *   4. the rebuilt manifest page stays accounting-inert (no PO link).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Q = { table: string; eq: [string, unknown][]; in: string[]; range: [number, number] };
const st: {
  manifests: Record<string, unknown>[];
  drafts: Record<string, unknown>[];
  failManifests: boolean;
  failDraftsOnCall: number;
  queries: Q[];
  kind: string | null;
  updates: Record<string, unknown>[];
} = { manifests: [], drafts: [], failManifests: false, failDraftsOnCall: 0, queries: [], kind: null, updates: [] };

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  isSupabaseServiceConfigured: true,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from(table: string) {
      const q: Q = { table, eq: [], in: [], range: [0, 0] };
      const b = {
        select() {
          return b;
        },
        eq(c: string, v: unknown) {
          q.eq.push([c, v]);
          return b;
        },
        in(_c: string, ids: string[]) {
          q.in = ids;
          return b;
        },
        order() {
          return b;
        },
        maybeSingle() {
          return Promise.resolve({ data: { id: "m1", payload_kind: st.kind }, error: null });
        },
        update(row: Record<string, unknown>) {
          st.updates.push(row);
          return { eq: () => Promise.resolve({ error: null }) };
        },
        range(from: number, to: number) {
          q.range = [from, to];
          st.queries.push(q);
          if (table === "inbound_manifests") {
            if (st.failManifests) return Promise.resolve({ data: null, error: { message: "manifests boom" } });
            return Promise.resolve({ data: st.manifests.slice(from, to + 1), error: null });
          }
          const draftCalls = st.queries.filter((x) => x.table === "catalog_product_drafts").length;
          if (st.failDraftsOnCall && draftCalls === st.failDraftsOnCall) {
            return Promise.resolve({ data: null, error: { message: "drafts boom" } });
          }
          const data = st.drafts.filter((d) => q.in.includes(d.manifest_id as string)).slice(from, to + 1);
          return Promise.resolve({ data, error: null });
        },
      };
      return b;
    },
  }),
}));

vi.mock("@/lib/purchasing/po-store", () => ({
  listPurchaseOrders: async () => [],
  getPurchaseOrder: async () => ({ id: "po1", po_number: "PO-1" }),
}));
vi.mock("@/lib/inventory/intake-store", () => ({ logManifestEvent: async () => undefined }));

import { __runReceivingTableCoreTests } from "../../src/lib/inventory/receiving-table-core";
import { loadReceivingCultiveraRows } from "../../src/lib/inventory/receiving-cultivera-store";
import { RECONSTRUCTED_MANIFEST_KIND } from "../../src/lib/inventory/cultivera-manifest-group-core";
import { setManifestPoLink } from "../../src/lib/inventory/po-link-store";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReceivingFilterBar } from "@/components/admin/inventory/ReceivingFilterBar";
import { CultiveraManifestTable } from "@/components/admin/inventory/CultiveraManifestTable";
import {
  parseReceivingFilters,
  receivingViewLinks,
  cultiveraTableRows,
  summarizeCultivera,
} from "../../src/lib/inventory/receiving-table-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

function manifest(i: number) {
  return {
    id: `m${String(i).padStart(5, "0")}`,
    manifest_number: `CV-${i}`,
    vendor_label: i % 2 ? "Odd Farms" : "Even Co",
    transfer_date: "2024-07-01",
    accepted_at: "2024-07-01T20:00:00Z",
    accepted_lot_count: i,
  };
}

beforeEach(() => {
  st.manifests = [];
  st.drafts = [];
  st.failManifests = false;
  st.failDraftsOnCall = 0;
  st.queries = [];
  st.kind = null;
  st.updates = [];
});

describe("R50 S10a — the pure core", () => {
  it("self-tests run at the measured 98", () => {
    const r = __runReceivingTableCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(98);
  });
});

describe("R50 S10a — the store reads every rebuilt manifest and never guesses", () => {
  it("pages past the 1,000-row cap, filters on the rebuilt kind, and tallies onboarding per manifest", async () => {
    st.manifests = Array.from({ length: 1205 }, (_, i) => manifest(i));
    st.drafts = [
      { id: "d1", manifest_id: "m00000", status: "approved" },
      { id: "d2", manifest_id: "m00000", status: "dismissed" },
      { id: "d3", manifest_id: "m00001", status: "draft" },
      { id: "d4", manifest_id: "m01204", status: "approved" },
    ];
    const r = await loadReceivingCultiveraRows();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(1205);
    expect(r.tallyRead).toBe(true);
    expect(r.truncated).toBe(false);
    const mq = st.queries.filter((q) => q.table === "inbound_manifests");
    expect(mq.map((q) => q.range[0])).toEqual([0, 1000]);
    for (const q of mq) expect(q.eq).toContainEqual(["raw_payload->>kind", RECONSTRUCTED_MANIFEST_KIND]);
    // Tally is chunked (<=100 ids per request), and every manifest id is asked about.
    const dq = st.queries.filter((q) => q.table === "catalog_product_drafts");
    expect(Math.max(...dq.map((q) => q.in.length))).toBeLessThanOrEqual(100);
    expect(new Set(dq.flatMap((q) => q.in)).size).toBe(1205);
    const by = new Map(r.rows.map((x) => [x.id, x]));
    expect(by.get("m00000")?.completion).toBe("complete");
    expect(by.get("m00001")?.completion).toBe("not_complete");
    expect(by.get("m00001")?.state).toBe("in_review");
    expect(by.get("m00002")?.completion).toBe("not_complete");
    expect(by.get("m00002")?.state).toBe("not_started");
    expect(by.get("m01204")?.completion).toBe("complete");
    expect(by.get("m00000")?.dayKey).toBe("2024-07-01");
  });

  it("a failed tally read (even a later chunk) makes every row Unknown, never Complete or Needs attention", async () => {
    st.manifests = Array.from({ length: 250 }, (_, i) => manifest(i));
    st.drafts = [{ id: "d1", manifest_id: "m00000", status: "approved" }];
    st.failDraftsOnCall = 3;
    const r = await loadReceivingCultiveraRows();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tallyRead).toBe(false);
    expect(r.rows.every((x) => x.completion === "unknown")).toBe(true);
  });

  it("a failed manifest read is an error, not an empty list", async () => {
    st.failManifests = true;
    const r = await loadReceivingCultiveraRows();
    expect(r).toEqual({ ok: false, error: "manifests boom" });
  });

  it("writes nothing (select-only store)", () => {
    const src = read("src/lib/inventory/receiving-cultivera-store.ts");
    expect(src).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
  });
});

describe("R50 S10a — the Receiving page", () => {
  const page = read("src/app/admin/inventory/intake/page.tsx");
  const table = read("src/components/admin/inventory/CultiveraManifestTable.tsx");
  const bar = read("src/components/admin/inventory/ReceivingFilterBar.tsx");

  it("the native views still use the work-queue reader (rebuilt manifests stay out) and the same view rule", () => {
    expect(page).toContain("listManifests({ limit: nativeLimit })");
    expect(page).not.toContain("includeMigration");
    expect(page).toContain("applyIntakeView(manifests, intakeView)");
    expect(page).toContain("countManifestsByStatus()");
  });

  it("the Cultivera view loads only when chosen, and the table opens the same manifest page", () => {
    expect(page).toContain("isCultiveraView ? loadReceivingCultiveraRows() : Promise.resolve(null)");
    // Both the manifest # and the Open button go to the manifest page.
    expect(table.match(/href=\{`\/admin\/inventory\/intake\/\$\{r\.id\}`\}/g)?.length).toBe(2);
    expect(table).toContain("draftsForManifestHref(r.id)");
    expect(table).toContain("COMPLETION_LABEL[r.completion]");
  });

  it("filters + sort flow from the URL through the core to both tables", () => {
    expect(page).toContain("parseReceivingFilters({ ...sp, view })");
    expect(page).toContain("applyNativeFilters(");
    expect(page).toContain("applyCultiveraFilters(cultivera.rows, filters)");
    expect(page).toContain("pageSlice(cultiveraFiltered, filters.page, CULTIVERA_TABLE_PAGE_SIZE)");
    expect(bar).toContain('<form method="get" action={RECEIVING_PATH}');
    for (const name of ["q", "vendor", "status", "from", "to", "sort"]) expect(bar).toContain(`name="${name}"`);
  });

  it("the per-row lookups only cover the rows actually shown", () => {
    expect(page).toContain("getParseStatusByManifestNumber(\n    tableRows.map((m) => m.manifest_number),");
    expect(page).toContain("listManifestDocLinks(\n    tableRows.map((m) => m.id),");
  });
});

describe("R50 S10a — a rebuilt manifest opens safely", () => {
  const detail = read("src/app/admin/inventory/intake/[id]/page.tsx");
  const store = read("src/lib/inventory/po-link-store.ts");
  it("the PO link panel is hidden for a rebuilt manifest", () => {
    expect(detail).toContain("poLink.available && !rebuilt &&");
    expect(detail).toContain('data-testid="rebuilt-manifest-banner"');
    expect(store).toContain("isRebuiltKind(");
  });

  it("the store refuses to link a rebuilt manifest to a PO, and writes nothing", async () => {
    st.kind = RECONSTRUCTED_MANIFEST_KIND;
    const r = await setManifestPoLink("m1", "po1", "u1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("rebuilt from the Cultivera export");
    expect(st.updates).toEqual([]);
  });

  it("a real delivery still links (the guard is narrow)", async () => {
    st.kind = null;
    const r = await setManifestPoLink("m1", "po1", "u1");
    expect(r).toEqual({ ok: true });
    expect(st.updates).toEqual([{ purchase_order_id: "po1", updated_by: "u1" }]);
  });
});

describe("R50 S10a — rendered HTML", () => {
  const f = parseReceivingFilters({ view: "cultivera", status: "not_complete", vendor: "Ace" });
  const links = receivingViewLinks(f, { processed: 2, cultivera: 3 });

  it("the filter bar renders three views, the Cultivera status choices, and keeps the view in the form", () => {
    const html = renderToStaticMarkup(
      createElement(ReceivingFilterBar, { filters: f, viewLinks: links, vendors: ["Ace", "Zed"], summary: "Showing 1 of 3.", capNote: null }),
    );
    expect(html).toContain('href="/admin/inventory/intake"');
    expect(html).toContain('href="/admin/inventory/intake?view=all"');
    expect(html).toContain('href="/admin/inventory/intake?view=cultivera"');
    expect(html).toMatch(/data-testid="receiving-view-cultivera"[^>]*aria-current="page"|aria-current="page"[^>]*data-testid="receiving-view-cultivera"/);
    expect(html).toContain('<input type="hidden" name="view" value="cultivera"/>');
    expect(html).toContain("Not complete (needs attention)");
    expect(html).not.toContain("In transit, past ETA");
    expect(html).not.toContain("ETA (soonest first)");
    expect(html).toContain('<option value="not_complete" selected="">');
    expect(html).toContain('<option value="Ace" selected="">');
    expect(html).toContain("Clear filters");
  });

  it("the native view hides the view input and offers the delivery statuses", () => {
    const nf = parseReceivingFilters({});
    const html = renderToStaticMarkup(
      createElement(ReceivingFilterBar, { filters: nf, viewLinks: receivingViewLinks(nf, { processed: 0, cultivera: null }), vendors: [], summary: null, capNote: "cap!" }),
    );
    expect(html).not.toContain('name="view"');
    expect(html).toContain("In transit, past ETA");
    expect(html).not.toContain("Clear filters");
    expect(html).toContain("cap!");
  });

  it("the Cultivera table shows Complete / Needs attention / Unknown and opens the manifest page", () => {
    const base = { stateLabel: "x", inReview: 0, approved: 0, day: "Jul 1, 2024", lots: 4 } as const;
    const rows = cultiveraTableRows(
      [
        { ...base, id: "11111111-1111-4111-8111-111111111111", number: "CV-1", vendor: "Ace", state: "done" },
        { ...base, id: "22222222-2222-4222-8222-222222222222", number: "CV-2", vendor: "Ace", state: "not_started" },
      ],
      new Map(),
      true,
    );
    const html = renderToStaticMarkup(
      createElement(CultiveraManifestTable, {
        load: { ok: true, rows, tallyRead: true, truncated: false },
        rows,
        summary: summarizeCultivera(rows),
        filters: f,
        page: 1,
        pageCount: 2,
      }),
    );
    expect(html).toContain('data-completion="complete"');
    expect(html).toContain('data-completion="not_complete"');
    expect(html).toContain("Needs attention");
    expect(html).toContain('href="/admin/inventory/intake/11111111-1111-4111-8111-111111111111"');
    expect(html).toContain("manifest=22222222-2222-4222-8222-222222222222");
    expect(html).toContain("Start onboarding");
    expect(html).toContain("1 need attention");
    expect(html).toContain("1 complete");
    expect(html).toContain("page=2");
  });

  it("an unread tally renders Unknown and the warning; a failed read renders the error", () => {
    const rows = cultiveraTableRows([{ stateLabel: "u", inReview: 0, approved: 0, day: null, lots: null, id: "a", number: "CV-9", vendor: "V", state: "not_started" }], new Map(), false);
    const html = renderToStaticMarkup(
      createElement(CultiveraManifestTable, { load: { ok: true, rows, tallyRead: false, truncated: false }, rows, summary: summarizeCultivera(rows), filters: f, page: 1, pageCount: 1 }),
    );
    expect(html).toContain('data-completion="unknown"');
    expect(html).toContain("cultivera-receiving-tally-error");
    expect(html).not.toContain("Needs attention</span>");
    const err = renderToStaticMarkup(
      createElement(CultiveraManifestTable, { load: { ok: false, error: "boom" }, rows: [], summary: null, filters: f, page: 1, pageCount: 1 }),
    );
    expect(err).toContain("could not be read: boom");
  });
});
