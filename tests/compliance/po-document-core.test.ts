/**
 * tests/compliance/po-document-core.test.ts
 *
 * SLICE 81 — vitest mirror for the PURE branded-PO-document core:
 * deterministic vendor-safe codenames, escaped print document with both WSLCB
 * licenses, branded email body, recipient validation for "Verify & send",
 * and the honest procure-to-pay paper trail.
 */
import { describe, expect, it } from "vitest";
import {
  __runPoDocumentCoreTests,
  poCodename,
  normalizeRecipientEmail,
  poDocumentFilename,
  renderPoDocumentHtml,
  renderPoEmailHtml,
  buildPoPaperTrail,
  escapePoHtml,
  type PoTrailFacts,
} from "@/lib/purchasing/po-document-core";

const store = {
  name: "Greenway Marijuana",
  licenseNumber: "413541",
  addressLines: ["4851 Geiger Rd SE", "Port Orchard, WA 98367"],
  phone: "(360) 443-6988",
  email: "contact@greenwaymarijuana.com",
  website: "https://www.greenwaymarijuana.com",
};

describe("po-document-core: embedded self-tests", () => {
  it("all pass", () => {
    expect(() => __runPoDocumentCoreTests()).not.toThrow();
  });
});

describe("po-document-core: codename", () => {
  it("is deterministic and vendor-safe", () => {
    const a = poCodename("PO-202602-0042");
    expect(a).toBe(poCodename("PO-202602-0042"));
    expect(a).toMatch(/^Operation [A-Z][a-z]+ [A-Z][a-z]+$/);
  });
  it("changes with sequence and month, null for junk", () => {
    expect(poCodename("PO-202602-0042")).not.toBe(poCodename("PO-202602-0043"));
    expect(poCodename("PO-202602-0042")).not.toBe(poCodename("PO-202603-0042"));
    expect(poCodename("garbage")).toBeNull();
    expect(poCodename(null)).toBeNull();
  });
});

describe("po-document-core: recipient validation", () => {
  it("accepts a trimmed valid email, refuses junk", () => {
    expect(normalizeRecipientEmail(" orders@farm.com ")).toBe("orders@farm.com");
    expect(normalizeRecipientEmail("not-an-email")).toBeNull();
    expect(normalizeRecipientEmail("a@b")).toBeNull();
    expect(normalizeRecipientEmail("")).toBeNull();
  });
});

describe("po-document-core: document", () => {
  const doc = renderPoDocumentHtml({
    poNumber: "PO-202602-0042",
    codename: poCodename("PO-202602-0042"),
    status: "draft",
    createdAt: "2026-02-10T10:00:00Z",
    expectedDate: "2026-02-20",
    note: null,
    paidAt: null,
    vendor: {
      name: "Two Heads <Farms>",
      licenseNumber: "654321",
      addressLines: ["1 Farm Rd"],
      email: "orders@twoheads.com",
      phone: null,
    },
    store,
    lines: [{ productName: "Blue Dream 3.5g", brand: "Acme", category: "flower", orderQty: 24, unit: "each", unitCostMinor: 900 }],
  });

  it("carries both license numbers and the PO number", () => {
    expect(doc).toContain("WSLCB License 413541");
    expect(doc).toContain("WSLCB License 654321");
    expect(doc).toContain("PO-202602-0042");
  });
  it("escapes vendor-supplied text and has print CSS + compliance footer", () => {
    expect(doc).toContain("Two Heads &lt;Farms&gt;");
    expect(doc).not.toContain("Two Heads <Farms>");
    expect(doc).toContain("@page");
    expect(doc).toContain("three-way match");
    expect(doc).toContain("$216.00");
  });
  it("filename is sanitized", () => {
    expect(poDocumentFilename("PO-202602-0042")).toBe("PO-202602-0042-greenway.html");
    expect(poDocumentFilename(null)).toBe("purchase-order-greenway.html");
  });
});

describe("po-document-core: email body", () => {
  it("is branded and cents-accurate", () => {
    const email = renderPoEmailHtml({
      poNumber: "PO-202602-0042",
      vendorName: "Acme",
      expectedDate: null,
      note: null,
      lines: [{ productName: "X", brand: null, category: null, orderQty: 3, unit: "each", unitCostMinor: 1234 }],
      store,
    });
    expect(email).toContain("Greenway Marijuana");
    expect(email).toContain("$37.02");
    expect(email).toContain("WSLCB License 413541");
  });
});

describe("po-document-core: paper trail", () => {
  const base: PoTrailFacts = {
    poNumber: "PO-202602-0042",
    status: "sent",
    linkAvailable: true,
    manifests: [],
    paidAt: null,
    paymentReference: null,
  };

  it("states honest gaps when nothing is linked", () => {
    const steps = buildPoPaperTrail(base);
    expect(steps).toHaveLength(4);
    expect(steps[1].state).toBe("missing");
    expect(steps[2].state).toBe("missing");
    expect(steps[3].state).toBe("missing");
  });
  it("full chain reads done end to end", () => {
    const steps = buildPoPaperTrail({
      ...base,
      manifests: [{ id: "m1", number: "M-1", status: "accepted", owedMinor: 10000, paidMinor: 10000 }],
      paidAt: "2026-03-01T00:00:00Z",
      paymentReference: "ACH-1",
    });
    expect(steps.every((s) => s.state === "done")).toBe(true);
  });
  it("partial payment and pre-0102 are disclosed", () => {
    const partial = buildPoPaperTrail({
      ...base,
      manifests: [{ id: "m1", number: "M-1", status: "accepted", owedMinor: 10000, paidMinor: 4000 }],
    });
    expect(partial[2].state).toBe("partial");
    expect(partial[2].note).toContain("$40.00");
    const pre = buildPoPaperTrail({ ...base, linkAvailable: false });
    expect(pre[1].state).toBe("unavailable");
    expect(pre[1].note).toContain("0102");
  });
});

describe("po-document-core: escaping", () => {
  it("escapes the four HTML metacharacters", () => {
    expect(escapePoHtml(`<a href="x">&`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;");
  });
});
