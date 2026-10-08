/**
 * tests/compliance/r28-intake-wiring.test.ts
 *
 * R28 - how a delivery reaches the certificate reader:
 *
 *   1. the REAL parser on the owner's REAL transfer keeps every item's lab
 *      JSON link (lab_result_link) and never mistakes a PDF or a non-https
 *      link for it;
 *   2. intake-store: the link is saved with the lab row (and dropped once,
 *      not fatally, on a database without 0252); finalize archives the PDFs
 *      THEN reads the certificates under the 120 s budget, never failing
 *      the finalize, and writes the result on the delivery timeline;
 *   3. the timeline note for every kind of run (the REAL coaExtractRunNote);
 *   4. staging and the draft plan both read the certificate facts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseVendorJson, wciaJsonUrl } from "@/lib/inventory/intake-parser";
import { coaExtractRunNote, COA_EXTRACT_EVENT } from "@/lib/inventory/coa-extract-core";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const transferText = read("tests/fixtures/coa/transfer.json");
const items = (JSON.parse(transferText) as { inventory_transfer_items: { lab_result_link: string }[] }).inventory_transfer_items;

describe("R28 the parser keeps the lab JSON link", () => {
  it("every one of the 17 real items carries its own lab_result_link, unchanged", () => {
    const r = parseVendorJson(transferText);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.lines).toHaveLength(17);
    r.manifest.lines.forEach((l, i) => expect(l.lab?.wcia_json_url).toBe(items[i].lab_result_link.trim()));
    // the owner's own example (R26): item 12 is the WA-260921-006 certificate
    expect(r.manifest.lines[12].lab?.wcia_json_url).toBe("https://certs.conflabs.com/wcia/v2_1/WA-7mDLOjIpm5i3-WA-260921-006");
  });

  it("a PDF, http, a non-link or nothing is never taken as the JSON link", () => {
    expect(wciaJsonUrl({ lab_result_link: "https://certs.conflabs.com/full/WA-x.pdf" })).toBeNull();
    expect(wciaJsonUrl({ lab_result_link: "https://certs.conflabs.com/full/WA-x.PDF?dl=1" })).toBeNull();
    expect(wciaJsonUrl({ lab_result_link: "http://certs.conflabs.com/wcia/v2_1/WA-x" })).toBeNull();
    expect(wciaJsonUrl({ lab_result_link: "not a link" })).toBeNull();
    expect(wciaJsonUrl({})).toBeNull();
    expect(wciaJsonUrl({ lab_result_link: "https://certs.conflabs.com/wcia/v2_1/WA-x.json" })).toBe("https://certs.conflabs.com/wcia/v2_1/WA-x.json");
  });
});

describe("R28 intake-store wiring (source pins)", () => {
  const s = read("src/lib/inventory/intake-store.ts");

  it("the link is saved with the lab row and dropped ONCE (not fatally) when 0252 is missing", () => {
    expect(s).toContain("if (line.lab.wcia_json_url && !labJsonUrlColumnMissing) labRow.wcia_json_url = line.lab.wcia_json_url;");
    expect(s).toContain('if (lErr && "wcia_json_url" in labRow && isMissingColumnError(lErr)) {');
    expect(s).toContain("labJsonUrlColumnMissing = true;");
    expect(s).toContain("delete labRow.wcia_json_url;");
  });

  it("finalize: archive first, then read under the budget; neither can fail the finalize", () => {
    expect(s).toContain("const COA_EXTRACT_FINALIZE_BUDGET_MS = 120_000;");
    const a = s.indexOf("const archive = await archiveCoasForManifest(manifestId)");
    const e = s.indexOf("const extract = await extractCoasForManifest(manifestId, actorId, { budgetMs: COA_EXTRACT_FINALIZE_BUDGET_MS })");
    expect(a).toBeGreaterThan(0);
    expect(e).toBeGreaterThan(a);
    expect(s.slice(e, e + 260)).toContain(".catch(");
    expect(s).toContain("await Promise.allSettled([");
    expect(s).toContain("const note = coaExtractRunNote(ex);");
    expect(s).toContain("if (note) await logManifestEvent(manifestId, COA_EXTRACT_EVENT, note, actorId);");
    expect(s).toContain("Lab certificates could not be read: ");
    // the intake page (where finalize runs) has room for the 120 s read
    expect(read("src/app/admin/inventory/intake/[id]/page.tsx")).toContain("export const maxDuration = 300;");
  });

  it("staging and the draft plan both read the certificate facts", () => {
    expect(read("src/lib/pos/intake-menu-staging.ts")).toContain("await loadCoaFactsForDrafts(admin, drafts)");
    expect(read("src/lib/pos/draft-injection.ts")).toContain("await loadCoaFactsForDrafts(admin, drafts)");
  });
});

describe("R28 the delivery timeline note (coaExtractRunNote)", () => {
  const run = (o: Partial<Parameters<typeof coaExtractRunNote>[0]> = {}) =>
    ({ migrated: true, pending: 0, read: 0, ok: 0, partial: 0, failed: 0, deferred: 0, kbFilled: 0, errors: [], ...o }) as Parameters<typeof coaExtractRunNote>[0];

  it("the event name is stable", () => expect(COA_EXTRACT_EVENT).toBe("coa_extract"));

  it("nothing to read and no problem -> no note (no noise on the timeline)", () => expect(coaExtractRunNote(run())).toBeNull());

  it("0252 missing says so and what to do", () => {
    const n = coaExtractRunNote(run({ migrated: false }))!;
    expect(n).toContain("missing migration 0252");
    expect(n).toContain("Re-read lab certificate");
  });

  it("all read -> counts only, no 'open the lot' pointer", () => {
    const n = coaExtractRunNote(run({ pending: 17, read: 17, ok: 17, kbFilled: 4 }))!;
    expect(n).toBe("Read 17 of 17 lab certificate(s) (17 fully read and cross-checked). added terpenes / cannabinoids to 4 knowledge-base product(s).");
  });

  it("partial, unreadable, deferred and problems each said, with the pointer to the lot", () => {
    const n = coaExtractRunNote(run({ pending: 17, read: 15, ok: 13, partial: 1, failed: 1, deferred: 2, errors: ["a", "b", "c", "d", "e"] }))!;
    expect(n).toContain("Read 15 of 17 lab certificate(s) (13 fully read and cross-checked, 1 partly read, 1 unreadable)");
    expect(n).toContain("2 left for the next pass (time limit)");
    expect(n).toContain("Problems: a | b | c (+2 more).");
    expect(n.endsWith("Open the lot to see what the certificate did and did not give.")).toBe(true);
  });
});
