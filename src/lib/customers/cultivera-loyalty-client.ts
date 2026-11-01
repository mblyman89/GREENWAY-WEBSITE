/**
 * src/lib/customers/cultivera-loyalty-client.ts  (CVL, server-only)
 *
 * The site side of the customer loyalty crawl. Talks to the crawler's
 * `/cultivera-loyalty/runs...` endpoints with the same CRAWLER_BASE_URL +
 * CRAWLER_SHARED_SECRET pair every crawler feature uses (the Cultivera login
 * lives ONLY on the crawler). Every file is verified against the run's
 * manifest (bytes + sha256) before it is used.
 */
import "server-only";
import crypto from "node:crypto";
import { crawlerBaseUrl, isCrawlerConfigured, CrawlerNotConfiguredError } from "@/lib/ai/crawler-client";
import { verifyFile, type Manifest } from "@/lib/pos/cultivera-fetch-button-core";
import {
  ACCRUAL_FILE,
  LOYALTY_FILE,
  parseLoyaltyJsonl,
  type AccrualFile,
  type CrawlState,
  type CrawledLoyalty,
} from "@/lib/customers/cultivera-loyalty-core";

const secret = (process.env.CRAWLER_SHARED_SECRET ?? "").trim();
const RUN_ID_RE = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/;

export function isValidLoyaltyRunId(id: string): boolean {
  return RUN_ID_RE.test(id);
}

async function lfetch(path: string, init?: RequestInit, timeoutMs = 20_000): Promise<Response> {
  if (!isCrawlerConfigured()) throw new CrawlerNotConfiguredError();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${crawlerBaseUrl}/cultivera-loyalty${path}`, {
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

export async function startLoyaltyRun(fresh: boolean): Promise<{ runId: string; resumed: boolean }> {
  const res = await lfetch("/runs", { method: "POST", body: JSON.stringify({ fresh }) });
  if (res.status !== 202 && !res.ok) throw new Error(`Crawler responded ${res.status}: ${await detail(res)}`);
  const d = (await res.json()) as { runId: string; resumed: boolean };
  if (!isValidLoyaltyRunId(String(d.runId))) throw new Error("Crawler returned an invalid run id.");
  return { runId: d.runId, resumed: Boolean(d.resumed) };
}

export async function listLoyaltyRuns(): Promise<string[]> {
  const res = await lfetch("/runs");
  if (!res.ok) throw new Error(`Crawler responded ${res.status}: ${await detail(res)}`);
  return (((await res.json()) as { runs?: string[] }).runs ?? []).filter(isValidLoyaltyRunId);
}

export type LoyaltyRun = { runId: string; active: boolean; state: CrawlState | null; manifest: Manifest | null };

export async function getLoyaltyRun(runId: string): Promise<LoyaltyRun | null> {
  if (!isValidLoyaltyRunId(runId)) return null;
  const res = await lfetch(`/runs/${runId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Crawler responded ${res.status}: ${await detail(res)}`);
  const d = (await res.json()) as { runId: string; active: boolean; state: CrawlState | null; manifest: Manifest | null };
  return { runId: d.runId, active: Boolean(d.active), state: d.state ?? null, manifest: d.manifest ?? null };
}

export async function cancelLoyaltyRun(runId: string): Promise<boolean> {
  if (!isValidLoyaltyRunId(runId)) return false;
  const res = await lfetch(`/runs/${runId}/cancel`, { method: "POST" });
  if (!res.ok) throw new Error(`Crawler responded ${res.status}: ${await detail(res)}`);
  return Boolean(((await res.json()) as { cancelRequested?: boolean }).cancelRequested);
}

const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

async function verifiedFile(runId: string, manifest: Manifest, name: string): Promise<Buffer> {
  const res = await lfetch(`/runs/${runId}/files/${encodeURIComponent(name)}`, undefined, 120_000);
  if (!res.ok) throw new Error(`${name}: crawler responded ${res.status}`);
  const b = Buffer.from(await res.arrayBuffer());
  const v = verifyFile(manifest, name, b.length, sha(b));
  if (!v.ok) throw new Error(v.reason);
  return b;
}

export type LoadedLoyaltyRun = {
  runId: string;
  finishedAt: string | null;
  records: CrawledLoyalty[];
  badLines: number;
  accrual: AccrualFile | null;
  files: { name: string; bytes: number; sha256: string }[];
};

/** Download + verify a FINISHED run's loyalty records and accrual sums. */
export async function loadLoyaltyRun(runId: string): Promise<LoadedLoyaltyRun> {
  const run = await getLoyaltyRun(runId);
  if (!run) throw new Error("Unknown run.");
  if (run.active || run.state?.status !== "done" || !run.manifest) throw new Error("The crawl has not finished yet.");
  const manifest = run.manifest;
  const lb = await verifiedFile(runId, manifest, LOYALTY_FILE);
  const parsed = parseLoyaltyJsonl(lb.toString("utf8"));
  let accrual: AccrualFile | null = null;
  if ((manifest.files ?? []).some((f) => f.name === ACCRUAL_FILE)) {
    accrual = JSON.parse((await verifiedFile(runId, manifest, ACCRUAL_FILE)).toString("utf8")) as AccrualFile;
  }
  const files = (manifest.files ?? []).filter((f) => f.name === LOYALTY_FILE || f.name === ACCRUAL_FILE);
  return { runId, finishedAt: (manifest as { finishedAt?: string }).finishedAt ?? null, records: parsed.records, badLines: parsed.bad, accrual, files };
}
