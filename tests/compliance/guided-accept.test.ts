/**
 * tests/compliance/guided-accept.test.ts
 *
 * Slice H15f — the guided accept flow (① Arrived → ② Verify counts → ③ Accept).
 *
 * The stakes: the ribbon and chips must never misrepresent the record.
 *   - The step rail must track the REAL lifecycle status (a rejected manifest
 *     must show a failed final step, never a green check).
 *   - "From the manifest" chips assert machine provenance — transport values
 *     are only chipped when the H15a auto-fill AUDIT EVENT proves the system
 *     seeded them. A human-typed value must never be presented as machine
 *     work, and vice versa.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  guidedProgress,
  whatDoIDoHere,
  GUIDED_STEP_LABELS,
  transportWasAutoFilled,
  fromManifestChips,
  CONCIERGE_HINTS,
} from "@/lib/inventory/guided-accept-core";

describe("H15f — guidedProgress (ribbon tracks the real lifecycle)", () => {
  it("pending / in_transit sit on step ① Arrived", () => {
    for (const s of ["pending", "in_transit"]) {
      const p = guidedProgress(s);
      expect(p.current).toBe(1);
      expect(p.steps).toEqual(["current", "todo", "todo"]);
      expect(p.finished).toBe(false);
      expect(p.rejected).toBe(false);
    }
  });

  it("received sits on step ② Verify counts with ① done", () => {
    const p = guidedProgress("received");
    expect(p.current).toBe(2);
    expect(p.steps).toEqual(["done", "current", "todo"]);
  });

  it("accepted and partially_accepted finish all three steps", () => {
    for (const s of ["accepted", "partially_accepted"]) {
      const p = guidedProgress(s);
      expect(p.steps).toEqual(["done", "done", "done"]);
      expect(p.finished).toBe(true);
      expect(p.rejected).toBe(false);
    }
  });

  it("rejected shows a FAILED final step — never a green check", () => {
    const p = guidedProgress("rejected");
    expect(p.steps).toEqual(["done", "done", "failed"]);
    expect(p.finished).toBe(true);
    expect(p.rejected).toBe(true);
  });

  it("unknown statuses degrade to step ① rather than guessing", () => {
    expect(guidedProgress("who_knows").current).toBe(1);
  });

  it("labels are the strategy doc's three steps", () => {
    expect([...GUIDED_STEP_LABELS]).toEqual(["Arrived", "Verify counts", "Accept"]);
  });
});

describe("H15f — whatDoIDoHere (one plain-English action per stage)", () => {
  it("in transit weaves the ETA in when known", () => {
    expect(whatDoIDoHere("in_transit", "2025-03-13")).toContain("expected 2025-03-13");
    expect(whatDoIDoHere("in_transit", null)).not.toContain("expected");
    expect(whatDoIDoHere("in_transit", null)).toContain("Mark received");
  });

  it("received tells the human their ONE job: verify counts, then finalize", () => {
    const line = whatDoIDoHere("received");
    expect(line).toContain("Count each line");
    expect(line).toContain("Finalize intake");
  });

  it("rejected explains dock refusal + the vendor's CCRS duty (no filing on our end)", () => {
    const line = whatDoIDoHere("rejected");
    expect(line).toContain("refused at the dock");
    expect(line).toContain("never entered inventory");
    expect(line.toLowerCase()).toContain("ccrs");
  });

  it("every lifecycle status gets a non-empty line", () => {
    for (const s of ["pending", "in_transit", "received", "accepted", "partially_accepted", "rejected", "???"]) {
      expect(whatDoIDoHere(s).length).toBeGreaterThan(20);
    }
  });
});

describe("H15f — transportWasAutoFilled (audit-trail provenance, never guessed)", () => {
  // The fingerprint must match what seedTransportFromParsed actually writes —
  // read the source so a copy change there fails loudly here.
  it("fingerprint stays in sync with intake-store's H15a audit note", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/inventory/intake-store.ts"), "utf8");
    expect(src).toContain("auto-filled from the");
  });

  it("detects the H15a seeding event", () => {
    const events = [
      { event_type: "pending", note: "Staged from vendor JSON." },
      {
        event_type: "transport",
        note: "Transport details auto-filled from the wcia document (draft — verify during review).",
      },
    ];
    expect(transportWasAutoFilled(events)).toBe(true);
  });

  it("a human transport save does NOT count as auto-fill", () => {
    const events = [
      { event_type: "transport", note: "Transport / chain-of-custody details updated." },
      { event_type: "note", note: null },
    ];
    expect(transportWasAutoFilled(events)).toBe(false);
    expect(transportWasAutoFilled([])).toBe(false);
  });
});

describe("H15f — fromManifestChips (chips never misattribute provenance)", () => {
  const manifest = {
    manifest_number: "QGT-20636",
    vendor_label: "QUALITY GREEN TREES",
    transfer_date: "2025-03-13",
    eta_date: "2025-03-13",
    departed_at: "2025-03-13T14:00:00+00:00",
    route_notes: "Head west toward 12 Trees Ln NW…",
    transporter_name: null,
  };

  it("identity fields always chip; transport chips only with the audit proof", () => {
    const withProof = fromManifestChips(manifest, true);
    const labels = withProof.map((c) => c.label);
    expect(labels).toContain("Manifest #");
    expect(labels).toContain("Vendor");
    expect(labels).toContain("Transfer date");
    expect(labels).toContain("ETA");
    expect(labels).toContain("Departed");
    expect(labels).toContain("Route");
    expect(labels).not.toContain("Carrier"); // transporter_name null — never invented

    const withoutProof = fromManifestChips(manifest, false);
    const bare = withoutProof.map((c) => c.label);
    expect(bare).toEqual(["Manifest #", "Vendor", "Transfer date"]); // no transport chips
  });

  it("null fields produce no chips at all", () => {
    expect(
      fromManifestChips(
        {
          manifest_number: null,
          vendor_label: null,
          transfer_date: null,
          eta_date: null,
          departed_at: null,
          route_notes: null,
          transporter_name: null,
        },
        true,
      ),
    ).toEqual([]);
  });

  it("departed chip is human-readable (no raw T separator)", () => {
    const chips = fromManifestChips(manifest, true);
    const dep = chips.find((c) => c.label === "Departed");
    expect(dep?.value).toBe("2025-03-13 14:00");
  });
});

describe("H15f — concierge hints", () => {
  it("cover the strategy doc's promised fields with real explanatory copy", () => {
    for (const key of ["eta", "coa", "qty", "decision", "manifest_number", "invoice_number", "finalize", "transporter", "departed"] as const) {
      expect(CONCIERGE_HINTS[key].length, key).toBeGreaterThan(30);
    }
    // The doc's two worked examples:
    expect(CONCIERGE_HINTS.eta).toContain("Estimated arrival");
    expect(CONCIERGE_HINTS.coa).toContain("Certificate of analysis");
    // The owner's legal point: manifest facts are validated for CCRS.
    expect(CONCIERGE_HINTS.manifest_number).toContain("no need to re-verify");
    // The human's one job.
    expect(CONCIERGE_HINTS.qty.toLowerCase()).toContain("confirm the physical count");
  });
});
