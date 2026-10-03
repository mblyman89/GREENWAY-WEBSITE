/**
 * WaitingFactsPanel -- Round 23 (items 2 + 6).
 *
 * "Facts waiting for you" inside the onboarding row's AI card: every fact
 * a lookup found (pending suggestions) or the shop already knows (S09
 * memory) for this product, each with its source, its score and an Attach
 * button. Every word comes from waiting-facts-core.ts (pure, self-tested).
 *
 * No hooks: it renders on the server. Each Attach is a plain <form> posting
 * to a server action, so it works before (and without) JavaScript - the
 * progressive-enhancement pattern Next.js server actions are built for
 * (https://nextjs.org/docs/app/guides/forms). The form carries only WHICH
 * fact (draft, field, origin, suggestion id); the server re-reads the value.
 *
 * The why is a native <details> disclosure (a toggletip), like FactsPanel.
 */
import type { WaitingFactsView } from "@/lib/catalog/waiting-facts-core";
import { WAITING_HEADING, WAITING_HELP } from "@/lib/catalog/waiting-facts-core";

export function WaitingFactsPanel({
  draftId,
  view,
  action,
  returnManifest,
  returnStatus,
  readFailed = false,
}: {
  draftId: string;
  view: WaitingFactsView;
  action: (formData: FormData) => Promise<void>;
  returnManifest: string | null;
  returnStatus: string;
  /** The page read of pending suggestions failed (never shown as "nothing waiting"). */
  readFailed?: boolean;
}) {
  return (
    <section
      className="w-full space-y-1.5 rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-surface-2)] p-2 text-left text-xs"
      data-testid="waiting-facts"
      aria-label={WAITING_HEADING}
    >
      <p className="flex items-center justify-between gap-2 font-semibold text-[var(--admin-text)]">
        <span>{WAITING_HEADING}</span>
        <span className="text-[var(--admin-text-muted)]" data-testid="waiting-facts-count">
          {view.facts.length}
        </span>
      </p>
      <p className="text-[10px] leading-snug text-[var(--admin-text-faint)]">{WAITING_HELP}</p>
      {readFailed ? (
        <p className="text-[var(--admin-gold)]" data-testid="waiting-facts-read-failed">
          Could not check for facts from the lookup just now. Reload the page to try again.
        </p>
      ) : null}
      {view.emptyLine && !readFailed ? (
        <p className="text-[var(--admin-text-muted)]" data-testid="waiting-facts-empty">
          {view.emptyLine}
        </p>
      ) : null}
      {view.facts.length > 0 ? (
        <ul className="space-y-1" data-testid="waiting-facts-list">
          {view.facts.map((f) => (
            <li
              key={f.key}
              data-testid="waiting-fact"
              data-field={f.field}
              data-origin={f.origin}
              className="flex items-start justify-between gap-2 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-1.5 py-1"
            >
              <details className="min-w-0 flex-1">
                <summary className="cursor-pointer list-none">
                  <span className="font-semibold text-[var(--admin-text)]">{f.fieldLabel}</span>
                  <span className="text-[var(--admin-text-muted)]">: {f.preview}</span>{" "}
                  <span
                    className="rounded-full bg-[var(--admin-accent-soft)] px-1.5 text-[10px] font-semibold text-[var(--admin-accent)]"
                    data-testid="waiting-fact-source"
                  >
                    {f.sourceLabel}
                  </span>
                  <span className="sr-only"> (show details)</span>
                </summary>
                {f.full ? (
                  <p className="mt-0.5 whitespace-pre-wrap text-[11px] text-[var(--admin-text-muted)]" data-testid="waiting-fact-full">
                    {f.full}
                  </p>
                ) : null}
                <p className="mt-0.5 text-[10px] leading-snug text-[var(--admin-text-muted)]" data-testid="waiting-fact-why">
                  {f.why}
                </p>
              </details>
              <form action={action} className="shrink-0">
                <input type="hidden" name="draft_id" value={draftId} />
                <input type="hidden" name="field" value={f.field} />
                <input type="hidden" name="origin" value={f.origin} />
                <input type="hidden" name="suggestion_id" value={f.suggestionId ?? ""} />
                <input type="hidden" name="return_manifest" value={returnManifest ?? ""} />
                <input type="hidden" name="return_status" value={returnStatus} />
                <button
                  type="submit"
                  className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/50 bg-[var(--admin-accent-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--admin-accent)] hover:bg-[var(--admin-accent)]/20"
                  data-testid="waiting-fact-attach"
                  aria-label={`Attach ${f.fieldLabel}: ${f.preview}`}
                >
                  Attach
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
