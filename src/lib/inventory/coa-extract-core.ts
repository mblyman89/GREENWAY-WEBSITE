/**
 * src/lib/inventory/coa-extract-core.ts
 *
 * R28 - the PURE half of reading a lot's lab certificate (the server half is
 * coa-extract.ts). Everything that decides something lives here so it can be
 * self-tested without a network:
 *
 *   1. safeCoaUrl       - which links may be fetched at all (https only, an
 *                         allow-list of lab hosts verified on the owner's own
 *                         transfer, no credentials, no odd ports, no IPs).
 *   2. pickPdfText      - LlamaParse markdown vs the PDF's own text layer:
 *                         both are parsed and the one that actually READ the
 *                         potency table wins; a tie keeps LlamaParse (the
 *                         owner's primary). Each candidate is disclosed.
 *   3. labExtractPatch  - the lab_results columns written (0252).
 *   4. planKbFill       - terpenes / cannabinoids for kb_products, FILL-ONLY:
 *                         a curated KB list is never reordered or pruned, and
 *                         nothing is filled from a read whose identity checks
 *                         failed (a wrong PDF must never teach the KB).
 *
 * NEVER GUESS: a link outside the allow-list is not fetched (the reason is
 * stored), a document that does not parse is reported, not patched over.
 */
import {
  assembleCoaExtract,
  coaProfile,
  deriveCoaDraftFacts,
  readStoredCoaExtract,
  unionKbList,
  type CoaDraftFacts,
  type CoaExtract,
  type CoaExtractVia,
} from "@/lib/inventory/coa-facts-core";
import { MG_FACT_TYPES } from "@/lib/inventory/fact-extraction-core";
import { parseCoaPdfText } from "@/lib/inventory/coa-pdf-text-core";

/**
 * Hosts a lab certificate may be fetched from. Verified on the owner transfer
 * (curl, R26/R28): certs.conflabs.com (Confidence Analytics, JSON + PDF) and
 * gglabs-j.github.io (Green Grower Labs, JSON + PDF). Add a lab here only after
 * seeing its real documents - an unknown host is reported, never fetched.
 */
export const COA_HOST_ALLOW = ["certs.conflabs.com", "gglabs-j.github.io"] as const;

/** Size caps: the real JSON is ~10-40 KB, the real PDFs ~0.2-1.1 MB. */
export const COA_JSON_MAX_BYTES = 2 * 1024 * 1024;
export const COA_PDF_MAX_BYTES = 25 * 1024 * 1024;
export const COA_FETCH_TIMEOUT_MS = 20_000;

export type SafeUrl = { ok: true; url: string } | { ok: false; reason: string };

export function safeCoaUrl(raw: string | null | undefined): SafeUrl {
  const s = (raw ?? "").trim();
  if (!s) return { ok: false, reason: "no link" };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, reason: "not a valid link" };
  }
  if (u.protocol !== "https:") return { ok: false, reason: `only https links are read (got ${u.protocol.replace(":", "")})` };
  if (u.username || u.password) return { ok: false, reason: "links with credentials are not read" };
  if (u.port && u.port !== "443") return { ok: false, reason: `port ${u.port} is not read` };
  const host = u.hostname.toLowerCase();
  if (!(COA_HOST_ALLOW as readonly string[]).includes(host)) {
    return { ok: false, reason: `${host} is not a known lab host (known: ${COA_HOST_ALLOW.join(", ")})` };
  }
  return { ok: true, url: u.toString() };
}

/** A response is trusted only with the content type the lab really sends. */
export function contentTypeOk(kind: "json" | "pdf", contentType: string | null): boolean {
  const ct = (contentType ?? "").toLowerCase();
  if (kind === "pdf") return ct.includes("application/pdf") || ct.includes("application/octet-stream");
  return ct.includes("json") || ct.includes("text/plain");
}

