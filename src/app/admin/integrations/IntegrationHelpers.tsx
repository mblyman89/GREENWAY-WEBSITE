"use client";

/**
 * src/app/admin/integrations/IntegrationHelpers.tsx
 *
 * E13 client pieces for the Integrations page:
 *  - IntegrationGuidePanel: a collapsible "How to connect" panel for one
 *    integration, rendered inside each card from INTEGRATION_GUIDES.
 *  - IntegrationHelper: an "Ask about integrations" AI helper. Grounded,
 *    read-only, drafts-safe. Optionally focused on a single integration.
 *
 * Both are plain-language and non-technical by design.
 */
import { useActionState, useState } from "react";
import { askIntegrationAction, type AskIntegrationResult } from "./ai-actions";
import { INTEGRATION_GUIDES, type IntegrationGuide } from "@/lib/integrations/integration-guides";
import { Button, Field, Select, Textarea } from "@/components/admin/ui";

/** Collapsible step-by-step "How to connect" panel for one integration card. */
export function IntegrationGuidePanel({ guide }: { guide: IntegrationGuide }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3 border-t border-[var(--admin-border)] pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-left text-xs font-semibold text-[var(--admin-accent)] hover:underline"
      >
        <span>{open ? "Hide" : "Show"} step-by-step: How to connect</span>
        <span aria-hidden className="text-[var(--admin-text-faint)]">{open ? "▲" : "▼"}</span>
      </button>

      {open ? (
        <div className="mt-3 space-y-3">
          <ol className="list-decimal space-y-1.5 pl-5 text-xs text-[var(--admin-text-muted)]">
            {guide.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          {guide.notes?.length ? (
            <ul className="space-y-1 text-xs text-[var(--admin-text-faint)]">
              {guide.notes.map((note, i) => (
                <li key={i}>• {note}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** "Ask about integrations" AI helper. */
export function IntegrationHelper({ aiConfigured }: { aiConfigured: boolean }) {
  const [state, formAction, pending] = useActionState<AskIntegrationResult | null, FormData>(
    askIntegrationAction,
    null,
  );

  if (!aiConfigured) {
    return (
      <section className="rounded-[var(--admin-radius)] border border-[var(--admin-orange)]/30 bg-[var(--admin-orange-soft)] p-4 text-xs text-[var(--admin-orange)]">
        <div className="font-semibold">Integrations helper (AI)</div>
        <p className="mt-1">
          The AI helper needs an AI key. Set <code>AI_API_KEY</code> (or <code>OPENAI_API_KEY</code>)
          in your environment, then reload. Every step-by-step guide above still works without it.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      <div className="mb-1 flex items-center gap-2">
        <span aria-hidden>🤖</span>
        <h2 className="text-sm font-bold text-[var(--admin-text)]">Ask about integrations</h2>
      </div>
      <p className="mb-4 text-xs text-[var(--admin-text-muted)]">
        Stuck connecting Leafly, WeedMaps, FLUX, Sage 50, or moving off Cultivera? Ask in plain
        language and get step-by-step help grounded in this back office. It never changes anything.
      </p>

      <form action={formAction} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[16rem_1fr]">
          <Field label="Which integration?" htmlFor="integrationId">
            <Select id="integrationId" name="integrationId" defaultValue="">
              <option value="">Any / not sure</option>
              {INTEGRATION_GUIDES.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Your question" htmlFor="question">
            <Textarea
              id="question"
              name="question"
              rows={2}
              placeholder="e.g. Where do I get my Leafly menu key, and is it safe to push?"
              required
            />
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending} variant="primary" size="sm">
            {pending ? "Thinking…" : "Ask"}
          </Button>
          <span className="text-xs text-[var(--admin-text-faint)]">
            Answers are guidance only — nothing is sent to a third party.
          </span>
        </div>
      </form>

      {state && !state.ok ? (
        <div className="mt-4 rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/30 bg-[var(--admin-danger-soft)] px-3 py-2 text-xs text-[var(--admin-danger)]">
          {state.error}
        </div>
      ) : null}

      {state && state.ok ? (
        <div className="mt-4 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] p-4">
          <div className="whitespace-pre-wrap text-sm text-[var(--admin-text)]">{state.answer}</div>
          <div className="mt-2 text-[10px] uppercase tracking-wide text-[var(--admin-text-faint)]">
            {state.model} · guidance only
          </div>
        </div>
      ) : null}
    </section>
  );
}
