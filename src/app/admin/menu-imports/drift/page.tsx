import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui";
import { isSafeImportId } from "@/lib/inventory/import-lineage-core";
import { listReconcileImports, type ReconcileImport } from "@/lib/pos/cultivera-reconcile";
import { loadDrift, loadDriftChecks, type DriftLoad } from "@/lib/pos/cutover-drift";
import {
  DRIFT_FIRST_DAY,
  DRIFT_LAST_DAY,
  DRIFT_LINE_CAP,
  checksByDate,
  driftDates,
  driftLineNote,
  driftPhase,
  driftShouldRun,
  signedNum,
  type DriftCheckRecord,
  type DriftGroup,
} from "@/lib/pos/cutover-drift-core";
import { recordDriftCheckAction } from "./actions";

/**
 * R50 A6 - "Did anything drift today?" The daily check for the first week
 * after the cutover (11/02 to 11/08): for every product on the cutover import,
 * on hand now must equal Cultivera's units plus every recorded change (counts,
 * returns, adjustments, our sales, our voids). Read-only; the one button only
 * records that today's check was run. After 11/08 it is switched off (the page
 * says so and loads nothing unless asked once).
 */
export const dynamic = "force-dynamic";

const CHECK_LABEL: Record<string, string> = {
  reads: "Everything was read",
  lots: "The import has lots",
  drift: "Every unit is explained",
  decrements: "No sale failed to take its units off",
  whole: "Every quantity is a whole number",
};

const n = (v: number) => v.toLocaleString("en-US");
const when = (iso: string) => iso.slice(0, 16).replace("T", " ") + " UTC";

function nowMs(): number {
  return Date.now();
}

type SP = { import?: string; notice?: string; error?: string; anyway?: string };

