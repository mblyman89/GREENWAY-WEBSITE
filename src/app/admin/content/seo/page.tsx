import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { listSeoEntries } from "@/lib/cms/content-store";
import { isAiConfigured } from "@/lib/cms/ai-seo";
import { SeoEntryEditor } from "@/components/admin/SeoEntryEditor";
import { saveSeoEntryAction } from "../actions";

export const dynamic = "force-dynamic";

/** Common public routes staff can manage SEO for. */
const KNOWN_PATHS = [
  "/",
  "/menu",
  "/specials",
  "/about",
  "/locations",
  "/loyalty",
  "/blog",
  "/faq",
  "/vendor-delivery",
];

export default async function SeoEditorPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requirePermission("content.edit");
  const { saved, error } = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="SEO Editor" />
        <div className="px-5 py-6 sm:px-8 text-sm text-[#ffd700]">Supabase is not configured yet.</div>
      </div>
    );
  }

  const entries = await listSeoEntries();
  const byPath = new Map(entries.map((e) => [e.path ?? "", e]));

  return (
    <div>
      <AdminPageHeader
        title="SEO Editor"
        subtitle="Per-page title, description, canonical, noindex, and sitemap inclusion with a live Google-style preview — now with one-click AI drafting."
        action={
          <Link href="/admin/content" className="text-sm text-white/60 hover:text-white">
            ← Site content
          </Link>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {saved && (
          <div className="rounded-lg border border-[#7ed957]/40 bg-[#7ed957]/10 px-4 py-2 text-sm text-[#7ed957]">
            SEO saved.
          </div>
        )}
        {error === "path" && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-400">
            Path must start with “/”.
          </div>
        )}

        {!isAiConfigured && (
          <div className="rounded-lg border border-[#ffd700]/30 bg-[#ffd700]/[0.06] px-4 py-2 text-xs text-[#ffd700]">
            AI drafting is available on every page below once an <code className="font-mono">AI_API_KEY</code> is set.
            Until then you can still edit titles and descriptions by hand.
          </div>
        )}

        {KNOWN_PATHS.map((path) => {
          const e = byPath.get(path);
          return (
            <SeoEntryEditor
              key={path}
              aiEnabled={isAiConfigured}
              saveAction={saveSeoEntryAction}
              entry={{
                path,
                seo_title: e?.seo_title ?? "",
                seo_description: e?.seo_description ?? "",
                canonical: e?.canonical ?? "",
                noindex: e?.noindex ?? false,
                sitemap_include: e?.sitemap_include ?? true,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
