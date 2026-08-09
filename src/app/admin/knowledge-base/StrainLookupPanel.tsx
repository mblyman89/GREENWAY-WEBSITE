"use client";

/**
 * StrainLookupPanel — the Gemini strain look-up on the Strain Editor.
 *
 * ONE JOB (Michael): type a strain name → "Search with Gemini" → it finds what
 * it can and FILLS the Add/Edit strain form for review (via onFill). Nothing is
 * saved here; the operator reviews with the smart selectors and presses the
 * form's own Save. Nothing runs until the button is clicked (no surprise spend).
 *
 * It also renders the honest provenance the product look-up shows: whether the
 * live web search ran (vs built-in knowledge), the model id, a note if a
 * summary was dropped for compliance, and the real source links. Soft-disables
 * when no AI key is set.
 *
 * This is a sibling client component of StrainEditor in the same tree, so the
 * onFill function prop is a normal client→client callback (not a server
 * boundary). The parent maps the result into its controlled form state.
 */
import { useState, useTransition } from "react";
import { Button } from "@/components/admin/ui/Button";
import { strainLookupAction, type StrainLookupActionResult } from "./strain-lookup-actions";

type Ok = Extract<StrainLookupActionResult, { ok: true }>;

export function StrainLookupPanel({
  aiEnabled,
  initialName = "",
  onFill,
}: {
  aiEnabled: boolean;
  initialName?: string;
  /** Hand the found fields up to the Strain Editor to fill its form. */
  onFill: (result: Ok) => void;
}) {
  const [name, setName] = useState(initialName);
  const [data, setData] = useState<Ok | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(e?: { preventDefault?: () => void }) {
    e?.preventDefault?.();
    const q = name.trim();
    if (!q) {
      setError("Type a strain name to look up first.");
      return;
    }
    setError(null);
    setData(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("strain_name", q);
      const res = await strainLookupAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setData(res);
      onFill(res);
    });
  }

  const inputCls =
    "flex-1 min-w-[12rem] rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-sm text-[var(--admin-text)]";

  return (
    <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold,#b8860b)]/30 bg-[var(--admin-gold,#b8860b)]/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[var(--admin-text)]">
          Find a strain with Gemini {aiEnabled ? "" : "(AI not configured)"}
        </h3>
      </div>
      <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
        Type a strain name and let Gemini research it from the live web. What it finds fills the form
        below for your review — terpenes, aroma, flavor, lineage, type and a short factual summary.
        Nothing saves until you press <strong>Add strain</strong>. It never runs until you click, and
        it never guesses — blanks stay blank for you to fill (or use the type suggestions).
      </p>

      <form onSubmit={run} className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputCls}
          placeholder="e.g. Blue Dream"
          disabled={!aiEnabled || pending}
        />
        <Button type="submit" variant="primary" disabled={!aiEnabled || pending}>
          {pending ? "Searching…" : "Search with Gemini"}
        </Button>
      </form>

      {error && (
        <p className="mt-2 rounded-[var(--admin-radius)] border border-[var(--admin-orange,#b45309)]/40 bg-[var(--admin-orange-soft,rgba(180,83,9,0.12))] px-3 py-2 text-xs text-[var(--admin-text)]">
          {error}
        </p>
      )}

      {data && (
        <div className="mt-2 space-y-1 text-xs text-[var(--admin-text-muted)]">
          <p className="text-[var(--admin-text)]">
            {data.found
              ? "Filled the form below with what Gemini found — review and edit, then Add strain."
              : "Gemini didn't find anything reliable, so nothing was filled. Try a more specific name, or fill it in manually."}
          </p>
          <p>
            {data.usedWebSearch
              ? "✓ Used live web search"
              : "Used built-in knowledge (no live web results)"}{" "}
            · confidence {data.confidence}% · {data.model}
          </p>
          {data.rejectedSummary && (
            <p className="text-[var(--admin-orange,#b45309)]">
              A summary was dropped because it read as a medical/health claim (not allowed under WA
              rules). Everything else was kept.
            </p>
          )}
          {data.sources.length > 0 && (
            <div>
              <span className="font-semibold text-[var(--admin-text-muted)]">Sources Gemini read:</span>
              <ul className="mt-0.5 space-y-0.5">
                {data.sources.slice(0, 6).map((s, i) => (
                  <li key={i} className="truncate">
                    <a
                      href={s}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="underline hover:text-[var(--admin-accent)]"
                      title={s}
                    >
                      {s}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
