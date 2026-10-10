/**
 * tests/compliance/r39-ach-esign.test.ts  (R39 S6)
 *
 * The e-sign PURE layer: the pinned form terms, the E-SIGN disclosure, the
 * record and certificate text, and the PDF they become. The PDF is READ BACK
 * with unpdf (the same pdf.js the app already uses) so the test proves what a
 * reader actually sees, not what we meant to write.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";

import { ACH_E_TERMS, ACH_E_TERMS_SHA256 } from "@/lib/payments/ach-esign-terms";
import {
  ESIGN_CONSENT_STATEMENT,
  ESIGN_DISCLOSURE,
  ESIGN_DISCLOSURE_VERSION,
  ESIGN_INTENT_STATEMENT,
  __runAchEsignCoreTests,
  canonicalJson,
  certificateLines,
  disclosureBody,
  recordLines,
  type CertificateInput,
  type RecordInput,
} from "@/lib/payments/ach-esign-core";
import { __runPdfTextCoreTests, buildTextPdf } from "@/lib/payments/pdf-text-core";

const ROOT = join(__dirname, "..", "..");
const sha = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");

const REC: RecordInput = {
  employeeLegalName: "Jane Q Public",
  employeeId: "11111111-2222-3333-4444-555555555555",
  accounts: [
    { bankName: "Kitsap Credit Union", routing: "021000021", account: "000123456789", accountType: "checking", rule: { kind: "fixed", cents: 25000 } },
    { bankName: "Timberland Bank", routing: "011000015", account: "98765432", accountType: "savings", rule: { kind: "remainder" } },
  ],
  signedAtIso: "2026-01-16T05:30:00.000Z", // 2026-01-15 21:30 Pacific: the date must be the 15th
  sessionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
};

const CERT: CertificateInput = {
  sessionId: REC.sessionId,
  employeeLegalName: REC.employeeLegalName,
  employeeId: REC.employeeId,
  startedBy: { name: "Michael Lyman", email: "michael@greenwaymarijuana.com" },
  startedAtIso: "2026-01-16T05:10:00.000Z",
  idCheck: { type: "wa_dl_id", detail: "1234 exp 2029-05-01" },
  disclosureSha256: sha(canonicalJson(disclosureBody())),
  consentedAtIso: "2026-01-16T05:20:00.000Z",
  emailMasked: "ja***@example.com",
  codeSentAtIso: "2026-01-16T05:15:00.000Z",
  codeVerifiedAtIso: "2026-01-16T05:18:00.000Z",
  codeAttempts: 1,
  signedAtIso: REC.signedAtIso,
  typedSignature: "Jane Q Public",
  ip: "203.0.113.5",
  userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)",
  recordSha256: "f".repeat(64),
  recordBytes: 12345,
  accountsLast4: ["6789", "5432"],
};

async function readBack(bytes: Uint8Array): Promise<{ pages: number; text: string }> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  return { pages: totalPages, text: (text as string).replace(/\s+/g, " ") };
}
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

describe("pinned form terms", () => {
  it("ACH_E_TERMS_SHA256 is the sha256 of the canonical JSON of ACH_E_TERMS", () => {
    expect(sha(canonicalJson(ACH_E_TERMS))).toBe(ACH_E_TERMS_SHA256);
  });

  it("the shape is the form's: 6 WAC lines, 44 term paragraphs of which 17 headings, an acknowledgment", () => {
    expect(ACH_E_TERMS.formId).toBe("GW-ACH-E");
    expect(ACH_E_TERMS.wac).toHaveLength(6);
    expect(ACH_E_TERMS.terms).toHaveLength(44);
    expect(ACH_E_TERMS.terms.filter((t) => t.k === "h")).toHaveLength(17);
    expect(ACH_E_TERMS.acknowledgment).toMatch(/^By signing, I confirm/);
  });

  it("the verbatim check against the paper form source ran on THESE terms and passed every paragraph", () => {
    const log = readFileSync(join(ROOT, "scripts/r39/verify-esign-terms.last.log"), "utf8");
    expect(log).toContain(`terms sha256 (pinned): ${ACH_E_TERMS_SHA256}`);
    const n = ACH_E_TERMS.wac.length + ACH_E_TERMS.terms.length + 1;
    expect(log).toContain(`paragraphs: ${n} checked, ${n} found verbatim, 0 missing`);
    expect(log).toContain("form id/rev line in source: True");
    expect(log.trim().endsWith("TERMS VERBATIM: PASS")).toBe(true);
  });
});

describe("E-SIGN 15 U.S.C. 7001(c)(1) disclosure", () => {
  const by = (c: string) => ESIGN_DISCLOSURE.filter((p) => p.clause === c).map((p) => p.text).join(" ");

  it("covers every required clause, each exactly once", () => {
    const clauses = ESIGN_DISCLOSURE.map((p) => p.clause);
    expect([...clauses].sort()).toEqual(["B.i.I", "B.i.II", "B.ii", "B.iii", "B.iv", "C.i", "C.ii", "intro"].sort());
  });

  it("(B)(i)(I) a paper option, at no charge", () => {
    expect(by("B.i.I")).toMatch(/paper form/i);
    expect(by("B.i.I")).toMatch(/no charge/i);
  });
  it("(B)(i)(II) right to withdraw, its conditions, consequences and fees", () => {
    expect(by("B.i.II")).toMatch(/withdraw/i);
    expect(by("B.i.II")).toMatch(/no fee/i);
    expect(by("B.i.II")).toMatch(/paper check/i); // the consequence when no signed form is in effect
  });
  it("(B)(ii) scope: this one authorization only", () => {
    expect(by("B.ii")).toMatch(/only to this one direct deposit authorization/i);
  });
  it("(B)(iii) the procedure to withdraw and to update contact information", () => {
    expect(by("B.iii")).toMatch(/withdraw/i);
    expect(by("B.iii")).toMatch(/email/i);
  });
  it("(B)(iv) how to get a paper copy, and whether there is a fee", () => {
    expect(by("B.iv")).toMatch(/paper copy/i);
    expect(by("B.iv")).toMatch(/free of charge/i);
  });
  it("(C)(i) the hardware and software needed", () => {
    expect(by("C.i")).toMatch(/browser/i);
    expect(by("C.i")).toMatch(/PDF/);
  });
  it("(C)(ii) consent in a way that shows access (the emailed code)", () => {
    expect(by("C.ii")).toMatch(/6-digit code/);
    expect(by("C.ii")).toMatch(/10 minutes/);
  });
  it("the disclosure hash changes if any word changes (so the stored hash proves which text was shown)", () => {
    const h = sha(canonicalJson(disclosureBody()));
    const tampered = { ...disclosureBody(), consent: ESIGN_CONSENT_STATEMENT + " " };
    expect(sha(canonicalJson(tampered))).not.toBe(h);
    expect(disclosureBody().version).toBe(ESIGN_DISCLOSURE_VERSION);
  });
});

describe("record and certificate, read back from the PDF", () => {
  it("both pure self-test suites pass", () => {
    expect(__runPdfTextCoreTests()).toEqual(expect.objectContaining({ failed: 0 }));
    expect(__runAchEsignCoreTests()).toEqual(expect.objectContaining({ failed: 0 }));
  });

  it("the record PDF carries the signature, the full numbers, the Pacific date and EVERY term", async () => {
    const bytes = buildTextPdf({ title: "GW-ACH-E e-signed", createdAtIso: REC.signedAtIso, lines: recordLines(REC), footer: "GW-ACH-E e-signed" });
    const { pages, text } = await readBack(bytes);
    expect(pages).toBeGreaterThanOrEqual(2);
    expect(text).toContain("/s/ Jane Q Public");
    expect(text).toContain("021000021");
    expect(text).toContain("000123456789"); // leading zeros kept
    expect(text).toContain("$250.00 each payday");
    expect(text).toContain("Remainder of net pay");
    expect(text).toContain("2026-01-15");
    expect(text).toContain(ACH_E_TERMS_SHA256);
    expect(text).toContain(`Page 1 of ${pages}`);
    // Every paragraph, verbatim modulo line wrapping (headings are printed in capitals).
    const flat = squash(text);
    for (const t of ACH_E_TERMS.terms) {
      const want = squash(t.k === "h" ? t.t.toUpperCase() : t.t);
      expect(flat.includes(want), want.slice(0, 60)).toBe(true);
    }
    expect(flat).toContain(squash(ACH_E_TERMS.acknowledgment));
    expect(flat).toContain(squash(ESIGN_INTENT_STATEMENT));
  });

  it("the certificate PDF carries the evidence and NO full bank number", async () => {
    const bytes = buildTextPdf({ title: "GW-ACH-E certificate", createdAtIso: CERT.signedAtIso, lines: certificateLines(CERT), footer: "certificate" });
    const { text } = await readBack(bytes);
    const flat = squash(text);
    for (const want of [CERT.recordSha256, ACH_E_TERMS_SHA256, CERT.disclosureSha256, "203.0.113.5", "ja***@example.com", "Michael Lyman", "1234 exp 2029-05-01", "6789, 5432", "/s/ Jane Q Public", "7001(c)", "RCW 1.80.080"]) {
      expect(flat, want).toContain(want);
    }
    expect(flat).toContain(squash(ESIGN_CONSENT_STATEMENT));
    for (const secret of ["021000021", "011000015", "000123456789", "123456789", "98765432"]) {
      expect(flat.includes(secret), secret).toBe(false);
    }
  });

  it("the same input gives the same bytes (the stored SHA-256 can be re-derived)", () => {
    const a = buildTextPdf({ title: "x", createdAtIso: REC.signedAtIso, lines: recordLines(REC), footer: "f" });
    const b = buildTextPdf({ title: "x", createdAtIso: REC.signedAtIso, lines: recordLines(REC), footer: "f" });
    expect(sha(a)).toBe(sha(b));
    const c = buildTextPdf({ title: "x", createdAtIso: REC.signedAtIso, lines: recordLines({ ...REC, employeeLegalName: "Jane Q Publik" }), footer: "f" });
    expect(sha(c)).not.toBe(sha(a));
  });
});
