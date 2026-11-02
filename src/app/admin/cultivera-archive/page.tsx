import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui";
import { StatCard } from "@/components/admin/StatCard";
import { FetchRunAutoRefresh } from "@/components/admin/catalog/FetchRunAutoRefresh";
import { getArchiveRun, listArchiveRuns, type ArchiveRun } from "@/lib/reports/cultivera-archive-client";
import { isValidArchiveRunId } from "@/lib/reports/cultivera-benchmark-core";
import { archiveRunSummary, datasetRollup, formatBytes } from "@/lib/reports/cultivera-archive-core";
import {
  benchmarkDaysSpan,
  getArchivedRun,
  listArchivedFiles,
  listArchivedRuns,
  type ArchivedFile,
  type ArchivedRun,
} from "@/lib/reports/cultivera-benchmark-store";
import { archiveRunAction, cancelArchiveAction, rebuildDaysAction, startArchiveAction } from "./actions";

/**
 * CVB-5 - Admin -> Cultivera Archive (owner only). Run the read-only harvest of Cultivera's back office, watch
 * it, then copy the finished run into our private storage (every file checked against its sha256) and store
 * Cultivera's daily figures for Reports -> Cultivera Benchmark.
 */
export const dynamic = "force-dynamic";
// Archive downloads, checks and stores every file; it stops starting new files at 200 s and resumes on the next press.
export const maxDuration = 300;

const n = (v: number) => v.toLocaleString("en-US");

