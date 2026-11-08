/**
 * src/lib/inventory/lot-coa-manual-core.ts  (D207d)
 *
 * Owner, 2026: "Then build everything to help me unlock these last three
 * manifests and the one off lots that need coas."
 *
 * The lot page's "Attach the COA document" box: the owner pastes the COA link
 * a vendor sent (a Google Drive / Dropbox share link or a lab's own link) or
 * uploads the PDF, and the certificate inside is attached to THIS lot. Pure
 * parts only:
 *
 *   - parseManualCoaLink: the pasted text -> a fetchable public https/http
 *     link (Drive/Dropbox share pages turned into their download form). A
 *     Drive FOLDER or a Google Doc/Sheet is refused with the reason (it is not
 *     a PDF file).
 *   - checkManualCoaUpload: the uploaded file must be a real PDF under 25 MB.
 *   - pickCertificateForLot: which certificate in the document belongs to the
 *     lot. An id printed on the certificate equal to the lot's barcode / key
 *     wins; else a name match that singles one out; else, when the document
 *     holds exactly ONE readable certificate with a lab test id, that one (the
 *     owner chose the document for this lot - said as "attached by hand").
 *     Several certificates and no match = refused, naming what was read
 *     (never guessed).
 */
import { downloadForm, publicUrl } from "@/lib/inventory/coa-gmail-deep-core";
import { lotsForMatch, planCoaBundle, type CoaCertificate, type CoaLotRow, type CoaMatchBy } from "@/lib/inventory/coa-bundle-core";

export const MANUAL_COA_ANCHOR = "coa-doc";
export const MANUAL_COA_MAX_BYTES = 25 * 1024 * 1024;
export const MANUAL_COA_AUDIT = "inventory_lot.coa_attached_from_document";

export type ManualLink = { ok: true; url: string; label: string } | { ok: false; error: string };

/** The pasted link -> the link the server downloads. */
export function parseManualCoaLink(raw: string | null | undefined): ManualLink {
  const s = (raw ?? "").trim();
  if (!s) return { ok: false, error: "Paste the COA link first." };
  if (s.length > 2000) return { ok: false, error: "That link is too long." };
  const u = publicUrl(s);
  if (!u) return { ok: false, error: "That is not a public web link (it must start with https:// and name a public site)." };
  const h = u.hostname.toLowerCase();
  if (h === "drive.google.com" && /\/drive\/(u\/\d+\/)?folders\//.test(u.pathname))
    return { ok: false, error: "That is a Google Drive FOLDER. Open the folder, right-click the COA PDF -> Share -> Copy link, and paste that link." };
  if (h === "docs.google.com")
    return { ok: false, error: "That is a Google Doc/Sheet, not a PDF. In Google Drive, right-click the COA PDF -> Share -> Copy link, and paste that link (or download the PDF and upload it here)." };
  const url = downloadForm(u);
  const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "");
  const label = h === "drive.google.com" ? "Google Drive COA" : /\.pdf$/i.test(last) ? last.slice(0, 120) : `COA from ${h}`;
  return { ok: true, url, label };
}

/** An uploaded file must be a real, non-empty PDF under the size cap. */
export function checkManualCoaUpload(name: string | null | undefined, size: number, firstBytes: Uint8Array): { ok: true; label: string } | { ok: false; error: string } {
  if (!size) return { ok: false, error: "The uploaded file is empty." };
  if (size > MANUAL_COA_MAX_BYTES) return { ok: false, error: `The file is too large (${Math.round(size / 1024 / 1024)} MB; the limit is 25 MB).` };
  const pdf = firstBytes.length >= 5 && firstBytes[0] === 0x25 && firstBytes[1] === 0x50 && firstBytes[2] === 0x44 && firstBytes[3] === 0x46 && firstBytes[4] === 0x2d;
  if (!pdf) return { ok: false, error: "That file is not a PDF. Upload the COA as a PDF." };
  const label = (name ?? "").trim().replace(/[^\w .()-]/g, "_").slice(0, 120) || "uploaded-coa.pdf";
  return { ok: true, label };
}

