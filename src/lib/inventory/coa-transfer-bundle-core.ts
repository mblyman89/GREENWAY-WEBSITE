/**
 * src/lib/inventory/coa-transfer-bundle-core.ts  (D214)
 *
 * "Attach all COAs from the vendor's transfer" - PURE half.
 *
 * Owner, verbatim: "I was able to find all coas now except for the GREEN
 * RESEARCH NETWORK, LLC, manifest #GF42904700003637 ... I am uploading it for
 * you to add to the repo with a button to attach them all." The COAs live in
 * the vendor's WCIA transfer file (the Growflow "Transfer Data Link"): every
 * line names its inventory id and links its lab certificate PDF. A copy of
 * that file is kept in the repo (src/data/wcia-transfers/<manifest #>.json;
 * the tokened link itself is NOT kept, the repo is public).
 *
 * Who gets which certificate is the VENDOR'S declaration on the transfer
 * (line inventory id === lot code, exactly). What the certificate SAYS (the
 * lab test id, potency, pass/fail) is read from the certificate PDF itself,
 * never from the transfer's summary (which printed 0% THC on four lines).
 *
 * Never guesses:
 *   - a lot whose code is on two transfer lines with different links is left alone;
 *   - a link whose PDF holds anything but exactly ONE readable certificate with a
 *     lab test id attaches nothing;
 *   - a lot that already has a lab result, or is destroyed, is never touched.
 */
import type { ParsedLine } from "@/lib/inventory/intake-parser";
import type { CoaCertificate } from "@/lib/inventory/coa-bundle-core";

export const TRANSFER_COA_AUDIT = "inventory_lot.coa_attached_from_transfer";
export const TRANSFER_COA_MANIFEST_AUDIT = "manifest.coa_transfer_bundle_attached";
export const TRANSFER_COA_EVENT = "coa_transfer_bundle";

export type BundleLot = { id: string; lot_code: string | null; status: string | null; lab_result_id: string | null; product_name?: string | null };

export type TransferCoaJob = { lotId: string; lotCode: string; coaUrl: string; transferLabId: string | null; productName: string | null };

export type TransferCoaSkip = "has-lab" | "destroyed" | "no-code" | "not-on-transfer" | "no-link" | "ambiguous";

export type TransferCoaPlan = {
  jobs: TransferCoaJob[];
  /** Distinct certificate links to read (sorted). */
  links: string[];
  skipped: Record<TransferCoaSkip, number>;
};

const norm = (s: string | null | undefined) => (s ?? "").trim();

