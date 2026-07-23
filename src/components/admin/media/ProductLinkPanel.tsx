"use client";

/**
 * ProductLinkPanel — Slice H10d (product-image → product link, drafts-only).
 *
 * For PRODUCT images: one click asks the matcher for likely kb_products; the
 * candidates land as PENDING ai_suggestions drafts listed here with score +
 * reasons. NOTHING attaches until the owner clicks Accept (which runs the
 * existing H9c gallery merge server-side). Reject dismisses the draft.
 *
 * For LOGO images: a single "send to logo validation" button stamps the
 * needs-logo-review routing tag (idempotent) so the asset surfaces in the
 * validation lane via tag search.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/admin/ui";
import type { ProductLinkResult } from "@/app/admin/media/actions";

export type PendingLink = {
  suggestionId: string;
  productId: string;
  productName: string;
  brandSlug: string;
  score: number;
  reasons: string[];
};

export function ProductLinkPanel({
  mediaId,
  usageType,
  pending,
  hasLogoReviewTag,
  suggestLinks,
  acceptAction,
  rejectAction,
  routeLogoAction,
}: {
  mediaId: string;
  usageType: string | null;
  pending: PendingLink[];
  hasLogoReviewTag: boolean;
  suggestLinks: (id: string) => Promise<ProductLinkResult>;
  acceptAction: (formData: FormData) => void | Promise<void>;
  rejectAction: (formData: FormData) => void | Promise<void>;
  routeLogoAction: (formData: FormData) => void | Promise<void>;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  const u = (usageType ?? "").toLowerCase();
  const isProduct = u === "product";
  const isLogo = u === "logo" || u === "vendor-logo" || u === "brand-logo";
  if (!isProduct && !isLogo && pending.length === 0) return null;

  function runSuggest() {
    setNote(null);
    startTransition(async () => {
      const res = await suggestLinks(mediaId);
      setNote(res.ok ? res.note : res.error);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-white">
          {isLogo ? "Logo validation" : "Link to a product"}
        </p>
        {isProduct ? (
          <Button type="button" onClick={runSuggest} disabled={busy} variant="special" size="sm">
            {busy ? "Matching…" : "✨ Find matching products"}
          </Button>
        ) : null}
      </div>

      {isLogo ? (
        hasLogoReviewTag ? (
          <p className="mt-3 rounded-lg border border-[var(--admin-gold)]/25 bg-[var(--admin-gold)]/5 px-3 py-2 text-xs text-[var(--admin-gold)]">
            Flagged for logo validation — find it in the library by the{" "}
            <span className="font-mono">needs-logo-review</span> tag.
          </p>
        ) : (
          <form action={routeLogoAction} className="mt-3">
            <input type="hidden" name="id" value={mediaId} />
            <Button type="submit" variant="save" size="sm">
              Send to logo validation
            </Button>
          </form>
        )
      ) : null}

      {note ? (
        <p className="mt-3 rounded-lg border border-[var(--admin-accent)]/30 bg-[var(--admin-accent)]/10 px-3 py-2 text-xs text-[var(--admin-accent)]">{note}</p>
      ) : null}

      {pending.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {pending.map((p) => (
            <li key={p.suggestionId} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-white">{p.productName}</p>
                  <p className="text-[11px] text-white/50">
                    {p.brandSlug} · {Math.round(p.score * 100)}% match
                  </p>
                </div>
                <div className="flex gap-2">
                  <form action={acceptAction}>
                    <input type="hidden" name="suggestionId" value={p.suggestionId} />
                    <input type="hidden" name="mediaId" value={mediaId} />
                    <Button type="submit" variant="confirm" size="sm">
                      Accept & attach
                    </Button>
                  </form>
                  <form action={rejectAction}>
                    <input type="hidden" name="suggestionId" value={p.suggestionId} />
                    <input type="hidden" name="mediaId" value={mediaId} />
                    <Button type="submit" variant="neutral" size="sm">
                      Reject
                    </Button>
                  </form>
                </div>
              </div>
              {p.reasons.length > 0 ? (
                <ul className="mt-2 space-y-0.5 text-[11px] text-white/50">
                  {p.reasons.map((r, i) => (
                    <li key={i}>• {r}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : isProduct ? (
        <p className="mt-3 text-[11px] text-white/40">
          No pending link suggestions — click “Find matching products” to search the knowledge base.
          Nothing attaches until you accept a match.
        </p>
      ) : null}
    </div>
  );
}
