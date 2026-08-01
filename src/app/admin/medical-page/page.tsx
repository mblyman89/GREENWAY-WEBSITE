import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui";
import {
  MedicalPageEditor,
  type MedicalBlockVM,
  type MedicalRevisionVM,
  type MedicalSectionVM,
} from "@/components/admin/MedicalPageEditor";
import {
  listContentBlocks,
  listContentRevisions,
  ensureContentBlocksSeeded,
  getContentBlock,
} from "@/lib/cms/content-store";
import {
  MEDICAL_CONTENT_BLOCKS,
  MEDICAL_HERO_BLOCKS,
  MEDICAL_HIDE_BLOCK,
  MEDICAL_VISIBLE_VALUE,
  medicalFallback,
  medicalHeroFallback,
} from "@/lib/medical/medical-content-core";
import {
  saveMedicalDraftAction,
  publishMedicalAction,
  restoreMedicalRevisionAction,
} from "./actions";

/**
 * Medical page editor (Admin → Website → Medical page), SLICE 107.
 *
 * Controls the public /medical page: a page-level "hide this page" switch and
 * the editable copy (section eyebrows/titles and the two bullet lists). Reuses
 * the Site Content draft → publish → revision/restore machinery, so the public
 * page stays byte-identical until a staff member edits and Publishes.
 *
 * NOTE: this route is /admin/medical-page — /admin/medical is a DIFFERENT tool
 * (patient intake, medical.manage permission). This editor needs content.edit.
 */
export const dynamic = "force-dynamic";

/** Which copy blocks are long enough to want a textarea. */
const MULTILINE_KEYS = new Set<string>([
  "medical.bring.item1",
  "medical.bring.item2",
  "medical.bring.item3",
  "medical.perks.item1",
  "medical.perks.item2",
  "medical.perks.item3",
  "medical.perks.item4",
  // MIG-5 Slice 1: the intro paragraph is a long block -> textarea.
  "medical.intro.body",
]);

/** Grouping of the copy blocks into friendly sections for the editor UI. */
const SECTION_GROUPS: { id: string; heading: string; prefix: string }[] = [
  { id: "bring", heading: "“What to bring” card", prefix: "medical.bring." },
  { id: "perks", heading: "“What your card gets you” card", prefix: "medical.perks." },
  { id: "cbd", heading: "“High-CBD” card (heading only — body is locked)", prefix: "medical.cbd." },
  { id: "limits", heading: "“Purchase limits” card (heading only — table is live)", prefix: "medical.limits." },
];

export default async function AdminMedicalPage({
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
          title="Medical page"
          subtitle="Show or hide the public Medical page and edit its copy — no code."
        />
        <div className="px-5 py-6 sm:px-8 text-sm text-[var(--admin-gold)]">
          The database isn&apos;t fully set up yet. Once your administrator finishes the one-time
          setup, your Medical page controls will appear here to edit.
        </div>
      </div>
    );
  }

  // Lazy, idempotent top-up so the new blocks appear automatically.
  let allBlocks = await listContentBlocks();
  if (allBlocks.length > 0) {
    const inserted = await ensureContentBlocksSeeded();
    if (inserted > 0) allBlocks = await listContentBlocks();
  }

  // ---- Hide switch block ---------------------------------------------------
  const hideBlock = await getContentBlock(MEDICAL_HIDE_BLOCK);
  const hideDraftValue = hideBlock?.draft_value ?? hideBlock?.published_value ?? MEDICAL_VISIBLE_VALUE;
  const hidePublishedValue = hideBlock?.published_value ?? MEDICAL_VISIBLE_VALUE;
  const hideHasUnpublishedDraft =
    !!hideBlock && (hideBlock.draft_value ?? "") !== (hideBlock.published_value ?? "");
  const hideRevRows = await listContentRevisions(MEDICAL_HIDE_BLOCK, 10);
  const hideRevisions: MedicalRevisionVM[] = hideRevRows.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    actor_email: r.actor_email,
  }));

  // ---- Copy blocks (build one VM each; blocks come from the pure core) -----
  const byKey = new Map(allBlocks.map((b) => [b.block_key, b]));

  // Build a VM for one editable block, given its byte-identical fallback.
  const buildVM = async (
    cb: { key: string; label: string; help?: string },
    fallback: string,
  ): Promise<MedicalBlockVM> => {
    const row = byKey.get(cb.key);
    const draftValue = row?.draft_value ?? row?.published_value ?? fallback;
    const publishedValue = row?.published_value ?? fallback;
    const revRows = await listContentRevisions(cb.key, 10);
    return {
      key: cb.key,
      label: cb.label,
      help: cb.help ?? null,
      multiline: MULTILINE_KEYS.has(cb.key),
      draftValue,
      publishedValue,
      hasUnpublishedDraft: !!row && (row.draft_value ?? "") !== (row.published_value ?? ""),
      revisions: revRows.map((r) => ({
        id: r.id,
        created_at: r.created_at,
        actor_email: r.actor_email,
      })),
    };
  };

  const blockVMs: MedicalBlockVM[] = await Promise.all(
    MEDICAL_CONTENT_BLOCKS.map((cb) => buildVM(cb, medicalFallback(cb.key))),
  );

  // MIG-5 Slice 1: the hero/intro blocks (separate registry, byte-identical
  // fallbacks) surface as their own "Hero & intro" section at the top.
  const heroVMs: MedicalBlockVM[] = await Promise.all(
    MEDICAL_HERO_BLOCKS.map((cb) => buildVM(cb, medicalHeroFallback(cb.key))),
  );

  const sections: MedicalSectionVM[] = [
    ...(heroVMs.length > 0
      ? [{ id: "hero", heading: "Hero & intro (top of the page)", blocks: heroVMs }]
      : []),
    ...SECTION_GROUPS.map((g) => ({
      id: g.id,
      heading: g.heading,
      blocks: blockVMs.filter((b) => b.key.startsWith(g.prefix)),
    })).filter((s) => s.blocks.length > 0),
  ];

  return (
    <div>
      <AdminPageHeader
        title="Medical page"
        subtitle="Show or hide the public Medical page, and edit its section headings and info lists — then Save draft or Publish."
        breadcrumbs={<Breadcrumbs items={[{ label: "Medical page" }]} />}
        help={
          <HelpPanel
            id="medical-page-editor"
            title="How the Medical page editor works"
            steps={[
              "Use the visibility switch to show or hide the whole Medical page. Publish to make it take effect.",
              "Edit any section heading or info line, then Save draft (private) or Publish (updates the live page).",
              "Every publish is saved, so you can open History on any field and roll back.",
            ]}
          >
            <p className="mb-2">
              <strong>The legal fine print and the limits table are locked.</strong> They stay
              accurate from the compliance engine, so you can never accidentally change a tax figure
              or a purchase limit here.
            </p>
            <p>
              This is a different page from <strong>Medical (patient intake)</strong> in the staff
              tools — this one only edits the public website page.
            </p>
          </HelpPanel>
        }
        action={<Button href="/medical" external variant="neutral">View live page →</Button>}
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

        <MedicalPageEditor
          hideDraftValue={hideDraftValue}
          hidePublishedValue={hidePublishedValue}
          hideHasUnpublishedDraft={hideHasUnpublishedDraft}
          hideRevisions={hideRevisions}
          sections={sections}
          saveDraftAction={saveMedicalDraftAction}
          publishAction={publishMedicalAction}
          restoreAction={restoreMedicalRevisionAction}
        />
      </div>
    </div>
  );
}
