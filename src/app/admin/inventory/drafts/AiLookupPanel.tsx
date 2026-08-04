"use client";

/**
 * AiLookupPanel \u2014 the manual, Google-style AI product/strain lookup on the
 * Product Onboarding table (T-314).
 *
 * A text box (pre-filled with the product name + vendor) and a Search button.
 * NOTHING runs until the operator clicks it \u2014 never auto-run. On a confident
 * result (>= 90%) it autofills the row's strain-type <select> (by id) and marks
 * it "AI-filled, review." Otherwise it shows an honest "couldn't find anything
 * reliable" message. Never guesses.
 *
 * When the AI finds worthwhile detail it offers a "Save to KB?" draft \u2014 a draft
 * for the owner to approve so future lots auto-attach the info. The panel calls
 * the two server actions (lookup + save-draft) and stays advisory: it edits only
 * the strain-type field the operator would set anyway, and only on his click.
 *
 * Soft-disables when no AI key is configured.
 */
import { useState, useTransition } from "react";
import { Button, Input } from "@/components/admin/ui";
import {
  productLookupAction,
  saveLookupToKbAction,
  type ProductLookupActionResult,
} from "./ai-lookup-actions";

type Props = {
  draftId: string;
  /** Row context used to prefill the search box + power the save-draft. */
  productName: string;
  vendorOrBrand: string;
  /** DOM id of the row's strain-type <select>, so we can autofill it. */
  strainSelectId: string;
  /** POS product key (or "") \u2014 lets Save-to-KB stage enrichment drafts. */
  posProductKey: string;
  /** False when no AI key is set \u2014 the panel soft-disables. */
  aiEnabled: boolean;
};