/** First bytes of a real PDF. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

export type PdfTextCandidate = { via: Exclude<CoaExtractVia, "none">; text: string | null; error: string | null };
export type PickedPdfText = { text: string | null; via: CoaExtractVia; error: string | null; considered: string[] };

/**
 * LlamaParse first, the text layer second - but the reading that actually
 * produced the potency table wins. Verified on the owner COAs: the GGL PDF's
 * unpdf text has no potency numbers at all, while its layout text does; a
 * markdown table from LlamaParse parses the same (coa-pdf-text-core tests).
 */
export function pickPdfText(candidates: PdfTextCandidate[]): PickedPdfText {
  const considered: string[] = [];
  let best: { c: PdfTextCandidate; score: number } | null = null;
  for (const c of candidates) {
    if (!c.text || !c.text.trim()) {
      considered.push(`${c.via}: ${c.error ?? "no text"}`);
      continue;
    }
    const r = parseCoaPdfText(c.text);
    const score = !r.ok ? 0 : r.doc.potencyReadable ? 2 + Math.min(r.doc.potency.length, 50) / 100 : 1;
    considered.push(`${c.via}: ${!r.ok ? r.reason : r.doc.potencyReadable ? `${r.doc.potency.length} potency rows` : "no potency numbers in the text"}`);
    if (!best || score > best.score) best = { c, score };
  }
  if (!best) {
    const errs = candidates.map((c) => `${c.via}: ${c.error ?? "no text"}`).join("; ");
    return { text: null, via: "none", error: errs || "the PDF was not read", considered };
  }
  return { text: best.c.text, via: best.c.via, error: null, considered };
}

/**
 * True when no reading so far produced the potency table, so LlamaParse is
 * worth its credits (an image-style certificate, or a text layer that failed).
 * A Confident Cannabis certificate whose text layer already carries every
 * number does not spend a LlamaParse credit at finalize.
 */
export function needsLlamaParse(candidates: readonly PdfTextCandidate[]): boolean {
  for (const c of candidates) {
    if (!c.text || !c.text.trim()) continue;
    const r = parseCoaPdfText(c.text);
    if (r.ok && r.doc.potencyReadable) return false;
  }
  return true;
}

/**
 * A PostgREST / Postgres error that means "this column is not in the database
 * yet" (migration 0252 not applied): 42703 undefined_column, PGRST204 schema
 * cache miss. Callers then drop the column instead of failing the write.
 */
export function isMissingColumnError(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!e) return false;
  if (e.code === "42703" || e.code === "PGRST204") return true;
  return /column .* does not exist|could not find the .* column/i.test(e.message ?? "");
}

/** The outcome of one certificate-reading pass (server coa-extract.ts). */
export type CoaExtractRun = {
  /** False = migration 0252 is not applied: nothing was read or written. */
  migrated: boolean;
  /** Rows that needed a read (after skipping already-ok rows). */
  pending: number;
  /** Rows left for the next pass because the time budget ran out. */
  deferred: number;
  read: number;
  ok: number;
  partial: number;
  failed: number;
  kbFilled: number;
  errors: string[];
};

/** Event name on the manifest timeline. */
export const COA_EXTRACT_EVENT = "coa_extract";

/**
 * The owner-facing timeline note for a pass, or null when there is nothing
 * worth saying (no certificates needed reading). Plain words, exact counts.
 */
export function coaExtractRunNote(run: CoaExtractRun): string | null {
  if (!run.migrated) {
    return "Lab certificates were NOT read: the database is missing migration 0252 (lab certificate reading). Run it, then press Re-read lab certificate on a lot (or re-finalize).";
  }
  if (run.pending === 0 && run.errors.length === 0) return null;
  const parts: string[] = [];
  parts.push(`Read ${run.read} of ${run.pending} lab certificate(s)`);
  const how = [
    run.ok > 0 ? `${run.ok} fully read and cross-checked` : "",
    run.partial > 0 ? `${run.partial} partly read` : "",
    run.failed > 0 ? `${run.failed} unreadable` : "",
  ].filter(Boolean);
  if (how.length) parts[0] += ` (${how.join(", ")})`;
  if (run.kbFilled > 0) parts.push(`added terpenes / cannabinoids to ${run.kbFilled} knowledge-base product(s)`);
  if (run.deferred > 0) parts.push(`${run.deferred} left for the next pass (time limit) - press Re-read lab certificate on a lot or re-finalize`);
  let note = parts.join(". ") + ".";
  if (run.errors.length > 0) note += ` Problems: ${run.errors.slice(0, 3).join(" | ")}${run.errors.length > 3 ? ` (+${run.errors.length - 3} more)` : ""}.`;
  if (run.partial > 0 || run.failed > 0) note += " Open the lot to see what the certificate did and did not give.";
  return note;
}

