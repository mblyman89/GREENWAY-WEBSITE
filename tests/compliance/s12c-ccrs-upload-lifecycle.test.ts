/**
 * S-12c (CCRS Bible v2): the upload lifecycle.
 *
 * Why this matters to the license: from S-12c on, what CCRS answered moves
 * the ledger. If an error CSV were tied to the wrong rows, a refused lot
 * would be believed filed (and never re-sent), or a filed lot would be
 * re-Inserted ("Duplicate External Identifier"). These tests pin:
 *   1. classifyEcho against EVERY real error CSV CCRS has returned (Sept 17
 *      run, 14 files x every probe of the same type) and the P20261005A echo
 *      against the exact file we SENT. Facts, not expectations.
 *   2. Success-email parsing against the 28 real notices of 2026-10-06.
 *   3. TS <-> SQL parity: upload groups, file states, outcome states.
 *   4. 0249 hygiene: grants, search_path, never security definer, the
 *      rollback drops functions only.
 *   5. Wiring: every action is settings.manage + audited, decisions are made
 *      on the server, PREprod zips name the PREprod portal, the panel offers
 *      exactly the buttons a state allows.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  CCRS_KNOWN_MESSAGES,
  CcrsEchoError,
  classifyEcho,
  fileActions,
  rowIdColumn,
  successEmailFileNames,
  __runCcrsOutcomeCoreTests,
  type OurRow,
} from "@/lib/compliance/ccrs-outcome-core";
import {
  CCRS_PORTAL_URLS,
  FILE_STATE_TEXT,
  OUTCOME_FINAL_STATES,
  decodeOutcome,
  matchSuccessNames,
  parseSuccessEmails,
  __runCcrsLifecycleCoreTests,
} from "@/lib/compliance/ccrs-lifecycle-core";
import { CCRS_UPLOAD_ORDER, splitCsvLine, uploadGroupOf, type CcrsRetailerFileType } from "@/lib/compliance/ccrs-batch-core";
import { outboxReadmeLines, planOutboxFiles } from "@/lib/compliance/ccrs-outbox-core";
import { CCRS_PORTAL_URL } from "@/lib/compliance/excise-payment-core";
import { CcrsFilesPanel, type PanelFile } from "@/components/admin/compliance/CcrsFilesPanel";

const ROOT = path.join(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const EV = "docs/ccrs-bible/evidence";
const MIG = read("supabase/migrations/0249_ccrs_upload_lifecycle.sql");
const RB = read("supabase/rollbacks/0249_ccrs_upload_lifecycle.rollback.sql");
const MIG47 = read("supabase/migrations/0247_ccrs_ledger.sql");

/**
 * Our rows of a CCRS file (row_no from 1, id column per type), read with the
 * RFC 4180 split: the P20261005A probe deliberately carried quoted commas.
 * Since S-09 our own files never hold a comma in any cell, so for them this
 * equals the comma split 0248 stores rows with.
 */
function rowsOf(type: CcrsRetailerFileType, csv: string): OurRow[] {
  const ccrsReaderSplit = splitCsvLine;
  const lines = csv.replace(/^\uFEFF/, "").split(/\r\n|\n/).filter((l) => l !== "");
  const hdr = ccrsReaderSplit(lines[3]);
  const at = hdr.indexOf(rowIdColumn(type));
  const op = hdr.indexOf("Operation");
  return lines.slice(4).map((l, i) => {
    const c = ccrsReaderSplit(l);
    return { rowNo: i + 1, externalId: c[at], operation: op >= 0 ? c[op] : null };
  });
}

