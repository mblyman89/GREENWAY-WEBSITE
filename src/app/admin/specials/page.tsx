import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui";
import {
  SpecialsPresentationEditor,
  type SpecialsRevisionVM,
  type WeekdayEngineCopy,
} from "@/components/admin/SpecialsPresentationEditor";
import {
  listContentBlocks,
  listContentRevisions,
  ensureContentBlocksSeeded,
  getContentBlock,
} from "@/lib/cms/content-store";
import { loadPublishedRuleSnapshots } from "@/lib/promotions/discount-engine";
import { weeklyDealSummaries } from "@/lib/promotions/published-rules-core";
import {
  SPECIALS_WEEKDAYS,
  type SpecialsWeekday,
} from "@/lib/specials/specials-presentation-core";
import { SPECIALS_PRESENTATION_BLOCK } from "./actions";
import {
  saveSpecialsDraftAction,
  publishSpecialsAction,
  restoreSpecialsRevisionAction,
} from "./actions";

/**
 * Specials presentation editor (Admin → Website → Specials), SLICE 106.
 *
 * This page controls HOW the weekly deals are PRESENTED on the public
 * /specials page — which weekday cards show, their order, the badge style,
 * optional copy overrides, and whether the "Today's Deals" products grid
 * appears. It NEVER touches the discount math: all prices, percentages and
 * eligible products come from the promotions engine (Admin → Promotions).
 *
 * Storage is one "richjson" content block (specials.deals.presentation) that
 * reuses the Site Content draft → publish → revision machinery, so the public
 * page stays byte-identical until a staff member edits and Publishes.
 */
export const dynamic = "force-dynamic";

/** Convert an engine StoreWeekday ("monday") to a SpecialsWeekday ("Monday"). */
function capitalizeWeekday(day: string): SpecialsWeekday {
  const label = day.charAt(0).toUpperCase() + day.slice(1);
  return (SPECIALS_WEEKDAYS as readonly string[]).includes(label)
    ? (label as SpecialsWeekday)
    : "Monday";
}

export default async function AdminSpecialsPage({
  searchParams,
}: {
  searchParams: Promise<{
    saved?: string;
    published?: string;
    restored?: string;
    error?: string;
  }>;
}) {
  await requirePermission("content.edit");
  const sp = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader
          title="Specials"
          subtitle="Control how your weekly deals are shown on the public Specials page — no code."
        />
        <div className="px-5 py-6 sm:px-8 text-sm text-[var(--admin-gold)]">
          The database isn&apos;t fully set up yet. Once your administrator finishes the one-time
          setup, your Specials presentation controls will appear here to edit.
        </div>
      </div>
    );
  }

  // Lazy, idempotent top-up so the new presentation block appears automatically.
  let allBlocks = await listContentBlocks();
  if (allBlocks.length > 0) {
    const inserted = await ensureContentBlocksSeeded();
    if (inserted > 0) allBlocks = await listContentBlocks();
  }

  const block = await getContentBlock(SPECIALS_PRESENTATION_BLOCK);
  const revisions = await listContentRevisions(SPECIALS_PRESENTATION_BLOCK, 15);
  const revisionVMs: SpecialsRevisionVM[] = revisions.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    actor_email: r.actor_email,
  }));

  // Read-only snapshot of what the promotions engine currently says for each
  // weekday, so the editor can show the LIVE copy an override would replace.
  const snapshots = await loadPublishedRuleSnapshots();
  const summaries = weeklyDealSummaries(snapshots);
  const engineCopy: WeekdayEngineCopy[] = summaries.map((s) => ({
    weekday: capitalizeWeekday(s.weekday),
    title: s.title,
    offer: s.offerLabel,
    description: s.description ?? "",
    fromDatabase: s.fromDatabase,
  }));

  return (
    <div>
      <AdminPageHeader
        title="Specials"
        subtitle="Choose which weekly deal cards show, their order, the badge style, and copy — then Save draft or Publish. Prices come from Promotions."
        breadcrumbs={<Breadcrumbs items={[{ label: "Specials" }]} />}
        help={
          <HelpPanel
            id="specials-presentation"
            title="How the Specials editor works"
            steps={[
              "Turn the weekly deal grid and Today's Deals products grid on or off.",
              "For each weekday: show/hide it, drag its order, pick a badge style, and optionally override the title, offer line, or description.",
              "Use the live preview to see it as customers will, then Save draft (private) or Publish (updates the live page). Every publish is saved so you can roll back.",
            ]}
          >
            <p className="mb-2">
              <strong>This controls presentation only — not the prices.</strong> The actual
              discounts, percentages, and eligible products are set in{" "}
              <Link href="/admin/promotions" className="underline">Promotions</Link>. Editing here only
              changes how those deals are shown.
            </p>
            <p>
              <strong>Nothing can break the layout:</strong> you toggle and reorder cards and edit
              text only — the page styling stays exactly as designed.
            </p>
          </HelpPanel>
        }
        action={<Button href="/admin/promotions" variant="neutral">Promotions →</Button>}
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.error === "restore" ? (
          <div className="rounded-[var(--admin-radius-sm)] border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800">
            Couldn&apos;t restore that version. Please try again.
          </div>
        ) : null}
        {(sp.saved || sp.published || sp.restored) && (
          <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            {sp.published
              ? "Published live. 🎉"
              : sp.restored
                ? "Restored into the draft — review it, then Publish."
                : "Draft saved."}
          </div>
        )}

        {!block ? (
          <p className="text-sm text-[var(--admin-text-muted)]">
            The Specials presentation settings are being set up. Refresh in a moment.
          </p>
        ) : (
          <SpecialsPresentationEditor
            draftJson={block.draft_value ?? null}
            publishedJson={block.published_value ?? null}
            engineCopy={engineCopy}
            revisions={revisionVMs}
            saveDraftAction={saveSpecialsDraftAction}
            publishAction={publishSpecialsAction}
            restoreAction={restoreSpecialsRevisionAction}
          />
        )}
      </div>
    </div>
  );
}
