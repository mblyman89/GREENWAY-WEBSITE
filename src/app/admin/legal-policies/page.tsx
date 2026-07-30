import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui";
import {
  PolicyDocEditor,
  type PolicyRevisionVM,
} from "@/components/admin/PolicyDocEditor";
import {
  listContentBlocks,
  listContentRevisions,
  ensureContentBlocksSeeded,
  getContentBlock,
} from "@/lib/cms/content-store";
import { POLICY_DOCS, type PolicyDocId } from "@/lib/cms/policy-doc-core";
import { privacyPolicyParagraphs } from "@/content/privacy-policy";
import { termsOfUseParagraphs } from "@/content/terms-of-use";
import { consumerHealthDataParagraphs } from "@/content/consumer-health-data";
import {
  saveLegalDraftAction,
  publishLegalAction,
  restoreLegalRevisionAction,
} from "./actions";

/**
 * Legal Policies editor (Admin → Website → Legal Policies), SLICE 105b.
 *
 * Three tabs — Privacy Policy, Terms of Use, Consumer Health Data — each with:
 *   - a simple field for the page TITLE (hero), and
 *   - the row-by-row body editor (PolicyDocEditor) backed by one "richdoc"
 *     content block per policy.
 *
 * Everything reuses the Site Content draft → publish → revision machinery, so
 * the public pages stay byte-identical until a staff member edits and Publishes.
 */
export const dynamic = "force-dynamic";

const TAB_ORDER: PolicyDocId[] = ["privacy-policy", "terms-of-use", "consumer-health-data"];

const FALLBACKS: Record<PolicyDocId, readonly string[]> = {
  "privacy-policy": privacyPolicyParagraphs,
  "terms-of-use": termsOfUseParagraphs,
  "consumer-health-data": consumerHealthDataParagraphs,
};

const HERO_LABELS: Record<string, string> = {
  "privacy.hero.title": "Page title",
  "terms.hero.title": "Page title",
  "chd.hero.title.line1": "Title — line 1",
  "chd.hero.title.line2": "Title — line 2",
};

export default async function LegalPoliciesPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    saved?: string;
    published?: string;
    restored?: string;
    error?: string;
  }>;
}) {
  await requirePermission("content.edit");
  const sp = await searchParams;
  const activeTab: PolicyDocId = TAB_ORDER.includes(sp.tab as PolicyDocId)
    ? (sp.tab as PolicyDocId)
    : "privacy-policy";

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader
          title="Legal Policies"
          subtitle="Edit your Privacy Policy, Terms of Use, and Consumer Health Data pages — no code."
        />
        <div className="px-5 py-6 sm:px-8 text-sm text-[var(--admin-gold)]">
          The database isn&apos;t fully set up yet. Once your administrator finishes the one-time
          setup, your legal policies will appear here to edit.
        </div>
      </div>
    );
  }

  // Lazy, idempotent top-up so the new legal body blocks appear automatically.
  let allBlocks = await listContentBlocks();
  if (allBlocks.length > 0) {
    const inserted = await ensureContentBlocksSeeded();
    if (inserted > 0) allBlocks = await listContentBlocks();
  }

  const meta = POLICY_DOCS[activeTab];
  const doc = await getContentBlock(meta.docKey);
  const revisions = await listContentRevisions(meta.docKey, 15);
  const revisionVMs: PolicyRevisionVM[] = revisions.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    actor_email: r.actor_email,
  }));

  // Hero blocks for this tab (title lines).
  const heroBlocks = await Promise.all(
    meta.heroBlockKeys.map((k) => getContentBlock(k)),
  );

  return (
    <div>
      <AdminPageHeader
        title="Legal Policies"
        subtitle="Edit every word of your Privacy Policy, Terms of Use, and Consumer Health Data pages. Draft it, preview it, then Publish."
        breadcrumbs={<Breadcrumbs items={[{ label: "Legal Policies" }]} />}
        help={
          <HelpPanel
            id="legal-policies"
            title="How the Legal Policies editor works"
            steps={[
              "Pick a tab (Privacy Policy, Terms of Use, or Consumer Health Data).",
              "Edit the page title and the body — each paragraph or heading is its own row you can change, add, remove, or reorder.",
              "Use the live preview to see it as customers will, then Save draft (private) or Publish (updates the live page). Every publish is saved so you can roll back.",
            ]}
          >
            <p className="mb-2">
              <strong>This is legal wording.</strong> Consider having your attorney review changes
              before publishing. Nothing goes live until you press Publish.
            </p>
            <p>
              <strong>Nothing can break the layout:</strong> you edit text only — the page styling
              stays exactly as designed.
            </p>
          </HelpPanel>
        }
        action={<Button href="/admin/content" variant="neutral">Site Content →</Button>}
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

        {/* Tabs */}
        <div className="flex flex-wrap gap-2 border-b border-[var(--admin-border)]">
          {TAB_ORDER.map((id) => {
            const m = POLICY_DOCS[id];
            const isActive = id === activeTab;
            return (
              <a
                key={id}
                href={`/admin/legal-policies?tab=${id}`}
                className={`-mb-px rounded-t-[var(--admin-radius-sm)] border-b-2 px-4 py-2 text-sm font-semibold ${
                  isActive
                    ? "border-[var(--admin-accent)] text-[var(--admin-accent)]"
                    : "border-transparent text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
                }`}
              >
                {m.label}
              </a>
            );
          })}
        </div>

        {/* Hero title(s) */}
        <div className="space-y-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
            {meta.label} — page title
          </div>
          {heroBlocks.map((hb, i) => {
            const key = meta.heroBlockKeys[i];
            if (!hb) {
              return (
                <p key={key} className="text-sm text-[var(--admin-text-muted)]">
                  Title field is being set up. Refresh in a moment.
                </p>
              );
            }
            const value = hb.draft_value ?? hb.published_value ?? "";
            const dirty = (hb.draft_value ?? "") !== (hb.published_value ?? "") || hb.status !== "published";
            return (
              <form
                key={key}
                className="flex flex-wrap items-end gap-2"
              >
                <label className="flex-1 min-w-[16rem] text-sm">
                  <span className="mb-1 block font-medium text-[var(--admin-text-muted)]">
                    {HERO_LABELS[key] ?? "Title"}
                  </span>
                  <input
                    type="text"
                    name="draft_value"
                    defaultValue={value}
                    className="w-full rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-white px-3 py-2 text-sm text-black"
                  />
                </label>
                <input type="hidden" name="block_key" value={key} />
                <Button type="submit" size="sm" formAction={saveLegalDraftAction} variant="save">
                  Save draft
                </Button>
                <Button type="submit" size="sm" formAction={publishLegalAction} variant="primary">
                  Publish
                </Button>
                {dirty ? (
                  <span className="rounded-full bg-orange-100 px-2 py-1 text-xs font-semibold text-orange-800">
                    Unpublished
                  </span>
                ) : null}
              </form>
            );
          })}
        </div>

        {/* Body document editor */}
        <PolicyDocEditor
          docKey={meta.docKey}
          label={meta.label}
          publicPath={meta.path}
          draftJson={doc?.draft_value ?? null}
          publishedJson={doc?.published_value ?? null}
          fallbackParagraphs={FALLBACKS[activeTab]}
          revisions={revisionVMs}
          saveDraftAction={saveLegalDraftAction}
          publishAction={publishLegalAction}
          restoreAction={restoreLegalRevisionAction}
        />
      </div>
    </div>
  );
}
