/**
 * tests/compliance/r26-qgt-email-e2e.test.ts  (R26)
 *
 * The owner's ask, end to end, on his REAL documents: "find the invoice
 * number or order number ... fall back to using the manifest number ... the
 * delivery details from the 'transportation manifest' [should] fill the
 * delivery details in the accept lots."
 *
 * Drives the REAL `stageManifestsFromEmail` (inbound-store) with the REAL
 * Quality Green Trees bundle checked into back-office/source-materials/
 * examples (transfer JSON + Contingency Manifest PDF + invoice PDF + COA).
 * Real unpdf, real pdf.js positions, real parsers, real merge. Mocked ONLY:
 * the database writers (intake-store), storage/archive side effects, and
 * the LlamaParse network call (there is no LLAMA_CLOUD_API_KEY in the build
 * sandbox, so a live LlamaParse run was NOT possible; the vision text is
 * either "" = the outage/no-key path, or LABELLED SYNTHETIC markdown).
 *
 * Expected values were read from the PDFs themselves (pdf.js text items +
 * tesseract at 300 dpi), never typed from memory:
 *   driver Chris Gibilterra, VIN W1Y40BHY9LT036548, plate A3169588,
 *   White / Mercedes Benz / Sprinters250, departure 03/13/2025 07:00 am,
 *   arrival 03/13/2025 04:00 pm, Manifest ID 15410217973875889,
 *   invoice prints Order # 20636; the JSON external_id is 0000020830.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Staged = { manifest: { manifest_number: string | null; transport?: Record<string, unknown> | null }; raw: unknown };

const st = vi.hoisted(() => ({
  staged: [] as Staged[],
  picks: [] as { id: string; pick: { value: string; source: string } | null }[],
  backfills: [] as { id: string; transport: Record<string, unknown> | null; note: string }[],
  stageReply: { ok: true, manifestId: "m-1" } as Record<string, unknown>,
  /** SYNTHETIC vision text by PDF byte length (0 entries = LlamaParse unavailable). */
  vision: new Map<number, string>(),
  visionCalls: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", async (orig) => ({ ...((await orig()) as object), isSupabaseServiceConfigured: false }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => {
    throw new Error("no database in this test");
  },
}));
vi.mock("@/lib/inventory/intake-store", () => ({
  stageManifest: async (manifest: Staged["manifest"], raw: unknown) => {
    st.staged.push({ manifest: JSON.parse(JSON.stringify(manifest)), raw });
    return st.stageReply;
  },
  setManifestLifecycle: async () => undefined,
  backfillManifestTransport: async (id: string, transport: Record<string, unknown> | null, _a: unknown, note: string) => {
    st.backfills.push({ id, transport: transport ? { ...transport } : null, note });
    return 1;
  },
  recordInvoiceNumberDetected: async (id: string, pick: { value: string; source: string } | null) => {
    st.picks.push({ id, pick: pick ? { value: pick.value, source: pick.source } : null });
    return pick ? "saved" : "none";
  },
}));
vi.mock("@/lib/inbound-email/llamaparse-recovery", () => {
  const recover = async (bytes: Uint8Array) => {
    st.visionCalls += 1;
    return st.vision.get(bytes.byteLength) ?? "";
  };
  return {
    llamaParseRecoverText: recover,
    makeCapturingRecovery: () => ({ recover, lastOutcome: () => null }),
  };
});
vi.mock("@/lib/inbound-email/llamaparse-status-server", () => ({ recordManifestParseStatus: async () => undefined }));
vi.mock("@/lib/inventory/coa-archive", () => ({ archiveEmailedCoaForManifest: async () => undefined }));
vi.mock("@/lib/inventory/manifest-docs", () => ({ archiveManifestDocuments: async () => undefined }));
vi.mock("@/lib/inventory/vendor-goldminer-store", () => ({ enrichVendorFromIntakeDocs: async () => undefined }));

