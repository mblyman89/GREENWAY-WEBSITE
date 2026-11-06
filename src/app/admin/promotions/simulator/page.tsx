import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Badge, Button, Card } from "@/components/admin/ui";
import { getPublishedVersion, getVersionItems } from "@/lib/pos/menu-version";
import { loadActiveRules, loadProductCosts } from "@/lib/promotions/discount-engine";
import { SimulatorClient, type MenuPick } from "./simulator-client";
import { backHref } from "@/lib/admin/back-link-core";
import { expandCardSizes, guardRowId } from "@/lib/promotions/size-guard-core";

export const dynamic = "force-dynamic";

export default async function PromotionSimulatorPage({
  searchParams,
}: {
  searchParams: Promise<{ back?: string }>;
}) {
  const { back } = await searchParams;
  await requirePermission("promotions.manage");

  const rules = await loadActiveRules();

  const version = await getPublishedVersion();
  let menu: MenuPick[] = [];
  if (version) {
    const [items, costs] = await Promise.all([getVersionItems(version.id), loadProductCosts()]);
    // D195: one pick per SIZE, priced at that size and floored at that size's
    // cost by the register's own rule (expandCardSizes / costForSize).
    menu = items
      .filter((i) => !i.hidden)
      .flatMap((i) => {
        const categories = (i.filter_categories?.length ? i.filter_categories : [i.category]).map((c) => String(c).toLowerCase());
        return expandCardSizes(
          {
            key: i.source_item_id,
            name: i.name,
            brand: i.brand_name ?? "",
            categories,
            priceMinorUnits: i.price_minor_units,
            sizes: (Array.isArray(i.variants) ? i.variants : []).map((v) => ({
              sourceVariantId: v.source_variant_id,
              label: v.label,
              priceMinorUnits: v.price_minor_units,
              sortOrder: v.sort_order,
            })),
          },
          costs,
        ).map((r) => ({
          key: r.key,
          pickId: guardRowId(r),
          name: r.name,
          brand: r.brand,
          category: i.category,
          categories,
          priceMinorUnits: r.priceMinorUnits,
          variantLabel: r.sizeLabel ?? i.variants?.[0]?.label ?? null,
          costMinorUnits: r.costMinorUnits,
        }));
      });
  }

  return (
    <div>
      <AdminPageHeader
        title="Discount simulator"
        subtitle="Test active promotions against a sample basket — exactly what the register would charge"
        breadcrumbs={
          <Breadcrumbs
            items={[{ label: "Promotions", href: "/admin/promotions" }, { label: "Simulator" }]}
          />
        }
        action={
          <Button href={backHref("/admin/promotions", back)} variant="neutral" size="sm">
            Back to promotions
          </Button>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <HelpPanel
          id="promo-simulator-help"
          title="What this does"
          steps={[
            "Build a sample basket from your published menu on the left.",
            "The right side shows the authoritative per-item discount the POS engine applies using the promotions that are active right now — the same engine the cart uses.",
            "Use it to validate a new promotion (percent, fixed, BOGO, quantity/weight/spend tiers, basket deals, or either/or bundles) before relying on it at the register.",
            "Each item keeps the single best deal (best-deal-wins). Promotions NEVER stack.",
            "A shield marker on a line means the CCRS cost floor limited the discount — the price can never fall below the product's cost of acquisition.",
          ]}
        />

        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-stone-800">Active promotions right now:</span>
            {rules.length === 0 ? (
              <span className="text-sm text-stone-500">None active. Publish a promotion to see it here.</span>
            ) : (
              rules.map((r) => (
                <Badge key={r.id} tone="green">
                  {r.title}
                </Badge>
              ))
            )}
          </div>
        </Card>

        <SimulatorClient menu={menu} rules={rules} />
      </div>
    </div>
  );
}