export type ManualPick =
  | { ok: true; cert: CoaCertificate; by: CoaMatchBy | "manual"; evidence: string }
  | { ok: false; error: string };

const labIdOf = (c: CoaCertificate) => c.labSampleId ?? c.ids[0] ?? null;

/** Short words for the certificates read (used in refusals). */
export function describeCerts(certs: readonly CoaCertificate[]): string {
  const list = certs.slice(0, 6).map((c) => `${labIdOf(c) ?? "no lab id"}${c.sampleName ? ` "${c.sampleName.slice(0, 50)}"` : ""}`);
  return list.join("; ") + (certs.length > 6 ? `; and ${certs.length - 6} more` : "");
}

/** Which certificate in the document belongs to this lot. */
export function pickCertificateForLot(certs: readonly CoaCertificate[], lot: CoaLotRow): ManualPick {
  if (lot.status === "destroyed") return { ok: false, error: "That lot is destroyed; a lab result is never attached to it." };
  if (lot.lab_result_id) return { ok: false, error: "That lot already has a lab result; it is never replaced here." };
  if (certs.length === 0) return { ok: false, error: "No lab certificate could be read from that document." };
  const plan = planCoaBundle(certs, lotsForMatch([lot]));
  const m = plan.matches.find((x) => x.lineKey === lot.id);
  if (m) {
    const c = certs.find((x) => x.key === m.certKey) as CoaCertificate;
    if (!labIdOf(c)) return { ok: false, error: "The matching certificate prints no lab test id; it cannot be attached safely." };
    return { ok: true, cert: c, by: m.by, evidence: m.evidence };
  }
  const usable = certs.filter((c) => c.identifiable && labIdOf(c));
  if (plan.ambiguous.length > 0 || usable.length > 1)
    return {
      ok: false,
      error: `The document holds ${usable.length} certificates and none names this lot's barcode or product clearly (${describeCerts(usable)}). Upload the one certificate for this lot, or attach it by its Lab test ID above.`,
    };
  if (usable.length === 1) return { ok: true, cert: usable[0], by: "manual", evidence: `the only certificate in ${usable[0].docLabel}` };
  return { ok: false, error: `The certificate could not be read well enough (no lab test id). ${certs[0].reason ?? ""}`.trim() };
}

/** The plain sentence after a successful attach. */
export function manualAttachNote(cert: CoaCertificate, by: CoaMatchBy | "manual", reused: boolean): string {
  const how = by === "id" ? "matched by the lot's id" : by === "name" ? "matched by product name - verify it" : "attached by hand";
  const pass = cert.passed === true ? "PASS" : cert.passed === false ? "FAIL" : "result not printed";
  return `COA ${labIdOf(cert)} attached (${how}; ${pass}${cert.totalThcPct != null ? `; total THC ${cert.totalThcPct}%` : ""})${reused ? "; the lab result was already on file and was reused" : ""}.`;
}

// --- self-test ---------------------------------------------------------------------------------

