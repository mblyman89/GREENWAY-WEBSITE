"use client";

/**
 * AskAnalystPanel — free-text "Ask the analyst" Q&A over the persisted CCRS
 * benchmark rollups (Task I, I7). Shared by the CCRS Benchmarks page
 * (surface="statewide") and the Local Benchmarks report (surface="local").
 *
 * Type any question ("who's winning Port Orchard on flower?", "which brands
 * command a premium?", "who should I be buying from?") and the server builds
 * a grounded digest from the SAME persisted rollups the page renders, then
 * returns a structured answer: a direct headline, numbered points, the exact
 * figures the answer rests on (grounding trail), honest caveats, and
 * follow-up questions the data can actually answer.
 *
 * Read-only / advisory. Powered by the "heavy" model tier (router-controlled).
 * Soft-disables when no AI key is configured.
 */
import { useState, useTransition } from "react";
import { Button } from "@/components/admin/ui";
import {
  askStatewideAnalystAction,
  askLocalAnalystAction,
} from "./analyst-actions";
import type { AnalystAnswer, AnalystAnswerResult } from "@/lib/discovery/benchmarks-ai-core";

type Props = {
  datasetId: string;
  aiEnabled: boolean;
  surface: "statewide" | "local";
  /** Example questions shown as one-click chips (surface-appropriate). */
  examples?: string[];
};

const DEFAULT_EXAMPLES: Record<Props["surface"], string[]> = {
  statewide: [
    "Which inventory types have the highest median retail prices this month?",
    "Which brands command a price premium, and how big is it?",
    "How did retail prices and volume move month over month?",
  ],
  local: [
    "Who is winning Port Orchard this month and why?",
    "Where do my competitors' price bands sit compared to each other?",
    "Which suppliers serve multiple local competitors — who should I call first?",
  ],
};

function BulletList({ title, items, accent }: { title: string; items: string[]; accent?: boolean }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <div
        className={`text-xs font-semibold uppercase tracking-wide ${
          accent ? "text-[var(--admin-accent)]" : "text-[var(--admin-text-faint)]"
        }`}
      >
        {title}
      </div>
      <ul className="mt-1.5 space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2 text-sm text-[var(--admin-text-muted)]">
            <span
              className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                accent ? "bg-[var(--admin-accent)]" : "bg-white/40"
              }`}
            />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AskAnalystPanel({ datasetId, aiEnabled, surface, examples }: Props) {
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [answer, setAnswer] = useState<AnalystAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const chips = examples ?? DEFAULT_EXAMPLES[surface];

  function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed || pending) return;
    setAnswer(null);
    setError(null);
    setAsked(trimmed);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("dataset_id", datasetId);
      fd.set("question", trimmed);
      const action = surface === "statewide" ? askStatewideAnalystAction : askLocalAnalystAction;
      const res: AnalystAnswerResult = await action(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setAnswer(res.answer);
    });
  }

  return (
    <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] p-5">
      <div className="max-w-3xl">
        <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--admin-accent)]">
          <span aria-hidden>🤖</span> Ask the analyst
        </h2>
        <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
          Ask anything about {surface === "local" ? "your local competitors" : "the statewide market"} in
          plain English. The analyst reads the same persisted rollups shown on this page — every
          figure in the answer is cited from real data, and it says plainly when the data can&apos;t
          answer. Advisory only — nothing is changed.
        </p>
      </div>

      {!aiEnabled ? (
        <p className="mt-3 text-xs text-[var(--admin-gold)]">
          The analyst turns on once an <code className="font-mono">AI_API_KEY</code> (or{" "}
          <code className="font-mono">OPENAI_API_KEY</code>) is set. The benchmarks work without it.
        </p>
      ) : (
        <>
          <form
            className="mt-4 flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              ask(question);
            }}
          >
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={
                surface === "local"
                  ? "e.g. Who's winning Port Orchard on flower, and at what prices?"
                  : "e.g. Which types and brands are commanding premiums this month?"
              }
              maxLength={500}
              className="admin-focus flex-1 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm text-[var(--admin-text)] placeholder:text-[var(--admin-text-faint)]"
            />
            <Button
              type="submit"
              disabled={pending || question.trim().length === 0}
              variant="special"
              size="sm"
            >
              {pending ? "Analyzing…" : "Ask"}
            </Button>
          </form>

          <div className="mt-2 flex flex-wrap gap-2">
            {chips.map((c) => (
              <button
                key={c}
                type="button"
                disabled={pending}
                onClick={() => {
                  setQuestion(c);
                  ask(c);
                }}
                className="rounded-full border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-1 text-xs text-[var(--admin-text-muted)] transition hover:border-[var(--admin-accent)]/50 hover:text-[var(--admin-text)] disabled:opacity-50"
              >
                {c}
              </button>
            ))}
          </div>

          {error ? <p className="mt-3 text-sm text-[var(--admin-danger)]">{error}</p> : null}

          {answer ? (
            <div className="mt-4 space-y-4 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-black/30 p-4">
              {asked ? (
                <p className="text-xs text-[var(--admin-text-faint)]">
                  Q: <span className="text-[var(--admin-text-muted)]">{asked}</span>
                </p>
              ) : null}
              <p className="text-sm font-medium text-[var(--admin-text)]">{answer.headline}</p>

              <BulletList title="Answer" items={answer.answer_points} accent />

              <div className="grid gap-4 md:grid-cols-2">
                <BulletList title="Grounded in" items={answer.key_facts} />
                <BulletList title="Caveats" items={answer.caveats} />
              </div>

              {answer.follow_ups.length > 0 ? (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                    Ask next
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {answer.follow_ups.map((f) => (
                      <button
                        key={f}
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          setQuestion(f);
                          ask(f);
                        }}
                        className="rounded-full border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-1 text-xs text-[var(--admin-text-muted)] transition hover:border-[var(--admin-accent)]/50 hover:text-[var(--admin-text)] disabled:opacity-50"
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <p className="text-[0.65rem] text-[var(--admin-text-faint)]">
                Generated by {answer.model} from this page&apos;s persisted CCRS rollups (one
                monthly drop — never extrapolated). Retail prices are what shoppers paid at other
                stores; wholesale is what stores paid vendors. Greenway&apos;s own sales are never
                in this data.
              </p>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
