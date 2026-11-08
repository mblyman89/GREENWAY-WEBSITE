/**
 * D215 - "It's a duplicate, please remove it. Then build 1-3, we can hold off
 * on number 4." (Green Revolution order 69055 / manifest 11025403383270277 read
 * twice: delivery 1de6e4f4 kept, copy 156b8d15 dismissed.)
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { __runSameEmailGuardTests, findEarlierStagingOfSameEmail } from "@/lib/inbound-email/same-email-guard-core";
import { __runDuplicateDeliveryGuardTests, duplicateDeliveryGuard } from "@/lib/inventory/duplicate-delivery-guard-core";
import {
  __runManifestSiblingTests,
  cleanVendorLabel,
  findLiveSibling,
  siblingEvidence,
  vendorNameFromText,
} from "@/lib/inventory/manifest-sibling-core";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("D215 self-tests", () => {
  it("all pass", () => {
    expect(__runSameEmailGuardTests()).toEqual({ passed: 9, failed: 0 });
    expect(__runDuplicateDeliveryGuardTests()).toEqual({ passed: 8, failed: 0 });
    expect(__runManifestSiblingTests()).toEqual({ passed: 36, failed: 0 });
  });
});

describe("item 1 - the same email read twice is caught whatever the vendor name reads", () => {
  const lots = Array.from({ length: 10 }, (_, i) => ({ lot: `1102540335265357${i}`, qty: 15 }));
  it("the owner's pair is a duplicate (same manifest #, same vendor record, different 'invoice' numbers)", () => {
    const real = { vendor_id: "gr", invoice: "0000069638", lots, number: "11025403383270277" };
    const copy = { vendor_id: "gr", invoice: "69055", lots, number: "11025403383270277" };
    expect(siblingEvidence(copy, real)?.kind).toBe("number_vendor");
    expect(findLiveSibling(copy, [{ id: "1de6e4f4", status: "accepted", ...real }])?.id).toBe("1de6e4f4");
  });
  it("same Message-ID already staged -> not staged again; the row being retried never blocks itself", () => {
    const rows = [{ id: "web", message_id: "a@b", disposition: "staged", manifest_id: "1de6e4f4", to_intake: true, received_at: "2026-11-05T17:21:32Z" }];
    expect(findEarlierStagingOfSameEmail("<A@B>", rows, "rec")?.manifest_id).toBe("1de6e4f4");
    expect(findEarlierStagingOfSameEmail("<A@B>", rows, "web")).toBeNull();
  });
  it("routeAndStage runs the Message-ID check before staging, on every path, and logs the skip as duplicate", () => {
    const ingest = read("src/lib/inbound-email/inbound-ingest.ts");
    const body = ingest.slice(ingest.indexOf("export async function routeAndStage("));
    expect(body.indexOf("earlierStagingOfSameEmail(email, logId)")).toBeGreaterThan(0);
    expect(body.indexOf("earlierStagingOfSameEmail(email, logId)")).toBeLessThan(body.indexOf("stageManifestsFromEmail(email, null)"));
    expect(body).toMatch(/disposition: "duplicate",\s+manifestId: earlier\.manifest_id/);
  });
  it("staging and the Dismiss button look up same-number rows across vendor names", () => {
    const store = read("src/lib/inventory/intake-store.ts");
    expect(store).toMatch(/readSiblingCandidates\(admin, \{ numbers: \[number\] \}\)/);
    expect(store).toMatch(/readSiblingCandidates\(admin, \{ numbers \}\)/);
    expect(store).toMatch(/q\.in\("manifest_number", filter\.numbers/);
  });
});

describe("item 2 - duplicate warning + no Active / Finalize on a suspected duplicate", () => {
  it("the guard refuses Active and Finalize, allows quarantine, and the tick overrides", () => {
    const suspect = { keepId: "1de6e4f4-x", why: "same manifest #" };
    expect(duplicateDeliveryGuard({ step: "activate", suspect, confirmedNotDuplicate: false }).ok).toBe(false);
    expect(duplicateDeliveryGuard({ step: "finalize", suspect, confirmedNotDuplicate: false }).ok).toBe(false);
    expect(duplicateDeliveryGuard({ step: "other", suspect, confirmedNotDuplicate: false }).ok).toBe(true);
    expect(duplicateDeliveryGuard({ step: "activate", suspect, confirmedNotDuplicate: true })).toEqual({ ok: true, overridden: true });
  });
  it("the lot status action checks the delivery before the go-live rules and audits the refusal", () => {
    const a = read("src/app/admin/inventory/actions.ts");
    const fn = a.slice(a.indexOf("export async function setLotStatusAction"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain("suspectedDuplicateOf(current.manifestId)");
    expect(body.indexOf("duplicateDeliveryGuard(")).toBeLessThan(body.indexOf("evaluateLotLifecycleChange("));
    expect(body).toContain("refusals: [dupGuard.code]");
    expect(body).toContain('formData.get("not_duplicate") === "1"');
  });
  it("finalize is guarded before anything is touched", () => {
    const a = read("src/app/admin/inventory/intake/actions.ts");
    const fn = a.slice(a.indexOf("export async function finalizeManifestAction"));
    expect(fn.indexOf('step: "finalize"')).toBeGreaterThan(0);
    expect(fn.indexOf('step: "finalize"')).toBeLessThan(fn.indexOf("await markArrivedOnFinalize("));
    expect(fn).toContain("?error=suspected_duplicate");
  });
  it("the pages show the warning and the tick", () => {
    const lot = read("src/app/admin/inventory/[id]/page.tsx");
    expect(lot).toContain('data-testid="lot-duplicate-delivery-warning"');
    expect(lot).toContain('name="not_duplicate"');
    const del = read("src/app/admin/inventory/intake/[id]/page.tsx");
    expect(del).toContain("This looks like a duplicate of delivery");
    expect(del).toContain('data-testid="finalize-not-duplicate"');
    expect(del).toContain('error === "suspected_duplicate"');
  });
});

describe("item 3 - a shipping-form label is never a vendor name", () => {
  it("cuts the tail, keeps real names", () => {
    expect(cleanVendorLabel("Green Revolution Vehicle ID")).toBe("Green Revolution");
    expect(cleanVendorLabel("PLATEAU GROWERS")).toBe("PLATEAU GROWERS");
    expect(cleanVendorLabel("Vehicle ID")).toBeNull();
    expect(vendorNameFromText("Vendor Name: Green Revolution Vehicle ID 4471 License 412345")).toBe("Green Revolution");
  });
  it("staging and the name healer use it", () => {
    expect(read("src/lib/inventory/intake-store.ts")).toMatch(/carried a shipping-form label - cut/);
    const heal = read("src/lib/inventory/invoice-adjustments-store.ts");
    expect(heal).toMatch(/hasShippingFormLabel\(row\.vendor_label\)/);
    expect(heal).toMatch(/isLabelLikeVendor\(r\.vendor_label\) \|\| hasShippingFormLabel\(r\.vendor_label\)/);
  });
});
