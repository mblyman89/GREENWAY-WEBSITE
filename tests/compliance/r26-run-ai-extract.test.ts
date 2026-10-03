/**
 * tests/compliance/r26-run-ai-extract.test.ts  (R26)
 *
 * "Run AI extract" on one manifest re-reads its ARCHIVED documents. Before
 * R26 it stopped at the first PDF that parsed, never read the invoice for
 * transport, and found the invoice # only to put it in the redirect URL.
 *
 * Drives the REAL reExtractManifestAiAction with the REAL QGT archive
 * (Contingency Manifest + invoice + COA + transfer JSON). Real unpdf, real
 * pdf.js positions, real readers, real merge. Mocked: session, the manifest
 * row lookup, the archive download (returns the real bytes), the store
 * writers, and the LlamaParse network call (no API key in the build sandbox:
 * vision returns "" = the outage path, the owner's real failure mode).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  calls: [] as string[],
  manifest: null as null | { id: string; manifest_number: string | null },
  docs: [] as { role: string; filename: string; contentType: string | null; bytes: Uint8Array }[],
  backfills: [] as { id: string; transport: Record<string, unknown>; note: string }[],
  picks: [] as { id: string; pick: { value: string; source: string } }[],
  statuses: [] as unknown[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", async (orig) => ({ ...((await orig()) as object), isSupabaseServiceConfigured: false }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => st.calls.push(`revalidate:${p}`) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    st.calls.push(`redirect:${url}`);
    const e = new Error("NEXT_REDIRECT") as Error & { digest: string };
    e.digest = `NEXT_REDIRECT;${url}`;
    throw e;
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async (p: string) => {
    st.calls.push(`perm:${p}`);
    return { userId: "u-owner", email: "o@x", profile: { role: "owner" } };
  },
}));
vi.mock("@/lib/inventory/store", () => ({ getManifestById: async () => st.manifest }));
vi.mock("@/lib/inventory/manifest-docs", () => ({ downloadManifestDocs: async () => st.docs }));
vi.mock("@/lib/inventory/intake-store", () => ({
  stageManifest: vi.fn(),
  rejectManifest: vi.fn(),
  setLotDisposition: vi.fn(),
  finalizeManifestDispositions: vi.fn(),
  gatherSampleCapNotice: vi.fn(),
  logManifestEvent: vi.fn(),
  setManifestInvoiceOverride: vi.fn(),
  backfillManifestTransport: async (id: string, transport: Record<string, unknown>, _a: unknown, note: string) => {
    st.backfills.push({ id, transport: { ...transport }, note });
    return 6;
  },
  recordInvoiceNumberDetected: async (id: string, pick: { value: string; source: string }) => {
    st.picks.push({ id, pick: { value: pick.value, source: pick.source } });
    return "saved";
  },
}));
vi.mock("@/lib/inbound-email/llamaparse-recovery", () => {
  const recover = async () => "";
  return { llamaParseRecoverText: recover, makeCapturingRecovery: () => ({ recover, lastOutcome: () => null }) };
});
vi.mock("@/lib/inbound-email/llamaparse-status-server", () => ({
  recordManifestParseStatus: async (...args: unknown[]) => void st.statuses.push(args),
}));
vi.mock("@/lib/compliance/sample-cap-notify", () => ({ sendSampleCapVendorNotice: vi.fn() }));
vi.mock("@/lib/inventory/transfer-fetch", () => ({ fetchTransferJson: vi.fn() }));

const { reExtractManifestAiAction } = await import("@/app/admin/inventory/intake/actions");

const EX = path.resolve(__dirname, "../../back-office/source-materials/examples");
const doc = (role: string, filename: string, contentType: string) => ({
  role,
  filename,
  contentType,
  bytes: new Uint8Array(readFileSync(path.join(EX, filename))),
});
const MANIFEST = doc("manifest", "QGT_FreddysFuego_MANIFEST.pdf", "application/pdf");
const INVOICE = doc("invoice", "QGT_FreddysFuego_INVOICE.pdf", "application/pdf");
const COA = doc("coa", "QGT_FreddysFuego_COA_QA_RESULTS.pdf", "application/pdf");
const JSON_DOC = doc("transfer-json", "QGT_FreddysFuego_ORD-20636_transfer.json", "application/json");
const MID = "00000000-0000-4000-8000-0000000000e1";

async function run(): Promise<string> {
  try {
    await reExtractManifestAiAction(MID);
  } catch (e) {
    const d = (e as { digest?: string }).digest ?? "";
    if (d.startsWith("NEXT_REDIRECT;")) return d.slice("NEXT_REDIRECT;".length);
    throw e;
  }
  throw new Error("expected a redirect");
}

beforeEach(() => {
  st.calls = [];
  st.manifest = { id: MID, manifest_number: "15410217973875889" };
  st.docs = [];
  st.backfills = [];
  st.picks = [];
  st.statuses = [];
});

describe("R26 Run AI extract on the real QGT archive", () => {
  it("manifest + invoice + COA: every delivery detail backfilled, Order # 20636 saved", async () => {
    st.docs = [INVOICE, COA, MANIFEST]; // archive order is not trusted
    const url = await run();
    expect(st.calls[0]).toBe("perm:inventory.manage");
    expect(st.backfills).toHaveLength(1);
    expect(st.backfills[0].id).toBe(MID);
    expect(st.backfills[0].transport).toMatchObject({
      driver_name: "Chris Gibilterra",
      vehicle_vin: "W1Y40BHY9LT036548",
      vehicle_plate: "A3169588",
      vehicle_description: "White Mercedes Benz Sprinters250",
      departed_at: "2025-03-13T07:00",
      eta_date: "2025-03-13",
      arrived_at: null,
    });
    expect(st.backfills[0].note).toBe("Run AI extract (2 documents, text-layer grounded)");
    expect(st.picks).toEqual([
      { id: MID, pick: { value: "20636", source: "invoice:vision+layer:QGT_FreddysFuego_INVOICE.pdf" } },
    ]);
    const q = new URL(url, "http://x").searchParams;
    expect(q.get("inv")).toBe("20636");
    expect(q.get("filled")).toBe("6");
    expect(st.calls).toContain("revalidate:/admin/inventory/intake");
    expect(st.calls).toContain(`revalidate:/admin/inventory/intake/${MID}`);
  });

  it("with the archived transfer JSON the locked JSON precedence holds (external_id)", async () => {
    st.docs = [MANIFEST, INVOICE, JSON_DOC];
    const url = await run();
    expect(st.picks[0].pick).toEqual({ value: "0000020830", source: "transfer-json:json:QGT_FreddysFuego_ORD-20636_transfer.json" });
    expect(new URL(url, "http://x").searchParams.get("inv")).toBe("0000020830");
  });

  it("manifest PDF only: transport fills, NO invoice # is saved, banner falls back to the manifest #", async () => {
    st.docs = [MANIFEST];
    const url = await run();
    expect(st.backfills[0].transport).toMatchObject({ vehicle_vin: "W1Y40BHY9LT036548" });
    expect(st.backfills[0].note).toBe("Run AI extract (1 document, text-layer grounded)");
    expect(st.picks).toEqual([]);
    expect(new URL(url, "http://x").searchParams.get("inv")).toBe("15410217973875889");
  });

  it("a different manifest's documents never fill this row (number must match)", async () => {
    st.manifest = { id: MID, manifest_number: "99999999999999999" };
    st.docs = [MANIFEST];
    await run();
    // mergeMatchingDonors falls back to chooseTransportDonor: a single donor
    // with a DIFFERENT non-null number is refused.
    expect(st.backfills).toEqual([]);
  });

  it("COA only: nothing read, nothing saved", async () => {
    st.docs = [COA];
    await run();
    expect(st.backfills).toEqual([]);
    expect(st.picks).toEqual([]);
  });

  it("no PDFs on file: honest status + nodocs redirect", async () => {
    st.docs = [JSON_DOC];
    const url = await run();
    expect(url).toBe(`/admin/inventory/intake/${MID}?ai=nodocs`);
    expect(st.picks).toEqual([]);
  });
});
