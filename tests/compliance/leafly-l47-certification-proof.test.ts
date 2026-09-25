/**
 * tests/compliance/leafly-l47-certification-proof.test.ts — SLICE L-47.
 *
 * The certification proof card must never claim more than the records show.
 * This suite pins that from four directions:
 *
 *   1. The requirement levels come from Leafly's own vendored spec table,
 *      parsed here — not from our memory of it.
 *   2. The vocabularies agree across files that cannot import each other:
 *      migration 0231's CHECK ↔ the core's operation list; the audit action
 *      names ↔ the writers that emit them; hmac-core's unsigned reason;
 *      certification-core's notice days; the six webhook event types.
 *   3. The new EVIDENCE WRITERS behave: Fetch Order leaves exactly one ledger
 *      row per dialled fetch, none for a local refusal, and a non-uuid
 *      attribution ("auto-acknowledge") no longer destroys the row.
 *   4. The loader never throws, and a failed read becomes "unknown", never
 *      "never done".
 *
 * The ID-image ledger is exercised at runtime in leafly-id-image-runtime.test.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// ---------------------------------------------------------------------------
// Mutable fixtures for the runtime sections
// ---------------------------------------------------------------------------
let inserted: Array<{ table: string; row: Record<string, unknown> }> = [];
let fetchResponses: Array<{ status: number; body: string } | "network"> = [];
let fetchCalls = 0;
let settingsThrow = false;
let integrationKey: string | null = "menu-key";
/** Per-table result for the loader's reads. */
let tableResults: Record<string, { data: unknown; error: { message: string } | null } | "throw"> = {};
let serviceConfigured = true;

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", () => ({
  get isSupabaseServiceConfigured() {
    return serviceConfigured;
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      const result = () => {
        const r = tableResults[table];
        if (r === "throw") return Promise.reject(new Error(`boom ${table}`));
        return Promise.resolve(r ?? { data: [], error: null });
      };
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "not", "like", "order", "gte", "lte"]) {
        builder[m] = () => builder;
      }
      builder.limit = () => ({ abortSignal: () => result(), then: (a: never, b: never) => result().then(a, b) });
      builder.insert = (row: Record<string, unknown>) => {
        inserted.push({ table, row });
        return { abortSignal: async () => ({ error: null }) };
      };
      return builder;
    },
  }),
}));
vi.mock("@/lib/leafly/config", () => ({ getLeaflyConfig: () => ({ environment: "sandbox" }) }));
vi.mock("@/lib/leafly/runtime", () => ({
  refreshLeaflyConfig: async () => {
    if (settingsThrow) throw new Error("settings unreadable");
  },
}));
vi.mock("@/lib/leafly/token", () => ({
  getLeaflyAccessToken: async () => "tok",
  resetLeaflyTokenCache: () => undefined,
}));
vi.mock("@/lib/leafly/webhook-server", () => ({
  loadLeaflyOrderIntegrationKey: async () => integrationKey,
}));
vi.mock("@/lib/leafly/deadline-fetch", () => ({
  leaflyFetchWithDeadline: async () => {
    fetchCalls += 1;
    const next = fetchResponses.shift() ?? "network";
    if (next === "network") {
      return { ok: false, response: null, verdict: { message: "offline", safeToRetry: true }, detail: "offline" };
    }
    return {
      ok: true,
      response: { status: next.status, text: async () => next.body, headers: { get: () => null } } as unknown as Response,
    };
  },
}));

const core = await import("@/lib/leafly/certification-proof-core");
const { fetchLeaflyOrder } = await import("@/lib/leafly/order-fetch-server");
const { recordLeaflyOutboundAttempt } = await import("@/lib/leafly/order-ack-server");
const { loadLeaflyCertificationProof, readDeleteCount, isAutomaticRun } = await import(
  "@/lib/leafly/certification-proof-server"
);
const { LEAFLY_ORDER_EVENT_TYPES } = await import("@/lib/leafly/order-contract-core");
const { LEAFLY_CERTIFICATION_NOTICE_BUSINESS_DAYS } = await import("@/lib/leafly/certification-core");

beforeEach(() => {
  inserted = [];
  fetchResponses = [];
  fetchCalls = 0;
  settingsThrow = false;
  integrationKey = "menu-key";
  tableResults = {};
  serviceConfigured = true;
});

