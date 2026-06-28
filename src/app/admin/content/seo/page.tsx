import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { listSeoEntries } from "@/lib/cms/content-store";
import { saveSeoEntryAction } from "../actions";

export const dynamic = "force-dynamic";

/** Common public routes staff can manage SEO for. */
const KNOWN_PATHS = ["/", "/menu", "/specials", "/about", "/locations", "/loyalty", "/blog", "/faq", "/vendor-delivery"];

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
        subtitle="Per-page title, description, canonical, noindex, and sitemap inclusion with a Google-style preview."
        action={
          <Link href="/admin/content" className="text-sm text-white/60 hover:text-white">
            ← Site content
          </Link>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {saved && (
          <div className="rounded-lg border border-[#7ed957]/40 bg-[#7ed957]/10 px-4 py-2 text-sm text-[#7ed957]">SEO saved.</div>
        )}
        {error === "path" && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-400">Path must start with “/”.</div>
        )}

        {KNOWN_PATHS.map((path) => {
          const e = byPath.get(path);
          const title = e?.seo_title ?? "";
          const desc = e?.seo_description ?? "";
          const titleLen = title.length;
          const descLen = desc.length;
          return (
            <form key={path} action={saveSeoEntryAction} className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
              <input type="hidden" name="path" value={path} />
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm text-white">{path}</span>
                {e && (
                  <span className="text-xs text-white/40">
                    sitemap: {e.sitemap_include ? "included" : "excluded"}
                    {e.noindex ? " · noindex" : ""}
                  </span>
                )}
              </div>

              <div className="mt-3 space-y-3">
                <div>
                  <label className="mb-1 flex items-center justify-between text-xs font-semibold text-white/50">
                    <span>SEO title</span>
                    <span className={titleLen > 60 ? "text-red-400" : titleLen >= 50 ? "text-[#7ed957]" : "text-white/35"}>
                      {titleLen}/60
                    </span>
                  </label>
                  <input
                    name="seo_title"
                    defaultValue={title}
                    className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
                  />
                </div>
                <div>
                  <label className="mb-1 flex items-center justify-between text-xs font-semibold text-white/50">
                    <span>SEO description</span>
                    <span className={descLen > 160 ? "text-red-400" : descLen >= 140 ? "text-[#7ed957]" : "text-white/35"}>
                      {descLen}/160
                    </span>
                  </label>
                  <textarea
                    name="seo_description"
                    rows={2}
                    defaultValue={desc}
                    className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-white/50">Canonical (optional)</label>
                    <input
                      name="canonical"
                      defaultValue={e?.canonical ?? ""}
                      className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
                    />
                  </div>
                  <label className="flex items-center gap-2 self-end pb-2 text-sm text-white/70">
                    <input type="checkbox" name="noindex" defaultChecked={e?.noindex ?? false} className="h-4 w-4" />
                    Noindex
                  </label>
                  <label className="flex items-center gap-2 self-end pb-2 text-sm text-white/70">
                    <input type="checkbox" name="sitemap_include" defaultChecked={e?.sitemap_include ?? true} className="h-4 w-4" />
                    In sitemap
                  </label>
                </div>

                {/* Google-style preview */}
                <div className="rounded-lg border border-white/10 bg-black p-3">
                  <div className="text-xs text-white/40">Search preview</div>
                  <div className="mt-1 text-sm text-[#8ab4f8]">{title || `Greenway Marijuana · ${path}`}</div>
                  <div className="text-xs text-[#7ed957]/80">greenwaymarijuana.com{path === "/" ? "" : path}</div>
                  <div className="mt-0.5 text-xs text-white/55">{desc || "Add a description to control this snippet."}</div>
                </div>

                <button type="submit" className="rounded-lg bg-[#7ed957] px-4 py-2 text-sm font-bold text-black hover:bg-[#6bc746]">
                  Save SEO for {path}
                </button>
              </div>
            </form>
          );
        })}
      </div>
    </div>
  );
}
