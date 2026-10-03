/**
 * tests/compliance/r26-invoice-number-store.test.ts  (R26)
 *
 * The invoice/order # the documents print must be SAVED (migration 0245),
 * and shown in the Invoice # column, falling back to the manifest number.
 *
 *  A. intake-store.recordInvoiceNumberDetected against FakePostgrest (real
 *     postgrest-js wire): saved / unchanged / re-read / none / missing column
 *     (42703 and PGRST204) / missing row / a write error. Never throws.
 *  B. manifest-table-core.invoiceNumberForRow precedence:
 *     override > detected > payload re-scan > manifest number.
 *  C. The timeline label for the new event.
 */
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
    createSupabaseAdminClient: () =>
      new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: st.db.fetch as typeof fetch }),
  };
});
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async () => undefined }));

const { recordInvoiceNumberDetected } = await import("@/lib/inventory/intake-store");
const { invoiceNumberForRow } = await import("@/lib/inventory/manifest-table-core");
const { labelForEvent, isKnownEventType } = await import("@/lib/inventory/manifest-event-labels-core");

const M = "00000000-0000-4000-8000-0000000000e1";
const ACTOR = "00000000-0000-4000-8000-0000000000ac";
const PICK = { value: "20636", source: "invoice:vision+layer:QGT_FreddysFuego_INVOICE.pdf" };

function seed(over: Row = {}) {
  st.db = new FakePostgrest();
  st.db.rows("inbound_manifests").push({
    id: M,
    manifest_number: "15410217973875889",
    invoice_number_detected: null,
    invoice_number_source: null,
    updated_by: null,
    ...over,
  });
}
const row = () => st.db.rows("inbound_manifests")[0];
const events = () => st.db.rows("manifest_events");
const patches = () => st.db.log.filter((r) => r.method === "PATCH" && r.table === "inbound_manifests");

beforeEach(() => seed());

describe("A. recordInvoiceNumberDetected (FakePostgrest)", () => {
  it("saves the value + provenance + actor and logs ONE timeline event", async () => {
    expect(await recordInvoiceNumberDetected(M, PICK, ACTOR)).toBe("saved");
    expect(row().invoice_number_detected).toBe("20636");
    expect(row().invoice_number_source).toBe(PICK.source);
    expect(row().updated_by).toBe(ACTOR);
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ manifest_id: M, event_type: "invoice_number_detected", actor_id: ACTOR });
    expect(String(events()[0].note)).toBe(`Invoice/Order # found in the documents: "20636" (source ${PICK.source}).`);
    // scoped to ONE manifest: the PATCH carried id=eq.<M>
    expect(patches()).toHaveLength(1);
    expect(patches()[0].url.searchParams.get("id")).toBe(`eq.${M}`);
  });

  it("the same value again is 'unchanged': no write, no event (idempotent)", async () => {
    seed({ invoice_number_detected: "20636" });
    expect(await recordInvoiceNumberDetected(M, PICK, ACTOR)).toBe("unchanged");
    expect(patches()).toHaveLength(0);
    expect(events()).toHaveLength(0);
  });

  it("whitespace around the value is trimmed before comparing and saving", async () => {
    seed({ invoice_number_detected: "20636" });
    expect(await recordInvoiceNumberDetected(M, { value: "  20636 ", source: "x" }, ACTOR)).toBe("unchanged");
    seed();
    expect(await recordInvoiceNumberDetected(M, { value: " 20636\n", source: "x" }, ACTOR)).toBe("saved");
    expect(row().invoice_number_detected).toBe("20636");
  });

  it("a different value is re-read: saved, and the event names the old value", async () => {
    seed({ invoice_number_detected: "0000020830" });
    expect(await recordInvoiceNumberDetected(M, PICK, null)).toBe("saved");
    expect(row().invoice_number_detected).toBe("20636");
    expect(String(events()[0].note)).toContain('(was "0000020830"');
  });

  it("no pick / blank value -> 'none' and the database is never touched", async () => {
    expect(await recordInvoiceNumberDetected(M, null, ACTOR)).toBe("none");
    expect(await recordInvoiceNumberDetected(M, { value: "   ", source: "x" }, ACTOR)).toBe("none");
    expect(st.db.log).toHaveLength(0);
  });

  it("migration 0245 not applied (42703 on read) -> 'missing-column', no throw, no write", async () => {
    st.db.before = (req) =>
      req.method === "GET"
        ? { status: 400, body: { code: "42703", details: null, hint: null, message: "column inbound_manifests.invoice_number_detected does not exist" } }
        : undefined;
    expect(await recordInvoiceNumberDetected(M, PICK, ACTOR)).toBe("missing-column");
    expect(patches()).toHaveLength(0);
    expect(events()).toHaveLength(0);
  });

  it("schema cache without the column (PGRST204 on write) -> 'missing-column', no event", async () => {
    st.db.before = (req) =>
      req.method === "PATCH"
        ? { status: 400, body: { code: "PGRST204", details: null, hint: null, message: "Could not find the 'invoice_number_detected' column" } }
        : undefined;
    expect(await recordInvoiceNumberDetected(M, PICK, ACTOR)).toBe("missing-column");
    expect(events()).toHaveLength(0);
  });

  it("any other write error -> 'error', no event", async () => {
    st.db.before = (req) =>
      req.method === "PATCH" ? { status: 500, body: { code: "XX000", details: null, hint: null, message: "boom" } } : undefined;
    expect(await recordInvoiceNumberDetected(M, PICK, ACTOR)).toBe("error");
    expect(events()).toHaveLength(0);
  });

  it("an unknown manifest id -> 'error' (nothing to update), no event", async () => {
    expect(await recordInvoiceNumberDetected("00000000-0000-4000-8000-0000000000ff", PICK, ACTOR)).toBe("error");
    expect(patches()).toHaveLength(0);
    expect(events()).toHaveLength(0);
    expect(row().invoice_number_detected).toBeNull();
  });
});

describe("B. invoiceNumberForRow precedence (what the Invoice # column shows)", () => {
  const base = { raw_payload: "Order #: 555", source_format: "pdf", manifest_number: "15410217973875889" };
  it("override wins over everything", () => {
    expect(invoiceNumberForRow({ ...base, invoice_number_override: "OWNER-1", invoice_number_detected: "20636" })).toBe("OWNER-1");
  });
  it("detected wins over the payload re-scan and the manifest #", () => {
    expect(invoiceNumberForRow({ ...base, invoice_number_detected: "20636" })).toBe("20636");
  });
  it("blank detected / blank override are ignored", () => {
    expect(invoiceNumberForRow({ ...base, invoice_number_override: "  ", invoice_number_detected: " " })).toBe("555");
  });
  it("no detected (pre-0245 row) -> payload re-scan, unchanged behaviour", () => {
    expect(invoiceNumberForRow(base)).toBe("555");
  });
  it("nothing printed anywhere -> the manifest number (the owner's fallback)", () => {
    expect(invoiceNumberForRow({ ...base, raw_payload: "no number here" })).toBe("15410217973875889");
  });
  it("a LlamaParse markdown payload is now read (R26 normalizer)", () => {
    expect(invoiceNumberForRow({ ...base, raw_payload: "| **Order \\#** | 20636 |" })).toBe("20636");
  });
});

describe("C. timeline label", () => {
  it("invoice_number_detected is a known, non-problem delivery event", () => {
    expect(isKnownEventType("invoice_number_detected")).toBe(true);
    expect(labelForEvent("invoice_number_detected")).toEqual({
      label: "Invoice # found in the documents",
      group: "delivery",
      problem: false,
    });
  });
});
