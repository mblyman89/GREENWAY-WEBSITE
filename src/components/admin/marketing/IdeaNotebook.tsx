"use client";

/**
 * IdeaNotebook.tsx (E1)
 *
 * Shows saved marketing strategy drafts and lets the owner triage them
 * (change status, delete). Drafts-only notebook. Server actions do the writes.
 */
import { useState, useTransition } from "react";
import { updateIdeaAction, deleteIdeaAction } from "@/app/admin/marketing/actions";
import { Badge, Button, type BadgeTone } from "@/components/admin/ui";
import type { MarketingIdea, MarketingIdeaStatus } from "@/lib/marketing/ideas-store";

const STATUS_OPTIONS: { value: MarketingIdeaStatus; label: string; tone: BadgeTone }[] = [
  { value: "idea", label: "Idea", tone: "gold" },
  { value: "planned", label: "Planned", tone: "green" },
  { value: "done", label: "Done", tone: "neutral" },
  { value: "archived", label: "Archived", tone: "outline" },
];

function toneFor(status: string): BadgeTone {
  return STATUS_OPTIONS.find((s) => s.value === status)?.tone ?? "neutral";
}

export function IdeaNotebook({ ideas }: { ideas: MarketingIdea[] }) {
  if (ideas.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">
        No saved ideas yet. Draft a strategy above and click “Save to idea notebook” to keep it here.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {ideas.map((idea) => (
        <IdeaRow key={idea.id} idea={idea} />
      ))}
    </div>
  );
}

function IdeaRow({ idea }: { idea: MarketingIdea }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<MarketingIdeaStatus>(idea.status);

  function changeStatus(next: MarketingIdeaStatus) {
    setStatus(next);
    const fd = new FormData();
    fd.set("id", idea.id);
    fd.set("status", next);
    startTransition(() => {
      void updateIdeaAction(fd);
    });
  }

  function remove() {
    if (!confirm("Delete this idea from the notebook?")) return;
    const fd = new FormData();
    fd.set("id", idea.id);
    startTransition(() => {
      void deleteIdeaAction(fd);
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-left"
        >
          <span aria-hidden>{open ? "▾" : "▸"}</span>
          <span className="font-medium text-slate-900">{idea.title || idea.goal || "Untitled idea"}</span>
          <Badge tone={toneFor(status)}>{status}</Badge>
        </button>
        <div className="flex items-center gap-2">
          <select
            value={status}
            disabled={pending}
            onChange={(e) => changeStatus(e.target.value as MarketingIdeaStatus)}
            className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
            aria-label="Change status"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <Button type="button" variant="ghost" size="sm" onClick={remove} disabled={pending}>
            Delete
          </Button>
        </div>
      </div>
      {idea.channel && idea.channel !== "general" ? (
        <p className="mt-1 text-xs text-slate-500">Channel: {idea.channel}</p>
      ) : null}
      {open ? (
        <div className="mt-3 whitespace-pre-wrap border-t border-slate-100 pt-3 text-sm text-slate-700">
          {idea.body || <span className="text-slate-400">(empty)</span>}
        </div>
      ) : null}
    </div>
  );
}
