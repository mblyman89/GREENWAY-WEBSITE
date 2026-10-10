/**
 * src/lib/inventory/coa-extract.ts
 *
 * R28 - READ every lab certificate a delivery carries and keep what it says.
 *
 * For each lab_results row of a manifest (or one lot, on demand):
 *   1. the lab JSON  (wcia_json_url = the transfer's lab_result_link)
 *   2. the COA PDF   (the archived copy in the private `coa` bucket when
 *                     there is one, else coa_url), read TWO ways: LlamaParse
 *                     (when LLAMA_CLOUD_API_KEY is set) and the PDF's own text
 *                     layer (unpdf); the reading that produced the potency
 *                     table wins (coa-extract-core pickPdfText)
 *   3. cross-checked + stored on lab_results.coa_extract_json (0252)
 *   4. the KB product's terpenes / cannabinoids filled (fill-only)
 *
 * Staging (intake-menu-staging.ts) then derives the serving facts from the
 * stored read (coa-facts-core deriveCoaDraftFacts), so a delivery's edibles
 * are filled from their certificates without a human.
 *
 * Best effort and bounded: links outside the allow-list are not fetched, every
 * fetch has a timeout and a size cap, nothing throws to the caller, and a
 * database without 0252 is reported as `migrated: false` (no writes).
 */
import "server-only";
import { lookup } from "node:dns/promises";
import { loadOwnerCoaHosts } from "@/lib/inventory/testing-labs-store";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isMissingIdentityColumnError } from "@/lib/catalog/identity-columns-core";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { extractPdfText } from "@/lib/inventory/pdf-extract";
import { isLlamaParseConfigured, parsePdf } from "@/lib/inbound-email/llamaparse-provider";
import {
  COA_FETCH_TIMEOUT_MS,
  COA_JSON_MAX_BYTES,
  COA_MAX_REDIRECTS,
  COA_PDF_MAX_BYTES,
  buildCoaExtract,
  dnsAnswerOk,
  needsDnsCheck,
  nextRedirectHop,
  contentTypeOk,
  type CoaExtractRun,
  isMissingColumnError,
  labExtractPatch,
  looksLikePdf,
  needsLlamaParse,
  pickPdfText,
  planKbFill,
  safeCoaUrl,
  type PdfTextCandidate,
} from "@/lib/inventory/coa-extract-core";
import type { CoaExtract } from "@/lib/inventory/coa-facts-core";

export type { CoaExtractRun };

const COA_BUCKET = "coa";
/** Certificates read per call (a delivery rarely has more than 40 lots). */
export const COA_EXTRACT_MAX_PER_RUN = 60;
/**
 * Wall-clock budget for one finalize pass. No NEW batch starts after it (a
 * batch already started finishes). Unread rows keep a null status and are
 * read by the next pass (re-finalize, restage, or the lot page button).
 */
export const COA_EXTRACT_BUDGET_MS = 150_000;

type LabRow = {
  id: string;
  coa_url: string | null;
  wcia_json_url: string | null;
  coa_storage_path: string | null;
  coa_extract_status: string | null;
};


const emptyRun = (migrated: boolean): CoaExtractRun => ({ migrated, pending: 0, deferred: 0, read: 0, ok: 0, partial: 0, failed: 0, kbFilled: 0, errors: [] });

/**
 * The owner's extra certificate hosts (testing_labs.coa_hosts, 0256), read
 * once per pass. Missing table / failed read -> built-in hosts only.
 */
export type HostContext = { extraHosts: readonly string[] };
const BUILT_INS_ONLY: HostContext = { extraHosts: [] };

export async function loadHostContext(): Promise<HostContext> {
  const { hosts } = await loadOwnerCoaHosts();
  return { extraHosts: hosts };
}

/**
 * OWASP SSRF guard for an owner-added host: every address it resolves to
 * must be public (a name pointing at 10.x / 169.254.169.254 / ::1 is
 * refused). Built-in hosts were verified by hand and skip this.
 */