describe("classifyEcho over the REAL 2026-09-17 error files", () => {
  const RUN = `${EV}/2026-09-17-preprod-run`;
  const verdicts = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const e of readdirSync(path.join(ROOT, RUN, "errors")).sort()) {
      const type = e.split("_")[0] as CcrsRetailerFileType;
      const echo = read(`${RUN}/errors/${e}`);
      const res: string[] = [];
      for (const t of readdirSync(path.join(ROOT, RUN, "probes")).sort()) {
        for (const f of readdirSync(path.join(ROOT, RUN, "probes", t))) {
          if (!f.startsWith(`${type}_`)) continue;
          try {
            const v = classifyEcho(type, rowsOf(type, read(`${RUN}/probes/${t}/${f}`)), echo);
            res.push(`${t}:${v.outcome}${v.rejected.length ? `[${v.rejected.map((r) => `${r.row_no}${r.uncertain ? "u" : ""}`).join(",")}]` : ""}`);
          } catch (x) {
            if (!(x instanceof CcrsEchoError)) throw x;
          }
        }
      }
      out[e] = res.join(" ");
    }
    return out;
  };

  it("every one of the 14 files gets the verdict the evidence supports, and refuses files it does not answer", () => {
    expect(verdicts()).toEqual({
      "Area__20260917T130453419.csv": "T-16:error-rows[1u] T-17:error-rows[1u]",
      "Area__20260917T130607480.csv": "T-17:error-rows[1u,2u]",
      "InventoryAdjustment__20260917T133432926.csv": "T-48-EXPECT-ERROR:error-rows[1]",
      "Inventory__20260917T131424499.csv": "T-31-EXPECT-ERROR:error-rows[1]",
      "Inventory__20260917T131646485.csv": "T-32-EXPECT-ERROR:error-rows[1]",
      "Inventory__20260917T131758060.csv": "T-30:error-rows[1u] T-33:error-rows[1u] T-34:error-rows[1u]",
      "Inventory__20260917T132131404.csv": "T-35-EXPECT-ERROR:error-rows[1u]",
      "Inventory__20260917T132728074.csv": "T-37-EXPECT-ERROR:error-rows[1]",
      "Inventory__20260917T134023354.csv": "T-54-EXPECT-ERROR:error-fatal",
      "Product__20260917T130607115.csv": "T-18-EXPECT-ERROR:error-rows[1]",
      "Sale__20260917T133244864.csv": "T-42-EXPECT-ERROR:error-rows[1]",
      "Strain_20260917T125413969.csv": "T-10:error-benign T-11:error-benign",
      "Strain_20260917T125746848.csv": "T-10:error-benign T-11:error-benign",
      "Strain_20260917T125858884.csv": "T-14-EXPECT-ERROR:error-rows[1]",
    });
  });

  it("every known message is verbatim in some real CCRS answer (none invented)", () => {
    const corpus =
      readdirSync(path.join(ROOT, RUN, "errors")).map((e) => read(`${RUN}/errors/${e}`)).join("\n") +
      read(`${EV}/P20261005A/Product__20261006T113333390.csv`);
    for (const m of CCRS_KNOWN_MESSAGES) expect(corpus.includes(m.text), m.text).toBe(true);
  });
});

describe("P20261005A: the comma-splitting echo vs the file we SENT", () => {
  const sent = read(`${EV}/P20261005A/SENT_Product_413541_20261005182936.csv`);
  const echo = read(`${EV}/P20261005A/Product__20261006T113333390.csv`);
  it("rows 1, 4, 7 refused (not ledger contradictions); the other 5 filed (U-17 closed false)", () => {
    const rows = rowsOf("Product", sent);
    expect(rows).toHaveLength(8);
    const v = classifyEcho("Product", rows, echo);
    expect(v.outcome).toBe("error-rows");
    expect(v.rejected.map((r) => r.row_no)).toEqual([1, 4, 7]);
    expect(v.rejected.every((r) => !r.uncertain)).toBe(true);
    expect(v.messages).toEqual(["Operation is invalid must be Insert, Update or Delete"]);
    expect(v.why).toMatch(/3 of 8 row\(s\) were refused; the other 5 were filed/);
  });
  it("refuses the same echo against a file with fewer rows (it answers another file)", () => {
    expect(() => classifyEcho("Product", rowsOf("Product", sent).slice(0, 2), echo)).toThrow(CcrsEchoError);
  });
});