const ledger = () => inserted.filter((i) => i.table === "leafly_outbound_attempts").map((i) => i.row);

// ===========================================================================
// 1. Leafly's own table
// ===========================================================================
describe("L-47 — requirement levels come from the vendored spec", () => {
  const spec = JSON.parse(read("docs/leafly-specs/order-api-v1.openapi.json")) as { info: { description: string } };
  const desc = spec.info.description;
  const table = desc.slice(desc.indexOf("Preparing for Production"));
  const levelOf = (element: string): string => {
    const line = table.split("\n").find((l) => l.startsWith(`| ${element}`));
    if (!line) throw new Error(`spec row missing: ${element}`);
    const cell = line.split("|")[4];
    if (/Required/.test(cell)) return "required";
    if (/Recommended/.test(cell)) return "recommended";
    if (/Optional/.test(cell)) return "optional";
    throw new Error(`no level in ${line}`);
  };
  const MAP: Array<[string, string]> = [
    ["Retailer Activation", "webhook_order_activate"],
    ["Retailer Deactivation", "webhook_order_deactivate"],
    ["Order Preview", "webhook_order_preview"],
    ["Order Submission", "webhook_order_submit"],
    ["Order Cancelation", "webhook_order_cancel"],
    ["Order Status", "webhook_order_status"],
    ["Fetch Order by ID", "order_fetch"],
    ["Retrieve Government ID Image", "order_government_id"],
    ["Retrieve Medical ID Image", "order_medical_id"],
    ["Acknowledge Order", "order_acknowledge"],
    ["Update Order Status", "order_status_update"],
    ["Update Order's Cart", "order_cart_update"],
  ];
  it.each(MAP)("%s → %s has the spec's level", (element, id) => {
    expect(core.proofActionDef(id as never).requirement).toBe(levelOf(element));
  });
  it("covers every row of the spec table (twelve elements)", () => {
    const rows = table
      .split("\n")
      .filter((l) => /^\| [A-Z]/.test(l) && !l.startsWith("| API Element"))
      .slice(0, 12);
    expect(rows).toHaveLength(12);
    expect(MAP.map(([e]) => e).sort()).toEqual(rows.map((l) => l.split("|")[1].trim()).sort());
  });
  it("names both terminal states as production requirements", () => {
    expect(desc).toMatch(/both terminal states \(\[`picked_up`, `canceled`\]\)/);
    expect(core.proofActionDef("lifecycle_picked_up").requirement).toBe("required");
    expect(core.proofActionDef("lifecycle_canceled").requirement).toBe("required");
  });
});

