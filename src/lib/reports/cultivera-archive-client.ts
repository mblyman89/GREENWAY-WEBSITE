/**
 * src/lib/reports/cultivera-archive-client.ts  (CVB-5, server-only)
 *
 * The site side of the Cultivera archive harvester (CVB-2, crawler/app/cultivera_archive*.py). Talks to the
 * crawler's `/cultivera-archive/runs...` endpoints with the same CRAWLER_BASE_URL + CRAWLER_SHARED_SECRET pair
 * every crawler feature uses; the Cultivera login lives ONLY on the crawler. Every downloaded file is checked
 * against the run's manifest (bytes + sha256) before it is used or stored.
 */
import "server-only";
import crypto from "node:crypto";
import { crawlerBaseUrl, isCrawlerConfigured, CrawlerNotConfiguredError } from "@/lib/ai/crawler-client";
import { verifyFile, type Manifest } from "@/lib/pos/cultivera-fetch-button-core";
import { isValidArchiveRunId } from "@/lib/reports/cultivera-benchmark-core";
import { MANIFEST_FILE, type ArchiveState } from "@/lib/reports/cultivera-archive-core";

const secret = (process.env.CRAWLER_SHARED_SECRET ?? "").trim();

async function afetch(path: string, init?: RequestInit, timeoutMs = 20_000): Promise<Response> {
  if (!isCrawlerConfigured()) throw new CrawlerNotConfiguredError();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${crawlerBaseUrl}/cultivera-archive${path}`, {
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

/** Start a harvest, or continue the newest unfinished one (fresh=false). 409 = another Cultivera crawl is running. */
export async function startArchiveRun(fresh: boolean): Promise<{ runId: string; resumed: boolean }> {
  const res = await afetch("/runs", { method: "POST", body: JSON.stringify({ fresh }) });
  if (res.status === 409) throw new Error("Another Cultivera crawl is running (archive, loyalty or cutover). Try again when it finishes.");
  if (res.status !== 202 && !res.ok) throw new Error(`Crawler responded ${res.status}: ${await detail(res)}`);
  const d = (await res.json()) as { runId: string; resumed: boolean };
  if (!isValidArchiveRunId(String(d.runId))) throw new Error("Crawler returned an invalid run id.");
  return { runId: d.runId, resumed: Boolean(d.resumed) };
}

export async function listArchiveRuns(): Promise<string[]> {
  const res = await afetch("/runs");
  if (!res.ok) throw new Error(`Crawler responded ${res.status}: ${await detail(res)}`);
  return (((await res.json()) as { runs?: string[] }).runs ?? []).filter(isValidArchiveRunId);
}

export type ArchiveManifest = Omit<Manifest, "files"> & {
  files?: { name: string; bytes: number; sha256: string; rows?: number | null; dataset?: string | null }[];
  window?: { from?: string; to?: string } | null;
  startedAt?: string;
};
export type ArchiveRun = { runId: string; active: boolean; state: ArchiveState | null; manifest: ArchiveManifest | null };

export async function getArchiveRun(runId: string): Promise<ArchiveRun | null> {
  if (!isValidArchiveRunId(runId)) return null;
  const res = await afetch(`/runs/${runId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Crawler responded ${res.status}: ${await detail(res)}`);
  const d = (await res.json()) as { runId: string; active: boolean; state: ArchiveState | null; manifest: ArchiveManifest | null };
  return { runId: d.runId, active: Boolean(d.active), state: d.state ?? null, manifest: d.manifest ?? null };
}

export async function cancelArchiveRun(runId: string): Promise<boolean> {
  if (!isValidArchiveRunId(runId)) return false;
  const res = await afetch(`/runs/${runId}/cancel`, { method: "POST" });
  if (!res.ok) throw new Error(`Crawler responded ${res.status}: ${await detail(res)}`);
  return Boolean(((await res.json()) as { cancelRequested?: boolean }).cancelRequested);
}

export const sha256Hex = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

/** One file of a run, byte-for-byte the one the manifest lists (bytes + sha256), or an error. */
export async function verifiedArchiveFile(runId: string, manifest: ArchiveManifest, name: string): Promise<Buffer> {
  const res = await afetch(`/runs/${runId}/files/${encodeURIComponent(name)}`, undefined, 120_000);
  if (!res.ok) throw new Error(`${name}: crawler responded ${res.status}`);
  const b = Buffer.from(await res.arrayBuffer());
  const v = verifyFile(manifest, name, b.length, sha256Hex(b));
  if (!v.ok) throw new Error(v.reason);
  return b;
}

/**
 * The manifest file's exact bytes. They are what is stored in the bucket as manifest.json, and their sha256
 * is cultivera_archive_runs.manifest_sha256, so anyone can later prove which manifest a run was archived from.
 * The bytes are re-parsed and must list exactly the files the status endpoint reported.
 */
export async function manifestBytes(runId: string, expected: ArchiveManifest): Promise<Buffer> {
  const res = await afetch(`/runs/${runId}/files/${MANIFEST_FILE}`, undefined, 60_000);
  if (!res.ok) throw new Error(`${MANIFEST_FILE}: crawler responded ${res.status}`);
  const b = Buffer.from(await res.arrayBuffer());
  let parsed: ArchiveManifest;
  try {
    parsed = JSON.parse(b.toString("utf8")) as ArchiveManifest;
  } catch {
    throw new Error(`${MANIFEST_FILE} is not readable JSON.`);
  }
  const key = (m: ArchiveManifest) => JSON.stringify((m.files ?? []).map((f) => [f.name, f.bytes, f.sha256]));
  if (key(parsed) !== key(expected)) throw new Error(`${MANIFEST_FILE} changed while archiving; reload the page and try again.`);
  return b;
}