describe("success notices, real 2026-10-06 text", () => {
  const txt = read(`${EV}/P20261006A/success-emails-2026-10-06.txt`);
  it("28 names, tokens stripped, each with its own Date Submitted (Pacific -> UTC)", () => {
    const n = parseSuccessEmails(txt);
    expect(n).toHaveLength(28);
    expect(n.map((x) => x.fileName)).toEqual(successEmailFileNames(txt));
    expect(n[0]).toEqual({ fileName: "Strain_413541_20261005182934.csv", submittedAt: "2026-10-06T18:27:36.000Z" });
    expect(n.every((x) => x.submittedAt !== null)).toBe(true);
    expect(n.every((x) => /^[A-Za-z]+_413541_\d{14}\.csv$/.test(x.fileName))).toBe(true);
  });
  it("2026-09-17 text (line-wrapped Date Submitted) parses too; a reused name counts once", () => {
    // 10 notices, but that run reused ONE stamp (20250615213000) across 23
    // probes, so they carry 6 distinct names (Inventory x3, Product x3).
    const n = parseSuccessEmails(read(`${EV}/2026-09-17-preprod-run/success-emails-2026-09-17.txt`));
    expect(n.map((x) => x.fileName.split("_")[0])).toEqual(["Strain", "Area", "Product", "Inventory", "Sale", "InventoryAdjustment"]);
    expect(n[0]).toEqual({ fileName: "Strain_413541_20250615213000.csv", submittedAt: "2026-09-17T19:52:20.000Z" });
  });
  it("only files of this env that are waiting are recorded; others are reported, never guessed", () => {
    const m = matchSuccessNames(parseSuccessEmails(txt).slice(0, 2), [
      { id: "1", fileName: "Strain_413541_20261005182934.csv", state: "uploaded", uploadedAt: "2026-10-06T18:27:30.000Z", stampAt: "2026-10-05T18:29:34Z" },
    ]);
    expect(m.record.map((r) => r.id)).toEqual(["1"]);
    expect(m.unknown).toEqual(["Area_413541_20261005182935.csv"]);
    expect(m.timeMismatch).toEqual([]);
  });
});

describe("pure self-tests", () => {
  it("outcome core + lifecycle core", () => {
    expect(() => __runCcrsOutcomeCoreTests()).not.toThrow();
    expect(() => __runCcrsLifecycleCoreTests()).not.toThrow();
  });
});

describe("TS <-> SQL parity (0249)", () => {
  it("ccrs_upload_group matches uploadGroupOf for every type", () => {
    for (const t of CCRS_UPLOAD_ORDER) {
      const g = uploadGroupOf(t);
      expect(MIG, t).toMatch(new RegExp(`when '${t}' then ${g}\\b`));
    }
  });
  it("every ccrs_files state has operator text, and fileActions only opens emitted/uploaded", () => {
    const states = /state\s+text not null default 'draft' check \(state in\s*\(([^)]*)\)/.exec(MIG47)![1].match(/'([a-z]+)'/g)!.map((s) => s.slice(1, -1));
    expect(states.sort()).toEqual(Object.keys(FILE_STATE_TEXT).sort());
    const t0 = new Date("2026-10-07T19:00:00Z");
    for (const s of states) {
      const acts = fileActions(s, t0, new Date(t0.getTime() + 61 * 60_000));
      if (s === "emitted") expect(acts).toEqual(["download", "mark-uploaded", "abandon"]);
      else if (s === "uploaded") expect(acts).toEqual(["download", "record-success", "record-error", "record-no-email"]);
      else expect(acts).toEqual(["download"]);
    }
  });
  it("the outcomes and the states they may leave are the ones 0249 writes", () => {
    const outcomes = /p_outcome not in \(([^)]*)\)/.exec(MIG)![1].match(/'([a-z-]+)'/g)!.map((s) => s.slice(1, -1));
    expect(outcomes.sort()).toEqual(Object.keys(OUTCOME_FINAL_STATES).sort());
    for (const st of new Set(Object.values(OUTCOME_FINAL_STATES).flat())) expect(MIG).toContain(`'${st}'`);
    expect(() =>
      decodeOutcome("x", "no-email", { id: "x", file_name: "f", outcome: "no-email", state: "reconciling", rows: { total: 2, rejected: 0, uncertain: 2, landed: 0 }, earlier_files_closed: 0 }),
    ).not.toThrow();
  });
  it("the 60-minute SLA is the same number in SQL and TS", () => {
    expect(MIG).toMatch(/p_at < f\.uploaded_at \+ interval '60 minutes'/);
  });
});

