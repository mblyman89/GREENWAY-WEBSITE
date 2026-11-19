"use client";

/**
 * D253: pair a browser with the assisted CCRS uploader. The pairing code comes
 * back from the server action ONCE, into this form's state only (never a URL,
 * never stored: the back office keeps sha256 of its key).
 */
import { useActionState, useState } from "react";

/** Same shape as PairState in auto-upload-actions.ts (kept here so this client file never imports server code). */
export type PairFormState = { code: string | null; error: string | null; label: string | null };
type PairAction = (prev: PairFormState, formData: FormData) => Promise<PairFormState>;

const START: PairFormState = { code: null, error: null, label: null };

export function CcrsUploaderPairForm({ pairAction }: { pairAction: PairAction }) {
  const [state, action, pending] = useActionState(pairAction, START);
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2" data-testid="ccrs-uploader-pair">
      <form action={action} className="flex flex-wrap items-end gap-2 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-white/60">Name this browser</span>
          <input name="label" maxLength={80} defaultValue="Owner's Chrome" className="rounded-lg border border-white/15 bg-black/30 px-2 py-1" />
        </label>
        <button type="submit" disabled={pending} className="rounded-lg bg-emerald-500/80 px-3 py-1.5 font-bold text-black disabled:opacity-60">
          {pending ? "Making a code\u2026" : "Pair a browser"}
        </button>
      </form>
      {state.error ? <p role="alert" className="text-xs text-red-300">{state.error}</p> : null}
      {state.code ? (
        <div className="rounded-lg border border-amber-300/40 bg-amber-500/10 p-3 text-xs text-amber-50">
          <p className="font-bold">Pairing code for {state.label}. It is shown only now.</p>
          <p className="mt-1">Open the Greenway CCRS Uploader extension&apos;s options in Chrome and paste it there. Anyone with this code can upload for Greenway, so do not share it.</p>
          <code className="mt-2 block break-all rounded bg-black/40 p-2 font-mono text-[11px]" data-testid="ccrs-uploader-code">{state.code}</code>
          <button
            type="button"
            className="mt-2 rounded border border-white/20 px-2 py-1"
            onClick={() => {
              void navigator.clipboard?.writeText(state.code ?? "").then(() => setCopied(true));
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