/** The lab_results columns staging reads to derive a draft's COA facts. */
export type StoredLabForFacts = {
  coa_extract_json: unknown;
  total_thc_pct: number | null;
  total_cbd_pct: number | null;
  cbd_pct: number | null;
};

/**
 * Per approved draft: the certificate's serving facts (coa-facts-core
 * deriveCoaDraftFacts) from the stored read of the draft's lot's lab row.
 * Only mg-dosed drafts get an entry. A draft whose lot has no lab row, or
 * whose lab row has not been read, gets nothing (the name/column engine runs
 * exactly as before). The transfer's own total-THC / total-CBD columns are
 * the independent figure when the lab JSON did not give one.
 */
export function coaFactsForDrafts(
  drafts: readonly { id: string; name: string; inventory_type: string | null; lot_id: string | null }[],
  labIdByLotId: ReadonlyMap<string, string>,
  labById: ReadonlyMap<string, StoredLabForFacts>,
): Map<string, CoaDraftFacts> {
  const out = new Map<string, CoaDraftFacts>();
  for (const d of drafts) {
    if (!MG_FACT_TYPES.has((d.inventory_type ?? "").trim())) continue;
    const labId = d.lot_id ? labIdByLotId.get(d.lot_id) : undefined;
    const lab = labId ? labById.get(labId) : undefined;
    if (!lab) continue;
    const extract = readStoredCoaExtract(lab.coa_extract_json);
    if (!extract) continue;
    out.set(
      d.id,
      deriveCoaDraftFacts(extract, {
        name: d.name,
        inventoryType: d.inventory_type,
        transferTotalThcPct: lab.total_thc_pct,
        transferCbdPct: lab.total_cbd_pct ?? lab.cbd_pct,
      }),
    );
  }
  return out;
}

export type LabExtractPatch = {
  coa_extract_json: CoaExtract;
  coa_extract_status: CoaExtract["status"];
  coa_extracted_at: string;
};

export function labExtractPatch(extract: CoaExtract): LabExtractPatch {
  return { coa_extract_json: extract, coa_extract_status: extract.status, coa_extracted_at: extract.extractedAt };
}

export type KbFillPlan = {
  terpenes: string[] | null;
  cannabinoids: string[] | null;
  added: { terpenes: string[]; cannabinoids: string[] };
  skipped: string | null;
};

/** Fill-only terpene/cannabinoid lists for one kb_products row. */
export function planKbFill(
  extract: CoaExtract | null,
  existing: { terpenes: readonly string[] | null; cannabinoids: readonly string[] | null },
): KbFillPlan {
  const none = (skipped: string): KbFillPlan => ({ terpenes: null, cannabinoids: null, added: { terpenes: [], cannabinoids: [] }, skipped });
  if (!extract) return none("the certificate has not been read");
  if (extract.identity.some((c) => !c.ok)) return none("the certificate documents do not match each other");
  if (extract.status === "failed") return none("nothing could be read from the certificate");
  const profile = coaProfile(extract);
  if (!profile) return none("no profile");
  const t = unionKbList(existing.terpenes, profile.kbTerpenes);
  const c = unionKbList(existing.cannabinoids, profile.kbCannabinoids);
  return {
    terpenes: t.added.length > 0 ? t.next : null,
    cannabinoids: c.added.length > 0 ? c.next : null,
    added: { terpenes: t.added, cannabinoids: c.added },
    skipped: t.added.length === 0 && c.added.length === 0 ? "the knowledge base already lists everything the lab found" : null,
  };
}