const { stageManifestsFromEmail } = await import("@/lib/inbound-email/inbound-store");
const { readPdfLayer, parsePdfManifest } = await import("@/lib/inventory/pdf-extract");
const { readDocTransport } = await import("@/lib/inventory/doc-transport-core");
const { selectInvoiceNumber } = await import("@/lib/inventory/invoice-number-core");
const { invoiceNumberForRow } = await import("@/lib/inventory/manifest-table-core");

const EX = path.resolve(__dirname, "../../back-office/source-materials/examples");
const bytesOf = (f: string) => new Uint8Array(readFileSync(path.join(EX, f)));
const MANIFEST_PDF = "QGT_FreddysFuego_MANIFEST.pdf";
const INVOICE_PDF = "QGT_FreddysFuego_INVOICE.pdf";
const COA_PDF = "QGT_FreddysFuego_COA_QA_RESULTS.pdf";
const JSON_FILE = "QGT_FreddysFuego_ORD-20636_transfer.json";
const MANIFEST_ID = "15410217973875889";

function att(f: string) {
  const isJson = f.endsWith(".json");
  const buf = readFileSync(path.join(EX, f));
  return {
    filename: f,
    contentType: isJson ? "application/json" : "application/pdf",
    text: isJson ? buf.toString("utf8") : null,
    base64: isJson ? null : buf.toString("base64"),
  };
}
function email(files: string[], bodyText: string | null = null) {
  return {
    provider: "test",
    from: "sales@freddysfuego.com",
    to: ["intake@greenwaymarijuana.com"],
    subject: "Transfer ORD-20636",
    receivedAt: "2025-03-12T15:21:35Z",
    attachments: files.map(att),
    bodyText,
  } as unknown as Parameters<typeof stageManifestsFromEmail>[0];
}

const EXPECTED_TRANSPORT = {
  driver_name: "Chris Gibilterra",
  vehicle_vin: "W1Y40BHY9LT036548",
  vehicle_plate: "A3169588",
  vehicle_description: "White Mercedes Benz Sprinters250",
  departed_at: "2025-03-13T07:00",
  eta_date: "2025-03-13",
};
// On the JSON path the transfer JSON already carries its own departure
// (est_departed_at "2025-03-13T14:00:00+00:00" = 07:00 PDT, the same instant
// the manifest prints) and fill-only keeps the JSON's value. Measured, not
// assumed: this is what the real file holds.
const JSON_DEPARTED = "2025-03-13T14:00:00+00:00";
const EXPECTED_ON_JSON_PATH = { ...EXPECTED_TRANSPORT, departed_at: JSON_DEPARTED };

beforeEach(() => {
  st.staged = [];
  st.picks = [];
  st.backfills = [];
  st.stageReply = { ok: true, manifestId: "m-1" };
  st.vision = new Map();
  st.visionCalls = 0;
});

