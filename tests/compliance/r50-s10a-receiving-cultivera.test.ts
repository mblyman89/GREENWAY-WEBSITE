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
} = { manifests: [], drafts: [], failManifests: false, failDraftsOnCall: 0, queries: [] };

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

import { __runReceivingTableCoreTests } from "../../src/lib/inventory/receiving-table-core";
import { loadReceivingCultiveraRows } from "../../src/lib/inventory/receiving-cultivera-store";
import { RECONSTRUCTED_MANIFEST_KIND } from "../../src/lib/inventory/cultivera-manifest-group-core";

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
});

describe("R50 S10a — the pure core", () => {
  it("self-tests run at the measured 87", () => {
    const r = __runReceivingTableCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(87);
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
    expect(table).toContain("href={`/admin/inventory/intake/${r.id}`}");
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
  it("the PO link panel is hidden for a rebuilt manifest and the store refuses the link", () => {
    expect(detail).toContain("poLink.available && !rebuilt &&");
    expect(store).toContain("isRebuiltKind(");
    expect(store).toContain("rebuilt from the Cultivera export");
  });
});