/** The pure read, given the fetched texts (the server passes what it got). */
export function buildCoaExtract(input: {
  jsonUrl: string | null;
  transferCoaUrl: string | null;
  json: { text: string | null; error: string | null };
  pdf: PickedPdfText;
  at: string;
}): CoaExtract {
  return assembleCoaExtract({
    jsonUrl: input.jsonUrl,
    coaUrl: input.transferCoaUrl,
    transferCoaUrl: input.transferCoaUrl,
    jsonText: input.json.text,
    jsonError: input.json.error,
    pdfText: input.pdf.text,
    pdfError: input.pdf.error,
    pdfVia: input.pdf.text ? input.pdf.via : null,
    extractedAt: input.at,
  });
}

// ---------------------------------------------------------------------------
// Self-tests (house pattern), fed the real owner fixtures
// ---------------------------------------------------------------------------
export function __runCoaExtractCoreTests(fixtures: Record<string, string>): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL coa-extract-core: " + msg);
    }
  };
  const transfer = JSON.parse(fixtures["transfer"]) as {
    inventory_transfer_items: { product_name: string; lab_result_link: string; lab_result_data: { coa: string } }[];
  };
  const items = transfer.inventory_transfer_items;

  // ---- 1. safeCoaUrl: every real link passes, everything else is refused ----
  for (const [i, it] of items.entries()) {
    ok(safeCoaUrl(it.lab_result_link).ok, `item ${i} JSON link allowed`);
    ok(safeCoaUrl(it.lab_result_data.coa).ok, `item ${i} PDF link allowed`);
  }
  const refused: [string, string][] = [
    ["http://certs.conflabs.com/full/x.pdf", "only https"],
    ["https://evil.example/x.pdf", "not a known lab host"],
    ["https://certs.conflabs.com.evil.example/x.pdf", "not a known lab host"],
    ["https://user:pw@certs.conflabs.com/x.pdf", "credentials"],
    ["https://certs.conflabs.com:8443/x.pdf", "port 8443"],
    ["https://127.0.0.1/x.pdf", "not a known lab host"],
    ["file:///etc/passwd", "only https"],
    ["javascript:alert(1)", "only https"],
    ["not a url", "not a valid link"],
    ["", "no link"],
  ];
  for (const [u, why] of refused) {
    const r = safeCoaUrl(u);
    ok(!r.ok && r.reason.includes(why), `refused ${JSON.stringify(u)} (${why}): ${r.ok ? "allowed" : r.reason}`);
  }
  ok(safeCoaUrl(null).ok === false && safeCoaUrl(undefined).ok === false, "null/undefined refused");
  const up = safeCoaUrl("  HTTPS://CERTS.CONFLABS.COM/full/WA-x.pdf ");
  ok(up.ok && up.url === "https://certs.conflabs.com/full/WA-x.pdf", "trimmed + host lower-cased");
  ok(safeCoaUrl("https://certs.conflabs.com:443/x").ok, "explicit 443 allowed");

  // ---- content types + magic bytes ----
  ok(contentTypeOk("pdf", "application/pdf") && contentTypeOk("json", "application/json; charset=utf-8"), "real content types");
  ok(!contentTypeOk("pdf", "text/html") && !contentTypeOk("json", "text/html") && !contentTypeOk("json", null), "html / missing refused");
  ok(looksLikePdf(new TextEncoder().encode("%PDF-1.7\n")) && !looksLikePdf(new TextEncoder().encode("<html>")) && !looksLikePdf(new Uint8Array()), "PDF magic bytes");
  ok(!looksLikePdf(new TextEncoder().encode("%PDFX1.7")) && !looksLikePdf(new TextEncoder().encode("%PDF")), "all five magic bytes are required");

  // ---- 2. pickPdfText ----
  const gglUnpdf = fixtures["item01.unpdf"];
  const gglLayout = fixtures["item01.layout"];
  const p1 = pickPdfText([
    { via: "llamaparse", text: gglLayout, error: null },
    { via: "unpdf", text: gglUnpdf, error: null },
  ]);
  ok(p1.via === "llamaparse" && p1.text === gglLayout, "GGL: the reading with numbers wins");
  const p2 = pickPdfText([
    { via: "llamaparse", text: gglUnpdf, error: null },
    { via: "unpdf", text: gglLayout, error: null },
  ]);
  ok(p2.via === "unpdf" && p2.considered[0].includes("no potency numbers"), "a numberless LlamaParse read loses to a text layer with numbers: " + p2.considered.join(" | "));
  const p3 = pickPdfText([
    { via: "llamaparse", text: fixtures["item12.unpdf"], error: null },
    { via: "unpdf", text: fixtures["item12.unpdf"], error: null },
  ]);
  ok(p3.via === "llamaparse", "a tie keeps LlamaParse (the owner's primary)");
  const p4 = pickPdfText([
    { via: "llamaparse", text: null, error: "LLAMA_CLOUD_API_KEY not set" },
    { via: "unpdf", text: fixtures["item12.unpdf"], error: null },
  ]);
  ok(p4.via === "unpdf" && p4.considered[0].includes("LLAMA_CLOUD_API_KEY"), "no key -> text layer, disclosed");
  const p5 = pickPdfText([
    { via: "llamaparse", text: null, error: "timeout" },
    { via: "unpdf", text: "   ", error: null },
  ]);
  ok(p5.text === null && p5.via === "none" && (p5.error ?? "").includes("timeout"), "nothing read -> reasons kept");
  ok(pickPdfText([]).text === null, "no candidates");

  // ---- coaExtractRunNote ----
  const run0: CoaExtractRun = { migrated: true, pending: 0, deferred: 0, read: 0, ok: 0, partial: 0, failed: 0, kbFilled: 0, errors: [] };
  ok(coaExtractRunNote(run0) === null, "nothing to read -> no timeline noise");
  ok((coaExtractRunNote({ ...run0, migrated: false }) ?? "").includes("migration 0252"), "unmigrated -> says which migration");
  const n1 = coaExtractRunNote({ ...run0, pending: 5, read: 5, ok: 5, kbFilled: 3 }) ?? "";
  ok(n1 === "Read 5 of 5 lab certificate(s) (5 fully read and cross-checked). added terpenes / cannabinoids to 3 knowledge-base product(s).", "all ok note: " + n1);
  const n2 = coaExtractRunNote({ ...run0, pending: 9, read: 4, ok: 2, partial: 1, failed: 1, deferred: 4, errors: ["a", "b", "c", "d", "e"] }) ?? "";
  ok(n2.startsWith("Read 4 of 9 lab certificate(s) (2 fully read and cross-checked, 1 partly read, 1 unreadable)"), "mixed counts: " + n2);
  ok(n2.includes("4 left for the next pass") && n2.includes("Problems: a | b | c (+2 more).") && n2.endsWith("Open the lot to see what the certificate did and did not give."), "deferred + capped errors + pointer: " + n2);
  ok((coaExtractRunNote({ ...run0, errors: ["select failed"] }) ?? "").includes("Problems: select failed."), "an error alone is still reported");
  ok((coaExtractRunNote({ ...run0, pending: 2, read: 2, ok: 1, partial: 1 }) ?? "").endsWith("Open the lot to see what the certificate did and did not give."), "a partial read alone points at the lot");
  ok(!(coaExtractRunNote({ ...run0, pending: 2, read: 2, ok: 2 }) ?? "").includes("Open the lot"), "all ok -> no pointer");

  // ---- isMissingColumnError ----
  ok(isMissingColumnError({ code: "42703" }) && isMissingColumnError({ code: "PGRST204" }), "missing-column codes");
  ok(isMissingColumnError({ message: 'column lab_results.wcia_json_url does not exist' }), "missing-column message");
  ok(isMissingColumnError({ message: "Could not find the 'wcia_json_url' column of 'lab_results' in the schema cache" }), "schema-cache message");
  ok(!isMissingColumnError({ code: "23505", message: "duplicate key" }) && !isMissingColumnError(null) && !isMissingColumnError({}), "other errors are not missing-column");
  ok(!isMissingColumnError({ code: "23514", message: "violates check constraint lab_results_coa_extract_status_check" }), "a check violation is a real error");

  // ---- needsLlamaParse: spend a credit only when the text layer failed ----
  for (const k of ["00", "02", "12", "13", "14", "15", "16"]) {
    ok(!needsLlamaParse([{ via: "unpdf", text: fixtures[`item${k}.unpdf`], error: null }]), `item ${k}: text layer carries the numbers -> no LlamaParse credit`);
  }
  ok(needsLlamaParse([{ via: "unpdf", text: gglUnpdf, error: null }]), "GGL text layer has no numbers -> LlamaParse asked");
  ok(needsLlamaParse([{ via: "unpdf", text: null, error: "broken PDF" }]), "unreadable PDF -> LlamaParse asked");
  ok(needsLlamaParse([{ via: "unpdf", text: "  ", error: null }]), "blank text layer -> LlamaParse asked");
  ok(needsLlamaParse([]), "nothing tried -> LlamaParse asked");
  ok(needsLlamaParse([{ via: "unpdf", text: "hello world, not a certificate", error: null }]), "non-certificate text -> LlamaParse asked");
  ok(!needsLlamaParse([{ via: "unpdf", text: gglUnpdf, error: null }, { via: "unpdf", text: gglLayout, error: null }]), "any reading with numbers is enough");
  const p6 = pickPdfText([{ via: "unpdf", text: "hello world, not a certificate", error: null }]);
  ok(p6.text === "hello world, not a certificate" && p6.considered[0].startsWith("unpdf: "), "an unparseable text is still the best of one (assemble reports it)");

  // ---- 3+4. the full read, the patch, the KB fill ----
  const at = "2026-01-01T00:00:00.000Z";
  const it12 = items[12];
  const ex12 = buildCoaExtract({
    jsonUrl: it12.lab_result_link,
    transferCoaUrl: it12.lab_result_data.coa,
    json: { text: fixtures["item12.wcia"], error: null },
    pdf: pickPdfText([{ via: "unpdf", text: fixtures["item12.unpdf"], error: null }]),
    at,
  });
  ok(ex12.status === "ok" && ex12.pdfVia === "unpdf" && ex12.identity.length === 3, "item 12 read ok: " + ex12.summary);
  const patch = labExtractPatch(ex12);
  ok(patch.coa_extract_status === "ok" && patch.coa_extracted_at === at && patch.coa_extract_json === ex12, "patch columns");
  const fill = planKbFill(ex12, { terpenes: null, cannabinoids: null });
  ok(fill.cannabinoids?.join(",") === "thc,cbd,cbg,cbc", "item 12 KB cannabinoids: " + fill.cannabinoids?.join(","));
  const curated = planKbFill(ex12, { terpenes: ["Pinene"], cannabinoids: ["cbd", "thc"] });
  ok(curated.cannabinoids?.join(",") === "cbd,thc,cbg,cbc" && curated.added.cannabinoids.join(",") === "cbg,cbc", "curated order kept, only new appended");
  const full = planKbFill(ex12, { terpenes: fill.terpenes ?? [], cannabinoids: fill.cannabinoids });
  ok(full.terpenes === null && full.cannabinoids === null && (full.skipped ?? "").includes("already lists"), "nothing new -> no write");

  const it00 = items[0];
  const ex00 = buildCoaExtract({
    jsonUrl: it00.lab_result_link,
    transferCoaUrl: it00.lab_result_data.coa,
    json: { text: fixtures["item00.wcia"], error: null },
    pdf: pickPdfText([{ via: "unpdf", text: fixtures["item00.unpdf"], error: null }]),
    at,
  });
  const f00 = planKbFill(ex00, { terpenes: [], cannabinoids: [] });
  ok((f00.terpenes ?? []).slice(0, 4).join(",") === "limonene,myrcene,linalool,caryophyllene", "item 00 KB terpenes strongest first: " + f00.terpenes?.join(","));

  const wrong = buildCoaExtract({
    jsonUrl: it12.lab_result_link,
    transferCoaUrl: it12.lab_result_data.coa,
    json: { text: fixtures["item12.wcia"], error: null },
    pdf: pickPdfText([{ via: "unpdf", text: fixtures["item13.unpdf"], error: null }]),
    at,
  });
  const fw = planKbFill(wrong, { terpenes: [], cannabinoids: [] });
  ok(fw.terpenes === null && fw.cannabinoids === null && (fw.skipped ?? "").includes("do not match"), "a mismatched PDF never teaches the KB");
  ok(planKbFill(null, { terpenes: null, cannabinoids: null }).skipped === "the certificate has not been read", "no read -> skipped");
  const failedRead = buildCoaExtract({
    jsonUrl: null,
    transferCoaUrl: null,
    json: { text: null, error: "timeout" },
    pdf: pickPdfText([{ via: "unpdf", text: null, error: "404" }]),
    at,
  });
  ok(failedRead.status === "failed" && planKbFill(failedRead, { terpenes: null, cannabinoids: null }).skipped === "nothing could be read from the certificate", "failed read -> nothing filled");
  const jsonOnly = buildCoaExtract({
    jsonUrl: it00.lab_result_link,
    transferCoaUrl: it00.lab_result_data.coa,
    json: { text: fixtures["item00.wcia"], error: null },
    pdf: pickPdfText([{ via: "unpdf", text: null, error: "404" }]),
    at,
  });
  const fj = planKbFill(jsonOnly, { terpenes: [], cannabinoids: [] });
  ok(jsonOnly.status === "partial" && (fj.terpenes ?? []).length > 0, "PDF missing -> partial, the lab JSON still fills the KB");

  // ---- coaFactsForDrafts: the staging bridge ----
  {
    const pot = (i: number, t: string): number | null => {
      const p = (items[i] as unknown as { lab_result_data: { potency?: { type: string; value: number }[] } }).lab_result_data.potency ?? [];
      const hit = p.find((x) => x.type === t);
      return hit ? Number(hit.value) : null;
    };
    const exFor = (i: number) =>
      buildCoaExtract({
        jsonUrl: items[i].lab_result_link,
        transferCoaUrl: items[i].lab_result_data.coa,
        json: { text: fixtures[`item${String(i).padStart(2, "0")}.wcia`], error: null },
        pdf: pickPdfText([{ via: "unpdf", text: fixtures[`item${String(i).padStart(2, "0")}.unpdf`], error: null }]),
        at,
      });
    const typeOf = (i: number) => (items[i] as unknown as { inventory_type: string }).inventory_type;
    const drafts: { id: string; name: string; inventory_type: string | null; lot_id: string | null }[] = [12, 13, 14, 15, 16, 0].map((i) => ({ id: `d${i}`, name: items[i].product_name, inventory_type: typeOf(i), lot_id: `lot${i}` }));
    drafts.push({ id: "dNoLot", name: items[12].product_name, inventory_type: typeOf(12), lot_id: null });
    drafts.push({ id: "dNoLab", name: items[12].product_name, inventory_type: typeOf(12), lot_id: "lotNoLab" });
    drafts.push({ id: "dUnread", name: items[12].product_name, inventory_type: typeOf(12), lot_id: "lotUnread" });
    drafts.push({ id: "dJunk", name: items[12].product_name, inventory_type: typeOf(12), lot_id: "lotJunk" });
    const labIdByLot = new Map<string, string>([
      ...[12, 13, 14, 15, 16, 0].map((i) => [`lot${i}`, `lab${i}`] as [string, string]),
      ["lotUnread", "labUnread"],
      ["lotJunk", "labJunk"],
    ]);
    const labs = new Map<string, StoredLabForFacts>([
      ...[12, 13, 14, 15, 16, 0].map(
        (i) => [`lab${i}`, { coa_extract_json: JSON.parse(JSON.stringify(exFor(i))), total_thc_pct: pot(i, "total-thc"), total_cbd_pct: pot(i, "total-cbd"), cbd_pct: null }] as [string, StoredLabForFacts],
      ),
      ["labUnread", { coa_extract_json: null, total_thc_pct: 0.12, total_cbd_pct: null, cbd_pct: null }],
      ["labJunk", { coa_extract_json: { version: 99, status: "ok", identity: [], agreement: [] }, total_thc_pct: 0.12, total_cbd_pct: null, cbd_pct: null }],
    ]);
    const m = coaFactsForDrafts(drafts, labIdByLot, labs);
    ok(m.size === 5 && ["d12", "d13", "d14", "d15", "d16"].every((k) => m.has(k)), "only the 5 edibles with a stored read get facts: " + Array.from(m.keys()).join(","));
    ok(!m.has("d0"), "flower (percent product) gets no COA serving facts");
    ok(!m.has("dNoLot") && !m.has("dNoLab") && !m.has("dUnread"), "no lot / no lab / unread -> nothing (engine unchanged)");
    ok(!m.has("dJunk"), "a stored read of another version is ignored, never half-trusted");
    const want: [string, number, boolean][] = [["d12", 55, true], ["d13", 110, false], ["d14", 110, false], ["d15", 100, true], ["d16", 100, true]];
    for (const [k, mg, clean] of want) {
      const f = m.get(k)!;
      ok(f.usable && f.packageThcMg?.value === mg, `${k}: ${mg} mg THC per package from the stored read (got ${f.packageThcMg?.value})`);
      ok((f.reasons.length === 0) === clean, `${k}: ${clean ? "no hold" : "held by the WA limit"} (${f.reasons.join(" | ")})`);
    }
    // The bridge survives a JSON round trip (what jsonb hands back).
    const direct = deriveCoaDraftFacts(exFor(12), { name: items[12].product_name, inventoryType: typeOf(12), transferTotalThcPct: pot(12, "total-thc"), transferCbdPct: pot(12, "total-cbd") });
    ok(JSON.stringify(direct) === JSON.stringify(m.get("d12")), "stored (jsonb) read derives exactly what the fresh read does");
    // cbd_pct is the fallback when total_cbd_pct is empty.
    const m2 = coaFactsForDrafts(
      [drafts[0]],
      labIdByLot,
      new Map([["lab12", { ...labs.get("lab12")!, total_cbd_pct: null, cbd_pct: pot(12, "total-cbd") }]]),
    );
    ok(m2.get("d12")?.packageCbdMg?.value === 100, "cbd_pct fallback keeps CBD at 100 mg");
    // ...and it is what CONFIRMS CBD when the lab JSON was not reachable.
    const noJson = JSON.parse(JSON.stringify({ ...exFor(12), json: null, agreement: [] }));
    const cbdVia = (l: Partial<StoredLabForFacts>) =>
      coaFactsForDrafts([drafts[0]], labIdByLot, new Map([["lab12", { coa_extract_json: noJson, total_thc_pct: pot(12, "total-thc"), total_cbd_pct: null, cbd_pct: null, ...l }]])).get("d12")?.cbdMgPerServing?.confidence;
    ok(cbdVia({ cbd_pct: pot(12, "total-cbd") }) === "verified", "no lab JSON: cbd_pct confirms the COA's CBD");
    ok(cbdVia({ total_cbd_pct: pot(12, "total-cbd") }) === "verified", "no lab JSON: total_cbd_pct confirms the COA's CBD");
    ok(cbdVia({}) === "single-source", "no lab JSON, no transfer CBD -> single-source");
  }

  return { passed, failed };
}
