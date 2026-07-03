/**
 * /admin/knowledge-base/review
 *
 * The KB write-back REVIEW INBOX — the Silver→Gold governance gate (Slice 6).
 *
 * Validated product enrichment and accepted AI suggestions are promoted into
 * kb_products as DRAFTS (Bronze/Silver) by the write-back service. Here the
 * owner validates each staged record into the KB (publish → Gold, active) or
 * archives it. Drafts-only rule: nothing is authoritative until a human
 * publishes it here.
 *
 * Each card surfaces the record's QUALITY SCORE (completeness tempered by
 * provenance) and WHERE THE DATA CAME FROM (source + confidence) so the
 * publish/archive decision is informed — the human-in-the-loop survivorship
 * step of MDM. Reads degrade to an empty queue pre-migration (0071).
 */
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui/Button";
import { listKbProducts, countKbProductDrafts } from "@/lib/ai/kb/store";
import { scoreProduct, labelForField } from "@/lib/ai/kb/quality";
import { QualityBadge } from "../QualityBadge";
import { KbFlash } from "../KbFlash";
import { reviewKbProductAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function KbReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  await requirePermission("products.enrich");
  const { msg, error } = await searchParams;

  const [drafts, draftCount] = await Promise.all([
    listKbProducts("draft", 200),
    countKbProductDrafts(),
  ]);

  return (
    <div>
      <AdminPageHeader
        title="Review inbox"
        subtitle="Validate staged product data into the KB. Publish to make it a trusted golden record, or archive to discard."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Knowledge Base", href: "/admin/knowledge-base" },
              { label: "Data pipeline", href: "/admin/knowledge-base/pipeline" },
              { label: "Review inbox" },
            ]}
          />
        }
      />

      <div className="px-5 py-6 sm:px-8 space-y-5">
        <KbFlash msg={msg} error={error} />

        <p className="text-sm text-[var(--admin-text-muted)]">
          {draftCount} record{draftCount === 1 ? "" : "s"} awaiting review. Nothing
          here is authoritative until you publish it (drafts-only rule).
        </p>

        {drafts.length === 0 ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-dashed border-[var(--admin-border)] bg-[var(--admin-surface)] p-8 text-center text-sm text-[var(--admin-text-faint)]">
            Nothing to review. When you publish a product enrichment or accept an AI
            suggestion, the validated data is promoted here as a draft for a final
            check before it joins the KB brain.
            <div className="mt-2 text-xs">
              (If you just applied migration 0071, generate or accept a suggestion to
              see records appear.)
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            {drafts.map((row) => {
              const score = scoreProduct(row as unknown as Record<string, unknown>);
              return (
                <div
                  key={row.id}
                  className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4 sm:p-5"
                  style={{ boxShadow: "var(--admin-shadow-sm)" }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-[1.05rem] text-[var(--admin-text)]">
                          {row.display_name}
                        </strong>
                        <QualityBadge
                          quality={score.quality}
                          grade={score.grade}
                          completeness={score.completeness}
                        />
                      </div>
                      <div className="mt-0.5 text-[0.85rem] text-[var(--admin-text-faint)]">
                        {row.brand_slug} &middot; {row.product_slug}
                        {row.variant_label ? ` \u00b7 ${row.variant_label}` : ""}
                        {row.category ? ` \u00b7 ${row.category}` : ""}
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <form action={reviewKbProductAction}>
                        <input type="hidden" name="id" value={row.id} />
                        <input type="hidden" name="decision" value="publish" />
                        <Button variant="confirm" size="sm" type="submit">
                          Publish
                        </Button>
                      </form>
                      <form action={reviewKbProductAction}>
                        <input type="hidden" name="id" value={row.id} />
                        <input type="hidden" name="decision" value="archive" />
                        <Button variant="danger" size="sm" type="submit">
                          Archive
                        </Button>
                      </form>
                    </div>
                  </div>

                  {/* Provenance — where this data came from (survivorship signal) */}
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="rounded-full border border-[var(--admin-border)] bg-[var(--admin-bg)] px-2 py-0.5 text-[var(--admin-text-muted)]">
                      Source: {row.source ? row.source : "unknown"}
                    </span>
                    {typeof row.confidence === "number" ? (
                      <span className="rounded-full border border-[var(--admin-border)] bg-[var(--admin-bg)] px-2 py-0.5 text-[var(--admin-text-muted)]">
                        Confidence: {Math.round(row.confidence * 100)}%
                      </span>
                    ) : null}
                    <span className="rounded-full border border-[var(--admin-border)] bg-[var(--admin-bg)] px-2 py-0.5 text-[var(--admin-text-muted)]">
                      Updated {new Date(row.updated_at).toLocaleDateString()}
                    </span>
                  </div>

                  {row.description ? (
                    <p className="mt-3 text-sm text-[var(--admin-text)]">{row.description}</p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[0.9rem] text-[var(--admin-text)]">
                    {row.aroma_notes.length ? (
                      <span><b>Aroma:</b> {row.aroma_notes.join(", ")}</span>
                    ) : null}
                    {row.flavor_notes.length ? (
                      <span><b>Flavor:</b> {row.flavor_notes.join(", ")}</span>
                    ) : null}
                    {row.terpenes.length ? (
                      <span><b>Terpenes:</b> {row.terpenes.join(", ")}</span>
                    ) : null}
                    {row.effects.length ? (
                      <span><b>Effects:</b> {row.effects.join(", ")}</span>
                    ) : null}
                    {row.image_media_ids.length ? (
                      <span><b>Images:</b> {row.image_media_ids.length}</span>
                    ) : null}
                  </div>

                  {/* What's still thin — guides the survivorship decision */}
                  {score.missing.length > 0 ? (
                    <div className="mt-3 text-[11px] text-[var(--admin-text-faint)]">
                      Still missing:{" "}
                      {score.missing.map((k) => labelForField(k)).join(", ")}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