// ===========================================================================
// 2. Vocabularies that must agree
// ===========================================================================
describe("L-47 — vocabularies agree across files", () => {
  it("migration 0231's CHECK equals LEAFLY_OUTBOUND_OPERATIONS, both directions", () => {
    const sql = read(`supabase/migrations/${core.LEAFLY_PROOF_MIGRATION_FILE}`)
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    const m = sql.match(/check \(operation in \(([\s\S]*?)\)\)/);
    expect(m).not.toBeNull();
    const listed = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect([...listed].sort()).toEqual([...core.LEAFLY_OUTBOUND_OPERATIONS].sort());
  });
  it("0231 is safe to run twice and changes no data", () => {
    const sql = read(`supabase/migrations/${core.LEAFLY_PROOF_MIGRATION_FILE}`);
    expect(sql).toMatch(/drop constraint if exists leafly_outbound_attempts_operation_check/);
    const creates = sql.match(/create index/g) ?? [];
    const safeCreates = sql.match(/create index if not exists/g) ?? [];
    expect(creates.length).toBe(safeCreates.length);
    const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(code).not.toMatch(/\b(update|delete from|insert into|drop table|truncate)\b/i);
  });
  it("0226's original three operations are still allowed", () => {
    for (const op of ["acknowledge", "status", "cart"]) {
      expect(core.LEAFLY_OUTBOUND_OPERATIONS).toContain(op);
      expect(core.LEAFLY_OPERATIONS_NEEDING_0231).not.toContain(op);
    }
  });
  it("every audit action the core reads is emitted by a real writer", () => {
    const writers =
      read("src/app/admin/integrations/leafly/actions.ts") +
      read("src/app/admin/integrations/leafly/selection-actions.ts");
    for (const name of core.LEAFLY_PROOF_AUDIT_ACTION_NAMES) {
      expect(writers, name).toContain(`"${name}"`);
    }
  });
  it("the unsigned-probe reason is hmac-core's", () => {
    expect(read("src/lib/leafly/hmac-core.ts")).toContain(`"${core.LEAFLY_PROOF_UNSIGNED_REASON}"`);
  });
  it("notice days match certification-core", () => {
    expect(core.LEAFLY_PROOF_NOTICE_BUSINESS_DAYS).toBe(LEAFLY_CERTIFICATION_NOTICE_BUSINESS_DAYS);
  });
  it("every order webhook event type has a proof row", () => {
    for (const t of LEAFLY_ORDER_EVENT_TYPES) {
      const events = core.webhookRowToEvents({
        eventType: t,
        signatureVerified: true,
        rejectionReason: null,
        responseStatus: 200,
        at: "2026-01-01T00:00:00Z",
      });
      expect(events.length, t).toBeGreaterThan(0);
      expect(events[0].action).toBe(`webhook_${t}`);
    }
  });
  it("the ledger dispositions equal 0226's disposition CHECK", () => {
    const sql = read("supabase/migrations/0226_leafly_outbound_orders.sql");
    const m = sql.match(/disposition in\s*\(([^)]*)\)/);
    const listed = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect([...listed].sort()).toEqual([...core.LEAFLY_LEDGER_DISPOSITIONS].sort());
  });
  it("the online-orders report keeps its write-call scope", async () => {
    const { REPORT_OUTBOUND_OPERATIONS } = await import("@/lib/leafly/online-orders-report-core");
    expect([...REPORT_OUTBOUND_OPERATIONS]).toEqual(["acknowledge", "status", "cart"]);
  });
  it("the report's write + excluded-read lists partition every ledger operation", async () => {
    const m = await import("@/lib/leafly/online-orders-report-core");
    const union = [...m.REPORT_OUTBOUND_OPERATIONS, ...m.REPORT_EXCLUDED_READ_OPERATIONS];
    expect(new Set(union).size).toBe(union.length);
    expect([...union].sort()).toEqual([...core.LEAFLY_OUTBOUND_OPERATIONS].sort());
  });
  it("the report excludes read calls but never drops a row with no operation", async () => {
    const { buildOnlineOrdersReport } = await import("@/lib/leafly/online-orders-report-core");
    const r = buildOnlineOrdersReport({
      orders: [],
      attempts: [
        { operation: "acknowledge", disposition: "success" },
        { operation: "fetch_order", disposition: "success" },
        { operation: "government_id", disposition: "success" },
        { operation: "medical_id", disposition: "retry" },
        { disposition: "success" },
      ],
    } as never);
    expect(JSON.stringify(r)).toBeTruthy();
    expect((r as unknown as { outbound: { total: number } }).outbound.total).toBe(2);
  });
});

