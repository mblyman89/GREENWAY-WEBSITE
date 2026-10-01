/**
 * FactsPanel -- SLICE S11 (onboarding row redesign, bible S11.2).
 *
 * "What is attached to this product, where did it come from, how sure are
 * we" -- inside the onboarding row, before Approve. Purely presentational:
 * every word comes from buildFactChips() / identityLine() in
 * fact-chips-core.ts (pure, self-tested). No hooks, so it renders on the
 * server with the rest of the row.
 *
 * Each chip shows the field, a short value and its source label
 * ("Manifest", "COA", "KB", "Gemini 94%", "You", "Remembered (...)"). The
 * WHY is a native <details> disclosure (a "toggletip"), not a title=""
 * hover: it opens by keyboard, touch and screen reader alike.
 * (http://inclusive-components.design/tooltips-toggletips)
 *
 * A chip that is shown but NOT counted (a name guess, a KB draft, a web
 * finding under 90%) is drawn dashed and says "not counted", so a guess is
 * never presented as a fact (rule 3.1). Missing fields are listed in red:
 * "Enrichment will ask for: ...".
 */
import type { FactChipsView, IdentityLine } from "@/lib/catalog/fact-chips-core";

export function FactsPanel({
  view,
  identity,
}: {
  view: FactChipsView;
  identity: IdentityLine;
}) {
  return (
    <section
      className="w-full max-w-[34rem] space-y-1.5 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-2 text-left text-xs"
      data-testid="facts-panel"
      aria-label="Facts attached to this product"
    >
      <p className="flex items-center justify-between gap-2 font-semibold text-[var(--admin-text)]">
        <span>What is attached</span>
        <span className="text-[var(--admin-text-muted)]" data-testid="facts-panel-count">
          {view.countLabel} facts
        </span>
      </p>
      {view.emptyLine ? (
        <p className="text-[var(--admin-text-muted)]" data-testid="facts-panel-empty">
          {view.emptyLine}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1" data-testid="facts-panel-chips">
          {view.chips.map((c) => (
            <li
              key={c.field}
              data-testid="fact-chip"
              data-field={c.field}
              data-counted={c.counted ? "true" : "false"}
              className={`rounded-[var(--admin-radius)] border px-1.5 py-0.5 ${
                c.counted
                  ? "border-[var(--admin-accent)]/40 bg-[var(--admin-surface)]"
                  : "border-dashed border-[var(--admin-border)] bg-[var(--admin-surface)] text-[var(--admin-text-muted)]"
              }`}
            >
              <details>
                <summary className="cursor-pointer list-none">
                  <span className="font-semibold text-[var(--admin-text)]">{c.fieldLabel}</span>
                  {c.value ? <span className="text-[var(--admin-text-muted)]">: {c.value}</span> : null}{" "}
                  <span
                    className={`rounded-full px-1.5 text-[10px] font-semibold ${
                      c.counted
                        ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]"
                        : "bg-[var(--admin-surface-2)] text-[var(--admin-text-faint)]"
                    }`}
                    data-testid="fact-chip-source"
                  >
                    {c.sourceLabel}
                  </span>
                  {!c.counted ? <span className="text-[10px] text-[var(--admin-text-faint)]"> · not counted</span> : null}
                  <span className="sr-only"> (show why)</span>
                </summary>
                <p className="mt-0.5 max-w-[30rem] text-[10px] leading-snug text-[var(--admin-text-muted)]" data-testid="fact-chip-why">
                  {c.why}
                  {c.also.length > 0 ? ` Also known from: ${c.also.join(", ")}.` : ""}
                </p>
              </details>
            </li>
          ))}
        </ul>
      )}
      {view.missingLine ? (
        <p className="font-semibold text-[var(--admin-danger)]" data-testid="facts-panel-missing">
          {view.missingLine}
        </p>
      ) : null}
      <p
        className={identity.ok ? "text-[10px] text-[var(--admin-text-faint)]" : "text-[10px] font-semibold text-[var(--admin-gold)]"}
        data-testid="facts-panel-identity"
      >
        {identity.text}
      </p>
      {view.modeNote ? (
        <p className="text-[10px] text-[var(--admin-text-faint)]" data-testid="facts-panel-mode">
          {view.modeNote}
        </p>
      ) : null}
    </section>
  );
}
