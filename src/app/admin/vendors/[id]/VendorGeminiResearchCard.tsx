"use client";

/**
 * R49 S7 -- "🔍 Research with Google Gemini (step 1)" on the vendor page.
 *
 * Nothing runs until staff click Research (no surprise spend). The grounded
 * result is shown ONLY here, to the person who asked, together with Google's
 * Search Suggestions (sandboxed iframe, verbatim) and the citations -- and is
 * gone when the page reloads (nothing cached; Google grounding terms).
 *
 * Each profile field gets an editable box and its own "Save as draft" button.
 * Saving puts that ONE reviewed field into the normal drafts list below, where
 * it still needs Accept (with the I-502 compliance re-scan). The website and
 * reference facts are shown for a human to open and judge; there is
 * deliberately NO "send to crawler" button -- grounded links must not be used
 * to pick crawl targets. Step 2 (the crawler) uses the saved website field.
 */

import { useState, useTransition } from "react";
import { Button } from "@/components/admin/ui";
import { GoogleSearchSuggestions } from "@/components/admin/LookupFactsView";
import {
  vendorGeminiResearchAction,
  vendorGeminiSaveAction,
  type VendorGeminiResult,
} from "../gemini-actions";

type Ok = Extract<VendorGeminiResult, { ok: true }>;
type FieldKey = "mission_statement" | "about" | "product_philosophy" | "research_social";

const field =
  "w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]";

type Props = {
  vendorId: string;
  vendorName: string;
  /** False when no AI key is configured at all. */
  aiEnabled: boolean;
  /** True when AI_MODEL_HEAVY is a Gemini model (grounded Google Search). */
  geminiSelected: boolean;
  /** The model id in use (for honest provenance). */
  modelId: string;
};

