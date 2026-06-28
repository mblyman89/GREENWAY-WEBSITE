import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { ContentPreviewPanel } from "@/components/admin/ContentPreviewPanel";
import { listContentBlocks } from "@/lib/cms/content-store";
import { CONTENT_BLOCK_SEEDS } from "@/lib/cms/content-blocks-seed";
import {
  seedContentBlocksAction,
  saveContentDraftAction,
  publishContentBlockAction,
} from "./actions";

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
                {items.map((b) => {
                  const dirty = (b.draft_value ?? "") !== (b.published_value ?? "");
                  return (
                    <div
                      key={b.id}
                      id={`block-${b.block_key}`}
                      className="scroll-mt-24 rounded-xl border border-white/10 bg-[#0a0a0a] p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-white">{b.label}</div>
                          <div className="font-mono text-xs text-white/35">{b.block_key}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          {b.seo_impact && (
                            <span className="rounded-full border border-[#ffd700]/40 bg-[#ffd700]/10 px-2 py-0.5 text-[0.65rem] font-semibold text-[#ffd700]">
                              SEO impact
                            </span>
                          )}
                          <span className="rounded-full border border-white/15 px-2 py-0.5 text-[0.65rem] font-semibold text-white/50">
                            {b.field_type}
                          </span>
                          {dirty && (
                            <span className="rounded-full border border-[#ff7f00]/40 bg-[#ff7f00]/10 px-2 py-0.5 text-[0.65rem] font-semibold text-[#ff7f00]">
                              unpublished draft
                            </span>
                          )}
                        </div>
                      </div>
                      {b.help_text && <p className="mt-1 text-xs text-white/45">{b.help_text}</p>}

                      <form action={saveContentDraftAction} className="mt-3 space-y-2">
                        <input type="hidden" name="block_key" value={b.block_key} />
                        <textarea
                          name="draft_value"
                          rows={b.field_type === "rich" || b.field_type === "markdown" ? 4 : 2}
                          defaultValue={b.draft_value ?? ""}
                          className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
                        />
                        <div className="flex flex-wrap gap-2">
                          <button type="submit" className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/80 hover:bg-white/10">
                            Save draft
                          </button>
                        </div>
                      </form>
                      <form action={publishContentBlockAction} className="mt-2">
                        <input type="hidden" name="block_key" value={b.block_key} />
                        <button type="submit" className="rounded-lg bg-[#7ed957] px-3 py-1.5 text-xs font-bold text-black hover:bg-[#6bc746]">
                          Publish live
                        </button>
                      </form>

                      {b.published_value != null && (
                        <p className="mt-2 text-xs text-white/35">
                          <span className="font-semibold text-white/45">Live:</span> {b.published_value}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          </>
        )}
      </div>
    </div>
  );
}
