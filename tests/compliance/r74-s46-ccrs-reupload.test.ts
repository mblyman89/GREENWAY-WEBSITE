/**
 * R74 S46 (Round 26): the 2026-10-25 PREprod "all files failed" upload was a
 * byte-identical re-upload of the 2026-10-20 files CCRS had already answered.
 * Pinned on the REAL bytes: every echo ties row by row to the 10/20 file, every
 * message means "already held", and the email is set aside, not applied.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CCRS_KNOWN_MESSAGES, rowIdColumn, type OurRow } from "@/lib/compliance/ccrs-outcome-core";
import { readErrorAttachment } from "@/lib/compliance/ccrs-mail-core";
import { STRATEGY_PLAYBOOK, SOURCE_QUOTES, buildCcrsStrategy } from "@/lib/compliance/ccrs-strategy-core";
import { splitCsvLine, type CcrsRetailerFileType } from "@/lib/compliance/ccrs-batch-core";
import {
  __runCcrsReuploadTests,
  duplicateEmitLine,
  matchReupload,
  planReuploadSetAside,
  type AnsweredFile,
} from "@/lib/compliance/ccrs-reupload-core";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const SENT = "docs/ccrs-bible/evidence/2026-10-20-real-upload/sent";
const ECHO = "docs/ccrs-bible/evidence/2026-10-25-reupload/errors";

function rowsOf(type: CcrsRetailerFileType, csv: string): OurRow[] {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r\n|\n/).filter((l) => l !== "");
  const hdr = splitCsvLine(lines[3]);
  const at = hdr.indexOf(rowIdColumn(type));
  const op = hdr.indexOf("Operation");
  return lines.slice(4).map((l, i) => {
    const c = splitCsvLine(l);
    return { rowNo: i + 1, externalId: c[at], operation: op >= 0 ? c[op] : null };
  });
}

const answered: AnsweredFile[] = readdirSync(path.join(ROOT, SENT)).map((f, i) => {
  const type = f.split("_")[0] as CcrsRetailerFileType;
  return {
    fileId: `f${i}`,
    fileName: f,
    env: "preprod",
    fileType: type,
    state: type === "Inventory" || type === "Strain" ? "closed" : "succeeded",
    answeredAt: "2026-10-20T17:30:00Z",
    rows: rowsOf(type, read(`${SENT}/${f}`)),
  };
});
const echoes = readdirSync(path.join(ROOT, ECHO)).sort().map((f) => readErrorAttachment(f, read(`${ECHO}/${f}`))!);

describe("R74 S46: re-upload of files CCRS already answered", () => {
  it("pure self-tests pass", () => {
    const r = __runCcrsReuploadTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(13);
  });

  it("the 10/25 upload is the 10/20 files byte for byte (the archived bytes are unchanged)", () => {
    const md5 = (p: string) => createHash("md5").update(readFileSync(path.join(ROOT, p))).digest("hex").slice(0, 8);
    expect(md5(`${SENT}/Sale_413541_20261020165833.csv`)).toBe("3fdf523d");
    expect(md5(`${SENT}/Inventory_413541_20261020165831.csv`)).toBe("61c325f0");
    expect(echoes).toHaveLength(6);
  });

  it("every real echo ties to its 10/20 file, and the whole email is set aside", () => {
    for (const e of echoes) {
      expect(e.fileType, e.filename).not.toBeNull();
      const m = matchReupload(e, answered);
      expect(m?.fileName.split("_")[0], e.filename).toBe(e.fileType);
    }
    const plan = planReuploadSetAside(echoes, answered);
    expect(plan).not.toBeNull();
    expect(plan!.matches).toHaveLength(6);
    expect(plan!.note).toContain("Sale_413541_20261020165833.csv");
  });

  it("while a file is still waiting (uploaded), Apply decides, not the re-upload check", () => {
    expect(planReuploadSetAside(echoes, answered.map((a) => ({ ...a, state: "uploaded" })))).toBeNull();
  });

  it("\"Duplicate Sale for Licensee\" is known, grounded [G L1390-L1397], and gets no examiner draft", () => {
    const k = CCRS_KNOWN_MESSAGES.find((m) => m.text === "Duplicate Sale for Licensee");
    expect(k?.cls).toBe("row-contradicts-ledger");
    expect(STRATEGY_PLAYBOOK["Duplicate Sale for Licensee"].cite).toEqual(["[G L1390-L1397]"]);
    expect(SOURCE_QUOTES.G[1390]).toBe("Duplicate Sale for Licensee");
    const sale = echoes.find((e) => e.fileType === "Sale")!;
    const s = buildCcrsStrategy([sale], { licenseNumber: "413541", licenseeName: "Greenway Marijuana" });
    expect(s.examinerDraft).toBeNull();
    expect(s.files[0].findings[0].rows).toBe(7);
  });

  it("the zip README says DO NOT UPLOAD for a served file CCRS already answered", () => {
    expect(duplicateEmitLine("succeeded", "Sale_1.csv")).toContain("DO NOT UPLOAD");
    expect(read("src/app/admin/reports/compliance/batch-export/route.ts")).toContain("duplicateEmitLine(d.state, d.file_name)");
    expect(read("src/app/admin/compliance/ccrs/mail-actions.ts")).toContain("planReuploadSetAside(errors");
  });
});