// ===========================================================================
// 3. The evidence writers
// ===========================================================================
describe("L-47 — Fetch Order leaves one ledger row per dialled fetch", () => {
  it("success → fetch_order / success / 200, and no order body stored", async () => {
    fetchResponses = [{ status: 200, body: JSON.stringify({ orderId: "o1", firstName: "Pat", status: "pending" }) }];
    const r = await fetchLeaflyOrder({ leaflyOrderId: "o1", knownLocally: true });
    expect(r.ok).toBe(true);
    expect(ledger()).toHaveLength(1);
    const row = ledger()[0];
    expect(row.operation).toBe("fetch_order");
    expect(row.disposition).toBe("success");
    expect(row.response_status).toBe(200);
    expect(row.leafly_order_id).toBe("o1");
    expect(row.order_integration_key).toBe("menu-key");
    expect(row.response_body).toBeNull();
    expect(row.request_body).toBeNull();
    expect(JSON.stringify(row)).not.toContain("Pat");
  });
  it("404 on a known order → gone", async () => {
    fetchResponses = [{ status: 404, body: "" }];
    await fetchLeaflyOrder({ leaflyOrderId: "o1", knownLocally: true });
    expect(ledger().map((r) => [r.disposition, r.response_status])).toEqual([["gone", 404]]);
  });
  it("403 → fix_config", async () => {
    fetchResponses = [{ status: 403, body: "" }];
    await fetchLeaflyOrder({ leaflyOrderId: "o1" });
    expect(ledger()[0].disposition).toBe("fix_config");
  });
  it("200 with an unreadable body → fix_request, not success", async () => {
    fetchResponses = [{ status: 200, body: "not json" }];
    const r = await fetchLeaflyOrder({ leaflyOrderId: "o1" });
    expect(r.ok).toBe(false);
    expect(ledger()[0].disposition).toBe("fix_request");
    expect(ledger()[0].response_status).toBe(200);
  });
  it("401 then 200 → ONE row, the final answer", async () => {
    fetchResponses = [
      { status: 401, body: "" },
      { status: 200, body: JSON.stringify({ orderId: "o1" }) },
    ];
    await fetchLeaflyOrder({ leaflyOrderId: "o1" });
    expect(fetchCalls).toBe(2);
    expect(ledger()).toHaveLength(1);
    expect(ledger()[0].disposition).toBe("success");
  });
  it("network failure → retry with no status", async () => {
    fetchResponses = ["network"];
    await fetchLeaflyOrder({ leaflyOrderId: "o1" });
    expect(ledger()).toHaveLength(1);
    expect(ledger()[0].disposition).toBe("retry");
    expect(ledger()[0].response_status).toBeNull();
  });
  it("our own settings failing → NO row (Leafly was never asked)", async () => {
    settingsThrow = true;
    await fetchLeaflyOrder({ leaflyOrderId: "o1" });
    expect(fetchCalls).toBe(0);
    expect(ledger()).toHaveLength(0);
  });
  it("no key configured → NO row", async () => {
    integrationKey = null;
    await fetchLeaflyOrder({ leaflyOrderId: "o1" });
    expect(fetchCalls).toBe(0);
    expect(ledger()).toHaveLength(0);
  });
});

describe("L-47 — a non-uuid attribution no longer destroys the ledger row", () => {
  it("'auto-acknowledge' → created_by null, attribution kept in the message", async () => {
    await recordLeaflyOutboundAttempt({
      leaflyOrderId: "o1",
      orderIntegrationKey: "k",
      operation: "acknowledge",
      message: "Leafly accepted the request (204).",
      createdBy: "auto-acknowledge",
      disposition: "success",
      responseStatus: 204,
    });
    expect(ledger()).toHaveLength(1);
    expect(ledger()[0].created_by).toBeNull();
    expect(ledger()[0].message).toBe("[auto-acknowledge] Leafly accepted the request (204).");
  });
  it("a real staff uuid still goes into created_by, message untouched", async () => {
    const id = "3f2c1a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c";
    await recordLeaflyOutboundAttempt({
      leaflyOrderId: "o1",
      orderIntegrationKey: "k",
      operation: "status",
      message: "ok",
      createdBy: id,
    });
    expect(ledger()[0].created_by).toBe(id);
    expect(ledger()[0].message).toBe("ok");
  });
  it("auto-ack still passes its machine attribution (so it is visible in the message)", () => {
    expect(read("src/lib/leafly/auto-ack-server.ts")).toMatch(/staffId:\s*"auto-acknowledge"/);
  });
});

