"use client";
/**
 * Fix Phase 1.7a (G-43 req 7; owner message 4: "please build the photo
 * upload (G-43), as well as a video upload just in case.").
 *
 * Optional photo or video of the rendered mixture, straight from the phone or
 * computer to the PRIVATE destruction-evidence bucket on a signed URL
 * (resumable over 6 MB), then checked by the server before it is recorded.
 * One file at a time, in order, so a dropped connection loses one file only.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { putSigned, tusSigned } from "@/lib/media/direct-upload-client";
import { friendlyStorageError } from "@/lib/media/upload-policy-core";
import { EVIDENCE_ACCEPT_ATTR, EVIDENCE_NOTE_MAX, formatEvidenceBytes } from "@/lib/inventory/destruction-evidence-core";
import { finishEvidenceUploadAction, startEvidenceUploadAction } from "@/app/admin/inventory/disposition/evidence-actions";

type Row = { name: string; size: number; state: "waiting" | "uploading" | "checking" | "saved" | "refused"; progress: number; message?: string };

export function DestructionEvidenceUploader({ eventId }: { eventId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const patch = (i: number, p: Partial<Row>) => setRows((old) => old.map((r, j) => (j === i ? { ...r, ...p } : r)));

  async function upload(files: File[]) {
    if (busy || files.length === 0) return;
    setBusy(true);
    const offset = rows.length;
    setRows((old) => [...old, ...files.map((f) => ({ name: f.name, size: f.size, state: "waiting" as const, progress: 0 }))]);
    let saved = 0;
    for (let k = 0; k < files.length; k++) {
      const file = files[k]!;
      const i = offset + k;
      try {
        patch(i, { state: "uploading" });
        const start = await startEvidenceUploadAction({ eventId, filename: file.name, mime: file.type, size: file.size, note });
        if (!start.ok) {
          patch(i, { state: "refused", message: start.error });
          continue;
        }
        const onProgress = (sent: number, total: number) => patch(i, { progress: total ? sent / total : 0 });
        try {
          if (start.resumable) {
            await tusSigned({ endpoint: start.endpoint, anonKey: start.anonKey, key: start.key, token: start.token, file, contentType: start.mime, onProgress, bucket: start.bucket });
          } else {
            await putSigned(start.key, start.token, new File([file], file.name, { type: start.mime }), start.mime, onProgress, start.bucket);
          }
        } catch (e) {
          patch(i, { state: "refused", message: friendlyStorageError(e, file.size) });
          continue;
        }
        patch(i, { state: "checking", progress: 1 });
        const done = await finishEvidenceUploadAction({ eventId, key: start.key, filename: file.name, size: file.size, note });
        if (!done.ok) patch(i, { state: "refused", message: done.error });
        else {
          patch(i, { state: "saved" });
          saved += 1;
        }
      } catch (e) {
        patch(i, { state: "refused", message: e instanceof Error ? e.message : String(e) });
      }
    }
    setBusy(false);
    if (saved > 0) {
      setNote("");
      router.refresh();
    }
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3" data-testid="destruction-evidence-uploader">
      <p className="text-xs font-semibold text-white/75">Add photo or video (optional)</p>
      <p className="mt-0.5 text-[11px] text-white/45">
        Photo of the rendered mixture (JPG, PNG, WebP or iPhone HEIC, up to 50 MB) or a video (MP4, WebM or iPhone .MOV, up to
        200 MB). Kept privately with this destruction record for five years; it cannot be edited or deleted.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={note}
          maxLength={EVIDENCE_NOTE_MAX}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional), e.g. after mixing with coffee grounds"
          className="min-w-[220px] flex-1 rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-xs text-white"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className="rounded-lg border border-white/20 px-3 py-1.5 text-xs font-bold text-white/85 hover:border-white/40 disabled:opacity-40"
        >
          {busy ? "Uploading..." : "Choose photo or video"}
        </button>
        <input
          ref={input}
          type="file"
          accept={EVIDENCE_ACCEPT_ATTR}
          multiple
          hidden
          onChange={(e) => {
            const list = e.target.files ? Array.from(e.target.files) : [];
            e.target.value = "";
            void upload(list);
          }}
        />
      </div>
      {rows.length ? (
        <ul className="mt-2 space-y-1">
          {rows.map((r, i) => (
            <li key={i} className="text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-white/70" title={r.name}>
                  {r.name} · {formatEvidenceBytes(r.size)}
                </span>
                <span
                  className={
                    r.state === "saved" ? "text-emerald-300" : r.state === "refused" ? "text-red-300" : "text-white/50"
                  }
                >
                  {r.state === "saved" ? "saved" : r.state === "refused" ? "not saved" : r.state === "checking" ? "checking..." : r.state === "uploading" ? `${Math.round(r.progress * 100)}%` : "waiting"}
                </span>
              </div>
              {r.state === "uploading" ? (
                <div className="mt-0.5 h-1 overflow-hidden rounded bg-white/10">
                  <div className="h-full bg-emerald-400 transition-all" style={{ width: `${Math.round(r.progress * 100)}%` }} />
                </div>
              ) : null}
              {r.message ? <p className="mt-0.5 text-red-200/90">{r.message}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
