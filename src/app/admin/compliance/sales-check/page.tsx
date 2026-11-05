/**
 * /admin/compliance/sales-check  (D183, round slice S6)
 *
 * Owner (2026-11-04): "The numbers and data need to make it to CCRS and I need
 * to pay the correct amount in taxes."
 *
 * Two plain-English checks:
 *   1. Did every sale line of the week reach a CCRS Sale file, with the same
 *      money the register took? (filed / held / missing / money mismatch)
 *   2. Does any lot show more sold than it ever had? (a lot shortfall makes
 *      CCRS reject the inventory) and, for each one, the one safe fix.
 *
 * Anyone with reports.view can read it. Only the owner sees and can press the
 * repair buttons (the actions are requireBooksAccess too). The repairs change
 * records, never stock and never money.
 */
import { requirePermission } from "@/lib/auth/session";
import { canReadBooks, formatCents } from "@/lib/accounting/books-view-core";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Button, Card } from "@/components/admin/ui";
import { PendingSubmit } from "@/components/admin/compliance/PendingSubmit";
import { pacificToday } from "@/lib/reports/timezone";
import { parseLedgerEnv } from "@/lib/compliance/ccrs-ledger-store-core";
import { checkLots, checkWeek, recentWeeks, resolveWeek, TAXES_OWED_PAGE } from "@/lib/compliance/ccrs-completeness-store";
import type { CompletenessStatus } from "@/lib/compliance/ccrs-completeness-core";
import { correctCountAction, moveSaleLineAction } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_TEXT: Record<CompletenessStatus, { label: string; tone: "ok" | "warn" | "bad" }> = {
  complete: { label: "Complete", tone: "ok" },
  pending: { label: "Week still running", tone: "warn" },
  held: { label: "Some lines held", tone: "warn" },
  missing: { label: "Lines missing", tone: "bad" },
  money: { label: "Money does not match", tone: "bad" },
  unknown: { label: "Could not check", tone: "bad" },
};

function toneClass(t: "ok" | "warn" | "bad"): string {
  return t === "ok"
    ? "border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]"
    : t === "warn"
      ? "border-amber-400/50 bg-amber-50 text-amber-800"
      : "border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] text-[var(--admin-danger)]";
}

