import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui";
import { isSafeImportId } from "@/lib/inventory/import-lineage-core";
import { rehomeHref } from "@/lib/inventory/cultivera-rehome-ui-core";
import { CUTOVER_RUNBOOK_HREF } from "@/lib/inventory/cutover-guard-core";
import { listReconcileImports, loadReconcile, type ReconcileImport, type ReconcileLoad } from "@/lib/pos/cultivera-reconcile";
import {
  MISMATCH_COPY,
  RECONCILE_LINE_CAP,
  RECONCILE_NOTE_MAX,
  VERDICT_COPY,
  creatableMissing,
  filterLines,
  kindCounts,
  lineKey,
  lookupBarcode,
  mismatchFix,
  mismatchNote,
  pageOf,
  parseKind,
  reconcileHeadline,
  reconcileHref,
  verdictFor,
  type GroupRow,
} from "@/lib/pos/cultivera-reconcile-core";
import { createMissingLotsAction, explainLineAction, signOffAction, unexplainLineAction } from "./actions";

/**
 * R50 A2 - "Do the units balance?" The go / no-go check after the Cultivera
 * import: units in the stored Cultivera file = units on our lots, barcode by
 * barcode, with vendor and category totals. Every difference is a line he can
 * open, filter, download, fix (where a safe fix exists) or explain with a note.
 * GO (explained) needs a note on every line; a failed read is always NO-GO.
 */
export const dynamic = "force-dynamic";
// "Create the missing lots" re-runs the import's lot step (server actions inherit this).
export const maxDuration = 300;

const CHECK_LABEL: Record<string, string> = {
  reads: "Everything was read",
  total: "Total units match",
  barcodes: "Each barcode matches",
  missing: "No Cultivera barcode is missing a lot",
  extra: "No lot is missing from Cultivera",
  no_barcode: "Rows with no barcode add up",
  blank_product: "No Cultivera row is missing its product name",
  whole: "Every quantity is a whole number",
};

const n = (v: number | null | undefined) => (v == null ? "-" : v.toLocaleString("en-US"));
const signed = (v: number) => (v > 0 ? `+${v.toLocaleString("en-US")}` : v.toLocaleString("en-US"));
const when = (iso: string) => iso.slice(0, 16).replace("T", " ") + " UTC";

type SP = {
  import?: string;
  kind?: string;
  vendor?: string;
  category?: string;
  q?: string;
  open?: string;
  page?: string;
  barcode?: string;
  red?: string;
  error?: string;
  notice?: string;
};

