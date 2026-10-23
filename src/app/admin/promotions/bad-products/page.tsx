/**
 * /admin/promotions/bad-products  (R74 S27, owner round 12)
 *
 * "I like the bad product queue ... Please add those in this next round."
 *
 * One screen of every published product with a problem that would trip a
 * promotion or a sale: no price, priced at/below the legal floor, waiting for
 * a category, no cost on file, stock with no COA, hidden while you hold
 * stock. Each row has the fix: Hide from menu and Never discount are buttons
 * (the round 11 promotion-page writes, reused); the rest open the page that
 * really fixes it. All the decisions are in bad-product-queue-core.ts.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui/Button";
import { formatMoneyMinor } from "@/lib/promotions/discount-engine-core";
import { loadBadProductQueue } from "@/lib/promotions/bad-product-queue";
import {
  KIND_MEANING,
  KIND_TITLE,
  MAX_QUEUE_FIX_PER_PRESS,
  QUEUE_KINDS,
  rowAllowsFix,
  rowsOfKind,
  type QueueKind,
  type QueueRow,
} from "@/lib/promotions/bad-product-queue-core";
import { fixBadProductsAction } from "./actions";

export const dynamic = "force-dynamic";

const SHOW_PER_SECTION = 100;

function productHref(key: string): string {
  return `/admin/products/${encodeURIComponent(key)}`;
}

/** The link-type fixes for one row in one section (never a dead end). */
function linkFixes(row: QueueRow, kind: QueueKind): { href: string; label: string }[] {
  const out: { href: string; label: string }[] = [];
  if (kind === "no_price" || kind === "below_floor") {
    if (row.lotId && row.variantCount <= 1) out.push({ href: `/admin/inventory/${row.lotId}#after_tax_price`, label: "Fix price on the lot" });
  }
  if (kind === "no_cost" && row.lotId) out.push({ href: `/admin/inventory/${row.lotId}`, label: "Open the lot (cost comes from the manifest)" });
  if (kind === "needs_category") {
    if (row.lotId) out.push({ href: `/admin/inventory/${row.lotId}#website-category`, label: "Pick its category on the lot" });
    out.push({ href: "/admin/settings/types?tab=inventory", label: "Types & Categories" });
  }
  if (kind === "missing_coa" && row.coaLotId) out.push({ href: `/admin/inventory/${row.coaLotId}#coa`, label: "Link a COA on the lot" });
  if (kind === "hidden_with_stock") out.push({ href: `${productHref(row.key)}#visibility`, label: "Visibility on the product page" });
  return out;
}

function FixButton({ fix, keyValue, label, testId }: { fix: "hide" | "never"; keyValue: string; label: string; testId: string }) {
  return (
    <form action={fixBadProductsAction}>
      <input type="hidden" name="fix" value={fix} />
      <input type="hidden" name="key" value={keyValue} />
      <button
        type="submit"
        data-testid={testId}
        className="rounded border border-white/20 px-2 py-0.5 text-[11px] text-white/70 hover:bg-white/10"
      >
        {label}
      </button>
    </form>
  );
}

function Row({ row, kind }: { row: QueueRow; kind: QueueKind }) {
  const links = linkFixes(row, kind);
  return (
    <li className="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/70" data-testid={`bpq-row-${kind}`}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <Link href={productHref(row.key)} className="font-semibold text-white/90 underline decoration-white/20 hover:decoration-white/60">
          {row.name || row.key}
        </Link>
        {row.brand ? <span className="text-white/40">{row.brand}</span> : null}
        <span>price {Number.isFinite(row.priceMinor) ? formatMoneyMinor(row.priceMinor) : "none"}</span>
        <span>cost {row.costMinor != null ? formatMoneyMinor(row.costMinor) : "none on file"}</span>
        {row.floorMinor > 0 ? <span>floor {formatMoneyMinor(row.floorMinor)}</span> : null}
        {row.stockLots > 0 ? <span>{row.stockLots} lot{row.stockLots === 1 ? "" : "s"} in stock</span> : null}
        {row.kinds.length > 1 ? (
          <span className="text-white/40">also: {row.kinds.filter((k) => k !== kind).map((k) => KIND_TITLE[k].toLowerCase()).join(", ")}</span>
        ) : null}
      </div>
      {(kind === "no_price" || kind === "below_floor") && row.variantCount > 1 ? (
        <p className="mt-1 text-[11px] text-white/50" data-testid="bpq-several-sizes">
          This card has {row.variantCount} sizes, so the lot page cannot tell which size to reprice (it refuses rather than guess). Correct the size price in
          Cultivera and re-import, or hide it until then.
        </p>
      ) : null}
      {kind === "missing_coa" ? (
        <p className="mt-1 text-[11px] text-white/50">
          {row.coaMissingLots} stocked lot{row.coaMissingLots === 1 ? "" : "s"} with no lab result linked.
        </p>
      ) : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {rowAllowsFix(row, "hide") && (kind === "no_price" || kind === "below_floor" || kind === "no_cost" || kind === "missing_coa") ? (
          <FixButton fix="hide" keyValue={row.key} label="Hide from menu" testId="bpq-hide" />
        ) : null}
        {rowAllowsFix(row, "never") && (kind === "below_floor" || kind === "no_cost") ? (
          <FixButton fix="never" keyValue={row.key} label="Never discount" testId="bpq-never" />
        ) : null}
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="text-[11px] text-[var(--admin-accent)] underline" data-testid="bpq-link">
            {l.label}
          </Link>
        ))}
      </div>
    </li>
  );
}

