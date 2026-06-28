import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { PromotionForm } from "@/components/admin/promotions/PromotionForm";
import { listMenuBrands } from "@/lib/promotions/promotions-store";
import { createPromotionAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewPromotionPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requirePermission("promotions.manage");
  const { error } = await searchParams;
  const brands = isSupabaseServiceConfigured ? await listMenuBrands() : [];

  return (
    <div>
      <AdminPageHeader
        title="New promotion"
        subtitle="Create a deal. It saves as a draft — preview affected products, then publish."
      />
      <div className="px-5 py-6 sm:px-8">
        {error && (
          <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
        <PromotionForm action={createPromotionAction} brands={brands} submitLabel="Create draft" />
      </div>
    </div>
  );
}