export function VendorGeminiResearchCard({ vendorId, vendorName, aiEnabled, geminiSelected, modelId }: Props) {
  const [hint, setHint] = useState("");
  const [result, setResult] = useState<Ok | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [drafts, setDrafts] = useState<Record<FieldKey, string>>({
    mission_statement: "",
    about: "",
    product_philosophy: "",
    research_social: "",
  });
  const [original, setOriginal] = useState<Record<FieldKey, string>>(drafts);
  const [saveState, setSaveState] = useState<Partial<Record<FieldKey, { ok: boolean; msg: string }>>>({});
  const [savingField, setSavingField] = useState<FieldKey | null>(null);

  function run() {
    setError("");
    setSaveState({});
    start(async () => {
      const fd = new FormData();
      fd.set("id", vendorId);
      fd.set("hint", hint);
      const r = await vendorGeminiResearchAction(fd);
      if (!r.ok) {
        setResult(null);
        setError(r.error);
        return;
      }
      const next: Record<FieldKey, string> = {
        mission_statement: r.findings.mission,
        about: r.findings.about,
        product_philosophy: r.findings.philosophy,
        research_social: r.socialBody,
      };
      setDrafts(next);
      setOriginal(next);
      setResult(r);
    });
  }

  function save(key: FieldKey) {
    if (!result) return;
    setSavingField(key);
    start(async () => {
      const fd = new FormData();
      fd.set("id", vendorId);
      fd.set("field", key);
      fd.set("value", drafts[key]);
      fd.set("confidence", String(result.findings.confidence));
      fd.set("edited", drafts[key] !== original[key] ? "1" : "0");
      const r = await vendorGeminiSaveAction(fd);
      setSaveState((s) => ({ ...s, [key]: r.ok ? { ok: true, msg: r.message } : { ok: false, msg: r.error } }));
      setSavingField(null);
    });
  }

  const f = result?.findings;

  return (
    <div
      className="rounded-lg border border-[var(--admin-accent)]/30 bg-[var(--admin-accent)]/[0.05] p-4"
      data-testid="vendor-gemini-card"
    >
      <h3 className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[var(--admin-accent)]">
        <span>🔍 Research with Google Gemini (step 1)</span>
        {!aiEnabled || !geminiSelected ? (
          <span className="rounded-full border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--admin-gold)]">
            {!aiEnabled ? "Not set up" : "Gemini not selected"}
          </span>
        ) : null}
      </h3>
      <p className="mt-1 text-[11px] text-white/50">
        Searches Google for <strong>{vendorName}</strong> and shows what it finds &mdash; website, social profiles,
        mission, story and product philosophy &mdash; with the pages it used. <strong>Nothing is saved</strong>{" "}
        unless you click <em>Save as draft</em> on a field; drafts still need <em>Accept</em> below. Results disappear
        when you leave the page. Then use step 2 (the crawler) on the website you&rsquo;ve checked and saved in the
        profile.
      </p>

      {!aiEnabled ? (
        <p className="mt-2 rounded-lg border border-[var(--admin-gold)]/20 bg-[var(--admin-gold)]/5 px-3 py-2 text-[11px] text-[var(--admin-gold)]">
          Set <code className="rounded bg-black/40 px-1">AI_MODEL_HEAVY</code> to a Gemini model (for example{" "}
          <code className="rounded bg-black/40 px-1">gemini-2.5-flash</code>) and{" "}
          <code className="rounded bg-black/40 px-1">AI_GEMINI_API_KEY</code> in Vercel, then redeploy.
        </p>
      ) : (
        <>
          {!geminiSelected && (
            <p className="mt-2 rounded-lg border border-[var(--admin-gold)]/20 bg-[var(--admin-gold)]/5 px-3 py-2 text-[11px] text-[var(--admin-gold)]">
              The web-search model is <code className="rounded bg-black/40 px-1">{modelId}</code>, not Gemini, so this
              runs on that provider&rsquo;s web search instead of Google. For Google Search grounding set{" "}
              <code className="rounded bg-black/40 px-1">AI_MODEL_HEAVY</code> to a{" "}
              <code className="rounded bg-black/40 px-1">gemini-…</code> model and{" "}
              <code className="rounded bg-black/40 px-1">AI_GEMINI_API_KEY</code>.
            </p>
          )}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !pending) {
                  e.preventDefault();
                  run();
                }
              }}
              placeholder="Optional hint (e.g. Spokane, makes pre-rolls)"
              aria-label="Optional research hint"
              maxLength={300}
              className={`${field} flex-1`}
            />
            <Button type="button" variant="special" className="shrink-0" onClick={run} disabled={pending}>
              {pending && !savingField ? "Searching… (can take a minute or two)" : "🔍 Research"}
            </Button>
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </p>
      )}

      {result && f && (
        <div className="mt-4 space-y-4" data-testid="vendor-gemini-results">
          <p className="text-[11px] text-white/45">
            Model <code className="rounded bg-black/40 px-1">{result.model}</code> ·{" "}
            {result.usedWebSearch ? (result.usedGemini ? "Google Search grounding" : "live web search") : "no live search (built-in knowledge only — treat with extra care)"}{" "}
            · overall confidence {f.confidence}%
          </p>

          {!f.found && (
            <p className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/70">
              Nothing reliable was found for this vendor. Try a hint (city, a product line, or their legal name).
            </p>
          )}

          {(f.website || f.licenseNumber || f.location || f.founded || f.productTypes.length > 0 || f.notes) && (
            <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[140px_1fr]">
              {f.website && (
                <>
                  <dt className="text-white/50">Website found</dt>
                  <dd className="min-w-0 break-all">
                    <a href={f.website} target="_blank" rel="noopener noreferrer" className="text-[var(--admin-accent)] underline">
                      {f.website}
                    </a>
                    <span className="block text-[10px] text-white/40">
                      Open it and check it&rsquo;s really theirs. If so, type it into the Website field in the profile
                      below and save &mdash; step 2 uses that saved website.
                    </span>
                  </dd>
                </>
              )}
              {f.licenseNumber && (
                <>
                  <dt className="text-white/50">Licence #</dt>
                  <dd>{f.licenseNumber}</dd>
                </>
              )}
              {f.location && (
                <>
                  <dt className="text-white/50">Location</dt>
                  <dd>{f.location}</dd>
                </>
              )}
              {f.founded && (
                <>
                  <dt className="text-white/50">Founded</dt>
                  <dd>{f.founded}</dd>
                </>
              )}
              {f.productTypes.length > 0 && (
                <>
                  <dt className="text-white/50">Makes</dt>
                  <dd>{f.productTypes.join(", ")}</dd>
                </>
              )}
              {f.notes && (
                <>
                  <dt className="text-white/50">Double-check</dt>
                  <dd className="text-[var(--admin-gold)]">{f.notes}</dd>
                </>
              )}
            </dl>
          )}

          {(
            [
              ["mission_statement", "Mission statement", 3],
              ["about", "About", 5],
              ["product_philosophy", "Product philosophy", 3],
              ["research_social", "Social profiles (one per line)", 4],
            ] as Array<[FieldKey, string, number]>
          )
            .filter(([k]) => original[k])
            .map(([k, label, rows]) => (
              <div key={k} className="space-y-1" data-testid={`gemini-field-${k}`}>
                <label className="block text-xs font-medium text-white/60" htmlFor={`gemini-${k}`}>
                  {label}
                </label>
                <textarea
                  id={`gemini-${k}`}
                  rows={rows}
                  value={drafts[k]}
                  onChange={(e) => setDrafts((d) => ({ ...d, [k]: e.target.value }))}
                  className={`${field} font-[inherit]`}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="save"
                    size="sm"
                    disabled={pending || !drafts[k].trim() || saveState[k]?.ok === true}
                    onClick={() => save(k)}
                  >
                    {savingField === k ? "Saving…" : saveState[k]?.ok ? "✓ Saved as draft" : "Save as draft"}
                  </Button>
                  {saveState[k] && (
                    <span className={`text-[11px] ${saveState[k]!.ok ? "text-emerald-300" : "text-red-300"}`}>{saveState[k]!.msg}</span>
                  )}
                </div>
              </div>
            ))}

          {result.citations.length > 0 || result.sources.length > 0 ? (
            <details className="rounded-lg border border-white/10 bg-black/30 p-3 text-xs" open>
              <summary className="cursor-pointer font-semibold text-white/70">
                Pages Google used ({result.citations.length || result.sources.length})
              </summary>
              <ul className="mt-2 space-y-1">
                {(result.citations.length
                  ? result.citations
                  : result.sources.map((url) => ({ url, title: undefined as string | undefined, citedText: undefined as string | undefined }))
                ).map((c, i) => (
                  <li key={`${c.url}-${i}`} className="min-w-0 break-all">
                    <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-[var(--admin-accent)] underline">
                      {c.title || c.url}
                    </a>
                    {c.citedText && <span className="block text-[11px] text-white/45">&ldquo;{c.citedText}&rdquo;</span>}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <GoogleSearchSuggestions html={result.searchSuggestions} />
        </div>
      )}
    </div>
  );
}
