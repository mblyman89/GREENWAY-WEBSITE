"use client";

/**
 * PrinterDiagnosticChat (Slice 59) — a grounded receipt-printer setup &
 * diagnostic assistant.
 *
 * Answers come ONLY from the verified printer knowledge pack + a live, PII-free
 * snapshot of the printer state (see printer-assistant.ts / printer-diagnostics-core.ts).
 * It is advisory. When AI isn't configured the composer is disabled with a note.
 */
import { useState, useRef, useEffect, useTransition } from "react";
import { useToast } from "@/components/admin/ux";
import { askPrinterAssistantAction } from "@/app/admin/settings/receipt-printer/assistant-actions";

type ChatMsg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "The printer status never turns Online — what do I check?",
  "A test print is queued but nothing prints. Why?",
  "How do I set the Poll URL and token in the printer?",
  "Receipts print but the text is cut off on the right.",
  "New orders don't auto-print, but the test print works.",
];

export function PrinterDiagnosticChat({ aiEnabled }: { aiEnabled: boolean }) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
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
      const res = await askPrinterAssistantAction(q);
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
    <div className="flex flex-col rounded-xl border border-stone-200 bg-white">
      <div className="max-h-[420px] min-h-[160px] space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="text-sm text-stone-500">
            Describe what the printer is (or isn&apos;t) doing and I&apos;ll help diagnose it. I
            answer only from Greenway&apos;s verified printer setup and the live status of your
            printer — I never guess at settings that don&apos;t exist.
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  m.role === "user"
                    ? "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-stone-800 px-3 py-2 text-sm text-white"
                    : "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-800"
                }
              >
                {m.content}
              </div>
            </div>
          ))
        )}
        {pending ? (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-400">
              Thinking…
            </div>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      {messages.length === 0 ? (
        <div className="flex flex-wrap gap-2 border-t border-stone-100 px-4 py-3">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={!aiEnabled || pending}
              onClick={() => send(s)}
              className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs text-stone-600 hover:bg-stone-100 disabled:opacity-40"
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}

      <div className="border-t border-stone-200 p-3">
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
              placeholder="Describe the printer problem…"
              className="flex-1 resize-none rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none"
              disabled={pending}
            />
            <button
              type="submit"
              disabled={pending || !input.trim()}
              className="rounded-lg bg-stone-800 px-4 py-2 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-40"
            >
              Send
            </button>
          </form>
        ) : (
          <p className="text-xs text-stone-500">
            The diagnostic assistant needs an AI API key configured to answer questions. The setup
            guide and live diagnostics above still work without it.
          </p>
        )}
      </div>
    </div>
  );
}
