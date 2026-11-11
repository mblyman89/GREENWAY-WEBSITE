"use client";

/**
 * D232 M-4 (G-81) - the sample approval, saved on the server per design.
 * Used on Proof & Export (approve: every checklist item + a photo) and on
 * Publish (shows why Publish is blocked; the owner's override with a reason).
 * Owner D232: "Q2: yes, owner only and reason."
 */
import { useEffect, useState } from "react";
import type { MerchDesign } from "@/lib/merch-studio/merch-design-core";
import { sampleChecklist } from "@/lib/merch-studio/print-export-core";
import { MIN_OVERRIDE_REASON, PHOTO_MIME, printHash, sampleGate, type DesignRow } from "@/lib/merch-studio/merch-design-sync-core";
import {
  approveMerchSampleAction, clearMerchSampleAction, listMerchDesignsAction, overrideMerchSampleAction, samplePhotoUrlAction, startSamplePhotoUploadAction,
} from "@/app/admin/merch-studio/design-actions";
import { putSignedFile } from "./design-sync";

export interface SampleRights { canApprove: boolean; isOwner: boolean }

const btn = "rounded-[var(--admin-radius-sm)] px-3 py-1.5 text-xs font-bold disabled:opacity-40";
const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") : "");

/** Reads this design's server row. `tick` re-reads after a save. */
function useRow(designId: string, tick: number): { row: DesignRow | null; error: string | null; loaded: boolean } {
  const [st, setSt] = useState<{ id: string; tick: number; row: DesignRow | null; error: string | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    listMerchDesignsAction().then((r) => {
      if (cancelled) return;
      setSt({ id: designId, tick, row: r.ok ? r.rows.find((x) => x.id === designId) ?? null : null, error: r.ok ? null : r.error });
    }).catch(() => { if (!cancelled) setSt({ id: designId, tick, row: null, error: "Couldn't reach the server." }); });
    return () => { cancelled = true; };
  }, [designId, tick]);
  const fresh = st && st.id === designId && st.tick === tick;
  return { row: fresh ? st.row : null, error: fresh ? st.error : null, loaded: !!fresh };
}

