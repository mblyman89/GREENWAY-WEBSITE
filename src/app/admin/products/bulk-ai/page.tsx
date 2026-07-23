import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { BackLink, Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Button, CHIP_ACTION, CHIP_NEUTRAL } from "@/components/admin/ui";
import { getPublishedVersion, getVersionItems } from "@/lib/pos/menu-version";
import { getEnrichmentsForKeys, computeGaps } from "@/lib/enrichment/store";
import { listPendingByType } from "@/lib/ai/suggestions";
import { checkCompliance } from "@/lib/ai/compliance";
import { isAiConfigured } from "@/lib/ai/provider";
import {
  bulkGenerateDescriptionsAction,
  bulkAcceptSuggestionAction,
  bulkRejectSuggestionAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function BulkAiPage({
  searchParams,
}: {
  searchParams: Promise<{ generated?: string; failed?: string; accepted?: string; error?: string; back?: string }>;
}) {
  await requirePermission("products.enrich");
  const sp = await searchParams;
  const { generated, failed, accepted, error, back } = sp;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Bulk AI review" subtitle="Draft product descriptions in bulk." />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn&apos;t fully set up yet. Once your administrator
            finishes the one-time setup, bulk AI review will be ready to use.
          </div>
        </div>
      </div>
    );
  }
  if (!isAiConfigured) {
    return (
      <div>
        <AdminPageHeader title="Bulk AI review" subtitle="Draft product descriptions in bulk." />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-xl border border-[var(--admin-gold)]/30 bg-[var(--admin-gold)]/5 p-5 text-sm text-[var(--admin-gold)]">
            AI is not enabled. Add an <code className="rounded bg-black/40 px-1">AI_API_KEY</code> to turn on
            bulk drafting.
          </div>
        </div>
      </div>
    );
  }

  const published = await getPublishedVersion();
  const items = published ? await getVersionItems(published.id) : [];
  const enrichments = await getEnrichmentsForKeys(items.map((i) => i.source_item_id));
  const gaps = items.map((i) => computeGaps(i, enrichments.get(i.source_item_id) ?? null));
  const missingDesc = gaps.filter((g) => !g.hasDescription).slice(0, 60);

  // Map of pos key -> product name for the review section.
  const nameByKey = new Map(gaps.map((g) => [g.posKey, g.name]));
  const pending = await listPendingByType("product");
  const pendingDesc = pending.filter((s) => s.field_key === "description");

  return (
    <div>
      <AdminPageHeader
        title="Bulk AI review"
        subtitle="Draft compliant descriptions for many products at once — then approve them in a grid."
        breadcrumbs={
          <Breadcrumbs items={[{ label: "Product Intake", href: "/admin/catalog" }, { label: "Product Enrichment", href: "/admin/products" }, { label: "Bulk AI" }]} />
        }
        help={
          <HelpPanel
            id="bulk-ai"
            title="How bulk AI works"
            steps={[
              "Pick the products you want descriptions for (we pre-list ones missing copy).",
              "Click Draft — the AI writes a compliant draft for each.",
              "Review each draft below and Accept or Reject it.",
              "Accepted drafts save to the product; publish the product to go live.",
            ]}
          >
            <p>Nothing publishes automatically. Every AI draft is a suggestion you approve.</p>
          </HelpPanel>
        }
        action={
          <BackLink fallback="/admin/products" back={back} className="text-sm text-white/60 hover:text-white">
            ← Back to products
          </BackLink>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
        {generated != null && (
          <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-2 text-sm text-[var(--admin-accent)]">
            Drafted {generated} description{generated === "1" ? "" : "s"}
            {failed && failed !== "0" ? ` (${failed} failed)` : ""}. Review them below.
          </div>
        )}
        {accepted && (
          <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-2 text-sm text-[var(--admin-accent)]">
            Saved to the product. Publish the product to make it live.
          </div>
        )}

        {/* Selection: products missing descriptions */}
        <form action={bulkGenerateDescriptionsAction} className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">
              Products missing descriptions{" "}
              <span className="text-white/40">({missingDesc.length} shown)</span>
            </h2>
            <Button type="submit" variant="special" size="sm">
              ✨ Draft selected (up to 25)
            </Button>
          </div>
          {missingDesc.length === 0 ? (
            <p className="text-sm text-white/50">
              Every published product already has a description. 🎉
            </p>
          ) : (
            <div className="grid max-h-80 grid-cols-1 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
              {missingDesc.map((g) => (
                <label
                  key={g.posKey}
                  className="flex items-center gap-2 rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white/80 hover:border-[var(--admin-accent)]/40"
                >
                  <input type="checkbox" name="keys" value={g.posKey} defaultChecked className="h-4 w-4" />
                  <span className="truncate">
                    {g.name}
                    <span className="ml-1 text-[0.7rem] text-white/40">· {g.category}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          <p className="mt-2 text-[0.7rem] text-white/40">
            Tip: uncheck any you don&apos;t want. We draft up to 25 per click to keep it fast.
          </p>
        </form>

        {/* Review grid */}
        <div id="review">
          <h2 className="mb-3 text-sm font-bold text-white">
            Drafts awaiting your review{" "}
            <span className="text-white/40">({pendingDesc.length})</span>
          </h2>
          {pendingDesc.length === 0 ? (
            <p className="text-sm text-white/50">
              No drafts waiting. Select products above and click Draft to generate some.
            </p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {pendingDesc.map((s) => {
                const flags = checkCompliance(s.suggested_value ?? "").flags;
                return (
                  <div key={s.id} className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-sm font-semibold text-white">
                        {nameByKey.get(s.entity_id) ?? s.entity_id}
                        {typeof s.confidence === "number" && (
                          <span
                            className={`rounded px-1.5 py-0.5 text-[0.6rem] font-semibold ${s.confidence >= 0.75 ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]" : s.confidence >= 0.45 ? "bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]" : "bg-[var(--admin-orange-soft)] text-[var(--admin-orange)]"}`}
                            title="How well this draft is grounded in the product's facts"
                          >
                            {Math.round(s.confidence * 100)}%
                          </span>
                        )}
                      </span>
                      {flags.length > 0 ? (
                        <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[0.6rem] font-semibold text-red-400">
                          ⚠ {flags.length} flag{flags.length > 1 ? "s" : ""}
                        </span>
                      ) : (
                        <span className="rounded-full border border-[var(--admin-accent)]/30 bg-[var(--admin-accent)]/10 px-2 py-0.5 text-[0.6rem] font-semibold text-[var(--admin-accent)]">
                          ✓ clean
                        </span>
                      )}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/80">
                      {s.suggested_value}
                    </p>
                    {flags.length > 0 && (
                      <ul className="mt-2 list-disc pl-5 text-xs text-red-400/80">
                        {flags.map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-3 flex gap-2">
                      <form action={bulkAcceptSuggestionAction}>
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="key" value={s.entity_id} />
                        <button type="submit" className={CHIP_ACTION}>
                          Accept
                        </button>
                      </form>
                      <form action={bulkRejectSuggestionAction}>
                        <input type="hidden" name="id" value={s.id} />
                        <button type="submit" className={CHIP_NEUTRAL}>
                          Reject
                        </button>
                      </form>
                      <Link
                        href={`/admin/products/${encodeURIComponent(s.entity_id)}`}
                        className="ml-auto self-center text-xs text-white/50 hover:text-white"
                      >
                        Open product ↗
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
