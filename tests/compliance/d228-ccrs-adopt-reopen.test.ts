/**
 * D228 — CCRS accepted a hand-made fixed Sale file; the hub must recognise
 * its confirmation. Owner, verbatim: "can you help me apply the success
 * message so the system recognizes it".
 *
 * Spec pins:
 *   [BRIAN A29] the same data is never filed twice (so renaming cannot work:
 *               CCRS answered "Duplicate Sale for Licensee" to the renamed copy)
 *   [G L1390]   "Duplicate Sale for Licensee"
 *
 * Evidence: docs/ccrs-bible/evidence/2026-11-10-preprod/fixed/Sale_413541_20261110150000.csv
 *           (the exact bytes CCRS accepted; PRE success email, Date Submitted 11/10/2026 11:51:35 AM)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ADOPT_NAME_RE, adoptUploadTime, is0357Missing, normaliseAdoptCsv, planAdoptFile, stampFromName } from "@/lib/compliance/ccrs-adopt-core";
import { lifecycleErrorText, parseSuccessEmails } from "@/lib/compliance/ccrs-lifecycle-core";
import { sha256Utf8 } from "@/lib/compliance/ccrs-outbox-core";
import { CcrsMailPanel, type CcrsMailPanelRow } from "@/components/admin/compliance/CcrsMailPanel";

const ROOT = path.resolve(__dirname, "../..");
const SRC = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const NAME = "Sale_413541_20261110150000.csv";
const FIXED = SRC(`docs/ccrs-bible/evidence/2026-11-10-preprod/fixed/${NAME}`);
const BODY =
  "PRE The file Sale_413541_20261110150000_20261110T1151115.csv you submitted has been processed. Date Submitted: 11/10/2026 11:51:35 AM For assistance, please contact the Cannabis Examiners by e-mail at examiner@lcb.wa.gov";

describe("the real 2026-11-10 PREprod file adopts exactly as CCRS accepted it", () => {
  it("the success email names our file and gives CCRS's Date Submitted (11:51:35 AM Pacific)", () => {
    const n = parseSuccessEmails(BODY);
    expect(n).toEqual([{ fileName: NAME, submittedAt: "2026-11-10T19:51:35.000Z" }]);
  });
  it("planAdoptFile keeps the exact bytes (same sha256 as the evidence file), type, count and stamp from the name", () => {
    const p = planAdoptFile({ fileName: NAME, csv: FIXED, licenseNumber: "413541" });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.payload.content).toBe(FIXED);
    expect(p.payload.sha256).toBe("6474294cef42c91dfaae5eddddb58d749640e06bd33c80b321ed3cfdb04596b2");
    expect(p.payload.sha256).toBe(sha256Utf8(FIXED));
    expect(p.payload.file_type).toBe("Sale");
    expect(p.payload.number_records).toBe(2);
    expect(p.payload.distinct_ids).toBe(2);
    // 15:00:00 Pacific (PST on 2026-11-10) = 23:00:00Z
    expect(p.payload.stamp_at).toBe("2026-11-10T23:00:00.000Z");
  });
  it("a paste with bare LF or no final line break becomes the same bytes", () => {
    const lf = FIXED.replace(/\r\n/g, "\n").replace(/\n$/, "");
    expect(normaliseAdoptCsv(lf)).toBe(FIXED);
    const p = planAdoptFile({ fileName: NAME, csv: lf, licenseNumber: "413541" });
    expect(p.ok && p.payload.sha256).toBe("6474294cef42c91dfaae5eddddb58d749640e06bd33c80b321ed3cfdb04596b2");
  });
  it("the upload time is CCRS's Date Submitted, else the owner's Pacific time", () => {
    expect(adoptUploadTime("2026-11-10T19:51:35.000Z", "")).toBe("2026-11-10T19:51:35.000Z");
    expect(adoptUploadTime(null, "2026-11-10T11:51")).toBe("2026-11-10T19:51:00.000Z");
    expect(adoptUploadTime(null, "")).toBeNull();
  });
});

describe("planAdoptFile refuses what is not provably the file CCRS saw", () => {
  it("a name with the CCRS receipt token, another type, or another license", () => {
    expect(planAdoptFile({ fileName: "Sale_413541_20261110150000_20261110T1151115.csv", csv: FIXED, licenseNumber: "413541" }).ok).toBe(false);
    expect(planAdoptFile({ fileName: "Inventory_413541_20261110150000.csv", csv: FIXED, licenseNumber: "413541" }).ok).toBe(false);
    const other = planAdoptFile({ fileName: "Sale_999999_20261110150000.csv", csv: FIXED, licenseNumber: "413541" });
    expect(other.ok).toBe(false);
    expect(!other.ok && other.errors.join(" ")).toMatch(/license 999999/);
  });
  it("a row of another licensee, a wrong NumberRecords, no data rows, no license set", () => {
    expect(planAdoptFile({ fileName: NAME, csv: FIXED.replace("\r\n413541,", "\r\n999999,"), licenseNumber: "413541" }).ok).toBe(false);
    expect(planAdoptFile({ fileName: NAME, csv: FIXED.replace("NumberRecords,2", "NumberRecords,3"), licenseNumber: "413541" }).ok).toBe(false);
    const head = FIXED.split("\r\n").slice(0, 4).join("\r\n").replace("NumberRecords,2", "NumberRecords,0") + "\r\n";
    expect(planAdoptFile({ fileName: NAME, csv: head, licenseNumber: "413541" }).ok).toBe(false);
    expect(planAdoptFile({ fileName: NAME, csv: FIXED, licenseNumber: "" }).ok).toBe(false);
  });
  it("a stamp that is not a real Pacific time", () => {
    expect(stampFromName("Sale_413541_20261310150000.csv")).toBeNull();
    expect(ADOPT_NAME_RE.test(NAME)).toBe(true);
  });
  it("PostgREST unknown-function answers read as migration 0357 missing", () => {
    expect(is0357Missing({ code: "PGRST202", message: "Could not find the function public.ccrs_reopen_mail" })).toBe(true);
    expect(is0357Missing({ code: "P0001", message: "CCRS_ADOPT_NAME: x" })).toBe(false);
  });
  it("every 0357 refusal has plain-English operator text", () => {
    for (const code of ["CCRS_MAIL_REOPEN_REASON", "CCRS_MAIL_REOPEN_STATE", "CCRS_ADOPT_NAME", "CCRS_ADOPT_TIME", "CCRS_ADOPT_ALREADY_STORED", "CCRS_ADOPT_REASON"]) {
      expect(lifecycleErrorText(`${code}: detail`), code).not.toBe(`${code}: detail`);
    }
  });
});

describe("migration 0357", () => {
  const MIG = SRC("supabase/migrations/0357_ccrs_adopt_and_reopen.sql");
  const RB = SRC("supabase/rollbacks/0357_ccrs_adopt_and_reopen.rollback.sql");
  const PGC = SRC("scripts/recon/ccrs-adopt-reopen-0357-pg-check.sql");
  it("only a dismissed email may return to new, and only with a new reopen stamp and a longer note; applied stays final", () => {
    expect(MIG).toMatch(/old\.state = 'dismissed' and new\.state = 'new'\s+and new\.reopened_at is not null and new\.reopened_at is distinct from old\.reopened_at/);
    expect(MIG).toMatch(/raise exception 'CCRS_MAIL_HANDLED/);
    expect(MIG).toMatch(/CCRS_MAIL_KEPT/);
    expect(MIG).toMatch(/CCRS_MAIL_IMMUTABLE: a received CCRS email is kept as received/);
    expect(MIG).toMatch(/CCRS_MAIL_IMMUTABLE: the reopen history of a CCRS email is append only/);
  });
  it("reopen and adopt need a 10+ character reason; adopt reuses mark_uploaded and the 0248 byte checks", () => {
    expect(MIG).toMatch(/length\(trim\(coalesce\(p_reason, ''\)\)\) < 10[\s\S]*CCRS_MAIL_REOPEN_REASON/);
    expect(MIG).toMatch(/CCRS_ADOPT_REASON/);
    expect(MIG).toContain("v_up := public.ccrs_mark_uploaded(v_id, now(), p_by, p_reason);");
    for (const c of ["CCRS_HASH_MISMATCH", "CCRS_NOT_CRLF_TERMINATED", "CCRS_SHORT_HEADER", "CCRS_RECORD_COUNT_MISMATCH", "CCRS_ROW_WIDTH", "CCRS_ADOPT_ALREADY_STORED"]) {
      expect(MIG, c).toContain(c);
    }
    expect(MIG).toMatch(/'ADOPTED hand-made file: /);
  });
  it("service role only, not security definer, search_path pinned, comments editor-safe", () => {
    expect(MIG).not.toMatch(/(?<!not )security definer/i);
    expect(MIG.match(/set search_path = public, pg_temp/g)?.length).toBe(3);
    expect(MIG).toContain("revoke all on function public.ccrs_reopen_mail(uuid, uuid, text) from public, anon, authenticated;");
    expect(MIG).toContain("grant execute on function public.ccrs_reopen_mail(uuid, uuid, text) to service_role;");
    expect(MIG).toContain("revoke all on function public.ccrs_adopt_handmade_file(text, jsonb, timestamptz, uuid, text) from public, anon, authenticated;");
    expect(MIG).toContain("grant execute on function public.ccrs_adopt_handmade_file(text, jsonb, timestamptz, uuid, text) to service_role;");
    for (const line of MIG.split("\n").filter((l) => l.trim().startsWith("--"))) {
      expect(line, line).not.toMatch(/['’;]/);
    }
  });
  it("rollback restores the 0282 guard and keeps the history columns; the pg-check runs after every CI apply", async () => {
    expect(RB).toContain("drop function if exists public.ccrs_adopt_handmade_file(text, jsonb, timestamptz, uuid, text);");
    expect(RB).toContain("drop function if exists public.ccrs_reopen_mail(uuid, uuid, text);");
    expect(RB).toMatch(/raise exception 'CCRS_MAIL_HANDLED: this email was already %', old\.state;/);
    expect(RB).not.toMatch(/drop column/i);
    expect(PGC).toContain("CCRS 0357 CHECK PASSED");
    const { POST_APPLY_CHECKS } = await import("../../scripts/compliance/verify-migrations-execute");
    expect(POST_APPLY_CHECKS).toContainEqual({ file: "scripts/recon/ccrs-adopt-reopen-0357-pg-check.sql", mustPrint: "CCRS 0357 CHECK PASSED" });
    // 0282 pg-check still proves the bare reopen of an applied email is refused
    expect(SRC("scripts/recon/ccrs-mail-0282-pg-check.sql")).toContain("set state = 'new', handled_at = null where id = %L$q$, id1), 'CCRS_MAIL_HANDLED'");
    expect(SRC("docs/MIGRATIONS_TO_RUN.md")).toContain("0357_ccrs_adopt_and_reopen.sql");
  });
});

describe("server actions", () => {
  const MAIL = SRC("src/app/admin/compliance/ccrs/mail-actions.ts");
  const fn = (name: string) => MAIL.slice(MAIL.indexOf(`export async function ${name}`)).split("\nexport async function ")[0];
  it("reopen: settings.manage, dismissed only, reason, audited", () => {
    const f = fn("reopenCcrsMailAction");
    expect(f).toContain('requirePermission("settings.manage")');
    expect(f).toContain('mail.state !== "dismissed"');
    expect(f).toContain("reopenCcrsMail(admin, mail.id, session.profile.id, reason)");
    expect(f).toContain('action: "ccrs.mail.reopened"');
  });
  it("adopt: the name comes from the stored email, an outbox file is never adopted, bytes checked, audited, then the normal apply", () => {
    const f = fn("adoptHandmadeFileAction");
    expect(f).toContain("parseSuccessEmails(mail.body_text)");
    expect(f).toContain("ccrsFilesByName(admin, env, [notice.fileName])");
    expect(f).toContain("if (known.length > 0)");
    expect(f).toContain("planAdoptFile({ fileName: notice.fileName, csv, licenseNumber: license.licenseNumber })");
    expect(f).toContain("adoptUploadTime(notice.submittedAt,");
    expect(f).toContain('action: "ccrs.file.adopted_handmade"');
    expect(f).toContain("applySuccessMail(admin, session, mail, env, true)");
    expect(f.indexOf("planAdoptFile(")).toBeLessThan(f.indexOf("adoptHandmadeFile(admin"));
    expect(f.indexOf("adoptHandmadeFile(admin")).toBeLessThan(f.indexOf("applySuccessMail("));
    // loadMail refuses anything but a waiting email
    expect(f).toContain("await loadMail(formData)");
  });
  it("the page wires both actions into the email panel", () => {
    const PAGE = SRC("src/app/admin/compliance/ccrs/page.tsx");
    expect(PAGE).toContain("reopen: reopenCcrsMailAction,");
    expect(PAGE).toContain("adopt: adoptHandmadeFileAction,");
  });
});

describe("email panel", () => {
  const noop = async () => {};
  const base = {
    available: true,
    loadError: null,
    setup: { configured: true as const, mode: "service-account", mailbox: "m@x" },
    heartbeat: null,
    uploadedFiles: [],
    canEdit: true,
    weekKey: "W-2026-11-08",
    nowISO: "2026-11-10T21:00:00.000Z",
    env: "preprod" as const,
    actions: { poll: noop, applySuccess: noop, applyError: noop, dismiss: noop, reopen: noop, adopt: noop },
  };
  const row = (over: Partial<CcrsMailPanelRow>): CcrsMailPanelRow => ({
    id: "d3f56f1b-39a8-4425-8dfd-f7d8472276d5",
    gmail_id: "1a1c7045028db92c",
    received_at: "2026-11-10T19:52:00.000Z",
    subject: "PRE: CCRS Processing Successful",
    kind: "success",
    env: "preprod",
    env_verified: true,
    auth: "aligned-pass",
    in_spam: false,
    analysis: { successes: [{ fileName: NAME, submittedAt: "2026-11-10T19:51:35.000Z" }], needsHuman: [] },
    state: "new",
    handled_note: null,
    ...over,
  });
  const html = (rows: CcrsMailPanelRow[], actions = base.actions) => renderToStaticMarkup(createElement(CcrsMailPanel, { ...base, actions, rows }));
  it("a waiting confirmation offers adoption with a file input, a reason, and the page env", () => {
    const h = html([row({})]);
    expect(h).toContain('data-testid="ccrs-mail-adopt"');
    expect(h).toContain('name="csv_file"');
    expect(h).toMatch(/<input required="" minLength="10" placeholder="Why \(10\+ characters, saved on the file\)"[^>]*name="reason"/);
    expect(h).toContain("Adopt the file and apply");
    // CCRS gave the time, so no time box
    expect(h).not.toContain('name="uploaded_at"');
  });
  it("a set-aside email has Reopen in the Handled list; an applied one does not", () => {
    const h = html([row({ state: "dismissed", handled_note: "not an outbox file" }), row({ id: "2345db48-c5ab-4252-8cae-c84e00e2b827", state: "applied" })]);
    expect(h.split('data-testid="ccrs-mail-reopen"').length - 1).toBe(1);
    expect(h).toContain("Reopen");
  });
  it("without the new actions the panel renders as before (older callers)", () => {
    const { reopen: _r, adopt: _a, ...old } = base.actions;
    void _r;
    void _a;
    const h = html([row({}), row({ id: "x", state: "dismissed" })], old as typeof base.actions);
    expect(h).not.toContain("ccrs-mail-adopt");
    expect(h).not.toContain("ccrs-mail-reopen");
  });
});