export function __runLotCoaManualCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error("FAIL lot-coa-manual-core: " + m);
    passed += 1;
  };
  // links
  const d = parseManualCoaLink(" https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=drivesdk ");
  ok(d.ok && d.url === "https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp" && d.label === "Google Drive COA", "Drive share -> download form");
  const dr = parseManualCoaLink("https://www.dropbox.com/s/abc/COA%20GMO.pdf?dl=0");
  ok(dr.ok && dr.url.includes("dl=1") && dr.label === "COA GMO.pdf", "Dropbox -> dl=1, filename label");
  const lab = parseManualCoaLink("https://portal.confidentcannabis.com/share/file/abc.pdf");
  ok(lab.ok && lab.url === "https://portal.confidentcannabis.com/share/file/abc.pdf", "a lab link is kept as is");
  const f = parseManualCoaLink("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp");
  ok(!f.ok && f.error.includes("FOLDER"), "Drive folder refused with how-to");
  const g = parseManualCoaLink("https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit");
  ok(!g.ok && g.error.includes("not a PDF"), "Google Doc refused");
  ok(!parseManualCoaLink("").ok && !parseManualCoaLink("http://10.0.0.1/x.pdf").ok && !parseManualCoaLink("http://localhost/x").ok && !parseManualCoaLink("ftp://a.com/x").ok, "empty / private / ftp refused");
  ok(!parseManualCoaLink("https://u:p@lab.com/x.pdf").ok && !parseManualCoaLink("https://" + "a".repeat(2100) + ".com").ok, "credentials / too long refused");
  // uploads
  const PDF = new TextEncoder().encode("%PDF-1.7");
  ok(checkManualCoaUpload("GMO COA.pdf", 1000, PDF).ok, "a real PDF is accepted");
  const bad = checkManualCoaUpload("x.pdf", 1000, new TextEncoder().encode("<html>"));
  ok(!bad.ok && bad.error.includes("not a PDF"), "not a PDF refused");
  ok(!checkManualCoaUpload("x.pdf", 0, PDF).ok && !checkManualCoaUpload("x.pdf", MANUAL_COA_MAX_BYTES + 1, PDF).ok, "empty / too large refused");
  const lb = checkManualCoaUpload("../../etc/<x>.pdf", 10, PDF);
  ok(lb.ok && !lb.label.includes("<") && !lb.label.includes("/"), "file name cleaned");
  // picking
  const cert = (key: string, id: string | null, name: string | null, ids: string[] = id ? [id] : []): CoaCertificate => ({
    key,
    docLabel: "coa.pdf",
    template: null,
    labName: "Lab",
    labSampleId: id,
    ids,
    sampleName: name,
    productType: null,
    passed: true,
    totalThcPct: 71.2,
    totalCbdPct: null,
    totalCannabinoidsPct: null,
    potency: {},
    testedOn: null,
    releasedOn: null,
    identifiable: Boolean(id || name),
    reason: null,
  });
  const L: CoaLotRow = { id: "L1", product_name: "Frostco - Bubble Hash - GMO - 1g", lot_code: "GF42904705574845", pos_product_key: null, strain_name: "GMO", lab_result_id: null, status: "active" };
  const byId = pickCertificateForLot([cert("a#1", "WA-1", "Other", ["WA-1"]), cert("a#2", "WA-2", "Thing", ["WA-2", "GF42904705574845"])], L);
  ok(byId.ok && byId.cert.key === "a#2" && byId.by === "id", "the certificate naming the lot's barcode wins");
  const only = pickCertificateForLot([cert("a#1", "WA-9", "Unrelated name")], L);
  ok(only.ok && only.by === "manual" && only.evidence.includes("only certificate"), "one certificate: the owner's choice, said as by hand");
  const many = pickCertificateForLot([cert("a#1", "WA-1", "Apple"), cert("a#2", "WA-2", "Banana")], L);
  ok(!many.ok && many.error.includes("2 certificates") && many.error.includes("WA-1"), "several, none matching: refused, naming what was read");
  ok(!pickCertificateForLot([], L).ok && !pickCertificateForLot([cert("a#1", null, null)], L).ok, "nothing readable refused");
  ok(!pickCertificateForLot([cert("a#1", "WA-1", "x")], { ...L, lab_result_id: "z" }).ok && !pickCertificateForLot([cert("a#1", "WA-1", "x")], { ...L, status: "destroyed" }).ok, "never replaces, never a destroyed lot");
  ok(manualAttachNote(cert("a#1", "WA-1", "x"), "manual", false).startsWith("COA WA-1 attached (attached by hand; PASS; total THC 71.2%)"), "note");
  ok(MANUAL_COA_ANCHOR === "coa-doc" && MANUAL_COA_AUDIT === "inventory_lot.coa_attached_from_document", "anchor + audit pinned");
  return { passed, failed: 0 };
}
