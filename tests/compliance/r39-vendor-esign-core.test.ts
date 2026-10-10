/**
 * tests/compliance/r39-vendor-esign-core.test.ts  (R39 S7)
 *
 * The vendor e-sign PURE layer: the pinned GW-ACH-V terms, the disclosure,
 * the form rules, and the record / certificate / acceptance PDFs. The PDFs
 * are READ BACK with unpdf, so the test proves what a reader sees.
 */
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";

import { ACH_V_TERMS, ACH_V_TERMS_SHA256 } from "@/lib/payments/vendor-esign-terms";
import {
  VENDOR_CONSENT_STATEMENT,
  VENDOR_ESIGN_DISCLOSURE,
  VENDOR_ESIGN_DISCLOSURE_VERSION,
  VENDOR_INTENT_STATEMENT,
  __runVendorEsignCoreTests,
  acceptanceLines,
  browserDigest,
  canonicalJson,
  inviteEmail,
  makeToken,
  parseVendorForm,
  tokenDigest,
  vendorCertificateLines,
  vendorDisclosureBody,
  vendorEsignDbErrorMessage,
  vendorOtpDigest,
  vendorRecordLines,
  type VendorCertificateInput,
} from "@/lib/payments/vendor-esign-core";
import { keyedHasher } from "@/lib/security/keyed-hash";
import { buildTextPdf } from "@/lib/payments/pdf-text-core";

const ROOT = join(__dirname, "..", "..");
const sha = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
// pdf-text-core writes WinAnsi; "§" is in it, so terms read back unchanged.
async function readBack(bytes: Uint8Array): Promise<{ pages: number; text: string }> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  return { pages: totalPages, text: squash(text as string) };
}

const FORM: Record<string, string> = {
  legal_name: "Evergreen Farms LLC", dba: "Evergreen", entity_type: "llc", vendor_kind: "producer_processor", license_no: "412345", ubi: "603 123 456",
  tin_last4: "4321", street: "1 Main St", city: "Shelton", state: "WA", zip: "98584",
  ar_contact: "Ann Lee, AR Manager", ar_phone: "3605550100", ar_email: "ar@evergreen.example", second_contact: "Bo Lee, Owner", second_phone: "(360)-555-0111", second_email: "bo@evergreen.example",
  request_type: "change", bank_name: "Timberland Bank", bank_city_state: "Hoquiam, WA", start_date: "2026-07-15", routing: "021000021", account: "000123456789", account2: "0001-2345-6789",
  account_type: "checking", name_on_account: "Evergreen Farms, LLC", remittance_email: "", notes: "Thanks", proof_kind: "voided_check",
};
const get = (m: Record<string, string>) => (k: string) => m[k];

describe("pinned GW-ACH-V terms", () => {
  it("ACH_V_TERMS_SHA256 is the sha256 of the canonical JSON of ACH_V_TERMS", () => {
    expect(sha(canonicalJson(ACH_V_TERMS))).toBe(ACH_V_TERMS_SHA256);
  });

  it("the shape is the paper form's: 5 Part 3 lines, 20 WAC lines, 22 term headings", () => {
    expect(ACH_V_TERMS.formId).toBe("GW-ACH-V");
    expect(ACH_V_TERMS.part3).toHaveLength(5);
    expect(ACH_V_TERMS.wac).toHaveLength(20);
    const heads = ACH_V_TERMS.terms.filter((t) => t.k === "h").map((t) => t.t);
    expect(heads).toHaveLength(22);
    heads.forEach((h, i) => expect(h.startsWith(`${i + 1}. `), h).toBe(true));
  });

  it("the verbatim check against the form source ran on THESE terms and passed every paragraph", () => {
    const log = readFileSync(join(ROOT, "scripts/r39/verify-vendor-esign-terms.last.log"), "utf8");
    expect(log).toContain(`terms sha256 (pinned): ${ACH_V_TERMS_SHA256}`);
    const n = 1 + ACH_V_TERMS.part3.length + ACH_V_TERMS.wac.length + 1 + ACH_V_TERMS.terms.length + 2;
    expect(log).toContain(`paragraphs: ${n} checked, ${n} found verbatim, 0 missing, 0 out of order`);
    expect(log.trim().endsWith("RESULT: PASS")).toBe(true);
  });
});

