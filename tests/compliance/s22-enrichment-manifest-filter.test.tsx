/**
 * tests/compliance/s22-enrichment-manifest-filter.test.tsx
 *
 * S22 (bible F-081, F-079, F-008; owner request R-ENRICH-FILTER): the
 * Product Enrichment list can show exactly the products from one invoice /
 * manifest, and sort newest-from-receiving first.
 *
 *   1. Pure cores: exact self-test counts (a deleted check turns this red),
 *      parseEnrichmentSort accepts 'newest' (bible S22.5), filter tests.
 *   2. Server reads against a fake PostgREST: named columns, the indexed
 *      pos_product_key / primary-key lookups, chunked + paged (never a silent
 *      1000-row cap), pre-0214 retry, every failure -> null (filters off).
 *   3. Acceptance (S22.6) end to end on the real functions: ?manifest=<id>
 *      shows only that manifest's products; 'newest' puts them on top.
 *   4. Render test of the grid card's "From <delivery>" line.
 *   5. Page wiring (products page, Onboarding link) + ledger.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ATTRIBUTION_UNAVAILABLE_NOTE,
  CULTIVERA_PSEUDO_LABEL,
  MANIFEST_FILTER_LABEL,
  __runEnrichmentManifestCoreTests,
  applyManifestFilters,
  attributeCards,
  enrichDeliveryHref,
  parseEnrichmentManifestParams,
  type AttributionLot,
} from "../../src/lib/enrichment/enrichment-manifest-core";
import {
  ENRICHMENT_SORT_KEYS,
  __runEnrichmentMatchCoreTests,
  parseEnrichmentSort,
  sortEnrichmentList,
} from "../../src/lib/enrichment/match-core";
import {
  ATTRIBUTION_LOT_COLUMNS,
  ATTRIBUTION_LOT_COLUMNS_PRE_0214,
  ATTRIBUTION_MANIFEST_COLUMNS,
  isMissingReceivedOnError,
  readEnrichmentAttribution,
} from "../../src/lib/enrichment/enrichment-manifest";
import { computeGaps } from "../../src/lib/enrichment/store";
import { ProductGrid } from "../../src/components/admin/products/ProductGrid";
import type { PickerManifestRow } from "../../src/lib/catalog/onboarding-list-core";
import type { MenuItemRow } from "../../src/lib/pos/db-types";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true, supabaseUrl: "https://x.supabase.co" }));

// --- Fake PostgREST -----------------------------------------------------------
type Call = { table: string; ops: Array<[string, unknown[]]> };
const calls: Call[] = [];
let lotRows: Array<Record<string, unknown>> = [];
let manifestRows: PickerManifestRow[] = [];
let fail: { table: string; message: string; code?: string; onlyWith?: string } | null = null;
let throwClient = false;

function inList(call: Call): string[] {
  const op = call.ops.find(([m]) => m === "in");
  return (op?.[1][1] as string[]) ?? [];
}

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => {
    if (throwClient) throw new Error("no client");
    return {
      from(table: string) {
        const call: Call = { table, ops: [] };
        calls.push(call);
        const b: Record<string, unknown> = {};
        for (const m of ["select", "in", "order"]) {
          b[m] = (...args: unknown[]) => {
            call.ops.push([m, args]);
            return b;
          };
        }
        b.range = (from: number, to: number) => {
          call.ops.push(["range", [from, to]]);
          const sel = String(call.ops.find(([m]) => m === "select")?.[1][0] ?? "");
          if (fail && fail.table === table && (!fail.onlyWith || sel.includes(fail.onlyWith))) {
            return Promise.resolve({ data: null, error: { message: fail.message, code: fail.code } });
          }
          const ids = new Set(inList(call));
          const all =
            table === "inventory_lots"
              ? lotRows.filter((r) => ids.has(String(r.pos_product_key)))
              : manifestRows.filter((r) => ids.has(r.id));
          return Promise.resolve({ data: all.slice(from, to + 1), error: null });
        };
        return b;
      },
    };
  },
}));

const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const MI = "99999999-9999-4999-8999-999999999999";
const V1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const now = new Date("2025-03-20T18:00:00Z");

const man = (o: Partial<PickerManifestRow> & { id: string }): PickerManifestRow => ({
  manifest_number: null, vendor_id: null, vendor_label: null, transfer_date: null,
  received_at: null, accepted_at: null, status: "accepted", ...o,
});

function item(o: Partial<MenuItemRow> & { source_item_id: string; name: string }): MenuItemRow & { variants: { source_variant_id: string }[] } {
  return {
    id: `id-${o.source_item_id}`,
    brand_name: "B",
    category: "flower",
    description: null,
    price_minor_units: 2500,
    inventory_status: "in-stock",
    variants: [],
    ...o,
  } as unknown as MenuItemRow & { variants: { source_variant_id: string }[] };
}

beforeEach(() => {
  calls.length = 0;
  lotRows = [];
  manifestRows = [];
  fail = null;
  throwClient = false;
});

// === 1. Cores ====================================================================
describe("S22 cores", () => {
  it("self-tests pass with exact counts", () => {
    expect(__runEnrichmentManifestCoreTests()).toEqual({ passed: 75, failed: 0 });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    __runEnrichmentMatchCoreTests();
    expect(log).toHaveBeenCalledWith("enrichment-match-core: 78 checks passed");
    log.mockRestore();
  });
  it("parseEnrichmentSort accepts 'newest' (bible S22.5); the default is unchanged", () => {
    expect(parseEnrichmentSort("newest")).toBe("newest");
    expect(ENRICHMENT_SORT_KEYS).toContain("newest");
    expect(parseEnrichmentSort(undefined)).toBe("gaps");
    expect(parseEnrichmentSort("NEWEST")).toBe("gaps");
  });
  it("the filter label is the bible's S22.4 copy, word for word", () => {
    expect(MANIFEST_FILTER_LABEL).toBe("From invoice/manifest:");
    expect(CULTIVERA_PSEUDO_LABEL).toBe("Cultivera import");
  });
  it("the pseudo-manifest discriminator is the import-service manifest number, verbatim", () => {
    const svc = read("src/lib/pos/import-service.ts");
    expect(svc).toContain("manifest_number: `POS-IMPORT-${importId.slice(0, 8)}`,");
    const core = read("src/lib/enrichment/enrichment-manifest-core.ts");
    expect(core).toContain('export const IMPORT_MANIFEST_PREFIX = "POS-IMPORT-";');
  });
  it("the -onboarded lot rule is S19's cardLotKeys, reused (not a second copy)", () => {
    const core = read("src/lib/enrichment/enrichment-manifest-core.ts");
    expect(core).toContain('import { cardLotKeys } from "@/lib/inventory/vendor-identity-core";');
    expect(core).not.toMatch(/-onboarded"\s*;/);
  });
  it("the grounding claim holds: nothing writes the 0234 manifest columns on product_enrichments", () => {
    // If a writer appears (S12), this slice should switch to the column; the
    // test says so loudly rather than letting the two drift.
    const store = read("src/lib/enrichment/store.ts");
    expect(store).not.toMatch(/last_manifest_id|last_received_at|first_manifest_id/);
  });
});

// === 2. Server reads ============================================================
describe("S22 server reads", () => {
  const cards = [
    { source_item_id: "LOT-A", variants: [{ source_variant_id: "LOT-B-onboarded" }] },
    { source_item_id: "pos-cult", variants: [{ source_variant_id: "pos-cult-x" }] },
  ];
  it("two named-column reads by indexed keys, ordered + ranged", async () => {
    lotRows = [
      { id: "l1", pos_product_key: "LOT-A", manifest_id: M1, vendor_id: V1, created_at: null, received_on: null },
      { id: "l2", pos_product_key: "LOT-B", manifest_id: M2, vendor_id: null, created_at: null, received_on: null },
      { id: "l3", pos_product_key: "pos-cult", manifest_id: MI, vendor_id: null, created_at: null, received_on: "2024-09-01" },
    ];
    manifestRows = [
      man({ id: M1, manifest_number: "0421", received_at: "2025-03-12T20:00:00Z" }),
      man({ id: M2, manifest_number: "0500", received_at: "2025-03-19T17:00:00Z" }),
      man({ id: MI, manifest_number: "POS-IMPORT-abcd1234", accepted_at: "2025-01-01T00:00:00Z" }),
    ];
    const r = await readEnrichmentAttribution(cards);
    expect(r).not.toBeNull();
    const [lots, mans] = calls;
    expect(lots.table).toBe("inventory_lots");
    expect(lots.ops.find(([m]) => m === "select")![1][0]).toBe(ATTRIBUTION_LOT_COLUMNS);
    expect(ATTRIBUTION_LOT_COLUMNS).toBe("id, pos_product_key, manifest_id, vendor_id, created_at, received_on");
    expect(lots.ops.find(([m]) => m === "in")![1][0]).toBe("pos_product_key");
    expect(inList(lots).sort()).toEqual(["LOT-A", "LOT-B", "pos-cult"]);
    expect(lots.ops.find(([m]) => m === "order")![1]).toEqual(["id", { ascending: true }]);
    expect(mans.table).toBe("inbound_manifests");
    expect(mans.ops.find(([m]) => m === "select")![1][0]).toBe(ATTRIBUTION_MANIFEST_COLUMNS);
    expect(mans.ops.find(([m]) => m === "in")![1][0]).toBe("id");
    expect(inList(mans).sort()).toEqual([M1, M2, MI].sort());
    for (const c of calls) expect(String(c.ops.find(([m]) => m === "select")![1][0])).not.toContain("*");
    expect(r!.attrs.get("LOT-A")!.lastManifest.number).toBe("0500");
    expect(r!.attrs.get("pos-cult")!.source).toBe("cultivera");
    expect(r!.attrs.get("pos-cult")!.lastReceivedAt).toBe("2024-09-01T12:00:00.000Z");
  });
  it("pages past PostgREST's 1000-row cap (no silent truncation)", async () => {
    lotRows = Array.from({ length: 1500 }, (_, i) => ({
      id: `l${i}`, pos_product_key: "LOT-A", manifest_id: i === 1499 ? M2 : M1, vendor_id: null, created_at: null, received_on: null,
    }));
    manifestRows = [man({ id: M1, received_at: "2025-03-01T00:00:00Z" }), man({ id: M2, manifest_number: "LAST", received_at: "2025-03-19T00:00:00Z" })];
    const r = await readEnrichmentAttribution([{ source_item_id: "LOT-A", variants: [] }]);
    const lotCalls = calls.filter((c) => c.table === "inventory_lots");
    expect(lotCalls.length).toBe(2);
    expect(lotCalls[1].ops.find(([m]) => m === "range")![1]).toEqual([1000, 1999]);
    expect(r!.attrs.get("LOT-A")!.lastManifest.number).toBe("LAST");
  });
  it("no lot keys -> no reads, every card under the pseudo-manifest", async () => {
    const r = await readEnrichmentAttribution([{ source_item_id: "  ", variants: [] }]);
    expect(calls.length).toBe(0);
    expect(r!.attrs.get("  ")!.source).toBe("cultivera");
  });
  it("no lots -> the manifest read is skipped", async () => {
    const r = await readEnrichmentAttribution(cards);
    expect(calls.map((c) => c.table)).toEqual(["inventory_lots"]);
    expect(r!.manifests).toEqual([]);
  });
  it("a failed lot read -> null (filters off), never a short list", async () => {
    fail = { table: "inventory_lots", message: "statement timeout" };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readEnrichmentAttribution(cards)).toBeNull();
    err.mockRestore();
  });
  it("a failed manifest read -> null", async () => {
    lotRows = [{ id: "l1", pos_product_key: "LOT-A", manifest_id: M1, vendor_id: null, created_at: null, received_on: null }];
    fail = { table: "inbound_manifests", message: "boom" };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readEnrichmentAttribution(cards)).toBeNull();
    err.mockRestore();
  });
  it("a thrown client -> null", async () => {
    throwClient = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readEnrichmentAttribution(cards)).toBeNull();
    err.mockRestore();
  });
  it("pre-0214: received_on unknown -> ONE retry without it; dates read as unknown", async () => {
    lotRows = [{ id: "l3", pos_product_key: "pos-cult", manifest_id: MI, vendor_id: null, created_at: "2025-01-01T00:00:00Z", received_on: "2024-09-01" }];
    manifestRows = [man({ id: MI, manifest_number: "POS-IMPORT-1" })];
    fail = { table: "inventory_lots", message: 'column inventory_lots.received_on does not exist', code: "42703", onlyWith: "received_on" };
    const r = await readEnrichmentAttribution(cards);
    const lotSelects = calls.filter((c) => c.table === "inventory_lots").map((c) => c.ops.find(([m]) => m === "select")![1][0]);
    expect(lotSelects).toEqual([ATTRIBUTION_LOT_COLUMNS, ATTRIBUTION_LOT_COLUMNS_PRE_0214]);
    expect(r!.attrs.get("pos-cult")!.lastReceivedAt).toBeNull();
  });
  it("only a received_on missing-column error triggers the retry", () => {
    expect(isMissingReceivedOnError({ code: "42703", message: "column inventory_lots.received_on does not exist" })).toBe(true);
    expect(isMissingReceivedOnError({ code: "PGRST204", message: "Could not find the 'received_on' column" })).toBe(true);
    expect(isMissingReceivedOnError({ code: "42703", message: "column inventory_lots.vendor_id does not exist" })).toBe(false);
    expect(isMissingReceivedOnError({ code: "57014", message: "received_on timeout" })).toBe(false);
    expect(isMissingReceivedOnError(null)).toBe(false);
    expect(isMissingReceivedOnError({ message: "column received_on_source does not exist" })).toBe(false);
  });
  it("another error on the retry still -> null", async () => {
    fail = { table: "inventory_lots", message: "column received_on does not exist", code: "42703" };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readEnrichmentAttribution(cards)).toBeNull();
    expect(calls.filter((c) => c.table === "inventory_lots").length).toBe(2);
    err.mockRestore();
  });
});

// === 3. Acceptance (S22.6) ===================================================
describe("S22 acceptance", () => {
  // A live menu: two old Cultivera cards, one card approved from today's
  // delivery M2, and a Cultivera card restocked by M2 (its -onboarded variant).
  const items = [
    item({ source_item_id: "pos-aaa", name: "Aardvark OG" }),
    item({ source_item_id: "pos-zzz", name: "Zebra Kush" }),
    item({ source_item_id: "LOT-NEW", name: "Mango Haze" }),
    item({ source_item_id: "pos-rst", name: "Blue Dream", variants: [{ source_variant_id: "pos-rst-x" }, { source_variant_id: "LOT-RST-onboarded" }] } as never),
  ];
  const lots: AttributionLot[] = [
    { pos_product_key: "pos-aaa", manifest_id: MI, vendor_id: null, created_at: null, received_on: "2023-05-01" },
    { pos_product_key: "pos-zzz", manifest_id: MI, vendor_id: null, created_at: null, received_on: null },
    { pos_product_key: "pos-rst", manifest_id: MI, vendor_id: null, created_at: null, received_on: "2024-02-01" },
    { pos_product_key: "LOT-NEW", manifest_id: M2, vendor_id: V1, created_at: "2025-03-20T16:00:00Z", received_on: null },
    { pos_product_key: "LOT-RST", manifest_id: M2, vendor_id: V1, created_at: "2025-03-20T16:00:00Z", received_on: null },
  ];
  const manifests = [
    man({ id: MI, manifest_number: "POS-IMPORT-abcd1234", accepted_at: "2025-01-02T00:00:00Z" }),
    man({ id: M2, manifest_number: "0777", vendor_id: V1, vendor_label: "Phat Panda", accepted_at: "2025-03-20T17:00:00Z" }),
  ];
  const attrs = attributeCards(items, lots, manifests);
  const gaps = items.map((i) => computeGaps(i, null, attrs.get(i.source_item_id)));

  it("GapFlags carries lastManifest {id, number, vendor, receivedOn} and lastReceivedAt", () => {
    const g = gaps.find((x) => x.posKey === "LOT-NEW")!;
    expect(g.lastManifest).toEqual({ id: M2, number: "0777", vendor: "Phat Panda", receivedOn: "2025-03-20T17:00:00.000Z" });
    expect(g.lastReceivedAt).toBe("2025-03-20T17:00:00.000Z");
    expect(computeGaps(items[0], null).lastManifest).toBeNull();
    expect(computeGaps(items[0], null).lastReceivedAt).toBeNull();
  });
  it("?manifest=<id> shows only that manifest's products (new card + the restocked card)", () => {
    const r = applyManifestFilters(gaps, parseEnrichmentManifestParams({ manifest: M2 }), attrs, now);
    expect(r.applied).toBe(true);
    expect(r.rows.map((g) => g.name).sort()).toEqual(["Blue Dream", "Mango Haze"]);
  });
  it("'newest' puts the delivery's products on top", () => {
    const sorted = sortEnrichmentList(gaps, "newest").map((g) => g.name);
    expect(sorted.slice(0, 2)).toEqual(["Blue Dream", "Mango Haze"]);
    expect(sorted.slice(2)).toEqual(["Aardvark OG", "Zebra Kush"]);
  });
  it("legacy Cultivera cards sit under the 'Cultivera import' pseudo-manifest (S22.8)", () => {
    const r = applyManifestFilters(gaps, parseEnrichmentManifestParams({ manifest: "cultivera" }), attrs, now);
    expect(r.rows.map((g) => g.name)).toEqual(["Aardvark OG", "Zebra Kush"]);
    expect(gaps.find((g) => g.posKey === "pos-aaa")!.lastManifest!.vendor).toBe("Cultivera import");
  });
  it("unavailable attribution: filter asked for -> every row + the note", () => {
    const r = applyManifestFilters(gaps, parseEnrichmentManifestParams({ manifest: M2 }), null, now);
    expect(r.applied).toBe(false);
    expect(r.rows.length).toBe(4);
    expect(ATTRIBUTION_UNAVAILABLE_NOTE).toMatch(/every product is shown/);
  });
});

// === 4. Render ==================================================================
describe("S22 grid card", () => {
  const card = {
    posKey: "K", name: "N", brand: "B", category: "flower", hasDescription: true, hasImage: true,
    hasBrandLink: true, enrichmentStatus: null, thumbnailUrl: null,
  };
  it("shows 'From <delivery>' when attributed", () => {
    const html = renderToStaticMarkup(<ProductGrid cards={[{ ...card, receivedFrom: "0777 · Phat Panda · Mar 20" }]} />);
    expect(html).toContain("From 0777 · Phat Panda · Mar 20");
  });
  it("shows nothing extra when not attributed (legacy callers unchanged)", () => {
    const html = renderToStaticMarkup(<ProductGrid cards={[card]} />);
    expect(html).not.toContain("From ");
    expect(renderToStaticMarkup(<ProductGrid cards={[{ ...card, receivedFrom: null }]} />)).toBe(html);
  });
});

// === 5. Wiring + docs =========================================================
describe("S22 wiring", () => {
  const page = read("src/app/admin/products/page.tsx");
  it("searchParams gain manifest, since, vendor and are parsed by the core", () => {
    // S31 appended `error?: string` (product actions redirect with ?error=);
    // S20 appended `linked?: string` (the "Link records to products" flash).
    expect(page).toMatch(/back\?: string; manifest\?: string; since\?: string; vendor\?: string; error\?: string; linked\?: string \}/);
    expect(page).toContain("const mf = parseEnrichmentManifestParams(sp);");
  });
  it("attribution runs beside the enrichment read and feeds GapFlags", () => {
    expect(page).toMatch(/await Promise\.all\(\[\s*getEnrichmentsForKeys\(keys\),\s*readEnrichmentAttribution\(items\),\s*\]\)/);
    expect(page).toContain("computeGaps(i, enrichments.get(i.source_item_id) ?? null, attrs?.get(i.source_item_id) ?? null)");
  });
  it("the manifest filter applies BEFORE the sort", () => {
    const f = page.indexOf("applyManifestFilters(filtered, mf, attrs, now)");
    const s = page.indexOf("filtered = sortEnrichmentList(filtered, sort);");
    expect(f).toBeGreaterThan(0);
    expect(s).toBeGreaterThan(f);
  });
  it("the form offers the picker with the bible label, since, vendor and the newest sort", () => {
    expect(page).toContain("<span>{MANIFEST_FILTER_LABEL}</span>");
    expect(page).toContain('<Select name="manifest" defaultValue={manifestValue}');
    expect(page).toContain('<Select name="since"');
    expect(page).toContain('<Select name="vendor"');
    expect(page).toContain('<option value="newest">Sort: newest from receiving</option>');
  });
  it("the filters survive the grid/table toggle and remount the form", () => {
    expect(page).toContain('if (manifestValue) baseQs.set("manifest", manifestValue);');
    expect(page).toContain('if (mf.sinceDays !== null) baseQs.set("since", String(mf.sinceDays));');
    expect(page).toContain('if (mf.vendorId) baseQs.set("vendor", mf.vendorId);');
    expect(page).toContain("|${manifestValue}|${mf.sinceDays ?? \"\"}|${mf.vendorId ?? \"\"}`}");
    expect(page).toContain("stockFilter || hasManifestFilters(mf)) && (");
  });
  it("the unavailable note and the focus banner render only in their state", () => {
    expect(page).toContain("{!manifestFiltered.applied && (");
    expect(page).toContain("{ATTRIBUTION_UNAVAILABLE_NOTE}");
    expect(page).toContain("{focusSentence && (");
    expect(page).toContain("const focusSentence = manifestFiltered.applied ? manifestFocusSentence(mf.manifest, pickerOptions) : null;");
  });
  it("the table shows the From delivery column; the grid passes receivedFrom", () => {
    expect(page).toContain('<th className="px-4 py-3">From delivery</th>');
    expect(page).toContain("{receivedFromLabel(attrs?.get(g.posKey) ?? null, now)}");
    expect(page).toContain("receivedFrom: attrs ? receivedFromLabel(attrs.get(g.posKey) ?? null, now) : null,");
  });
  it("Onboarding's delivery banner links to the filtered enrichment list (F-008)", () => {
    const drafts = read("src/app/admin/inventory/drafts/page.tsx");
    expect(drafts).toContain("<Link href={enrichDeliveryHref(focus.manifestId)}");
    const banner = drafts.slice(drafts.indexOf("{focus.manifestId && ("), drafts.indexOf("S17: approve the whole delivery"));
    expect(banner).toContain("enrichDeliveryHref(focus.manifestId)");
    expect(enrichDeliveryHref(M2)).toBe(`/admin/products?manifest=${M2}&sort=newest#worklist`);
  });
  it("the reader is server-only, read-only and named-column", () => {
    const src = read("src/lib/enrichment/enrichment-manifest.ts");
    expect(src).toMatch(/^import "server-only";$/m);
    expect(src).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
    expect(src).not.toMatch(/select\("\*"\)/);
    expect(src).not.toMatch(/fetch\(|setInterval|cron/i);
  });
  it("the pure runner calls the core", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('import { __runEnrichmentManifestCoreTests } from "../../src/lib/enrichment/enrichment-manifest-core";');
    expect(runner).toContain("const r = __runEnrichmentManifestCoreTests(); if (r.failed > 0 || r.passed < 1) throw");
  });
  it("the env ledger lists S22 as adding no variable", () => {
    const ledger = read("docs/INTAKE_PIPELINE_ENV_LEDGER.md");
    // Durable facts, not the ledger's moving "latest slice" marker (S24 moved it).
    expect(ledger).toMatch(/Slices that added \*\*no\*\* variable: [^\n]*\bS21, S22\b/);
    expect(ledger).toMatch(/As of \*\*S\d+\*\* it reads \([^)]*\bS22\b[^)]*added no variable/);
    expect(ledger).toMatch(/"Revert\." \([^)]*\bS22\b[^)]*\)/);
  });
});
