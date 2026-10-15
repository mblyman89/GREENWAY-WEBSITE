/**
 * OnboardingImagesPanel -- Round 51 (items 2-5).
 *
 * "Photos for this product" inside the onboarding row: library images from
 * Content -> Media (published AND unpublished drafts) ranked by
 * image-recommend-core.ts (remembered > already on record > name match),
 * each with its confidence ("97% · High"), honest badges and an Attach
 * button. Below: "Import from the web" for a photo URL the AI lookup (or a
 * person) found. Every Attach is remembered (0279 product_image_memory), so
 * the next delivery of the same product recommends it first.
 *
 * Same pattern as WaitingFactsPanel: no hooks, server-rendered, each action a
 * plain <form> posting to a server action (progressive enhancement -
 * https://nextjs.org/docs/app/guides/forms). The form carries only WHICH
 * image; the server re-reads the asset and the draft.
 */
import type { ImageRecommendView } from "@/lib/catalog/image-recommend-core";
import { confidenceText } from "@/lib/catalog/image-recommend-core";

export const IMAGES_HEADING = "Photos for this product";
export const IMAGES_HELP =
  "Suggested from Content \u2192 Media (published and unpublished). The percentage is how sure we are it is this product. Attach adds it to the product's gallery and remembers it for next time.";

const BTN =
  "rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/50 bg-[var(--admin-accent-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--admin-accent)] hover:bg-[var(--admin-accent)]/20";
const BADGE = "rounded-full px-1.5 text-[10px] font-semibold";

export function OnboardingImagesPanel({
  draftId,
  productName,
  view,
  attachAction,
  importAction,
  returnManifest,
  returnStatus,
  libraryFailed = false,
  memoryMissing = false,
}: {
  draftId: string;
  productName: string;
  view: ImageRecommendView;
  attachAction: (formData: FormData) => Promise<void>;
  importAction: (formData: FormData) => Promise<void>;
  returnManifest: string | null;
  returnStatus: string;
  /** The media library read failed (never shown as "no images"). */
  libraryFailed?: boolean;
  /** Migration 0279 not applied: attach works, memory is not kept yet. */
  memoryMissing?: boolean;
}) {
  const hidden = (
    <>
      <input type="hidden" name="draft_id" value={draftId} />
      <input type="hidden" name="return_manifest" value={returnManifest ?? ""} />
      <input type="hidden" name="return_status" value={returnStatus} />
    </>
  );
  return (
    <section
      className="w-full space-y-1.5 rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-surface-2)] p-2 text-left text-xs"
      data-testid="onboarding-images"
      aria-label={IMAGES_HEADING}
    >
      <p className="flex items-center justify-between gap-2 font-semibold text-[var(--admin-text)]">
        <span>{IMAGES_HEADING}</span>
        <span className="text-[var(--admin-text-muted)]" data-testid="onboarding-images-count">
          {view.items.length}
          {view.matched > view.items.length ? ` of ${view.matched}` : ""}
        </span>
      </p>
      <p className="text-[10px] leading-snug text-[var(--admin-text-faint)]">{IMAGES_HELP}</p>
      {libraryFailed ? (
        <p className="text-[var(--admin-gold)]" data-testid="onboarding-images-read-failed">
          Could not read the media library just now. Reload the page to try again.
        </p>
      ) : null}
      {memoryMissing ? (
        <p className="text-[10px] text-[var(--admin-gold)]" data-testid="onboarding-images-memory-missing">
          Photo memory is not switched on yet (database migration 0279). Attaching still works; it just won&apos;t be remembered.
        </p>
      ) : null}
      {view.emptyText && !libraryFailed ? (
        <p className="text-[var(--admin-text-muted)]" data-testid="onboarding-images-empty">
          {view.emptyText}
        </p>
      ) : null}
      {view.items.length > 0 ? (
        <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-4" data-testid="onboarding-images-list">
          {view.items.map((r) => (
            <li
              key={r.id}
              data-testid="onboarding-image"
              data-confidence={r.confidence}
              className="flex flex-col gap-1 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-1"
            >
              {r.url ? (
                // Library thumbnails come from Supabase storage / any host; a
                // plain <img> avoids next/image remotePatterns for admin-only use.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.url} alt={r.alt || r.label} loading="lazy" className="aspect-square w-full rounded object-cover" />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center rounded bg-[var(--admin-surface-2)] text-[10px] text-[var(--admin-text-faint)]">
                  No preview
                </div>
              )}
              <p className="truncate text-[11px] text-[var(--admin-text)]" title={r.label}>
                {r.label}
              </p>
              <p className="flex flex-wrap gap-1">
                <span
                  className={`${BADGE} ${
                    r.band === "high"
                      ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]"
                      : r.band === "medium"
                        ? "bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]"
                        : "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)]"
                  }`}
                  data-testid="onboarding-image-confidence"
                >
                  {confidenceText(r)}
                </span>
                {r.remembered ? <span className={`${BADGE} bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]`}>Remembered</span> : null}
                {r.onRecord && !r.remembered ? <span className={`${BADGE} bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)]`}>On record</span> : null}
                {r.draft ? <span className={`${BADGE} bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)]`}>Unpublished</span> : null}
                {r.rightsPending ? <span className={`${BADGE} bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]`}>Rights pending</span> : null}
              </p>
              {r.reasons.length > 0 ? (
                <details>
                  <summary className="cursor-pointer text-[10px] text-[var(--admin-text-muted)]">Why?</summary>
                  <ul className="mt-0.5 list-disc pl-3 text-[10px] leading-snug text-[var(--admin-text-muted)]" data-testid="onboarding-image-why">
                    {r.reasons.map((why) => (
                      <li key={why}>{why}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {r.attached ? (
                <p className="text-[10px] font-semibold text-[var(--admin-accent)]" data-testid="onboarding-image-attached">
                  On this product
                </p>
              ) : (
                <form action={attachAction}>
                  {hidden}
                  <input type="hidden" name="media_id" value={r.id} />
                  <input type="hidden" name="source" value={r.remembered ? "memory" : "library"} />
                  <button type="submit" className={`${BTN} w-full`} data-testid="onboarding-image-attach" aria-label={`Attach ${r.label} (${confidenceText(r)})`}>
                    Attach
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <form action={importAction} className="flex flex-wrap items-end gap-1.5" data-testid="onboarding-image-import">
        {hidden}
        <input type="hidden" name="label" value={productName.slice(0, 200)} />
        <label className="flex min-w-[14rem] flex-1 flex-col gap-0.5">
          <span className="text-[10px] font-semibold text-[var(--admin-text-muted)]">Import a photo from the web (paste the image link)</span>
          <input
            name="image_url"
            type="url"
            required
            placeholder="https://brand-site.com/product-photo.jpg"
            className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1 text-xs text-[var(--admin-text)]"
            data-testid="onboarding-image-import-url"
          />
        </label>
        <button type="submit" className={BTN} data-testid="onboarding-image-import-button">
          Import &amp; attach
        </button>
      </form>
      <p className="text-[10px] text-[var(--admin-text-faint)]">
        Imported photos land in Content → Media as unpublished with rights pending, so a person confirms the brand allows it before they go public.
      </p>
    </section>
  );
}
