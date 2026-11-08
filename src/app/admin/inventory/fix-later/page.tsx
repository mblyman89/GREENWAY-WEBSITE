/**
 * src/app/admin/inventory/fix-later/page.tsx  (register-sell-everything-fix-later)
 *
 * The owner, verbatim: "I need ways of fixing a lot from the register, let
 * the system fix it for me so it can be sold, then set that item aside so I
 * can fix it properly. Everything must sell. No exceptions. We will fix it
 * all later."
 *
 * One sentence at the top answers "does everything with stock sell?". Below
 * it: the lots the register is selling ANYWAY (Quarantine, no menu product,
 * no COA, auto price / category, fixed at the register with "Fix & sell"),
 * each with what to fix, and separately the few lots that are stopped for
 * safety (recall, failed lab, destruction) with why.
 *
 * Read-only: every lot links to its own page to fix it. D200 adds the two
 * COA buttons (fetch from Cultivera, attach all): fill-only, audited.
 * D201 adds "COAs from Stephen's Gmail": a targeted search, attach (+ preview),
 * and a "Search Gmail" button on every No COA lot and every delivery.
 * D203 adds "Deep dig" (all, or one delivery) for the last ones the search cannot find.
 * D206 adds "Re-read every COA and trust it": the overnight server job (cron /api/cron/coa-trust-all).
 * D207e: the "Selling now, fix later" table says it lists EVERY reason (not only a
 * missing COA), shows each lot's delivery, filters by reason (?why=no_coa) and
 * links each No COA lot to the lot page's "Attach the COA document" box.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { readFixLaterCoverage } from "@/lib/pos/register-fix-later-store";
import { Button } from "@/components/admin/ui";
import { FetchRunAutoRefresh } from "@/components/admin/catalog/FetchRunAutoRefresh";
import { readCoaPanel, type CoaPanel } from "@/lib/inventory/coa-from-cultivera-store";
import { readGmailPanel, type GmailPanel } from "@/lib/inventory/coa-gmail-search-store";
import { coaCrawlStatusLine, type BatchCoaStage, type TransferLotsStage } from "@/lib/inventory/coa-batch-cultivera-core";
import { readTrustPanel, type TrustPanel } from "@/lib/inventory/coa-trust-all-store";
import { trustRunLine } from "@/lib/inventory/coa-trust-all-core";
import {
  attachAllCoasAction,
  attachCoasFromGmailAction,
  deepDigGmailAction,
  fetchCoasFromCultiveraAction,
  searchGmailForCoasAction,
  searchGmailForOneAction,
  startTrustAllAction,
  stopTrustAllAction,
} from "./actions";
import { fixLaterChips, fixLaterExplain, fixLaterRows, parseFixLaterFilter } from "@/lib/pos/fix-later-view-core";
import {
  FIX_LATER_REASON_LABELS,
  REGISTER_STOP_LABELS,
  coverageSentence,
  type FixLaterReason,
} from "@/lib/pos/register-fix-later-core";

export const dynamic = "force-dynamic";
/** D200: "Attach all COAs" reads every vendor file in one click. */
export const maxDuration = 300;

const CARD = "rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5";
const H2 = "mb-3 text-sm font-black uppercase tracking-[0.14em] text-[var(--admin-text)]";

const REASON_SHORT: Record<FixLaterReason, string> = {
  quarantine: "Quarantine",
  no_menu_product: "No menu product",
  no_coa: "No COA",
  category_guessed: "Category guessed",
  price_from_cost: "Auto price (2x cost)",
  price_guessed: "Price guessed ($20)",
  fixed_at_register: "Fixed at register",
};

