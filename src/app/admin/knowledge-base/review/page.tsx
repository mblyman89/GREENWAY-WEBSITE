/**
 * /admin/knowledge-base/review
 *
 * The KB write-back REVIEW queue (Slice 6). Validated product enrichment and
 * accepted AI suggestions are promoted into kb_products as DRAFTS by the
 * write-back service. This page lets the owner validate each staged record into
 * the KB (publish → active) or archive it. Drafts-only rule: nothing is
 * authoritative until a human publishes it here.
 *
 * Reads degrade to an empty queue pre-migration (0071 not applied yet).
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Button } from "@/components/admin/ui/Button";
import { listKbProducts, countKbProductDrafts } from "@/lib/ai/kb/store";
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
        title="Review KB write-backs"
        subtitle="Validated product data is staged here as drafts. Publish to make it part of the KB brain, or archive to discard."
      />

      <div style={{ padding: "0 1.25rem 2rem" }}>
        <p style={{ marginBottom: "1rem" }}>
          <Link href="/admin/knowledge-base" style={{ color: "var(--admin-orange)" }}>
            ← Back to Knowledge Base
          </Link>
        </p>

        {msg ? (
          <div
            style={{
              background: "var(--admin-accent-soft)",
              borderRadius: "var(--admin-radius)",
              padding: "0.75rem 1rem",
              marginBottom: "1rem",
            }}
          >
            {msg}
          </div>
        ) : null}
        {error ? (
          <div
            style={{
              background: "var(--admin-danger-soft)",
              borderRadius: "var(--admin-radius)",
              padding: "0.75rem 1rem",
              marginBottom: "1rem",
            }}
          >
            {error}
          </div>
        ) : null}

        <p style={{ color: "var(--admin-text-faint)", marginBottom: "1rem" }}>
          {draftCount} record{draftCount === 1 ? "" : "s"} awaiting review.
        </p>

        {drafts.length === 0 ? (
          <div
            style={{
              border: "1px dashed var(--admin-border)",
              borderRadius: "var(--admin-radius)",
              padding: "2rem",
              textAlign: "center",
              color: "var(--admin-text-faint)",
            }}
          >
            Nothing to review. When you publish a product enrichment or accept an AI
            suggestion, the validated data is promoted here as a draft for a final
            check before it joins the KB brain.
            <br />
            <span style={{ fontSize: "0.85rem" }}>
              (If you just applied migration 0071, generate/accept a suggestion to
              see records appear.)
            </span>
          </div>
        ) : (
          <div style={{ display: "grid", gap: "1rem" }}>
            {drafts.map((row) => (
              <div
                key={row.id}
                style={{
                  border: "1px solid var(--admin-border)",
                  borderRadius: "var(--admin-radius)",
                  padding: "1rem 1.25rem",
                  boxShadow: "var(--admin-shadow-sm)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                  <div>
                    <strong style={{ fontSize: "1.05rem" }}>{row.display_name}</strong>
                    <div style={{ color: "var(--admin-text-faint)", fontSize: "0.85rem" }}>
                      {row.brand_slug} · {row.product_slug}
                      {row.variant_label ? ` · ${row.variant_label}` : ""}
                      {row.category ? ` · ${row.category}` : ""}
                      {typeof row.confidence === "number" ? ` · confidence ${Math.round(row.confidence * 100)}%` : ""}
                      {row.source ? ` · ${row.source}` : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                    <form action={reviewKbProductAction}>
                      <input type="hidden" name="id" value={row.id} />
                      <input type="hidden" name="decision" value="publish" />
                      <Button variant="confirm" type="submit">
                        Publish
                      </Button>
                    </form>
                    <form action={reviewKbProductAction}>
                      <input type="hidden" name="id" value={row.id} />
                      <input type="hidden" name="decision" value="archive" />
                      <Button variant="danger" type="submit">
                        Archive
                      </Button>
                    </form>
                  </div>
                </div>

                {row.description ? (
                  <p style={{ marginTop: "0.75rem" }}>{row.description}</p>
                ) : null}

                <div style={{ marginTop: "0.75rem", display: "flex", gap: "1.5rem", flexWrap: "wrap", fontSize: "0.9rem" }}>
                  {row.aroma_notes.length ? <span><b>Aroma:</b> {row.aroma_notes.join(", ")}</span> : null}
                  {row.flavor_notes.length ? <span><b>Flavor:</b> {row.flavor_notes.join(", ")}</span> : null}
                  {row.terpenes.length ? <span><b>Terpenes:</b> {row.terpenes.join(", ")}</span> : null}
                  {row.effects.length ? <span><b>Effects:</b> {row.effects.join(", ")}</span> : null}
                  {row.image_media_ids.length ? <span><b>Images:</b> {row.image_media_ids.length}</span> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
