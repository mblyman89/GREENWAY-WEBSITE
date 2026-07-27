/**
 * tests/compliance/email-harvest.test.ts  (SLICE 69)
 *
 * Vitest mirror for the "leave no stone unturned" harvest brain
 * (email-harvest-core): keyword census, link role-tagging, the fetched-docs
 * CHECKLIST, the "try harder" second-pass planner, and attachment dedupe.
 * The embedded self-tests carry the full matrix; this file re-runs them under
 * vitest and pins the contract points CI must never lose.
 */
import { describe, it, expect } from "vitest";
import {
  HARVEST_KEYWORDS,
  MAX_SECOND_PASS_FETCHES,
  harvestDocLinks,
  assessEmailDocs,
  checklistNote,
  planSecondPassFetches,
  dedupeAttachments,
  __runEmailHarvestTests,
} from "@/lib/inbound-email/email-harvest-core";
import type { NormalizedAttachment } from "@/lib/inbound-email/inbound-normalize-core";

// A real minimal PDF header keeps isPdfAttachment honest (magic bytes "%PDF-").
const PDF_B64 = Buffer.from("%PDF-1.4 fake body for tests").toString("base64");

function att(over: Partial<NormalizedAttachment>): NormalizedAttachment {
  return { filename: null, contentType: null, text: null, base64: null, ...over };
}

describe("email-harvest-core (SLICE 69 — exhaustive vendor email harvest)", () => {
  it("passes all embedded self-tests", () => {
    const { failed } = __runEmailHarvestTests();
    expect(failed).toBe(0);
  });

  it("keyword census covers the vocabulary the owner asked for", () => {
    expect(HARVEST_KEYWORDS.manifest).toContain("manifest");
    expect(HARVEST_KEYWORDS.manifest).toContain("transportation");
    expect(HARVEST_KEYWORDS.invoice).toContain("invoice");
    expect(HARVEST_KEYWORDS.coa).toContain("certificate of analysis");
    expect(HARVEST_KEYWORDS.coa).toContain("coa");
  });

  it("role-tags every anchor from its own paragraph context (no bleed)", () => {
    const html = [
      `<p>Click <a href="https://v.example.com/dl/m1">here</a> to download the manifest.</p>`,
      `<p>Click <a href="https://v.example.com/dl/i1">here</a> to download the invoice.</p>`,
      `<p><a href="https://labs.example.com/x9.pdf">Certificate of Analysis</a></p>`,
    ].join("\n");
    const links = harvestDocLinks(html, "");
    expect(links.find((l) => l.url.endsWith("/dl/m1"))?.role).toBe("manifest");
    expect(links.find((l) => l.url.endsWith("/dl/i1"))?.role).toBe("invoice");
    expect(links.find((l) => l.url.endsWith("/x9.pdf"))?.role).toBe("coa");
  });

  it("tags transfer-data URLs as transfer-json and unclaimed PDFs as other", () => {
    const links = harvestDocLinks(
      `<a href="https://api.cultivera.com/transfers/t1.json">JSON</a>` +
        `<a href="https://v.example.com/files/extra-notes.pdf">extra-notes.pdf</a>`,
      "",
    );
    expect(links.find((l) => l.url.endsWith("t1.json"))?.role).toBe("transfer-json");
    expect(links.find((l) => l.url.endsWith("extra-notes.pdf"))?.role).toBe("other");
  });

  it("checklist reports exactly what was fetched and what is still missing", () => {
    const c = assessEmailDocs(
      [
        att({ filename: "transfer.json", contentType: "application/json", text: "{}" }),
        att({ filename: "manifest.pdf", contentType: "application/pdf", base64: PDF_B64 }),
      ],
      "body here",
    );
    expect(c.transferJson).toBe(true);
    expect(c.manifestPdf).toBe(true);
    expect(c.invoicePdf).toBe(false);
    expect(c.coa).toBe(false);
    expect(c.bodyText).toBe(true);
    expect(c.missing).toEqual(["invoice PDF", "COA"]);
    const note = checklistNote(c);
    expect(note).toContain("harvest checklist:");
    expect(note).toContain("transfer JSON OK");
    expect(note).toContain("invoice PDF MISSING");
    expect(note).toContain("still missing after full harvest: invoice PDF, COA");
  });

  it("checklistNote says everything found when nothing is missing", () => {
    const c = assessEmailDocs(
      [
        att({ filename: "t.json", contentType: "application/json", text: "{}" }),
        att({ filename: "manifest.pdf", contentType: "application/pdf", base64: PDF_B64 }),
        att({ filename: "invoice.pdf", contentType: "application/pdf", base64: PDF_B64 }),
        att({ filename: "coa.pdf", contentType: "application/pdf", base64: PDF_B64 }),
      ],
      "body",
    );
    expect(c.missing).toEqual([]);
    expect(checklistNote(c)).toContain("— everything found");
  });

  it("second pass plans only the missing roles, skips tried URLs, respects the cap", () => {
    const checklist = assessEmailDocs(
      [att({ filename: "manifest.pdf", contentType: "application/pdf", base64: PDF_B64 })],
      "b",
    );
    const harvested = [
      { url: "https://v.example.com/manifest.pdf", role: "manifest" as const },
      { url: "https://v.example.com/invoice.pdf", role: "invoice" as const },
      { url: "https://v.example.com/coa.pdf", role: "coa" as const },
      { url: "https://v.example.com/tried-invoice.pdf", role: "invoice" as const },
      { url: "https://v.example.com/extra.pdf", role: "other" as const },
    ];
    const plan = planSecondPassFetches(checklist, harvested, [
      "https://v.example.com/tried-invoice.pdf",
    ]);
    // Manifest already fetched — never re-planned.
    expect(plan.some((p) => p.role === "manifest")).toBe(false);
    expect(plan.some((p) => p.url.endsWith("/invoice.pdf"))).toBe(true);
    expect(plan.some((p) => p.url.endsWith("/tried-invoice.pdf"))).toBe(false);
    expect(plan.some((p) => p.url.endsWith("/coa.pdf"))).toBe(true);
    // Unclaimed PDF comes along under its own name.
    const other = plan.find((p) => p.role === "other");
    expect(other?.url.endsWith("/extra.pdf")).toBe(true);
    expect(other?.filename).toBeNull();
    expect(plan.length).toBeLessThanOrEqual(MAX_SECOND_PASS_FETCHES);
  });

  it("dedupeAttachments drops byte-identical copies, first occurrence wins", () => {
    const a = att({ filename: "manifest.pdf", contentType: "application/pdf", base64: PDF_B64 });
    const b = att({ filename: "manifest-copy.pdf", contentType: "application/pdf", base64: PDF_B64 });
    const kept = dedupeAttachments([a, b]);
    expect(kept.length).toBe(1);
    expect(kept[0].filename).toBe("manifest.pdf");
  });
});
