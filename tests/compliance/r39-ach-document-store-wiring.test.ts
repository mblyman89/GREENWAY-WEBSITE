/**
 * R39 S5 — wiring invariants for the ACH document store, actions and pages.
 * These read the source (the store needs Supabase to run), so each rule is
 * pinned in a way a careless edit would trip. Each block says which owner
 * answer or control it protects.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");
const STORE = read("src/lib/payments/ach-document-store.ts");
const ACTIONS = read("src/app/admin/settings/banking/document-actions.ts");
const REVIEW = read("src/app/admin/settings/banking/documents/[id]/page.tsx");
const QUEUE = read("src/app/admin/settings/banking/documents/page.tsx");
const CARD = read("src/components/admin/ach/AchDocumentDropCard.tsx");
const EMP = read("src/app/admin/staffing/employees/[id]/page.tsx");
const VEN = read("src/app/admin/vendors/[id]/page.tsx");

/** Body of one exported async function (up to the next top-level export). */
function fn(src: string, name: string): string {
  const i = src.indexOf(`export async function ${name}(`);
  expect(i, `${name} exists`).toBeGreaterThan(-1);
  const j = src.indexOf("\nexport ", i + 10);
  return src.slice(i, j === -1 ? undefined : j);
}

describe("R39 S5 store: drop-only, evidence-grade storage", () => {
  it("is server-only and never overwrites a stored object", () => {
    expect(STORE.startsWith("/**")).toBe(true);
    expect(STORE).toContain('import "server-only";');
    expect(STORE).toMatch(/upload\(path\.objectKey, input\.bytes, \{ contentType: verdict\.mime, upsert: false \}\)/);
    expect(STORE).not.toMatch(/upsert:\s*true/);
  });
  it("checks the upload with the pure core and uses an app-generated key", () => {
    const d = fn(STORE, "dropAchDocument");
    expect(d).toContain("checkDocumentUpload(");
    expect(d).toContain("planDocumentPath(");
    expect(d).toContain("fileUuid: randomUUID()");
    expect(d.indexOf("checkDocumentUpload(")).toBeLessThan(d.indexOf(".upload("));
    // duplicate refused BEFORE a second copy is stored
    expect(d.indexOf('.eq("sha256", sha256)')).toBeLessThan(d.indexOf(".upload("));
    // a failed row removes the orphan object
    expect(d).toMatch(/if \(ins\.error \|\| !ins\.data\) \{[\s\S]*?\.remove\(\[path\.objectKey\]\)/);
  });
  it("re-checks the SHA-256 on every read and refuses a swapped file", () => {
    const d = STORE.slice(STORE.indexOf("async function downloadBytes"), STORE.indexOf("export async function documentEvents"));
    expect(d).toContain('createHash("sha256").update(bytes).digest("hex") !== doc.sha256');
    expect(d).toMatch(/return \{ ok: false, error: "The stored file no longer matches/);
  });
  it("signed links are short and only for paths this app writes", () => {
    const d = fn(STORE, "signedAchDocumentUrl");
    expect(d).toContain("objectKeyFromStoragePath(doc.storage_path)");
    expect(d).toContain("createSignedUrl(key, SIGNED_URL_SECONDS)");
  });
});

describe("R39 S5 store: no bank number in the logs", () => {
  it("event inserts carry only number-free details", () => {
    const inserts = [...STORE.matchAll(/from\("ach_authorization_events"\)\.insert\(\{([\s\S]*?)\n {2,4}\}\);/g)].map((m) => m[1]);
    expect(inserts.length).toBe(3); // dropped, extracted, rekey mismatch
    for (const body of inserts) {
      expect(body).not.toMatch(/routing(?!_fingerprints)|account(?!s)|\.rows|input\.accounts|step\.accounts/);
    }
  });
  it("the extracted event uses extractedEventDetail (+ OCR fingerprints only)", () => {
    const d = fn(STORE, "extractAchDocument");
    expect(d).toContain("extractedEventDetail(doc.id, local.draft");
    expect(d).toContain("routing_fingerprints: ocrRoutingFingerprints(candidates, hm)");
  });
  it("a mismatch stores the keyed fingerprint, never the entry", () => {
    const d = fn(STORE, "rekeyAndMaybeAccept");
    expect(d).toContain('fingerprint: "keepPending" in step ? step.keepPending : null');
    expect(d).toContain('keyedHasher("achRekeyFingerprint")');
    expect(d).toContain('keyedHasher("achAccountKey")');
    expect(d).toMatch(/if \(!fp \|\| !ak\) return \{ ok: false, error: NO_KEY \}/);
  });
  it("audit rows in the actions hold last-4 only", () => {
    const audits = [...ACTIONS.matchAll(/recordAudit\(\{([\s\S]*?)\n {2}\}\);/g)].map((m) => m[1]);
    expect(audits.length).toBe(5);
    for (const a of audits) {
      expect(a).not.toMatch(/\.routing|a\.account(?!\.replace)|accounts:\s*entry\.accounts[^.]/);
    }
    expect(ACTIONS).toContain('account_last4: entry.accounts.map((a) => a.account.replace(/\\D/g, "").slice(-4))');
  });
});

describe("R39 S5 store: accept goes through the database controls", () => {
  it("employee accept is the single 0260 function (all or nothing)", () => {
    const d = fn(STORE, "rekeyAndMaybeAccept");
    expect(d).toContain('admin.rpc("ach_intake_accept_employee"');
    expect(d).not.toMatch(/from\("ach_authorization_accounts"\)\.insert/);
    expect(d).not.toMatch(/from\("ach_authorizations"\)\.insert/);
  });
  it("vendor accept goes through the 0259 vault (on hold) before closing the document", () => {
    const d = fn(STORE, "rekeyAndMaybeAccept");
    expect(d.indexOf("saveVendorBankDetails(")).toBeGreaterThan(-1);
    expect(d.indexOf("saveVendorBankDetails(")).toBeLessThan(d.indexOf('admin.rpc("ach_intake_finish"'));
  });
  it("checks run before anything is written", () => {
    const d = fn(STORE, "rekeyAndMaybeAccept");
    const firstWrite = d.indexOf(".insert(");
    for (const c of ["canAcceptKind(doc.kind)", "acceptChecks(doc.payee_type", "checkSignedOn(", "rekeyStep("]) {
      expect(d.indexOf(c), c).toBeGreaterThan(-1);
      expect(d.indexOf(c), c).toBeLessThan(firstWrite);
    }
  });
  it("LlamaParse only on opt-in, never for our own fillable form, never cached", () => {
    const d = fn(STORE, "extractAchDocument");
    expect(d).toMatch(/if \(local\.draft\.source === "none" && input\.useLlamaParse\)/);
    expect(d).toContain("doNotCache: true");
    expect(d).toContain("mimeType: doc.mime_type");
  });
});

describe("R39 S5 actions: who may do what (owner Q1, Q2)", () => {
  it("is a server-actions file exporting only async actions", () => {
    expect(ACTIONS.startsWith('"use server";')).toBe(true);
    const exported = [...ACTIONS.matchAll(/^export (\S+ \S+ \S+)/gm)].map((m) => m[1]);
    expect(exported.every((e) => e.startsWith("async function"))).toBe(true);
    expect(exported.length).toBe(5);
  });
  it("drop: payee permission AND a drop role", () => {
    const d = fn(ACTIONS, "dropAchDocumentAction");
    expect(d).toContain('requirePermission(payeeType === "vendor" ? "vendors.manage" : "staffing.manage")');
    expect(d).toContain("canDropDocuments(session.profile.role)");
  });
  it("open, extract, rekey, reject: settings.manage (owner + admin)", () => {
    for (const n of ["openAchDocumentAction", "extractAchDocumentAction", "rekeyAchDocumentAction", "rejectAchDocumentAction"]) {
      expect(fn(ACTIONS, n), n).toContain('requirePermission("settings.manage")');
    }
  });
  it("redirects stay on our admin pages", () => {
    expect(ACTIONS).toContain("safeReturnPath(str(fd, \"return_to\")");
    expect(ACTIONS).toMatch(/function docPage\(id: string\): string \{\s*return \/\^\[0-9a-f-\]\{36\}\$\/\.test\(id\)/);
  });
});

describe("R39 S5 pages: blind re-key and least privilege", () => {
  it("review and queue pages are owner/admin only", () => {
    expect(REVIEW).toContain('await requirePermission("settings.manage");');
    expect(QUEUE).toContain('await requirePermission("settings.manage");');
  });
  it("the bank inputs are never pre-filled (blind)", () => {
    const bankInputs = [...REVIEW.matchAll(/<input name=\{`a\$\{i\}_(rtn|acct|amt|bank)`\}[^>]*>/g)].map((m) => m[0]);
    expect(bankInputs.length).toBe(4);
    for (const i of bankInputs) {
      expect(i).not.toMatch(/defaultValue|value=/);
      expect(i).toContain('autoComplete="off"');
    }
    expect(REVIEW).not.toMatch(/readDraft|draft\.accounts/);
  });
  it("the drop card shows status only: no bank fields, no file link for managers", () => {
    expect(CARD).not.toMatch(/routing|account_|last4|signedAchDocumentUrl/i);
    expect(CARD).toMatch(/\{canReview \? \(\s*<Link href=\{`\/admin\/settings\/banking\/documents\/\$\{d\.id\}`\}/);
  });
  it("employee and vendor pages render the card for drop roles, review link only for vault viewers", () => {
    for (const src of [EMP, VEN]) {
      expect(src).toContain("canDropDocuments(session.profile.role)");
      expect(src).toContain("canReview={canSeeVault}");
    }
  });
});