describe("keyed-hash input formats match the pinned goldens", () => {
  // r39-keyed-hash.test.ts pins these three digests for these exact inputs.
  it("token, code and browser digests are built from the exact strings the goldens use", () => {
    const tok = keyedHasher("vendorEsignToken", "fixed-test-key");
    const otp = keyedHasher("vendorEsignOtp", "fixed-test-key");
    const br = keyedHasher("vendorEsignBrowser", "fixed-test-key");
    if (!tok || !otp || !br) throw new Error("keyedHasher returned null with a key set");
    expect(tokenDigest(tok, "A".repeat(43))).toBe("8c66fb7001549ab223c381897f71d2db8cafdc317270f199fc1cc60080dec7e0");
    expect(vendorOtpDigest(otp, "I1", "123456")).toBe("52934928fbccb900b33e6867235b7f3a258cd2279653db39bd67ecd3c0c5f21f");
    expect(browserDigest(br, "I1", "BBBB")).toBe("fe1f88501e4bf47befa17a3deda58a2f305827e756b7e0687dd684fe571f8de6");
  });

  it("tokens are 256-bit base64url and decode back to the random bytes", () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 255);
    const t = makeToken(() => bytes);
    expect(Buffer.from(t, "base64url").equals(Buffer.from(bytes))).toBe(true);
    // the digest really is keyed: a different key gives a different digest
    const h1 = (s: string) => createHmac("sha256", "k1").update(s).digest("hex");
    const h2 = (s: string) => createHmac("sha256", "k2").update(s).digest("hex");
    expect(tokenDigest(h1, t)).not.toBe(tokenDigest(h2, t));
  });
});

describe("disclosure (UETA 1.80.040(2); E-SIGN 7001(c) given as good practice)", () => {
  const by = (c: string) => VENDOR_ESIGN_DISCLOSURE.filter((p) => p.clause === c).map((p) => p.text).join(" ");
  it("covers every clause exactly once", () => {
    expect(VENDOR_ESIGN_DISCLOSURE.map((p) => p.clause).sort()).toEqual(["B.i.I", "B.i.II", "B.ii", "B.iii", "B.iv", "C.i", "C.ii", "intro", "safety", "voluntary"].sort());
  });
  it("ACH stays voluntary with no discrimination (WAC 314-55-115(3)(a))", () => {
    expect(by("voluntary")).toMatch(/optional/i);
    expect(by("voluntary")).toMatch(/paper check/i);
    expect(by("voluntary")).toMatch(/no vendor is treated differently/i);
  });
  it("paper option and copy at no charge; withdrawal with no fee", () => {
    expect(by("B.i.I")).toMatch(/no charge/i);
    expect(by("B.iv")).toMatch(/free of charge/i);
    expect(by("B.i.II")).toMatch(/no fee/i);
  });
  it("the safety paragraph gives Greenway's published numbers, matching the paper form page 1", () => {
    const paper = readFileSync(join(ROOT, "src/lib/payments/vendor-esign-terms.ts"), "utf8");
    expect(paper).toContain("Greenway Marijuana, Attn: Stephen Benoit, 4851 Geiger Rd SE");
    for (const n of ["360-621-7977", "360-204-1119", "360-443-6988"]) expect(by("safety")).toContain(n);
  });
  it("the hash changes if any word changes", () => {
    const h = sha(canonicalJson(vendorDisclosureBody()));
    expect(sha(canonicalJson({ ...vendorDisclosureBody(), intent: VENDOR_INTENT_STATEMENT + "." }))).not.toBe(h);
    expect(vendorDisclosureBody().version).toBe(VENDOR_ESIGN_DISCLOSURE_VERSION);
  });
});

