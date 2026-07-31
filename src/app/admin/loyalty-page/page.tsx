import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui";
import {
  LoyaltyPageEditor,
  type LoyaltyBlockVM,
  type LoyaltyLiveTermsVM,
  type LoyaltySectionVM,
} from "@/components/admin/LoyaltyPageEditor";
import {
  listContentBlocks,
  listContentRevisions,
  ensureContentBlocksSeeded,
  getContentBlock,
} from "@/lib/cms/content-store";
import {
  LOYALTY_CONTENT_BLOCKS,
  loyaltyContentFallback,
} from "@/lib/loyalty/loyalty-content-core";
import { LOYALTY_HERO_PRESENTATION_BLOCK } from "@/lib/loyalty/loyalty-hero-core";
import { getConfig, listTiers } from "@/lib/loyalty/loyalty-store";
import { loyaltyTermsSummary, tierDisplayRows } from "@/lib/loyalty/program-terms-core";
import {
  LoyaltyHeroEditor,
  type LoyaltyHeroRevisionVM,
} from "@/components/admin/LoyaltyHeroEditor";
import { listMedia } from "@/lib/media/store";
import type { MediaChoice } from "@/components/admin/ContentImageField";
import { resolveImageSpec } from "@/lib/cms/image-spec-core";
import {
  saveLoyaltyDraftAction,
  publishLoyaltyAction,
  restoreLoyaltyRevisionAction,
  saveLoyaltyHeroDraftAction,
  publishLoyaltyHeroAction,
  restoreLoyaltyHeroRevisionAction,
} from "./actions";

/**
 * Loyalty page editor (Admin → Website → Loyalty page), SLICE 108.
 *
 * Edits the FRIENDLY copy on the public /loyalty page (the signup-form helper /
 * button / thank-you and the "Program terms" headings). Reuses the Site Content
 * draft → publish → revision/restore machinery, so the public page stays
 * byte-identical until a staff member edits and Publishes.
 *
 * COMPLIANCE: the marketing-consent disclosure is legal wording (not editable
 * here) and every program NUMBER stays LIVE from the register's loyalty
 * settings (shown read-only for reference, edited in CRM → Loyalty Program).
 *
 * NOTE: /admin/loyalty is a DIFFERENT tool (CRM → Loyalty Program) and
 * /admin/loyalty-signups is the signup inbox. This editor is /admin/loyalty-page
 * and needs content.edit.
 */
export const dynamic = "force-dynamic";

/** Which of the copy blocks are long enough to want a textarea. */
const MULTILINE_KEYS = new Set<string>([
  "loyalty.form.birthday_help",
  "loyalty.form.success_title",
]);

/** Grouping of the copy blocks into friendly sections for the editor UI. */
const SECTION_GROUPS: { id: string; heading: string; description?: string; prefix: string }[] = [
  {
    id: "signup",
    heading: "Signup form",
    description:
      "The consent paragraph and the field labels are fixed (legal / form). You can edit these friendly bits.",
    prefix: "loyalty.form.",
  },
  {
    id: "terms",
    heading: "“Program terms” section (headings only — the numbers stay live)",
    prefix: "loyalty.terms.",
  },
];

