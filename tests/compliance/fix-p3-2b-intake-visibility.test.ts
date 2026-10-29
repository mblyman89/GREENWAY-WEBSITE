/**
 * tests/compliance/fix-p3-2b-intake-visibility.test.ts  (Fix Phase 3.2b · F-04-11 · F-04-3)
 *
 * The owner, verbatim (owner message 7):
 *   "I want this table to receive every manifest, no exceptions. If there are
 *    other things you feel as the expert you are, add in these things as you
 *    go. Add value if you can. Go above and beyond."
 *
 * F-04-11: a line whose lot did not save at staging was only a server-log
 * line; the delivery staged one product short with no warning. Now:
 *   1. pure core (intake-staging-core self-tests at the exact floor)
 *   2. the REAL stageManifest against the fake PostgREST: a failed lot insert
 *      writes ONE lot_insert_failed problem event naming the line, returns
 *      lineFailures, and the rest of the delivery still stages
 *   3. the REAL finalizeManifestDispositions: refused (nothing touched) until
 *      "the missing lines go back with the driver" is ticked; a timeline that
 *      cannot be read refuses; with the tick: partial, note required, the
 *      timeline says it
 * F-04-3 (control note): the sticky bar names the lines nobody decided, and
 * the Finalize timeline records how many were accepted with no decision.
 *   4. planFinalize sentences
 *   5. wiring: page banner + tick, action redirect, email notes, batch detail
 *   6. SOP / ledgers / KB pins
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakePostgrest, type Row } from "./helpers/fake-postgrest";

const st = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/fake-postgrest").FakePostgrest,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", async (orig) => ({
  ...((await orig()) as object),
  isSupabaseServiceConfigured: true,
  supabaseUrl: "https://x.supabase.co",
}));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  return {
    createSupabaseAdminClient: () => new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch }),
  };
});
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async () => undefined }));
vi.mock("@/lib/ai/suggestions", () => ({ persistSuggestion: async () => ({}) }));
vi.mock("@/lib/pos/menu-version", () => ({ getPublishedVersion: async () => null, getItemBySourceKey: async () => null }));
vi.mock("@/lib/ai/kb/store", () => ({ listKbProductCategoriesAll: async () => [] }));
vi.mock("@/lib/inventory/catalog-drafts", async (orig) => ({
  ...((await orig()) as object),
  seedDraftsForManifest: async () => ({ draftsCreated: 0, draftsFailed: 0, firstError: null, lotIdentities: null }),
}));
vi.mock("@/lib/inventory/coa-archive", () => ({ archiveCoasForManifest: async () => ({}) }));
vi.mock("@/lib/inventory/manifest-kb-bridge", () => ({ promoteManifestToKb: async () => ({ ok: true }) }));
vi.mock("@/lib/inventory/po-receive-store", () => ({ autoReceiveManifestPo: async () => ({ attempted: false, note: "" }) }));
vi.mock("@/lib/pos/intake-menu-staging", () => ({ stageIntakeMenuVersionForManifest: async () => ({ staged: false }) }));
vi.mock("@/lib/inventory/kb-link-store", () => ({ linkKbProductsToDrafts: async () => ({}) }));
vi.mock("@/lib/inventory/website-category-resolver-server", () => ({
  resolveWebsiteCategories: async (lots: unknown[]) => lots.map(() => ({ websiteCategory: "flower", label: "Flower", raw: null, source: "heuristic", unmapped: false })),
  resolveWebsiteCategoryForLot: async () => ({ websiteCategory: "flower", label: "Flower", raw: null, source: "heuristic", unmapped: false }),
}));

const store = await import("@/lib/inventory/intake-store");
const core = await import("@/lib/inventory/intake-staging-core");
const { planFinalize } = await import("@/lib/inventory/finalize-label-core");
const { labelForEvent, isKnownEventType } = await import("@/lib/inventory/manifest-event-labels-core");

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const ACTOR = "00000000-0000-4000-8000-0000000000ac";
const M = "00000000-0000-4000-8000-0000000000e1";
const LAB = "00000000-0000-4000-8000-0000000000c1";
const L = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;

function lot(id: string, over: Row = {}): Row {
  return {
    id,
    manifest_id: M,
    product_name: `Product ${id.slice(-2)}`,
    lot_code: `LC-${id.slice(-2)}`,
    unit: "each",
    received_qty: 20,
    on_hand_qty: 20,
    shipped_qty: null,
    short_reason_code: null,
    short_reason: null,
    status: "quarantine",
    disposition: null,
    ccrs_inventory_external_id: `CCRS-${id.slice(-2)}`,
    lab_result_id: LAB,
    received_on: null,
    ...over,
  };
}
function seed(lots: Row[], status = "received") {
  st.db.rows("inbound_manifests").push({ id: M, manifest_number: "0425", status, vendor_id: "00000000-0000-4000-8000-0000000000f1", vendor_label: "Vendor", accepted_at: null, raw_payload: {} });
  st.db.rows("inventory_lots").push(...lots);
}
const lotById = (id: string) => st.db.rows("inventory_lots").find((r) => r.id === id)!;
const events = (type: string) => st.db.rows("manifest_events").filter((e) => e.event_type === type);
const failEvent = (note: string) => st.db.rows("manifest_events").push({ id: st.db.nextId(), manifest_id: M, event_type: "lot_insert_failed", note, actor_id: null, created_at: "2026-07-01T10:00:00Z" });

function parsedLine(n: number, over: Record<string, unknown> = {}) {
  return {
    lot_code: `LC-${n}`,
    pos_product_key: `KEY-${n}`,
    product_name: `Product ${n}`,
    brand_name: null,
    strain_name: null,
    strain_type: null,
    category: "Usable Marijuana",
    inventory_type: "Usable Marijuana",
    unit_weight: 3.5,
    unit_weight_uom: "g",
    is_sample: false,
    is_medical: false,
    received_qty: 10 * n,
    unit: "each",
    unit_cost_minor_units: 500,
    expires_on: null,
    lab: null,
    low_thc_liquid: null,
    unit_thc_mg: null,
    otherwise_taken: null,
    units_per_package: null,
    ...over,
  };
}
const parsed = (lines: unknown[]) => ({
  manifest_number: null,
  vendor_label: "Acme Farms",
  vendor_license: null,
  transfer_date: null,
  source_format: "generic",
  lines,
});

/** The fake has no ilike: the vendor / alias / brand name lookups find nothing (a new vendor). */
type Hook = (req: import("./helpers/fake-postgrest").FakeRequest) => { status: number; body: unknown } | void;
function hook(custom: Hook | null = null) {
  st.db.before = (req) => custom?.(req) ?? (req.method === "GET" && /=ilike\./.test(req.url.search) ? { status: 200, body: [] } : undefined);
}

