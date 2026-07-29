/**
 * tests/compliance/intake-partial-accept.test.ts  (SLICE 101)
 *
 * The owner's Round 9 rules for the receiving intake page:
 *  - a filter on the Incoming (email) table hides accepted + partially
 *    accepted manifests by default ("I want all other manifests to be
 *    visible in the table first");
 *  - a partial acceptance needs NO quarantine/return process — just the
 *    distinct "Partially accepted" badge; and
 *  - a note explaining WHY it's partial is MANDATORY for the audit trail.
 *
 * Covers the pure logic (view filter, shared status derivation, mandatory
 * note validation, badges) plus WIRING PINS on the server files — the
 * str_replace hazard has silently dropped edits twice before; these pins
 * fail the suite if the wiring ever goes missing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveIntakeView,
  isProcessedManifest,
  applyIntakeView,
  countProcessedRows,
  movingBadge,
} from "@/lib/inventory/manifest-table-core";
import {
  deriveManifestStatus,
  normalizePartialNote,
  manifestStatusBadge,
  __runDispositionTests,
} from "@/lib/inventory/intake-disposition-core";

const repoFile = (rel: string) => readFileSync(join(__dirname, "..", "..", rel), "utf8");

describe("SLICE 101 — embedded self-tests", () => {
  it("intake-disposition-core self-tests all pass", () => {
    const r = __runDispositionTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(30);
  });
});

describe("SLICE 101 — intake table view filter", () => {
  const rows = [
    { id: "1", status: "pending" },
    { id: "2", status: "accepted" },
    { id: "3", status: "in_transit" },
    { id: "4", status: "partially_accepted" },
    { id: "5", status: "rejected" },
    { id: "6", status: "received" },
  ];

  it("default view hides accepted + partially accepted; everything else stays", () => {
    expect(resolveIntakeView(undefined)).toBe("action");
    expect(resolveIntakeView("bogus")).toBe("action");
    expect(resolveIntakeView("all")).toBe("all");
    const filtered = applyIntakeView(rows, "action");
    expect(filtered.map((r) => r.id)).toEqual(["1", "3", "5", "6"]);
  });

  it("'all' shows every row with the open ones FIRST (order preserved per group)", () => {
    const all = applyIntakeView(rows, "all");
    expect(all.map((r) => r.id)).toEqual(["1", "3", "5", "6", "2", "4"]);
  });

  it("isProcessedManifest: exactly accepted + partially_accepted (rejected stays visible)", () => {
    expect(isProcessedManifest("accepted")).toBe(true);
    expect(isProcessedManifest("partially_accepted")).toBe(true);
    expect(isProcessedManifest("rejected")).toBe(false);
    expect(isProcessedManifest("pending")).toBe(false);
    expect(isProcessedManifest("in_transit")).toBe(false);
    expect(isProcessedManifest("received")).toBe(false);
    expect(isProcessedManifest(null)).toBe(false);
    expect(countProcessedRows(rows)).toBe(2);
  });
});

describe("SLICE 101 — partial-accept badge (no extra process, just the badge)", () => {
  it("moving badge: partially accepted is DISTINCT from accepted (🟠 vs 🟢)", () => {
    const partial = movingBadge("partially_accepted", null);
    const full = movingBadge("accepted", null);
    expect(partial.label).toBe("Partially accepted");
    expect(partial.emoji).toBe("🟠");
    expect(full.label).toBe("Accepted");
    expect(full.emoji).toBe("🟢");
    expect(partial.label).not.toBe(full.label);
  });

  it("detail badge: 'Partially Accepted' distinct label + gold tone", () => {
    expect(manifestStatusBadge("partially_accepted")).toEqual({
      tone: "gold",
      label: "Partially Accepted",
    });
  });
});

describe("SLICE 101 — shared derivation + mandatory note", () => {
  it("deriveManifestStatus mirrors the finalize outcomes", () => {
    expect(deriveManifestStatus(2, 1, 0)).toBe("partially_accepted");
    expect(deriveManifestStatus(1, 0, 1)).toBe("partially_accepted");
    expect(deriveManifestStatus(0, 0, 1)).toBe("partially_accepted"); // only held — not a refusal
    expect(deriveManifestStatus(4, 0, 0)).toBe("accepted");
    expect(deriveManifestStatus(0, 2, 0)).toBe("rejected");
  });

  it("a partial finalize REQUIRES the why-partial note; a clean accept does not", () => {
    expect(normalizePartialNote("", true).ok).toBe(false);
    expect(normalizePartialNote("  ", true).ok).toBe(false);
    expect(normalizePartialNote(null, false)).toEqual({ ok: true, note: null });
    const good = normalizePartialNote(" damaged case refused at dock ", true);
    expect(good).toEqual({ ok: true, note: "damaged case refused at dock" });
  });
});

describe("SLICE 101 — wiring pins (str_replace hazard)", () => {
  it("finalize path validates the note BEFORE touching lots and shares the derivation", () => {
    const store = repoFile("src/lib/inventory/intake-store.ts");
    expect(store).toContain("normalizePartialNote(");
    expect(store).toContain("deriveManifestStatus(willActivate, willReject, willBlock)");
    expect(store).toContain("deriveManifestStatus(activated, rejected, blocked.length)");
    expect(store).toContain("Why partial:");
    expect(store).toContain("Partial acceptance:");
  });

  it("the action reads partial_note from the form and routes the specific error", () => {
    const actions = repoFile("src/app/admin/inventory/intake/actions.ts");
    expect(actions).toContain('formData?.get("partial_note")');
    expect(actions).toContain("{ partialNote }");
    expect(actions).toContain("error=partial_note");
  });

  it("the review page carries the note field in the finalize form + the banner", () => {
    const page = repoFile("src/app/admin/inventory/intake/[id]/page.tsx");
    expect(page).toContain('name="partial_note"');
    expect(page).toContain("required={hasRefusedLine}");
    expect(page).toContain('error === "partial_note"');
  });

  it("the intake page applies the view filter and the table renders the toggle", () => {
    const page = repoFile("src/app/admin/inventory/intake/page.tsx");
    expect(page).toContain("applyIntakeView(manifests, intakeView)");
    expect(page).toContain("countProcessedRows(manifests)");
    const table = repoFile("src/components/admin/inventory/EmailIntakeTable.tsx");
    expect(table).toContain("Needs attention");
    expect(table).toContain('href="/admin/inventory/intake?view=all"');
  });
});