// ===========================================================================
// 4. The loader
// ===========================================================================
describe("L-47 — the loader never throws and never turns 'unknown' into 'none'", () => {
  const NOW = "2026-09-25T19:00:00.000Z";
  it("reads every source and turns a recorded fetch into proof", async () => {
    tableResults = {
      leafly_outbound_attempts: {
        data: [
          {
            operation: "fetch_order",
            requested_status: null,
            disposition: "success",
            response_status: 200,
            refusal_code: null,
            attempted_at: "2026-09-24T18:00:00.000Z",
          },
        ],
        error: null,
      },
      audit_logs: {
        data: [{ action: "leafly.push.replace.success", after_json: { httpStatus: 200, method: "POST" }, created_at: "2026-09-24T17:00:00.000Z" }],
        error: null,
      },
    };
    const v = await loadLeaflyCertificationProof({ nowIso: NOW, environment: "sandbox" });
    const row = (id: string) => v.proof.rows.find((r) => r.def.id === id)!;
    expect(row("order_fetch").state).toBe("proven");
    expect(row("menu_post").state).toBe("proven");
    expect(row("order_acknowledge").state).toBe("none");
    expect(v.unreadable).toEqual([]);
    expect(v.problem).toBeNull();
    expect(v.recentEmail).toContain("Subject:");
  });
  it("a failing read → 'unreadable' rows and a problem sentence, not 'none'", async () => {
    tableResults = { leafly_webhook_events: { data: null, error: { message: "permission denied" } } };
    const v = await loadLeaflyCertificationProof({ nowIso: NOW, environment: "sandbox" });
    expect(v.unreadable).toEqual(["webhooks"]);
    expect(v.proof.rows.find((r) => r.def.id === "webhook_order_submit")!.state).toBe("unreadable");
    expect(v.proof.rows.find((r) => r.def.id === "menu_post")!.state).toBe("none");
    expect(v.problem).toMatch(/could not be read/);
  });
  it("a read that THROWS is contained", async () => {
    tableResults = { audit_logs: "throw" };
    const v = await loadLeaflyCertificationProof({ nowIso: NOW, environment: "sandbox" });
    expect(v.unreadable).toContain("audit");
    expect(v.proof.rows.find((r) => r.def.id === "menu_status")!.state).toBe("unreadable");
  });
  it("no database → every source unreadable, nothing claimed", async () => {
    serviceConfigured = false;
    const v = await loadLeaflyCertificationProof({ nowIso: NOW, environment: "sandbox" });
    expect(v.unreadable).toHaveLength(5);
    expect(v.proof.rows.some((r) => r.state === "proven")).toBe(false);
    expect(v.proof.rows.some((r) => r.state === "none")).toBe(false);
  });
  it("a full read marks the rows it feeds as saturated", async () => {
    const many = Array.from({ length: 1000 }, () => ({
      event_type: "order_status",
      signature_verified: true,
      rejection_reason: null,
      response_status: 200,
      received_at: "2026-09-24T18:00:00.000Z",
    }));
    tableResults = { leafly_webhook_events: { data: many, error: null } };
    const v = await loadLeaflyCertificationProof({ nowIso: NOW, environment: "sandbox" });
    expect(v.proof.rows.find((r) => r.def.id === "webhook_order_submit")!.saturated).toBe(true);
    expect(v.proof.rows.find((r) => r.def.id === "menu_post")!.saturated).toBe(false);
  });
  it("production hides the sandbox-only readback row", async () => {
    const v = await loadLeaflyCertificationProof({ nowIso: NOW, environment: "production" });
    expect(v.proof.rows.find((r) => r.def.id === "menu_readback")!.state).toBe("not_applicable");
  });
  it("automatic-run helpers read only what auto-sync writes", () => {
    expect(readDeleteCount({ deleteIds: ["a", "b"] })).toBe(2);
    expect(readDeleteCount({ deleteIds: "a" })).toBe(0);
    expect(readDeleteCount(null)).toBe(0);
    expect(isAutomaticRun({ automatic: "daily" })).toBe(true);
    expect(isAutomaticRun({ automatic: "" })).toBe(false);
    expect(isAutomaticRun({})).toBe(false);
    // auto-sync-server really writes these keys.
    const src = read("src/lib/leafly/auto-sync-server.ts");
    expect(src).toMatch(/automatic: input\.kind/);
    expect(src).toMatch(/deleteIds:/);
    expect(src).toMatch(/message: `Automatic /);
  });
});

// ===========================================================================
// 5. Wiring
// ===========================================================================
describe("L-47 — the card is on the Leafly page", () => {
  const page = read("src/app/admin/integrations/leafly/page.tsx");
  it("loads and renders the proof", () => {
    expect(page).toMatch(/await loadLeaflyCertificationProof\(/);
    expect(page).toMatch(/<LeaflyCertificationProofPanel view=\{certificationProof\} \/>/);
  });
  it("the pure core is registered in the self-test runner", () => {
    expect(read("scripts/compliance/run-pure-selftests.ts")).toMatch(
      /assertRan\("leafly-certification-proof-core", __runLeaflyCertificationProofTests\(\), \d+\)/,
    );
  });
  it("the panel holds no logic of its own (no Date, no fetch)", () => {
    const panel = read("src/components/admin/syndication/LeaflyCertificationProofPanel.tsx");
    expect(panel).not.toMatch(/new Date\(|Date\.now\(|fetch\(/);
    expect(panel).not.toMatch(/^"use client"/);
  });
});
