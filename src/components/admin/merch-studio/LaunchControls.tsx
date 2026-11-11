"use client";

/**
 * D232 slice M-3a: the small client controls on Setup & Launch.
 *   - LaunchTick: "I did this" tick for steps only the owner can see.
 *   - LaunchNote: a form 8.1 note (text or date).
 *   - CopyValue: a copy button for an exact value (URL, event list, command).
 *   - PrintRecordButton: window.print() for form 8.1.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import { saveLaunchNoteAction, setLaunchTickAction } from "@/app/admin/merch-studio/launch/actions";

export function LaunchTick({ stepId, ticked }: { stepId: string; ticked: boolean }) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={ticked}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.checked;
          start(async () => {
            const r = await setLaunchTickAction(stepId, v);
            toast(r.ok ? { tone: "success", message: v ? "✅ Great, done!" : "Unticked." } : { tone: "error", message: r.error });
            router.refresh();
          });
        }}
      />
      {pending ? "Saving..." : "I did this and checked it"}
    </label>
  );
}

export function LaunchNote({ field, label, type, current }: { field: string; label: string; type: "text" | "date"; current: string }) {
  const { toast } = useToast();
  const router = useRouter();
  const [value, setValue] = useState(current);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveLaunchNoteAction(field, value);
          toast(r.ok ? { tone: "success", message: "Saved." } : { tone: "error", message: r.error });
          router.refresh();
        });
      }}
    >
      <label className="text-sm">
        <span className="mb-1 block text-[var(--admin-text-muted)]">{label}</span>
        <input type={type} value={value} maxLength={120} onChange={(e) => setValue(e.target.value)} className="rounded-[var(--admin-radius-sm)] border border-white/15 bg-[var(--admin-surface-2)] px-2 py-1 text-sm" />
      </label>
      <Button type="submit" variant="save" size="sm" disabled={pending || value === current}>
        {pending ? "Saving..." : "Save"}
      </Button>
    </form>
  );
}

export function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-[var(--admin-text-muted)]">{label}:</span>
      <code className="rounded bg-black/30 px-1.5 py-0.5 break-all">{value}</code>
      <button
        type="button"
        className="rounded border border-white/15 px-2 py-0.5 hover:bg-white/5"
        onClick={() => {
          navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => setCopied(false));
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function PrintRecordButton() {
  return (
    <button type="button" onClick={() => window.print()} className="rounded border border-black px-3 py-1.5 text-xs font-bold uppercase tracking-[0.1em] text-black print:hidden">
      Print
    </button>
  );
}