export default async function SalesCheckPage({ searchParams }: { searchParams: Promise<{ week?: string; env?: string; error?: string; saved?: string }> }) {
  const session = await requirePermission("reports.view");
  const isOwner = canReadBooks(session.profile.role);
  const sp = await searchParams;
  const todayIso = pacificToday();
  const env = parseLedgerEnv(sp.env);
  const week = resolveWeek(sp.week, todayIso);
  const weeks = recentWeeks(todayIso, 6);
  const [wc, lots] = await Promise.all([checkWeek(env, week), checkLots()]);
  const r = wc.result;
  const st = STATUS_TEXT[r.status];
  const otherEnv = env === "prod" ? "preprod" : "prod";
  const q = (w: string, e: string) => `?week=${encodeURIComponent(w)}&env=${e}`;

  return (
    <div>
      <AdminPageHeader
        title="CCRS sales check"
        subtitle="Did every sale reach CCRS with the right money, and does every lot add up?"
        breadcrumbs={<Breadcrumbs items={[{ label: "CCRS Command Center", href: "/admin/compliance/ccrs" }, { label: "Sales check" }]} />}
        action={
          <Button href={TAXES_OWED_PAGE} variant="neutral" size="sm">
            Taxes owed
          </Button>
        }
      />
      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.error ? (
          <div role="alert" className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-4 py-3 text-sm text-[var(--admin-danger)]">
            {sp.error}
          </div>
        ) : null}
        {sp.saved ? (
          <div role="status" className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
            {sp.saved}
          </div>
        ) : null}

        <HelpPanel
          id="sales-check"
          title="How the sales check works"
          steps={[
            "Every cannabis line the register sold in the week should be in a CCRS Sale file (or on the held list with a reason). Lines in neither are MISSING.",
            "The money in the filed rows (quantity x price - discount + taxes) must match what the register took, to within one cent per line.",
            "A lot cannot sell more than it ever had. When it does, CCRS rejects it. Each shortfall below says why and gives the one safe fix.",
            "Fixes change records only: which lot a sale names, or a count correction. They never change stock on the shelf and never change money. Michael presses them; every press is audited.",
          ]}
        />

        <Card>
          <div className="space-y-4 p-5" data-testid="sales-check-week">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-[var(--admin-text)]">Week:</span>
              {weeks.map((w) => (
                <a
                  key={w.key}
                  href={q(w.key, env)}
                  className={`rounded-full border px-3 py-1 ${w.key === week.key ? "border-[var(--admin-accent)] bg-[var(--admin-accent-soft)] font-semibold" : "border-[var(--admin-border)]"}`}
                >
                  {w.start}
                </a>
              ))}
              <span className="ml-auto text-[var(--admin-text-muted)]">
                Checking CCRS {env === "prod" ? "Production" : "Preprod (test)"} files.{" "}
                <a className="underline" href={q(week.key, otherEnv)}>
                  Check {otherEnv === "prod" ? "Production" : "Preprod"} instead
                </a>
              </span>
            </div>

            <div className={`rounded-[var(--admin-radius)] border px-4 py-3 text-sm ${toneClass(st.tone)}`}>
              <div className="font-bold">{st.label}</div>
              <div>{r.headline}</div>
            </div>

            {r.readErrors.length ? (
              <ul className="list-disc pl-5 text-sm text-[var(--admin-danger)]">
                {r.readErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : null}

            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-[var(--admin-text-muted)]">Cannabis lines sold</dt>
                <dd className="text-lg font-bold">{r.lines}</dd>
              </div>
              <div>
                <dt className="text-[var(--admin-text-muted)]">Filed</dt>
                <dd className="text-lg font-bold">{r.filed}</dd>
              </div>
              <div>
                <dt className="text-[var(--admin-text-muted)]">Held (with a reason)</dt>
                <dd className="text-lg font-bold">{r.held}</dd>
              </div>
              <div>
                <dt className="text-[var(--admin-text-muted)]">{wc.weekEnded ? "Missing" : "Not filed yet"}</dt>
                <dd className="text-lg font-bold">{r.missing}</dd>
              </div>
              <div>
                <dt className="text-[var(--admin-text-muted)]">Register took (all lines)</dt>
                <dd className="font-semibold">{formatCents(r.takenMinor)}</dd>
              </div>
              <div>
                <dt className="text-[var(--admin-text-muted)]">Register took (filed lines)</dt>
                <dd className="font-semibold">{formatCents(r.takenFiledMinor)}</dd>
              </div>
              <div>
                <dt className="text-[var(--admin-text-muted)]">Filed rows carry</dt>
                <dd className="font-semibold">{formatCents(r.filedMinor)}</dd>
              </div>
              <div>
                <dt className="text-[var(--admin-text-muted)]">Difference (allowed {formatCents(r.toleranceMinor)})</dt>
                <dd className="font-semibold">{formatCents(r.moneyDiffMinor)}</dd>
              </div>
            </dl>
            {r.excluded ? <p className="text-xs text-[var(--admin-text-muted)]">{r.excluded} non-cannabis line(s) are left out: CCRS does not take them.</p> : null}
            {r.filedTwice.length ? (
              <p className="text-sm text-[var(--admin-danger)]">Filed twice in live files: {r.filedTwice.slice(0, 10).join(", ")}{r.filedTwice.length > 10 ? " …" : ""}</p>
            ) : null}

            {r.missingLines.length ? (
              <details>
                <summary className="cursor-pointer text-sm font-semibold">{wc.weekEnded ? "Missing" : "Not filed yet"} lines ({r.missingLines.length})</summary>
                <table className="mt-2 w-full text-left text-xs">
                  <thead>
                    <tr className="text-[var(--admin-text-muted)]">
                      <th className="py-1">Day</th>
                      <th>Order</th>
                      <th>Sale detail id</th>
                      <th>Qty</th>
                      <th>Money</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.missingLines.slice(0, 200).map((l) => (
                      <tr key={l.detailId} className="border-t border-[var(--admin-border)]">
                        <td className="py-1">{l.day}</td>
                        <td>{l.orderNumber ?? "—"}</td>
                        <td className="font-mono">{l.detailId}</td>
                        <td>{l.quantity}</td>
                        <td>{formatCents(l.moneyMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            ) : null}

            {r.heldLines.length ? (
              <details>
                <summary className="cursor-pointer text-sm font-semibold">Held lines ({r.heldLines.length}): fix these on the CCRS Command Center</summary>
                <table className="mt-2 w-full text-left text-xs">
                  <thead>
                    <tr className="text-[var(--admin-text-muted)]">
                      <th className="py-1">Day</th>
                      <th>Sale detail id</th>
                      <th>Why held</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.heldLines.slice(0, 200).map((l) => (
                      <tr key={l.detailId} className="border-t border-[var(--admin-border)]">
                        <td className="py-1">{l.day}</td>
                        <td className="font-mono">{l.detailId}</td>
                        <td>{l.reason || l.code}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            ) : null}
          </div>
        </Card>

        <Card>
          <div id="lots" className="space-y-4 p-5" data-testid="sales-check-lots">
            <h2 className="text-base font-bold text-[var(--admin-text)]">Lots that sold more than they had</h2>
            {lots.errors.length ? (
              <ul className="list-disc pl-5 text-sm text-[var(--admin-danger)]">
                {lots.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : null}
            {!lots.errors.length && !lots.shortfalls.length ? (
              <p className="text-sm text-[var(--admin-accent)]">All {lots.lots} lots add up: none sold more than it received.</p>
            ) : null}
            {lots.shortfalls.map((s) => (
              <div key={s.lot.id} className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-4 text-sm">
                <div className="font-semibold">
                  {s.lot.productName ?? "Unknown product"} <span className="font-mono text-xs text-[var(--admin-text-muted)]">lot {s.lot.lotCode ?? s.lot.ext}</span>
                </div>
                <p className="mt-1">{s.sentence}</p>
                <p className="mt-1 text-[var(--admin-text-muted)]">Fix: {s.fix}</p>
                {s.lockedLines ? <p className="mt-1 text-xs text-[var(--admin-text-muted)]">{s.lockedLines} line(s) on this lot are already in CCRS Production and are never moved.</p> : null}
                {isOwner && s.repair?.kind === "move" ? (
                  <form action={moveSaleLineAction} className="mt-3" data-testid="lot-repair-move">
                    <input type="hidden" name="lineId" value={s.repair.lineId} />
                    <input type="hidden" name="detailId" value={s.repair.detailId} />
                    <input type="hidden" name="quantity" value={String(s.repair.quantity)} />
                    <input type="hidden" name="fromLotId" value={s.repair.fromLotId} />
                    <input type="hidden" name="fromExt" value={s.repair.fromExt} />
                    <input type="hidden" name="toLotId" value={s.repair.toLotId} />
                    <input type="hidden" name="toExt" value={s.repair.toExt} />
                    <input type="hidden" name="toLotCode" value={s.repair.toLotCode ?? ""} />
                    <input type="hidden" name="sameProductKey" value={s.repair.sameProductKey ? "1" : "0"} />
                    <PendingSubmit busy="Moving…" testId="lot-repair-move-submit" className="rounded-lg bg-[var(--admin-accent)] px-4 py-2 text-sm font-semibold text-white">
                      Move sale {s.repair.detailId} to lot {s.repair.toLotCode ?? s.repair.toExt}
                    </PendingSubmit>
                  </form>
                ) : null}
                {isOwner && s.repair?.kind === "count" ? (
                  <form action={correctCountAction} className="mt-3" data-testid="lot-repair-count">
                    <input type="hidden" name="lotId" value={s.repair.lotId} />
                    <input type="hidden" name="ext" value={s.repair.ext} />
                    <input type="hidden" name="quantity" value={String(s.repair.quantity)} />
                    <PendingSubmit busy="Correcting…" testId="lot-repair-count-submit" className="rounded-lg bg-[var(--admin-accent)] px-4 py-2 text-sm font-semibold text-white">
                      Correct the count by +{s.repair.quantity}
                    </PendingSubmit>
                  </form>
                ) : null}
              </div>
            ))}
            {lots.aboveReceived.length ? (
              <p className="text-xs text-[var(--admin-text-muted)]">
                {lots.aboveReceived.length} lot(s) hold more than they received because a count added units. That is allowed: CCRS is told by the Reconciliation adjustment.
              </p>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