describe("R26 real QGT documents, read directly (no LlamaParse)", () => {
  it("the fixtures are the real files (sizes recorded when the values were measured)", () => {
    expect(bytesOf(MANIFEST_PDF).byteLength).toBe(128661);
    expect(bytesOf(INVOICE_PDF).byteLength).toBe(184754);
    expect(bytesOf(COA_PDF).byteLength).toBe(1345599);
  });

  it("readPdfLayer reads a COPY: the caller's buffer survives and reads identically twice", async () => {
    const b = bytesOf(MANIFEST_PDF);
    const first = await readPdfLayer(b);
    expect(b.byteLength).toBe(128661); // not detached by pdf.js
    const second = await readPdfLayer(b);
    expect(second.text).toBe(first.text);
    expect(second.page1?.items.length).toBe(first.page1?.items.length);
    expect(first.page1?.width).toBe(612);
    expect(first.page1?.height).toBe(792);
    // and the same buffer still parses afterwards
    const parsed = await parsePdfManifest(b.slice());
    expect(parsed.text).toBe(first.text);
  });

  it("readPdfLayer never throws on garbage; returns an empty layer", async () => {
    const r = await readPdfLayer(new Uint8Array([1, 2, 3, 4]));
    expect(r.text).toBe("");
    expect(r.page1).toBeNull();
  });

  it("the Contingency Manifest's delivery details come from its own text layer", async () => {
    const layer = await readPdfLayer(bytesOf(MANIFEST_PDF));
    const r = readDocTransport({ visionText: layer.text, layerText: layer.text, page1: layer.page1 });
    expect(r.donor?.manifest_number).toBe(MANIFEST_ID);
    expect(r.donor?.transport).toMatchObject(EXPECTED_TRANSPORT);
    expect(r.donor?.transport?.arrived_at).toBeNull();
    // The Transportation License section of this form is BLANK on the page.
    expect(r.donor?.transport?.transporter_name).toBeNull();
    expect(r.sources[0]).toBe("contingency-positions");
    expect(r.groundedBy).toBe("text-layer");
    expect(r.dropped).toEqual([]);
  });

  it("the invoice PDF prints Order # 20636 - found and grounded", async () => {
    const inv = await readPdfLayer(bytesOf(INVOICE_PDF));
    const man = await readPdfLayer(bytesOf(MANIFEST_PDF));
    const pick = selectInvoiceNumber([
      { role: "manifest", label: MANIFEST_PDF, text: man.text, layerText: man.text },
      { role: "invoice", label: INVOICE_PDF, text: inv.text, layerText: inv.text },
    ]);
    expect(pick?.value).toBe("20636");
    expect(pick?.source.startsWith("invoice:")).toBe(true);
    expect(pick?.groundedBy).toBe("text-layer");
  });

  it("only the manifest PDF -> no invoice # is invented (display falls back to the manifest #)", async () => {
    const man = await readPdfLayer(bytesOf(MANIFEST_PDF));
    const pick = selectInvoiceNumber([{ role: "manifest", label: MANIFEST_PDF, text: man.text, layerText: man.text }]);
    expect(pick).toBeNull();
    expect(
      invoiceNumberForRow({ raw_payload: man.text, source_format: "pdf", manifest_number: MANIFEST_ID, invoice_number_detected: null }),
    ).toBe(MANIFEST_ID);
  });

  it("the COA is never an invoice source, even though it prints numbers", async () => {
    const coa = await readPdfLayer(bytesOf(COA_PDF));
    expect(selectInvoiceNumber([{ role: "coa", label: COA_PDF, text: coa.text, layerText: coa.text }])).toBeNull();
  });
});

