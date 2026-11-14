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
import { aiMode } from "@/lib/ai/router";
import { isReasoningModel } from "@/lib/ai/chat-payload-core";
import { enrichModel } from "@/lib/ai/enrich-model";
import { ENRICH_RECOMMENDED, enrichModelLine } from "@/lib/ai/enrich-model-core";
import { listNeedsCloserLook } from "@/lib/enrichment/accept-drafts-server";
import { markBestGuessCheckedAction } from "@/app/admin/products/actions";
import {
  bulkGenerateDescriptionsAction,
  bulkAcceptSuggestionAction,
  bulkRejectSuggestionAction,
  queueBulkAiV2Action,
  cancelBulkAiV2Action,
  bulkAcceptAllForProductAction,
  bulkAcceptEditedAction,
  bulkRejectDraftAction,
} from "./actions";
import { EDIT_HINT, editKind, editText } from "@/lib/enrichment/draft-edit-core";
import { SEO_FIELD_KEY, seoSuggestionDisplay } from "@/lib/enrichment/seo-draft-core";
import {
  ACCEPT_ALL_THRESHOLD,
  FIELD_LABEL,
  evidenceLabel,
  isDraftFieldKey,
  parseEvidenceSource,
  sensoryText,
} from "@/lib/enrichment/ai-draft-v2-core";
import {
  BULK_AI_V2_MAX_QUEUE,
  bulkCounts,
  bulkProgressText,
  bulkVendorStrip,
  parseReviewMin,
  reviewGroups,
} from "@/lib/enrichment/bulk-ai-v2-core";
import { loadBulkAiV2Status } from "@/lib/enrichment/bulk-ai-v2-server";

export const dynamic = "force-dynamic";
// D244 E-0: a 25-product batch on a reasoning model can run for minutes.
export const maxDuration = 300;

