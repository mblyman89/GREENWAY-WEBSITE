"use client";

/**
 * AuditAnomalyPanel (Slice 62) — a grounded audit-log security review.
 *
 * Renders the DETERMINISTIC anomaly findings (computed server-side by
 * audit-anomaly-core over the recent window) color-coded by severity, plus an
 * optional grounded AI analyst chat. The AI is fed ONLY the already-computed
 * findings (no raw rows) and is forbidden from inventing events — see
 * buildAnomalySystemPrompt in audit-anomaly-core.ts. Advisory / drafts-only.
 *
 * Matches the Activity Log page's dark theme (black surfaces, white/opacity
 * text, #7ed957 accent) rather than the stone theme used elsewhere.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { useToast } from "@/components/admin/ux";
import { askAuditAssistantAction } from "@/app/admin/audit/anomaly-actions";

export type PanelAnomaly = {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  evidenceCount: number;
  actor?: string | null;
  category?: string;
};

export type AnomalyPanelReport = {
  windowCount: number;
  actorCount: number;
  sensitiveCount: number;
  counts: { critical: number; warning: number; info: number };
  anomalies: PanelAnomaly[];
};

type ChatMsg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Summarize the biggest risks in the recent activity and what I should verify first.",
  "Was there any unusual after-hours activity?",
  "Did anyone change roles, permissions, or integration credentials?",
  "Were there any repeated failed attempts I should worry about?",
  "Is there anything here that looks like a mistake versus intentional?",
];

const SEVERITY_STYLE: Record<
  PanelAnomaly["severity"],
  { chip: string; card: string; label: string; icon: string }
> = {
  critical: {
    chip: "border-red-500/40 bg-red-500/15 text-red-300",
    card: "border-red-500/30 bg-red-500/[0.06]",
    label: "Critical",
    icon: "🚨",
  },
  warning: {
    chip: "border-amber-400/40 bg-amber-400/15 text-amber-200",
    card: "border-amber-400/25 bg-amber-400/[0.05]",
    label: "Warning",
    icon: "⚠️",
  },
  info: {
    chip: "border-sky-400/40 bg-sky-400/15 text-sky-200",
    card: "border-sky-400/25 bg-sky-400/[0.05]",
    label: "Notice",
    icon: "ℹ️",
  },
};

function StatPill({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#0a0a0a] px-3 py-2">
      <div className="text-lg font-bold text-white">{value}</div>
      <div className="text-[10px] uppercase tracking-[0.12em] text-white/40">{label}</div>
    </div>
  );
}

export function AuditAnomalyPanel({
  report,
  aiEnabled,
}: {
  report: AnomalyPanelReport;
  aiEnabled: boolean;
}) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
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
      const res = await askAuditAssistantAction(q);
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

  const { anomalies, counts } = report;

  return (
    <div className="mb-8 rounded-xl border border-white/10 bg-[#0a0a0a]">
      {/* Header + summary */}
      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <h2 className="text-sm font-bold text-white">Security review</h2>
          <p className="text-xs text-white/45">
            Automatic checks over the {report.windowCount} most recent entries.
          </p>
        </div>
        <div className="ml-auto grid grid-flow-col gap-2">
          <StatPill label="Entries" value={report.windowCount} />
          <StatPill label="People" value={report.actorCount} />
          <StatPill label="Sensitive" value={report.sensitiveCount} />
        </div>
      </div>

      {/* Deterministic findings */}
      <div className="px-4 py-4">
        {anomalies.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg border border-[#7ed957]/25 bg-[#7ed957]/[0.06] px-4 py-3 text-sm text-white/80">
            <span className="text-lg">✅</span>
            <span>
              No anomalies were detected in the recent window. Nothing looks out of the ordinary —
              but you can still ask the analyst below if something specific concerns you.
            </span>
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-white/45">Found:</span>
              {counts.critical > 0 && (
                <span className={`rounded-full border px-2 py-0.5 font-medium ${SEVERITY_STYLE.critical.chip}`}>
                  {counts.critical} critical
                </span>
              )}
              {counts.warning > 0 && (
                <span className={`rounded-full border px-2 py-0.5 font-medium ${SEVERITY_STYLE.warning.chip}`}>
                  {counts.warning} warning
                </span>
              )}
              {counts.info > 0 && (
                <span className={`rounded-full border px-2 py-0.5 font-medium ${SEVERITY_STYLE.info.chip}`}>
                  {counts.info} notice
                </span>
              )}
            </div>
            <ul className="space-y-2">
              {anomalies.map((a) => {
                const s = SEVERITY_STYLE[a.severity];
                return (
                  <li key={a.id} className={`rounded-lg border px-3 py-2.5 ${s.card}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm">{s.icon}</span>
                      <span className="text-sm font-semibold text-white">{a.title}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${s.chip}`}>
                        {s.label}
                      </span>
                      {a.category && (
                        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/45">
                          {a.category}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-white/65">{a.detail}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-white/35">
                      {a.actor && <span>Who: {a.actor}</span>}
                      <span>
                        {a.evidenceCount} matching {a.evidenceCount === 1 ? "entry" : "entries"} below
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {/* AI analyst (collapsible, grounded, drafts-only) */}
      <div className="border-t border-white/10">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-white/80 hover:bg-white/5"
        >
          <span>🤖</span>
          <span>Ask the audit analyst</span>
          <span className="ml-auto text-xs text-white/40">{open ? "Hide" : "Show"}</span>
        </button>

        {open && (
          <div className="border-t border-white/10 px-4 py-3">
            <p className="mb-3 text-xs text-white/45">
              The analyst answers only from the checks above — it never invents events, and its
              replies are advisory. Always confirm anything important against the entries themselves.
            </p>

            <div className="mb-3 max-h-[360px] min-h-[80px] space-y-3 overflow-y-auto rounded-lg border border-white/10 bg-black p-3">
              {messages.length === 0 ? (
                <div className="text-sm text-white/45">
                  Ask a question about the recent activity and I&apos;ll help you interpret what the
                  checks found.
                </div>
              ) : (
                messages.map((m, i) => (
                  <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                    <div
                      className={
                        m.role === "user"
                          ? "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-[#7ed957]/20 px-3 py-2 text-sm text-white"
                          : "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm border border-white/10 bg-[#0a0a0a] px-3 py-2 text-sm text-white/85"
                      }
                    >
                      {m.content}
                    </div>
                  </div>
                ))
              )}
              {pending ? (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-sm border border-white/10 bg-[#0a0a0a] px-3 py-2 text-sm text-white/40">
                    Reviewing…
                  </div>
                </div>
              ) : null}
              <div ref={endRef} />
            </div>

            {messages.length === 0 ? (
              <div className="mb-3 flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={!aiEnabled || pending}
                    onClick={() => send(s)}
                    className="rounded-full border border-white/15 bg-black px-3 py-1 text-xs text-white/60 hover:bg-white/10 disabled:opacity-40"
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : null}

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
                  placeholder="Ask about the recent activity…"
                  className="flex-1 resize-none rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-[#7ed957] focus:outline-none"
                  disabled={pending}
                />
                <button
                  type="submit"
                  disabled={pending || !input.trim()}
                  className="rounded-lg bg-[#7ed957] px-4 py-2 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-40"
                >
                  Send
                </button>
              </form>
            ) : (
              <p className="text-xs text-white/45">
                The analyst needs an AI API key configured to answer questions. The automatic checks
                above still work without it.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