export function SampleGate({ design, rights, mode, ticks, onRow }: {
  design: MerchDesign;
  rights: SampleRights;
  mode: "proof" | "publish";
  /** Proof mode: the checklist ticks on screen. */
  ticks?: Record<string, boolean>;
  onRow?: (row: DesignRow | null) => void;
}) {
  const [tick, setTick] = useState(0);
  const { row, error, loaded } = useRow(design.id, tick);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [reason, setReason] = useState("");
  const [photoUrl, setPhotoUrl] = useState<{ key: string; url: string } | null>(null);
  const hash = printHash(design);
  const gate = sampleGate(row, hash);

  useEffect(() => { if (loaded) onRow?.(row); }, [loaded, row, onRow]);
  useEffect(() => {
    const key = row?.samplePhotoKey;
    if (!key) return;
    let cancelled = false;
    samplePhotoUrlAction({ key }).then((r) => { if (!cancelled && r.ok) setPhotoUrl({ key, url: r.url }); }).catch(() => {});
    return () => { cancelled = true; };
  }, [row?.samplePhotoKey]);

  const required = sampleChecklist(design).map((c) => c.id);
  const ticked = required.filter((id) => ticks?.[id]);

  const approve = async (f: File) => {
    setMsg(null);
    try {
      if (!PHOTO_MIME[f.type]) throw new Error("Use a JPEG, PNG or WebP photo.");
      if (f.size > 40 * 1024 * 1024) throw new Error("That photo is over 40 MB.");
      setBusy("Uploading the photo...");
      const up = await startSamplePhotoUploadAction({ designId: design.id, mime: f.type });
      if (!up.ok) throw new Error(up.error);
      await putSignedFile(up.bucket, up.key, up.token, f);
      setBusy("Saving the approval...");
      const r = await approveMerchSampleAction({ designId: design.id, designHash: hash, ticked, photoKey: up.key });
      if (!r.ok) throw new Error(r.error);
      setMsg({ tone: "ok", text: "Sample approved. Publish is unlocked for this design (until the print changes)." });
      setTick((n) => n + 1);
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof Error ? e.message : "Approval failed." });
    } finally { setBusy(null); }
  };
  const override = async () => {
    setMsg(null);
    setBusy("Saving the override...");
    const r = await overrideMerchSampleAction({ designId: design.id, designHash: hash, reason }).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
    setBusy(null);
    if (!r.ok) { setMsg({ tone: "bad", text: r.error }); return; }
    setReason("");
    setMsg({ tone: "ok", text: "Override saved and recorded in the audit log. Publish is unlocked for this design (until the print changes)." });
    setTick((n) => n + 1);
  };
  const clear = async () => {
    if (!window.confirm("Take back the sample approval for this design? Publish will be blocked again.")) return;
    setBusy("Clearing...");
    const r = await clearMerchSampleAction({ designId: design.id }).catch(() => ({ ok: false as const, error: "Couldn't reach the server." }));
    setBusy(null);
    if (!r.ok) setMsg({ tone: "bad", text: r.error }); else setTick((n) => n + 1);
  };

  const status = !loaded ? (
    <p className="text-xs text-white/60">Checking the sample approval on the server...</p>
  ) : error ? (
    <p className="text-xs text-[var(--admin-danger)]">{error}</p>
  ) : gate.ok ? (
    <p className="text-xs text-[var(--admin-accent)]">
      {"\u2714"} {gate.how === "approved" ? "Sample approved" : "Published without a sample (owner override)"} by {gate.by ?? "?"} on {when(gate.at)}.
      {gate.how === "overridden" && gate.reason ? <> Reason: <i>{gate.reason}</i></> : null}
    </p>
  ) : (
    <p className="text-xs text-[var(--admin-gold)]">{"\u26a0"} Publish is blocked: {gate.reason}</p>
  );

  const canOverride = rights.isOwner && loaded && !error && !!row && row.designHash === hash && !gate.ok;
  return (
    <div className="space-y-2 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-2" data-testid="sample-gate">
      {status}
      {photoUrl && row?.samplePhotoKey === photoUrl.key && gate.ok ? (
        // eslint-disable-next-line @next/next/no-img-element -- 1-hour signed URL from the private merch-files bucket
        <img src={photoUrl.url} alt="Photo of the approved sample" className="max-h-40 rounded border border-[var(--admin-border)]" />
      ) : null}
      {mode === "proof" && loaded && !error && !gate.ok && row && row.designHash === hash ? (
        rights.canApprove ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className={`${btn} cursor-pointer bg-[var(--admin-accent)] text-black ${ticked.length < required.length || busy ? "pointer-events-none opacity-40" : ""}`}>
              Approve the sample - add its photo
              <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={ticked.length < required.length || !!busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void approve(f); }} />
            </label>
            <span className="text-xs text-white/60">{ticked.length < required.length ? `Tick all ${required.length} items above first (${required.length - ticked.length} left).` : "Pick a photo of the real sample to finish."}</span>
          </div>
        ) : <p className="text-xs text-white/60">Only the owner or an admin can approve the sample. Tick the items, then ask them to approve it here.</p>
      ) : null}
      {canOverride ? (
        <details className="text-xs text-white/75" open={mode === "publish"}>
          <summary className="cursor-pointer">Owner: publish without an approved sample</summary>
          <p className="mt-1 text-white/60">Only the owner can do this. Type why (for example: &quot;same print as the shirt we already tested&quot;). It is saved with your name and the time, and recorded in the audit log.</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input className="min-w-[16rem] flex-1 rounded border border-[var(--admin-border)] bg-black/30 px-2 py-1 text-white" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Why it's OK to sell without a sample" aria-label="Override reason" />
            <button type="button" className={`${btn} bg-[var(--admin-gold)] text-black`} disabled={reason.trim().length < MIN_OVERRIDE_REASON || !!busy} onClick={() => { void override(); }}>Override with this reason</button>
          </div>
        </details>
      ) : null}
      {mode === "proof" && gate.ok && rights.canApprove ? <button type="button" className="text-xs text-white/60 underline" disabled={!!busy} onClick={() => { void clear(); }}>Take back this approval</button> : null}
      {busy ? <p className="text-xs text-white/70">{busy}</p> : null}
      {msg ? <p className={`text-xs ${msg.tone === "ok" ? "text-[var(--admin-accent)]" : "text-[var(--admin-danger)]"}`}>{msg.text}</p> : null}
    </div>
  );
}