export default async function ReconcilePage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await requirePermission("menu.import");
  const canPublish = can(session.profile.role, "menu.publish");
  const sp = await searchParams;
  const importId = sp.import && isSafeImportId(sp.import) ? sp.import : "";

  let imports: ReconcileImport[] = [];
  let listError: string | null = null;
  let load: ReconcileLoad | null = null;
  if (isSupabaseServiceConfigured) {
    const admin = createSupabaseAdminClient();
    try {
      imports = await listReconcileImports(admin);
    } catch (e) {
      listError = e instanceof Error ? e.message : String(e);
    }
    if (importId) load = await loadReconcile(admin, importId);
  }

  const filter = {
    kind: parseKind(sp.kind) || undefined,
    vendor: sp.vendor ? sp.vendor.slice(0, 200) : undefined,
    category: sp.category ? sp.category.slice(0, 200) : undefined,
    q: sp.q ? sp.q.slice(0, 100) : undefined,
    open: sp.open === "1",
  };
  const keep: Record<string, string> = {
    kind: filter.kind ?? "",
    vendor: filter.vendor ?? "",
    category: filter.category ?? "",
    q: filter.q ?? "",
    open: filter.open ? "1" : "",
    page: sp.page ?? "",
  };
  const KeepFields = ({ id }: { id: string }) => (
    <>
      <input type="hidden" name="importId" value={id} />
      {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={`keep_${k}`} value={v} /> : null))}
    </>
  );
  const onlyRed = sp.red === "1";

  return (
    <div>
      <AdminPageHeader
        title="Do the units balance?"
        subtitle="After the Cultivera import: units in Cultivera's file = units on our lots, barcode by barcode. Green means go."
        breadcrumbs={<Breadcrumbs items={[{ label: "Menu Imports", href: "/admin/menu-imports" }, { label: "Go / no-go check" }]} />}
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.error && <div className="rounded-lg border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-4 py-3 text-sm text-[var(--admin-danger)]" data-testid="rc-error">{sp.error}</div>}
        {sp.notice && <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]" data-testid="rc-notice">{sp.notice}</div>}

        <details className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5" open={!importId} data-testid="rc-help">
          <summary className="cursor-pointer text-sm font-semibold text-white">How this check works (read once)</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-white/60">
            <li><b>When:</b> right after you publish the Cultivera import, and again after &quot;Rebuild deliveries&quot;. Before the Oct 30 count is applied is best, but it works any time.</li>
            <li><b>Cultivera&apos;s side</b> is the exact file the import made the lots from (kept on the import). <b>Our side</b> is every lot on that import, wherever &quot;Rebuild deliveries&quot; moved it.</li>
            <li>It compares the <b>received</b> quantity (what the import wrote). On-hand moves with every sale and with the count, so it is shown but never decides.</li>
            <li><b>GO</b> = every barcode matches. <b>GO (explained)</b> = every line left has your note saying why it is fine. <b>NO-GO</b> = something is unexplained, or something could not be read.</li>
            <li>Nothing on this page changes stock. The only button that writes lots is &quot;Create the missing lots&quot;, which adds only lots that do not exist yet.</li>
          </ul>
        </details>

        {!isSupabaseServiceConfigured && <p className="text-sm text-[var(--admin-gold)]">Supabase is not configured, so there is nothing to check.</p>}
        {listError && <div className="rounded-lg border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-4 py-3 text-sm text-[var(--admin-danger)]">{listError}</div>}

        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="rc-picker">
          <h2 className="text-sm font-semibold text-white">1. Pick the Cultivera import</h2>
          {imports.length === 0 ? (
            <p className="mt-2 text-xs text-white/60">No real (non-test) import yet. Test imports never make lots, so they cannot be checked.</p>
          ) : (
            <form method="get" className="mt-3 flex flex-wrap items-end gap-3 text-xs text-white/70">
              <label className="flex flex-col gap-1">
                <span>Import (newest first; pick the one you published)</span>
                <select name="import" defaultValue={importId || imports.find((i) => i.status === "published")?.id || imports[0].id} className="rounded border border-white/20 bg-black px-2 py-1 text-white">
                  {imports.map((r) => (
                    <option key={r.id} value={r.id}>
                      {when(r.created_at)} · {r.status} · {r.inventories_filename ?? "no file name"} · {r.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" variant="primary">Check</Button>
            </form>
          )}
        </section>

        {load && !load.ok && (
          <div className="rounded-lg border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-4 py-3 text-sm text-[var(--admin-danger)]" data-testid="rc-load-error">
            NO-GO: {load.error}
          </div>
        )}

        {load && load.ok && (() => {
          const { report, explanations, imp } = load;
          const v = verdictFor(report, explanations);
          const tone = v.verdict === "go" ? "accent" : v.verdict === "go_explained" ? "gold" : "danger";
          const toneCls =
            tone === "accent"
              ? "border-[var(--admin-accent)]/50 bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]"
              : tone === "gold"
                ? "border-[var(--admin-gold)]/50 bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]"
                : "border-[var(--admin-danger)]/50 bg-[var(--admin-danger-soft)] text-[var(--admin-danger)]";
          const lines = filterLines(report.mismatches, filter, explanations);
          const pg = pageOf(lines, Number(sp.page ?? 1));
          const kc = kindCounts(report.mismatches, explanations);
          const creatable = creatableMissing(report.mismatches);
          const look = sp.barcode ? lookupBarcode(sp.barcode.slice(0, 100), load.file, load.lots, report) : null;
          const vendors = report.byVendor.filter((g) => !onlyRed || !g.ok);
          const cats = report.byCategory.filter((g) => !onlyRed || !g.ok);
          const filtered = Boolean(filter.kind || filter.vendor || filter.category || filter.q || filter.open);
          const csvQs = new URLSearchParams({ import: imp.id, ...(filter.kind ? { kind: filter.kind } : {}), ...(filter.vendor ? { vendor: filter.vendor } : {}), ...(filter.category ? { category: filter.category } : {}), ...(filter.q ? { q: filter.q } : {}), ...(filter.open ? { open: "1" } : {}) }).toString();

          const GroupTable = ({ title, rows, field, testid }: { title: string; rows: GroupRow[]; field: "vendor" | "category"; testid: string }) => (
            <div data-testid={testid}>
              <h3 className="text-xs font-semibold text-white">{title} ({rows.filter((g) => !g.ok).length} red of {rows.length})</h3>
              <div className="mt-2 max-h-96 overflow-auto">
                <table className="w-full text-left text-xs text-white/70">
                  <thead className="sticky top-0 bg-[#0a0a0a] text-white/40"><tr><th></th><th>{field === "vendor" ? "Vendor" : "Category"}</th><th className="text-right">Cultivera</th><th className="text-right">Ours</th><th className="text-right">Diff</th></tr></thead>
                  <tbody>
                    {rows.map((g) => (
                      <tr key={g.key} className={g.ok ? "" : "text-[var(--admin-danger)]"}>
                        <td>{g.ok ? "🟢" : "🔴"}</td>
                        <td>{g.ok ? g.key : <Link className="underline" href={reconcileHref(imp.id, { [field]: g.key })}>{g.key}</Link>}</td>
                        <td className="text-right">{n(g.cultivera)}</td>
                        <td className="text-right">{n(g.ours)}</td>
                        <td className="text-right">{g.diff === 0 ? "0" : signed(g.diff)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );

          return (
            <>
              <section className={`rounded-xl border-2 p-5 ${toneCls}`} data-testid="rc-verdict" data-verdict={v.verdict}>
                <p className="text-lg font-black">{v.verdict === "go" ? "🟢 " : v.verdict === "go_explained" ? "🟡 " : "🔴 "}{VERDICT_COPY[v.verdict]}</p>
                <p className="mt-1 text-sm">{reconcileHeadline(report)}</p>
                {v.verdict !== "go" && report.mismatchCount > 0 && (
                  <p className="mt-1 text-xs">{n(v.open)} line(s) open, {n(v.explained)} explained by your notes.</p>
                )}
                <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
                  <dt className="opacity-70">Cultivera units</dt><dd className="font-bold">{n(report.totals.cultivera)}</dd>
                  <dt className="opacity-70">Our units (received)</dt><dd className="font-bold">{n(report.totals.ours)}</dd>
                  <dt className="opacity-70">Difference</dt><dd className="font-bold">{signed(report.totals.ours - report.totals.cultivera)}</dd>
                  <dt className="opacity-70">On hand now (info only)</dt><dd>{n(report.totals.onHandNow)}</dd>
                  <dt className="opacity-70">Cultivera barcodes with stock</dt><dd>{n(report.totals.barcodes)}</dd>
                  <dt className="opacity-70">Our lots on this import</dt><dd>{n(report.totals.lots)}</dd>
                  <dt className="opacity-70">Rows in the file</dt><dd>{n(report.info.fileRows)}</dd>
                  <dt className="opacity-70">Rows with 0 units (no lot, by design)</dt><dd>{n(report.info.zeroUnitRows)}</dd>
                </dl>
                <p className="mt-3 text-xs opacity-80">
                  Import {imp.id.slice(0, 8)} · {imp.status} · {when(imp.created_at)} · file {imp.inventories_filename ?? "(no name)"} · {load.manifestIds.length} delivery record(s)
                  {report.info.sharedBarcodeLots > 0 ? ` · ${report.info.sharedBarcodeLots} barcode(s) are split over more than one lot (added together)` : ""}.
                </p>
              </section>

              {(load.elsewhereError || load.notesError) && (
                <div className="rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-3 text-xs text-[var(--admin-gold)]" data-testid="rc-partial">
                  {load.elsewhereError && <p>{load.elsewhereError} The missing lines stay red; reload to try again.</p>}
                  {load.notesError && <p>{load.notesError} Lines are shown as open until your notes can be read.</p>}
                </div>
              )}

              <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="rc-checks">
                <h2 className="text-sm font-semibold text-white">2. The checks</h2>
                <ul className="mt-2 space-y-1 text-xs">
                  {report.checks.map((c) => (
                    <li key={c.id} className={c.pass ? "text-white/70" : "text-[var(--admin-danger)]"} data-check={c.id} data-pass={c.pass ? "1" : "0"}>
                      {c.pass ? "✅" : "❌"} <b>{CHECK_LABEL[c.id] ?? c.id}.</b> {c.detail}
                    </li>
                  ))}
                </ul>
              </section>

              {(creatable > 0 || v.verdict !== "no_go" || load.lastSignOff) && (
                <section className="space-y-4 rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="rc-actions">
                  <h2 className="text-sm font-semibold text-white">3. Fix and sign off</h2>
                  {creatable > 0 && (
                    <div data-testid="rc-create-missing">
                      <p className="text-xs text-white/70">
                        {n(creatable)} Cultivera barcode(s) have no lot. This button re-runs the import&apos;s own lot step. It only adds lots that do not exist yet (never a duplicate), so it is safe to press again.
                      </p>
                      {canPublish ? (
                        <form action={createMissingLotsAction} className="mt-2">
                          <KeepFields id={imp.id} />
                          <Button type="submit" variant="confirm">Create the missing lots</Button>
                        </form>
                      ) : (
                        <p className="mt-1 text-xs text-[var(--admin-gold)]">A manager or admin can press &quot;Create the missing lots&quot;.</p>
                      )}
                    </div>
                  )}
                  {load.lastSignOff && (
                    <p className="text-xs text-white/70" data-testid="rc-last-signoff">
                      Last signed off by {load.lastSignOff.by ?? "someone"} at {when(load.lastSignOff.at)} ({load.lastSignOff.verdict === "go" ? "GO" : "GO (explained)"}: Cultivera {n(load.lastSignOff.cultivera)} / ours {n(load.lastSignOff.ours)}).
                      {load.lastSignOff.cultivera !== report.totals.cultivera || load.lastSignOff.ours !== report.totals.ours ? " The numbers have changed since then, so sign off again." : ""}
                    </p>
                  )}
                  {v.verdict !== "no_go" && (
                    canPublish ? (
                      <form action={signOffAction} className="flex flex-wrap items-center gap-3 text-xs text-white/70" data-testid="rc-signoff">
                        <KeepFields id={imp.id} />
                        <label className="flex items-center gap-2">
                          <input type="checkbox" name="confirm" value="yes" required />
                          <span>I checked these numbers and we can open on this import.</span>
                        </label>
                        <Button type="submit" variant="confirm">Sign off</Button>
                      </form>
                    ) : (
                      <p className="text-xs text-[var(--admin-gold)]">A manager or admin signs off.</p>
                    )
                  )}
                </section>
              )}

              <section className="space-y-4 rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="rc-groups">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-white">4. By vendor and by category</h2>
                  <Link className="text-xs text-[var(--admin-accent)] underline" href={onlyRed ? reconcileHref(imp.id) : `${reconcileHref(imp.id)}&red=1`}>
                    {onlyRed ? "Show every row" : "Show only red rows"}
                  </Link>
                </div>
                <p className="text-xs text-white/50">Red rows come first. Click a red name to see just its lines.</p>
                <div className="grid gap-6 lg:grid-cols-2">
                  <GroupTable title="Vendors" rows={vendors} field="vendor" testid="rc-vendors" />
                  <GroupTable title="Categories" rows={cats} field="category" testid="rc-categories" />
                </div>
              </section>

              <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="rc-lookup">
                <h2 className="text-sm font-semibold text-white">5. Look up one barcode</h2>
                <form method="get" className="mt-2 flex flex-wrap items-end gap-3 text-xs text-white/70">
                  <input type="hidden" name="import" value={imp.id} />
                  <label className="flex flex-col gap-1">
                    <span>Scan or type a barcode</span>
                    <input name="barcode" defaultValue={sp.barcode ?? ""} maxLength={100} autoComplete="off" className="w-72 rounded border border-white/20 bg-black px-2 py-1 font-mono text-white" />
                  </label>
                  <Button type="submit" variant="neutral">Look up</Button>
                </form>
                {look && (
                  <div className="mt-3 grid gap-3 text-xs text-white/70 sm:grid-cols-2" data-testid="rc-lookup-result">
                    <div>
                      <p className="font-semibold text-white">Cultivera</p>
                      {look.file ? (
                        <p>{look.file.product} · {look.file.vendor} · {look.file.category} · <b>{n(look.file.units)}</b> units on {look.file.rows} row(s)</p>
                      ) : (
                        <p>Not in the file with stock (missing, or 0 units).</p>
                      )}
                    </div>
                    <div>
                      <p className="font-semibold text-white">Our lots</p>
                      {look.lots.length === 0 ? (
                        <p>No lot on this import has this barcode.</p>
                      ) : (
                        <ul>
                          {look.lots.map((l) => (
                            <li key={l.id}>
                              <Link className="underline" href={`/admin/inventory/${l.id}`}>Lot {l.id.slice(0, 8)}</Link> · received {n(l.received)} · on hand {n(l.onHand)} · {l.status ?? "?"}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <p className="sm:col-span-2">
                      {look.line ? <span className="text-[var(--admin-danger)]">🔴 {mismatchNote(look.line)}. {mismatchFix(look.line)}</span> : <span>🟢 This barcode balances.</span>}
                    </p>
                  </div>
                )}
              </section>

              <section className="space-y-3 rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="rc-lines">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-white">6. Every difference ({n(report.mismatchCount)})</h2>
                  {report.mismatchCount > 0 && (
                    <div className="flex gap-3 text-xs">
                      <a className="text-[var(--admin-accent)] underline" href={`/admin/menu-imports/reconcile/csv?${csvQs}`}>Download {filtered ? "these" : "all"} lines (CSV)</a>
                      {filtered && <a className="text-[var(--admin-accent)] underline" href={`/admin/menu-imports/reconcile/csv?import=${imp.id}`}>Download every line</a>}
                    </div>
                  )}
                </div>

                {report.mismatchCount === 0 ? (
                  <p className="text-xs text-white/60">None. Every barcode matches.</p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2 text-xs" data-testid="rc-kinds">
                      <Link href={reconcileHref(imp.id)} className={`rounded-full px-3 py-1 ring-1 ${!filter.kind ? "bg-white/10 text-white ring-white/30" : "text-white/60 ring-white/10"}`}>All ({n(report.mismatchCount)})</Link>
                      {kc.map((c) => (
                        <Link key={c.kind} href={reconcileHref(imp.id, { kind: c.kind })} className={`rounded-full px-3 py-1 ring-1 ${filter.kind === c.kind ? "bg-white/10 text-white ring-white/30" : "text-white/60 ring-white/10"}`}>
                          {MISMATCH_COPY[c.kind]} ({n(c.total)}{c.open !== c.total ? `, ${n(c.open)} open` : ""})
                        </Link>
                      ))}
                    </div>

                    <form method="get" className="flex flex-wrap items-end gap-3 text-xs text-white/70" data-testid="rc-filter">
                      <input type="hidden" name="import" value={imp.id} />
                      {filter.kind && <input type="hidden" name="kind" value={filter.kind} />}
                      <label className="flex flex-col gap-1">
                        <span>Vendor</span>
                        <select name="vendor" defaultValue={filter.vendor ?? ""} className="rounded border border-white/20 bg-black px-2 py-1 text-white">
                          <option value="">Any</option>
                          {report.byVendor.filter((g) => !g.ok).map((g) => <option key={g.key} value={g.key}>{g.key}</option>)}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span>Category</span>
                        <select name="category" defaultValue={filter.category ?? ""} className="rounded border border-white/20 bg-black px-2 py-1 text-white">
                          <option value="">Any</option>
                          {report.byCategory.filter((g) => !g.ok).map((g) => <option key={g.key} value={g.key}>{g.key}</option>)}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span>Search barcode, product or vendor</span>
                        <input name="q" defaultValue={filter.q ?? ""} maxLength={100} className="rounded border border-white/20 bg-black px-2 py-1 text-white" />
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" name="open" value="1" defaultChecked={filter.open} />
                        <span>Only lines without a note</span>
                      </label>
                      <Button type="submit" variant="neutral">Filter</Button>
                      {filtered && <Link className="underline" href={reconcileHref(imp.id)}>Clear</Link>}
                    </form>

                    <p className="text-xs text-white/50">
                      Showing {n(pg.items.length)} of {n(lines.length)} line(s){filtered ? " (filtered)" : ""}. Page {pg.page} of {pg.pages}, {RECONCILE_LINE_CAP} per page.
                    </p>

                    <ul className="space-y-3">
                      {pg.items.map((l) => {
                        const key = lineKey(l);
                        const ex = explanations.get(key);
                        return (
                          <li key={key} className={`rounded-lg border p-3 text-xs ${ex ? "border-white/10 text-white/60" : "border-[var(--admin-danger)]/30 text-white/80"}`} data-line={key}>
                            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                              <span className={ex ? "" : "font-semibold text-[var(--admin-danger)]"}>{ex ? "📝" : "🔴"} {mismatchNote(l)}</span>
                              <Link className="font-mono underline" href={reconcileHref(imp.id, { barcode: l.barcode })}>{l.barcode}</Link>
                              {l.product && <span>{l.product}</span>}
                              <span className="text-white/50">{l.vendor} · {l.category}</span>
                              <span>Cultivera <b>{n(l.cultivera)}</b> · ours <b>{n(l.ours)}</b>{l.cultivera != null && l.ours != null ? ` (${signed(l.ours - l.cultivera)})` : ""}</span>
                            </div>
                            <p className="mt-1 text-white/60"><b>What to do:</b> {mismatchFix(l)}</p>
                            {l.lotIds.length > 0 && (
                              <p className="mt-1">
                                {l.elsewhere ? "Existing lot(s): " : "Lot(s): "}
                                {l.lotIds.slice(0, 10).map((id, i) => (
                                  <span key={id}>{i > 0 ? ", " : ""}<Link className="underline" href={`/admin/inventory/${id}`}>{id.slice(0, 8)}</Link></span>
                                ))}
                                {l.lotIds.length > 10 ? ` and ${l.lotIds.length - 10} more` : ""}
                              </p>
                            )}
                            {ex ? (
                              <form action={unexplainLineAction} className="mt-2 flex flex-wrap items-center gap-2">
                                <KeepFields id={imp.id} />
                                <input type="hidden" name="key" value={key} />
                                <span>Your note: &quot;{ex.note}&quot; ({ex.by ?? "someone"}, {when(ex.at)})</span>
                                <Button type="submit" variant="neutral" size="sm">Remove note</Button>
                              </form>
                            ) : (
                              <form action={explainLineAction} className="mt-2 flex flex-wrap items-center gap-2">
                                <KeepFields id={imp.id} />
                                <input type="hidden" name="key" value={key} />
                                <input name="note" required minLength={3} maxLength={RECONCILE_NOTE_MAX} placeholder="What you found, e.g. 'old lot, sold out in Cultivera'" className="min-w-[18rem] flex-1 rounded border border-white/20 bg-black px-2 py-1 text-white" />
                                <Button type="submit" variant="save" size="sm">Save note</Button>
                              </form>
                            )}
                          </li>
                        );
                      })}
                    </ul>

                    {pg.pages > 1 && (
                      <nav className="flex gap-3 text-xs" data-testid="rc-pages">
                        {pg.page > 1 && <Link className="underline" href={reconcileHref(imp.id, { ...keep, page: pg.page - 1 })}>← Previous</Link>}
                        {pg.page < pg.pages && <Link className="underline" href={reconcileHref(imp.id, { ...keep, page: pg.page + 1 })}>Next →</Link>}
                      </nav>
                    )}
                  </>
                )}
              </section>

              <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5 text-xs text-white/60" data-testid="rc-next">
                <h2 className="text-sm font-semibold text-white">Where to go next</h2>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li><Link className="underline" href={`/admin/menu-imports/${imp.id}`}>This import&apos;s review page</Link> (its warnings and lot plan).</li>
                  <li><Link className="underline" href={rehomeHref(imp.id)}>Rebuild deliveries</Link>, then check again here (the lots follow).</li>
                  <li><Link className="underline" href={`/admin/menu-imports/count?import=${imp.id}`}>Oct 30 shelf count</Link> (on-hand changes there; this check still compares received).</li>
                  <li><Link className="underline" href={CUTOVER_RUNBOOK_HREF}>Cutover runbook</Link></li>
                </ul>
              </section>
            </>
          );
        })()}
      </div>
    </div>
  );
}
