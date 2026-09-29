/**
 * tests/compliance/coa-roadmap-anchors.test.ts  (Round 12 — R-COA-ZIP / R-COA-EXTRACT)
 *
 * The roadmap entries R-COA-CSV (S38), R-COA-ZIP (S39) and R-COA-EXTRACT (S40)
 * in docs/INTAKE_PIPELINE_ROADMAP_DECISIONS.md make claims about today's code.
 * This file pins every one of those claims so the roadmap can never silently
 * drift from reality. When S39 / S40 ship, the "today" assertions below flip
 * on purpose (each one names the slice that flips it).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const DOC = read("docs/INTAKE_PIPELINE_ROADMAP_DECISIONS.md");

describe("roadmap doc records the Round 12 COA requests verbatim", () => {
  it("has the three COA sections", () => {
    expect(DOC).toContain("## R-COA-CSV");
    expect(DOC).toContain("## R-COA-ZIP");
    expect(DOC).toContain("## R-COA-EXTRACT");
  });
  it("quotes the owner verbatim (ZIP + extraction)", () => {
    const flat = DOC.replace(/\s+/g, " ");
    expect(flat).toContain(
      "i have confirmed from my cultivera back office, that pdfs exist for all the inventory in our back office, which means cultivera can send me all of them, hopefully in one big zip file.",
    );
    expect(flat).toContain(
      "there is good information in these coa docs and we shouldn't be throwing them in storage somewhere without extracting their useful data.",
    );
  });
  it("names slices S39 and S40 and findings F-136 / F-137", () => {
    expect(DOC).toMatch(/S39[^\n]*F-136/);
    expect(DOC).toMatch(/S40[^\n]*F-137/);
  });
});

describe("the code facts the COA roadmap cites (flip when S39/S40 ship)", () => {
  it("both COA archivers exist and are manifest-scoped (F-136)", () => {
    const src = read("src/lib/inventory/coa-archive.ts");
    expect(src).toMatch(/export async function archiveCoasForManifest\(manifestId: string\)/);
    expect(src).toMatch(/export async function archiveEmailedCoaForManifest\(\s*manifestId: string,/);
    expect(src).toMatch(/const MAX_BYTES = 25 \* 1024 \* 1024;/);
    // The storage path convention S39 reuses.
    expect(src).toContain("const path = `${lab.id}/${base}.pdf`;");
  });

  it("no ZIP reader is a dependency today (S39 adds exactly one)", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const z of ["jszip", "yauzl", "fflate", "adm-zip", "unzipper"]) {
      expect(all[z], `${z} unexpectedly present — update R-COA-ZIP`).toBeUndefined();
    }
    expect(all.unpdf).toBeDefined();
  });

  it("the emailed-COA parser throws terpenes/analytes away (F-137, flips in S40)", () => {
    const src = read("src/lib/inventory/pdf-coa-core.ts");
    expect(src).toMatch(/terpenes_json: null,\s*\n\s*analytes_json: null,/);
  });

  it("intake JSON: terpenes only if the vendor sent them; coa URL = data.coa ?? lab_result_list[0].coa", () => {
    const src = read("src/lib/inventory/intake-parser.ts");
    expect(src).toContain('terpenes_json: pick(data, ["terpenes", "terpene_profile"]) ?? null,');
    expect(src).toContain('coa_url: cleanUrl(pick(data, ["coa"])) ?? coaFromList,');
    expect(src).toContain('coaFromList = cleanUrl(pick(first, ["coa"]));');
  });

  it("the lab_results columns S40 writes already exist", () => {
    const m23 = read("supabase/migrations/0023_pos_inventory_lots.sql");
    expect(m23).toMatch(/terpenes_json\s+jsonb/);
    expect(m23).toMatch(/analytes_json\s+jsonb/);
    const m27 = read("supabase/migrations/0027_pos_coa_archive.sql");
    expect(m27).toContain("add column if not exists coa_storage_path text;");
  });

  it("menu terpenes come only from the strain KB and skip items that already have terpenes (S40 overlay slots in before)", () => {
    const src = read("src/lib/menu/strain-terpenes.ts");
    expect(src).toContain("if (item.terpenes && item.terpenes.length > 0) return item;");
    expect(src).toContain("const terps = terpenesForStrain(index, item.strainName);");
  });

  it("LlamaParse is already wired with a fallback, a confidence gate and a credit estimator", () => {
    const prov = read("src/lib/inbound-email/llamaparse-provider.ts");
    expect(prov).toContain("export async function parsePdfWithFallback(");
    expect(prov).toContain("export function isLlamaParseConfigured(): boolean");
    const core = read("src/lib/inbound-email/llamaparse-core.ts");
    expect(core).toContain("export function gateConfidence(");
    expect(core).toContain("export function estimateCredits(pageCount: number, tier: LlamaParseTier): number");
  });

  it("the archive hook points S40 extends are the ones the roadmap names", () => {
    expect(read("src/lib/inventory/intake-store.ts")).toContain("archiveCoasForManifest(manifestId),");
    expect(read("src/app/admin/inventory/intake/actions.ts")).toContain(
      "const count = await archiveCoasForManifest(manifestId);",
    );
    expect(read("src/app/admin/inventory/coa/[labId]/route.ts")).toContain(
      "const count = await archiveCoasForManifest(manifestId);",
    );
  });

  it("Cultivera-import lots are keyed by the CCRS id the S39 matcher uses first", () => {
    const src = read("src/lib/pos/import-lot-core.ts");
    expect(src).toContain("const ccrsExternalId = deriveInventoryExternalId({ lot_code: barcode }) ?? barcode;");
    expect(read("src/lib/inventory/bulk-fill-core.ts")).toContain(
      'export const MIGRATION_MARKER = "Cultivera migration (one-time POS import).";',
    );
  });
});
