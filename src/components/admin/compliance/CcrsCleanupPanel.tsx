"use client";
/**
 * D256 S2 - Stale-lot clean-up (Part 17 §E). Step 1 Plan (nothing written),
 * Step 2 type the wave label to store the Inventory file, then (after its
 * success email is applied) Step 3 plan + store the Reconciliation file.
 */
import { useState } from "react";
import { planAdjustAction, planWaveAction, storeAdjustAction, storeWaveAction, type CleanupResult } from "@/app/admin/compliance/ccrs/cleanup/actions";

const btn = "rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-3 py-1.5 text-sm font-semibold text-emerald-100 hover:bg-emerald-400/20 disabled:opacity-40";

function Step({ title, plan, store, wave }: { title: string; wave: string; plan: (w: string) => Promise<CleanupResult>; store: (i: { wave: string; confirm: string; countsJson: string }) => Promise<CleanupResult> }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<CleanupResult | null>(null);
  const [planned, setPlanned] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const run = async (f: () => Promise<CleanupResult>, keep: boolean) => {
    setBusy(true);
    try {
      const r = await f();
      setRes(r);
      setPlanned(keep && r.ok && r.countsJson ? r.countsJson : null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 rounded-xl border border-white/10 p-4" data-testid={`cleanup-${title.split(" ")[0].toLowerCase()}`}>
      <h3 className="font-bold text-white/90">{title}</h3>
      <button className={btn} disabled={busy} onClick={() => run(() => plan(wave), true)}>{busy ? "Working… (up to a minute)" : `Plan ${wave} (nothing is written)`}</button>
      {res ? <p className={res.ok ? "text-sm text-white/80" : "text-sm text-rose-300"}>{res.ok ? res.text : res.error}</p> : null}
      {res?.ok && res.detail ? <details><summary className="cursor-pointer text-xs text-white/60">Show the lots</summary><pre className="max-h-80 overflow-auto text-xs text-white/60">{res.detail}</pre></details> : null}
      {planned ? (
        <div className="flex items-center gap-2">
          <input className="w-24 rounded border border-white/20 bg-transparent px-2 py-1 text-sm" placeholder={`type ${wave}`} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <button className={btn} disabled={busy || confirm.trim().toUpperCase() !== wave} onClick={() => run(() => store({ wave, confirm, countsJson: planned }), false)}>Store the file</button>
        </div>
      ) : null}
    </div>
  );
}

export function CcrsCleanupPanel() {
  const [wave, setWave] = useState("W1");
  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm text-white/80">
        Wave
        <select className="rounded border border-white/20 bg-black/40 px-2 py-1" value={wave} onChange={(e) => setWave(e.target.value)}>
          {["W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8"].map((w) => <option key={w}>{w}</option>)}
        </select>
      </label>
      <Step key={`i-${wave}`} title="1. Inventory Update to 0" wave={wave} plan={planWaveAction} store={storeWaveAction} />
      <Step key={`a-${wave}`} title="2. Reconciliation adjustments (after the Update's success email is applied)" wave={wave} plan={planAdjustAction} store={storeAdjustAction} />
    </div>
  );
}