export function AiLookupPanel({
  draftId,
  productName,
  vendorOrBrand,
  strainSelectId,
  posProductKey,
  aiEnabled,
}: Props) {
  const initialQuery = [productName, vendorOrBrand].filter(Boolean).join(" ").trim();
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Extract<ProductLookupActionResult, { ok: true }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<null | "saved" | "saving-error">(null);
  const [pending, startTransition] = useTransition();
  const [savePending, startSaveTransition] = useTransition();

  // Runs the lookup. Called from the Search button's onClick and the input's
  // Enter key. It is deliberately NOT wired to a <form onSubmit>: this panel
  // renders INSIDE the row's `approve` <form>, and nested <form>s are invalid
  // HTML — the browser drops the inner one, so a submit here would post the
  // OUTER approve form (a full-page reload) instead of running this action.
  // Using a plain button + programmatic call keeps everything in-place.
  function run(e?: { preventDefault?: () => void }) {
    e?.preventDefault?.();
    if (!query.trim()) return;
    setError(null);
    setData(null);
    setSaved(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("draft_id", draftId);
      fd.set("query", query.trim());
      fd.set("product_name", productName);
      fd.set("vendor_or_brand", vendorOrBrand);
      fd.set("pos_product_key", posProductKey);
      const res = await productLookupAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setData(res);
      // Autofill the strain-type <select> when >= 90% confident.
      if (res.autofillStrainType && res.strainType && res.strainType !== "unknown") {
        const el = document.getElementById(strainSelectId) as HTMLSelectElement | null;
        if (el) {
          const match = Array.from(el.options).find((o) => o.value === res.strainType);
          if (match) el.value = res.strainType;
        }
      }
    });
  }

  function saveToKb() {
    if (!data) return;
    setSaved(null);
    startSaveTransition(async () => {
      const fd = new FormData();
      fd.set("draft_id", draftId);
      fd.set("payload", JSON.stringify(data.draft));
      const res = await saveLookupToKbAction(fd);
      setSaved(res.ok ? "saved" : "saving-error");
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 inline-flex items-center gap-1 rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-2 py-1 text-[11px] font-semibold text-[var(--admin-accent)] hover:bg-[var(--admin-accent)]/15"
        aria-label="Open AI lookup"
      >
        <span aria-hidden>🔍</span> AI Lookup
      </button>
    );
  }

  return (
    <div className="mt-1 w-72 rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="flex items-center gap-1 text-[11px] font-bold text-[var(--admin-accent)]">
          <span aria-hidden>🤖</span> AI Lookup
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11px] text-[var(--admin-text-faint)] hover:text-[var(--admin-text)]"
          aria-label="Close AI lookup"
        >
          ✕
        </button>
      </div>

      {!aiEnabled ? (
        <p className="text-[11px] text-[var(--admin-gold)]">
          Turns on once an <code className="font-mono">AI_API_KEY</code> (or{" "}
          <code className="font-mono">OPENAI_API_KEY</code>) is set.
        </p>
      ) : (
        <>
          {/* Google-style box + button. Nothing runs until the button is clicked
              (or Enter is pressed). This is a plain <div>, NOT a <form>: the
              panel lives inside the row's approve <form>, and nested <form>s are
              invalid HTML, so a real submit here would reload the whole page and
              never call the lookup action. */}
          <div className="flex items-center gap-1">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  run();
                }
              }}
              placeholder="Strain or product + brand…"
              className="h-8 w-full text-[11px]"
              aria-label="AI lookup search terms"
            />
            <Button
              type="button"
              onClick={() => run()}
              variant="special"
              size="sm"
              disabled={pending || !query.trim()}
            >
              {pending ? "…" : "Search"}
            </Button>
          </div>

          {error && <p className="mt-1.5 text-[11px] text-[var(--admin-danger)]">{error}</p>}

          {data && (
            <div className="mt-2 space-y-1.5 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-black/30 p-2 text-[11px]">
              {!data.found ? (
                <p className="text-[var(--admin-gold)]">{data.honestMiss}</p>
              ) : (
                <>
                  {data.strainType !== "unknown" && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[var(--admin-text)] capitalize">
                        {data.strainType.replace("-", " ")}
                      </span>
                      <span
                        className={
                          data.autofillStrainType
                            ? "rounded bg-[var(--admin-accent-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--admin-accent)]"
                            : "rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-[var(--admin-text-muted)]"
                        }
                      >
                        {data.strainTypeConfidence}%{data.autofillStrainType ? " · AI-filled, review" : ""}
                      </span>
                    </div>
                  )}
                  {data.summary && <p className="text-[var(--admin-text-muted)]">{data.summary}</p>}
                  {data.effects.length > 0 && (
                    <p className="text-[var(--admin-text-faint)]">
                      Vibe: {data.effects.join(", ")}
                    </p>
                  )}
                  {(data.aromaNotes.length > 0 || data.flavorNotes.length > 0) && (
                    <p className="text-[var(--admin-text-faint)]">
                      {[
                        data.aromaNotes.length ? `Aroma: ${data.aromaNotes.join(", ")}` : "",
                        data.flavorNotes.length ? `Flavor: ${data.flavorNotes.join(", ")}` : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}

                  {/* T-315: product facts (works for non-flower too). */}
                  {(data.category || data.potencyRatio || data.size) && (
                    <p className="text-[var(--admin-text-faint)]">
                      {[
                        data.category ? `Type: ${data.category}` : "",
                        data.potencyRatio ? `Ratio: ${data.potencyRatio}` : "",
                        data.size ? `Size: ${data.size}` : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                  {data.description && (
                    <p className="text-[var(--admin-text-muted)]">{data.description}</p>
                  )}

                  {/* T-315: reviewable image candidates \u2014 staged for enrichment,
                      NEVER auto-imported. Thumbnails link out to the source. */}
                  {data.imageCandidates.length > 0 && (
                    <div className="text-[10px] text-[var(--admin-text-faint)]">
                      <div className="mb-1">
                        {data.imageCandidates.length} image candidate
                        {data.imageCandidates.length === 1 ? "" : "s"} \u2014 review on the enrichment page
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {data.imageCandidates.slice(0, 4).map((u, i) => (
                          <a
                            key={i}
                            href={u}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            title={u}
                            className="block h-10 w-10 overflow-hidden rounded border border-[var(--admin-border)] bg-black/40"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={u} alt="" className="h-full w-full object-cover" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {data.sources.length > 0 && (
                    <div className="text-[10px] text-[var(--admin-text-faint)]">
                      Sources:{" "}
                      {data.sources.slice(0, 4).map((s, i) => (
                        <a
                          key={i}
                          href={s}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="underline hover:text-[var(--admin-accent)]"
                        >
                          [{i + 1}]
                        </a>
                      ))}
                    </div>
                  )}
                  <div className="text-[10px] text-[var(--admin-text-faint)]">
                    {data.usedWebSearch ? "Live web search" : "AI knowledge"} · {data.model}
                  </div>

                  {/* Save-to-KB / enrichment draft: everything is a DRAFT the
                      owner approves. Fires for strain KB and/or enrichment copy
                      + image candidates. Nothing publishes or imports on its own. */}
                  {(data.hasKbDraft || data.hasEnrichmentDraft) && (
                    <div className="mt-1 border-t border-[var(--admin-border)] pt-1.5">
                      {saved === "saved" ? (
                        <p className="text-[var(--admin-accent)]">
                          \u2713 Saved as draft{data.hasEnrichmentDraft ? " \u2014 details + images are waiting on the enrichment page" : ""}. Nothing publishes until you approve it.
                        </p>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[var(--admin-text-muted)]">
                            {data.hasEnrichmentDraft
                              ? "Stage details + images for enrichment?"
                              : "Found more \u2014 save to the KB?"}
                          </span>
                          <Button
                            type="button"
                            variant="save"
                            size="sm"
                            onClick={saveToKb}
                            disabled={savePending}
                          >
                            {savePending ? "Saving…" : "Save to KB?"}
                          </Button>
                        </div>
                      )}
                      {saved === "saving-error" && (
                        <p className="mt-1 text-[var(--admin-danger)]">
                          Could not save the draft. Try again.
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
