import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { HelpPanel } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui";
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
  "/price-match",
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
        <div className="px-5 py-6 sm:px-8 text-sm text-[var(--admin-gold)]">The database isn&apos;t fully set up yet. Once your administrator finishes the one-time setup, the SEO editor will be ready to use.</div>
      </div>
    );
  }

  const entries = await listSeoEntries();
  const byPath = new Map(entries.map((e) => [e.path ?? "", e]));

  return (
    <div>
      <AdminPageHeader
        title="SEO Editor"
        subtitle="Control how each page looks on Google and when shared on social media — title, description, and more — with a live Google-style preview."
        action={
          <Button href="/admin/content" variant="subtle">← Site content</Button>
        }
        help={
          <HelpPanel
            id="seo-editor"
            title="How to write great SEO (in plain English)"
            steps={[
              "Pick a page below. Each page gets its own Title and Description.",
              "Title (~50–60 chars): what the page is + “Greenway Marijuana” + “Port Orchard, WA”. Keep each page’s title unique.",
              "Description (~150–160 chars): a friendly, honest summary with a reason to click (daily deals, fast in-store pickup).",
              "Watch the live Google-style preview update as you type — that’s roughly what customers will see.",
              "If AI drafting is on, click it for a starting point, then edit so it sounds like you. Always review before saving.",
              "Save. Changes apply to the public page right away.",
            ]}
          >
            <p className="mb-2">
              <strong>What each field does:</strong> <em>Title</em> = the big blue link in Google results.
              <em> Description</em> = the grey text under it. <em>Canonical</em> = (advanced) the “official”
              URL when similar pages exist — usually leave blank. <em>No-index</em> = hide a page from
              Google (rarely needed). <em>Sitemap</em> = include the page in the list we hand to Google
              (keep on for real pages).
            </p>
            <p>
              <strong>Cannabis compliance (WA I-502):</strong> keep wording factual and age-appropriate,
              never make health/medical claims, and never word things in a way that would appeal to minors.
              Describe the experience and the deal, not medical benefits.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {saved && (
          <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            SEO saved.
          </div>
        )}
        {error === "path" && (
          <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-4 py-2 text-sm text-[var(--admin-danger)]">
            Path must start with “/”.
          </div>
        )}

        {!isAiConfigured && (
          <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-2 text-xs text-[var(--admin-gold)]">
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
