/**
 * tests/compliance/r31-manifest-review-walk.test.tsx — R31 (manifest review:
 * walk the page, ONE Finalize button).
 *
 * The owner: "every other button, including clicking the accept button for
 * all line items should be clicked and processed by the finalize manifest
 * button ... all the available buttons that don't need to be pushed should
 * disappear." These tests prove, against the REAL action with its I/O mocked:
 *
 *   1. Finalize marks a pending / in-transit delivery received BEFORE the line
 *      decisions (so received_at and the "received" timeline event are real),
 *      and never re-stamps one already received.
 *   2. Finalize posts the goods receipt AFTER the decisions and BEFORE the
 *      vendor bill (so the bill finds it and credits GRNI, D-61); skips it when
 *      nothing was accepted or the ledger already holds one.
 *   3. A receipt refusal reaches the URL (never swallowed); a bill refusal wins
 *      the single banner slot.
 *   4. The page no longer carries Mark received / Mark in transit / Archive
 *      COAs / per-line Accept / always-on Promote-to-KB / the strain-name KB
 *      matcher, and keeps the controls the owner asked to keep.
 *   5. The receipt never capitalises dock-refused lots (same set as the bill).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const PAGE = "src/app/admin/inventory/intake/[id]/page.tsx";
const ACTIONS = "src/app/admin/inventory/intake/actions.ts";
const DISPO = "src/components/admin/inventory/ManifestLotDisposition.tsx";

const st = vi.hoisted(() => ({
  order: [] as string[],
  calls: [] as string[],
  events: [] as Array<{ type: string; note: string | null }>,
  status: "pending" as string,
  lifecycleOk: true,
  finalize: null as null | Record<string, unknown>,
  evidence: "absent" as "absent" | "raised" | "unknown",
  receipt: { ok: true, code: "RECEIPT_OK", message: "posted" } as { ok: boolean; code: string; message: string } | "throw",
  bill: { ok: true, code: "BILL_OK", message: "billed" } as { ok: boolean; code: string; message: string },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
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
  requirePermission: async () => ({ userId: "u-1", email: "o@x", profile: { role: "owner" } }),
}));
vi.mock("@/lib/inventory/store", () => ({
  getManifestById: async (id: string) => ({ id, status: st.status, manifest_number: "MN-1" }),
}));
vi.mock("@/lib/inventory/intake-store", () => ({
  setManifestLifecycle: async (_id: string, status: string) => {
    st.order.push(`lifecycle:${status}`);
    return st.lifecycleOk ? { ok: true } : { ok: false, error: "db down" };
  },
  logManifestEvent: async (_id: string, type: string, note: string | null) => {
    st.events.push({ type, note });
  },
  finalizeManifestDispositions: async () => {
    st.order.push("decisions");
    return st.finalize;
  },
  stageManifest: vi.fn(),
  rejectManifest: vi.fn(),
  setLotDisposition: vi.fn(),
  gatherSampleCapNotice: vi.fn(),
  setManifestInvoiceOverride: vi.fn(),
}));
vi.mock("@/lib/accounting/receipt-evidence", () => ({
  findReceiptJournal: async () => {
    st.order.push("evidence");
    return st.evidence === "raised"
      ? { kind: "raised", sourceRef: "r", journalId: "j", status: "draft" }
      : st.evidence === "unknown"
        ? { kind: "unknown", sourceRef: "r", reason: "x" }
        : { kind: "absent", sourceRef: "r" };
  },
}));
vi.mock("@/lib/accounting/receipt-service", () => ({
  postManifestReceipt: async () => {
    st.order.push("receipt");
    if (st.receipt === "throw") throw new Error("socket hang up");
    return st.receipt;
  },
}));
vi.mock("@/lib/accounting/vendor-bill-service", () => ({
  postManifestVendorBill: async () => {
    st.order.push("bill");
    return st.bill;
  },
}));
vi.mock("@/lib/reports/timezone", () => ({ pacificParts: () => ({ year: 2026, month: 3, day: 7 }) }));
vi.mock("@/lib/compliance/sample-cap-notify", () => ({ sendSampleCapVendorNotice: vi.fn() }));
vi.mock("@/lib/inventory/transfer-fetch", () => ({ fetchTransferJson: vi.fn() }));
vi.mock("@/lib/inventory/pdf-extract", () => ({ parsePdfManifest: vi.fn() }));
vi.mock("@/lib/inbound-email/llamaparse-recovery", () => ({ makeCapturingRecovery: vi.fn() }));
vi.mock("@/lib/inbound-email/llamaparse-status-server", () => ({ recordManifestParseStatus: vi.fn() }));

const ok = (o: Partial<{ activated: number; rejected: number; blocked: unknown[]; derivedStatus: string }> = {}) => ({
  ok: true,
  derivedStatus: "accepted",
  activated: 3,
  rejected: 0,
  draftsCreated: 0,
  blocked: [],
  ...o,
});

async function finalize(): Promise<string> {
  const { finalizeManifestAction } = await import("@/app/admin/inventory/intake/actions");
  await expect(finalizeManifestAction("m-1", new FormData())).rejects.toThrow("NEXT_REDIRECT");
  return st.calls.filter((c) => c.startsWith("redirect:")).at(-1) ?? "";
}

beforeEach(() => {
  st.order = [];
  st.calls = [];
  st.events = [];
  st.status = "pending";
  st.lifecycleOk = true;
  st.finalize = ok();
  st.evidence = "absent";
  st.receipt = { ok: true, code: "RECEIPT_OK", message: "posted" };
  st.bill = { ok: true, code: "BILL_OK", message: "billed" };
});

describe("0. The R31 pure cores: embedded self-tests, exact counts", () => {
  it("finalize-label-core 29/0, ai-extract-advice-core 26/0, line-identity-chip-core 22/0", async () => {
    const f = await import("@/lib/inventory/finalize-label-core");
    const a = await import("@/lib/inventory/ai-extract-advice-core");
    const l = await import("@/lib/inventory/line-identity-chip-core");
    expect(f.__runFinalizeLabelCoreTests()).toEqual({ passed: 29, failed: 0 });
    expect(a.__runAiExtractAdviceCoreTests()).toEqual({ passed: 26, failed: 0 });
    expect(l.__runLineIdentityChipCoreTests()).toEqual({ passed: 22, failed: 0 });
  });
  it("intake-checklist-core self-tests pass (throws on failure)", async () => {
    const c = await import("@/lib/inventory/intake-checklist-core");
    expect(() => c.__runIntakeChecklistCoreTests()).not.toThrow();
  });
  it("labels the owner asked for, verbatim shape", async () => {
    const { planFinalize } = await import("@/lib/inventory/finalize-label-core");
    const g = { ccrsExternalId: "X", hasLabResult: true, labPassed: true };
    expect(planFinalize([{ id: "1", disposition: null, gate: g }, { id: "2", disposition: null, gate: g }]).label).toBe("Accept All & Finalize");
    expect(
      planFinalize([
        { id: "1", disposition: null, gate: g },
        { id: "2", disposition: "rejected_at_dock", gate: g },
        { id: "3", disposition: "accepted", gate: g },
      ]).label,
    ).toBe("Accept 2 \u00b7 Reject 1 & Finalize");
  });
  it("only pending / in_transit are stamped received by finalize", async () => {
    const { shouldMarkArrivedOnFinalize } = await import("@/lib/inventory/finalize-label-core");
    expect(["pending", "in_transit", "received", "accepted", "rejected", "partially_accepted", null].map((s) => shouldMarkArrivedOnFinalize(s))).toEqual([
      true, true, false, false, false, false, false,
    ]);
  });
});

describe("1. Finalize does the 'Mark received' the owner used to click", () => {
  it("a pending delivery is stamped received BEFORE the line decisions run", async () => {
    await finalize();
    expect(st.order.indexOf("lifecycle:received")).toBeGreaterThanOrEqual(0);
    expect(st.order.indexOf("lifecycle:received")).toBeLessThan(st.order.indexOf("decisions"));
  });
  it("an in-transit delivery is stamped too", async () => {
    st.status = "in_transit";
    await finalize();
    expect(st.order).toContain("lifecycle:received");
  });
  it("an already-received delivery keeps its original received_at (no second stamp)", async () => {
    st.status = "received";
    await finalize();
    expect(st.order.filter((o) => o.startsWith("lifecycle:"))).toEqual([]);
  });
  it("a failed stamp never costs the finalize; it is written on the timeline", async () => {
    st.lifecycleOk = false;
    const url = await finalize();
    expect(url).toContain("finalized=accepted");
    expect(st.events.some((e) => e.type === "note" && /could not stamp the delivery received: db down/.test(e.note ?? ""))).toBe(true);
  });
});

describe("2. Finalize records the goods receipt in the right order", () => {
  it("decisions -> receipt -> vendor bill (the bill then sees the receipt, D-61)", async () => {
    await finalize();
    const d = st.order.indexOf("decisions");
    const r = st.order.indexOf("receipt");
    const b = st.order.indexOf("bill");
    expect(d).toBeGreaterThanOrEqual(0);
    expect(r).toBeGreaterThan(d);
    expect(b).toBeGreaterThan(r);
  });
  it("the receipt outcome is written to the durable timeline", async () => {
    await finalize();
    expect(st.events.map((e) => e.type)).toContain("receipt_posted");
  });
  it("skipped when the ledger ALREADY holds this manifest's receipt (no conflicting re-post)", async () => {
    st.status = "received";
    st.evidence = "raised";
    await finalize();
    expect(st.order).toContain("evidence");
    expect(st.order).not.toContain("receipt");
    expect(st.order).toContain("bill");
  });
  it("skipped when nothing was accepted (nothing arrived to capitalise)", async () => {
    st.finalize = ok({ activated: 0, rejected: 3, derivedStatus: "rejected" });
    await finalize();
    expect(st.order).not.toContain("evidence");
    expect(st.order).not.toContain("receipt");
  });
  it("held lots still count as received goods (they physically arrived)", async () => {
    st.finalize = ok({ activated: 0, blocked: [{ id: "l1" }], derivedStatus: "partially_accepted" });
    await finalize();
    expect(st.order).toContain("receipt");
  });
});

describe("3. Refusals are surfaced, never swallowed", () => {
  it("a receipt refusal reaches the URL when the bill is fine", async () => {
    st.receipt = { ok: false, code: "RECEIPT_REFUSED", message: "no cost on lot X" };
    const url = await finalize();
    expect(url).toContain(`booksError=${encodeURIComponent("no cost on lot X")}`);
  });
  it("a thrown receipt is caught, logged, and surfaced", async () => {
    st.receipt = "throw";
    const url = await finalize();
    expect(url).toContain("booksError=");
    expect(url).toContain("finalized=accepted");
    expect(decodeURIComponent(url)).toContain("socket hang up");
  });
  it("a bill refusal wins the single banner slot", async () => {
    st.receipt = { ok: false, code: "RECEIPT_REFUSED", message: "receipt reason" };
    st.bill = { ok: false, code: "BILL_REFUSED", message: "bill reason" };
    const url = await finalize();
    expect(url).toContain(`booksError=${encodeURIComponent("bill reason")}`);
    expect(url).not.toContain(encodeURIComponent("receipt reason"));
  });
  it("a clean finalize carries the bill code, not an error", async () => {
    const url = await finalize();
    expect(url).toContain("books=BILL_OK");
    expect(url).not.toContain("booksError");
  });
});

describe("4. The page: buttons that don't need pushing are gone", () => {
  const page = read(PAGE);
  it("no Mark in transit / Mark received buttons", () => {
    // Comments may still NAME the old action (the ?lifecycle= banner serves old
    // links); what must be gone is any binding, import or button text.
    expect(page).not.toMatch(/setManifestLifecycleAction\.bind|setManifestLifecycleAction,|markReceivedAction|markInTransitAction/);
    expect(page).not.toMatch(/📦 Mark received|🚚 Mark in transit/);
  });
  it("no Archive COAs button (finalize archives)", () => {
    expect(page).not.toMatch(/archiveCoasAction|Archive COAs to records/);
  });
  it("Promote to KB is retry-only: rendered behind kbRetryNeeded, never always-on", () => {
    expect(page).not.toContain("Promote to KB drafts");
    expect(page).toContain("{kbRetryNeeded && (");
    expect(page).toMatch(/const kbRetryNeeded = checklist\.items\.find\(\(it\) => it\.id === "promote_kb"\)\?\.state === "todo";/);
  });
  it("the strain-name KB matcher is gone; identity chips replace it", () => {
    expect(page).not.toMatch(/matchIntakeLinesToKb|kbMatchByLotId|No KB match/);
    expect(page).toContain("loadLineIdentityChips(");
    expect(page).toContain("data-line-identity={chip.kind}");
  });
  it("the five StatCards became one summary line", () => {
    expect(page).not.toContain("StatCard");
    expect(page).toContain('data-testid="manifest-walk-summary"');
  });
  it("the Finalize button names what it will do (planFinalize)", () => {
    expect(page).toContain("✓ {finalizePlan.label}");
    expect(page).not.toContain("Finalize intake\n");
    expect(page).toContain("status={finalizePlan.status}");
    expect(page).toContain("const hasRefusedLine = finalizePlan.noteRequired;");
  });
  it("the planner gets the SAME gate facts the server finalize uses", () => {
    const i = page.indexOf("const finalizePlan = planFinalize(");
    const slice = page.slice(i, i + 600);
    expect(slice).toContain("ccrsExternalId: l.ccrs_inventory_external_id");
    expect(slice).toContain("hasLabResult: l.lab_result_id != null");
    expect(slice).toContain("labFacts.get(l.lab_result_id)?.passed ?? null");
  });
  it("kept: transport form + save, reject-whole, per-line disposition, partial note", () => {
    expect(page).toContain("💾 Save transport details");
    expect(page).toContain("✕ Reject whole manifest");
    expect(page).toContain("<ManifestLotDisposition");
    expect(page).toContain('name="partial_note"');
    expect(page).toContain("required={hasRefusedLine}");
  });
  it("Document AI sits at the TOP of the Delivery tab, before the lines and transport", () => {
    const ai = page.indexOf('id="manifest-ai"');
    expect(ai).toBeGreaterThan(page.indexOf('{activeTab === "delivery" && ('));
    expect(ai).toBeLessThan(page.indexOf('id="manifest-lines"'));
    expect(ai).toBeLessThan(page.indexOf('id="manifest-transport"'));
    expect(page.match(/🤖 Run AI extract/g)?.length).toBe(1);
    expect(page).toContain("{aiAdvice.showButton && (");
    expect(page).toContain("variant={aiAdvice.buttonVariant}");
    for (const k of ["aiAdvice.have", "aiAdvice.missing", "aiAdvice.reads", "aiAdvice.skips", "parseStatus.statement"]) {
      expect(page).toContain(k);
    }
  });
  it("the advice reads the SAVED manifest fields, not the vendor-suggested form defaults", () => {
    const i = page.indexOf("const aiAdvice = adviseAiExtract(");
    const slice = page.slice(i, i + 900);
    expect(slice).toContain("transporter_name: manifest.transporter_name");
    expect(slice).not.toContain("originNameDefault");
    expect(slice).not.toMatch(/td\./);
  });
  it("every anchor the checklist links to still exists on the page", async () => {
    const { buildIntakeChecklist } = await import("@/lib/inventory/intake-checklist-core");
    const anchors = new Set<string>();
    for (const status of ["pending", "in_transit", "received", "accepted", "partially_accepted", "rejected"]) {
      for (const events of [[], [{ event_type: "kb_writeback" }]]) {
        const c = buildIntakeChecklist({ status, lotDispositions: ["accepted", null], hasTransport: false, events });
        for (const it of c.items) if (it.anchor) anchors.add(it.anchor);
      }
    }
    for (const a of anchors) expect(page, a).toContain(`id="${a.slice(1)}"`);
  });
  it("no Tailwind red/orange palette classes (admin tokens only)", () => {
    expect(page).not.toMatch(/\b(?:text|bg|border)-(?:red|orange)-\d{3}\b/);
  });
});

describe("5. The per-line control: Will accept + Reject, no Accept click", () => {
  it("source: no idle Accept button; a Will accept chip instead", () => {
    const src = read(DISPO);
    expect(src).toContain('data-line-state="will-accept"');
    expect(src).not.toMatch(/>\s*✓ Accept\s*</);
    expect(src).not.toMatch(/\\u2715/);
  });
  it("renders: an undecided line shows Will accept and a Reject button only", async () => {
    const { ManifestLotDisposition } = await import("@/components/admin/inventory/ManifestLotDisposition");
    const html = renderToStaticMarkup(
      <ManifestLotDisposition manifestId="m" lotId="l" disposition={null} rejectReason={null} acceptAction={async () => undefined} />,
    );
    expect(html).toContain("Will accept");
    expect(html).toContain("Reject");
    expect(html).not.toMatch(/>✓ Accept</);
  });
  it("renders: a rejected line keeps its undo (accept instead)", async () => {
    const { ManifestLotDisposition } = await import("@/components/admin/inventory/ManifestLotDisposition");
    const html = renderToStaticMarkup(
      <ManifestLotDisposition manifestId="m" lotId="l" disposition="rejected_at_dock" rejectReason="short" acceptAction={async () => undefined} />,
    );
    expect(html).toContain("Rejected at dock");
    expect(html).toContain("accept instead");
  });
});

describe("6. The receipt never capitalises dock-refused lots", () => {
  it("receivableLots drops rejected lots and keeps quarantine/active", async () => {
    const real = await vi.importActual<typeof import("@/lib/accounting/receipt-service")>("@/lib/accounting/receipt-service");
    const rows = [
      { id: "a", status: "active" },
      { id: "b", status: "rejected" },
      { id: "c", status: "quarantine" },
      { id: "d", status: "REJECTED" },
      { id: "e", status: null },
    ];
    expect(real.receivableLots(rows).map((r) => r.id)).toEqual(["a", "c", "e"]);
  });
  it("the receipt's excluded set equals the bill's (receipt and bill agree)", async () => {
    const r = await vi.importActual<typeof import("@/lib/accounting/receipt-service")>("@/lib/accounting/receipt-service");
    const b = await vi.importActual<typeof import("@/lib/accounting/vendor-bill-service")>("@/lib/accounting/vendor-bill-service");
    expect([...r.RECEIPT_EXCLUDED_LOT_STATUSES].sort()).toEqual([...b.BILL_EXCLUDED_LOT_STATUSES].sort());
  });
  it("postManifestReceipt actually routes its lots through receivableLots", () => {
    const src = read("src/lib/accounting/receipt-service.ts");
    expect(src).toMatch(/const lots = receivableLots\(/);
    expect(src).toMatch(/\.select\([^)]*status/);
  });
});

describe("7. Wiring guards", () => {
  const actions = read(ACTIONS);
  it("finalize calls the arrive helper before the decisions and the receipt helper after", () => {
    const i = actions.indexOf("export async function finalizeManifestAction");
    const body = actions.slice(i, actions.indexOf("\n}\n", i));
    const a = body.indexOf("await markArrivedOnFinalize(");
    const d = body.indexOf("await finalizeManifestDispositions(");
    const r = body.indexOf("await postReceiptOnFinalize(");
    const b = body.indexOf("postManifestVendorBill(manifestId");
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(d);
    expect(r).toBeGreaterThan(d);
    expect(r).toBeLessThan(b);
  });
  it("the manual lifecycle action still exists (other screens and old links)", () => {
    expect(actions).toContain("export async function setManifestLifecycleAction");
  });
});
