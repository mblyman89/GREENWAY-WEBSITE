import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Input, Button, Badge } from "@/components/admin/ui";
import {
  listMasters,
  listSuggestions,
  isAiConfigured,
} from "@/lib/products/masters-store";
import {
  generateSuggestions,
  acceptSuggestionAction,
  rejectSuggestionAction,
  createMasterAction,
} from "./actions";

export const dynamic = "force-dynamic";

const BASE = "/admin/products/masters";

export default async function MastersPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    error?: string;
    generated?: string;
    clusters?: string;
    rejected?: string;
    deleted?: string;
  }>;
}) {
  await requirePermission("inventory.manage");
  const sp = await searchParams;
  const tab = sp.tab === "suggestions" ? "suggestions" : "masters";

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Product Mastering" subtitle="Group items that are the same product at different sizes." />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn&apos;t fully set up yet. Once setup is complete,
            product mastering will appear here.
          </div>
        </div>
      </div>
    );
  }

  const [masters, suggestions] = await Promise.all([
    listMasters(),
    listSuggestions({ status: "pending" }),
  ]);

  const published = masters.filter((m) => m.status === "published").length;
  const drafts = masters.filter((m) => m.status === "draft").length;

  return (
    <div>
      <AdminPageHeader
        title="Product Mastering"
        subtitle="Group menu items that are really one product sold at different sizes or forms into a single card, so your menu reads clean. AI suggests groupings — you decide."
        breadcrumbs={<Breadcrumbs items={[{ label: "Catalog" }, { label: "Product Mastering" }]} />}
        help={
          <HelpPanel
            id="product-masters"
            title="How product mastering works"
            steps={[
              "Click “Generate suggestions” to scan your live menu for items that look like the same product at different sizes.",
              "Review each suggestion. Accept the good ones — that creates a DRAFT product card.",
              "Open a draft, tidy the name and variants, then Publish to group them on your public menu.",
              "Nothing changes on your menu until you publish. AI never publishes on its own.",
            ]}
          >
            <p>
              Suggestions are <strong>drafts only</strong>. Exact-name matches are
              found instantly; the AI adds smarter matches (e.g. brand spelled two
              ways) when it&apos;s configured.
            </p>
          </HelpPanel>
        }
        action={
          <form action={generateSuggestions}>
            <Button type="submit">✨ Generate suggestions</Button>
          </form>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {decodeURIComponent(sp.error)}
          </div>
        )}
        {sp.generated !== undefined && (
          <div className="rounded-lg border border-[#7ed957]/40 bg-[#7ed957]/10 px-4 py-3 text-sm text-[#7ed957]">
            Created {sp.generated} new suggestion(s) from {sp.clusters ?? 0} candidate group(s).
            {!isAiConfigured && " (AI not configured — exact-name matches only.)"}
          </div>
        )}
        {sp.rejected && (
          <div className="rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]">
            Suggestion rejected.
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Product masters" value={masters.length} hint={`${published} published · ${drafts} draft`} accent="green" />
          <StatCard label="Pending suggestions" value={suggestions.length} accent={suggestions.length > 0 ? "gold" : "muted"} />
          <StatCard label="Published cards" value={published} accent="green" />
          <StatCard label="AI grouping" value={isAiConfigured ? "On" : "Off"} hint={isAiConfigured ? "smarter matches enabled" : "exact-name only"} accent={isAiConfigured ? "green" : "muted"} />
        </div>

        <div className="flex gap-2 border-b border-[var(--admin-border)]">
          <a href={`${BASE}?tab=masters`} className={tabCls(tab === "masters")}>Product Masters ({masters.length})</a>
          <a href={`${BASE}?tab=suggestions`} className={tabCls(tab === "suggestions")}>Suggestions ({suggestions.length})</a>
        </div>

        {tab === "masters" ? (
          <MastersTab masters={masters} />
        ) : (
          <SuggestionsTab suggestions={suggestions} />
        )}
      </div>
    </div>
  );
}

function tabCls(active: boolean) {
  return `px-4 py-2 text-sm font-semibold ${
    active ? "border-b-2 border-[#7ed957] text-white" : "text-white/50 hover:text-white/80"
  }`;
}

function MastersTab({
  masters,
}: {
  masters: Awaited<ReturnType<typeof listMasters>>;
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
        <h3 className="mb-4 text-sm font-semibold text-white">Create a product master manually</h3>
        <form action={createMasterAction} className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Input name="display_name" placeholder="Product name (e.g. Acme OG Kush)" required />
          </div>
          <div className="min-w-40">
            <Input name="brand_name" placeholder="Brand (optional)" />
          </div>
          <div className="min-w-40">
            <Input name="category" placeholder="Category (optional)" />
          </div>
          <Button type="submit">Create</Button>
        </form>
      </div>

      {masters.length === 0 ? (
        <EmptyState icon="📦" title="No product masters yet" description="Generate suggestions above, accept the good ones, or create one manually." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {masters.map((m) => (
            <Link
              key={m.id}
              href={`${BASE}/${m.id}`}
              className="admin-card-interactive flex flex-col gap-2 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4"
            >
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate text-sm font-semibold text-white">{m.display_name}</span>
                {m.status === "published" ? (
                  <Badge tone="green">published</Badge>
                ) : m.status === "draft" ? (
                  <Badge tone="gold">draft</Badge>
                ) : (
                  <Badge tone="neutral">archived</Badge>
                )}
              </div>
              <p className="text-xs text-white/40">
                {m.brand_name ?? "—"} · {m.category ?? "—"}
              </p>
              {m.created_origin === "ai_suggestion" && (
                <span className="text-[10px] text-white/30">✨ from AI suggestion</span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function SuggestionsTab({
  suggestions,
}: {
  suggestions: Awaited<ReturnType<typeof listSuggestions>>;
}) {
  if (suggestions.length === 0) {
    return (
      <EmptyState
        icon="✨"
        title="No pending suggestions"
        description="Click “Generate suggestions” to scan your live menu for groupable products."
      />
    );
  }
  return (
    <div className="space-y-3">
      {suggestions.map((s) => (
        <div key={s.id} className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-white">{s.display_name}</span>
                {s.confidence != null && (
                  <Badge tone={s.confidence >= 0.8 ? "green" : "gold"}>
                    {Math.round(s.confidence * 100)}% match
                  </Badge>
                )}
                {s.model === "ai" ? <Badge tone="outline">✨ AI</Badge> : <Badge tone="neutral">exact name</Badge>}
              </div>
              <p className="mt-1 text-xs text-white/50">{s.rationale}</p>
              <ul className="mt-2 space-y-1">
                {s.members_json.map((m) => (
                  <li key={m.pos_product_key} className="text-xs text-white/70">
                    • {m.name}
                    {m.variant_label && <span className="ml-1 text-white/40">({m.variant_label})</span>}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              <form action={acceptSuggestionAction}>
                <input type="hidden" name="id" value={s.id} />
                <Button type="submit">Accept</Button>
              </form>
              <form action={rejectSuggestionAction}>
                <input type="hidden" name="id" value={s.id} />
                <Button type="submit" variant="neutral">Reject</Button>
              </form>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