beforeEach(() => {
  st.db = new FakePostgrest();
  hook();
  process.env.INTAKE_IDENTITY_STAMP = "off";
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

// ─── 1. pure core ────────────────────────────────────────────────────────
describe("1. intake-staging-core", () => {
  it("self-tests pass at the exact floor (29) and are registered", () => {
    expect(core.__runIntakeStagingCoreTests()).toEqual({ passed: 29, failed: 0 });
    const r = read("scripts/compliance/run-pure-selftests.ts");
    expect(r).toContain('import { __runIntakeStagingCoreTests } from "../../src/lib/inventory/intake-staging-core"');
    expect(r).toContain('assertRan("intake-staging-core", __runIntakeStagingCoreTests(), 29)');
    expect(r).toContain('assertRan("finalize-label-core", __runFinalizeLabelCoreTests(), 37)');
  });
  it("is pure: no React, no next/*, no supabase, no process.env", () => {
    const s = read("src/lib/inventory/intake-staging-core.ts");
    expect(s).not.toMatch(/from "react"|from "next\/|supabase|process\.env|server-only/);
  });
  it("the event type is labelled, a delivery problem", () => {
    expect(core.LOT_INSERT_FAILED_EVENT).toBe("lot_insert_failed");
    expect(isKnownEventType("lot_insert_failed")).toBe(true);
    expect(labelForEvent("lot_insert_failed").problem).toBe(true);
    expect(labelForEvent("lot_insert_failed").group).toBe("delivery");
  });
});

// ─── 2. staging ──────────────────────────────────────────────────────────
describe("2. stageManifest records a line that did not save", () => {
  it("one of three lines fails: the other two stage, ONE problem event names the line, lineFailures returned", async () => {
    hook((req) => {
      if (req.table === "inventory_lots" && req.method === "POST" && (req.body as Row).lot_code === "LC-2") {
        return { status: 409, body: { code: "23503", details: null, hint: null, message: "insert or update on table inventory_lots violates foreign key constraint" } };
      }
    });
    const res = await store.stageManifest(parsed([parsedLine(1), parsedLine(2), parsedLine(3)]) as never, {}, ACTOR);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(st.db.rows("inventory_lots").map((r) => r.lot_code)).toEqual(["LC-1", "LC-3"]);
    const ev = st.db.rows("manifest_events").filter((e) => e.event_type === "lot_insert_failed");
    expect(ev).toHaveLength(1);
    expect(ev[0].manifest_id).toBe(res.manifestId);
    expect(ev[0].actor_id).toBe(ACTOR);
    const note = String(ev[0].note);
    expect(note).toMatch(/^1 of 3 lines did not save when this manifest was staged/);
    expect(note).toContain("Line 2: Product 2 (lot LC-2, 20 each) - insert or update on table inventory_lots violates foreign key constraint");
    expect(core.stagingFailureCount(note)).toBe(1);
    expect(res.lineFailures).toEqual({ count: 1, note });
  });
  it("two lines fail: counted and both named", async () => {
    hook((req) => {
      if (req.table === "inventory_lots" && req.method === "POST" && (req.body as Row).lot_code !== "LC-1") {
        return { status: 400, body: { code: "23514", details: null, hint: null, message: "check violation" } };
      }
    });
    const res = await store.stageManifest(parsed([parsedLine(1), parsedLine(2), parsedLine(3)]) as never, {}, ACTOR);
    expect(res.ok && res.lineFailures?.count).toBe(2);
    const note = String(events("lot_insert_failed")[0].note);
    expect(note).toContain("Line 2: Product 2");
    expect(note).toContain("Line 3: Product 3");
  });
  it("the 0234 retry failing is recorded too (the error of the retry)", async () => {
    process.env.INTAKE_IDENTITY_STAMP = "on";
    hook((req) => {
      if (req.table !== "inventory_lots" || req.method !== "POST") return;
      const b = req.body as Row;
      if ("identity_key" in b) return { status: 400, body: { code: "PGRST204", details: null, hint: null, message: "Could not find the 'identity_key' column of 'inventory_lots' in the schema cache" } };
      return { status: 409, body: { code: "23503", details: null, hint: null, message: "retry fk violation" } };
    });
    const res = await store.stageManifest(parsed([parsedLine(1)]) as never, {}, ACTOR);
    expect(res.ok && res.lineFailures?.count).toBe(1);
    expect(String(events("lot_insert_failed")[0].note)).toContain("retry fk violation");
  });
  it("the 0234 retry succeeding is NOT a failure", async () => {
    process.env.INTAKE_IDENTITY_STAMP = "on";
    hook((req) => {
      if (req.table === "inventory_lots" && req.method === "POST" && "identity_key" in (req.body as Row)) {
        return { status: 400, body: { code: "PGRST204", details: null, hint: null, message: "Could not find the 'identity_key' column of 'inventory_lots' in the schema cache" } };
      }
    });
    const res = await store.stageManifest(parsed([parsedLine(1)]) as never, {}, ACTOR);
    expect(res.ok).toBe(true);
    expect(res.ok && "lineFailures" in res).toBe(false);
    expect(events("lot_insert_failed")).toHaveLength(0);
    expect(st.db.rows("inventory_lots")).toHaveLength(1);
  });
  it("every line saves: no event, no lineFailures (unchanged result shape)", async () => {
    const res = await store.stageManifest(parsed([parsedLine(1), parsedLine(2)]) as never, {}, ACTOR);
    expect(res.ok).toBe(true);
    expect(res.ok && "lineFailures" in res).toBe(false);
    expect(events("lot_insert_failed")).toHaveLength(0);
  });
});

// ─── 3. finalize ─────────────────────────────────────────────────────────
describe("3. Finalize with lines that did not save", () => {
  const NOTE = core.stagingFailureNote([{ lineNo: 2, productName: "Product 2", lotCode: "LC-2", qty: 20, unit: "each", error: "fk" }], 2);
  it("not confirmed: refused before any lot is touched, the refusal names the fix", async () => {
    seed([lot(L(1))]);
    failEvent(NOTE);
    const res = await store.finalizeManifestDispositions(M, ACTOR, { partialNote: "Line 2 did not save." });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toContain(core.MISSING_LINES_REFUSAL);
    expect(!res.ok && res.error).toContain("Nothing was finalized");
    expect(lotById(L(1)).status).toBe("quarantine");
    expect(st.db.rows("inventory_adjustments")).toHaveLength(0);
    expect(st.db.rows("inbound_manifests")[0].status).toBe("received");
  });
  it("confirmed but no why-partial note: refused (a missing line makes it partial, like a short count)", async () => {
    seed([lot(L(1))]);
    failEvent(NOTE);
    const res = await store.finalizeManifestDispositions(M, ACTOR, { missingLinesConfirmed: true });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/note explaining why is required/i);
    expect(lotById(L(1)).status).toBe("quarantine");
  });
  it("confirmed with the note: partially accepted, the timeline says the missing line went back", async () => {
    seed([lot(L(1))]);
    failEvent(NOTE);
    const res = await store.finalizeManifestDispositions(M, ACTOR, { missingLinesConfirmed: true, partialNote: "Line 2 did not save; driver took it back." });
    expect(res.ok).toBe(true);
    expect(lotById(L(1)).status).toBe("active");
    expect(st.db.rows("inbound_manifests")[0].status).toBe("partially_accepted");
    const note = String(events("partially_accepted")[0].note);
    expect(note).toContain("1 line that did not save at staging went back with the driver (confirmed at Finalize; never Greenway's inventory).");
  });
  it("an unreadable timeline refuses (never read as 'nothing missing')", async () => {
    seed([lot(L(1))]);
    hook((req) => {
      if (req.table === "manifest_events" && req.method === "GET") return { status: 500, body: { code: "XX000", details: null, hint: null, message: "timeline down" } };
    });
    const res = await store.finalizeManifestDispositions(M, ACTOR);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toContain("timeline could not be read");
    expect(lotById(L(1)).status).toBe("quarantine");
  });
  it("no staging failure: the finalize is unchanged (accepted, no tick, no note)", async () => {
    seed([lot(L(1), { disposition: "accepted" })]);
    const res = await store.finalizeManifestDispositions(M, ACTOR);
    expect(res.ok).toBe(true);
    expect(st.db.rows("inbound_manifests")[0].status).toBe("accepted");
    expect(String(events("accepted")[0].note)).not.toContain("did not save");
  });
  it("F-04-3: the timeline records how many lines were accepted with no decision", async () => {
    seed([lot(L(1), { disposition: "accepted" }), lot(L(2)), lot(L(3))]);
    const res = await store.finalizeManifestDispositions(M, ACTOR);
    expect(res.ok).toBe(true);
    expect(String(events("accepted")[0].note)).toContain("2 lines were accepted with no decision on the line (a line not rejected is accepted).");
  });
  it("F-04-3: every line decided -> no undecided sentence", async () => {
    seed([lot(L(1), { disposition: "accepted" })]);
    await store.finalizeManifestDispositions(M, ACTOR);
    expect(String(events("accepted")[0].note)).not.toContain("no decision");
  });
});

// ─── 4. planFinalize ─────────────────────────────────────────────────────
describe("4. the sticky bar (planFinalize)", () => {
  it("F-04-3: some lines decided, some not -> the undecided count is said", () => {
    const p = planFinalize([{ id: "1", disposition: "rejected_at_dock" }, { id: "2", disposition: null }, { id: "3", disposition: null }]);
    expect(p.status).toContain("2 of those lines were not marked one by one; they are accepted because they were not rejected. Check the count.");
  });
  it("F-04-11: missing lines -> warning, note required, the bar says they go back", () => {
    const p = planFinalize([{ id: "1", disposition: null }], { missingLines: 2 });
    expect(p.missing).toBe(2);
    expect(p.noteRequired).toBe(true);
    expect(p.tone).toBe("warning");
    expect(p.status).toContain("2 lines from the vendor's manifest did not save at staging");
  });
});

// ─── 5. wiring ───────────────────────────────────────────────────────────
describe("5. wiring", () => {
  const page = read("src/app/admin/inventory/intake/[id]/page.tsx");
  const actions = read("src/app/admin/inventory/intake/actions.ts");
  const storeSrc = read("src/lib/inventory/intake-store.ts");
  it("the page reads the failures from the timeline, shows the banner, and the tick only when lines are missing", () => {
    expect(page).toContain("const stagingFailures = openStagingFailures(events);");
    expect(page).toContain("{ missingLines: stagingFailures.lines },");
    expect(page).toMatch(/\{stagingFailures\.lines > 0 && \(\s*<div\s+data-staging-failures/);
    expect(page).toMatch(/\{finalizePlan\.missing > 0 && \([\s\S]{0,200}name="missing_lines_confirmed" value="1" required/);
    expect(page).toContain('error === "missing_lines"');
    expect(page).toContain('error !== "missing_lines"');
  });
  it("the action passes the tick and maps the refusal to ?error=missing_lines", () => {
    expect(actions).toContain('const missingLinesConfirmed = formData?.get("missing_lines_confirmed") === "1";');
    expect(actions).toContain("finalizeManifestDispositions(manifestId, session.userId, { partialNote, missingLinesConfirmed })");
    expect(actions).toMatch(/if \(result\.error\.includes\(MISSING_LINES_REFUSAL\)\) \{\s*redirect\(`\/admin\/inventory\/intake\/\$\{manifestId\}\?error=missing_lines`\);/);
    expect(actions).toContain("line(s) did not save; open it before finalizing.");
  });
  it("the email path puts the failure on the email row's note (both JSON and PDF)", () => {
    const inbound = read("src/lib/inbound-email/inbound-store.ts");
    expect(inbound.match(/if \(staged\.lineFailures\) result\.notes\.push\(/g)).toHaveLength(2);
  });
  it("the store logs the problem event and the finalize gate is checked before any lot is touched", () => {
    expect(storeSrc).toContain("await logManifestEvent(manifestId, LOT_INSERT_FAILED_EVENT, note, actorId);");
    const fin = storeSrc.indexOf("export async function finalizeManifestDispositions(");
    const gate = storeSrc.indexOf("if (!missingGate.ok) return { ok: false, error: missingGate.error };", fin);
    const firstWrite = storeSrc.indexOf('.from("inventory_lots")\n            .update(', fin);
    expect(gate).toBeGreaterThan(fin);
    expect(firstWrite).toBeGreaterThan(gate);
  });
  it("the server-log line stays (operations still see it)", () => {
    expect(storeSrc).toContain('console.error("[intake-store] lot insert failed:", lotErr.message);');
  });
});

// ─── 6. docs ─────────────────────────────────────────────────────────────
describe("6. SOP / ledgers / KB", () => {
  const sop = read("docs/sop/SOP-04-receiving-intake.md");
  it("SOP-04 is v1.7; §4.6 is the built check, not the interim server-log text", () => {
    expect(sop).toMatch(/\| 1\.7 draft \| Fix phase \| Phase 3\.2b /);
    expect(sop).toMatch(/\| \*\*Version\*\* \|[^\n]*1\.7 \(Phase 3\.2b:/);
    expect(sop).not.toContain("the system only notes it in a server log and the line is simply missing from the screen");
    expect(sop).toContain("The missing lines go back with the driver");
  });
  it("03: F-04-11 FIXED quoting the superseded text; F-04-3 control note built", () => {
    const f = read("docs/sop-program/03-FINDINGS-LEDGER.md");
    expect(f).toMatch(/### F-04-11 · [^\n]*\n- \*\*Status: FIXED \(Phase 3\.2b/);
    expect(f).toMatch(/### F-04-3 · [^\n]*\n- \*\*Status: CONTROL NOTE BUILT \(Phase 3\.2b/);
  });
  it("05 / 06 / 04 rows", () => {
    expect(read("docs/sop-program/05-GAP-REGISTER.md")).toContain("Fix Phase 3.2b (F-04-11, F-04-3)");
    expect(read("docs/sop-program/06-FIX-PHASE-PLAN.md")).toMatch(/\| 3\.2b \| F-04-11/);
    expect(read("docs/sop-program/04-CONCIERGE-COVERAGE-LEDGER.md")).toContain("Fix Phase 3.2b update");
  });
  it("KB: the concierge knows a line that did not save", () => {
    expect(read("src/lib/admin/concierge-kb.ts")).toContain("Receiving \\u2192 a line did not save (Phase 3.2b");
  });
});
