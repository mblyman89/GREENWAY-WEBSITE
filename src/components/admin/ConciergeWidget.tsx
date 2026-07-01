"use client";

/**
 * ConciergeWidget.tsx (E5)
 *
 * A global floating AI concierge, pinned bottom-right on every admin page. Click
 * the bubble to open a small chat panel; ask anything about the back office,
 * website, compliance, or the planned POS. Read-only / advisory.
 *
 * Keeps a short in-memory history so follow-up questions have context. Does not
 * persist across reloads (intentionally lightweight).
 */
import { useEffect, useRef, useState } from "react";
import { askConciergeAction } from "@/app/admin/concierge-actions";
import type { ConciergeTurn } from "@/lib/admin/concierge-assistant";

const SUGGESTIONS = [
  "How do I import my menu?",
  "Where are newsletter engagement stats?",
  "How does CCRS reporting work?",
  "Is the POS built yet?",
];

export function ConciergeWidget() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ConciergeTurn[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, open, pending]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || pending) return;
    setInput("");
    const nextTurns: ConciergeTurn[] = [...turns, { role: "user", content: q }];
    setTurns(nextTurns);
    setPending(true);
    const res = await askConciergeAction({ question: q, history: turns });
    setPending(false);
    setTurns((prev) => [
      ...prev,
      { role: "assistant", content: res.ok ? res.answer : res.error },
    ]);
  }

  return (
    <>
      {/* Launcher bubble */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Open AI assistant"
        title="Ask the AI assistant"
        className="fixed bottom-4 right-4 z-[95] flex h-12 w-12 items-center justify-center rounded-full border border-[#7ed957]/40 bg-[#0a0a0a] text-xl shadow-lg shadow-black/50 transition hover:bg-[#7ed957]/10"
      >
        <span aria-hidden>{open ? "✕" : "🤖"}</span>
      </button>

      {open ? (
        <div className="fixed bottom-20 right-4 z-[95] flex h-[30rem] w-[22rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0a] shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-white">Back-office assistant</p>
              <p className="text-[0.7rem] text-white/50">Answers about anything here · drafts/advice only</p>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {turns.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-white/60">
                  Hi! Ask me anything about the back office, website, compliance, or the POS.
                </p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void send(s)}
                      className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/70 transition hover:border-[#7ed957]/50 hover:text-white"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              turns.map((t, i) => (
                <div
                  key={i}
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    t.role === "user"
                      ? "ml-auto bg-[#7ed957]/15 text-white"
                      : "mr-auto whitespace-pre-wrap bg-white/5 text-white/85"
                  }`}
                >
                  {t.content}
                </div>
              ))
            )}
            {pending ? (
              <div className="mr-auto max-w-[85%] rounded-2xl bg-white/5 px-3 py-2 text-sm text-white/50">
                Thinking…
              </div>
            ) : null}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="flex items-center gap-2 border-t border-white/10 p-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question…"
              className="flex-1 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder-white/40 focus:border-[#7ed957]/50 focus:outline-none"
            />
            <button
              type="submit"
              disabled={pending || !input.trim()}
              className="rounded-lg bg-[#7ed957] px-3 py-2 text-sm font-semibold text-black transition disabled:opacity-40"
            >
              Send
            </button>
          </form>
        </div>
      ) : null}
    </>
  );
}
