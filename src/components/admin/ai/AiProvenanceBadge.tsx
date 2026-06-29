/**
 * src/components/admin/ai/AiProvenanceBadge.tsx
 *
 * A tiny, brand-styled badge that tells the reviewer WHERE an AI draft's facts
 * came from and HOW grounded it was — the provenance seam that the crawler
 * (DF-6) and accept-rate reporting (DF-5) both feed into.
 *
 * `source` values follow the ai_suggestions.source convention:
 *   • "model"        — a tasteful starting draft from the model alone (verify!).
 *   • "kb" / "kb:N"  — grounded in the cannabis knowledge base (N sources).
 *   • "pos"          — straight from POS facts.
 *   • "crawl:<url>"  — researched + verified against a real web page.
 *
 * `confidence` is 0..1 (how grounded the output was). We render it as a percent
 * with a calm color ramp so low-confidence drafts visibly ask for a closer look.
 *
 * Server component (presentational).
 */

export type AiProvenance = {
  source?: string | null;
  confidence?: number | null;
};

/** Human label + tone for a raw source string. */
function describeSource(source: string | null | undefined): { label: string; tone: string } {
  const s = (source ?? "model").trim();
  if (s.startsWith("crawl:")) {
    let host = s.slice("crawl:".length);
    try {
      host = new URL(host.startsWith("http") ? host : `https://${host}`).hostname.replace(/^www\./, "");
    } catch {
      /* keep raw */
    }
    return { label: `Researched · ${host}`, tone: "border-sky-400/40 bg-sky-400/10 text-sky-200" };
  }
  if (s.startsWith("kb")) {
    const n = s.includes(":") ? s.split(":")[1] : "";
    return {
      label: n ? `Knowledge base · ${n} source${n === "1" ? "" : "s"}` : "Knowledge base",
      tone: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
    };
  }
  if (s === "pos") {
    return { label: "POS facts", tone: "border-amber-400/40 bg-amber-400/10 text-amber-200" };
  }
  return { label: "Model draft", tone: "border-white/15 bg-white/[0.04] text-white/55" };
}

/** Percent label + tone for a 0..1 confidence. */
function describeConfidence(confidence: number | null | undefined): { label: string; tone: string } | null {
  if (confidence == null || Number.isNaN(confidence)) return null;
  const pct = Math.round(Math.max(0, Math.min(1, confidence)) * 100);
  const tone =
    pct >= 75
      ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
      : pct >= 45
        ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
        : "border-red-400/40 bg-red-400/10 text-red-200";
  return { label: `${pct}% confident`, tone };
}

export function AiProvenanceBadge({ source, confidence }: AiProvenance) {
  const src = describeSource(source);
  const conf = describeConfidence(confidence);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${src.tone}`}>
        {src.label}
      </span>
      {conf ? (
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${conf.tone}`}>
          {conf.label}
        </span>
      ) : null}
    </div>
  );
}