export default async function AdminLoyaltyPage({
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
          title="Loyalty page"
          subtitle="Edit the friendly wording on the public Loyalty page — no code."
        />
        <div className="px-5 py-6 sm:px-8 text-sm text-[var(--admin-gold)]">
          The database isn&apos;t fully set up yet. Once your administrator finishes the one-time
          setup, your Loyalty page controls will appear here to edit.
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

  // ---- Copy blocks (build one VM each; blocks come from the pure core) -----
  const byKey = new Map(allBlocks.map((b) => [b.block_key, b]));
  const blockVMs: LoyaltyBlockVM[] = await Promise.all(
    LOYALTY_CONTENT_BLOCKS.map(async (cb): Promise<LoyaltyBlockVM> => {
      const row = byKey.get(cb.key);
      const fallback = loyaltyContentFallback(cb.key);
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
    }),
  );

  const sections: LoyaltySectionVM[] = SECTION_GROUPS.map((g) => ({
    id: g.id,
    heading: g.heading,
    description: g.description,
    blocks: blockVMs.filter((b) => b.key.startsWith(g.prefix)),
  })).filter((s) => s.blocks.length > 0);

  // ---- Hero banner (SLICE 123 / LOY-1): ONE richjson presentation block ----
  const heroBlock = await getContentBlock(LOYALTY_HERO_PRESENTATION_BLOCK);
  const heroRevisions = await listContentRevisions(LOYALTY_HERO_PRESENTATION_BLOCK, 15);
  const heroRevisionVMs: LoyaltyHeroRevisionVM[] = heroRevisions.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    actor_email: r.actor_email,
  }));
  // Media Library choices for the banner-image pickers (same source + shape the
  // Pages/Specials builders use), so staff can pick a catalogued image or paste
  // a URL. Only published images with a public URL are offered.
  const mediaAssets = await listMedia({ status: "published", limit: 200 });
  const mediaChoices: MediaChoice[] = mediaAssets
    .filter((m) => (m.mime_type ?? "").startsWith("image/") && m.public_url)
    .map((m) => ({
      id: m.id,
      url: m.public_url as string,
      title: m.title ?? m.filename ?? "Image",
      usageType: m.usage_type ?? null,
    }));
  const heroDesktopSpec = resolveImageSpec("loyalty.hero.image");
  const heroMobileSpec = resolveImageSpec("loyalty.hero.image_mobile");

  // ---- Live program numbers snapshot (read-only reference) -----------------
  const [cfg, tiers] = await Promise.all([getConfig(), listTiers()]);
  const summary = loyaltyTermsSummary(cfg);
  const liveTerms: LoyaltyLiveTermsVM = {
    lines: [
      summary.earnLine,
      summary.valueLine,
      summary.redeemLine,
      ...(summary.signupBonusLine ? [summary.signupBonusLine] : []),
      ...(summary.expiryLine ? [summary.expiryLine] : []),
    ],
    tiers: tierDisplayRows(tiers).map((t) => ({
      name: t.name,
      thresholdLabel: t.thresholdLabel,
      perkLabel: t.perkLabel,
    })),
  };

  return (
    <div>
      <AdminPageHeader
        title="Loyalty page"
        subtitle="Edit the friendly wording on the public Loyalty page — the signup button, the birthday note, the thank-you message, and the Program terms headings."
        breadcrumbs={<Breadcrumbs items={[{ label: "Loyalty page" }]} />}
        help={
          <HelpPanel
            id="loyalty-page-editor"
            title="How the Loyalty page editor works"
            steps={[
              "Edit any friendly wording field, then Save draft (private) or Publish (updates the live page).",
              "Every publish is saved, so you can open History on any field and roll back.",
              "The program numbers shown on the page are live from your register — change them in CRM → Loyalty Program.",
            ]}
          >
            <p className="mb-2">
              <strong>The consent paragraph and the program numbers are locked.</strong> The consent
              wording is legal, and the numbers stay accurate from the register, so this page can
              never advertise terms that differ from what customers actually earn.
            </p>
            <p>
              The <strong>hero banner</strong> (the big image and its wording) is now edited right
              here at the top of this page — pick the picture and style the eyebrow, title, and
              subtitle text. Everything for the Loyalty page lives on this one screen.
            </p>
          </HelpPanel>
        }
        action={<Button href="/loyalty" external variant="neutral">View live page →</Button>}
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

        {/* SLICE 123 (LOY-1): the hero banner editor (image + overlay text). */}
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--admin-text)]">Hero banner</h2>
            <p className="text-sm text-[var(--admin-text-muted)]">
              The big banner at the top of the Loyalty page — its picture and the eyebrow / title /
              subtitle wording, fonts, colors, and layout.
            </p>
          </div>
          {!heroBlock ? (
            <p className="text-sm text-[var(--admin-text-muted)]">
              The Loyalty hero banner is being set up. Refresh in a moment.
            </p>
          ) : (
            <LoyaltyHeroEditor
              draftJson={heroBlock.draft_value ?? null}
              publishedJson={heroBlock.published_value ?? null}
              revisions={heroRevisionVMs}
              saveDraftAction={saveLoyaltyHeroDraftAction}
              publishAction={publishLoyaltyHeroAction}
              restoreAction={restoreLoyaltyHeroRevisionAction}
              mediaChoices={mediaChoices}
              desktopSpec={heroDesktopSpec}
              mobileSpec={heroMobileSpec}
            />
          )}
        </section>

        <div className="border-t border-[var(--admin-border)]" />

        <LoyaltyPageEditor
          sections={sections}
          liveTerms={liveTerms}
          saveDraftAction={saveLoyaltyDraftAction}
          publishAction={publishLoyaltyAction}
          restoreAction={restoreLoyaltyRevisionAction}
        />
      </div>
    </div>
  );
}