function CoaFromCultivera({ panel, tone, msg }: { panel: CoaPanel; tone: string | undefined; msg: string | undefined }) {
  const st = panel.run?.state;
  const running = Boolean(panel.run?.active) || st?.status === "running";
  const wcia = st?.stages?.wcia_json as { fetched_now?: number; wanted?: number; missing?: unknown[] } | undefined;
  const details = st?.stages?.transfer_details as { missing?: unknown[] } | undefined;
  return (
    <div className={CARD} id="coa-from-cultivera" data-testid="coa-from-cultivera">
      <FetchRunAutoRefresh active={running} />
      <h2 className={H2}>COAs from Cultivera</h2>
      {msg ? (
        <p
          className={`mb-3 rounded-[var(--admin-radius)] border px-3 py-2 text-sm ${tone === "ok" ? "border-emerald-500/40 text-[var(--admin-text)]" : "border-amber-500/50 text-[var(--admin-text)]"}`}
          data-testid="coa-from-cultivera-result"
        >
          {msg}
        </p>
      ) : null}
      {!panel.ok ? (
        <p className="text-sm text-[var(--admin-text-muted)]">Could not read the lots with no COA: {panel.error}</p>
      ) : (
        <>
          <p className="text-sm text-[var(--admin-text)]">
            <strong>{panel.missingLots}</strong> lot{panel.missingLots === 1 ? "" : "s"} with stock have no COA.{" "}
            {panel.transferIds.length > 0 ? (
              <>
                They came in on <strong>{panel.transferIds.length}</strong> Cultivera transfer{panel.transferIds.length === 1 ? "" : "s"} (
                {panel.transferIds.slice(0, 40).join(", ")}
                {panel.transferIds.length > 40 ? ", ..." : ""}).
              </>
            ) : null}
            {panel.lotsOffCultivera > 0 ? ` ${panel.lotsOffCultivera} are not on a Cultivera transfer (only the Gmail files can help those).` : ""}
          </p>
          <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm text-[var(--admin-text-muted)]">
            <li>
              <form action={fetchCoasFromCultiveraAction} className="flex flex-wrap items-center gap-3">
                <Button type="submit" variant="primary" size="sm" disabled={running || panel.transferIds.length === 0} data-testid="coa-fetch-button">
                  Fetch COAs from Cultivera
                </Button>
                <span>
                  Your crawler logs in with its saved Cultivera login and downloads each transfer&apos;s vendor file and, for every lot on
                  those transfers, its batch&apos;s COA document (read-only, a few minutes).
                </span>
              </form>
              {panel.setting ? (
                <p className="mt-1 text-xs" data-testid="coa-fetch-status">
                  Last crawl {panel.setting.runId}:{" "}
                  {panel.runError
                    ? panel.runError
                    : running
                      ? `running${wcia?.fetched_now != null ? ` (${wcia.fetched_now} files so far)` : "..."}`
                      : coaCrawlStatusLine({
                          status: st?.status ?? null,
                          transfers: panel.setting.transferIds.length,
                          wcia: wcia ?? null,
                          lotsStage: (st?.stages?.transfer_lots as TransferLotsStage | undefined) ?? null,
                          batchStage: (st?.stages?.batch_coas as BatchCoaStage | undefined) ?? null,
                          detailsMissing: details?.missing?.length ?? 0,
                          error: st?.error ?? null,
                        })}
                  {panel.setting.savedAt ? `; files saved ${panel.setting.savedAt.slice(0, 16).replace("T", " ")} UTC` : ""}
                </p>
              ) : null}
            </li>
            <li>
              <div className="flex flex-wrap items-center gap-3">
                <form action={attachAllCoasAction}>
                  <Button type="submit" variant="primary" size="sm" disabled={running} data-testid="coa-attach-button">
                    Attach all COAs
                  </Button>
                </form>
                <form action={attachAllCoasAction}>
                  <input type="hidden" name="dryRun" value="1" />
                  <Button type="submit" variant="neutral" size="sm" disabled={running} data-testid="coa-preview-button">
                    Preview first (writes nothing)
                  </Button>
                </form>
              </div>
              <p className="mt-1">
                Saves the fetched files, links each lot to its vendor lab result from its own Cultivera transfer, fills what is still missing
                from the WCIA files already crawled from Gmail, then links the rest to their Cultivera batch COA document (exact barcode on the
                lot&apos;s own transfer) and files that PDF. Only empty COAs are filled; a lot that has one is never changed. Safe to click
                again.
              </p>
            </li>
          </ol>
        </>
      )}
    </div>
  );
}

