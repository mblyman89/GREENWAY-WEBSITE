/**
 * /admin/promotions/clearance — Clearance markdowns (Fix Phase 4.5b · F-06-17 · D57)
 *
 * The owner, verbatim: "a 50% off products we have been sitting on for too
 * long and things about to expire. ... Those items are excluded from any and
 * all other sales/ daily deals" (markdown-lock-core.ts L8-11).
 *
 * Lists the products to clear (expiring within 30 days, expired-but-sellable,
 * or on the shelf too long), says why each one is here and why any cannot be
 * marked down, and creates ONE draft promotion: percent off, product targets,
 * the markdown lock on. Publish happens on the promotion page, through the
 * normal below-cost guard. Nothing is published from here.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Badge } from "@/components/admin/ui";
import { formatCents } from "@/lib/accounting/books-view-core";
import { pacificToday } from "@/lib/reports/timezone";
import { loadClearanceInputs } from "@/lib/promotions/clearance-store";
import {
  CLEARANCE_BLOCK_TEXT,
  CLEARANCE_EXPIRING_DAYS,
  CLEARANCE_MAX_PERCENT,
  CLEARANCE_MAX_SITTING_DAYS,
  CLEARANCE_MIN_PERCENT,
  CLEARANCE_MIN_SITTING_DAYS,
  CLEARANCE_OWNER_QUOTE,
  clampPercent,
  clampSittingDays,
  findClearanceCandidates,
  preselected,
  reasonText,
  type ClearanceCandidate,
} from "@/lib/promotions/clearance-core";
import { createClearanceDraftAction } from "./actions";

export const dynamic = "force-dynamic";

const CARD = "rounded-2xl border border-white/10 bg-white/[0.02] p-5";
const P = "text-sm leading-relaxed text-[var(--admin-text-muted)]";
const INPUT = "rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white";

type SP = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

export default async function ClearancePage({ searchParams }: { searchParams: SP }) {
  await requirePermission("promotions.manage");
  const sp = await searchParams;
  const percent = clampPercent(one(sp.percent));
  const sittingDays = clampSittingDays(one(sp.sitting));
  const error = one(sp.error);
  const today = pacificToday();
  const read = await loadClearanceInputs();
  const candidates = read.ok ? findClearanceCandidates({ ...read.data, today, settings: { percent, sittingDays } }) : [];
  const open = candidates.filter((c) => c.blocked === null);
  const blocked = candidates.filter((c) => c.blocked !== null);

  return (
    <div>
      <AdminPageHeader
        title="Clearance markdowns"
        subtitle="Expiring stock and stock sitting too long: one markdown, excluded from every other deal."
      />
      <div className="space-y-5 px-5 py-6 sm:px-8" data-testid="clearance-page">
        <Breadcrumbs items={[{ label: "Promotions", href: "/admin/promotions" }, { label: "Clearance markdowns" }]} />

        <section className={CARD}>
          <p className={P}>
            Your rule: <em>&ldquo;{CLEARANCE_OWNER_QUOTE}&rdquo;</em>
          </p>
          <p className={`mt-2 ${P}`}>
            This page lists products expiring within {CLEARANCE_EXPIRING_DAYS} days (the same window as Plan a count &rarr; Expiring
            soon), products already expired that the register only warns on, and products on the shelf {sittingDays} days or more.
            Tick what to clear and press <strong>Create draft markdown</strong>. The draft is a {percent}% off promotion on those
            products with <strong>This is a markdown</strong> ticked (the form&apos;s <strong>Clearance or vendor-day markdown</strong> box). Open it, check the products, and
            press Publish: the below-cost check runs then, like every promotion.
          </p>
          <form method="get" className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-xs text-white/70">
              Percent off
              <input name="percent" type="number" min={CLEARANCE_MIN_PERCENT} max={CLEARANCE_MAX_PERCENT} defaultValue={percent} className={`${INPUT} ml-2 w-24`} />
            </label>
            <label className="text-xs text-white/70">
              Sitting too long after (days)
              <input name="sitting" type="number" min={CLEARANCE_MIN_SITTING_DAYS} max={CLEARANCE_MAX_SITTING_DAYS} defaultValue={sittingDays} className={`${INPUT} ml-2 w-24`} />
            </label>
            <button type="submit" className="rounded-lg border border-white/20 px-3 py-2 text-xs font-semibold text-white hover:bg-white/5">
              Show
            </button>
            <span className="text-xs text-white/45">These change this view only; nothing is saved until you create the draft.</span>
          </form>
        </section>

        {error ? (
          <p className="rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-2 text-sm text-red-200" role="alert">
            {error}
          </p>
        ) : null}

        {!read.ok ? (
          <section className={CARD} role="alert">
            <p className="text-sm text-red-200">{read.error}</p>
          </section>
        ) : (
          <>
            {!read.data.menuPublished ? (
              <p className="rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 px-4 py-2 text-sm text-[var(--admin-gold)]">
                No menu is published, so no product has a price to mark down.
              </p>
            ) : null}

            {open.length === 0 ? (
              <section className={CARD}>
                <h2 className="text-sm font-bold text-white">Nothing to clear right now</h2>
                <p className={`mt-1 ${P}`}>No product with stock is expiring within {CLEARANCE_EXPIRING_DAYS} days or has sat {sittingDays} days or more.</p>
              </section>
            ) : (
              <form action={createClearanceDraftAction} className="space-y-4">
                <input type="hidden" name="percent" value={percent} />
                <input type="hidden" name="sittingDays" value={sittingDays} />
                <section className={CARD}>
                  <h2 className="text-sm font-bold text-white">
                    {open.length} product{open.length === 1 ? "" : "s"} to clear at {percent}% off
                  </h2>
                  <p className={`mt-1 ${P}`}>
                    Products already on a markdown are listed but not ticked. Every lot of a ticked product is marked down: the
                    register cannot tell one lot of a product from another.
                  </p>
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="text-xs uppercase tracking-wide text-white/45">
                        <tr>
                          <th className="py-2 pr-3">Clear</th>
                          <th className="py-2 pr-3">Product</th>
                          <th className="py-2 pr-3">Why</th>
                          <th className="py-2 pr-3">On hand</th>
                          <th className="py-2 pr-3">Price</th>
                          <th className="py-2 pr-3">At {percent}% off</th>
                        </tr>
                      </thead>
                      <tbody>
                        {open.map((c) => (
                          <Row key={c.key} c={c} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
                <section className={CARD}>
                  <label className="block text-xs text-white/70">
                    Name of the markdown (optional)
                    <input name="title" placeholder={`Clearance ${percent}% off \u2014 ${today}`} className={`${INPUT} mt-1 w-full max-w-lg`} />
                  </label>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button type="submit" className="rounded-lg bg-[var(--admin-accent)] px-4 py-2 text-sm font-semibold text-black hover:bg-[#6bc945]">
                      Create draft markdown
                    </button>
                    <span className="text-xs text-white/50">Saved as a draft. Nothing changes at the register until you publish it.</span>
                  </div>
                </section>
              </form>
            )}

            {blocked.length > 0 ? (
              <section className={CARD} data-testid="clearance-blocked">
                <h2 className="text-sm font-bold text-white">
                  {blocked.length} product{blocked.length === 1 ? "" : "s"} that cannot be marked down here
                </h2>
                <ul className="mt-3 space-y-2">
                  {blocked.map((c) => (
                    <li key={c.key} className="text-sm text-white/80">
                      <span className="font-semibold text-white">{c.productName}</span>
                      {c.lots[0]?.lotCode ? <span className="ml-2 font-mono text-xs text-white/50">{c.lots.map((l) => l.lotCode ?? "NO LOT CODE").join(", ")}</span> : null}
                      <span className="block text-xs text-[var(--admin-text-muted)]">
                        {c.reasons.map(reasonText).join(" ")} {CLEARANCE_BLOCK_TEXT[c.blocked!]}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}

        <p className="text-xs text-white/40">
          Confirm what is really on the shelf first?{" "}
          <Link href="/admin/inventory/audits/new?gen=expiring" className="text-[var(--admin-accent)] hover:underline">
            Plan a count &rarr; Expiring soon
          </Link>{" "}
          &middot;{" "}
          <Link href="/admin/promotions" className="text-[var(--admin-accent)] hover:underline">
            Back to promotions
          </Link>
        </p>
      </div>
    </div>
  );
}

function Row({ c }: { c: ClearanceCandidate }) {
  return (
    <tr className="border-t border-white/10 align-top" data-testid="clearance-row">
      <td className="py-2 pr-3">
        <input type="checkbox" name="key" value={c.key} defaultChecked={preselected(c)} aria-label={`Clear ${c.productName}`} />
      </td>
      <td className="py-2 pr-3">
        <span className="font-semibold text-white">{c.productName}</span>
        {c.brand ? <span className="block text-xs text-white/50">{c.brand}</span> : null}
        <span className="block font-mono text-[11px] text-white/45">{c.lots.map((l) => l.lotCode ?? "NO LOT CODE").join(", ")}</span>
        {c.existing.length > 0 ? (
          <span className="mt-1 block">
            {c.existing.map((e) => (
              <Link key={e.promotionId} href={`/admin/promotions/${e.promotionId}`} className="mr-1">
                <Badge tone="gold">
                  Already on {e.title} ({e.percent}%, {e.status})
                </Badge>
              </Link>
            ))}
          </span>
        ) : null}
      </td>
      <td className="py-2 pr-3 text-xs text-white/75">{c.reasons.map(reasonText).join(" ")}</td>
      <td className="py-2 pr-3 text-xs text-white/75">{c.onHandQty}</td>
      <td className="py-2 pr-3 text-xs text-white/75">{c.priceMinorUnits === null ? "\u2014" : formatCents(c.priceMinorUnits)}</td>
      <td className="py-2 pr-3 text-xs text-white/75">
        {c.markdownPriceMinorUnits === null ? "\u2014" : formatCents(c.markdownPriceMinorUnits)}
        {c.belowCost ? (
          <span className="mt-1 block">
            <Badge tone="orange">Under cost {formatCents(c.maxUnitCostMinorUnits ?? 0)}</Badge>
          </span>
        ) : null}
      </td>
    </tr>
  );
}
