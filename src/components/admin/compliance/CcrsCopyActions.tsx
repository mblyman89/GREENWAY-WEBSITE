"use client";
/** R74 S40 - compare again / merge into the ledger / discard, for one CCRS copy. */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyCopyAction, compareCopyAction, discardCopyAction } from "@/app/admin/compliance/ccrs/records/actions";

export function CcrsCopyActions(props: {
  id: string;
  status: string;
  canMerge: boolean;
  add: number;
  upd: number;
  seedMissing: number;
  linkStillUnfiled: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState("");
  const [accept, setAccept] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string } & Record<string, unknown>>, okText: (r: Record<string, unknown>) => string) =>
    start(async () => {
      setMsg(null);
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: okText(r) } : { ok: false, text: String(r.error ?? "failed") });
      router.refresh();
    });

  const open = props.status === "ready" || props.status === "failed";
  return (
    <div className="space-y-4">
      {props.status === "ready" && props.canMerge ? (
        <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/5 p-4">
          <div className="text-sm font-black text-emerald-100">Merge this copy into our CCRS ledger</div>
          <p className="mt-1 text-xs text-white/60">
            Adds <b className="text-white">{props.add.toLocaleString()}</b> record(s) CCRS holds that our ledger lacks and updates{" "}
            <b className="text-white">{props.upd.toLocaleString()}</b> (refreshed seed rows, Cultivera lots now on the record, uncertain rows this copy proves).
            Held-back lots whose ids are now on record are released for the next weekly upload. Review items are never written.
            It is all-or-nothing: if the ledger moved since this comparison, nothing is written.
          </p>
          {props.linkStillUnfiled > 0 ? <p className="mt-1 text-xs text-amber-200/80">{props.linkStillUnfiled.toLocaleString()} migration lot(s) are still not on the State record and stay held.</p> : null}
          <div className="mt-3 flex flex-wrap items-end gap-3">
            {props.seedMissing > 0 ? (
              <label className="text-xs text-amber-100">
                <span className="mb-1 block font-semibold">{props.seedMissing} seeded record(s) are missing from this copy. To accept, type {props.seedMissing}</span>
                <input value={accept} onChange={(e) => setAccept(e.target.value)} inputMode="numeric" className="w-40 rounded-lg border border-amber-400/40 bg-black/30 px-3 py-2 text-sm text-white" />
              </label>
            ) : null}
            <label className="text-xs text-white/60">
              <span className="mb-1 block font-semibold">Type MERGE to confirm</span>
              <input value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-40 rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white" />
            </label>
            <button
              type="button"
              disabled={pending || confirm.trim().toUpperCase() !== "MERGE"}
              onClick={() => run(() => applyCopyAction({ id: props.id, expectAdd: props.add, expectUpd: props.upd, acceptSeedMissing: accept, confirm }), (r) => `Merged: ${Number(r.added).toLocaleString()} added, ${Number(r.updated).toLocaleString()} updated. Rebuild the weekly batch to release held lots.`)}
              className="rounded-lg bg-emerald-500 px-5 py-2 text-sm font-black text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pending ? "Working..." : "Merge into ledger"}
            </button>
          </div>
        </div>
      ) : null}
      {props.status === "ready" && !props.canMerge ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-xs text-white/55">
          This copy can be compared but not merged (the ledger plan needs a seeded ledger and a copy dated after 2026-09-18; see the Ledger panel).
        </div>
      ) : null}
      {open ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={pending} onClick={() => run(() => compareCopyAction(props.id), () => "Compared again with today's records.")} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/5 disabled:opacity-40">
            ↻ Compare again
          </button>
          <button type="button" disabled={pending} onClick={() => { if (window.confirm("Discard this copy and delete its files?")) run(() => discardCopyAction(props.id), () => "Discarded."); }} className="rounded-lg border border-red-400/30 px-3 py-1.5 text-xs font-semibold text-red-200/80 hover:bg-red-500/10 disabled:opacity-40">
            Discard copy
          </button>
        </div>
      ) : null}
      {msg ? <div className={`rounded-xl border px-3 py-2 text-xs ${msg.ok ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100" : "border-red-500/40 bg-red-500/10 text-red-100"}`}>{msg.text}</div> : null}
    </div>
  );
}