describe("the form", () => {
  it("normalizes every everyday format and keeps the leading zeros of the account", () => {
    const p = parseVendorForm(get(FORM), "2026-07-01");
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.bank).toEqual({ routing: "021000021", account: "000123456789", accountType: "checking" });
    expect(p.form.ar_phone).toBe("360-555-0100");
    expect(p.form.second_phone).toBe("360-555-0111");
    expect(p.form.ubi).toBe("603123456");
    expect(p.form.request_type).toBe("change");
  });

  it("the stored form JSON never contains the routing or account number", () => {
    const p = parseVendorForm(get(FORM), "2026-07-01");
    if (!p.ok) throw new Error("form refused");
    const j = JSON.stringify(p.form);
    for (const secret of ["021000021", "000123456789", "123456789"]) expect(j.includes(secret), secret).toBe(false);
  });

  it("every required field is named in the errors when the form is empty", () => {
    const p = parseVendorForm(() => "", "2026-07-01");
    expect(p.ok).toBe(false);
    if (p.ok) return;
    for (const k of ["legal_name", "entity_type", "vendor_kind", "tin_last4", "street", "city", "state", "zip", "ar_contact", "ar_phone", "ar_email", "second_contact", "second_phone", "second_email", "request_type", "bank_name", "routing", "account", "account_type", "name_on_account", "proof_kind"]) {
      expect(p.errors, k).toHaveProperty(k);
    }
  });
});