function GroupTable({ title, rows, testid }: { title: string; rows: DriftGroup[]; testid: string }) {
  return (
    <div data-testid={testid}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-white/50">{title}</h3>
      <table className="mt-2 w-full text-left text-xs text-white/80">
        <thead className="text-white/50">
          <tr>
            <th className="py-1 pr-2">Name</th>
            <th className="py-1 pr-2 text-right">Cultivera</th>
            <th className="py-1 pr-2 text-right">Sold (net)</th>
            <th className="py-1 pr-2 text-right">Adjusted</th>
            <th className="py-1 pr-2 text-right">On hand</th>
            <th className="py-1 text-right">Drift</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.key} className={g.red ? "text-[var(--admin-danger)]" : ""}>
              <td className="py-1 pr-2">{g.key}{g.red ? ` (${g.red} red)` : ""}</td>
              <td className="py-1 pr-2 text-right">{n(g.cultivera)}</td>
              <td className="py-1 pr-2 text-right">{n(g.sold)}</td>
              <td className="py-1 pr-2 text-right">{signedNum(g.adjusted)}</td>
              <td className="py-1 pr-2 text-right">{n(g.onHand)}</td>
              <td className="py-1 text-right">{signedNum(g.drift)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function DriftPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await requirePermission("menu.import");
  void session;
  const sp = await searchParams;
  const now = nowMs();
  const phase = driftPhase(now);
  const anyway = sp.anyway === "1";
  const importId = sp.import && isSafeImportId(sp.import) ? sp.import : "";

  let imports: ReconcileImport[] = [];
  let listError: string | null = null;
  let load: DriftLoad | null = null;
  let records: DriftCheckRecord[] = [];
  let recordsError: string | null = null;
  const chosen = importId || "";
  if (isSupabaseServiceConfigured) {
    const admin = createSupabaseAdminClient();
    try {
      imports = await listReconcileImports(admin);
    } catch (e) {
      listError = e instanceof Error ? e.message : String(e);
    }
    const target = chosen || imports.find((i) => i.status === "published")?.id || "";
    if (target && driftShouldRun(phase, anyway)) {
      load = await loadDrift(admin, target, now);
      try {
        records = await loadDriftChecks(admin, target);
      } catch (e) {
        recordsError = e instanceof Error ? e.message : String(e);
      }
    }
  }
  const target = chosen || imports.find((i) => i.status === "published")?.id || "";
  const byDate = checksByDate(records);

  return (
    <div>
      <AdminPageHeader
        title="Did anything drift today?"
        subtitle={`The first week after the cutover (${DRIFT_FIRST_DAY} to ${DRIFT_LAST_DAY}): on hand must equal Cultivera's units plus every recorded change. Once a day.`}
        breadcrumbs={<Breadcrumbs items={[{ label: "Menu Imports", href: "/admin/menu-imports" }, { label: "Daily drift check" }]} />}
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.error && <div className="rounded-lg border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-4 py-3 text-sm text-[var(--admin-danger)]" data-testid="dr-error">{sp.error}</div>}
        {sp.notice && <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]" data-testid="dr-notice">{sp.notice}</div>}

        <p className="text-sm text-white/80" data-testid="dr-phase" data-phase={phase.phase}>{phase.label}</p>

        <details className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="dr-help">
          <summary className="cursor-pointer text-sm font-semibold text-white">How this check works (read once)</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-white/60">
            <li><b>The question:</b> for each product on the cutover import, is <b>on hand now</b> = <b>Cultivera&apos;s units</b> + <b>every adjustment</b> (the Oct 30 count, returns, damage, destruction, cycle counts) − <b>units sold on our register</b> + <b>units put back by a void</b>?</li>
            <li><b>Green</b> = every unit is explained. <b>Red</b> = units moved that nobody recorded. Count that shelf, then fix it on the lot with the right reason.</li>
            <li><b>Shared</b> products also have lots from a delivery after the cutover. Sales take from all of them, so ours cannot be split out. They are listed, never judged.</li>
            <li>A product whose sale went over what we had shows as <b>more</b> on hand than recorded (stock never goes below 0).</li>
            <li>Press <b>I ran today&apos;s check</b> once a day. After {DRIFT_LAST_DAY} this page switches itself off.</li>
            <li>Nothing on this page changes stock.</li>
          </ul>
        </details>

        {!isSupabaseServiceConfigured && <p className="text-sm text-[var(--admin-gold)]">Supabase is not configured, so there is nothing to check.</p>}
        {listError && <div className="rounded-lg border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-4 py-3 text-sm text-[var(--admin-danger)]">{listError}</div>}

        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="dr-picker">
          <h2 className="text-sm font-semibold text-white">The cutover import</h2>
          {imports.length === 0 ? (
            <p className="mt-2 text-xs text-white/60">No real (non-test) import yet. Test imports never make lots, so there is nothing to compare.</p>
          ) : (
            <form method="get" className="mt-3 flex flex-wrap items-end gap-3 text-xs text-white/70">
              <label className="flex flex-col gap-1">
                <span>Import (newest first; the published one is picked for you)</span>
                <select name="import" defaultValue={target || imports[0].id} className="rounded border border-white/20 bg-black px-2 py-1 text-white">
                  {imports.map((r) => (
                    <option key={r.id} value={r.id}>
                      {when(r.created_at)} · {r.status} · {r.inventories_filename ?? "no file name"} · {r.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
              {phase.phase === "after" && <input type="hidden" name="anyway" value="1" />}
              <Button type="submit" variant="primary">Check</Button>
            </form>
          )}
        </section>

        {phase.phase === "after" && !anyway && (
          <div className="rounded-lg border border-white/10 px-4 py-3 text-sm text-white/70" data-testid="dr-off">
            Switched off: the first week is over. <Link className="underline" href={`/admin/menu-imports/drift?anyway=1${target ? `&import=${target}` : ""}`}>Run it once anyway</Link>.
          </div>
        )}

        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="dr-week">
          <h2 className="text-sm font-semibold text-white">The week</h2>
          {recordsError && <p className="mt-2 text-xs text-[var(--admin-danger)]">{recordsError}</p>}
          <ol className="mt-3 grid grid-cols-7 gap-2 text-center text-xs">
            {driftDates().map((d) => {
              const r = byDate.get(d);
              const cls = !r ? "border-white/10 text-white/40" : r.ok ? "border-[var(--admin-accent)]/50 text-[var(--admin-accent)]" : "border-[var(--admin-danger)]/50 text-[var(--admin-danger)]";
              return (
                <li key={d} className={`rounded border px-1 py-2 ${cls} ${d === phase.date ? "ring-1 ring-white/40" : ""}`} data-day={d} data-state={!r ? "none" : r.ok ? "green" : "red"}>
                  <div>{d.slice(5)}</div>
                  <div>{!r ? "not run" : r.ok ? "green" : `${r.driftProducts} red`}</div>
                </li>
              );
            })}
          </ol>
        </section>

        {load && !load.ok && (
          <div className="rounded-lg border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-4 py-3 text-sm text-[var(--admin-danger)]" data-testid="dr-load-error">
            RED: {load.error}
          </div>
        )}

        {load && load.ok && (() => {
          const { report } = load;
          const t = report.totals;
          return (
            <>
              <section
                className={`rounded-xl border p-5 ${report.ok ? "border-[var(--admin-accent)]/50 bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]" : "border-[var(--admin-danger)]/50 bg-[var(--admin-danger-soft)] text-[var(--admin-danger)]"}`}
                data-testid="dr-verdict"
                data-ok={report.ok ? "1" : "0"}
              >
                <p className="text-lg font-semibold">{report.ok ? "GREEN: every unit is explained." : `RED: ${t.driftProducts} product(s) drifted (net ${signedNum(t.drift)}).`}</p>
                <p className="mt-1 text-xs">
                  {n(t.products)} product(s) on {n(load.lotCount)} lot(s). Cultivera {n(t.cultivera)} {signedNum(t.adjusted)} adjusted − {n(t.sold)} sold + {n(t.voided)} voided = {n(t.expected)} expected; {n(t.onHand)} on hand.
                  {t.shared ? ` ${t.shared} shared product(s) not judged.` : ""}
                </p>
                <ul className="mt-3 space-y-1 text-xs" data-testid="dr-checks">
                  {report.checks.map((c) => (
                    <li key={c.id} data-check={c.id} data-pass={c.pass ? "1" : "0"}>
                      {c.pass ? "✓" : "✗"} {CHECK_LABEL[c.id] ?? c.id}: {c.detail}
                    </li>
                  ))}
                </ul>
                {Object.keys(report.reasons).length > 0 && (
                  <p className="mt-2 text-xs" data-testid="dr-reasons">
                    Adjustments by reason: {Object.entries(report.reasons).sort(([a], [b]) => a.localeCompare(b)).map(([r, d]) => `${r} ${signedNum(d)}`).join(", ")}
                  </p>
                )}
                <form action={recordDriftCheckAction} className="mt-4">
                  <input type="hidden" name="importId" value={target} />
                  <Button type="submit" variant="primary">I ran today&apos;s check ({phase.date})</Button>
                </form>
              </section>

              <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="dr-lines">
                <h2 className="text-sm font-semibold text-white">Products to look at ({n(report.lines.length)})</h2>
                {report.lines.length === 0 ? (
                  <p className="mt-2 text-xs text-white/60">Nothing to look at.</p>
                ) : (
                  <table className="mt-3 w-full text-left text-xs text-white/80">
                    <thead className="text-white/50">
                      <tr>
                        <th className="py-1 pr-2">Product</th>
                        <th className="py-1 pr-2">Vendor · Category</th>
                        <th className="py-1 pr-2 text-right">Cultivera</th>
                        <th className="py-1 pr-2 text-right">Adjusted</th>
                        <th className="py-1 pr-2 text-right">Sold</th>
                        <th className="py-1 pr-2 text-right">Voided</th>
                        <th className="py-1 pr-2 text-right">Expected</th>
                        <th className="py-1 pr-2 text-right">On hand</th>
                        <th className="py-1 pr-2 text-right">Drift</th>
                        <th className="py-1">What it means</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.lines.slice(0, DRIFT_LINE_CAP).map((l) => (
                        <tr key={l.key} data-kind={l.kind} className={l.kind === "shared" ? "text-white/50" : "text-[var(--admin-danger)]"}>
                          <td className="py-1 pr-2">
                            <Link className="underline" href={`/admin/inventory?q=${encodeURIComponent(l.key.startsWith("lot:") ? l.product : l.key)}`}>{l.product}</Link>
                            {l.lots > 1 ? ` (${l.lots} lots)` : ""}
                          </td>
                          <td className="py-1 pr-2">{l.vendor} · {l.category}</td>
                          <td className="py-1 pr-2 text-right">{n(l.cultivera)}</td>
                          <td className="py-1 pr-2 text-right">{signedNum(l.adjusted)}</td>
                          <td className="py-1 pr-2 text-right">{n(l.sold)}</td>
                          <td className="py-1 pr-2 text-right">{n(l.voided)}</td>
                          <td className="py-1 pr-2 text-right">{n(l.expected)}</td>
                          <td className="py-1 pr-2 text-right">{n(l.onHand)}</td>
                          <td className="py-1 pr-2 text-right">{l.kind === "drift" ? signedNum(l.drift) : "-"}</td>
                          <td className="py-1">{driftLineNote(l)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {report.lines.length > DRIFT_LINE_CAP && <p className="mt-2 text-xs text-white/50">Showing the first {DRIFT_LINE_CAP}, biggest first.</p>}
              </section>

              <section className="grid gap-6 rounded-xl border border-white/10 bg-[#0a0a0a] p-5 lg:grid-cols-2">
                <GroupTable title="By vendor" rows={report.byVendor} testid="dr-by-vendor" />
                <GroupTable title="By category" rows={report.byCategory} testid="dr-by-category" />
              </section>
            </>
          );
        })()}
      </div>
    </div>
  );
}
