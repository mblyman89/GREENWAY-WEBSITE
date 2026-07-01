"use client";

/**
 * SageAssistantChat (Slice 56) — a grounded Sage 50 Quantum chat assistant.
 *
 * Answers come ONLY from the verified Sage 50 knowledge pack + the store's GL
 * mapping + aggregate summaries of uploaded reports (see sage-helper.ts). It is
 * advisory: it never posts to Sage. When AI isn't configured the composer is
 * disabled with a clear note.
 */
import { useState, useRef, useEffect, useTransition } from "react";
import { useToast } from "@/components/admin/ux";
import { askSageAssistantAction } from "@/app/admin/reports/accounting/sage-actions";
import type { SageChatMessage } from "@/lib/accounting/sage-helper";

type ChatMsg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "How do I import the daily General Journal CSV into Sage 50 Quantum?",
  "What's the amount sign convention for a General Journal import?",
  "Which General Journal fields are required?",
  "Can I use my .ptb backup file here?",
];

export function SageAssistantChat({
  aiEnabled,
  initialMessages,
}: {
  aiEnabled: boolean;
  initialMessages: SageChatMessage[];
}) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMsg[]>(
    initialMessages.map((m) => ({ role: m.role, content: m.content })),
  );
  const [input, setInput] = useState("");
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function send(question: string) {
    const q = question.trim();
    if (!q || pending) return;
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    setInput("");
    startTransition(async () => {
      const res = await askSageAssistantAction(q);
      if (res.ok) {
        setMessages((prev) => [...prev, { role: "assistant", content: res.answer }]);
      } else {
        toast({ tone: "error", message: res.error });
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `I couldn't answer that: ${res.error}` },
        ]);
      }
    });
  }

  return (
    <div className="flex flex-col rounded-xl border border-white/10 bg-white/[0.02]">
      <div className="max-h-[420px] min-h-[180px] space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="text-sm text-white/40">
            Ask me anything about Sage 50 Quantum — General Journal imports, field requirements, the daily CSV, or how
            to map your uploaded reports. I answer only from verified Sage documentation.
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  m.role === "user"
                    ? "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-[var(--admin-accent)] px-3 py-2 text-sm text-black"
                    : "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/85"
                }
              >
                {m.content}
              </div>
            </div>
          ))
        )}
        {pending ? (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/50">
              Thinking…
            </div>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      {messages.length === 0 ? (
        <div className="flex flex-wrap gap-2 border-t border-white/5 px-4 py-3">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={!aiEnabled || pending}
              onClick={() => send(s)}
              className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-white/60 hover:bg-white/[0.07] disabled:opacity-40"
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}

      <div className="border-t border-white/10 p-3">
        {aiEnabled ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-end gap-2"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={2}
              placeholder="Ask about Sage 50 Quantum…"
              className="flex-1 resize-none rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-[var(--admin-accent)] focus:outline-none"
              disabled={pending}
            />
            <button
              type="submit"
              disabled={pending || !input.trim()}
              className="rounded-lg bg-[var(--admin-accent)] px-4 py-2 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-40"
            >
              Send
            </button>
          </form>
        ) : (
          <p className="text-xs text-white/40">
            The Sage 50 assistant needs an AI API key configured to answer questions. The upload tools above still work.
          </p>
        )}
      </div>
    </div>
  );
}
