import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Button, Input } from "@/components/admin/ui";
import { listCatalogDrafts, countCatalogDrafts } from "@/lib/inventory/catalog-drafts";
import { approveDraftAction, dismissDraftAction, restoreDraftAction } from "./actions";

export const dynamic = "force-dynamic";

function fmtPct(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return `${n}%`;
}

function fmtMoney(minor: number | null | undefined): string {
  if (minor == null) return "—";
  return `$${(minor / 100).toFixed(2)}`;
}

export default async function CatalogDraftsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; approved?: string; dismissed?: string; restored?: string; error?: string; msg?: string }>;
}) {
  await requirePermission("inventory.manage");
  const { status, approved, dismissed, restored, error, msg } = await searchParams;
  const view = status === "approved" || status === "dismissed" ? status : "draft";

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Product drafts" subtitle="Draft products suggested from intake." />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn&apos;t fully set up yet. Apply migration 0026 to enable product drafts.
          </div>
        </div>
      </div>
    );
  }

  const [drafts, counts] = await Promise.all([listCatalogDrafts(view), countCatalogDrafts()]);

  const banner =
    approved ? "Draft approved with its price — validated and ready for the next menu publish."
      : dismissed ? "Draft dismissed."
        : restored ? "Draft restored to the review queue."
          : error === "floor" ? (msg || "Price is below the cost floor.")
            : error === "price" ? "Enter a valid price before approving."
              : error ? "Something went wrong updating that draft."
                : null;
  const bannerTone = error ? "danger" : "accent";

  return (
    <div>
      <AdminPageHeader
        title="Product drafts"
        subtitle="When a received lot isn't on the live menu, we draft the product from the transfer + COA so you can validate it before it goes live. Nothing here is customer-facing until you approve it."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Inventory", href: "/admin/inventory" },
              { label: "Product drafts" },
            ]}
          />
        }
        help={
          <HelpPanel
            id="catalog-drafts"
            title="How product drafts work"
            steps={[
              "On accepting a manifest, we match each lot to the published menu by its POS key.",
              "Lots that don't match get a DRAFT product, pre-filled from the JSON + COA potency.",
              "Review the details, then Approve (validated) or Dismiss (not a new product).",
              "Approved drafts are staged for you to include in the next menu publish.",
            ]}
          >
            <p>
              This keeps the live menu clean: machine-suggested products always wait for a human to
              confirm them before customers ever see them.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Needs review" value={counts.draft} accent={counts.draft > 0 ? "gold" : "muted"} href="/admin/inventory/drafts?status=draft" />
          <StatCard label="Approved" value={counts.approved} accent="green" href="/admin/inventory/drafts?status=approved" />
          <StatCard label="Dismissed" value={counts.dismissed} accent="muted" href="/admin/inventory/drafts?status=dismissed" />
        </div>

        {banner && (
          <div
            className={
              bannerTone === "danger"
                ? "rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]"
                : "rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]"
            }
          >
            {banner}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 text-sm">
          {(["draft", "approved", "dismissed"] as const).map((s) => (
            <Link
              key={s}
              href={`/admin/inventory/drafts?status=${s}`}
              className={`rounded-full px-3 py-1 font-medium capitalize ${
                view === s
                  ? "bg-[var(--admin-accent)] text-white"
                  : "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
              }`}
            >
              {s === "draft" ? "Needs review" : s}
            </Link>
          ))}
        </div>

        {drafts.length === 0 ? (
          <EmptyState
            icon="📝"
            title={view === "draft" ? "No drafts to review" : `No ${view} drafts`}
            description={
              view === "draft"
                ? "When you accept a manifest with products that aren't on the live menu, they'll show up here."
                : "Nothing here yet."
            }
          />
        ) : (
          <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                <tr>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3 text-right">THC</th>
                  <th className="px-4 py-3 text-right">Cost</th>
                  <th className="px-4 py-3 text-right">Pricing</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--admin-border)]">
                {drafts.map((d) => {
                  const approve = approveDraftAction.bind(null, d.id);
                  const dismiss = dismissDraftAction.bind(null, d.id);
                  const restore = restoreDraftAction.bind(null, d.id);
                  const defaultPrice =
                    (d.price_minor_units ?? d.suggested_price_minor_units ?? d.price_floor_minor_units ?? 0) / 100;
                  const floorDollars = d.price_floor_minor_units != null ? d.price_floor_minor_units / 100 : undefined;
                  return (
                    <tr key={d.id} className="bg-[var(--admin-surface)] align-top">
                      <td className="px-4 py-3">
                        <div className="font-medium text-[var(--admin-text)]">{d.name || "(unnamed)"}</div>
                        <div className="text-xs text-[var(--admin-text-faint)]">
                          {[d.brand_name, d.vendor_name, d.strain_name].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[var(--admin-text-muted)]">{d.category ?? "—"}</td>
                      <td className="px-4 py-3 text-right text-[var(--admin-text-muted)]">
                        {fmtPct(d.total_thc_pct ?? d.thc_pct)}
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--admin-text-muted)]">
                        {fmtMoney(d.unit_cost_minor_units)}
                      </td>
                      <td className="px-4 py-3 text-right text-xs">
                        <div className="text-[var(--admin-text-muted)]">
                          Floor <span className="font-semibold text-[var(--admin-text)]">{fmtMoney(d.price_floor_minor_units)}</span>
                        </div>
                        <div className="text-[var(--admin-accent)]">
                          AI suggests {fmtMoney(d.suggested_price_minor_units)}
                        </div>
                        {d.price_rationale && (
                          <div className="mt-0.5 max-w-[16rem] text-[10px] leading-tight text-[var(--admin-text-faint)]">
                            {d.price_rationale}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-end gap-2">
                          {view === "draft" && (
                            <>
                              <form action={approve} className="flex items-center gap-2">
                                <div className="flex items-center gap-1">
                                  <span className="text-[var(--admin-text-faint)]">$</span>
                                  <Input
                                    name="price"
                                    type="number"
                                    step="0.01"
                                    min={floorDollars}
                                    defaultValue={defaultPrice ? defaultPrice.toFixed(2) : ""}
                                    className="w-24"
                                  />
                                </div>
                                <Button type="submit" variant="save" size="sm">✓ Approve</Button>
                              </form>
                              <form action={dismiss}>
                                <Button type="submit" variant="neutral" size="sm">Dismiss</Button>
                              </form>
                            </>
                          )}
                          {view !== "draft" && (
                            <>
                              {d.price_minor_units != null && (
                                <span className="text-sm font-semibold text-[var(--admin-text)]">
                                  {fmtMoney(d.price_minor_units)}
                                </span>
                              )}
                              <form action={restore}>
                                <Button type="submit" variant="neutral" size="sm">↩ Restore</Button>
                              </form>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
