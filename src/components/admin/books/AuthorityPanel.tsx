/**
 * src/components/admin/books/AuthorityPanel.tsx   (slice books-07)
 *
 * THE SHARED AUTHORITY SURFACE. One place where quoted law is rendered, so that
 * every books screen shows a citation the same way and nobody has to invent the
 * styling again.
 *
 * Michael, recorded verbatim (standing rule 1):
 *   "I love that you bake in real rules and regulations... I want verbatim text
 *    with regard to policy regulation tax GAAP, all that plus more."
 *   "I learn best visually."
 *
 * WHY THIS FILE EXISTS
 * Before it, BankMatchExplainer.tsx carried its own private `Quote()` component
 * and Section280EExplainer.tsx had a third styling vocabulary. Three screens,
 * three answers to "what does a quotation look like?". That is how a codebase
 * ends up teaching the same thing three slightly different ways.
 *
 * THE ONE DESIGN RULE, and everything else follows from it:
 *
 *   SOMEONE ELSE'S WORDS MUST NEVER BE MISTAKEN FOR OURS.
 *
 * A verbatim quote is set in a bordered, tinted, italic block with the citation
 * attached to it. Our explanation of what it means for Greenway sits OUTSIDE
 * that block, in plain text, clearly labelled. If those two ever became
 * visually interchangeable, this application would be putting words in the
 * mouth of the Internal Revenue Code — which is a far worse failure than an
 * ugly page.
 *
 * WEIGHT IS SHOWN, NOT ASSUMED. Every authority carries a rank (binding law /
 * binding interpretation / persuasive only) that comes from the pure core.
 * Michael has to be able to tell a statute from an IRS memo BEFORE he relies on
 * one, so the distinction is on the badge, not buried in a footnote.
 *
 * This component holds NO knowledge of its own. Everything it renders is DATA
 * from books-guidance-core.ts, for the reason stated in Section280EExplainer:
 * "a diagram that drifts from the engine is worse than no diagram: it teaches
 * the wrong thing with confidence."
 */

import {
  findGuidanceAuthority,
  resolveAuthorities,
  weightOf,
  GUIDANCE_KIND_LABELS,
  AUDITING_STANDARD_DISCLAIMER,
  type GuidanceAuthority,
} from "@/lib/accounting/books-guidance-core";

// ---------------------------------------------------------------------------
// Presentation vocabulary, defined once. Colour carries meaning here:
// AMBER = someone else's words. Never used for our own commentary anywhere.
// ---------------------------------------------------------------------------

const WEIGHT_STYLE: Record<1 | 2 | 3, { badge: string; label: string }> = {
  3: { badge: "bg-rose-400/15 text-rose-200 ring-1 ring-rose-400/30", label: "Binding law" },
  2: { badge: "bg-amber-400/15 text-amber-200 ring-1 ring-amber-400/30", label: "Binding interpretation" },
  1: { badge: "bg-white/10 text-white/60 ring-1 ring-white/15", label: "Persuasive only" },
};

/**
 * A verbatim quotation. Styled so it can never be mistaken for our own words.
 *
 * This is the component that used to live privately inside BankMatchExplainer.
 * It is exported here so there is exactly one answer to what a quote looks
 * like across the whole application.
 */
export function Quote({ cite, children }: { cite: string; children: React.ReactNode }) {
  return (
    <figure className="my-3 border-l-4 border-amber-400/30 bg-amber-400/[0.10] py-2 pl-4 pr-3">
      <blockquote className="text-sm italic leading-relaxed text-white/80">{children}</blockquote>
      <figcaption className="mt-1 text-xs font-medium text-amber-300">— {cite}</figcaption>
    </figure>
  );
}

/**
 * ONE authority, fully rendered: what it says, how much weight it carries, what
 * it means for Greenway, and where to go and read it yourself.
 *
 * The "so what" is deliberately placed BELOW the quote and outside its border.
 * That is the visual grammar of the whole panel: inside the amber block is the
 * law, outside it is us.
 */
