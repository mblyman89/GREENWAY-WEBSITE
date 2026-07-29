import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { SopSheetLink } from "@/components/admin/SopSheetLink";
import { BackLink, Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Button, Input, Select } from "@/components/admin/ui";
import { CatalogStageStrip } from "@/components/admin/catalog/CatalogStageStrip";
import { listCatalogDrafts, countCatalogDrafts } from "@/lib/inventory/catalog-drafts";
import { approveDraftAction, dismissDraftAction, restoreDraftAction } from "./actions";
import { draftsWhatDoIDoHere } from "@/lib/catalog/next-action-core";
import { WhatDoIDoHere } from "@/components/admin/catalog/WhatDoIDoHere";
import { resolveWebsiteCategories } from "@/lib/inventory/website-category-resolver-server";
import {
  assessDraftClassification,
  websiteCategoryLabel,
  categoryPickerPlaceholder,
  typePickerPlaceholder,
  type DraftClassificationAssessment,
} from "@/lib/inventory/draft-approval-gate-core";
// SLICE 78: the category picker lists the DB-backed registry (owner's
// categories from /admin/settings/types), not the hardcoded taxonomy — the
// registry falls back to the hardcoded list on an empty/unconfigured DB.
import { loadCategoryLabelMap } from "@/lib/pos/category-registry";
import { groupCatalogByCategory } from "@/lib/pos/inventory-type-catalog";
import { intakeDisplayName } from "@/lib/pos/intake-mastering-core";

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
  searchParams: Promise<{ status?: string; approved?: string; dismissed?: string; restored?: string; error?: string; msg?: string; back?: string }>;
}) {
  await requirePermission("inventory.manage");
  const { status, approved, dismissed, restored, error, msg, back } = await searchParams;
  const view = status === "approved" || status === "dismissed" ? status : "draft";

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Product Onboarding" subtitle="Review and approve new products onto the menu." />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn&apos;t fully set up yet. Apply migration 0026 to enable product drafts.
          </div>
        </div>
      </div>
    );
  }

  const [drafts, counts, categoryLabelMap] = await Promise.all([
    listCatalogDrafts(view),
    countCatalogDrafts(),
    loadCategoryLabelMap(),
  ]);
  // SLICE 78: [value, label] pairs for the "Pick a category" select — the
  // owner's live registry, sorted by the same order the settings page uses.
  const categoryChoices = Object.entries(categoryLabelMap);

  // SLICE 64 (owner bug B3): resolve OUR website category + run the SLICE 63
  // type labeler for every row, so the table shows OUR labels (never the raw
  // CCRS blob) and the approval card KNOWS what the human must pick. One
  // batched resolver call; the raw LCB values stay visible in fine print so
  // the approver can decide with full information.
  const resolutions = await resolveWebsiteCategories(
    drafts.map((d) => ({
      posProductKey: d.pos_product_key,
      productName: d.name,
      inventoryType: d.inventory_type,
      category: d.category,
    })),
  );
  const assessments = new Map<string, DraftClassificationAssessment>();
  drafts.forEach((d, i) => {
    assessments.set(
      d.id,
      assessDraftClassification({
        productName: d.name,
        inventoryType: d.inventory_type,
        resolvedWebsiteCategory: resolutions[i]?.websiteCategory ?? null,
      }),
    );
  });

  const typeGroups = groupCatalogByCategory();

  const banner =
    approved ? "Approved — it's live on the website and sellable at the register now. Add photos & a description in Product Enrichment whenever you're ready."
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
        title="Product Onboarding"
        subtitle="When a received lot isn't on the live menu, we draft the product from the transfer + COA so you can validate it before it goes live. Nothing here is customer-facing until you approve it."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Product Intake", href: "/admin/catalog" },
              { label: "Product Onboarding" },
            ]}
          />
        }
        help={
          <HelpPanel
            id="catalog-drafts"
            title="How product onboarding works"
            steps={[
              "On accepting a manifest, we match each lot to the published menu by its POS key.",
              "Lots that don't match get a DRAFT product, pre-filled from the JSON + COA potency.",
              "Review the details, then Approve (validated) or Dismiss (not a new product).",
              "If we couldn't classify a product at 90% confidence or better, the approve form asks you to pick its category or type from our own list — no product is ever guessed onto the menu.",
              "Approved drafts are added automatically to the next menu import you stage — the import review screen lists each one, and they go live when you publish that version.",
            ]}
          >
            <p>
              This keeps the live menu clean: machine-suggested products always wait for a human to
              confirm them before customers ever see them.
            </p>
            <SopSheetLink slug="onboard" />
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <div>
          <BackLink
            fallback="/admin/catalog"
            back={back}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
          >
            ← Back to Product Intake Hub
          </BackLink>
        </div>
        <CatalogStageStrip current="onboarding" />

        {/* W4: one plain-English next action for the tab you're on. */}
        <WhatDoIDoHere action={draftsWhatDoIDoHere(view, counts)} />

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
                  ? "bg-[var(--admin-accent)] text-black"
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
                  <th className="px-4 py-3">Category &amp; Type</th>
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
                  // SLICE 64: OUR classification verdict for this row. The
                  // approver's own picks (approved rows) outrank the machine.
                  const a = assessments.get(d.id);
                  const displayCategory =
                    d.chosen_website_category ?? a?.resolvedWebsiteCategory ?? null;
                  const autoType =
                    a && a.house.houseType && !a.needsTypePick ? a.house.houseType : null;
                  const displayType = d.chosen_house_type ?? autoType;
                  const needsCategoryPick = view === "draft" && Boolean(a?.needsCategoryPick);
                  const needsTypePick = view === "draft" && Boolean(a?.needsTypePick);
                  // SLICE 65 (A1/A3/A4): the name shown here is the BUILT
                  // customer name — the same family derivation the menu card
                  // will use (size/pack noise stripped, mg dose kept for
                  // dose-led items). NULL means "not confident": the raw
                  // manifest name stays on screen, never a guess. The raw
                  // string drops to fine print when a built name exists.
                  const builtName = displayCategory
                    ? intakeDisplayName({
                        name: d.name || "",
                        product_name: d.name || null,
                        brand_name: d.brand_name ?? "",
                        vendor_name: d.vendor_name,
                        category: displayCategory,
                        strain_name: d.strain_name,
                      })
                    : null;
                  return (
                    <tr key={d.id} className="bg-[var(--admin-surface)] align-top">
                      <td className="px-4 py-3">
                        <div className="font-medium text-[var(--admin-text)]">{builtName ?? (d.name || "(unnamed)")}</div>
                        <div className="text-xs text-[var(--admin-text-faint)]">
                          {[d.brand_name, d.vendor_name, d.strain_name].filter(Boolean).join(" · ") || "—"}
                        </div>
                        {builtName && builtName !== d.name ? (
                          <div className="text-[10px] text-[var(--admin-text-faint)]">Manifest: {d.name}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-[var(--admin-text-muted)]">
                        {/* OUR labels on screen — never the raw CCRS blob. */}
                        <div>
                          {displayCategory ? (
                            websiteCategoryLabel(displayCategory)
                          ) : (
                            <span className="font-semibold text-[var(--admin-gold)]">Needs category</span>
                          )}
                        </div>
                        <div className="text-xs">
                          {displayType ? (
                            <span>
                              {displayType}
                              {d.chosen_house_type ? (
                                <span className="text-[var(--admin-text-faint)]"> · your pick</span>
                              ) : a ? (
                                <span className="text-[var(--admin-text-faint)]"> · {a.house.confidence}% confident</span>
                              ) : null}
                            </span>
                          ) : view === "draft" ? (
                            <span className="font-semibold text-[var(--admin-gold)]">Needs type</span>
                          ) : (
                            <span className="text-[var(--admin-text-faint)]">—</span>
                          )}
                        </div>
                        {/* CCRS under the hood — fine print so the approver can decide. */}
                        <div className="mt-0.5 text-[10px] text-[var(--admin-text-faint)]">
                          LCB: {[d.inventory_type, d.category].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </td>
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
                              <form action={approve} className="flex flex-col items-end gap-2">
                                {/* SLICE 64: required picks when we couldn't
                                    classify at >=90% confidence. The server
                                    re-checks — this is UX, not the gate.
                                    SLICE 91 (owner): BOTH pickers are now on
                                    EVERY draft row — "I want to be able to
                                    edit each one just in case." When the
                                    machine already classified the product the
                                    empty option reads "Keep auto: X" and
                                    submits NO override; only an actual
                                    selection records a human pick. */}
                                <Select
                                  name="website_category"
                                  required={needsCategoryPick}
                                  defaultValue=""
                                  className="w-48 text-xs"
                                  aria-label="Website category"
                                >
                                  <option value="" disabled={needsCategoryPick}>
                                    {categoryPickerPlaceholder({
                                      needsCategoryPick,
                                      resolvedLabel: displayCategory
                                        ? websiteCategoryLabel(displayCategory)
                                        : null,
                                    })}
                                  </option>
                                  {categoryChoices.map(([value, label]) => (
                                    <option key={value} value={value}>
                                      {label}
                                    </option>
                                  ))}
                                  {/* SLICE 78: create a category without leaving
                                      onboarding — name it in the box below. */}
                                  <option value="__new__">➕ Create a new category…</option>
                                </Select>
                                <Input
                                  name="new_category_label"
                                  placeholder="New category name (only if creating one)"
                                  className="w-48 text-xs"
                                  aria-label="New category name"
                                />
                                <Select
                                  name="house_type"
                                  required={needsTypePick}
                                  defaultValue={needsTypePick ? a?.suggestedHouseType ?? "" : ""}
                                  className="w-48 text-xs"
                                  aria-label="Product type"
                                >
                                  <option value="" disabled={needsTypePick}>
                                    {typePickerPlaceholder({
                                      needsTypePick,
                                      autoType,
                                      confidence: a?.house.confidence ?? 0,
                                    })}
                                  </option>
                                  {typeGroups.map((g) => (
                                    <optgroup key={g.category} label={g.categoryLabel}>
                                      {g.types.map((t) => (
                                        <option key={t.label} value={t.label}>
                                          {t.label}
                                        </option>
                                      ))}
                                    </optgroup>
                                  ))}
                                </Select>
                                <div className="flex items-center gap-2">
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
                                </div>
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
                              {view === "approved" && (
                                <Button
                                  href={`/admin/products?q=${encodeURIComponent(d.name || "")}`}
                                  variant="save"
                                  size="sm"
                                >
                                  ✨ Enrich now →
                                </Button>
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