export default async function BulkAiPage({
  searchParams,
}: {
  searchParams: Promise<{
    generated?: string;
    failed?: string;
    reason?: string;
    accepted?: string;
    error?: string;
    back?: string;
    // D244 E-5
    queued?: string;
    accepted_note?: string;
    vendor?: string;
    min?: string;
  }>;
}) {
  await requirePermission("products.enrich");
  const sp = await searchParams;
  const { generated, failed, reason, accepted, error, back, queued, accepted_note } = sp;
  const vendorFilter = String(sp.vendor ?? "").trim();
  const minFilter = parseReviewMin(sp.min);
  // D244 R-1: the all-fields drafts use the dedicated enrichment model (AI_ENRICH_MODEL), whatever AI_MODE says.
  const draftModel = enrichModel.model;

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
  // D244 E-5: enough rows for a vendor's worth of all-fields drafts (7 per product).
  const pending = await listPendingByType("product", 1500);
  // The old grid shows only the old description-only drafts; all-fields (v2) drafts are grouped below.
  const pendingDesc = pending.filter((s) => s.field_key === "description" && !parseEvidenceSource(s.source).v2);

  // D244 E-5: the background queue + the grouped review grid.
  const bulk = await loadBulkAiV2Status();
  const vendorByKey = new Map(items.map((i) => [i.source_item_id, (i.vendor_name ?? "").trim() || null] as const));
  const vendors = [...new Set(items.map((i) => (i.vendor_name ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const vendorCount = new Map<string, number>();
  for (const i of items) {
    const v = (i.vendor_name ?? "").trim();
    if (v) vendorCount.set(v, (vendorCount.get(v) ?? 0) + 1);
  }
  const v2Rows = pending.filter((s) => parseEvidenceSource(s.source).v2 && (isDraftFieldKey(s.field_key) || s.field_key === SEO_FIELD_KEY));
  const groups = reviewGroups(v2Rows, { vendorByKey, vendor: vendorFilter, min: minFilter });
  const failedItems = bulk.ok ? bulk.state.items.filter((i) => i.status === "failed") : [];
  const counts = bulk.ok ? bulkCounts(bulk.state) : null;
  const pickable = gaps.slice(0, 400);
  // D244 R-1: accepted best guesses nobody has checked yet.
  const closerLook = await listNeedsCloserLook({ limit: 60 });

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
              "Review each draft below. Type over any draft right in its box, then press Save & accept (or Reject).",
              "Accept all takes every draft at 80% or better plus the AI’s best guesses; best guesses are flagged in “Needs a closer look”.",
              "Accepted copy saves to the product. A product goes live on its own once a person attaches a published photo.",
            ]}
          >
            <p>
              The AI never publishes anything by itself. Drafts become live only when you accept them, and a product
              publishes only after a person attaches a photo. Best guesses are accepted but flagged &mdash; click
              &ldquo;Looks right&rdquo; in &ldquo;Needs a closer look&rdquo; once you have checked one.
            </p>
            <p className="mt-2">
              Strain type and potency are drafted from the product&rsquo;s own lots and lab certificates first (chips
              &ldquo;Lot 1&rdquo;, &ldquo;Lab certificate 1&rdquo;), with lots that are in stock ahead of sold-out ones.
              A potency number that no lab, lot or POS record states is thrown away, and a guessed potency is never
              taken by Accept all. Accepting one updates the website card.
            </p>
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
            {failed && failed !== "0" && reason ? (
              <span className="mt-1 block text-xs text-amber-200">First failure: {reason}</span>
            ) : null}
          </div>
        )}
        {isAiConfigured && (
          <p className="text-xs text-white/50">
            Drafting model: <span className="font-mono text-white/70" data-testid="enrich-model-line">{enrichModelLine(enrichModel)}</span>
            {isReasoningModel(draftModel)
              ? " — reasoning-class model: requests use max_completion_tokens and default temperature automatically."
              : ""}
            <span className="block text-white/40">
              The all-fields drafts always use this model (set <code>AI_ENRICH_MODEL</code> in Vercel; {aiMode} mode does not change it).
              Recommended: <span className="font-mono">{ENRICH_RECOMMENDED.live.model}</span> with effort {ENRICH_RECOMMENDED.live.effort} ({ENRICH_RECOMMENDED.live.why}).
            </span>
          </p>
        )}
        {queued && (
          <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-2 text-sm text-[var(--admin-accent)]" data-testid="bulk-v2-queued">
            {queued}
          </div>
        )}
        {accepted_note && (
          <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-2 text-sm text-[var(--admin-accent)]" data-testid="bulk-v2-accepted">
            {accepted_note}
          </div>
        )}
        {accepted && (
          <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-2 text-sm text-[var(--admin-accent)]">
            Saved to the product. Publish the product to make it live.
          </div>
        )}

        {/* D244 E-5: background all-fields drafts (queue + progress) */}
        <section id="queue" className="rounded-xl border border-[var(--admin-accent)]/30 bg-[#0a0a0a] p-4" data-testid="bulk-v2-queue">
          <h2 className="text-sm font-bold text-white">Draft every field with AI, in the background</h2>
          <p className="mt-1 text-xs text-white/60">
            Each product gets the same all-fields draft as its page&apos;s &ldquo;Enrich this product (all fields)&rdquo; button: display name,
            descriptions, SEO, aroma/flavor/terpenes, effects and tags, each with a confidence and the evidence it used. The
            worker drafts about a dozen products a run, every minute, after you close this tab. Nothing is saved to a product
            until a person accepts it below.
          </p>
          <div className="mt-3 rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white/80" data-testid="bulk-v2-progress">
            {bulk.ok ? bulkProgressText(bulk.state) : <span className="text-red-300">The background queue could not be read: {bulk.error}</span>}
            {bulk.ok && bulk.state.lastNote ? (
              <span className="mt-1 block text-xs text-white/50">
                Last run{bulk.state.lastRunAt ? ` (${new Date(bulk.state.lastRunAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })})` : ""}: {bulk.state.lastNote}
              </span>
            ) : null}
          </div>
          {bulk.ok && bulkVendorStrip(bulk.state).length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5 text-[0.7rem]" data-testid="bulk-v2-vendors">
              {bulkVendorStrip(bulk.state).map((v) => (
                <li key={v.vendor} className="rounded-full border border-white/15 px-2 py-0.5 text-white/70">
                  {v.vendor}: {v.done} of {v.total} drafted{v.failed ? ` · ${v.failed} failed` : ""}
                </li>
              ))}
            </ul>
          )}
          {failedItems.length > 0 && (
            <details className="mt-2 text-xs text-amber-200" data-testid="bulk-v2-failures">
              <summary className="cursor-pointer">{failedItems.length} product{failedItems.length === 1 ? "" : "s"} failed - see why</summary>
              <ul className="mt-1 space-y-0.5 pl-4">
                {failedItems.slice(0, 50).map((i) => (
                  <li key={i.key}>
                    <Link href={`/admin/products/${encodeURIComponent(i.key)}`} className="underline">
                      {i.name}
                    </Link>
                    : {i.error ?? "no reason recorded"}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {counts && counts.queued > 0 && (
            <form action={cancelBulkAiV2Action} className="mt-2">
              <button type="submit" className={CHIP_NEUTRAL} data-testid="bulk-v2-cancel">
                Cancel the {counts.queued} waiting
              </button>
            </form>
          )}
          <form action={queueBulkAiV2Action} className="mt-4 space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-white/70">
                Every live product from one vendor
                <select name="vendor" defaultValue="" className="mt-1 block rounded-lg border border-white/15 bg-black px-2 py-1.5 text-sm text-white" data-testid="bulk-v2-vendor">
                  <option value="">(none - use the ticked products)</option>
                  {vendors.map((v) => (
                    <option key={v} value={v}>
                      {v} ({vendorCount.get(v) ?? 0})
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" variant="special" size="sm" data-testid="bulk-v2-draft">
                ✨ Draft with AI (all fields, background)
              </Button>
            </div>
            <details className="text-xs text-white/60">
              <summary className="cursor-pointer">Or tick products ({pickable.length} live products listed; up to {BULK_AI_V2_MAX_QUEUE} queue per press)</summary>
              <div className="mt-2 grid max-h-72 grid-cols-1 gap-1 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
                {pickable.map((g) => (
                  <label key={g.posKey} className="flex items-center gap-2 rounded border border-white/10 bg-black px-2 py-1 text-white/80">
                    <input type="checkbox" name="keys" value={g.posKey} className="h-3.5 w-3.5" />
                    <span className="truncate">
                      {g.name}
                      <span className="ml-1 text-white/40">· {vendorByKey.get(g.posKey) ?? "no vendor"}</span>
                    </span>
                  </label>
                ))}
              </div>
            </details>
          </form>
        </section>

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

        {/* D244 E-5: review grid v2 - all-fields drafts grouped by product */}
        <section id="review-v2" data-testid="bulk-v2-review">
          <h2 className="mb-2 text-sm font-bold text-white">
            All-fields drafts by product <span className="text-white/40">({groups.length} product{groups.length === 1 ? "" : "s"})</span>
          </h2>
          <form method="get" className="mb-3 flex flex-wrap items-end gap-2 text-xs text-white/70" data-testid="bulk-v2-filter">
            <label>
              Vendor
              <select name="vendor" defaultValue={vendorFilter} className="mt-1 block rounded-lg border border-white/15 bg-black px-2 py-1 text-sm text-white">
                <option value="">All vendors</option>
                {vendors.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Confidence at least
              <select name="min" defaultValue={String(minFilter)} className="mt-1 block rounded-lg border border-white/15 bg-black px-2 py-1 text-sm text-white">
                <option value="0">Any</option>
                <option value="50">50%</option>
                <option value="70">70%</option>
                <option value="80">80%</option>
                <option value="90">90%</option>
              </select>
            </label>
            <button type="submit" className={CHIP_NEUTRAL}>
              Filter
            </button>
          </form>
          {groups.length === 0 ? (
            <p className="text-sm text-white/50">No all-fields drafts match. Queue products above; drafts appear here as the worker finishes them.</p>
          ) : (
            <div className="space-y-4">
              {groups.map((g) => (
                <div key={g.key} id={`product-${encodeURIComponent(g.key)}`} className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4" data-testid="bulk-v2-group">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-white">
                      {nameByKey.get(g.key) ?? g.key}
                      <span className="ml-2 text-xs font-normal text-white/40">{g.vendor ?? "no vendor"}</span>
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {g.eligible > 0 ? (
                        <>
                          <form action={bulkAcceptAllForProductAction}>
                            <input type="hidden" name="key" value={g.key} />
                            <input type="hidden" name="vendor_filter" value={vendorFilter} />
                            <input type="hidden" name="min" value={String(minFilter)} />
                            <button type="submit" className={CHIP_ACTION} data-testid="bulk-v2-accept-all">
                              Accept all ≥ {ACCEPT_ALL_THRESHOLD}% ({g.eligible}{g.bestGuesses ? `, ${g.bestGuesses} best guess${g.bestGuesses === 1 ? "" : "es"} flagged` : ""})
                            </button>
                          </form>
                          <form action={bulkAcceptAllForProductAction}>
                            <input type="hidden" name="key" value={g.key} />
                            <input type="hidden" name="publish" value="1" />
                            <input type="hidden" name="vendor_filter" value={vendorFilter} />
                            <input type="hidden" name="min" value={String(minFilter)} />
                            <button type="submit" className={CHIP_ACTION} data-testid="bulk-v2-accept-publish" title="Publishes only a draft that has a photo">
                              Accept all ≥ {ACCEPT_ALL_THRESHOLD}% & publish
                            </button>
                          </form>
                        </>
                      ) : (
                        <span className="text-[0.7rem] text-white/40">Nothing at or above {ACCEPT_ALL_THRESHOLD}% - review on the product page.</span>
                      )}
                      <Link href={`/admin/products/${encodeURIComponent(g.key)}#ai`} className="self-center text-xs text-white/50 hover:text-white">
                        Open product ↗
                      </Link>
                    </div>
                  </div>
                  <ul className="mt-3 space-y-2">
                    {g.rows.map((r) => {
                      const ev = parseEvidenceSource(r.source);
                      const pct = Math.round((r.confidence ?? 0) * 100);
                      const shown =
                        r.field_key === SEO_FIELD_KEY
                          ? (seoSuggestionDisplay(r.suggested_value) ?? r.suggested_value)
                          : r.field_key === "sensory"
                            ? sensoryText(r.suggested_value) || r.suggested_value
                            : r.suggested_value;
                      const flags = checkCompliance(shown ?? "").flags;
                      return (
                        <li key={r.id} className="rounded-lg border border-white/10 bg-black p-2 text-sm">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-semibold text-white">{isDraftFieldKey(r.field_key) ? FIELD_LABEL[r.field_key] : r.field_key}</span>
                            <span className={`rounded px-1.5 py-0.5 font-semibold ${pct >= ACCEPT_ALL_THRESHOLD ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]" : pct >= 50 ? "bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]" : "bg-[var(--admin-orange-soft)] text-[var(--admin-orange)]"}`}>
                              {pct}%
                            </span>
                            {ev.bestGuess && (
                              <span className="rounded border border-amber-400/40 px-1.5 py-0.5 text-amber-200" data-testid="bulk-v2-best-guess">
                                best guess
                              </span>
                            )}
                            {flags.length > 0 && <span className="text-red-400">⚠ {flags.length} flag{flags.length > 1 ? "s" : ""}</span>}
                            {ev.evidence.map((id) => (
                              <span key={id} className="rounded-full border border-white/15 px-1.5 py-0.5 text-white/50">
                                {evidenceLabel(id)}
                              </span>
                            ))}
                          </div>
                          {/* D244 R-2: edit right here, then Save & accept (same compliance gate as Accept). */}
                          <form action={bulkAcceptEditedAction} className="mt-1" id={`draft-${r.id}`} data-testid="bulk-v2-edit-form">
                            <input type="hidden" name="id" value={r.id} />
                            <input type="hidden" name="key" value={g.key} />
                            <input type="hidden" name="vendor_filter" value={vendorFilter} />
                            <input type="hidden" name="min" value={String(minFilter)} />
                            <label className="sr-only" htmlFor={`edit-${r.id}`}>
                              Edit {isDraftFieldKey(r.field_key) ? FIELD_LABEL[r.field_key] : r.field_key}
                            </label>
                            <textarea
                              id={`edit-${r.id}`}
                              name="editedValue"
                              defaultValue={editText(r.field_key, r.suggested_value)}
                              rows={editKind(r.field_key) === "text" && String(r.suggested_value ?? "").length > 120 ? 3 : editKind(r.field_key) === "seo" ? 2 : 1}
                              className="w-full resize-y rounded border border-white/15 bg-white/5 px-2 py-1 text-sm text-white/85 focus:border-[var(--admin-accent)] focus:outline-none"
                              data-testid="bulk-v2-edit"
                            />
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <button type="submit" className={CHIP_ACTION} data-testid="bulk-v2-save-accept">
                                Save & accept
                              </button>
                              <button type="submit" formAction={bulkRejectDraftAction} className={CHIP_NEUTRAL} data-testid="bulk-v2-reject">
                                Reject
                              </button>
                              <span className="text-[0.65rem] text-white/40">{EDIT_HINT[editKind(r.field_key)]}</span>
                            </div>
                          </form>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* D244 R-1: accepted best guesses, flagged for a closer look */}
        <section id="closer-look" data-testid="bulk-closer-look">
          <h2 className="mb-1 text-sm font-bold text-white">
            Needs a closer look <span className="text-white/40">({closerLook ? closerLook.length : "?"})</span>
          </h2>
          <p className="mb-2 text-xs text-white/50">
            Best guesses are accepted automatically and go live, but they are flagged here until someone checks them. Open the product to
            change one, or press Looks right to clear the flag.
          </p>
          {closerLook === null ? (
            <p className="text-sm text-amber-200">The flagged list could not be read just now. Refresh to try again.</p>
          ) : closerLook.length === 0 ? (
            <p className="text-sm text-white/50">Nothing flagged. Every accepted best guess has been checked.</p>
          ) : (
            <ul className="space-y-2">
              {closerLook.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/30 bg-black p-2 text-xs" data-testid="bulk-closer-look-row">
                  <span className="font-semibold text-white">{nameByKey.get(r.entity_id) ?? r.entity_id}</span>
                  <span className="rounded bg-white/10 px-1.5 py-0.5 uppercase text-white/60">{isDraftFieldKey(r.field_key) ? FIELD_LABEL[r.field_key] : r.field_key}</span>
                  <span className="min-w-0 flex-1 truncate text-white/70">
                    {r.field_key === SEO_FIELD_KEY ? seoSuggestionDisplay(r.suggested_value) ?? r.suggested_value : r.field_key === "sensory" ? sensoryText(r.suggested_value) || r.suggested_value : r.suggested_value}
                  </span>
                  <Link href={`/admin/products/${encodeURIComponent(r.entity_id)}#closer-look`} className="text-white/60 hover:text-white">
                    Open product ↗
                  </Link>
                  <form action={markBestGuessCheckedAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="return" value="bulk" />
                    <button type="submit" className={CHIP_NEUTRAL} data-testid="bulk-closer-look-ok">
                      Looks right
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>

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
