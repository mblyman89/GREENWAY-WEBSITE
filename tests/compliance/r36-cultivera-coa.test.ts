/**
 * tests/compliance/r36-cultivera-coa.test.ts
 *
 * R36 #4 - the owner's error was "cultivera is not on the known list for lab
 * testers so it didnt read the coa". These tests use the 35 REAL certificates
 * from the owner's own sample transfers (tests/fixtures/coa-cultivera: every
 * one fetched live from files.cultivera.com, R36) and prove, end to end
 * through the same functions production uses:
 *
 *   1. every link is now allowed (files.cultivera.com built in);
 *   2. every PDF is recognised (Confidence Template 6.0/7.0, Testing
 *      Technologies) and its potency numbers AGREE with the lab's own JSON -
 *      an independent oracle, not numbers we typed in;
 *   3. assembleCoaExtract marks all 35 "ok" via the re-hosted-copy proof;
 *   4. the proof is not a rubber stamp: a PDF paired with ANOTHER sample's
 *      lab JSON / link fails identity (every one of 35 rotations), and a
 *      tampered auth code or sample id fails too;
 *   5. "<LOQ" cells are reported, never turned into a number.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCoaPdfText, potencyRow, agreesPrinted, detectCoaTemplate } from "@/lib/inventory/coa-pdf-text-core";
import { assembleCoaExtract, rehostedCopyProof } from "@/lib/inventory/coa-facts-core";
import { safeCoaUrl } from "@/lib/inventory/coa-extract-core";
import { parseWciaLabJson } from "@/lib/inventory/wcia-lab-json-core";

const DIR = join(__dirname, "..", "fixtures", "coa-cultivera");
type Src = { stem: string; json: string; pdf: string; pdfBytes: number; layout: string; labSampleId: string | null };
const SOURCES = JSON.parse(readFileSync(join(DIR, "sources.json"), "utf8")) as Src[];
const text = (stem: string) => readFileSync(join(DIR, `${stem}.unpdf.txt`), "utf8");
const json = (stem: string) => readFileSync(join(DIR, `${stem}.wcia.json`), "utf8");

/** The lab JSON's own cannabinoid names -> our keys (Confidence + Testing Technologies spellings). */
const JSON_KEY: Record<string, string> = {
  "delta(9)-tetrahydrocannabinolic acid": "thca",
  "delta(9)-tetrahydrocannabinol": "d9-thc",
  cannabidiol: "cbd",
  "cannabidiolic acid": "cbda",
  cannabigerol: "cbg",
  "cannabigerolic acid": "cbga",
  cannabinol: "cbn",
  cannabichromene: "cbc",
  THCA: "thca",
  "d9-THC": "d9-thc",
  CBD: "cbd",
  CBDA: "cbda",
  CBN: "cbn",
  "total-thc": "total-thc",
  "total-cbd": "total-cbd",
  "Total THC": "total-thc",
  "Total CBD": "total-cbd",
};

function jsonPct(stem: string): { key: string; pct: number }[] {
  const d = JSON.parse(json(stem)) as { metric_list: { metrics: { name: string; qom: string; uom: string }[] }[] };
  const out: { key: string; pct: number }[] = [];
  for (const t of d.metric_list) for (const m of t.metrics) if (m.uom === "pct" && JSON_KEY[m.name]) out.push({ key: JSON_KEY[m.name], pct: Number(m.qom) });
  return out;
}

const assemble = (pdfStem: string, jsonStem: string, transferPdf: string) =>
  assembleCoaExtract({
    jsonUrl: SOURCES.find((s) => s.stem === jsonStem)!.json,
    coaUrl: transferPdf,
    transferCoaUrl: transferPdf,
    jsonText: json(jsonStem),
    pdfText: text(pdfStem),
    pdfVia: "unpdf",
    extractedAt: "2026-10-10T00:00:00Z",
  });

describe("R36 fixtures are the real owner certificates", () => {
  it("35 certificates: 10 Confidence v6.0, 21 Confidence v7.0, 4 Testing Technologies, all on files.cultivera.com", () => {
    expect(SOURCES).toHaveLength(35);
    const by = (l: string) => SOURCES.filter((s) => s.layout === l).length;
    expect([by("confidence-v6.0"), by("confidence-v7.0"), by("tt")]).toEqual([10, 21, 4]);
    for (const s of SOURCES) {
      expect(new URL(s.pdf).hostname).toBe("files.cultivera.com");
      expect(new URL(s.json).hostname).toBe("files.cultivera.com");
    }
    expect(new Set(SOURCES.map((s) => s.pdf)).size).toBe(35);
  });
});

describe("R36 1. every Cultivera link is allowed (the owner's error)", () => {
  it.each(SOURCES.map((s) => [s.stem, s]))("%s: PDF + JSON link pass safeCoaUrl", (_stem, s) => {
    expect(safeCoaUrl(s.pdf).ok).toBe(true);
    expect(safeCoaUrl(s.json).ok).toBe(true);
  });
  it("a look-alike host is still refused", () => {
    for (const bad of ["https://files.cultivera.com.evil.example/x.pdf", "https://cultivera.com/x.pdf", "https://files-cultivera.com/x.pdf", "http://files.cultivera.com/x.pdf"]) {
      expect(safeCoaUrl(bad).ok, bad).toBe(false);
    }
  });
});