describe("record, certificate and acceptance, read back from the PDF", () => {
  const p = parseVendorForm(get(FORM), "2026-07-01");
  if (!p.ok) throw new Error("fixture form refused");
  const REC = { form: p.form, bank: p.bank, vendorId: "11111111-2222-4333-8444-555555555555", inviteId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", signerName: "Bo Lee", signerTitle: "Owner", signedAtIso: "2026-07-02T05:30:00.000Z", proof: { filename: "check.jpg", sha256: "c".repeat(64) } };

  it("the pure self-tests pass", () => {
    expect(__runVendorEsignCoreTests()).toEqual(expect.objectContaining({ failed: 0 }));
  });

  it("the record PDF carries both signatures' blocks, full numbers, the Pacific date and EVERY paragraph of the agreement", async () => {
    const read = await readBack(buildTextPdf({ title: "GW-ACH-V e-signed", createdAtIso: REC.signedAtIso, lines: vendorRecordLines(REC), footer: "ZZFOOT" }));
    const pages = read.pages;
    // A paragraph may run across a page break; drop each page's footer line so it reads on.
    const text = squash(read.text.replace(/ZZFOOT \| Page \d+ of \d+/g, " "));
    expect(read.text.match(/ZZFOOT \| Page \d+ of \d+/g)?.length).toBe(pages);
    expect(pages).toBeGreaterThanOrEqual(3);
    for (const want of ["/s/ Bo Lee", "021000021", "000123456789", "2026-07-01", ACH_V_TERMS_SHA256, "Change to existing bank information", "4321", "c".repeat(64)]) expect(text, want).toContain(want);
    const all = [ACH_V_TERMS.intro, ...ACH_V_TERMS.part3, ...ACH_V_TERMS.wac, ACH_V_TERMS.wacMeans, ACH_V_TERMS.certification, ACH_V_TERMS.acceptance, VENDOR_INTENT_STATEMENT];
    for (const t of all) expect(text.includes(squash(t)), t.slice(0, 60)).toBe(true);
    for (const t of ACH_V_TERMS.terms) {
      const want = squash(t.k === "h" ? t.t.toUpperCase() : t.t);
      expect(text.includes(want), want.slice(0, 60)).toBe(true);
    }
  });

  it("the certificate PDF carries the evidence and NO full bank number", async () => {
    const C: VendorCertificateInput = {
      inviteId: REC.inviteId, vendorId: REC.vendorId, vendorLegalName: "Evergreen Farms LLC", invitedBy: { name: "Michael Lyman", email: "michael@greenwaymarijuana.com" },
      invitedAtIso: "2026-07-01T16:00:00.000Z", emailMasked: "ar***@evergreen.example", emailOnFile: true, firstOpenedAtIso: "2026-07-01T18:00:00.000Z",
      disclosureSha256: sha(canonicalJson(vendorDisclosureBody())), codeSentAtIso: "2026-07-02T05:00:00.000Z", codeVerifiedAtIso: "2026-07-02T05:02:00.000Z", codeAttempts: 1,
      consentedAtIso: "2026-07-02T05:02:00.000Z", signedAtIso: REC.signedAtIso, signerName: "Bo Lee", signerTitle: "Owner", ip: "203.0.113.9", userAgent: "Mozilla/5.0",
      recordSha256: "f".repeat(64), recordBytes: 9999, proofSha256: "c".repeat(64), proofBytes: 12345, accountLast4: "6789", routingLast4: "0021",
    };
    const { text } = await readBack(buildTextPdf({ title: "cert", createdAtIso: C.signedAtIso, lines: vendorCertificateLines(C), footer: "cert" }));
    for (const want of [C.recordSha256, C.disclosureSha256, ACH_V_TERMS_SHA256, "203.0.113.9", "ar***@evergreen.example", "Michael Lyman", "/s/ Bo Lee", "6789", "RCW 1.80.080", "the email on Greenway's vendor record"]) expect(text, want).toContain(want);
    expect(text).toContain(squash(VENDOR_CONSENT_STATEMENT));
    for (const secret of ["021000021", "000123456789", "123456789"]) expect(text.includes(secret), secret).toBe(false);
  });

  it("the acceptance page is Greenway's Part 6 countersignature with the effective date", async () => {
    const { text } = await readBack(buildTextPdf({
      title: "acceptance", createdAtIso: "2026-07-03T20:00:00.000Z", footer: "acc",
      lines: acceptanceLines({ inviteId: REC.inviteId, vendorLegalName: "Evergreen Farms LLC", vendorSignerName: "Bo Lee", vendorSignedAtIso: REC.signedAtIso, recordSha256: "f".repeat(64), accountLast4: "6789", greenwaySigner: { name: "Stephen Benoit", title: "Admin / Manager", email: "stephen@greenwaymarijuana.com" }, acceptedAtIso: "2026-07-03T20:00:00.000Z", vault: { releasedBy: "Michael Lyman", releasedAtIso: "2026-07-03T19:00:00.000Z", mode: "dual" }, callbackNote: "Called the number on the LCB licensee list" }),
    }));
    for (const want of ["/s/ Stephen Benoit", "Effective Date (Terms 1.1): 2026-07-03", "Michael Lyman (dual)", "f".repeat(64), squash(ACH_V_TERMS.acceptance)]) expect(text, want).toContain(want);
  });
});

describe("messages", () => {
  it("the invite email is escaped, says ACH is optional, and only links to /vendor-ach/<token> over https", () => {
    const t = makeToken((n) => new Uint8Array(n).fill(7));
    const e = inviteEmail({ link: `https://www.greenwaymarijuana.com/vendor-ach/${t}`, vendorName: "A&B <Farms>", recipientName: "Ann \"AR\"", inviterName: "Michael", expiresPacific: "July 15, 2026" });
    expect(e.html).toContain("A&amp;B &lt;Farms&gt;");
    expect(e.html).not.toContain("<Farms>");
    expect(e.text).toMatch(/optional/);
    expect(() => inviteEmail({ link: `http://evil.example/vendor-ach/${t}`, vendorName: "x", recipientName: "x", inviterName: "x", expiresPacific: "x" })).toThrow();
    expect(() => inviteEmail({ link: `https://x.example/vendor-ach/${t}"><script>`, vendorName: "x", recipientName: "x", inviterName: "x", expiresPacific: "x" })).toThrow();
  });

  it("every 0262 error code has a specific staff message and a vendor message without internals", () => {
    const codes = [...readFileSync(join(ROOT, "supabase/migrations/0262_vendor_ach_esign.sql"), "utf8").matchAll(/(VENDOR_ESIGN_[A-Z_]+)/g)].map((m) => m[1]);
    const unique = [...new Set(codes)];
    expect(unique.length).toBeGreaterThanOrEqual(15);
    for (const c of unique) {
      const staff = vendorEsignDbErrorMessage(`${c}: QZX-SENTINEL`);
      const vend = vendorEsignDbErrorMessage(`${c}: QZX-SENTINEL`, "vendor");
      expect(staff.startsWith("The database refused"), c).toBe(false);
      expect(vend.includes(c) || vend.includes("QZX-SENTINEL"), c).toBe(false);
    }
  });
});
