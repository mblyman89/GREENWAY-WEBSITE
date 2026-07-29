/**
 * SLICE 102 — the intake vendor GOLD MINER.
 *
 * Owner (Michael): "have the fetcher pull vendor profile data from the
 * invoice, manifest, transport manifest, email … be super smart about its
 * fetching so it gives me accurate info."
 *
 * Grounded on the REAL checked-in fixtures — every expectation below was
 * verified against the actual flattened text of the owner's own documents.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  mineVendorFacts,
  vendorZone,
  senderAddress,
  isUsableVendorEmail,
  vendorProfileGapFill,
  licenseConflict,
  summarizeGoldMine,
  classifyMinerKind,
  __runVendorGoldminerTests,
} from "@/lib/inventory/vendor-goldminer-core";

const fx = (name: string) =>
  readFileSync(join(process.cwd(), "tests/compliance/fixtures", name), "utf8");
const src = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("vendor-goldminer self-tests", () => {
  it("all pass", () => {
    const r = __runVendorGoldminerTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(28);
  });
});

describe("real fixtures: the vendor zone is cut before our own details", () => {
  it("LCB manifest: zone stops before the destination block (our address)", () => {
    const zone = vendorZone(fx("pdf-manifest-sample.txt"));
    expect(zone).not.toContain("GEIGER");
    expect(zone).not.toContain("413541");
  });
  it("GrowFlow transport manifest: zone stops before carrier + destination", () => {
    const zone = vendorZone(fx("pdf-growflow-manifest-sample.txt"));
    expect(zone).not.toContain("TERPENE TRANSIT");
    expect(zone).not.toContain("413541");
  });
  it("Cultivera invoice: zone stops at Manifest Details / Ship To", () => {
    const zone = vendorZone(fx("pdf-invoice-cultivera-spr-sample.txt"));
    expect(zone).not.toContain("GREENWAY");
  });
});

describe("real fixtures: mined vendor facts", () => {
  it("GrowFlow transport manifest (HAYAA GREEN): license, phone, email, healed address", () => {
    const m = mineVendorFacts([{ kind: "transport", text: fx("pdf-growflow-manifest-sample.txt") }]);
    expect(m.licenseNumber).toBe("426127"); // origin, NOT the carrier's 426061
    expect(m.phone).toBe("509-581-4319");
    expect(m.email).toBe("info@hayaalegacy.com");
    expect(m.address).toEqual({
      line1: "237004 E LEGACY PR SE",
      city: "KENNEWICK",
      state: "WA",
      zip: "99337", // fixture prints the glued "9933 7"
    });
    expect(m.sources.license).toBe("transport manifest");
  });

  it("GrowFlow transfer log (Svin Garden): labelled facts, address after the label only", () => {
    const m = mineVendorFacts([{ kind: "transport", text: fx("pdf-transferlog-oldmethod-sample.txt") }]);
    expect(m.licenseNumber).toBe("415820");
    expect(m.phone).toBe("360-618-2226");
    expect(m.address).toEqual({
      line1: "30320 Old 99 N, Unit B",
      city: "Stanwood",
      state: "WA",
      zip: "98292",
    });
  });

  it("Cultivera invoice (SPR): license 417068, phone, Arlington address", () => {
    const m = mineVendorFacts([{ kind: "invoice", text: fx("pdf-invoice-cultivera-spr-sample.txt") }]);
    expect(m.licenseNumber).toBe("417068");
    expect(m.phone).toBe("360-572-0840");
    expect(m.address?.city).toBe("ARLINGTON");
    expect(m.address?.zip).toBe("98223-6446");
  });

  it("LCB manifest (SPR): glued phone healed token-by-token; vendor address found", () => {
    const m = mineVendorFacts([{ kind: "manifest", text: fx("pdf-manifest-cultivera-spr-sample.txt") }]);
    // Fixture prints "Licensee Phone: 3605720840 2021 WHITE Nissan…" — the
    // trailing vehicle-year glue must not corrupt the number.
    expect(m.phone).toBe("360-572-0840");
    expect(m.address?.line1).toBe("17731 59th Ave NE - Bldg 16A");
    expect(m.address?.city).toBe("ARLINGTON");
  });

  it("LCB manifest (Oakville): 'WA 3604808813' glue is a PHONE, never a fake zip", () => {
    const m = mineVendorFacts([{ kind: "manifest", text: fx("pdf-manifest-cultivera-sample.txt") }]);
    // The vendor block prints city + a glued 10-digit phone where a zip would
    // sit — strict 5/9-digit zips mean NO address is proposed (never guess).
    expect(m.address).toBeNull();
    expect(m.phone).toBe("360-451-7357");
  });

  it("never proposes OUR OWN details from any fixture", () => {
    for (const file of [
      "pdf-manifest-sample.txt",
      "pdf-manifest-cultivera-sample.txt",
      "pdf-manifest-cultivera-spr-sample.txt",
      "pdf-invoice-cultivera-spr-sample.txt",
      "pdf-growflow-manifest-sample.txt",
      "pdf-transferlog-oldmethod-sample.txt",
    ]) {
      const m = mineVendorFacts([{ kind: "manifest", text: fx(file) }]);
      expect(m.licenseNumber).not.toBe("413541");
      expect(m.phone).not.toBe("360-443-6988");
      expect(m.email ?? "").not.toContain("greenwaymarijuana");
      expect(m.address?.line1 ?? "").not.toContain("GEIGER");
    }
  });
});

describe("sender-address fallback guards", () => {
  it("parses angled From headers", () => {
    expect(senderAddress('"Michelle F" <mf@sprwa.com>')).toBe("mf@sprwa.com");
    expect(senderAddress("orders@sprwa.com")).toBe("orders@sprwa.com");
    expect(senderAddress("")).toBeNull();
  });
  it("platform / robot / our-domain senders are never usable", () => {
    expect(isUsableVendorEmail("mailer@app.cultivera.com")).toBe(false);
    expect(isUsableVendorEmail("no-reply@getgrowflow.com")).toBe(false);
    expect(isUsableVendorEmail("notifications@leaflink.com")).toBe(false);
    expect(isUsableVendorEmail("stephen@greenwaymarijuana.com")).toBe(false);
    expect(isUsableVendorEmail("orders@sprwa.com")).toBe(true);
  });
  it("document email beats the sender; sender is last resort", () => {
    const withDoc = mineVendorFacts(
      [{ kind: "transport", text: fx("pdf-growflow-manifest-sample.txt") }],
      "someone@sprwa.com",
    );
    expect(withDoc.email).toBe("info@hayaalegacy.com");
    const senderOnly = mineVendorFacts([], "someone@sprwa.com");
    expect(senderOnly.email).toBe("someone@sprwa.com");
    expect(senderOnly.sources.email).toBe("email sender");
  });
});

describe("gap-fill + interlock", () => {
  const mined = mineVendorFacts([{ kind: "transport", text: fx("pdf-growflow-manifest-sample.txt") }]);
  it("fills only EMPTY columns; address is all-or-nothing", () => {
    const { patch, filled } = vendorProfileGapFill(
      {
        email: "kept@vendor.com",
        phone: null,
        license_number: "",
        shipping_address1: "1 Existing Rd",
        shipping_city: null,
        shipping_state: null,
        shipping_zip: null,
      },
      mined,
    );
    expect(patch.email).toBeUndefined(); // populated → untouched
    expect(patch.phone).toBe("509-581-4319");
    expect(patch.license_number).toBe("426127");
    expect(patch.shipping_address1).toBeUndefined(); // half-filled block → untouched
    expect(filled.join(" ")).toContain("transport manifest"); // provenance
  });
  it("license conflict refuses; matching or unknown licenses pass", () => {
    expect(licenseConflict("417068", "426127")).toBe(true);
    expect(licenseConflict("426127", "426127")).toBe(false);
    expect(licenseConflict(null, "426127")).toBe(false);
  });
  it("audit note names the never-overwrite rule", () => {
    expect(summarizeGoldMine(["phone x (from the invoice)"]))
      .toContain("never overwritten");
  });
});

describe("miner-kind classification", () => {
  it("transport documents recognized by their own headers", () => {
    expect(classifyMinerKind("manifest", fx("pdf-growflow-manifest-sample.txt"))).toBe("transport");
    expect(classifyMinerKind("manifest", fx("pdf-transferlog-oldmethod-sample.txt"))).toBe("transport");
    expect(classifyMinerKind("manifest", fx("pdf-manifest-sample.txt"))).toBe("manifest");
    expect(classifyMinerKind("invoice", fx("pdf-invoice-cultivera-spr-sample.txt"))).toBe("invoice");
  });
});

describe("wiring pins", () => {
  it("email staging collects miner sources and enriches after BOTH staging paths", () => {
    const store = src("src/lib/inbound-email/inbound-store.ts");
    expect(store).toContain('from "@/lib/inventory/vendor-goldminer-core"');
    expect(store).toContain('from "@/lib/inventory/vendor-goldminer-store"');
    expect(store).toContain("const minerSources: MinerSource[] = []");
    expect(store).toContain('minerSources.push({ kind: "email-body", text: email.bodyText })');
    const calls = store.split(
      "enrichVendorFromIntakeDocs(staged.manifestId, minerSources, email.from, actorId)",
    );
    expect(calls.length - 1).toBe(2); // JSON/CSV path + PDF-primary path
  });
  it("COA PDFs never feed the miner (lab contact ≠ vendor contact)", () => {
    const store = src("src/lib/inbound-email/inbound-store.ts");
    const loop = store.slice(store.indexOf("const minerSources"), store.indexOf("invoiceDonors.push"));
    expect(loop).toContain('classifyAttachmentRole(att) === "coa") continue');
  });
  it("KB bridge gives pre-slice manifests a second chance at finalize", () => {
    const bridge = src("src/lib/inventory/manifest-kb-bridge.ts");
    expect(bridge).toContain("enrichVendorFromRawText(manifestId, manifest.vendor_id, manifest.raw_payload, actorId)");
  });
  it("store is fill-only-empty, interlocked, and audited", () => {
    const store = src("src/lib/inventory/vendor-goldminer-store.ts");
    expect(store).toContain("licenseConflict(vendor.license_number, mined.licenseNumber)");
    expect(store).toContain('event_type: "vendor_goldminer"');
    expect(store).toContain("vendorProfileGapFill(vendor, mined)");
    expect(store).toContain("Nothing was changed");
  });
  it("self-tests ride the pure runner", () => {
    const runner = src("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('assertNoFailures("vendor-goldminer", __runVendorGoldminerTests())');
  });
});