export default async function CultiveraArchivePage({
  searchParams,
}: {
  searchParams: Promise<{
    run?: string;
    error?: string;
    partial?: string;
    uploaded?: string;
    remaining?: string;
    total?: string;
    archived?: string;
    days?: string;
    written?: string;
    kept?: string;
    problems?: string;
    conflicts?: string;
  }>;
}) {
  await requirePermission("cultivera.benchmark");
  const sp = await searchParams;

  let loadError: string | null = null;
  let runId = sp.run && isValidArchiveRunId(sp.run) ? sp.run : null;
  let run: ArchiveRun | null = null;
  try {
    if (!runId) runId = (await listArchiveRuns())[0] ?? null;
    if (runId) run = await getArchiveRun(runId);
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Could not reach the crawler.";
  }
  const summary = archiveRunSummary(Boolean(run?.active), run?.state ?? null);

  let stored: ArchivedRun | null = null;
  let storedFiles: ArchivedFile[] = [];
  let archived: ArchivedRun[] = [];
  let span: { first: string | null; last: string | null; days: number } = { first: null, last: null, days: 0 };
  let dbError: string | null = null;
  try {
    archived = await listArchivedRuns();
    if (runId) stored = await getArchivedRun(runId);
    if (stored) storedFiles = await listArchivedFiles(stored.runId);
    span = await benchmarkDaysSpan();
  } catch (e) {
    dbError = e instanceof Error ? e.message : "Could not read the archive tables.";
  }
  const manifestFiles = (run?.manifest?.files ?? []).map((f) => ({ name: f.name, bytes: f.bytes, rows: f.rows ?? null }));
  const rollup = datasetRollup(stored ? storedFiles : manifestFiles);
  const totalBytes = rollup.reduce((a, r) => a + r.bytes, 0);
  const win = run?.state?.window ?? run?.manifest?.window ?? null;

  return (
    <div>
      <AdminPageHeader
        title="Cultivera Archive"
        subtitle="Keep a complete, checked copy of everything in Cultivera's back office, and feed the Cultivera Benchmark report."
        breadcrumbs={<Breadcrumbs items={[{ label: "Lyman" }, { label: "Cultivera Archive" }]} />}
        help={
          <HelpPanel
            id="cultivera-archive"
            title="How the Cultivera archive works"
            steps={[
              "Press Start harvest. The crawler signs in to Cultivera with its own saved login and reads every report and list, slowly. It only reads; it can never change anything in Cultivera.",
              "It stops by itself after its time limit. Press Continue and it picks up where it stopped; nothing is read twice.",
              "When it says Finished, press Archive. Every file is downloaded, checked against the fingerprint (sha256) the crawler recorded, and stored in our private storage. A file is never overwritten.",
              "Archive also stores Cultivera's own daily sales figures (in cents) for Reports \u2192 Cultivera Benchmark.",
              "If Archive runs out of time it tells you how many files are left. Press it again to carry on.",
            ]}
          >
            <p>
              Only the owner can open this page. The copy includes customer and employee lists, so it is kept in a
              private bucket that only the server can read. Do the harvest before the Cultivera account is closed:
              after that, this archive is the only copy.
            </p>
          </HelpPanel>
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        <FetchRunAutoRefresh active={summary.running} everyMs={15_000} />

        {(sp.error || loadError || dbError) && (
          <div data-testid="cva-error" className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {sp.error ?? loadError ?? dbError}
          </div>
        )}
        {sp.partial && (
          <div data-testid="cva-partial" className="rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 px-4 py-3 text-sm text-[var(--admin-gold)]">
            Copied {n(Number(sp.uploaded ?? 0))} files this time; {n(Number(sp.remaining ?? 0))} of {n(Number(sp.total ?? 0))} are still to copy. Press
            Archive again to carry on (nothing is copied twice).
          </div>
        )}
        {sp.archived && (
          <div data-testid="cva-archived" className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm text-[var(--admin-accent)]">
            Archived. Cultivera daily figures: {n(Number(sp.days ?? 0))} days read, {n(Number(sp.written ?? 0))} stored,{" "}
            {n(Number(sp.kept ?? 0))} kept from a newer harvest.
            {Number(sp.problems ?? 0) > 0 && ` ${n(Number(sp.problems))} rows could not be read and were left out.`}
            {Number(sp.conflicts ?? 0) > 0 && ` ${n(Number(sp.conflicts))} days had two different answers and were left out.`}
          </div>
        )}

        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-white">{runId ? `Harvest ${runId}` : "No harvest yet"}</h2>
              <p data-testid="cva-line" className="mt-1 text-sm text-white/70">{summary.line}</p>
              {win?.from && win?.to && (
                <p className="mt-1 text-xs text-white/50">
                  Dates covered: {win.from} to {win.to} (Pacific).
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {summary.running && run ? (
                <form action={cancelArchiveAction}>
                  <input type="hidden" name="run_id" value={run.runId} />
                  <Button type="submit" variant="neutral">Stop (resumable)</Button>
                </form>
              ) : (
                <form action={startArchiveAction} className="flex items-center gap-3">
                  {!summary.canResume && runId && (
                    <label className="flex items-center gap-1 text-xs text-white/60">
                      <input type="checkbox" name="fresh" defaultChecked /> new harvest
                    </label>
                  )}
                  <Button type="submit" variant="primary">{summary.canResume ? "Continue harvest" : "Start harvest"}</Button>
                </form>
              )}
              {summary.canArchive && run && !stored && (
                <form action={archiveRunAction}>
                  <input type="hidden" name="run_id" value={run.runId} />
                  <Button type="submit" variant="confirm">Archive to our storage</Button>
                </form>
              )}
              {stored && (
                <form action={rebuildDaysAction}>
                  <input type="hidden" name="run_id" value={stored.runId} />
                  <Button type="submit" variant="neutral">Rebuild daily figures</Button>
                </form>
              )}
            </div>
          </div>

          <ol data-testid="cva-stages" className="mt-4 grid gap-2 sm:grid-cols-2">
            {summary.stages.map((s) => (
              <li key={s.stage} className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2 text-xs">
                <span className="text-white/80">{s.label}</span>
                <span className={s.status === "done" ? "text-[var(--admin-accent)]" : s.status === "running" ? "text-[var(--admin-gold)]" : "text-white/40"}>
                  {s.status === "done" ? `done${s.seconds !== null ? ` (${Math.round(s.seconds)} s)` : ""}` : s.status === "running" ? "reading\u2026" : "waiting"}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <div className="grid gap-4 sm:grid-cols-4">
          <StatCard label="Datasets" value={n(rollup.length)} hint={stored ? "in our storage" : "in this harvest"} accent="muted" />
          <StatCard label="Rows" value={n(rollup.reduce((a, r) => a + (r.rows ?? 0), 0))} hint="as counted by the crawler" accent="muted" />
          <StatCard label="Size" value={formatBytes(totalBytes)} hint={stored ? `${n(stored.fileCount)} files stored` : "not stored yet"} accent={stored ? "green" : "gold"} />
          <StatCard
            label="Cultivera daily figures"
            value={n(span.days)}
            hint={span.first && span.last ? `${span.first} to ${span.last}` : "none stored yet"}
            accent={span.days > 0 ? "green" : "muted"}
          />
        </div>

        {stored && (
          <p data-testid="cva-stored" className="text-xs text-white/60">
            Stored {stored.archivedAt.slice(0, 10)}; captured from Cultivera {stored.capturedAt.slice(0, 19).replace("T", " ")} UTC. Manifest fingerprint{" "}
            <code className="text-white/80">{`${stored.manifestSha256.slice(0, 16)}\u2026`}</code>.
          </p>
        )}

        {rollup.length > 0 && (
          <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
            <h2 className="text-sm font-semibold text-white">{stored ? "What is in our storage" : "What this harvest holds"}</h2>
            <table data-testid="cva-datasets" className="mt-3 w-full text-left text-xs">
              <thead className="text-white/50">
                <tr>
                  <th className="py-1 pr-3">Dataset</th>
                  <th className="py-1 pr-3 text-right">Files</th>
                  <th className="py-1 pr-3 text-right">Rows</th>
                  <th className="py-1 text-right">Size</th>
                </tr>
              </thead>
              <tbody className="text-white/80">
                {rollup.map((r) => (
                  <tr key={r.dataset} className="border-t border-white/5">
                    <td className="py-1 pr-3 font-mono">{r.dataset}</td>
                    <td className="py-1 pr-3 text-right">{n(r.files)}</td>
                    <td className="py-1 pr-3 text-right">{r.rows === null ? "\u2014" : n(r.rows)}</td>
                    <td className="py-1 text-right">{formatBytes(r.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {archived.length > 0 && (
          <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
            <h2 className="text-sm font-semibold text-white">Archived harvests</h2>
            <ul className="mt-2 space-y-1 text-xs text-white/70">
              {archived.map((a) => (
                <li key={a.runId}>
                  <a className="underline" href={`/admin/cultivera-archive?run=${a.runId}`}>{a.runId}</a>: {n(a.fileCount)} files,{" "}
                  {n(a.totalRows)} rows, {formatBytes(a.totalBytes)}; captured {a.capturedAt.slice(0, 10)}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
