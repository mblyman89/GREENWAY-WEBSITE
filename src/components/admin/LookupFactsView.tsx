/**
 * LookupFactsView -- SLICE S06. The read-only, field-by-field view of a
 * structured (v2) AI lookup, shared by the onboarding worksheet and the
 * enrichment look-up panel.
 *
 * For every field it shows: the value, the field's OWN confidence %, its band
 * (Auto >= 90 / Review 60-89 / Low < 60 / Unknown when the model gave no
 * number or no valid value), the source URLs the model declared for THAT
 * field, and any grounded citations whose cited text sits inside it. Nothing
 * here writes anything; it is display only. The existing keep/edit worksheet
 * rows stay the only way to save.
 *
 * GoogleSearchSuggestions renders Google's Search Suggestions HTML exactly as
 * returned (Google grounding terms: show it with the grounded result, to the
 * person who asked, and never store it). It lives in a sandboxed iframe with
 * NO allow-scripts and NO allow-same-origin, so the HTML cannot run script or
 * touch the admin page; links open in a new tab (allow-popups).
 *
 * No hooks -- renders on the server or the client alike.
 */
import {
  LOOKUP_FIELD_KEYS,
  LOOKUP_FIELD_LABELS,
  formatFactValue,
  type ConfidenceBand,
  type LookupFacts,
} from "@/lib/inventory/lookup-facts-core";
import { suggestionSrcDoc } from "@/lib/ai/grounding-core";

const BAND_LABEL: Record<ConfidenceBand, string> = {
  auto: "Auto",
  review: "Review",
  reject: "Low",
  unknown: "Unknown",
};

const BAND_CLASS: Record<ConfidenceBand, string> = {
  auto: "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]",
  review: "bg-[var(--admin-gold)]/15 text-[var(--admin-gold)]",
  reject: "bg-[var(--admin-danger)]/15 text-[var(--admin-danger)]",
  unknown: "bg-white/10 text-[var(--admin-text-faint)]",
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function LinkChips({ urls, prefix }: { urls: string[]; prefix: string }) {
  if (!urls.length) return null;
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1">
      {urls.map((u, i) => (
        <a
          key={`${prefix}-${i}`}
          href={u}
          target="_blank"
          rel="noopener noreferrer nofollow"
          title={u}
          className="rounded bg-white/5 px-1 text-[9px] underline hover:text-[var(--admin-accent)]"
        >
          {prefix}
          {hostOf(u)}
        </a>
      ))}
    </span>
  );
}

export function LookupFactsView({ facts }: { facts: LookupFacts }) {
  const c = facts.counts;
  return (
    <details className="rounded border border-[var(--admin-border)] bg-black/20 p-1.5" data-testid="lookup-facts">
      <summary className="cursor-pointer text-[10px] font-semibold text-[var(--admin-text-muted)]">
        Field-by-field evidence: {c.auto} auto · {c.review} review · {c.reject} low · {c.unknown} unknown
        {facts.overallConfidence !== null ? ` · overall ${facts.overallConfidence}%` : ""}
      </summary>
      <p className="mt-1 text-[9px] text-[var(--admin-text-faint)]">
        Each field is graded on its OWN confidence. Auto = 90%+. A field with no confidence of its own is
        Unknown and never auto-attaches. Display only: use the rows above to keep or edit.
      </p>
      <table className="mt-1 w-full text-[10px]">
        <tbody>
          {LOOKUP_FIELD_KEYS.map((k) => {
            const f = facts.fields[k];
            const shown = formatFactValue(k, f.value);
            return (
              <tr key={k} className="border-t border-white/5 align-top" data-field={k} data-band={f.band}>
                <td className="whitespace-nowrap py-0.5 pr-1 text-[var(--admin-text-muted)]">{LOOKUP_FIELD_LABELS[k]}</td>
                <td className="whitespace-nowrap py-0.5 pr-1">
                  <span className={`rounded px-1 text-[9px] font-bold ${BAND_CLASS[f.band]}`}>
                    {BAND_LABEL[f.band]}
                    {f.confidence !== null ? ` ${f.confidence}%` : ""}
                  </span>
                </td>
                <td className="py-0.5 text-[var(--admin-text)]">
                  {f.withheld === "compliance" ? (
                    <span className="text-[var(--admin-text-faint)]">Withheld (compliance)</span>
                  ) : shown ? (
                    <span className="break-words">{shown}</span>
                  ) : (
                    <span className="text-[var(--admin-text-faint)]">Not found</span>
                  )}
                  <LinkChips urls={f.sources} prefix="" />
                  <LinkChips urls={f.cited} prefix="cited: " />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {facts.recordCitations.length > 0 && (
        <div className="mt-1 text-[9px] text-[var(--admin-text-faint)]">
          Grounded citations (whole record):
          <LinkChips urls={facts.recordCitations} prefix="" />
        </div>
      )}
    </details>
  );
}

/** Google Search Suggestions, verbatim, sandboxed. Renders nothing when empty. */
export function GoogleSearchSuggestions({ html }: { html: string[] }) {
  if (!html.length) return null;
  return (
    <div className="space-y-1" data-testid="search-suggestions">
      {html.map((h, i) => (
        <iframe
          key={i}
          title="Google Search Suggestions"
          srcDoc={suggestionSrcDoc(h)}
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          className="h-16 w-full rounded border-0 bg-transparent"
        />
      ))}
    </div>
  );
}
