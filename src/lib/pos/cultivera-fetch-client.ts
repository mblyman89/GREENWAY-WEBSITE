/**
 * src/lib/pos/cultivera-fetch-client.ts — R50 S9: the site side of the cutover button (server-only).
 *
 * Talks to the crawler's `/cultivera-pos/runs…` endpoints (same CRAWLER_BASE_URL +
 * CRAWLER_SHARED_SECRET pair every crawler feature uses; Cultivera credentials live
 * ONLY on the crawler as CULTIVERA_POS_USERNAME / CULTIVERA_POS_PASSWORD — never here).
 *
 * Every call is short (start returns 202 and the harvest runs in a crawler thread),
 * so the Cloudflare-tunnel ~100 s limit never applies. `loadRunForImport` downloads
 * the run's files, verifies each against manifest.json (bytes + sha256), and runs
 * `assembleFromRun`. Decisions live in cultivera-fetch-button-core.ts.
 */
import "server-only";
import crypto from "node:crypto";
import { crawlerBaseUrl, isCrawlerConfigured, CrawlerNotConfiguredError } from "@/lib/ai/crawler-client";
import { assembleFromRun, type AssembleResult, type BatchRecord } from "@/lib/pos/cultivera-fetch-assemble";
import type { ListLot } from "@/lib/pos/cultivera-fetch-core";
import { pacificDayKey } from "@/lib/reports/timezone";
import { buildPlanInputs, type RehomePlanInputs } from "@/lib/inventory/cultivera-rehome-core";
import type { WciaRunRecord } from "@/lib/inventory/cultivera-wcia-core";
import {
  REQUIRED_FILES,
  harvestAgeMinutes,
  optionalFilesToFetch,
  parseJsonl,
  verifyFile,
  type CrawlerRun,
  type CrawlerState,
  type Manifest,
} from "@/lib/pos/cultivera-fetch-button-core";

const secret = (process.env.CRAWLER_SHARED_SECRET ?? "").trim();
const RUN_ID_RE = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/;

export function isValidRunId(id: string): boolean {
  return RUN_ID_RE.test(id);
}

async function posFetch(path: string, init?: RequestInit, timeoutMs = 20_000): Promise<Response> {
  if (!isCrawlerConfigured()) throw new CrawlerNotConfiguredError();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${crawlerBaseUrl}/cultivera-pos${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", "X-Crawler-Secret": secret, ...(init?.headers ?? {}) },
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(t);
  }
}

