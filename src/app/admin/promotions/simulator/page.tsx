import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Badge, Button, Card } from "@/components/admin/ui";
import { getPublishedVersion, getVersionItems } from "@/lib/pos/menu-version";
import { loadActiveRules } from "@/lib/promotions/discount-engine";
import { SimulatorClient, type MenuPick } from "./simulator-client";

export const dynamic = "force-dynamic";

export default async function PromotionSimulatorPage() {
  await requirePermission("promotions.manage");

  const rules = await loadActiveRules();

  const version = await getPublishedVersion();
  let menu: MenuPick[] = [];
  if (version) {
    const items = await getVersionItems(version.id);
    menu = items
      .filter((i) => !i.hidden)
      .map((i) => ({
        key: i.source_item_id,
        name: i.name,
        brand: i.brand_name ?? "",
        category: i.category,
        categories: (i.filter_categories?.length ? i.filter_categories : [i.category]).map((c) => String(c).toLowerCase()),
        priceMinorUnits: i.price_minor_units,
        variantLabel: i.variants?.[0]?.label ?? null,
      }));
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
          <Link href="/admin/promotions">
            <Button variant="subtle" size="sm">Back to promotions</Button>
          </Link>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <HelpPanel
          id="promo-simulator-help"
          title="What this does"
          steps={[
            "Build a sample basket from your published menu on the left.",
            "The right side shows the authoritative per-item discount the POS engine applies using the promotions that are active right now — the same engine the cart uses.",
            "Use it to validate a new promotion (percent, fixed, BOGO, quantity/weight/spend tiers, or basket deals) before relying on it at the register.",
            "By default each item keeps the single best deal (best-deal-wins). Promotions marked stackable combine.",
          ]}
        />

        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-stone-800">Active promotions right now:</span>
            {rules.length === 0 ? (
              <span className="text-sm text-stone-500">None active. Publish a promotion to see it here.</span>
            ) : (
              rules.map((r) => (
                <Badge key={r.id} tone={r.stackable ? "gold" : "green"}>
                  {r.title}
                  {r.stackable ? " · stacks" : ""}
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