export default async function BadProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ fix?: string; fixTone?: string }>;
}) {
  await requirePermission("promotions.manage");
  const sp = await searchParams;
  const load = await loadBadProductQueue();
  const q = load.queue;
  const total = q.rows.length;

  return (
    <div>
      <AdminPageHeader
        title="Bad product queue"
        subtitle="Every published product with a problem that would trip a promotion or a sale, each with its fix."
      />
      <div className="space-y-5 px-5 py-6 sm:px-8">
        <Breadcrumbs items={[{ label: "Promotions", href: "/admin/promotions" }, { label: "Bad product queue" }]} />

        <HelpPanel id="bad-products-help" title="How the bad product queue works">
          <p>
            The list is built fresh from the live menu, your lot costs, the never-discount list and your inventory every time this page opens. A product
            leaves the list the moment its problem is fixed. Nothing here changes prices on its own.
          </p>
          <p className="mt-2">
            <strong>Hide from menu</strong> takes it off the website and register until you fix it (undo: product page, Visibility, Inherit POS).{" "}
            <strong>Never discount</strong> keeps selling it at full price but no deal can touch it (undo: Never-discount list). The other links open the
            exact place that fixes it. Every press re-checks the list first, and changes nothing if the product is no longer in it.
          </p>
        </HelpPanel>

        {sp.fix ? (
          <p
            className={`rounded-lg border px-4 py-2 text-sm ${sp.fixTone === "error" ? "border-red-400/30 bg-red-400/10 text-red-100" : "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"}`}
            data-testid="bpq-banner"
          >
            {sp.fix}
          </p>
        ) : null}

        {!load.complete ? (
          <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-sm text-amber-100" data-testid="bpq-incomplete">
            Part of the data could not be read, so this list may be missing products and the fix buttons will refuse until it reads in full:{" "}
            {load.problems.join("; ")}
          </p>
        ) : null}

        {!load.hasMenu ? (
          <p className="text-sm text-white/60">There is no published menu yet, so there is nothing to check.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="bpq-counts">
              {QUEUE_KINDS.map((k) => (
                <a key={k} href={`#bpq-${k}`} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 hover:bg-white/10">
                  <p className="text-[10px] uppercase tracking-wide text-white/50">{KIND_TITLE[k]}</p>
                  <p className="text-lg font-bold text-white/90" data-testid={`bpq-count-${k}`}>
                    {q.counts[k]}
                  </p>
                </a>
              ))}
            </div>
            <p className="text-xs text-white/40">
              {q.scanned} published product{q.scanned === 1 ? "" : "s"} checked; {total} need{total === 1 ? "s" : ""} attention.
            </p>
            {total === 0 && load.complete ? (
              <p className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-100" data-testid="bpq-clean">
                Nothing in the queue: every published product has a price above its floor, a cost, a category and a COA for its stock.
              </p>
            ) : null}

            {QUEUE_KINDS.map((kind) => {
              const rows = rowsOfKind(q, kind);
              if (rows.length === 0) return null;
              const hideable = rows.filter((r) => rowAllowsFix(r, "hide")).length;
              const neverable = rows.filter((r) => rowAllowsFix(r, "never")).length;
              const bulkHide = (kind === "no_price" || kind === "below_floor" || kind === "no_cost" || kind === "missing_coa") && hideable > 0;
              const bulkNever = (kind === "below_floor" || kind === "no_cost") && neverable > 0;
              return (
                <section key={kind} id={`bpq-${kind}`} className="scroll-mt-24 rounded-xl border border-white/10 bg-[#0a0a0a] p-4" data-testid={`bpq-section-${kind}`}>
                  <h2 className="text-sm font-semibold text-white/90">
                    {KIND_TITLE[kind]} <span className="text-white/40">({rows.length})</span>
                  </h2>
                  <p className="mt-1 text-xs text-white/50">{KIND_MEANING[kind]}</p>
                  {bulkHide || bulkNever ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {bulkHide ? (
                        <form action={fixBadProductsAction}>
                          <input type="hidden" name="fix" value="hide" />
                          <input type="hidden" name="all" value={kind} />
                          <Button type="submit" variant="danger" size="sm" data-testid={`bpq-hide-all-${kind}`}>
                            Hide {Math.min(hideable, MAX_QUEUE_FIX_PER_PRESS) === 1 ? "this product" : `all ${Math.min(hideable, MAX_QUEUE_FIX_PER_PRESS)}`} from the menu
                          </Button>
                        </form>
                      ) : null}
                      {bulkNever ? (
                        <form action={fixBadProductsAction}>
                          <input type="hidden" name="fix" value="never" />
                          <input type="hidden" name="all" value={kind} />
                          <Button type="submit" variant="neutral" size="sm" data-testid={`bpq-never-all-${kind}`}>
                            Never discount {Math.min(neverable, MAX_QUEUE_FIX_PER_PRESS) === 1 ? "this product" : `all ${Math.min(neverable, MAX_QUEUE_FIX_PER_PRESS)}`}
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  ) : null}
                  <ul className="mt-3 space-y-1.5">
                    {rows.slice(0, SHOW_PER_SECTION).map((r) => (
                      <Row key={`${kind}-${r.key}`} row={r} kind={kind} />
                    ))}
                  </ul>
                  {rows.length > SHOW_PER_SECTION ? (
                    <p className="mt-2 text-xs text-white/40">
                      Showing the first {SHOW_PER_SECTION} of {rows.length}. Fix these (or use the button above, up to {MAX_QUEUE_FIX_PER_PRESS} per press) and the
                      rest move up.
                    </p>
                  ) : null}
                </section>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
