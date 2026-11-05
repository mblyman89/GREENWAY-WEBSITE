"use client";

/**
 * PartnerChat (D184, round slice S7). Ask Greenway Partner about the live
 * data. The answer may cite fix ids; only ids the server confirms exist are
 * shown, and they point at the fix cards on the page (the buttons there are
 * the only way anything changes).
 */
import { useState } from "react";
import { askPartnerAction } from "@/app/admin/partner/actions";
import type { PartnerTurn } from "@/lib/ai/partner-core";

const SUGGESTIONS = [
  "What needs fixing today, in order?",
  "Is everything we sold this week going to CCRS?",
  "Why is a lot short, and what is the safe fix?",
  "What taxes do I owe and when?",
];

export function PartnerChat() {
  const [turns, setTurns] = useState<PartnerTurn[]>([]);
  const [cited, setCited] = useState<{ id: string; title: string }[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);

  async function send(question: string) {
    const q = question.trim();
    if (!q || pending) return;
    setInput("");
    const history = turns;
    setTurns([...history, { role: "user", content: q }]);
    setPending(true);
    try {
      const res = await askPartnerAction({ question: q, history });
      setTurns((prev) => [...prev, { role: "assistant", content: res.ok ? res.answer : res.error }]);
      setCited(res.ok ? res.cited.map((p) => ({ id: p.id, title: p.title })) : []);
    } catch {
      setTurns((prev) => [...prev, { role: "assistant", content: "The partner could not answer just now. Try again." }]);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3" data-testid="partner-chat">
      <div className="space-y-2">
        {turns.map((t, i) => (
          <div
            key={i}
            className={`whitespace-pre-wrap rounded-[var(--admin-radius)] px-3 py-2 text-sm ${
              t.role === "user" ? "ml-8 bg-[var(--admin-surface-2)]" : "mr-8 border border-[var(--admin-border)]"
            }`}
          >
            {t.content}
          </div>
        ))}
        {pending ? <div className="mr-8 rounded-[var(--admin-radius)] border border-[var(--admin-border)] px-3 py-2 text-sm text-[var(--admin-text-muted)]">Reading the live data…</div> : null}
      </div>
      {cited.length ? (
        <div className="text-sm">
          Fixes it pointed to:{" "}
          {cited.map((c) => (
            <a key={c.id} href={`#${c.id}`} className="mr-2 underline">
              {c.id} {c.title}
            </a>
          ))}
        </div>
      ) : null}
      {turns.length === 0 ? (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={pending}
              onClick={() => void send(s)}
              className="rounded-full border border-[var(--admin-border)] px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about sales, drawers, CCRS, lots or taxes…"
          className="min-w-0 flex-1 rounded-lg border border-[var(--admin-border)] px-3 py-2 text-sm"
          maxLength={1200}
          data-testid="partner-input"
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          aria-busy={pending}
          className="rounded-lg bg-[var(--admin-accent)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="partner-ask"
        >
          {pending ? "Thinking…" : "Ask"}
        </button>
      </form>
    </div>
  );
}
