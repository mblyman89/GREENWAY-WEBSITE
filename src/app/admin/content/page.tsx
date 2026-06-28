import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { ContentPreviewPanel } from "@/components/admin/ContentPreviewPanel";
import { ContentBlockEditor } from "@/components/admin/ContentBlockEditor";
import { listContentBlocks } from "@/lib/cms/content-store";
import { CONTENT_BLOCK_SEEDS } from "@/lib/cms/content-blocks-seed";
import { isAiConfigured } from "@/lib/cms/ai-content";
import {
  seedContentBlocksAction,
  saveContentDraftAction,
  publishContentBlockAction,
} from "./actions";

/** Map a content block's page group to a public URL for "View on site". */
function publicPathForPage(page: string): string | null {
  switch (page) {
    case "home":
      return "/";
    case "menu":
      return "/menu";
    case "loyalty":
      return "/loyalty";
    case "vendors":
      return "/vendors";
    case "specials":
      return "/specials";
    default:
      return null;
  }
}

export const dynamic = "force-dynamic";

export default async function SiteContentPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; published?: string; seeded?: string }>;
}) {
  await requirePermission("content.edit");
  const { saved, published, seeded } = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Site Content" subtitle="Edit approved site text blocks safely — no code, no page builder." />
        <div className="px-5 py-6 sm:px-8 text-sm text-[#ffd700]">Supabase is not configured yet.</div>
      </div>
    );
  }

  const blocks = await listContentBlocks();
  const notSeeded = blocks.length === 0;
  const aiEnabled = isAiConfigured;

  // Group by page.
  const byPage = new Map<string, typeof blocks>();
  for (const b of blocks) {
    const arr = byPage.get(b.page) ?? [];
    arr.push(b);
    byPage.set(b.page, arr);
  }

  return (
    <div>
      <AdminPageHeader
        title="Site Content"
        subtitle={`Controlled text blocks for ${CONTENT_BLOCK_SEEDS.length} approved slots. Edit a draft, then Publish to push it live. This is intentionally not a free-form page builder.`}
        breadcrumbs={<Breadcrumbs items={[{ label: "Site Content" }]} />}
        help={
          <HelpPanel
            id="content"
            title="How to edit your site text"
            steps={[
              "Pick the text block you want to change (e.g. homepage headline).",
              "Edit the draft — your changes don't go live yet.",
              "Preview how it will look.",
              "Click Publish to update the public site.",
            ]}
          >
            <p>
              You can only edit specific approved spots, which keeps your site
              looking right. There&apos;s no way to accidentally break the layout.
            </p>
          </HelpPanel>
        }
        action={
          <Link href="/admin/content/seo" className="rounded-lg border border-white/15 px-4 py-2 text-sm font-bold text-white/80 hover:bg-white/10">
            SEO editor →
          </Link>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {(saved || published || seeded) && (
          <div className="rounded-lg border border-[#7ed957]/40 bg-[#7ed957]/10 px-4 py-2 text-sm text-[#7ed957]">
            {published ? "Published live." : seeded ? "Content blocks initialized." : "Draft saved."}
          </div>
        )}

        {notSeeded ? (
          <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-6">
            <p className="text-sm text-white/70">
              The controlled content blocks haven&apos;t been initialized yet. Click below to create the {CONTENT_BLOCK_SEEDS.length}{" "}
              approved editable slots (pre-filled with the current live copy — no visible change until you edit).
            </p>
            <form action={seedContentBlocksAction} className="mt-4">
              <button type="submit" className="rounded-lg bg-[#7ed957] px-5 py-2.5 text-sm font-bold text-black hover:bg-[#6bc746]">
                Initialize content blocks
              </button>
            </form>
          </div>
        ) : (
          <>
          <ContentPreviewPanel />
          {Array.from(byPage.entries()).map(([page, items]) => (
            <div key={page}>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[#7ed957]">{page}</h2>
              <div className="space-y-4">
                {items.map((b) => (
                  <ContentBlockEditor
                    key={b.id}
                    block={{
                      block_key: b.block_key,
                      label: b.label,
                      field_type: b.field_type,
                      help_text: b.help_text,
                      seo_impact: b.seo_impact,
                      draft_value: b.draft_value,
                      published_value: b.published_value,
                    }}
                    aiEnabled={aiEnabled}
                    saveDraftAction={saveContentDraftAction}
                    publishAction={publishContentBlockAction}
                    publicPath={publicPathForPage(b.page)}
                  />
                ))}
              </div>
            </div>
          ))}
          </>
        )}
      </div>
    </div>
  );
}