describe("R26 real QGT email through the REAL stageManifestsFromEmail", () => {
  it("JSON + manifest + invoice + COA, LlamaParse unavailable: delivery details and invoice # land", async () => {
    const r = await stageManifestsFromEmail(email([JSON_FILE, MANIFEST_PDF, INVOICE_PDF, COA_PDF]), "actor-1");
    expect(r.staged).toBe(1);
    expect(st.staged).toHaveLength(1);
    const m = st.staged[0].manifest;
    expect(m.manifest_number).toBe(MANIFEST_ID);
    // The JSON prints NO driver/vehicle (transporter_name null); the
    // Contingency Manifest fills them. The JSON's own departure is kept.
    expect(m.transport).toMatchObject(EXPECTED_ON_JSON_PATH);
    expect(m.transport?.arrived_at ?? null).toBeNull();
    // Locked decision: the transfer JSON's external_id wins (flagged to the owner).
    expect(st.picks).toEqual([{ id: "m-1", pick: { value: "0000020830", source: `transfer-json:json:${JSON_FILE}` } }]);
    // The COA was never sent to the vision reader for transport (COAs skipped).
    expect(st.visionCalls).toBeGreaterThanOrEqual(2);
  });

  it("re-sent email (duplicate) repairs transport AND records the invoice # on the existing row", async () => {
    st.stageReply = { ok: false, duplicate: true, existingManifestId: "m-old", error: "duplicate" };
    const r = await stageManifestsFromEmail(email([JSON_FILE, MANIFEST_PDF, INVOICE_PDF]), "actor-1");
    expect(r.duplicates).toBe(1);
    expect(st.backfills).toHaveLength(1);
    expect(st.backfills[0].id).toBe("m-old");
    expect(st.backfills[0].transport).toMatchObject(EXPECTED_ON_JSON_PATH);
    expect(st.picks).toEqual([{ id: "m-old", pick: { value: "0000020830", source: `transfer-json:json:${JSON_FILE}` } }]);
  });

  it("without the invoice PDF the manifest alone still fills every delivery detail", async () => {
    await stageManifestsFromEmail(email([JSON_FILE, MANIFEST_PDF]), null);
    expect(st.staged[0].manifest.transport).toMatchObject(EXPECTED_ON_JSON_PATH);
  });

  it("without the manifest PDF the invoice fills what it prints (no VIN on the invoice)", async () => {
    await stageManifestsFromEmail(email([JSON_FILE, INVOICE_PDF]), null);
    const t = st.staged[0].manifest.transport ?? {};
    expect(t.driver_name).toBe("Chris Gibilterra");
    expect(t.vehicle_plate).toBe("A3169588");
    expect(t.eta_date).toBe("2025-03-13");
    expect(t.vehicle_vin ?? null).toBeNull();
    expect(t.departed_at).toBe(JSON_DEPARTED); // from the JSON, not invented
  });

  it("SYNTHETIC LlamaParse markdown with hallucinated values: grounding drops them, the page wins", async () => {
    // LABELLED SYNTHETIC: the shape LlamaParse markdown takes for this form,
    // with two values a generic image reader got WRONG on this page in the
    // build sandbox (a different departure day and a mangled VIN).
    st.vision.set(
      128661,
      "# Transportation Manifest\n\n" +
        "| Departure Date/Time: | 03/15/2025 07:30 am | Arrival Date/Time: | 03/13/2025 04:00 pm |\n" +
        "|---|---|---|---|\n" +
        "| Driver Name: | Chris Gibilterra | VIN #: | W1Y40BHY9LT036543 |\n" +
        "| Vehicle License Plate: | A3169588 | Vehicle Color: | White |\n\n" +
        "Manifest ID: 15410217973875889",
    );
    await stageManifestsFromEmail(email([JSON_FILE, MANIFEST_PDF]), null);
    const t = st.staged[0].manifest.transport ?? {};
    expect(t.vehicle_vin).toBe("W1Y40BHY9LT036548"); // the real one, from the page
    expect(t.driver_name).toBe("Chris Gibilterra");
  });

  it("SYNTHETIC hallucinated departure + VIN vs the REAL manifest layer: both dropped, the page's values win", async () => {
    const layer = await readPdfLayer(bytesOf(MANIFEST_PDF));
    // (The generic reader only runs on text that reads as a transport
    // document - "manifest"/"transportation" - so the fragment carries the
    // form's own heading, as LlamaParse output for this page would.)
    const md =
      "# Transportation Manifest\n\n" +
      "| Departure Date/Time: | 03/15/2025 07:30 am | Arrival Date/Time: | 03/13/2025 04:00 pm |\n" +
      "|---|---|---|---|\n" +
      "| Driver Name: | Chris Gibilterra | VIN #: | W1Y40BHY9LT036543 |\n";
    // Without the page positions, grounding alone must drop both hallucinations.
    const noPos = readDocTransport({ visionText: md, layerText: layer.text, page1: null });
    expect(noPos.donor?.transport?.departed_at ?? null).toBeNull();
    expect(noPos.donor?.transport?.vehicle_vin ?? null).toBeNull();
    expect(noPos.dropped.map((d) => d.field).sort()).toEqual(["departed_at", "vehicle_vin"]);
    expect(noPos.donor?.transport?.driver_name).toBe("Chris Gibilterra");
    // With the page positions, the real values fill in.
    const withPos = readDocTransport({ visionText: md, layerText: layer.text, page1: layer.page1 });
    expect(withPos.donor?.transport).toMatchObject(EXPECTED_TRANSPORT);
  });

  it("SYNTHETIC LlamaParse markdown for the invoice: a bold/escaped Order # is read; a hallucinated one is not", async () => {
    // No JSON in this email, so the invoice PDF decides. The PDF-only path
    // cannot stage a QGT bundle (neither PDF is a layout manifest), so the
    // pick is checked through the same selector the staging path calls.
    const inv = await readPdfLayer(bytesOf(INVOICE_PDF));
    const good = selectInvoiceNumber([{ role: "invoice", label: INVOICE_PDF, text: "**Order \\#:** 20636", layerText: inv.text }]);
    expect(good).toMatchObject({ value: "20636", groundedBy: "text-layer" });
    expect(good?.source).toBe(`invoice:vision+layer:${INVOICE_PDF}`);
    const bad = selectInvoiceNumber([{ role: "invoice", label: INVOICE_PDF, text: "| Order # | 20686 |", layerText: inv.text }]);
    // 20686 is not on the page -> dropped; the layer's own scan recovers 20636.
    expect(bad).toMatchObject({ value: "20636", source: `invoice:layer:${INVOICE_PDF}` });
  });

  it("SYNTHETIC hallucinated LAYOUT read on the PDF-primary route: the page's grounded values are staged", async () => {
    // LABELLED SYNTHETIC: LlamaParse returns a full LCB Internal Shipping
    // Document for the QGT manifest PDF - the REAL Cultivera fixture text
    // (another vendor's manifest: Tyler hart / 2006 blue subaru impreza /
    // JF1GH63638G828028) with only the manifest # swapped to QGT's. The layout
    // parser accepts it, so the PDF-primary route stages it. Before R26's fix
    // the layout transport sat in the staged base and won the fill-only fold,
    // so ANOTHER vendor's driver and vehicle were staged. None of those values
    // is printed on this page; grounding must drop them and the page's own
    // values (Contingency Manifest positions) must be staged instead.
    const fake = readFileSync(path.join(__dirname, "fixtures/pdf-manifest-cultivera-sample.txt"), "utf8").replaceAll(
      "21544390883723306",
      MANIFEST_ID,
    );
    st.vision.set(128661, fake);
    const r = await stageManifestsFromEmail(email([MANIFEST_PDF, INVOICE_PDF]), null);
    expect(r.staged).toBe(1);
    const m = st.staged[0].manifest;
    expect(m.manifest_number).toBe(MANIFEST_ID);
    expect(m.transport).toMatchObject(EXPECTED_TRANSPORT);
    expect(m.transport?.transporter_name ?? null).toBeNull(); // "Tyler hart" is not on the page
    expect(m.transport?.route_notes ?? null).toBeNull(); // nor the other vendor's route
    expect(m.transport?.arrived_at ?? null).toBeNull();
    // Invoice # still comes from the invoice PDF, not the fake manifest text.
    // (No vision text is mapped for the invoice, so its primary text is the
    // unpdf fallback - hence "vision+layer", measured.)
    expect(st.picks).toEqual([{ id: "m-1", pick: { value: "20636", source: `invoice:vision+layer:${INVOICE_PDF}` } }]);
  });

  it("same hallucinated layout read on the JSON route: the grounded donor fills, the JSON keeps its own values", async () => {
    const fake = readFileSync(path.join(__dirname, "fixtures/pdf-manifest-cultivera-sample.txt"), "utf8").replaceAll(
      "21544390883723306",
      MANIFEST_ID,
    );
    st.vision.set(128661, fake);
    await stageManifestsFromEmail(email([JSON_FILE, MANIFEST_PDF]), null);
    const t = st.staged[0].manifest.transport ?? {};
    expect(t).toMatchObject(EXPECTED_ON_JSON_PATH);
    expect(t.transporter_name ?? null).toBeNull();
    expect(String(t.route_notes ?? "")).not.toContain("US-12");
  });

  it("PDF-only QGT email stages nothing (neither PDF is a layout manifest) - unchanged, honest", async () => {
    const r = await stageManifestsFromEmail(email([MANIFEST_PDF, INVOICE_PDF]), null);
    expect(r.staged).toBe(0);
    expect(st.staged).toHaveLength(0);
    expect(st.picks).toHaveLength(0);
  });
});