describe("R36 2. every PDF is read, and agrees with the lab's own JSON", () => {
  it.each(SOURCES.map((s) => [s.stem, s]))("%s", (stem, s) => {
    const t = text(stem);
    const want = s.layout === "tt" ? "testing-technologies" : "confidence-7";
    expect(detectCoaTemplate(t)).toBe(want);
    const r = parseCoaPdfText(t);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.template).toBe(want);
    expect(r.doc.potencyReadable).toBe(true);
    expect(r.doc.checks.filter((c) => !c.ok)).toEqual([]);
    if (s.layout !== "tt") {
      expect(r.doc.labSampleId).toBe(s.labSampleId);
      expect(r.doc.potency.length).toBe(20);
      expect(r.doc.terpenes.length).toBeGreaterThanOrEqual(39);
      expect(r.doc.auth).toMatch(/^[A-Za-z0-9]{8,}/);
    } else {
      expect(r.doc.batchId).toMatch(/^\d{16,}$/);
      expect(r.doc.potency.length).toBe(8);
    }
    // the oracle: every number both documents print must agree
    let compared = 0;
    for (const j of jsonPct(stem)) {
      const row = potencyRow(r.doc, j.key as never);
      if (!row || row.pct === null) continue; // <LOQ / not printed
      compared += 1;
      const same = Math.abs(row.pct - j.pct) < 1e-9 || agreesPrinted(row.pct, j.pct);
      expect(same, `${stem} ${j.key}: PDF ${row.pct} vs JSON ${j.pct}`).toBe(true);
    }
    expect(compared).toBeGreaterThanOrEqual(s.layout === "tt" ? 4 : 5);
  });

  it("270 numbers compared across the 35 certificates, none disagree", () => {
    let compared = 0;
    for (const s of SOURCES) {
      const r = parseCoaPdfText(text(s.stem));
      if (!r.ok) throw new Error(s.stem);
      for (const j of jsonPct(s.stem)) {
        const row = potencyRow(r.doc, j.key as never);
        if (row && row.pct !== null) compared += 1;
      }
    }
    expect(compared).toBe(270);
  });
});

describe("R36 3. the whole read is 'ok' for all 35 (re-hosted copy proven)", () => {
  it.each(SOURCES.map((s) => [s.stem, s]))("%s", (stem, s) => {
    const ex = assemble(stem, stem, s.pdf);
    expect(ex.status, ex.summary).toBe("ok");
    const id = ex.identity.find((c) => c.what === "the lab JSON names the same COA as the transfer");
    expect(id?.ok).toBe(true);
    expect(id?.detail).toContain("re-hosted copy");
    expect(ex.agreement.length).toBeGreaterThan(0);
    expect(ex.agreement.every((c) => c.ok)).toBe(true);
  });
});

describe("R36 4. the proof is not a rubber stamp", () => {
  it("each Confidence PDF paired with the NEXT certificate's lab JSON fails identity (31 rotations)", () => {
    const conf = SOURCES.filter((s) => s.layout !== "tt");
    for (let i = 0; i < conf.length; i += 1) {
      const pdf = conf[i];
      const other = conf[(i + 1) % conf.length];
      const ex = assemble(pdf.stem, other.stem, pdf.pdf);
      expect(ex.status, `${pdf.stem} + ${other.stem}`).not.toBe("ok");
      expect(ex.identity.some((c) => !c.ok)).toBe(true);
    }
  });

  it("each Testing Technologies PDF paired with another TT lab JSON fails identity (4 rotations)", () => {
    const tt = SOURCES.filter((s) => s.layout === "tt");
    for (let i = 0; i < tt.length; i += 1) {
      const ex = assemble(tt[i].stem, tt[(i + 1) % tt.length].stem, tt[i].pdf);
      expect(ex.status).not.toBe("ok");
    }
  });

  it("a Confidence PDF with a Testing Technologies JSON (and the reverse) fails", () => {
    expect(assemble("cv00", "cv31", SOURCES[0].pdf).status).not.toBe("ok");
    expect(assemble("cv31", "cv00", SOURCES[31].pdf).status).not.toBe("ok");
  });

  it("rehostedCopyProof refuses a changed auth code, sample id, or a link without them", () => {
    const r = parseCoaPdfText(text("cv00"));
    if (!r.ok) throw new Error("cv00");
    const labLink = (JSON.parse(json("cv00")) as { coa: string }).coa;
    expect(rehostedCopyProof(labLink, r.doc)).not.toBeNull();
    expect(rehostedCopyProof(labLink, { ...r.doc, auth: "X" + r.doc.auth!.slice(1) })).toBeNull();
    expect(rehostedCopyProof(labLink, { ...r.doc, labSampleId: "WA-240906-050" })).toBeNull();
    expect(rehostedCopyProof(labLink, { ...r.doc, auth: null })).toBeNull();
    expect(rehostedCopyProof("https://certs.conflabs.com/full/x.pdf", r.doc)).toBeNull();
    expect(rehostedCopyProof(null, r.doc)).toBeNull();
    expect(rehostedCopyProof(labLink, null)).toBeNull();
  });

  it("Testing Technologies proof needs the inventory id as BOTH labresult_id and sample.id", () => {
    const r = parseCoaPdfText(text("cv31"));
    if (!r.ok) throw new Error("cv31");
    const j = parseWciaLabJson(json("cv31"));
    if (!j.ok) throw new Error(j.error);
    expect(rehostedCopyProof(null, r.doc, j.doc)).not.toBeNull();
    expect(rehostedCopyProof(null, r.doc, { ...j.doc, sampleId: "15418385823780349" })).toBeNull();
    expect(rehostedCopyProof(null, r.doc, { ...j.doc, labResultId: "15418385823780349" })).toBeNull();
    expect(rehostedCopyProof(null, { ...r.doc, batchId: "123" }, j.doc)).toBeNull();
    expect(rehostedCopyProof(null, r.doc, null)).toBeNull();
  });
});

