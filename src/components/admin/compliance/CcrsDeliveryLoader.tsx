"use client";
/**
 * D250 S3 - "Load the examiner's delivery". The owner drops the files the CCRS
 * examiner sent (the inventory and sales CSVs of 11/13 and 11/17 and the
 * 11_17_datarequest.xlsx). They go straight to private storage, the server
 * checks them against our ledger (nothing written), and one guarded button
 * loads them. Each file is recognised by its header row (or as the workbook).
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import { RECORDS_BUCKET } from "@/lib/compliance/ccrs-records-compare-core";
import { detectDeliveryCsv } from "@/lib/compliance/ccrs-delivery-core";
import { applyDeliveryAction, checkDeliveryAction, discardDeliveryAction, startDeliveryUploadAction } from "@/app/admin/compliance/ccrs/records/actions";

const SLOT_LABEL: Record<string, string> = {
  "inventory-2026-11-17": "Inventory (11/17)",
  "sales-2026-11-17": "Sales (11/17)",
  "inventory-2026-11-13": "Inventory (11/13)",
  "sales-2026-11-13": "Sales (11/13)",
  sheets: "Product / Strains / Areas (xlsx)",
};
const SLOTS = Object.keys(SLOT_LABEL);
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type Picked = { file: File; slot: string | null };

async function slotOfFile(f: File): Promise<string | null> {
  const head = new Uint8Array(await f.slice(0, 4096).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return "sheets";
  return detectDeliveryCsv(new TextDecoder().decode(head).split("\n")[0] ?? "");
}

function putSigned(key: string, token: string, file: File, type: string, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const encoded = key.split("/").map(encodeURIComponent).join("/");
    const url = `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/upload/sign/${RECORDS_BUCKET}/${encoded}?token=${encodeURIComponent(token)}`;
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", new File([file], key.split("/").pop() || "file", { type }));
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("apikey", supabaseAnonKey);
    xhr.setRequestHeader("x-upsert", "true");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`${xhr.status} ${xhr.responseText || xhr.statusText}`)));
    xhr.onerror = () => reject(new Error("network error"));
    xhr.send(body);
  });
}

export function CcrsDeliveryUploader({ defaultAsOf }: { defaultAsOf: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [asOf, setAsOf] = useState(defaultAsOf);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add(files: FileList | File[]) {
    setError(null);
    const next = [...picked];
    for (const f of Array.from(files)) {
      const slot = await slotOfFile(f);
      const i = next.findIndex((p) => p.slot && p.slot === slot);
      if (i >= 0) next.splice(i, 1);
      next.push({ file: f, slot });
    }
    setPicked(next);
  }
  const known = picked.filter((p) => p.slot);
  const unknown = picked.filter((p) => !p.slot);
  const hasSheets = known.some((p) => p.slot === "sheets");
  const ready = known.length > 0 && unknown.length === 0 && hasSheets && /^\d{4}-\d{2}-\d{2}$/.test(asOf);

  async function upload() {
    if (!ready || busy) return;
    setError(null);
    try {
      setBusy("Starting...");
      const start = await startDeliveryUploadAction({ asOf, notes, fileCount: known.length });
      if (!start.ok) throw new Error(start.error);
      for (let n = 0; n < known.length; n += 1) {
        const p = known[n];
        setBusy(`Uploading ${p.file.name}...`);
        await putSigned(start.uploads[n].key, start.uploads[n].token, p.file, p.slot === "sheets" ? XLSX : "text/csv", () => undefined);
      }
      setBusy("Checking every record against our ledger (this can take a minute)...");
      const r = await checkDeliveryAction(start.id, known.map((p) => p.file.name));
      if (!r.ok) setError(`Uploaded, but the check failed: ${r.error}`);
      setPicked([]);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); void add(e.dataTransfer.files); }}
        onClick={() => input.current?.click()}
        className="cursor-pointer rounded-2xl border-2 border-dashed border-white/15 bg-white/[0.02] px-6 py-6 text-center hover:border-white/30"
      >
        <div className="text-sm font-bold text-white/85">Drop the examiner&apos;s delivery files here, or click to choose</div>
        <div className="mt-1 text-xs text-white/45">The two inventory CSVs, the two sales CSVs and 11_17_datarequest.xlsx. Each is recognised by its contents, whatever it is named.</div>
        <input ref={input} type="file" accept=".csv,.xlsx,text/csv" multiple hidden onChange={(e) => { if (e.target.files) void add(e.target.files); e.target.value = ""; }} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {SLOTS.map((s) => {
          const p = known.find((k) => k.slot === s);
          return (
            <div key={s} className={`rounded-xl border px-3 py-2 text-xs ${p ? "border-emerald-400/30 bg-emerald-400/5" : "border-white/10 bg-white/[0.02]"}`}>
              <div className="font-bold text-white/80">{SLOT_LABEL[s]}</div>
              <div className="mt-0.5 truncate text-white/45" title={p?.file.name}>{p ? `✓ ${p.file.name}` : s === "sheets" ? "needed" : "optional"}</div>
            </div>
          );
        })}
      </div>
      {unknown.length ? (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-xs text-amber-100">
          Not a file of this delivery: {unknown.map((u) => u.file.name).join(", ")}.{" "}
          <button type="button" className="underline" onClick={() => setPicked(known)}>Remove</button>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-[200px_1fr_auto] sm:items-end">
        <label className="text-xs text-white/60">
          <span className="mb-1 block font-semibold">Delivery date</span>
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white" />
        </label>
        <label className="text-xs text-white/60">
          <span className="mb-1 block font-semibold">Notes</span>
          <input value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Brian's 11/17 data request" className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white" />
        </label>
        <button type="button" disabled={!ready || !!busy} onClick={() => void upload()} className="rounded-lg bg-emerald-500 px-5 py-2 text-sm font-black text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40">
          {busy ? "Working..." : "Upload & check"}
        </button>
      </div>
      {busy ? <div className="text-xs text-emerald-200">{busy}</div> : null}
      {error ? <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">{error}</div> : null}
    </div>
  );
}

export function CcrsDeliveryApply({ id, status, add, upd, fileNames }: { id: string; status: string; add: number; upd: number; fileNames: string[] }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (f: () => Promise<{ ok: true } | { ok: true; added: number; updated: number } | { ok: false; error: string }>, done: string) => {
    setBusy(true);
    setOut(null);
    try {
      const r = await f();
      setOut(r.ok ? { ok: true, text: "added" in r ? `Loaded: ${r.added} new, ${r.updated} updated.` : done } : { ok: false, text: r.error });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  if (status === "applied" || status === "discarded") return null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => void run(() => checkDeliveryAction(id, fileNames), "Checked again.")} className="rounded-lg border border-white/15 px-3 py-2 text-xs font-bold text-white/80 hover:bg-white/5">Check again</button>
        {status === "ready" ? (
          <>
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Type LOAD" className="w-28 rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-xs text-white" />
            <button
              type="button"
              disabled={busy || confirm.trim().toUpperCase() !== "LOAD"}
              onClick={() => void run(() => applyDeliveryAction({ id, expectAdd: add, expectUpd: upd, confirm }), "")}
              className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-black text-black hover:bg-emerald-400 disabled:opacity-40"
            >
              Load into the ledger ({add.toLocaleString()} new, {upd.toLocaleString()} updated)
            </button>
          </>
        ) : null}
        <button type="button" disabled={busy} onClick={() => void run(() => discardDeliveryAction(id), "Discarded.")} className="rounded-lg px-3 py-2 text-xs text-white/45 hover:text-white/80">Discard</button>
      </div>
      {busy ? <div className="text-xs text-emerald-200">Working... (re-reads the files and the ledger first)</div> : null}
      {out ? <div className={`rounded-xl border px-3 py-2 text-xs ${out.ok ? "border-emerald-400/30 bg-emerald-400/5 text-emerald-100" : "border-red-500/40 bg-red-500/10 text-red-100"}`}>{out.text}</div> : null}
    </div>
  );
}
