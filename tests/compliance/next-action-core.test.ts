/**
 * tests/compliance/next-action-core.test.ts
 *
 * W4 — pins the next-action guidance contract across the intake pipeline:
 * every PO status, drafts tab, and discovery-funnel state answers "what do I
 * do here?" with plain-English copy and (when actionable) the exact label of
 * the ONE button on the page that advances the work.
 */
import { describe, expect, it } from "vitest";
import {
  poWhatDoIDoHere,
  draftsWhatDoIDoHere,
  discoveryWhatDoIDoHere,
  __runNextActionCoreTests,
} from "@/lib/catalog/next-action-core";

describe("next-action-core: poWhatDoIDoHere", () => {
  it("covers the full PO status chain with the right primary action", () => {
    expect(poWhatDoIDoHere("draft", true).primaryAction).toBe("Send to vendor");
    expect(poWhatDoIDoHere("submitted", true).primaryAction).toBe("Send to vendor");
    expect(poWhatDoIDoHere("sent", true).primaryAction).toBe("Receive");
    expect(poWhatDoIDoHere("partial", true).primaryAction).toBe("Receive");
    expect(poWhatDoIDoHere("received", true).primaryAction).toBeNull();
    expect(poWhatDoIDoHere("cancelled", true).primaryAction).toBeNull();
  });

  it("degrades safely on unknown statuses instead of guessing", () => {
    const a = poWhatDoIDoHere("bogus_status", true);
    expect(a.primaryAction).toBeNull();
    expect(a.text.length).toBeGreaterThan(0);
  });

  it("warns about the missing vendor email only when it is actually missing", () => {
    expect(poWhatDoIDoHere("draft", false).text).toContain("no vendor email");
    expect(poWhatDoIDoHere("submitted", false).text).toContain("no vendor email");
    expect(poWhatDoIDoHere("draft", true).text).not.toContain("no vendor email");
  });

  it("every status yields non-empty copy", () => {
    for (const s of ["draft", "submitted", "sent", "partial", "received", "cancelled"]) {
      expect(poWhatDoIDoHere(s, true).text.length).toBeGreaterThan(20);
    }
  });
});

describe("next-action-core: draftsWhatDoIDoHere", () => {
  it("review tab with drafts → Approve is the primary action, with the count woven in", () => {
    const a = draftsWhatDoIDoHere("draft", { draft: 3, approved: 0, dismissed: 0 });
    expect(a.primaryAction).toBe("Approve");
    expect(a.text).toContain("3 new products");
  });

  it("uses singular copy for one draft", () => {
    const a = draftsWhatDoIDoHere("draft", { draft: 1, approved: 0, dismissed: 0 });
    expect(a.text).toContain("1 new product below is");
  });

  it("empty review tab is a genuine all-clear (no primary action)", () => {
    const a = draftsWhatDoIDoHere("draft", { draft: 0, approved: 5, dismissed: 2 });
    expect(a.primaryAction).toBeNull();
    expect(a.text).toContain("All clear");
  });

  it("approved tab is informational; dismissed tab points at Restore", () => {
    expect(
      draftsWhatDoIDoHere("approved", { draft: 0, approved: 1, dismissed: 0 }).primaryAction,
    ).toBeNull();
    expect(
      draftsWhatDoIDoHere("dismissed", { draft: 0, approved: 0, dismissed: 1 }).text,
    ).toContain("Restore");
  });
});

describe("next-action-core: discoveryWhatDoIDoHere", () => {
  it("shortlisted leads win — the primary action is the real button label", () => {
    const a = discoveryWhatDoIDoHere({ openProductLeads: 4, shortlisted: 2, openVendorLeads: 3 });
    expect(a.primaryAction).toBe("Start PO from lead");
    expect(a.text).toContain("2 shortlisted");
  });

  it("falls back to qualifying open product leads, then vendor leads, then idle", () => {
    expect(
      discoveryWhatDoIDoHere({ openProductLeads: 5, shortlisted: 0, openVendorLeads: 2 }).text,
    ).toContain("5 open product leads");
    expect(
      discoveryWhatDoIDoHere({ openProductLeads: 0, shortlisted: 0, openVendorLeads: 2 }).text,
    ).toContain("2 vendor leads");
    const idle = discoveryWhatDoIDoHere({ openProductLeads: 0, shortlisted: 0, openVendorLeads: 0 });
    expect(idle.primaryAction).toBeNull();
    expect(idle.text).toContain("No open leads");
  });

  it("uses singular copy correctly", () => {
    expect(
      discoveryWhatDoIDoHere({ openProductLeads: 0, shortlisted: 1, openVendorLeads: 0 }).text,
    ).toContain("1 shortlisted product lead is");
    expect(
      discoveryWhatDoIDoHere({ openProductLeads: 1, shortlisted: 0, openVendorLeads: 0 }).text,
    ).toContain("1 open product lead");
  });
});

describe("next-action-core: embedded self-tests", () => {
  it("pass", () => {
    expect(__runNextActionCoreTests().passed).toBeGreaterThan(0);
  });
});