describe("R36 5. '<LOQ' is reported, never a number", () => {
  it("cv28 cbg is <LOQ: pct null, not ND, and a warning names it", () => {
    const r = parseCoaPdfText(text("cv28"));
    if (!r.ok) throw new Error("cv28");
    const row = potencyRow(r.doc, "cbg");
    expect(row).not.toBeNull();
    expect(row!.pct).toBeNull();
    expect(row!.nd).toBe(false);
    expect(r.doc.warnings.join(" ")).toMatch(/<LOQ.*cbg/);
  });
  it("the six <LOQ cells across the set are exactly the six the lab JSON has a sub-LOQ number for", () => {
    const missing: string[] = [];
    for (const s of SOURCES) {
      const r = parseCoaPdfText(text(s.stem));
      if (!r.ok) continue;
      for (const j of jsonPct(s.stem)) {
        const row = potencyRow(r.doc, j.key as never);
        if (!row || row.pct === null) missing.push(`${s.stem}:${j.key}`);
      }
    }
    expect(missing.sort()).toEqual(["cv14:cbga", "cv20:cbn", "cv21:cbg", "cv24:cbn", "cv26:cbc", "cv28:cbg"]);
  });
});

describe("R36 6. the readers' finer points (mutation-found gaps)", () => {
  const row = (stem: string, key: string) => {
    const r = parseCoaPdfText(text(stem));
    if (!r.ok) throw new Error(stem);
    return r.doc.potency.find((p) => p.key === key);
  };

  it("Template 6.0/7.0 'LoD / LoQ' column: the LoQ (second number) is kept, never the LoD", () => {
    // cv00 prints "cbc ND ND N/A N/A 0.022 / 0.044"; cv28 "cbg <LOQ <LOQ N/A N/A 0.023 / 0.045"
    expect(text("cv00")).toContain("cbc ND ND N/A N/A 0.022 / 0.044");
    expect(row("cv00", "cbc")?.loqPct).toBe(0.044);
    expect(row("cv00", "d9-thc")?.loqPct).toBe(0.022);
    expect(text("cv28")).toContain("cbg <LOQ <LOQ N/A N/A 0.023 / 0.045");
    expect(row("cv28", "cbg")?.loqPct).toBe(0.045);
  });

  it("Testing Technologies totals are cross-checked: the real ones pass, a printed Total THC 0.3 off fails", () => {
    for (const stem of ["cv31", "cv32", "cv33", "cv34"]) {
      const r = parseCoaPdfText(text(stem));
      if (!r.ok) throw new Error(stem);
      expect(r.doc.checks.length, stem).toBe(2);
      expect(r.doc.checks.every((c) => c.ok), stem).toBe(true);
    }
    expect(text("cv31")).toContain("Total THC 23.1 %");
    // 0.9 + 0.877 x 25.3 = 23.088; the printed one-decimal value may be off by the rounding only
    for (const [printed, ok] of [["23.1", true], ["23.2", true], ["23.4", false], ["22.8", false]] as const) {
      const r = parseCoaPdfText(text("cv31").replace("Total THC 23.1 %", `Total THC ${printed} %`));
      if (!r.ok) throw new Error("cv31 tampered");
      expect(r.doc.checks.find((c) => c.what.startsWith("total-thc"))?.ok, printed).toBe(ok);
    }
  });

  it("Testing Technologies is detected only with its results table header", () => {
    expect(detectCoaTemplate(text("cv31"))).toBe("testing-technologies");
    expect(detectCoaTemplate(text("cv31").replace(/Test Results I-502 Limits Status Method/g, "Results"))).toBeNull();
    expect(detectCoaTemplate("Testing Technologies CERTIFICATE OF ANALYSIS D9-THC 0.9 %")).toBeNull();
  });
});