/** Only public https links are read (the store adds the DNS check). */
export function usableCoaLink(raw: string | null | undefined): string | null {
  const s = norm(raw);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function planTransferCoaAttach(lots: readonly BundleLot[], lines: readonly Pick<ParsedLine, "lot_code" | "lab">[]): TransferCoaPlan {
  const byCode = new Map<string, { url: string | null; labId: string | null; ambiguous: boolean }>();
  for (const line of lines) {
    const code = norm(line.lot_code);
    if (!code) continue;
    const url = usableCoaLink(line.lab?.coa_url);
    const labId = norm(line.lab?.labtest_external_identifier) || null;
    const prev = byCode.get(code);
    if (!prev) byCode.set(code, { url, labId, ambiguous: false });
    else if (prev.url !== url) prev.ambiguous = true;
  }
  const skipped: Record<TransferCoaSkip, number> = { "has-lab": 0, destroyed: 0, "no-code": 0, "not-on-transfer": 0, "no-link": 0, ambiguous: 0 };
  const jobs: TransferCoaJob[] = [];
  for (const lot of lots) {
    if (lot.status === "destroyed") {
      skipped.destroyed += 1;
      continue;
    }
    if (lot.lab_result_id) {
      skipped["has-lab"] += 1;
      continue;
    }
    const code = norm(lot.lot_code);
    if (!code) {
      skipped["no-code"] += 1;
      continue;
    }
    const hit = byCode.get(code);
    if (!hit) skipped["not-on-transfer"] += 1;
    else if (hit.ambiguous) skipped.ambiguous += 1;
    else if (!hit.url) skipped["no-link"] += 1;
    else jobs.push({ lotId: lot.id, lotCode: code, coaUrl: hit.url, transferLabId: hit.labId, productName: lot.product_name ?? null });
  }
  return { jobs, links: [...new Set(jobs.map((j) => j.coaUrl))].sort(), skipped };
}

const labIdOf = (c: CoaCertificate) => c.labSampleId ?? c.ids[0] ?? null;

/** The ONE certificate a transfer link stands for, or why it cannot be used. */
export function certificateForLink(certs: readonly CoaCertificate[]): { ok: true; cert: CoaCertificate; labId: string } | { ok: false; error: string } {
  const usable = certs.filter((c) => c.identifiable && labIdOf(c));
  if (usable.length === 1) return { ok: true, cert: usable[0], labId: labIdOf(usable[0]) as string };
  if (usable.length === 0) return { ok: false, error: "no certificate with a lab test id could be read from it" };
  return { ok: false, error: `it holds ${usable.length} certificates, so which one is meant cannot be told` };
}

export type TransferCoaResult = {
  attached: number;
  /** New lab results saved / exact lab test ids already on file (reused). */
  created: number;
  reused: number;
  archived: number;
  changedMeanwhile: number;
  failedLots: { lotCode: string; why: string }[];
  skipped: Record<TransferCoaSkip, number>;
};

/** One plain sentence for the page banner, the timeline and the audit row. */
export function transferCoaNote(manifestNumber: string, r: TransferCoaResult): string {
  const s = r.skipped;
  const parts = [
    `${r.attached} lot${r.attached === 1 ? "" : "s"} got ${r.attached === 1 ? "its" : "their"} COA from the vendor's transfer ${manifestNumber}`,
    r.created > 0 ? `${r.created} new lab result${r.created === 1 ? "" : "s"}` : "",
    r.reused > 0 ? `${r.reused} already on file (reused)` : "",
    r.archived > 0 ? `${r.archived} PDF${r.archived === 1 ? "" : "s"} archived` : "",
    s["has-lab"] > 0 ? `${s["has-lab"]} already had one (kept)` : "",
    s["not-on-transfer"] + s["no-code"] > 0 ? `${s["not-on-transfer"] + s["no-code"]} not on the transfer` : "",
    s["no-link"] > 0 ? `${s["no-link"]} with no COA link on the transfer` : "",
    s.ambiguous > 0 ? `${s.ambiguous} left alone (two different COA links on the transfer)` : "",
    r.changedMeanwhile > 0 ? `${r.changedMeanwhile} changed meanwhile (not touched)` : "",
  ].filter(Boolean);
  const fails =
    r.failedLots.length > 0
      ? ` Not attached: ${r.failedLots
          .slice(0, 4)
          .map((f) => `${f.lotCode} (${f.why})`)
          .join("; ")}${r.failedLots.length > 4 ? `; and ${r.failedLots.length - 4} more` : ""}.`
      : "";
  return `${parts.join(", ")}.${fails}`;
}

// --- self-tests ----------------------------------------------------------------------

export function __runCoaTransferBundleCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error("FAIL coa-transfer-bundle-core: " + m);
    passed += 1;
  };
  const lab = (url: string | null, id: string | null = "X") => ({ coa_url: url, labtest_external_identifier: id }) as unknown as ParsedLine["lab"];
  const lines = [
    { lot_code: "A", lab: lab("https://certs.example/a.pdf", "LA") },
    { lot_code: "B", lab: lab("https://certs.example/shared.pdf") },
    { lot_code: "C", lab: lab("https://certs.example/shared.pdf") },
    { lot_code: "D", lab: lab(null) },
    { lot_code: "E", lab: lab("https://x/1.pdf") },
    { lot_code: "E", lab: lab("https://x/2.pdf") },
    { lot_code: "F", lab: lab("http://insecure/f.pdf") },
    { lot_code: "G", lab: lab("https://g/1.pdf") },
    { lot_code: "G", lab: lab("https://g/1.pdf") },
  ];
  const lots: BundleLot[] = [
    { id: "1", lot_code: "A", status: "active", lab_result_id: null },
    { id: "2", lot_code: " B ", status: "sold_out", lab_result_id: null },
    { id: "3", lot_code: "C", status: "active", lab_result_id: "kept" },
    { id: "4", lot_code: "D", status: "active", lab_result_id: null },
    { id: "5", lot_code: "E", status: "active", lab_result_id: null },
    { id: "6", lot_code: "Z", status: "active", lab_result_id: null },
    { id: "7", lot_code: "A", status: "destroyed", lab_result_id: null },
    { id: "8", lot_code: null, status: "active", lab_result_id: null },
    { id: "9", lot_code: "F", status: "active", lab_result_id: null },
    { id: "10", lot_code: "G", status: "active", lab_result_id: null },
  ];
  const p = planTransferCoaAttach(lots, lines);
  ok(p.jobs.map((j) => j.lotId).join(",") === "1,2,10", "only exact, single-link, empty, live lots get a job");
  ok(p.jobs[0].transferLabId === "LA" && p.jobs[1].lotCode === "B", "job carries the trimmed code + transfer lab id");
  ok(p.skipped["has-lab"] === 1 && p.skipped.destroyed === 1, "a lab result is kept; a destroyed lot is never touched");
  ok(p.skipped["no-link"] === 2, "no link and a non-https link are not read");
  ok(p.skipped.ambiguous === 1, "two different links for one code = left alone");
  ok(p.skipped["not-on-transfer"] === 1 && p.skipped["no-code"] === 1, "off-transfer + no code counted");
  ok(p.links.length === 3, "links are distinct");
  ok(usableCoaLink("  https://a/b.pdf ") === "https://a/b.pdf" && usableCoaLink("ftp://a") === null && usableCoaLink("nope") === null, "link filter");

  const cert = (id: string | null, identifiable = true) => ({ labSampleId: id, ids: id ? [id] : [], identifiable }) as unknown as CoaCertificate;
  const one = certificateForLink([cert("WA-1")]);
  ok(one.ok && one.labId === "WA-1", "one certificate -> it");
  ok(!certificateForLink([cert("WA-1"), cert("WA-2")]).ok, "two certificates -> refused, never guessed");
  ok(!certificateForLink([cert(null, false)]).ok && !certificateForLink([]).ok, "unreadable -> refused");
  const both = certificateForLink([cert("WA-1"), cert(null, false)]);
  ok(both.ok && both.labId === "WA-1", "an unreadable page next to one certificate does not block it");

  const note = transferCoaNote("GF1", {
    attached: 18,
    created: 14,
    reused: 1,
    archived: 14,
    changedMeanwhile: 0,
    failedLots: [],
    skipped: { "has-lab": 1, destroyed: 0, "no-code": 0, "not-on-transfer": 0, "no-link": 0, ambiguous: 0 },
  });
  ok(note === "18 lots got their COA from the vendor's transfer GF1, 14 new lab results, 1 already on file (reused), 14 PDFs archived, 1 already had one (kept).", "note: " + note);
  const failNote = transferCoaNote("GF1", {
    attached: 0,
    created: 0,
    reused: 0,
    archived: 0,
    changedMeanwhile: 0,
    failedLots: [1, 2, 3, 4, 5].map((n) => ({ lotCode: `L${n}`, why: "x" })),
    skipped: { "has-lab": 0, destroyed: 0, "no-code": 0, "not-on-transfer": 0, "no-link": 0, ambiguous: 0 },
  });
  ok(failNote.includes("0 lots got their COA") && failNote.includes("L4 (x); and 1 more."), "failures named, capped at four");
  ok(TRANSFER_COA_AUDIT === "inventory_lot.coa_attached_from_transfer" && TRANSFER_COA_EVENT === "coa_transfer_bundle", "audit + event pinned");
  return { passed, failed: 0 };
}