export function AuthorityCard({ authority }: { authority: GuidanceAuthority }) {
  const { rank, meaning } = weightOf(authority);
  const style = WEIGHT_STYLE[rank];

  return (
    <article className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <header className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style.badge}`}>
          {style.label}
        </span>
        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/40">
          {GUIDANCE_KIND_LABELS[authority.kind]}
        </span>
        <h4 className="text-sm font-semibold text-white">{authority.cite}</h4>
      </header>

      {/* What the weight badge actually means, in words. A badge nobody can
          decode is decoration; this is the sentence that makes it teach. */}
      <p className="mt-1 text-[11px] leading-relaxed text-white/35">{meaning}</p>

      <Quote cite={authority.cite}>{authority.quote}</Quote>

      {/* OUR words. Labelled, outside the amber block, visually distinct. */}
      <div className="mt-2 border-l-2 border-[var(--admin-accent)]/40 pl-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--admin-accent)]/80">
          What this means for you
        </p>
        <p className="mt-1 text-sm leading-relaxed text-white/70">{authority.soWhat}</p>
      </div>

      {authority.kind === "auditing_standard" ? (
        <p className="mt-3 rounded-lg bg-white/[0.03] p-2 text-[11px] leading-relaxed text-white/40">
          {AUDITING_STANDARD_DISCLAIMER}
        </p>
      ) : null}

      <p className="mt-3 text-[11px] text-white/30">Source: {authority.source}</p>
    </article>
  );
}

/**
 * A titled group of authorities, resolved from ids.
 *
 * MISSING IDS ARE SHOWN, NEVER SWALLOWED. If a citation id does not resolve,
 * this renders a visible marker rather than quietly displaying a shorter list —
 * the same discipline `citeGuidanceAuthorities` uses in the core. A citation
 * list that silently shrinks is how a document loses its support without
 * anybody noticing, and noticing is the entire point of this panel.
 */
export function AuthorityPanel({
  ids,
  title = "The authority behind this",
  intro,
}: {
  ids: readonly string[];
  title?: string;
  intro?: string;
}) {
  const { found, missing } = resolveAuthorities(ids);

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-bold text-white">{title}</h3>
        {intro ? <p className="mt-1 max-w-3xl text-sm text-white/50">{intro}</p> : null}
      </div>

      <div className="space-y-3">
        {found.map((a) => (
          <AuthorityCard key={a.id} authority={a} />
        ))}
      </div>

      {missing.length > 0 ? (
        <p className="rounded-lg border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/[0.06] p-3 text-xs text-white/70">
          {missing.length === 1 ? "A citation is" : `${missing.length} citations are`} missing from the
          authority library: {missing.join(", ")}. This is shown rather than hidden, because a citation
          that quietly disappears leaves a claim standing with nothing behind it.
        </p>
      ) : null}
    </section>
  );
}

/**
 * A single inline citation, for use mid-paragraph where a full card would be
 * too heavy. Falls back to a VISIBLE marker on an unknown id, for the same
 * reason as above.
 *
 * THIS RENDERS AN INLINE ELEMENT, AND THAT IS NOT A STYLE PREFERENCE.
 * It first returned a <Quote>, which is a <figure> -- a BLOCK element. Every
 * use of this component is mid-sentence inside a <p>, and a <figure> inside a
 * <p> is invalid HTML: the browser silently closes the paragraph early, so the
 * server's markup and the client's disagree and React throws a hydration
 * error. The page would have broken in the browser while typechecking and
 * building perfectly cleanly.
 *
 * The full verbatim text still gets read -- it is on the AuthorityCard in the
 * panel below, which is a block context where a <figure> is correct. Here we
 * show the citation and carry the quote in the title attribute, so hovering
 * gives the words without breaking the sentence they sit in.
 */
export function InlineAuthority({ id }: { id: string }) {
  const a = findGuidanceAuthority(id);
  if (!a) {
    return (
      <span className="rounded bg-[var(--admin-orange)]/15 px-1.5 py-0.5 text-xs text-[var(--admin-orange)]">
        [unknown authority: {id}]
      </span>
    );
  }
  return (
    <cite
      title={a.quote}
      className="not-italic font-medium text-amber-300/90 underline decoration-amber-300/30 underline-offset-2"
    >
      {a.cite}
    </cite>
  );
}