async function dnsGuard(url: string): Promise<string | null> {
  if (!needsDnsCheck(url)) return null;
  const host = new URL(url).hostname;
  try {
    const answers = await lookup(host, { all: true, verbatim: true });
    const r = dnsAnswerOk(host, answers.map((a) => a.address));
    return r.ok ? null : r.reason;
  } catch (err) {
    return `${host} did not resolve (${err instanceof Error ? err.message : String(err)})`;
  }
}

async function fetchBounded(
  raw: string | null,
  kind: "json" | "pdf",
  ctx: HostContext = BUILT_INS_ONLY,
): Promise<{ bytes: Uint8Array | null; error: string | null }> {
  const safe = safeCoaUrl(raw, ctx.extraHosts);
  if (!safe.ok) return { bytes: null, error: safe.reason };
  const max = kind === "pdf" ? COA_PDF_MAX_BYTES : COA_JSON_MAX_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COA_FETCH_TIMEOUT_MS);
  try {
    // Redirects are followed BY HAND (R36): each hop is re-checked against
    // the allow-list (and DNS for owner hosts) BEFORE it is requested, so a
    // lab link can never bounce the server onto an internal address.
    let url = safe.url;
    let res: Response | null = null;
    for (let hop = 0; hop <= COA_MAX_REDIRECTS; hop += 1) {
      const dnsErr = await dnsGuard(url);
      if (dnsErr) return { bytes: null, error: dnsErr };
      res = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { Accept: kind === "pdf" ? "application/pdf" : "application/json" },
        cache: "no-store",
      });
      if (res.status < 300 || res.status > 399) break;
      if (hop === COA_MAX_REDIRECTS) return { bytes: null, error: `more than ${COA_MAX_REDIRECTS} redirects` };
      const next = nextRedirectHop(url, res.headers.get("location"), ctx.extraHosts);
      if (!next.ok) return { bytes: null, error: next.reason };
      url = next.url;
    }
    if (!res) return { bytes: null, error: "no answer" };
    if (!res.ok) return { bytes: null, error: `the lab answered HTTP ${res.status}` };
    // Belt and braces: a runtime that followed a redirect anyway must still
    // have landed on an allowed host.
    if (res.url && !safeCoaUrl(res.url, ctx.extraHosts).ok) return { bytes: null, error: `redirected off the lab host (${new URL(res.url).hostname})` };
    if (!contentTypeOk(kind, res.headers.get("content-type"))) {
      return { bytes: null, error: `unexpected content type ${res.headers.get("content-type") ?? "(none)"}` };
    }
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len > max) return { bytes: null, error: `too large (${len} bytes)` };
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0) return { bytes: null, error: "empty response" };
    if (buf.byteLength > max) return { bytes: null, error: `too large (${buf.byteLength} bytes)` };
    return { bytes: buf, error: null };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return { bytes: null, error: aborted ? `no answer within ${COA_FETCH_TIMEOUT_MS / 1000}s` : err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

async function pdfBytesFor(lab: LabRow, ctx: HostContext): Promise<{ bytes: Uint8Array | null; error: string | null }> {
  if (lab.coa_storage_path) {
    try {
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin.storage.from(COA_BUCKET).download(lab.coa_storage_path);
      if (!error && data) {
        const bytes = new Uint8Array(await data.arrayBuffer());
        if (looksLikePdf(bytes)) return { bytes, error: null };
      }
    } catch {
      // fall through to the link
    }
  }
  const got = await fetchBounded(lab.coa_url, "pdf", ctx);
  if (got.bytes && !looksLikePdf(got.bytes)) return { bytes: null, error: "the COA link did not return a PDF" };
  return got;
}

/** Read one lab row's certificate (both documents). Never throws. */
export async function readCoaForLab(
  lab: LabRow,
  opts: { actorId: string | null; alwaysLlama?: boolean; hosts?: HostContext } = { actorId: null },
): Promise<CoaExtract> {
  const ctx = opts.hosts ?? (await loadHostContext());
  const jsonGot = lab.wcia_json_url ? await fetchBounded(lab.wcia_json_url, "json", ctx) : { bytes: null, error: null };
  const jsonText = jsonGot.bytes ? new TextDecoder("utf-8").decode(jsonGot.bytes) : null;

  const candidates: PdfTextCandidate[] = [];
  const pdfGot = lab.coa_url || lab.coa_storage_path ? await pdfBytesFor(lab, ctx) : { bytes: null, error: "no COA link" };
  if (pdfGot.bytes) {
    // 1) The PDF's own text layer (free, about a second). Confident Cannabis
    //    certificates carry every number in it.
    try {
      candidates.push({ via: "unpdf", text: await extractPdfText(pdfGot.bytes.slice()), error: null });
    } catch (err) {
      candidates.push({ via: "unpdf", text: null, error: err instanceof Error ? err.message : String(err) });
    }
    // 2) LlamaParse whenever the text layer did NOT yield the potency table
    //    (image-style certificates such as the GGL ones), or always when the
    //    caller asks for it (the lot page button). The better reading wins.
    if (opts.alwaysLlama || needsLlamaParse(candidates)) {
      if (isLlamaParseConfigured()) {
        try {
          const lp = await parsePdf(pdfGot.bytes.slice(), {}, { feature: "coa-extract", entityType: "lab_result", entityId: lab.id, actorId: opts.actorId });
          candidates.unshift({ via: "llamaparse", text: lp.ok ? lp.text : null, error: lp.ok ? null : lp.error ?? lp.note ?? "LlamaParse read nothing" });
        } catch (err) {
          candidates.unshift({ via: "llamaparse", text: null, error: err instanceof Error ? err.message : String(err) });
        }
      } else {
        candidates.unshift({ via: "llamaparse", text: null, error: "LLAMA_CLOUD_API_KEY not set" });
      }
    }
  }
  const picked = pdfGot.bytes ? pickPdfText(candidates) : { text: null, via: "none" as const, error: pdfGot.error, considered: [] };
  return buildCoaExtract({
    jsonUrl: lab.wcia_json_url,
    transferCoaUrl: lab.coa_url,
    json: { text: jsonText, error: lab.wcia_json_url ? jsonGot.error : null },
    pdf: picked,
    at: new Date().toISOString(),
  });
}

/**
 * Fill-only KB terpenes / cannabinoids for the kb_products the lots point at.
 * inventory_lots.kb_product_id arrives with 0234: before it, there is no
 * link to follow (0 filled, not an error). Any other failed read or write
 * is REPORTED in errors, never swallowed.
 */
async function fillKbFromExtract(labId: string, extract: CoaExtract): Promise<{ filled: number; errors: string[] }> {
  const admin = createSupabaseAdminClient();
  const errors: string[] = [];
  const { data: lots, error: lotsErr } = await admin
    .from("inventory_lots")
    .select("kb_product_id")
    .eq("lab_result_id", labId)
    .not("kb_product_id", "is", null);
  if (lotsErr) {
    if (isMissingIdentityColumnError("inventory_lots", lotsErr)) return { filled: 0, errors };
    return { filled: 0, errors: [`knowledge base fill: the lots could not be read (${lotsErr.message})`] };
  }
  const ids = Array.from(new Set(((lots as { kb_product_id: string | null }[] | null) ?? []).map((l) => l.kb_product_id).filter((x): x is string => Boolean(x))));
  if (ids.length === 0) return { filled: 0, errors };
  const { data: kbs, error: kbErr } = await admin.from("kb_products").select("id, terpenes, cannabinoids").in("id", ids);
  if (kbErr) return { filled: 0, errors: [`knowledge base fill: the products could not be read (${kbErr.message})`] };
  let filled = 0;
  for (const kb of (kbs as { id: string; terpenes: string[] | null; cannabinoids: string[] | null }[] | null) ?? []) {
    const plan = planKbFill(extract, { terpenes: kb.terpenes, cannabinoids: kb.cannabinoids });
    const patch: Record<string, unknown> = {};
    if (plan.terpenes) patch.terpenes = plan.terpenes;
    if (plan.cannabinoids) patch.cannabinoids = plan.cannabinoids;
    if (Object.keys(patch).length === 0) continue;
    const { error } = await admin.from("kb_products").update(patch).eq("id", kb.id);
    if (error) errors.push(`knowledge base fill: product ${kb.id} was not updated (${error.message})`);
    else filled += 1;
  }
  return { filled, errors };
}

async function runForLabs(
  labIds: string[],
  opts: { force: boolean; actorId: string | null; alwaysLlama?: boolean; budgetMs?: number },
): Promise<CoaExtractRun> {
  const started = Date.now();
  if (!isSupabaseServiceConfigured || labIds.length === 0) return emptyRun(true);
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("lab_results")
    .select("id, coa_url, wcia_json_url, coa_storage_path, coa_extract_status")
    .in("id", labIds.slice(0, COA_EXTRACT_MAX_PER_RUN));
  if (isMissingColumnError(error)) return emptyRun(false);
  const run = emptyRun(true);
  if (error) {
    run.errors.push(error.message);
    return run;
  }
  const rows = ((data as LabRow[] | null) ?? []).filter((r) => opts.force || r.coa_extract_status !== "ok");
  run.pending = rows.length;
  // The owner's extra certificate hosts, read ONCE for the whole pass.
  const hosts = rows.length ? await loadHostContext() : BUILT_INS_ONLY;
  // Bounded concurrency: 4 certificates at a time, inside the time budget.
  for (let i = 0; i < rows.length; i += 4) {
    if (Date.now() - started > (opts.budgetMs ?? COA_EXTRACT_BUDGET_MS)) {
      run.deferred = rows.length - i;
      break;
    }
    await Promise.all(
      rows.slice(i, i + 4).map(async (lab) => {
        try {
          const extract = await readCoaForLab(lab, { actorId: opts.actorId, alwaysLlama: opts.alwaysLlama, hosts });
          const { error: upErr } = await admin.from("lab_results").update(labExtractPatch(extract)).eq("id", lab.id);
          if (upErr) {
            run.errors.push(`${lab.id}: ${upErr.message}`);
            return;
          }
          run.read += 1;
          run[extract.status] += 1;
          const kb = await fillKbFromExtract(lab.id, extract);
          run.kbFilled += kb.filled;
          for (const e of kb.errors) run.errors.push(`${lab.id}: ${e}`);
        } catch (err) {
          run.errors.push(`${lab.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }),
    );
  }
  return run;
}

/** Every certificate of a delivery (finalize). Already-read rows are skipped. */
export async function extractCoasForManifest(
  manifestId: string,
  actorId: string | null,
  opts: { budgetMs?: number } = {},
): Promise<CoaExtractRun> {
  if (!isSupabaseServiceConfigured) return emptyRun(true);
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("inventory_lots").select("lab_result_id").eq("manifest_id", manifestId).not("lab_result_id", "is", null);
  const ids = Array.from(new Set(((data as { lab_result_id: string | null }[] | null) ?? []).map((r) => r.lab_result_id).filter((x): x is string => Boolean(x))));
  return runForLabs(ids, { force: false, actorId, budgetMs: opts.budgetMs });
}

/** One lot's certificate, read again on demand (the lot page button). Always
 * asks LlamaParse too (when configured) so the owner gets the best reading. */
export async function extractCoaForLot(lotId: string, actorId: string | null): Promise<CoaExtractRun & { manifestId: string | null }> {
  if (!isSupabaseServiceConfigured) return { ...emptyRun(true), manifestId: null };
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("inventory_lots").select("lab_result_id, manifest_id").eq("id", lotId).maybeSingle();
  const lot = data as { lab_result_id: string | null; manifest_id: string | null } | null;
  if (!lot?.lab_result_id) return { ...emptyRun(true), errors: ["this lot has no lab result"], manifestId: lot?.manifest_id ?? null };
  return { ...(await runForLabs([lot.lab_result_id], { force: true, actorId, alwaysLlama: true })), manifestId: lot.manifest_id };
}
