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

/** Start a harvest, or resume the newest unfinished one (fresh=false). */
export async function startPosRun(fresh: boolean): Promise<{ runId: string; resumed: boolean }> {
  const res = await posFetch("/runs", { method: "POST", body: JSON.stringify({ fresh }) });
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

  const dataFiles = [...REQUIRED_FILES.filter((n) => n !== "manifest.json" && n !== "state.json"), ...optionalFilesToFetch(manifest).filter((n) => n === "batches.jsonl")];
  for (const name of dataFiles) {
    const b = await getFile(runId, name);
    const h = sha(b);
    const v = verifyFile(manifest, name, b.length, h);
    if (!v.ok) problems.push(v.reason);
    files.push({ name, bytes: b.length, sha256: h });
    bufs[name] = b;
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

  let assembled: AssembleResult | null = null;
  if (problems.length === 0) {
    assembled = assembleFromRun({
      inventoryExport: bufs["export_inventories.xlsx"],
      productExport: bufs["export_products.xlsx"],
      listLots,
      batches,
      harvestSeconds: typeof state.seconds === "number" ? state.seconds : Number.POSITIVE_INFINITY,
    });
  }
  const ageMinutes = harvestAgeMinutes(state.finishedAt, Date.now());
  return { runId, state, manifest, verified: problems.length === 0, verifyProblems: problems, assembled, files, ageMinutes };
}