function CoaFromGmail({ panel, tone, msg }: { panel: GmailPanel; tone: string | undefined; msg: string | undefined }) {
  const searched = panel.rows.filter((r) => r.searchedAt).length;
  return (
    <div className={CARD} id="coa-from-gmail" data-testid="coa-from-gmail">
      <h2 className={H2}>COAs from Stephen&apos;s Gmail</h2>
      {msg ? (
        <p
          className={`mb-3 rounded-[var(--admin-radius)] border px-3 py-2 text-sm ${tone === "ok" ? "border-emerald-500/40 text-[var(--admin-text)]" : "border-amber-500/50 text-[var(--admin-text)]"}`}
          data-testid="coa-gmail-result"
        >
          {msg}
        </p>
      ) : null}
      {!panel.ok ? (
        <p className="text-sm text-[var(--admin-text-muted)]">Could not read the lots with no COA: {panel.error}</p>
      ) : (
        <>
          <p className="text-sm text-[var(--admin-text)]">
            <strong>{panel.missingLots}</strong> lot{panel.missingLots === 1 ? "" : "s"} with stock still have no COA, on <strong>{panel.rows.length}</strong>{" "}
            deliver{panel.rows.length === 1 ? "y" : "ies"} ({searched} searched in Gmail so far).
            {panel.error ? ` (${panel.error})` : ""}
          </p>
          <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm text-[var(--admin-text-muted)]">
            <li>
              <form action={searchGmailForCoasAction} className="flex flex-wrap items-center gap-3">
                <Button type="submit" variant="primary" size="sm" disabled={panel.rows.length === 0} data-testid="coa-gmail-search-button">
                  Search Gmail for the missing COAs
                </Button>
                <span>
                  Asks stephen@greenwaymarijuana.com exact questions for each delivery (its manifest number, its barcodes, its vendor around the
                  delivery date) and keeps every matching email&apos;s COA PDFs and vendor JSON. Gmail is only read. Click again if it says it is not
                  finished.
                </span>
              </form>
            </li>
            <li>
              <div className="flex flex-wrap items-center gap-3">
                <form action={attachCoasFromGmailAction}>
                  <Button type="submit" variant="primary" size="sm" data-testid="coa-gmail-attach-button">
                    Attach COAs from Gmail
                  </Button>
                </form>
                <form action={attachCoasFromGmailAction}>
                  <input type="hidden" name="dryRun" value="1" />
                  <Button type="submit" variant="neutral" size="sm" data-testid="coa-gmail-preview-button">
                    Preview first (writes nothing)
                  </Button>
                </form>
              </div>
              <p className="mt-1">
                Links each lot to the lab data in its vendor JSON (with the COA link), then reads the COA PDFs: a lot is linked only when a
                certificate prints its exact barcode. Only empty COAs are filled; the PDF is filed with the lab result. Safe to click again.
              </p>
            </li>
            <li>
              <form action={deepDigGmailAction} className="flex flex-wrap items-center gap-3">
                <Button type="submit" variant="primary" size="sm" disabled={panel.rows.length === 0} data-testid="coa-gmail-deep-button">
                  Deep dig (the last deliveries)
                </Button>
                <span>
                  For deliveries the search above could not finish: also asks by the vendor&apos;s license number, its brand names, the people
                  who sent its mail before (a rep&apos;s own Gmail too), the LCB manifest id, every barcode form and any JSON near the date, in
                  Spam and Trash as well. Every matching email and every reply in its thread is re-read in full (zip files, .txt files, every
                  link, a JSON pasted in the text), then the COAs are attached. Click again if it says it is not finished.
                </span>
              </form>
            </li>
          </ol>
          {panel.rows.length > 0 ? (
            <details className="mt-4" data-testid="coa-gmail-deliveries">
              <summary className="cursor-pointer text-sm font-bold text-[var(--admin-text)]">Deliveries still missing COAs ({panel.rows.length}; {panel.rows.reduce((n, r) => n + r.lots, 0)} lots) - search one at a time</summary>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-[var(--admin-text-muted)]">
                    <th className="py-1 pr-3">Vendor</th>
                    <th className="py-1 pr-3">Manifest</th>
                    <th className="py-1 pr-3">Date</th>
                    <th className="py-1 pr-3">Lots</th>
                    <th className="py-1 pr-3">Last searched</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody>
                  {panel.rows.map((r) => (
                    <tr key={r.manifestId} className="border-t border-[var(--admin-border)]">
                      <td className="py-1 pr-3">{r.vendorLabel ?? "Unknown vendor"}</td>
                      <td className="py-1 pr-3 font-mono text-xs">{r.manifestNumber ?? ""}</td>
                      <td className="py-1 pr-3">{r.transferDate ?? ""}</td>
                      <td className="py-1 pr-3">{r.lots}</td>
                      <td className="py-1 pr-3">{r.searchedAt ? `${r.searchedAt.slice(0, 10)} (${r.emails} email${r.emails === 1 ? "" : "s"})` : "never"}</td>
                      <td className="py-1">
                        <div className="flex flex-wrap gap-2">
                          <form action={searchGmailForOneAction}>
                            <input type="hidden" name="manifestId" value={r.manifestId} />
                            <Button type="submit" variant="neutral" size="sm" data-testid="coa-gmail-delivery-button">
                              Search Gmail
                            </Button>
                          </form>
                          <form action={deepDigGmailAction}>
                            <input type="hidden" name="manifestId" value={r.manifestId} />
                            <Button type="submit" variant="neutral" size="sm" data-testid="coa-gmail-deep-delivery-button">
                              Deep dig
                            </Button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}

function trustLineNow(panel: TrustPanel): string {
  return trustRunLine(panel.run, Date.now());
}

function CoaTrustAll({ panel, tone, msg }: { panel: TrustPanel; tone: string | undefined; msg: string | undefined }) {
  const running = panel.run?.status === "running";
  return (
    <div className={CARD} id="coa-trust-all" data-testid="coa-trust-all">
      <FetchRunAutoRefresh active={running} />
      <h2 className={H2}>Re-read every COA and trust it</h2>
      {msg ? (
        <p
          className={`mb-3 rounded-[var(--admin-radius)] border px-3 py-2 text-sm ${tone === "ok" ? "border-emerald-500/40 text-[var(--admin-text)]" : "border-amber-500/50 text-[var(--admin-text)]"}`}
          data-testid="coa-trust-all-result"
        >
          {msg}
        </p>
      ) : null}
      <p className="text-sm text-[var(--admin-text-muted)]">
        Every certificate that was never read, failed, or was only partly read is read again with a reader that takes any lab&apos;s layout, and
        then <strong>accepted</strong>: every COA we have is legitimate. The checks that did not pass are kept in the record as notes, not as
        failures. It runs on the server in the background (a batch every 5 minutes), so you can press it before bed and close the page.
      </p>
      {!panel.ok ? (
        <p className="mt-2 text-sm text-[var(--admin-text-muted)]">Could not read the run: {panel.error}</p>
      ) : (
        <>
          <p className="mt-3 text-sm text-[var(--admin-text)]" data-testid="coa-trust-all-status">
            {trustLineNow(panel)}
          </p>
          {panel.run?.recentErrors?.length ? (
            <details className="mt-2 text-xs text-[var(--admin-text-muted)]">
              <summary>Recent errors ({panel.run.recentErrors.length})</summary>
              <ul className="mt-1 list-disc pl-5">
                {panel.run.recentErrors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </details>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-3">
            <form action={startTrustAllAction}>
              <Button type="submit" variant="primary" size="sm" disabled={running} data-testid="coa-trust-all-start">
                Re-read every COA and trust it
              </Button>
            </form>
            {running ? (
              <form action={stopTrustAllAction}>
                <Button type="submit" variant="neutral" size="sm" data-testid="coa-trust-all-stop">
                  Stop
                </Button>
              </form>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

export default async function FixLaterPage({ searchParams }: { searchParams: Promise<{ coa?: string; coa_msg?: string; gm?: string; gm_msg?: string; tr?: string; tr_msg?: string; why?: string }> }) {
  await requirePermission("inventory.manage");
  const sp = await searchParams;
  const [read, coaPanel, gmailPanel, trustPanel] = await Promise.all([readFixLaterCoverage(), readCoaPanel(), readGmailPanel(), readTrustPanel()]);
  const filter = parseFixLaterFilter(sp.why);
  const sellingRows = read.ok
    ? read.coverage.rows.filter((r) => r.sells && r.fixLater.length > 0).map((r) => ({ ...r, delivery: read.lots.get(r.lotId)?.delivery ?? null }))
    : [];
  const shownRows = fixLaterRows(sellingRows, filter);

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: "Inventory", href: "/admin/inventory" }, { label: "Fix later" }]} />
      <AdminPageHeader
        title="Fix later"
        subtitle="Everything with stock sells at the register. These lots are selling with something missing; fix each one properly when you have time."
      />
      {!read.ok ? (
        <div className={CARD} data-testid="fix-later-error">
          {read.error}
        </div>
      ) : (
        <>
          <div className={CARD} data-testid="fix-later-summary">
            <p className="text-base font-bold text-[var(--admin-text)]">{coverageSentence(read.coverage)}</p>
            {!read.complete ? (
              <p className="mt-2 text-sm text-[var(--admin-text-muted)]">The lot list may be incomplete (a read stopped early). Refresh to try again.</p>
            ) : null}
            <ul className="mt-3 space-y-1 text-sm text-[var(--admin-text-muted)]">
              {(Object.keys(read.coverage.byFixLater) as FixLaterReason[]).map((r) => (
                <li key={r}>
                  <strong>{read.coverage.byFixLater[r]}</strong> {REASON_SHORT[r]}: {FIX_LATER_REASON_LABELS[r]}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-[var(--admin-text-muted)]">
              At the register, a scan that finds nothing offers <strong>Fix &amp; sell</strong>: the system builds the line from the lot, adds
              it to the cart and lists it here.
            </p>
          </div>

          <CoaFromCultivera panel={coaPanel} tone={sp.coa} msg={sp.coa_msg} />
          <CoaFromGmail panel={gmailPanel} tone={sp.gm} msg={sp.gm_msg} />
          <CoaTrustAll panel={trustPanel} tone={sp.tr} msg={sp.tr_msg} />

          {read.coverage.stoppedLots > 0 ? (
            <div className={CARD} data-testid="fix-later-stopped">
              <h2 className={H2}>Stopped for safety ({read.coverage.stoppedLots})</h2>
              <table className="w-full text-sm">
                <tbody>
                  {read.coverage.rows
                    .filter((r) => !r.sells)
                    .map((r) => (
                      <tr key={r.lotId} className="border-t border-[var(--admin-border)]">
                        <td className="py-1 pr-3">
                          <Link className="underline" href={`/admin/inventory/${r.lotId}`}>
                            {r.label}
                          </Link>
                        </td>
                        <td className="py-1 pr-3">{r.units}</td>
                        <td className="py-1">{r.stop ? REGISTER_STOP_LABELS[r.stop] : "No product key on the lot."}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className={CARD} id="fix-later-list" data-testid="fix-later-list">
            <h2 className={H2}>Selling now, fix later ({sellingRows.length})</h2>
            {/* D207e: say what this table is (every reason, not only a missing COA) and filter by reason. */}
            <p className="mb-3 text-sm text-[var(--admin-text-muted)]" data-testid="fix-later-explain">
              {fixLaterExplain(sellingRows)}
            </p>
            <div className="mb-3 flex flex-wrap gap-2" data-testid="fix-later-filter">
              {fixLaterChips(sellingRows).map((c) => (
                <Link
                  key={c.key}
                  href={c.key === "all" ? "/admin/inventory/fix-later#fix-later-list" : `/admin/inventory/fix-later?why=${c.key}#fix-later-list`}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    filter === c.key ? "border-[var(--admin-accent)] bg-[var(--admin-accent)] text-black" : "border-[var(--admin-border)] text-[var(--admin-text)]"
                  }`}
                  data-testid={`fix-later-filter-${c.key}`}
                >
                  {c.key === "all" ? "All" : REASON_SHORT[c.key]} ({c.count})
                </Link>
              ))}
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-[var(--admin-text-muted)]">
                  <th className="py-1 pr-3">Lot</th>
                  <th className="py-1 pr-3">Delivery (vendor + manifest)</th>
                  <th className="py-1 pr-3">Lot barcode</th>
                  <th className="py-1 pr-3">Units</th>
                  <th className="py-1">What to fix</th>
                </tr>
              </thead>
              <tbody>
                {shownRows.map((r) => (
                  <tr key={r.lotId} className="border-t border-[var(--admin-border)] align-top">
                    <td className="py-1 pr-3">
                      <Link className="underline" href={`/admin/inventory/${r.lotId}`}>
                        {r.label}
                      </Link>
                    </td>
                    <td className="py-1 pr-3 text-xs">{r.delivery ?? ""}</td>
                    <td className="py-1 pr-3 font-mono text-xs">{read.lots.get(r.lotId)?.lotCode ?? ""}</td>
                    <td className="py-1 pr-3">{r.units}</td>
                    <td className="py-1">
                      {r.fixLater.map((x) => REASON_SHORT[x]).join(" · ")}
                      {r.fixLater.includes("no_coa") ? (
                        <div className="mt-1 flex flex-wrap gap-2">
                          <form action={searchGmailForOneAction}>
                            <input type="hidden" name="lotId" value={r.lotId} />
                            <Button type="submit" variant="neutral" size="sm" data-testid="coa-gmail-lot-button">
                              Search Gmail for this COA
                            </Button>
                          </form>
                          <Link
                            className="self-center text-xs font-semibold text-[var(--admin-accent)] underline"
                            href={`/admin/inventory/${r.lotId}#coa-doc`}
                            data-testid="fix-later-attach-doc"
                          >
                            Paste a COA link / upload the PDF
                          </Link>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
