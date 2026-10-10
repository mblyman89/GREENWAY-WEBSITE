/**
 * R39 S5 — drop-only document intake + blind re-key.
 * Pins ach-document-intake-core to the 0258 SQL so limits never drift, and
 * pins the AcroForm field names to the ones read from our real fillable PDFs
 * (Greenway-*-FILLABLE.pdf, read with unpdf getFieldObjects during S5).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  __runAchDocumentIntakeTests,
  acceptChecks,
  canDropDocuments,
  canReviewDocuments,
  checkSignedOn,
  draftIsUsable,
  entryFromForm,
  last4,
  planAccountRows,
  validateRekeyEntry,
  ALLOWED_EXTS,
  canMoveIntake,
  checkDocumentUpload,
  checkOriginalFilename,
  DOC_KINDS,
  DOC_MIME_TYPES,
  draftFromAcroForm,
  draftFromParsedText,
  EMPTY_DRAFT,
  INTAKE_EVENTS,
  INTAKE_STATUSES,
  MAX_DOC_BYTES,
  parseAmountRule,
  planDocumentPath,
  rekeyStep,
  rekeyVerdict,
  fingerprintEntry,
  parseFingerprint,
  sniffDocMime,
  STORAGE_EXT,
  UPLOADABLE_DOC_KINDS,
  type BankDraft,
  type EntryFingerprint,
  type IntakeStatus,
  type RekeyAccount,
} from "@/lib/payments/ach-document-intake-core";

const SQL = readFileSync(join(process.cwd(), "supabase/migrations/0258_ach_authorizations.sql"), "utf8");
const flat = SQL.replace(/\s+/g, " ");
const RTN = "021000021"; // passes the ABA check digit
const PAYEE = "1b4e28ba-2fa1-41d2-883f-0016d3cca427";
const FILE = "6f1c0c9e-8f3a-4d2b-9a1e-2b7c3d4e5f60";

const enc = (s: string) => new TextEncoder().encode(s);
const PDF = enc("%PDF-1.7\n%\u00e2\u00e3\n1 0 obj");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 0]);
function heic(major: string, compat: string[]): Uint8Array {
  const body = enc(`ftyp${major}\0\0\0\0${compat.join("")}`);
  return new Uint8Array([0, 0, 0, 4 + body.length, ...body, 0, 0, 0, 8, ...enc("meta")]);
}

describe("R39 S5 ach-document-intake-core self-tests", () => {
  it("all pass", () => {
    const r = __runAchDocumentIntakeTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(105);
  });
});

describe("pinned to 0258", () => {
  it("size limit is the byte_size CHECK", () => {
    expect(flat).toContain("byte_size bigint not null check (byte_size > 0 and byte_size <= 26214400)");
    expect(MAX_DOC_BYTES).toBe(26214400);
  });
  it("mime list is the mime_type CHECK, in order", () => {
    const m = /mime_type text not null check \(mime_type in \(([^)]*)\)\)/.exec(flat);
    expect(m).not.toBeNull();
    expect(m![1].split(",").map((s) => s.trim().replace(/'/g, ""))).toEqual([...DOC_MIME_TYPES]);
  });
  it("kinds are the kind CHECK", () => {
    const m = /kind text not null check \(kind in \(([^)]*)\)\)/.exec(flat);
    expect(m![1].split(",").map((s) => s.trim().replace(/'/g, ""))).toEqual([...DOC_KINDS]);
  });
  it("intake statuses are the intake_status CHECK", () => {
    const m = /intake_status text not null default 'received' check \(intake_status in \(([^)]*)\)\)/.exec(flat);
    expect(m![1].split(",").map((s) => s.trim().replace(/'/g, ""))).toEqual([...INTAKE_STATUSES]);
  });
  it("storage path, sha and event-kind rules", () => {
    expect(flat).toContain("storage_path text not null unique check (storage_path like 'ach-docs/%')");
    expect(flat).toContain("sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$')");
    expect(flat).toContain("event_kind text not null check (event_kind ~ '^[a-z][a-z_]{2,48}$')");
    for (const k of Object.values(INTAKE_EVENTS)) expect(k).toMatch(/^[a-z][a-z_]{2,48}$/);
  });
  it("managers may only insert document_dropped events and received/unlinked documents", () => {
    expect(flat).toContain("(public.is_manager() and event_kind = 'document_dropped' and actor_id = auth.uid())");
    expect(INTAKE_EVENTS.dropped).toBe("document_dropped");
    expect(flat).toContain("intake_status = 'received' and authorization_id is null and archived_at is null and uploaded_by = auth.uid()");
  });
  it("bucket is private, admins read, managers drop", () => {
    expect(flat).toContain("values ('ach-docs', 'ach-docs', false)");
    expect(flat).toContain("for select using (bucket_id = 'ach-docs' and public.is_admin())");
    expect(flat).toContain("for insert with check (bucket_id = 'ach-docs' and public.is_manager())");
  });
  it("e-sign certificates cannot be uploaded by a person", () => {
    expect(UPLOADABLE_DOC_KINDS).not.toContain("esign_certificate");
    expect([...UPLOADABLE_DOC_KINDS].sort()).toEqual(DOC_KINDS.filter((k) => k !== "esign_certificate").sort());
  });
});

describe("signatures (bytes decide, not names)", () => {
  it("each allowed type", () => {
    expect(sniffDocMime(PDF)).toBe("application/pdf");
    expect(sniffDocMime(PNG)).toBe("image/png");
    expect(sniffDocMime(JPG)).toBe("image/jpeg");
    expect(sniffDocMime(heic("heic", ["mif1", "miaf", "MiHB", "heic"]))).toBe("image/heic");
    expect(sniffDocMime(heic("msf1", ["msf1", "hevc", "heic", "mif1", "iso8"]))).toBe("image/heic");
  });
  it("lookalikes refused", () => {
    for (const b of [enc("GIF89a"), enc("PK\u0003\u0004"), enc("MZ"), enc("<svg"), heic("avif", ["mif1", "avif"]), heic("qt  ", ["qt  "]), enc(" %PDF-1.7")]) {
      expect(sniffDocMime(b)).toBeNull();
    }
  });
  it("a heic brand OUTSIDE the ftyp box does not count", () => {
    // box length 16 = no compatible brands; "heic" appears later in the file.
    const b = new Uint8Array([0, 0, 0, 16, ...enc("ftypmif1\0\0\0\0"), ...enc("heic")]);
    expect(sniffDocMime(b)).toBeNull();
  });
  it("every sniffed type has a storage ext that is also an allowed ext", () => {
    for (const m of DOC_MIME_TYPES) expect(ALLOWED_EXTS[m]).toContain(STORAGE_EXT[m]);
  });
});

describe("upload verdict", () => {
  const up = (bytes: Uint8Array, filename: string, declaredMime = "", kind = "signed_form") =>
    checkDocumentUpload({ bytes, filename, declaredMime, kind });

  it("accepts each type with a matching name", () => {
    expect(up(PDF, "form.pdf", "application/pdf")).toMatchObject({ ok: true, mime: "application/pdf", ext: "pdf" });
    expect(up(PNG, "x.png", "image/png")).toMatchObject({ ok: true, ext: "png" });
    expect(up(JPG, "x.JPEG", "image/jpeg")).toMatchObject({ ok: true, ext: "jpg" });
    expect(up(heic("heic", ["mif1"]), "IMG_0001.HEIC", "image/heic")).toMatchObject({ ok: true, ext: "heic" });
  });
  it("exactly at the limit is fine, one byte over is refused", () => {
    const at = new Uint8Array(MAX_DOC_BYTES);
    at.set(PDF);
    expect(up(at, "big.pdf").ok).toBe(true);
    const over = new Uint8Array(MAX_DOC_BYTES + 1);
    over.set(PDF);
    const v = up(over, "big.pdf");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.refusal).toContain("25 MB");
  });
  it("refusals are sentences, never codes", () => {
    const cases = [
      up(new Uint8Array(), "a.pdf"),
      up(PDF, "a.png"),
      up(PDF, "a.pdf", "text/html"),
      up(enc("<?php echo 1;"), "a.pdf"),
      up(PDF, "a.php.pdf"),
      up(PDF, "a:b.pdf"),
      up(PDF, "a.pdf", "", "esign_certificate"),
      up(PDF, "a.pdf", "", ""),
    ];
    for (const c of cases) {
      expect(c.ok).toBe(false);
      if (!c.ok) expect(c.refusal).toMatch(/^[A-Z].*[.)]$/);
    }
  });
  it("the stored name never comes from the person's file name", () => {
    const p = planDocumentPath({ payeeType: "employee", payeeId: PAYEE.toUpperCase(), fileUuid: FILE, mime: "application/pdf" });
    expect(p).toEqual({ ok: true, objectKey: `employee/${PAYEE}/${FILE}.pdf`, storagePath: `ach-docs/employee/${PAYEE}/${FILE}.pdf` });
    if (p.ok) expect(p.storagePath.startsWith("ach-docs/")).toBe(true);
    expect(planDocumentPath({ payeeType: "employee", payeeId: PAYEE, fileUuid: "../../x", mime: "application/pdf" }).ok).toBe(false);
  });
  it("filename edge cases", () => {
    expect(checkOriginalFilename("x.pdf\u202egpj.exe").ok).toBe(true); // RLO is display-only; bytes still decide the type
    expect(checkOriginalFilename("x.pdf\u0007").ok).toBe(false);
    expect(checkOriginalFilename(".pdf").ok).toBe(true); // a dot-file "pdf" ext is still just a name
    expect(checkOriginalFilename("report.exe.pdf").ok).toBe(false);
    expect(checkOriginalFilename(null).ok).toBe(false);
  });
});

describe("intake state machine", () => {
  it("accept is reachable only from rekeyed", () => {
    for (const s of INTAKE_STATUSES) expect(canMoveIntake(s as IntakeStatus, "accepted")).toBe(s === "rekeyed");
  });
  it("accepted and rejected are terminal", () => {
    for (const to of INTAKE_STATUSES) {
      expect(canMoveIntake("accepted", to as IntakeStatus)).toBe(false);
      expect(canMoveIntake("rejected", to as IntakeStatus)).toBe(false);
    }
  });
  it("nothing goes back to received", () => {
    for (const s of INTAKE_STATUSES) expect(canMoveIntake(s as IntakeStatus, "received")).toBe(false);
  });
});

describe("AcroForm draft uses the real field names", () => {
  // Read from the real PDFs with unpdf getFieldObjects (R39 S5).
  const EMP_FIELDS = ["e_legal_name", "e_e_date", "e_rq_new", "e_rq_chg", "e_rq_can", "e_pay_dd", "e_pay_chk",
    "e_a1_bank", "e_a1_rtn", "e_a1_acct", "e_a1_chk", "e_a1_sav", "e_a1_amt", "e_a1_rem",
    "e_a3_bank", "e_a3_rtn", "e_a3_acct", "e_a3_chk", "e_a3_sav", "e_a3_amt", "e_a3_rem"];
  const VEN_FIELDS = ["v_legal_name", "v_v_date", "v_rq_new", "v_rq_chg", "v_rq_can", "v_bank", "v_rtn", "v_acct", "v_acct2", "v_at_chk", "v_at_sav"];
  const SRC = readFileSync(join(process.cwd(), "src/lib/payments/ach-document-intake-core.ts"), "utf8");
  it("every field the code reads exists on our forms", () => {
    const used = new Set<string>();
    for (const m of SRC.matchAll(/f(?:Str|On)\(f, "([a-z0-9_]+)"\)/g)) used.add(m[1]);
    for (const m of SRC.matchAll(/f(?:Str|On)\(f, `\$\{p\}([a-z]+)`\)/g)) used.add(`e_a1_${m[1]}`);
    for (const u of used) expect([...EMP_FIELDS, ...VEN_FIELDS]).toContain(u);
    expect(used.size).toBeGreaterThanOrEqual(20);
  });
  it("employee three-way split", () => {
    const d = draftFromAcroForm("employee", {
      e_legal_name: " Pat Doe ", e_e_date: "01/02/2026", e_rq_new: "Yes", e_pay_dd: "Yes",
      e_a1_bank: "A", e_a1_rtn: RTN, e_a1_acct: "111-222", e_a1_sav: "Yes", e_a1_amt: "10%",
      e_a2_bank: "B", e_a2_rtn: RTN, e_a2_acct: "333 444", e_a2_chk: "Yes", e_a2_amt: "$150.00",
      e_a3_bank: "C", e_a3_rtn: RTN, e_a3_acct: "555666", e_a3_chk: "Yes", e_a3_rem: "Yes",
    });
    expect(d.warnings).toEqual([]);
    expect(d.payeeName).toBe("Pat Doe");
    expect(d.accounts.map((a) => [a.account, a.accountType, a.rule])).toEqual([
      ["111222", "savings", { kind: "percent", basisPoints: 1000 }],
      ["333444", "checking", { kind: "fixed", cents: 15000 }],
      ["555666", "checking", { kind: "remainder" }],
    ]);
  });
  it("skipped middle row is fine; no remainder is warned", () => {
    const d = draftFromAcroForm("employee", { e_a1_rtn: RTN, e_a1_acct: "1234", e_a1_chk: "Yes", e_a1_amt: "$5" });
    expect(d.accounts).toHaveLength(1);
    expect(d.warnings.some((w) => w.includes("remainder"))).toBe(true);
  });
  it("checkbox values: Off and false are unticked; true and export values are ticked", () => {
    const base = { v_rtn: RTN, v_acct: "12345", v_acct2: "12345" };
    expect(draftFromAcroForm("vendor", { ...base, v_at_chk: "Off" }).accounts[0].accountType).toBeNull();
    expect(draftFromAcroForm("vendor", { ...base, v_at_chk: true }).accounts[0].accountType).toBe("checking");
    expect(draftFromAcroForm("vendor", { ...base, v_at_sav: "On" }).accounts[0].accountType).toBe("savings");
    expect(draftFromAcroForm("vendor", { ...base, v_at_chk: false }).accounts[0].accountType).toBeNull();
  });
  it("paper check choice is warned", () => {
    expect(draftFromAcroForm("employee", { e_pay_chk: "Yes" }).warnings.join(" ")).toContain("paper check");
  });
});

describe("amount parsing never guesses", () => {
  it.each([
    ["$200", { kind: "fixed", cents: 20000 }],
    ["200.00", { kind: "fixed", cents: 20000 }],
    ["$1,000.5", { kind: "fixed", cents: 100050 }],
    ["25%", { kind: "percent", basisPoints: 2500 }],
    ["0.5%", { kind: "percent", basisPoints: 50 }],
    ["99.99%", { kind: "percent", basisPoints: 9999 }],
  ])("%s", (t, rule) => {
    expect(parseAmountRule(t)).toEqual({ ok: true, rule });
  });
  it.each(["$", "1.234", "12,34", "-5", "100%", "0.00", "25 percent", "1e3", "$1,0000"])("refuses %s", (t) => {
    expect(parseAmountRule(t).ok).toBe(false);
  });
});

describe("gaps found by mutation testing", () => {
  it("100% and over never parse (the 2-digit regex caps it; the bp >= 10000 check is a backstop)", () => {
    for (const t of ["100%", "100.00%", "150%"]) expect(parseAmountRule(t).ok).toBe(false);
  });
  it("PDF needs all five header bytes including the dash", () => {
    expect(sniffDocMime(enc("%PDF1.7"))).toBeNull();
    expect(sniffDocMime(enc("%PDF-"))).toBe("application/pdf");
  });
  it("JPEG needs FF D8 FF, not just FF D8", () => {
    expect(sniffDocMime(new Uint8Array([0xff, 0xd8, 0x00, 0xe0]))).toBeNull();
  });
  it("hidden inner extensions are caught in any letter case", () => {
    expect(checkOriginalFilename("invoice.PHP.pdf").ok).toBe(false);
    expect(checkOriginalFilename("check.Html.jpg").ok).toBe(false);
  });
  it("amount AND remainder on one row is warned and leaves the rule empty", () => {
    const d = draftFromAcroForm("employee", { e_a1_rtn: RTN, e_a1_acct: "1234", e_a1_chk: "Yes", e_a1_amt: "$50", e_a1_rem: "Yes" });
    expect(d.warnings.some((w) => w.includes("both an amount and"))).toBe(true);
    expect(d.accounts[0].rule).toBeNull();
  });
  it("vendor account confirmation mismatch is warned", () => {
    const d = draftFromAcroForm("vendor", { v_rtn: RTN, v_acct: "12345678", v_acct2: "12345687", v_at_chk: "Yes" });
    expect(d.warnings).toContain("The account number and its confirmation on the form do not match.");
  });
  it("only check-digit-valid 9-digit runs are routing candidates", () => {
    expect(draftFromParsedText("routing 123456789").accounts).toHaveLength(0);
  });
  it("a complete draft WITH warnings still needs a second blind entry", () => {
    const d = draftFromAcroForm("employee", {
      e_pay_chk: "Yes", e_a1_rtn: RTN, e_a1_acct: "12345678", e_a1_chk: "Yes", e_a1_rem: "Yes",
    });
    expect(d.accounts.every((a) => a.routing && a.account && a.accountType && a.rule)).toBe(true);
    expect(d.warnings.length).toBeGreaterThan(0);
    const A: RekeyAccount = { routing: RTN, account: "12345678", accountType: "checking", rule: { kind: "remainder" } };
    expect(rekeyVerdict(d, [{ byId: "s", accounts: [A] }])).toMatchObject({ ok: false, need: "second_entry" });
  });
});

describe("LlamaParse text draft", () => {
  it("never fills an account number and is never usable alone", () => {
    const d = draftFromParsedText(`Pay to ... \u2446${RTN}\u2446 000123456789\u2448 1001`);
    expect(d.accounts).toHaveLength(1);
    expect(d.accounts[0].routing).toBe(RTN);
    expect(d.accounts[0].account).toBe("");
    const A: RekeyAccount = { routing: RTN, account: "000123456789", accountType: "checking", rule: { kind: "remainder" } };
    const v = rekeyVerdict(d, [{ byId: "x", accounts: [A] }]);
    expect(v.ok).toBe(false);
  });
  it("two candidates -> warning, no account", () => {
    const d = draftFromParsedText(`${RTN} and 011000015`);
    expect(d.accounts).toHaveLength(0);
    expect(d.warnings.join(" ")).toContain("More than one");
  });
});

describe("blind re-key", () => {
  const A: RekeyAccount = { routing: RTN, account: "12345678", accountType: "checking", rule: { kind: "remainder" } };
  const vendorDraft = draftFromAcroForm("vendor", { v_rtn: RTN, v_acct: "12345678", v_acct2: "12345678", v_at_chk: "Yes" });

  it("entry matching a clean form is accepted on matches_form", () => {
    expect(rekeyVerdict(vendorDraft, [{ byId: "s", accounts: [A] }])).toMatchObject({ ok: true, basis: "matches_form" });
  });
  it("spaces and dashes in the typed numbers do not matter", () => {
    const typed = { ...A, routing: "0210-00021", account: "1234 5678" };
    expect(rekeyVerdict(vendorDraft, [{ byId: "s", accounts: [typed] }]).ok).toBe(true);
  });
  it("every single-field change is caught, and only the field name is reported", () => {
    const variants: [RekeyAccount, string][] = [
      [{ ...A, routing: "011000015" }, "account 1 routing number"],
      [{ ...A, account: "12345679" }, "account 1 account number"],
      [{ ...A, accountType: "savings" }, "account 1 checking/savings"],
      [{ ...A, rule: { kind: "fixed", cents: 100 } }, "account 1 amount"],
    ];
    for (const [typed, field] of variants) {
      const v = rekeyVerdict(vendorDraft, [{ byId: "s", accounts: [typed] }]);
      expect(v.ok).toBe(false);
      if (!v.ok && v.need === "second_entry") {
        expect(v.differences).toEqual([field]);
        expect(JSON.stringify(v)).not.toContain("12345678");
      } else throw new Error("expected second_entry");
    }
  });
  it("a different number of accounts is a difference", () => {
    const v = rekeyVerdict(vendorDraft, [{ byId: "s", accounts: [A, { ...A, account: "9999" }] }]);
    expect(v.ok).toBe(false);
    if (!v.ok && v.need === "second_entry") expect(v.differences[0]).toContain("number of accounts");
  });
  it("with no usable draft, the second entry compares to the FIRST entry", () => {
    const scan = draftFromParsedText(`${RTN}`); // LlamaParse draft: never usable alone
    const v = rekeyVerdict(scan, [{ byId: "s", accounts: [A] }, { byId: "m", accounts: [A] }]);
    expect(v).toMatchObject({ ok: true, basis: "two_blind_entries" });
  });
  it("two agreeing entries that disagree with OUR signed form are refused (the form is what was authorized)", () => {
    const form = draftFromAcroForm("vendor", { v_rtn: RTN, v_acct: "77777777", v_acct2: "77777777", v_at_chk: "Yes" });
    const v = rekeyVerdict(form, [{ byId: "s", accounts: [A] }, { byId: "m", accounts: [A] }]);
    expect(v).toMatchObject({ ok: false, need: "form_disagrees", differences: ["account 1 account number"] });
    expect(JSON.stringify(v)).not.toContain("77777777");
  });
  it("a wrong first entry, then a second that matches the form, is accepted on the form", () => {
    const v = rekeyVerdict(vendorDraft, [{ byId: "s", accounts: [{ ...A, account: "12345670" }] }, { byId: "s", accounts: [A] }]);
    expect(v).toMatchObject({ ok: true, basis: "matches_form" });
  });
  it("no entries -> asks for details", () => {
    expect(rekeyVerdict(EMPTY_DRAFT, [])).toMatchObject({ ok: false, need: "fix_entry" });
  });
  it("invalid entry is fixed before any comparison", () => {
    const v = rekeyVerdict(vendorDraft, [{ byId: "s", accounts: [{ ...A, account: "12" }] }]);
    expect(v).toMatchObject({ ok: false, need: "fix_entry" });
  });
  it("more than 3 accounts refused", () => {
    const four = [1, 2, 3, 4].map((i) => ({ ...A, account: `1000${i}` }));
    expect(rekeyVerdict(EMPTY_DRAFT, [{ byId: "s", accounts: four }])).toMatchObject({ ok: false, need: "fix_entry" });
  });
});

describe("server rekeyStep agrees with rekeyVerdict (two passes, fingerprints only)", () => {
  // Real HMAC-SHA256 so the parity check uses the same primitive as the server.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHmac } = require("node:crypto") as typeof import("node:crypto");
  const hm = (x: string) => createHmac("sha256", "test-key").update(x).digest("hex");
  const A: RekeyAccount = { routing: RTN, account: "12345678", accountType: "checking", rule: { kind: "fixed", cents: 20000 } };
  const B: RekeyAccount = { routing: "011000015", account: "999999", accountType: "savings", rule: { kind: "remainder" } };
  const variants: RekeyAccount[][] = [
    [A, B],
    [{ ...A, account: "12345679" }, B],
    [A, { ...B, accountType: "checking" }],
    [{ ...A, rule: { kind: "percent", basisPoints: 2000 } }, B],
    [B],
    [{ ...A, routing: "011000015" }, B],
  ];
  const drafts: [string, BankDraft][] = [
    ["none", EMPTY_DRAFT],
    ["form", draftFromAcroForm("employee", { e_a1_rtn: RTN, e_a1_acct: "12345678", e_a1_chk: "Yes", e_a1_amt: "$200", e_a2_rtn: "011000015", e_a2_acct: "999999", e_a2_sav: "Yes", e_a2_rem: "Yes" })],
    ["scan", draftFromParsedText(RTN)],
  ];
  const summary = (v: { ok: boolean } & Record<string, unknown>) =>
    v.ok ? `ok:${v.basis}` : `${v.need}:${JSON.stringify(v.differences ?? v.errors)}`;

  it("single pass", () => {
    for (const [, d] of drafts) for (const x of variants) {
      const a = rekeyVerdict(d, [{ byId: "s", accounts: x }]);
      const b = rekeyStep(d, null, { byId: "s", accounts: x }, hm);
      expect(summary(b)).toBe(summary(a));
    }
  });
  it("two passes, every pair, every draft", () => {
    let n = 0;
    for (const [, d] of drafts) for (const x of variants) for (const y of variants) {
      const first = rekeyStep(d, null, { byId: "s", accounts: x }, hm);
      if (first.ok) continue; // accepted on pass 1, no second pass happens
      const pending = "keepPending" in first ? (first.keepPending as EntryFingerprint) : null;
      expect(pending).not.toBeNull();
      const stored = parseFingerprint(JSON.parse(JSON.stringify(pending)));
      const b = rekeyStep(d, stored, { byId: "m", accounts: y }, hm);
      const a = rekeyVerdict(d, [{ byId: "s", accounts: x }, { byId: "m", accounts: y }]);
      expect(summary(b)).toBe(summary(a));
      n += 1;
    }
    expect(n).toBeGreaterThan(60);
  });
  it("the stored fingerprint never contains a bank number", () => {
    const fp = fingerprintEntry({ byId: "s", accounts: [A, B] }, hm);
    const txt = JSON.stringify(fp);
    for (const secret of ["12345678", "999999", RTN, "011000015", "20000"]) expect(txt).not.toContain(secret);
  });
  it("a tampered pending record is ignored, not trusted", () => {
    expect(parseFingerprint({ v: 1, byId: "s", accounts: [{ routing: "1", account: "2", type: "3", amount: "4" }] })).toBeNull();
    expect(parseFingerprint({ v: 1, byId: "s", accounts: new Array(4).fill({ routing: "a".repeat(64), account: "a".repeat(64), type: "a".repeat(64), amount: "a".repeat(64) }) })).toBeNull();
    expect(parseFingerprint(null)).toBeNull();
  });
});

describe("S5 helpers: gaps found by the second mutation run", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHmac } = require("node:crypto") as typeof import("node:crypto");
  const hm = (x: string) => createHmac("sha256", "test-key").update(x).digest("hex");
  const A: RekeyAccount = { routing: RTN, account: "12345678", accountType: "checking", rule: { kind: "remainder" } };
  const full = { bankName: "", routing: RTN, account: "12345678", accountType: "checking" as const, rule: { kind: "remainder" as const } };

  it("draftIsUsable: needs a machine source, at least one account, and EVERY account complete", () => {
    expect(draftIsUsable({ ...EMPTY_DRAFT, source: "acroform", accounts: [full] })).toBe(true);
    expect(draftIsUsable({ ...EMPTY_DRAFT, source: "none", accounts: [full] })).toBe(false);
    expect(draftIsUsable({ ...EMPTY_DRAFT, source: "acroform", accounts: [] })).toBe(false);
    expect(draftIsUsable({ ...EMPTY_DRAFT, source: "acroform", accounts: [full, { ...full, account: "" }] })).toBe(false);
    expect(draftIsUsable({ ...EMPTY_DRAFT, source: "acroform", accounts: [full], warnings: ["x"] })).toBe(false);
  });
  it("fingerprints ignore spaces and dashes, like the comparison does", () => {
    const first = rekeyStep(EMPTY_DRAFT, null, { byId: "s", accounts: [{ ...A, account: "1234 5678", routing: "0210-00021" }] }, hm);
    const pending = !first.ok && "keepPending" in first ? (first.keepPending as EntryFingerprint) : null;
    expect(rekeyStep(EMPTY_DRAFT, pending, { byId: "m", accounts: [A] }, hm)).toMatchObject({ ok: true, basis: "two_blind_entries" });
  });
  it("parseFingerprint refuses an unknown version", () => {
    const fp = fingerprintEntry({ byId: "s", accounts: [A] }, hm);
    expect(parseFingerprint(fp)).not.toBeNull();
    expect(parseFingerprint({ ...fp, v: 2 })).toBeNull();
  });
  it("after a mismatch the LATEST entry becomes pending (two consecutive agreeing entries)", () => {
    const x = { byId: "s", accounts: [{ ...A, account: "11111111" }] };
    const y = { byId: "m", accounts: [A] };
    const s1 = rekeyStep(EMPTY_DRAFT, null, x, hm);
    const p1 = !s1.ok && "keepPending" in s1 ? (s1.keepPending as EntryFingerprint) : null;
    const s2 = rekeyStep(EMPTY_DRAFT, p1, y, hm);
    expect(s2.ok).toBe(false);
    const p2 = !s2.ok && "keepPending" in s2 ? (s2.keepPending as EntryFingerprint) : null;
    expect(rekeyStep(EMPTY_DRAFT, p2, { ...y, byId: "s" }, hm)).toMatchObject({ ok: true, basis: "two_blind_entries" });
  });
  it("the note says whether the same person or two people entered it", () => {
    const s1 = rekeyStep(EMPTY_DRAFT, null, { byId: "s", accounts: [A] }, hm);
    const p = !s1.ok && "keepPending" in s1 ? (s1.keepPending as EntryFingerprint) : null;
    const same = rekeyStep(EMPTY_DRAFT, p, { byId: "s", accounts: [A] }, hm);
    const diff = rekeyStep(EMPTY_DRAFT, p, { byId: "m", accounts: [A] }, hm);
    expect(same.ok && same.note).toContain("same person");
    expect(diff.ok && diff.note).toContain("different people");
  });

  const form = (o: Record<string, string>) => (k: string) => o[k] ?? "";
  it("entryFromForm: a vendor has one row; extra rows are ignored", () => {
    const r = entryFromForm(form({ a1_rtn: RTN, a1_acct: "12345678", a1_type: "checking", a2_rtn: RTN, a2_acct: "999999", a2_type: "savings", a2_how: "remainder" }), "vendor");
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.accounts).toHaveLength(1);
  });
  it("entryFromForm: percent typed without the % sign is accepted", () => {
    const r = entryFromForm(form({ a1_rtn: RTN, a1_acct: "12345678", a1_type: "checking", a1_how: "percent", a1_amt: "20" }), "employee");
    expect(r.ok && r.accounts[0].rule).toEqual({ kind: "percent", basisPoints: 2000 });
  });
  it("entryFromForm: an amount that does not match the chosen kind is refused", () => {
    const r = entryFromForm(form({ a1_rtn: RTN, a1_acct: "12345678", a1_type: "checking", a1_how: "fixed", a1_amt: "20%" }), "employee");
    expect(r.ok).toBe(false);
  });
  it("entryFromForm: a row with only a routing number is kept (so validation flags it), never silently dropped", () => {
    const r = entryFromForm(form({ a1_rtn: RTN, a1_type: "checking", a1_how: "remainder" }), "employee");
    expect(r.ok && r.accounts).toHaveLength(1);
    if (r.ok) expect(validateRekeyEntry(r.accounts).join(" ")).toContain("4-17 digits");
  });

  it("acceptChecks: duplicates (including leading zeros), remainder count, 100% total, vendor rules", () => {
    const fixed = (c: number): RekeyAccount => ({ ...A, account: `5555${c}`, rule: { kind: "fixed", cents: c } });
    expect(acceptChecks("employee", [A, { ...A, rule: { kind: "fixed", cents: 100 } }]).join(" ")).toContain("listed twice");
    expect(acceptChecks("employee", [A, { ...A, account: "0012345678", rule: { kind: "fixed", cents: 100 } }]).join(" ")).toContain("listed twice");
    expect(acceptChecks("employee", [fixed(100)]).join(" ")).toContain("remainder");
    const pct = (acct: string, bp: number): RekeyAccount => ({ ...A, account: acct, rule: { kind: "percent", basisPoints: bp } });
    expect(acceptChecks("employee", [pct("44444444", 5000), pct("33333333", 5000), A]).join(" ")).toContain("100%");
    expect(acceptChecks("employee", [pct("44444444", 4999), pct("33333333", 5000), A])).toEqual([]);
    expect(acceptChecks("vendor", [{ ...A, rule: { kind: "fixed", cents: 100 } }]).join(" ")).toContain("whole payment");
    expect(acceptChecks("vendor", [A])).toEqual([]);
  });
  it("checkSignedOn: today ok, impossible dates and pre-2000 refused", () => {
    expect(checkSignedOn("2025-06-01", "2025-06-01T12:00:00Z")).toEqual({ ok: true, date: "2025-06-01" });
    expect(checkSignedOn("2025-06-02", "2025-06-01T12:00:00Z").ok).toBe(false);
    expect(checkSignedOn("2024-02-30", "2025-06-01").ok).toBe(false);
    expect(checkSignedOn("2024-02-29", "2025-06-01").ok).toBe(true);
    expect(checkSignedOn("1999-12-31", "2025-06-01").ok).toBe(false);
    expect(checkSignedOn("2000-01-01", "2025-06-01").ok).toBe(true);
  });
  it("planAccountRows: both numbers must encrypt, HMAC must be hex, priority from 1, last-4 from the end", () => {
    const hk = () => "a".repeat(64);
    const enc = (s: string) => `encv1:x:${s.length}`;
    const two = [{ ...A, account: "1234-5678", rule: { kind: "fixed" as const, cents: 500 } }, { ...A, account: "87654321" }];
    const r = planAccountRows(two, ["Bank A", ""], { encrypt: enc, hmacKey: hk });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows.map((x) => x.priority)).toEqual([1, 2]);
      expect(r.rows[0].routing_last4).toBe(RTN.slice(-4));
      expect(r.rows[0].account_last4).toBe("5678");
      expect(r.rows[0]).toMatchObject({ rule_kind: "fixed", fixed_cents: 500, basis_points: null });
    }
    const onlyRouting = (s: string) => (s.length === 9 ? `encv1:${s}` : s);
    expect(planAccountRows([A], [""], { encrypt: onlyRouting, hmacKey: hk }).ok).toBe(false);
    expect(planAccountRows([A], [""], { encrypt: enc, hmacKey: () => "not-hex" }).ok).toBe(false);
    expect(last4("12-34")).toBe("1234");
  });
  it("only managers and up may drop documents; only owner/admin may review", () => {
    for (const r of ["owner", "admin", "manager"]) expect(canDropDocuments(r)).toBe(true);
    for (const r of ["content_editor", "budtender", "", null]) expect(canDropDocuments(r)).toBe(false);
    expect(canReviewDocuments("manager")).toBe(false);
    expect(canReviewDocuments("admin")).toBe(true);
  });
});
