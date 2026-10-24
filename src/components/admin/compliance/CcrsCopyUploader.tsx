"use client";
/**
 * R74 S40 - upload a CCRS data copy (the LCB Service Desk delivery). The four
 * CSVs go straight from the browser to the private ccrs-records bucket on
 * signed URLs (no 4.5 MB body cap), each file recognised by its header row,
 * then the server compares the copy with our records.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import { SEED_HEADERS, type SeedSource } from "@/lib/compliance/ccrs-ledger-seed-core";
import { RECORD_SOURCES, RECORDS_BUCKET, detectSource } from "@/lib/compliance/ccrs-records-compare-core";
import { compareCopyAction, startCopyUploadAction } from "@/app/admin/compliance/ccrs/records/actions";

type Picked = { file: File; source: SeedSource | null };

function putSigned(key: string, token: string, file: File, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const encoded = key.split("/").map(encodeURIComponent).join("/");
    const url = `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/upload/sign/${RECORDS_BUCKET}/${encoded}?token=${encodeURIComponent(token)}`;
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", new File([file], key.split("/").pop() || "file.csv", { type: "text/csv" }));
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

const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function CcrsCopyUploader({ defaultAsOf }: { defaultAsOf: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [asOf, setAsOf] = useState(defaultAsOf);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  async function add(files: FileList | File[]) {
    setError(null);
    const next = [...picked];
    for (const f of Array.from(files)) {
      const head = await f.slice(0, 4096).text();
      const source = detectSource(head.split("\n")[0] ?? "", SEED_HEADERS);
      const i = next.findIndex((p) => p.source && p.source === source);
      if (i >= 0) next.splice(i, 1);
      next.push({ file: f, source });
    }
    setPicked(next);
  }

  const bySource = new Map(picked.filter((p) => p.source).map((p) => [p.source as SeedSource, p]));
  const unknown = picked.filter((p) => !p.source);
  const ready = RECORD_SOURCES.every((s) => bySource.has(s)) && unknown.length === 0 && /^\d{4}-\d{2}-\d{2}$/.test(asOf);

  async function upload() {
    if (!ready || busy) return;
    setError(null);
    setBusy("Starting...");
    try {
      const start = await startCopyUploadAction({ asOf, notes });
      if (!start.ok) throw new Error(start.error);
      for (const u of start.uploads) {
        const p = bySource.get(u.source)!;
        setBusy(`Uploading ${u.source}...`);
        await putSigned(u.key, u.token, p.file, (x) => setProgress((o) => ({ ...o, [u.source]: x })));
        setProgress((o) => ({ ...o, [u.source]: 1 }));
      }
      setBusy("Comparing with our records (this can take a minute)...");
      const cmp = await compareCopyAction(start.id);
      if (!cmp.ok) setError(`Uploaded, but the comparison failed: ${cmp.error}`);
      setPicked([]);
      setProgress({});
      router.push(`/admin/compliance/ccrs/records?copy=${start.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void add(e.dataTransfer.files); }}
        onClick={() => input.current?.click()}
        className={`cursor-pointer rounded-2xl border-2 border-dashed px-6 py-8 text-center transition ${drag ? "border-emerald-400/70 bg-emerald-400/10" : "border-white/15 bg-white/[0.02] hover:border-white/30"}`}
      >
        <div className="text-2xl">📥</div>
        <div className="mt-1 text-sm font-bold text-white/85">Drop the four CCRS delivery CSVs here, or click to choose</div>
        <div className="mt-1 text-xs text-white/45">Inventory, Product, Strain and Area. Each file is recognised by its header row, whatever it is named.</div>
        <input ref={input} type="file" accept=".csv,text/csv" multiple hidden onChange={(e) => { if (e.target.files) void add(e.target.files); e.target.value = ""; }} />
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {RECORD_SOURCES.map((s) => {
          const p = bySource.get(s);
          const pr = progress[s];
          return (
            <div key={s} className={`rounded-xl border px-3 py-2 text-xs ${p ? "border-emerald-400/30 bg-emerald-400/5" : "border-white/10 bg-white/[0.02]"}`}>
              <div className="flex items-center justify-between">
                <span className="font-bold text-white/80">{s}.csv</span>
                <span className={p ? "text-emerald-300" : "text-white/35"}>{p ? "✓ ready" : "needed"}</span>
              </div>
              <div className="mt-0.5 truncate text-white/45" title={p?.file.name}>{p ? `${p.file.name} · ${kb(p.file.size)}` : "—"}</div>
              {pr !== undefined ? (
                <div className="mt-1.5 h-1 overflow-hidden rounded bg-white/10"><div className="h-full bg-emerald-400 transition-all" style={{ width: `${Math.round(pr * 100)}%` }} /></div>
              ) : null}
            </div>
          );
        })}
      </div>
      {unknown.length ? (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-xs text-amber-100">
          Not a CCRS delivery file (its header row does not match): {unknown.map((u) => u.file.name).join(", ")}.{" "}
          <button type="button" className="underline" onClick={() => setPicked(picked.filter((p) => p.source))}>Remove</button>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-[200px_1fr_auto] sm:items-end">
        <label className="text-xs text-white/60">
          <span className="mb-1 block font-semibold">Current through (as-of date)</span>
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white" />
        </label>
        <label className="text-xs text-white/60">
          <span className="mb-1 block font-semibold">Notes (ticket number, who sent it)</span>
          <input value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. LCB Service Desk ticket #12345" className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white" />
        </label>
        <button
          type="button"
          disabled={!ready || !!busy}
          onClick={() => void upload()}
          className="rounded-lg bg-emerald-500 px-5 py-2 text-sm font-black text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Working..." : "Upload & compare"}
        </button>
      </div>
      {busy ? <div className="text-xs text-emerald-200">{busy}</div> : null}
      {error ? <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">{error}</div> : null}
    </div>
  );
}
