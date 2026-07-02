"use client";

/**
 * StrategyAssistant.tsx (E1)
 *
 * The GPT-4o compliant-strategy assistant UI. Type a marketing goal, pick a
 * channel, and get a WA-compliant strategy DRAFT. Review it, edit the title,
 * then save it to the notebook. All drafts-only.
 *
 * THEME: dark admin tokens only (no light slate/white/emerald surfaces).
 */
import { useActionState, useState } from "react";
import { suggestStrategyAction, saveIdeaAction, type StrategyActionResult } from "@/app/admin/marketing/actions";
import { MARKETING_CHANNELS } from "@/lib/marketing/strategy-types";
import { Button, Field, Input, Select } from "@/components/admin/ui";

export function StrategyAssistant({ aiConfigured }: { aiConfigured: boolean }) {
  const [state, formAction, pending] = useActionState<StrategyActionResult | null, FormData>(
    suggestStrategyAction,
    null,
  );

  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");

  const strategy = state && state.ok ? state.strategy : null;

  async function handleSave() {
    if (!state || !state.ok) return;
    setSaving(true);
    setSaveErr(null);
    setSavedMsg(null);
    const fd = new FormData();
    fd.set("goal", state.goal);
    fd.set("channel", state.channel);
    fd.set("title", (title || state.strategy.title).trim());
    fd.set("ai_model", state.model);
    fd.set("compliance_flags", (state.warnings ?? []).join("\n"));
    fd.set("body", renderStrategyText(state.strategy));
    const res = await saveIdeaAction(fd);
    setSaving(false);
    if (res.ok) setSavedMsg("Saved to your idea notebook below.");
    else setSaveErr(res.error);
  }

  if (!aiConfigured) {
    return (
      <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-4 text-sm text-[var(--admin-gold)]">
        The AI strategy assistant needs an AI key. Set <code>AI_API_KEY</code> (or{" "}
        <code>OPENAI_API_KEY</code>) in your environment, then reload. Everything else on this page
        still works.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <form
        action={formAction}
        className="space-y-4 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5"
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_16rem]">
          <Field label="What do you want to achieve?" htmlFor="goal">
            <Input
              id="goal"
              name="goal"
              required
              placeholder="e.g. Grow our newsletter list with in-store sign-ups"
              defaultValue={state && state.ok ? state.goal : ""}
            />
          </Field>
          <Field label="Channel focus" htmlFor="channel">
            <Select id="channel" name="channel" defaultValue={state && state.ok ? state.channel : "general"}>
              {MARKETING_CHANNELS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Thinking…" : "Draft a compliant strategy"}
          </Button>
          <span className="text-xs text-[var(--admin-text-muted)]">
            Drafts only — nothing is published or sent. Every plan is scanned against Washington
            advertising rules before it appears.
          </span>
        </div>
      </form>

      {state && !state.ok ? (
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] p-4 text-sm text-[var(--admin-danger)]">
          <p className="font-medium">{state.error}</p>
          {state.blockingFlags.length > 0 ? (
            <ul className="mt-2 list-disc pl-5">
              {state.blockingFlags.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {strategy ? (
        <div className="space-y-5 rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] p-5">
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-lg font-semibold text-[var(--admin-text)]">{strategy.title}</h3>
              <span className="text-xs text-[var(--admin-text-faint)]">via {state && state.ok ? state.model : ""}</span>
            </div>
            {strategy.summary ? <p className="mt-1 text-sm text-[var(--admin-text-muted)]">{strategy.summary}</p> : null}
          </div>

          {strategy.steps.length > 0 ? (
            <Block title="Action plan">
              <ol className="list-decimal space-y-1 pl-5 text-sm text-[var(--admin-text)]">
                {strategy.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </Block>
          ) : null}

          {strategy.angles.length > 0 ? (
            <Block title="Compliant message angles (starting points)">
              <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--admin-text)]">
                {strategy.angles.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </Block>
          ) : null}

          {strategy.measure.length > 0 ? (
            <Block title="How you'll know it worked">
              <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--admin-text)]">
                {strategy.measure.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </Block>
          ) : null}

          {strategy.complianceNotes.length > 0 ? (
            <Block title="Compliance reminders">
              <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--admin-text-muted)]">
                {strategy.complianceNotes.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </Block>
          ) : null}

          {state && state.ok && state.warnings.length > 0 ? (
            <div className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-3 text-xs text-[var(--admin-gold)]">
              Heads-up (non-blocking): {state.warnings.join("; ")}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3 border-t border-[var(--admin-accent)]/20 pt-4">
            <Input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={strategy.title}
              className="w-64"
              aria-label="Idea title"
            />
            <Button type="button" variant="save" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save to idea notebook"}
            </Button>
            {savedMsg ? <span className="text-sm text-[var(--admin-accent)]">{savedMsg}</span> : null}
            {saveErr ? <span className="text-sm text-[var(--admin-danger)]">{saveErr}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">{title}</h4>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

/** Flatten a strategy into a readable plain-text body for the saved idea. */
function renderStrategyText(s: {
  summary: string;
  steps: string[];
  angles: string[];
  measure: string[];
  complianceNotes: string[];
}): string {
  const parts: string[] = [];
  if (s.summary) parts.push(s.summary);
  if (s.steps.length) parts.push("Action plan:\n" + s.steps.map((x, i) => `${i + 1}. ${x}`).join("\n"));
  if (s.angles.length) parts.push("Message angles:\n" + s.angles.map((x) => `- ${x}`).join("\n"));
  if (s.measure.length) parts.push("Measure:\n" + s.measure.map((x) => `- ${x}`).join("\n"));
  if (s.complianceNotes.length)
    parts.push("Compliance reminders:\n" + s.complianceNotes.map((x) => `- ${x}`).join("\n"));
  return parts.join("\n\n");
}