describe("0249 hygiene", () => {
  const CODE = MIG.replace(/--[^\n]*/g, "");
  const fns = [...MIG.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
  it("six functions, none security definer, every one pins search_path", () => {
    expect(fns).toEqual(["ccrs_upload_group", "ccrs_mark_uploaded", "ccrs_promote_rows", "ccrs_record_outcome", "ccrs_abandon_file", "ccrs_preprod_ledger_start"]);
    expect(CODE).not.toMatch(/security\s+definer/i);
    expect((CODE.match(/set search_path = public, pg_temp/g) ?? []).length).toBe(6);
    expect(CODE).not.toMatch(/create table|alter table/i);
  });
  it("revoked from public/anon/authenticated; service_role gets all six (record_outcome is invoker, so it needs promote_rows)", () => {
    for (const f of fns) expect(MIG).toMatch(new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, authenticated;`));
    for (const f of fns) expect(MIG).toMatch(new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to service_role;`));
  });
  it("rollback drops exactly those functions and touches no row", () => {
    const drops = [...RB.matchAll(/drop function if exists public\.(\w+)\(/g)].map((m) => m[1]);
    expect(drops.sort()).toEqual([...fns].sort());
    expect(RB).not.toMatch(/\b(delete from|truncate|drop table|update public)\b/i);
  });
});

describe("wiring", () => {
  const ACTIONS = read("src/app/admin/compliance/ccrs/actions.ts");
  const PAGE = read("src/app/admin/compliance/ccrs/page.tsx");
  const ROUTE = read("src/app/admin/compliance/ccrs/file/[id]/route.ts");
  const EXPORT = read("src/app/admin/reports/compliance/batch-export/route.ts");
  const STORE = read("src/lib/compliance/ccrs-ledger-store.ts");
  const NEW = ["markUploadedAction", "recordSuccessAction", "recordErrorAction", "recordNoEmailAction", "abandonFileAction", "startPreprodLedgerAction", "assignPreprodProductIdsAction"];

  const body = (name: string) => {
    const at = ACTIONS.indexOf(`export async function ${name}(`);
    const next = ACTIONS.indexOf("export async function", at + 10);
    return ACTIONS.slice(at, next === -1 ? undefined : next);
  };
  it("every S-12c action: settings.manage first, audited, revalidated", () => {
    for (const n of NEW) {
      const b = body(n);
      expect(b, n).toMatch(/^export async function \w+\(formData: FormData\): Promise<void> \{\n  const session = await requirePermission\("settings\.manage"\);/);
      expect(b, n).toContain("await recordAudit(");
      expect(b, n).toContain("revalidatePath(BASE)");
    }
  });
  it("the server decides: rows re-read + classifyEcho; PREprod keys from a server-built PREprod batch; run id validated", () => {
    expect(body("recordErrorAction")).toMatch(/fileRowsForEcho\(admin, file\.id, file\.numberRecords\)[\s\S]*classifyEcho\(file\.fileType, rows, pasted\)/);
    expect(body("recordErrorAction")).toContain("recordOutcome(admin, file.id, verdict.outcome, at, verdict.rejected, verdict.messages)");
    expect(body("assignPreprodProductIdsAction")).toMatch(/PREPROD_RUN_RE\.test\(run\)[\s\S]*buildCcrsBatch\(range\.fromISO, range\.toISO, \{ env: "preprod" \}\)[\s\S]*batch\.ledger\.unassignedProductKeys/);
    expect(body("assignPreprodProductIdsAction")).not.toMatch(/formData\.get\("keys?"\)/);
    expect(body("recordNoEmailAction")).toContain("noEmailAllowedAt(");
    expect(body("recordSuccessAction")).toContain("ccrsFilesByName(admin, env, notices.map((n) => n.fileName))");
    expect(ACTIONS).toMatch(/if \(file\.env !== env\)/);
  });
  it("the prod blue box is still prod-only", () => {
    expect(body("assignProductIdsAction")).toContain('assignProductIds(createSupabaseAdminClient(), "prod", keys');
    expect(PAGE).toContain('env === "prod" && batch.ledger.unassignedProductKeys.length > 0');
  });
  it("store: RPC answers decoded strictly; echo rows read completely or not at all", () => {
    for (const d of ["decodeMarkUploaded(fileId, data)", "decodeOutcome(fileId, outcome, data)", "decodeAbandon(fileId, data)", "decodePreprodStart(data)"]) expect(STORE).toContain(d);
    expect(STORE).toMatch(/if \(!verdict\.complete\) throw/);
  });
  it("download route serves the STORED bytes (re-hashed) with permission and audit", () => {
    expect(ROUTE).toContain("readStoredFile(createSupabaseAdminClient(), id)");
    expect(ROUTE).toContain('can(session.profile.role, "settings.manage")');
    expect(ROUTE).toContain("recordAudit(");
    expect(ROUTE).not.toMatch(/buildCcrsBatch|planOutboxFiles/);
  });
  it("page: env switch feeds the batch, the zip link, the walkthrough portal and the files panel", () => {
    expect(PAGE).toContain("const env = parseLedgerEnv(sp.env);");
    expect(PAGE).toContain("buildCcrsBatch(range.fromISO, range.toISO, { env })");
    expect(PAGE).toContain("const qs = `from=${week.start}&to=${week.end}${envQ}`;");
    expect(PAGE).toContain("portalUrl={ccrsPortalUrl(env)}");
    expect(PAGE).toContain("<CcrsFilesPanel");
    expect(EXPORT).toContain("outboxReadmeLines(planned, zipFiles.map((z) => z.name), ccrsPortalUrl(env))");
  });
});

describe("portal URLs", () => {
  it("prod is the same constant the excise module uses; PREprod is the test host", () => {
    expect(CCRS_PORTAL_URLS.prod).toBe(CCRS_PORTAL_URL);
    expect(CCRS_PORTAL_URLS.preprod).toBe("https://precannabisreporting.lcb.wa.gov/");
  });
  it("a PREprod README names the PREprod site; the default stays production", () => {
    const files = planOutboxFiles([{ type: "Strain", csv: "SubmittedBy,G\r\nSubmittedDate,10/07/2026\r\nNumberRecords,1\r\nLicenseNumber,Strain,StrainType,CreatedBy,CreatedDate\r\n413541,Blue Dream,Hybrid,G,10/07/2026\r\n" }], {
      licenseNumber: "413541",
      now: new Date("2026-10-07T19:00:00Z"),
      lastStamp: null,
    });
    const names = files.map((f) => f.fileName);
    expect(outboxReadmeLines(files, names)[0]).toContain("https://cannabisreporting.lcb.wa.gov/");
    const pre = outboxReadmeLines(files, names, CCRS_PORTAL_URLS.preprod)[0];
    expect(pre).toContain("https://precannabisreporting.lcb.wa.gov/");
    expect(pre).toContain("PREPROD TEST SITE");
  });
});

describe("CcrsFilesPanel renders exactly what a state allows", () => {
  const noop = () => {};
  const actions = { markUploaded: noop, recordSuccess: noop, recordError: noop, recordNoEmail: noop, abandon: noop, startPreprod: noop, assignPreprodIds: noop };
  const f = (over: Partial<PanelFile>): PanelFile => ({
    id: "00000000-0000-4000-8000-000000000001", fileType: "Strain", purpose: "weekly", fileName: "Strain_413541_20261007120000.csv",
    numberRecords: 2, state: "emitted", stampAt: "2026-10-07T19:00:00Z", uploadedAt: null, errorMessages: null, notes: null, ...over,
  });
  const html = (over: Record<string, unknown>) =>
    renderToStaticMarkup(
      createElement(CcrsFilesPanel, {
        env: "prod", weekKey: "2026-10-04", canEdit: true, available: true, loadError: null, files: [], issues: [], ledgerLoaded: true,
        unassignedProductCount: 0, nowISO: "2026-10-07T20:00:00.000Z", actions, ...over,
      }),
    );
  it("emitted: download, mark uploaded (Pacific now), abandon; no error box", () => {
    const h = html({ files: [f({})] });
    expect(h).toContain("Mark uploaded");
    expect(h).toContain('value="2026-10-07T13:00"');
    expect(h).toContain("Abandon");
    expect(h).toContain("/admin/compliance/ccrs/file/00000000-0000-4000-8000-000000000001");
    expect(h).not.toContain("Record error file");
  });
  it("uploaded 30 min ago: success paste + error box, no-email still locked; at 61 min it unlocks", () => {
    const up = f({ state: "uploaded", uploadedAt: "2026-10-07T19:30:00.000Z" });
    const h = html({ files: [up] });
    expect(h).toContain("Record success");
    expect(h).toContain("Record error file");
    expect(h).not.toContain("No email after 60 minutes");
    expect(h).toContain("unlocks at");
    expect(html({ files: [up], nowISO: "2026-10-07T20:31:00.000Z" })).toContain("No email after 60 minutes");
  });
  it("read-only viewer sees states but no forms", () => {
    const h = html({ canEdit: false, files: [f({}), f({ id: "00000000-0000-4000-8000-000000000002", state: "uploaded", uploadedAt: "2026-10-07T19:30:00Z" })] });
    expect(h).not.toContain("<form");
    expect(h).toContain("Download exact file");
  });
  it("PREprod: set-up steps in order; start before ids; PREprod portal named", () => {
    const h0 = html({ env: "preprod", ledgerLoaded: false });
    expect(h0).toContain("Start PREprod ledger");
    expect(h0).not.toContain("Assign PREprod ids");
    const h1 = html({ env: "preprod", ledgerLoaded: true, unassignedProductCount: 25, suggestedRun: "P20261008A" });
    expect(h1).toContain("Assign PREprod ids");
    expect(h1).toContain('value="P20261008A"');
    expect(h1).toContain("precannabisreporting.lcb.wa.gov");
    expect(html({ env: "prod" })).not.toContain("PREprod set-up");
  });
  it("refused and uncertain rows are shown with what to do", () => {
    const h = html({
      files: [f({ state: "errored", errorMessages: ["Invalid Product"] }), f({ id: "00000000-0000-4000-8000-000000000003", state: "reconciling", fileName: "Area_413541_20261007120001.csv" })],
      issues: [{ fileId: "00000000-0000-4000-8000-000000000001", severity: "error", code: "CCRS_ROW_REJECTED", message: "row 1 (X): Invalid Product" }],
    });
    expect(h).toContain("CCRS said: Invalid Product");
    expect(h).toContain("[refused] row 1 (X): Invalid Product");
    expect(h).toContain("re-sends ONLY what is not on file");
    expect(h).toContain("Service");
  });
});