async function detail(res: Response): Promise<string> {
  try {
    const d = (await res.json()) as { detail?: string };
    return d.detail ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

/**
 * Start a harvest, or resume the newest unfinished one (fresh=false). R50 S11: `salesFrom`
 * (YYYY-MM-DD, the day after the Oct 30 count) makes the crawler also read Cultivera's Sales
 * Details from that day through today; omitted for every other harvest.
 */
export async function startPosRun(fresh: boolean, salesFrom?: string | null): Promise<{ runId: string; resumed: boolean }> {
  if (salesFrom != null && !/^\d{4}-\d{2}-\d{2}$/.test(salesFrom)) throw new Error("The sales day must be YYYY-MM-DD.");
  const body: Record<string, unknown> = { fresh };
  if (salesFrom) body.salesFrom = salesFrom;
  const res = await posFetch("/runs", { method: "POST", body: JSON.stringify(body) });
  if (res.status !== 202 && !res.ok) throw new Error(`Crawler responded ${res.status}: ${await detail(res)}`);
  const d = (await res.json()) as { runId: string; resumed: boolean };
  if (!isValidRunId(String(d.runId))) throw new Error("Crawler returned an invalid run id.");
  return { runId: d.runId, resumed: Boolean(d.resumed) };
}

export async function listPosRuns(): Promise<string[]> {
  const res = await posFetch("/runs");
  if (!res.ok) throw new Error(`Crawler responded ${res.status}: ${await detail(res)}`);
  const d = (await res.json()) as { runs?: string[] };
  return (d.runs ?? []).filter(isValidRunId);
}

export async function getPosRun(runId: string): Promise<CrawlerRun | null> {
  if (!isValidRunId(runId)) return null;
  const res = await posFetch(`/runs/${runId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Crawler responded ${res.status}: ${await detail(res)}`);
  const d = (await res.json()) as { runId: string; active: boolean; state: CrawlerState | null };
  return { runId: d.runId, active: Boolean(d.active), state: d.state ?? null };
}

export async function cancelPosRun(runId: string): Promise<boolean> {
  if (!isValidRunId(runId)) return false;
  const res = await posFetch(`/runs/${runId}/cancel`, { method: "POST" });
  if (!res.ok) throw new Error(`Crawler responded ${res.status}: ${await detail(res)}`);
  return Boolean(((await res.json()) as { cancelRequested?: boolean }).cancelRequested);
}

async function getFile(runId: string, name: string): Promise<Buffer> {
  const res = await posFetch(`/runs/${runId}/files/${encodeURIComponent(name)}`, undefined, 120_000);
  if (!res.ok) throw new Error(`${name}: crawler responded ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

export type LoadedRun = {
  runId: string;
  state: CrawlerState;
  manifest: Manifest;
  verified: boolean;
  verifyProblems: string[];
  assembled: AssembleResult | null;
  /** Minutes since the harvest finished, read on the server at load time. */
  ageMinutes: number | null;
  /** sha256 of every verified file — recorded in the audit row. */
  files: { name: string; bytes: number; sha256: string }[];
  /**
   * R50 S2c: the manifest plan's non-workbook inputs for the import this run
   * becomes (no prices). null when the run has no transfer details. Persisted at
   * import time so Apply still works after the crawler prunes the run.
   */
  planInputsFor: ((importId: string) => RehomePlanInputs) | null;
  /**
   * R50 S3b: the vendors' WCIA transfer files (wcia_json.jsonl), verified on their own. Enrichment
   * only: a missing or unverifiable file is reported here and NEVER refuses the import.
   */
  wcia: { records: WciaRunRecord[]; problem: string | null; file: { name: string; bytes: number; sha256: string } | null };
  /**
   * R50 S11: Cultivera's Sales Details for the Oct 30 count roll-forward (sales.jsonl +
   * sales_summary.json), each verified against the manifest. Raw bytes are kept unchanged so the
   * count page reads exactly what the crawler wrote. Never refuses the import: a missing or
   * unverifiable file is reported here and the count page refuses instead.
   */
  sales: SalesFiles;
};

export type SalesFiles = {
  lines: Buffer | null;
  summary: Buffer | null;
  problem: string | null;
  files: { name: string; bytes: number; sha256: string }[];
};

/**
 * Download a finished run, verify every file against its manifest, and assemble the
 * two workbooks. Never throws for a verification problem — it is reported so the
 * gate (importDecision) refuses with the reason.
 */
export async function loadRunForImport(runId: string): Promise<LoadedRun> {
  if (!isValidRunId(runId)) throw new Error("Invalid run id.");
  const manifestBuf = await getFile(runId, "manifest.json");
  const stateBuf = await getFile(runId, "state.json");
  const manifest = JSON.parse(manifestBuf.toString("utf8")) as Manifest;
  const state = JSON.parse(stateBuf.toString("utf8")) as CrawlerState;
  const problems: string[] = [];
  const files: LoadedRun["files"] = [];
  const bufs: Record<string, Buffer> = {};

  const dataFiles = [...REQUIRED_FILES.filter((n) => n !== "manifest.json" && n !== "state.json"), ...optionalFilesToFetch(manifest).filter((n) => n === "batches.jsonl" || n === "transfer_details.jsonl")];
  for (const name of dataFiles) {
    const b = await getFile(runId, name);
    const h = sha(b);
    const v = verifyFile(manifest, name, b.length, h);
    if (!v.ok) problems.push(v.reason);
    files.push({ name, bytes: b.length, sha256: h });
    bufs[name] = b;
  }
  // R50 S3b: the vendor transfer files are verified apart from the gate's files.
  const wcia: LoadedRun["wcia"] = { records: [], problem: null, file: null };
  if (optionalFilesToFetch(manifest).includes("wcia_json.jsonl")) {
    try {
      const b = await getFile(runId, "wcia_json.jsonl");
      const h = sha(b);
      const v = verifyFile(manifest, "wcia_json.jsonl", b.length, h);
      wcia.file = { name: "wcia_json.jsonl", bytes: b.length, sha256: h };
      if (!v.ok) wcia.problem = v.reason;
      else {
        const pj = parseJsonl<WciaRunRecord>(b.toString("utf8"));
        wcia.records = pj.records;
        if (pj.bad > 0) wcia.problem = `wcia_json.jsonl has ${pj.bad} unreadable lines (the readable ones are kept).`;
      }
    } catch (e) {
      wcia.problem = `wcia_json.jsonl could not be downloaded: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  // R50 S11: the count's sales files, verified on their own (both or neither).
  const sales: SalesFiles = { lines: null, summary: null, problem: null, files: [] };
  const salesListed = optionalFilesToFetch(manifest).filter((n) => n === "sales.jsonl" || n === "sales_summary.json");
  if (salesListed.length === 1) sales.problem = `The run lists ${salesListed[0]} without its partner file.`;
  else if (salesListed.length === 2) {
    try {
      const got: Record<string, Buffer> = {};
      for (const name of ["sales.jsonl", "sales_summary.json"]) {
        const b = await getFile(runId, name);
        const h = sha(b);
        const v = verifyFile(manifest, name, b.length, h);
        sales.files.push({ name, bytes: b.length, sha256: h });
        if (!v.ok) sales.problem = (sales.problem ? sales.problem + " " : "") + v.reason;
        got[name] = b;
      }
      if (!sales.problem) {
        sales.lines = got["sales.jsonl"];
        sales.summary = got["sales_summary.json"];
      }
    } catch (e) {
      sales.problem = `The sales files could not be downloaded: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  if (manifest.status !== "done" || state.status !== "done") problems.push(`The harvest status is "${state.status ?? "unknown"}", not done.`);

  let listLots: ListLot[] = [];
  try {
    const inv = JSON.parse(bufs["inventories.json"].toString("utf8")) as { data?: ListLot[] };
    if (!Array.isArray(inv.data)) problems.push("inventories.json has no data array.");
    else listLots = inv.data;
  } catch {
    problems.push("inventories.json is not valid JSON.");
  }
  let batches: BatchRecord[] = [];
  if (bufs["batches.jsonl"]) {
    const pj = parseJsonl<BatchRecord>(bufs["batches.jsonl"].toString("utf8"));
    if (pj.bad > 0) problems.push(`batches.jsonl has ${pj.bad} unreadable lines.`);
    batches = pj.records;
  }

  // R50 S10: the real transfers → manifest plan + §3b.6 "Manifest plan" check. A run whose list lots
  // link transfers but has no transfer_details is refused (the plan would silently be skipped).
  let transferDetails: unknown[] | undefined;
  if (bufs["transfer_details.jsonl"]) {
    const pj = parseJsonl<Record<string, unknown>>(bufs["transfer_details.jsonl"].toString("utf8"));
    if (pj.bad > 0) problems.push(`transfer_details.jsonl has ${pj.bad} unreadable lines.`);
    transferDetails = pj.records;
  } else if (listLots.some((l) => typeof l.IncomingTransferId === "number" && l.IncomingTransferId > 0)) {
    problems.push("Lots link to Cultivera transfers but the run has no transfer_details.jsonl.");
  }

  // One harvest day for the preview plan AND the persisted plan inputs (never two clocks).
  const harvestDay = pacificDayKey(state.finishedAt ?? new Date());
  let assembled: AssembleResult | null = null;
  if (problems.length === 0) {
    assembled = assembleFromRun({
      inventoryExport: bufs["export_inventories.xlsx"],
      productExport: bufs["export_products.xlsx"],
      listLots,
      batches,
      harvestSeconds: typeof state.seconds === "number" ? state.seconds : Number.POSITIVE_INFINITY,
      transferDetails,
      pacificToday: harvestDay,
    });
  }
  const ageMinutes = harvestAgeMinutes(state.finishedAt, Date.now());
  const planInputsFor =
    transferDetails && problems.length === 0
      ? (importId: string) => buildPlanInputs({ importId, runId, pacificToday: harvestDay, transferDetails: transferDetails!, listLots })
      : null;
  return { runId, state, manifest, verified: problems.length === 0, verifyProblems: problems, assembled, files, ageMinutes, planInputsFor, wcia, sales };
}
