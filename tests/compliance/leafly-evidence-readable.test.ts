/**
 * tests/compliance/leafly-evidence-readable.test.ts   (SLICE L-8)
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * Slice L-5 created `public.leafly_webhook_events`, wired all six webhook
 * routes to write to it, described it in migration 0225 as "the evidence Leafly
 * reviews at certification", and even created a partial index whose only
 * possible consumer is a screen listing rejected deliveries:
 *
 *     create index leafly_webhook_events_unverified_idx
 *       on public.leafly_webhook_events (received_at desc)
 *       where signature_verified = false;
 *
 * Then nobody read it. For three slices the table was write-only: the shop
 * could not see a signature failure, could not tell "Leafly is not sending"
 * apart from "Leafly is being rejected", and had no way to hand anyone the log.
 *
 * That regression was invisible because nothing failed. No test asserts
 * "somebody reads this table", so the gap produced a green suite. This file
 * closes that class of defect: the evidence log must have a reader, the reader
 * must be mounted in the admin, and the export must stay free of customer data.
 *
 * ── WHY IT READS THE FILESYSTEM ─────────────────────────────────────────────
 * Same technique as `tests/compliance/leafly-certification.test.ts`, which
 * reads `vercel.json` to prove the cron it claims actually exists. An assertion
 * about wiring has to inspect the wiring. Importing the module would prove it
 * compiles, not that it is CONNECTED — and "compiles but is never called" is
 * precisely the failure being guarded against.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  EVIDENCE_FORBIDDEN_KEYS,
  isForbiddenEvidenceKey,
  auditEvidenceKeys,
  buildEvidenceBundle,
  normalizeEvidenceKey,
} from "@/lib/leafly/evidence-core";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/**
 * Strip `//` and block comments so a rule about CODE is never satisfied or
 * broken by PROSE.
 *
 * This is not cosmetic. The first version of the `select("*")` assertion below
 * failed against `evidence-server.ts` -- not because the module does it, but
 * because its header comment EXPLAINS why it must not. A gate that a correct
 * file cannot pass is a broken gate, and the tempting fix (delete the
 * explanation) would have thrown away the documentation to appease the test.
 *
 * Deliberately naive about string literals containing "//" -- there are none in
 * the files this test reads, and a full tokeniser here would be a second parser
 * to maintain. The assertions that depend on prose (`toContain` of a symbol
 * name) read the RAW text; only the forbidding assertions read the stripped
 * text, so an over-eager strip can never create a false PASS.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const EVENTS_TABLE = "leafly_webhook_events";
const CORE = "src/lib/leafly/evidence-core.ts";
const SERVER = "src/lib/leafly/evidence-server.ts";
const PANEL = "src/components/admin/syndication/LeaflyEvidencePanel.tsx";
const PAGE = "src/app/admin/integrations/leafly/page.tsx";
const ROUTE = "src/app/admin/integrations/leafly/evidence-export/route.ts";
const MIGRATION = "supabase/migrations/0225_leafly_order_webhooks.sql";

describe("SLICE L-8 — the Leafly evidence log is readable, and stays readable", () => {
  it("all five L-8 files exist on disk", () => {
    for (const f of [CORE, SERVER, PANEL, ROUTE]) {
      expect(existsSync(resolve(ROOT, f)), `${f} must exist`).toBe(true);
    }
    // And the thing they read must still be created by a migration.
    expect(read(MIGRATION)).toContain(`create table if not exists public.${EVENTS_TABLE}`);
  });

  it("the evidence table has a READER, not just writers", () => {
    const server = read(SERVER);
    // The server module must actually query the table by name.
    expect(server).toContain(`.from("${EVENTS_TABLE}")`);
    expect(server).toContain('.from("leafly_orders")');
    // And it must be a read. `select` present, and no write verbs at all --
    // this log is append-only evidence and a reader that could mutate it would
    // destroy the property that makes it evidence.
    expect(server).toContain(".select(");
    // CODE only, for the same reason as above: the module explains in prose
    // that it never writes, and those sentences must not trip the gate.
    const serverCode = stripComments(server);
    expect(serverCode).toContain(".select(");
    for (const verb of [".insert(", ".update(", ".upsert(", ".delete("]) {
      expect(serverCode.includes(verb), `evidence-server must never call ${verb}`).toBe(false);
    }
  });

  it("the reader is mounted on a page the owner can actually reach", () => {
    const page = read(PAGE);
    // Imported...
    expect(page).toContain("loadLeaflyEvidence");
    expect(page).toContain("LeaflyEvidencePanel");
    // ...AND rendered. An import alone is exactly the "compiles but is never
    // called" state this file exists to forbid, and tree-shaking means an
    // unrendered import is genuinely dead.
    expect(page).toContain("<LeaflyEvidencePanel");
    // ...AND actually invoked, not merely imported.
    expect(page).toMatch(/loadLeaflyEvidence\(\)/);
  });

  it("the panel renders the rejected-delivery information the 0225 index was built for", () => {
    const panel = read(PANEL);
    // 0225 created a partial index on `signature_verified = false`. That index
    // is a promise that rejections are surfaced. Prove the panel keeps it.
    expect(panel).toContain("totalUnverified");
    expect(panel).toContain("classifyEvidenceDelivery");
    expect(panel).toContain("evidenceDispositionExplanation");
    // The panel must carry NO decision logic of its own (house rule 11): every
    // verdict word comes from the pure core.
    expect(panel).toContain("@/lib/leafly/evidence-core");
  });

  it("the export route fails closed on the privacy audit", () => {
    const route = read(ROUTE);
    // It must CHECK the audit...
    expect(route).toContain("privacyViolations");
    // ...and refuse, rather than log-and-continue. The 500 is the point: a
    // download that silently included a customer's phone number would be
    // worse than no download at all.
    expect(route).toMatch(/privacyViolations\.length\s*>\s*0/);
    expect(route).toContain("status: 500");
    // It must reuse the shared workbook writer, not hand-roll CSV escaping
    // (house rule 11 — ten other admin exports already use this).
    expect(route).toContain("@/lib/reports/workbook");
    expect(route).toContain("exportResponse");
    // And it must be permission-gated.
    expect(route).toContain("requirePermission");
  });

  it("the server never selects * from a table holding customer data", () => {
    const server = read(SERVER);
    // CODE only -- see `stripComments`. This module's header comment quotes
    // `select("*")` in order to explain why it is forbidden, and a gate that
    // punished the explanation would be encouraging its deletion.
    const code = stripComments(server);
    // `leafly_orders.raw_order` holds the full Leafly Order payload, which per
    // Leafly's own schema REQUIRES firstName, lastName, emailAddress and
    // phoneNumber, and may carry dateOfBirth and medicalCardNumber. A
    // select-star in a module whose purpose is producing a downloadable file
    // would pull all of it into scope.
    expect(code.includes('select("*")'), "no select(*) in evidence-server code").toBe(false);
    expect(code.includes("select('*')"), "no select('*') in evidence-server code").toBe(false);
    // Prove the stripper is not simply emptying the file, which would make the
    // two assertions above pass vacuously.
    expect(code).toContain(".select(");
    expect(code.length).toBeGreaterThan(600);
    // The explicit column list must not name the PII column.
    expect(server).toContain("EVIDENCE_ORDER_COLUMNS");
    const m = server.match(/export const EVIDENCE_ORDER_COLUMNS\s*=\s*"([^"]+)"/);
    expect(m, "EVIDENCE_ORDER_COLUMNS must be a plain string literal").toBeTruthy();
    const cols = (m![1] ?? "").split(",").map((c) => c.trim());
    expect(cols.length).toBeGreaterThanOrEqual(6);
    for (const c of cols) {
      expect(isForbiddenEvidenceKey(c), `selected order column must be PII-free: ${c}`).toBe(false);
    }
    // Specifically: raw_order must never be SELECTED. The header comment names
    // it (explaining the danger), so this checks the code, not the prose.
    expect(code.includes("raw_order"), "raw_order must never be selected in code").toBe(false);
  });

  it("the forbidden-key list covers every personal field Leafly's Order schema declares", () => {
    // Read from the vendored spec rather than a memory of it. If Leafly adds a
    // personal field and someone re-vendors the spec, this test is what notices.
    const specPath = "docs/leafly-specs/order-api-v1.openapi.json";
    expect(existsSync(resolve(ROOT, specPath))).toBe(true);
    const spec = JSON.parse(read(specPath)) as {
      components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
    };
    const orderProps = Object.keys(spec.components.schemas.Order?.properties ?? {});
    expect(orderProps.length).toBeGreaterThan(20);

    // These are the Order properties that identify a human. Named explicitly so
    // that a NEW personal field added by Leafly does not silently slip through
    // an over-clever heuristic.
    const personal = [
      "firstName",
      "lastName",
      "emailAddress",
      "phoneNumber",
      "dateOfBirth",
      "medicalCardNumber",
      "medicalCardState",
      "medicalCardExpiration",
      "deliveryAddress",
    ];
    let checked = 0;
    for (const field of personal) {
      // First: the field really is in the live spec (so this list cannot drift
      // into asserting things about fields Leafly no longer has).
      expect(orderProps, `spec must still declare ${field}`).toContain(field);
      // Second: our guard forbids it.
      expect(isForbiddenEvidenceKey(field), `${field} must be forbidden`).toBe(true);
      checked += 1;
    }
    expect(checked).toBe(personal.length);
    expect(checked).toBe(9);

    // The guard must not be vacuous — non-personal required fields stay legal.
    for (const ok of ["id", "status", "createdAt", "marketplace", "fulfillmentMechanism"]) {
      expect(orderProps).toContain(ok);
      expect(isForbiddenEvidenceKey(ok), `${ok} must remain exportable`).toBe(false);
    }
    expect(EVIDENCE_FORBIDDEN_KEYS.length).toBeGreaterThanOrEqual(18);
  });

  it("a fully populated export bundle contains no customer data", () => {
    // Build a bundle whose inputs are maximally populated, then audit every
    // column of every sheet. This is the end-to-end version of the same claim
    // the core self-tests make, run through the real builder.
    const bundle = buildEvidenceBundle({
      events: [
        {
          id: "e1",
          eventType: "order_submit",
          orderId: "ord-1",
          orderIntegrationKey: "oik",
          eventTime: "2026-09-18T10:00:00.000Z",
          receivedAt: "2026-09-18T10:00:01.000Z",
          bodySha256: "f".repeat(64),
          signatureVerified: true,
          rejectionReason: null,
          responseStatus: 200,
          processedAt: "2026-09-18T10:00:02.000Z",
        },
        {
          id: "e2",
          eventType: "order_status",
          orderId: "ord-1",
          orderIntegrationKey: "oik",
          eventTime: null,
          receivedAt: "2026-09-18T10:05:00.000Z",
          bodySha256: "a".repeat(64),
          signatureVerified: false,
          rejectionReason: "mismatch",
          responseStatus: 401,
          processedAt: null,
        },
      ],
      orders: [
        {
          leaflyOrderId: "ord-1",
          leaflyStatus: "confirmed",
          fulfillmentMechanism: "pickup",
          acknowledgeBy: "2026-09-18T10:15:00.000Z",
          acknowledgedAt: "2026-09-18T10:03:00.000Z",
          firstSeenAt: "2026-09-18T10:00:01.000Z",
        },
      ],
      nowIso: "2026-09-18T12:00:00.000Z",
    });

    expect(bundle.privacyViolations).toEqual([]);
    expect(bundle.sheets.length).toBe(4);

    let audited = 0;
    for (const sheet of bundle.sheets) {
      for (const col of sheet.columns) {
        expect(
          isForbiddenEvidenceKey(col.key),
          `exported column must be PII-free: ${sheet.name}.${col.key}`,
        ).toBe(false);
        audited += 1;
      }
    }
    // Non-vacuity: assert we actually looked at a realistic number of columns.
    expect(audited).toBeGreaterThanOrEqual(25);

    // The bundle must carry the body HASH, never a body. The hash is what
    // proves two deliveries were byte-identical without retaining the customer
    // data the body contained.
    const deliveries = bundle.sheets.find((s) => s.name === "Deliveries")!;
    expect(deliveries.columns.some((c) => c.key === "bodySha256")).toBe(true);
    for (const col of deliveries.columns) {
      const n = normalizeEvidenceKey(col.key);
      // Anything body-ish other than the hash itself would be a raw payload.
      if (n.includes("body")) expect(col.key).toBe("bodySha256");
    }

    // And prove the audit itself works, so this test cannot pass because the
    // checker returns false for everything.
    expect(auditEvidenceKeys([...deliveries.columns.map((c) => c.key), "emailAddress"])).toEqual([
      "emailAddress",
    ]);
  });

  it("migration 0225's unverified index still exists, so the panel's promise is backed", () => {
    const sql = read(MIGRATION);
    // The panel advertises all-time rejection counts. That query is what the
    // partial index serves. If the index is dropped, the count still works but
    // becomes a table scan — worth knowing about deliberately rather than
    // discovering under load.
    expect(sql).toContain("leafly_webhook_events_unverified_idx");
    expect(sql).toContain("where signature_verified = false");
    // The idempotency guarantee the export ATTESTS to must remain structural.
    expect(sql).toMatch(/body_sha256\s+text\s+not null unique/);
  });

  it("the export is registered in the pure self-test sweep with a floor", () => {
    const registry = read("scripts/compliance/run-pure-selftests.ts");
    expect(registry).toContain("__runLeaflyEvidenceTests");
    // A bare call would let the suite silently stop asserting. `assertRan`
    // enforces a minimum, which is the only version that catches a core whose
    // tests were accidentally emptied.
    expect(registry).toMatch(/assertRan\("leafly-evidence-core",\s*__runLeaflyEvidenceTests\(\),\s*\d+\)/);
  });
});
