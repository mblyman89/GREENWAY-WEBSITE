/**
 * MigrationGarbagePanel — R50 S10c (D-15). Read-only CCRS hub panel: "dead
 * records the Cultivera migration brought in, and how each one leaves CCRS".
 * Every action link goes to an EXISTING screen (R15b adjust-out, the lot page,
 * the CCRS files list); this panel writes nothing.
 */
import Link from "next/link";
import {
  DEAD_REASON_LABEL,
  GARBAGE_ROUTES,
  OPEN_ROUTES,
  ROUTE_LABEL,
  garbageHeadline,
  noReceivedDateNote,
  routeActionHref,
  type GarbageRoute,
} from "@/lib/compliance/ccrs-migration-garbage-core";
import type { GarbageLoad } from "@/lib/compliance/ccrs-migration-garbage-store";

export const GARBAGE_PANEL_ROW_CAP = 200;

export const GARBAGE_PANEL_HELP = [
  "The examiner's office has OK'd cleaning these out of CCRS (decision D-15). The goal is the one Brian set: CCRS and our inventory must match.",
  "A record is called dead only on evidence: it is missing from Cultivera's product list, it has no barcode, or it has no received date (your rule: no receive date means it does not exist). Fixable problems (cost, potency, size, COA) are listed below for fixing, not removal.",
  "\"Zero it out in CCRS\" uses the guide's Reconciliation reason (\"Balance inventory\"). Open the import's Missing products screen, type the confirmation, and the adjustment goes into the next weekly upload.",
  "The system never sends a Delete for a migrated lot. CCRS has not shown in writing what a Delete does to a lot that has sales behind it (U-46).",
];

const ROUTE_TONE: Record<GarbageRoute, string> = {
  zero_in_ccrs: "border-orange-400/30 bg-orange-400/10 text-orange-100",
  fix_status: "border-amber-400/30 bg-amber-400/10 text-amber-100",
  local_only: "border-sky-400/30 bg-sky-400/10 text-sky-100",
  reconcile_first: "border-red-400/30 bg-red-400/10 text-red-100",
  zeroed: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
  already_removed: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
  unknown: "border-white/15 bg-white/5 text-white/70",
};

export function MigrationGarbagePanel({ load }: { load: GarbageLoad }) {
  return (
    <section
      id="migration-garbage"
      data-testid="migration-garbage-panel"
      className="rounded-2xl border border-white/10 bg-white/[0.02] p-5"
    >
      <div className="mb-3">
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/80">Migration clean-up — dead records to remove from CCRS</h2>
        <p className="mt-1 text-xs text-white/40">Before the first CCRS upload, clear every orange and blue row.</p>
      </div>
      {!load.ok ? (
        <p data-testid="migration-garbage-error" className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-2 text-xs text-red-100">
          Could not build the clean-up list: {load.error} Nothing is shown rather than a partial list. Reload the page; if it keeps failing, tell the developer.
        </p>
      ) : load.state === "no_migration" ? (
        <p data-testid="migration-garbage-none" className="text-xs text-white/50">
          The one-time Cultivera import has not been published yet. Once it is, this panel lists the dead records it brought in.
        </p>
      ) : (
        <Body load={load} />
      )}
      <details className="mt-4 text-xs text-white/50">
        <summary className="cursor-pointer font-semibold text-white/60">How this works</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {GARBAGE_PANEL_HELP.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function Body({ load }: { load: Extract<GarbageLoad, { state: "ready" }> }) {
  const r = load.report;
  const shown = r.rows.slice(0, GARBAGE_PANEL_ROW_CAP);
  return (
    <div className="space-y-3">
      <p data-testid="migration-garbage-headline" className="text-sm font-semibold text-white/85">
        {garbageHeadline(r)}
      </p>
      {!r.ledgerLoaded ? (
        <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-[11px] text-amber-100">
          CCRS ledger not loaded ({load.ledgerAbsentReason ?? "unknown"}). Until it is, every row shows Unknown and no CCRS action is offered.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2 text-[11px]" data-testid="migration-garbage-chips">
        {GARBAGE_ROUTES.filter((k) => r.byRoute[k] > 0).map((k) => (
          <span key={k} data-route={k} className={`rounded-full border px-3 py-1 ${ROUTE_TONE[k]}`}>
            {ROUTE_LABEL[k]}: {r.byRoute[k]}
          </span>
        ))}
      </div>
      {r.unitsToZero > 0 ? (
        <p className="text-xs text-white/60">
          {r.unitsToZero.toLocaleString()} unit(s) will be zeroed out in CCRS by Reconciliation.{" "}
          <Link className="font-semibold text-orange-200 underline" href={`/admin/menu-imports/${load.importId}/missing-products`}>
            Open Missing products to zero them out
          </Link>
        </p>
      ) : null}
      {shown.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs" data-testid="migration-garbage-table">
            <thead className="text-white/40">
              <tr>
                <th className="py-1 pr-3">Product</th>
                <th className="py-1 pr-3">CCRS id</th>
                <th className="py-1 pr-3">Qty</th>
                <th className="py-1 pr-3">Why it is dead</th>
                <th className="py-1 pr-3">What to do</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const href = routeActionHref(row.route, { importId: load.importId, lotId: row.lotId, reasons: row.reasons });
                return (
                  <tr key={row.lotId} data-route={row.route} className="border-t border-white/5">
                    <td className="py-1 pr-3 text-white/80">{row.productName}</td>
                    <td className="py-1 pr-3 font-mono text-white/60">{row.ccrsId ?? "—"}</td>
                    <td className="py-1 pr-3">{row.qty}</td>
                    <td className="py-1 pr-3 text-white/60">{row.reasons.map((x) => DEAD_REASON_LABEL[x]).join("; ")}</td>
                    <td className="py-1 pr-3">
                      {href ? (
                        <Link href={href} className={`underline ${OPEN_ROUTES.has(row.route) ? "font-semibold" : ""}`}>
                          {ROUTE_LABEL[row.route]}
                        </Link>
                      ) : (
                        ROUTE_LABEL[row.route]
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {r.rows.length > shown.length ? (
            <p className="mt-2 text-[11px] text-white/50" data-testid="migration-garbage-cap">
              Showing the first {shown.length} of {r.rows.length}. The counts above cover all {r.rows.length}.
            </p>
          ) : null}
        </div>
      ) : null}
      {noReceivedDateNote(r) ? (
        <p data-testid="migration-garbage-undated" className="text-xs text-white/60">
          {noReceivedDateNote(r)}{" "}
          <Link className="font-semibold text-orange-200 underline" href={`/admin/menu-imports/${load.importId}/received-dates`}>
            Open Received dates
          </Link>
        </p>
      ) : null}
      {r.fixableTotal > 0 ? (
        <div className="text-xs text-white/60" data-testid="migration-garbage-fixable">
          <p className="font-semibold text-white/70">Fixable, not dead ({r.fixableTotal}) — fix these, do not remove them:</p>
          <ul className="mt-1 list-disc pl-5">
            {r.fixable.map((f) => (
              <li key={f.code}>
                {f.label}: {f.count}
              </li>
            ))}
          </ul>
          <Link className="mt-1 inline-block underline" href={`/admin/menu-imports/${load.importId}/facts`}>
            Open the import&rsquo;s fact review
          </Link>
        </div>
      ) : null}
    </div>
  );
}
