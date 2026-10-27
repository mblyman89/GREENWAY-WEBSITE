"use client";

/**
 * MediaDropzone — drag-and-drop upload surface for the Media Library.
 *
 * R44: files now go STRAIGHT from the browser to Supabase Storage instead of
 * through a Vercel Function (which caps every request at 4.5 MB on all plans).
 * Per file: ask the server for a one-time signed upload token → upload (one
 * PUT ≤ 6 MB, resumable 6 MB chunks above that) with a live progress bar →
 * the server verifies the stored object and adds the library row.
 * Videos (MP4/WebM) are accepted for banners; a poster frame is captured
 * automatically so the site shows a still instantly while the video loads.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/admin/ui";
import { MEDIA_PURPOSES, PLACEMENT_SUGGESTIONS } from "@/lib/media/taxonomy";
import { imageSpecCheatSheet } from "@/lib/cms/image-spec-core";
import {
  checkUpload,
  formatBytes,
  UPLOAD_ACCEPT_ATTR,
  UPLOAD_MAX_LABEL,
  VIDEO_ADVISORY_SECONDS,
  friendlyStorageError,
} from "@/lib/media/upload-policy-core";
import { putSigned, tusSigned, measureImage, probeVideo } from "@/lib/media/direct-upload-client";
import { startDirectUploadAction, finishDirectUploadAction } from "@/app/admin/media/direct-upload-actions";

type ItemState = "ready" | "blocked" | "uploading" | "done" | "error";
type Item = {
  id: number;
  file: File;
  url: string; // object URL for preview ("" for PDFs)
  kind: "image" | "video" | "document" | "animation" | null;
  state: ItemState;
  sent: number;
  message: string | null; // refusal / error / advisory text
};

const FIELD =
  "w-full rounded-[var(--admin-radius)] border border-[var(--admin-border-strong)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:border-[var(--admin-accent)]";

let nextId = 1;

export function MediaDropzone() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  function patch(id: number, p: Partial<Item>) {
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...p } : it)));
  }

  function addFiles(files: FileList | null) {
    if (!files || busy) return;
    setSummary(null);
    const next: Item[] = Array.from(files).map((file) => {
      const c = checkUpload({ filename: file.name, mime: file.type, size: file.size });
      const kind = c.ok ? c.kind : null;
      return {
        id: nextId++,
        file,
        url: kind === "image" || kind === "video" ? URL.createObjectURL(file) : "",
        kind,
        state: c.ok ? "ready" : "blocked",
        sent: 0,
        message: c.ok ? c.advisory : c.error,
      };
    });
    setItems((list) => [...list.filter((i) => i.state !== "done"), ...next]);
  }

  function remove(id: number) {
    setItems((list) => {
      const it = list.find((i) => i.id === id);
      if (it?.url) URL.revokeObjectURL(it.url);
      return list.filter((i) => i.id !== id);
    });
  }

  async function uploadOne(it: Item, meta: { title: string; usageType: string; tags: string; altText: string; status: string }, single: boolean) {
    const file = it.file;
    // R60: use the checked type (animation files arrive with "" or a generic type).
    const pre = checkUpload({ filename: file.name, mime: file.type, size: file.size });
    const mime = pre.ok ? pre.mime : file.type || "";
    patch(it.id, { state: "uploading", sent: 0, message: null });
    try {
      // Measure first (dimensions are stored in the library; poster for videos).
      let width: number | null = null;
      let height: number | null = null;
      let poster: Blob | null = null;
      let note: string | null = it.message;
      if (it.kind === "image") {
        const d = await measureImage(file);
        width = d?.width ?? null;
        height = d?.height ?? null;
      } else if (it.kind === "video") {
        const v = await probeVideo(file);
        if (!v) {
          throw new Error(
            "This browser can't play that video, so shoppers' browsers probably can't either. Re-export it as MP4 (H.264 video, AAC or no audio) — in Canva choose “MP4 Video”.",
          );
        }
        width = v.width;
        height = v.height;
        poster = v.poster;
        if (v.duration > VIDEO_ADVISORY_SECONDS) {
          note = `This video is ${Math.round(v.duration)} seconds long. Banner loops work best at 5–15 seconds — shorter means smaller and faster for shoppers.`;
        }
      }

      const start = await startDirectUploadAction({
        filename: file.name,
        mime,
        size: file.size,
        usageType: meta.usageType || undefined,
        withPoster: Boolean(poster),
      });
      if (!start.ok) throw new Error(start.error);
      const contentType = mime || (it.kind === "video" ? "video/mp4" : "application/octet-stream");

      const onProgress = (sent: number) => patch(it.id, { sent });
      if (start.resumable) {
        await tusSigned({ endpoint: start.endpoint, anonKey: start.anonKey, key: start.key, token: start.token, file, contentType, onProgress });
      } else {
        await putSigned(start.key, start.token, file, contentType, onProgress);
      }

      let posterKey: string | null = null;
      if (poster && start.posterKey && start.posterToken) {
        try {
          await putSigned(start.posterKey, start.posterToken, poster, "image/jpeg");
          posterKey = start.posterKey;
        } catch {
          /* the video still works without its poster */
        }
      }

      const fin = await finishDirectUploadAction({
        key: start.key,
        filename: file.name,
        size: file.size,
        width,
        height,
        posterKey,
        title: single ? meta.title : "",
        usageType: meta.usageType,
        tags: meta.tags,
        altText: meta.altText,
        status: meta.status,
      });
      if (!fin.ok) throw new Error(fin.error);
      // R54: show the web-optimisation saving when the server converted it.
      patch(it.id, { state: "done", sent: file.size, message: fin.note ? (note ? `${fin.note} ${note}` : fin.note) : note });
      return true;
    } catch (e) {
      const raw = (e as Error)?.message ?? String(e);
      // Our own plain-English errors pass through; raw storage errors are translated.
      const friendly = /^\d{3}\b|network|timeout|signature|payload|jwt/i.test(raw) ? friendlyStorageError(raw, file.size) : raw;
      patch(it.id, { state: "error", message: friendly });
      return false;
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const queue = items.filter((i) => i.state === "ready" || i.state === "error");
    if (queue.length === 0 || busy) return;
    const fd = new FormData(e.currentTarget);
    const meta = {
      title: String(fd.get("title") ?? ""),
      usageType: String(fd.get("usage_type") ?? ""),
      tags: String(fd.get("tags") ?? ""),
      altText: String(fd.get("alt_text") ?? ""),
      status: String(fd.get("status") ?? "draft"),
    };
    setBusy(true);
    setSummary(null);
    let okCount = 0;
    // One at a time: keeps each upload fast and the progress honest.
    for (const it of queue) {
      if (await uploadOne(it, meta, queue.length === 1)) okCount++;
    }
    setBusy(false);
    const failed = queue.length - okCount;
    setSummary(
      failed === 0
        ? `Uploaded ${okCount} file${okCount === 1 ? "" : "s"}.`
        : `Uploaded ${okCount} of ${queue.length}. ${failed} need attention — see the message under each file, fix, and press Upload again to retry.`,
    );
    if (okCount > 0) router.refresh();
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }

  const pending = items.filter((i) => i.state === "ready" || i.state === "error").length;

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
      <p className="text-sm font-semibold text-white">Upload media</p>

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-disabled={busy}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center transition ${
          dragging
            ? "border-[var(--admin-accent)] bg-[var(--admin-accent)]/10"
            : "border-white/20 bg-black hover:border-[var(--admin-accent)]/50 hover:bg-white/[0.02]"
        }`}
      >
        <span className="text-3xl">⬆️</span>
        <p className="text-sm font-semibold text-white">
          Drag &amp; drop images or videos here, or <span className="text-[var(--admin-accent)]">click to browse</span>
        </p>
        <p className="text-xs text-white/40">
          Images (PNG, JPG, WEBP, GIF, SVG) up to {UPLOAD_MAX_LABEL.image} · Videos (MP4, WEBM) up to {UPLOAD_MAX_LABEL.video} · PDF up to{" "}
          {UPLOAD_MAX_LABEL.document} · Lottie (.lottie, .json) & Rive (.riv) animations up to {UPLOAD_MAX_LABEL.animation}
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={UPLOAD_ACCEPT_ATTR}
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = ""; // allow re-picking the same file
          }}
        />
      </div>

      {/* Queue */}
      {items.length > 0 && (
        <ul className="space-y-2" aria-live="polite">
          {items.map((it) => {
            const pct = it.file.size > 0 ? Math.min(100, Math.round((it.sent / it.file.size) * 100)) : 0;
            const tone =
              it.state === "blocked" || it.state === "error"
                ? "text-amber-200"
                : it.state === "done"
                  ? "text-emerald-300"
                  : "text-white/50";
            return (
              <li key={it.id} className="flex gap-3 rounded-lg border border-white/10 bg-black p-2">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-white/10 bg-[#111]">
                  {it.kind === "image" && it.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img loading="lazy" decoding="async" src={it.url} alt="" className="h-full w-full object-contain" />
                  ) : it.kind === "video" && it.url ? (
                    <video src={it.url} muted playsInline preload="metadata" className="h-full w-full object-cover" aria-hidden="true" />
                  ) : (
                    <span className="text-2xl">{it.kind === "animation" ? "🎞️" : "📄"}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs font-medium text-white" title={it.file.name}>
                      {it.kind === "video" ? "🎬 " : ""}
                      {it.file.name}
                    </p>
                    <span className="shrink-0 text-[0.65rem] text-white/40">{formatBytes(it.file.size)}</span>
                  </div>
                  {it.state === "uploading" || it.state === "done" ? (
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-white/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Uploading ${it.file.name}`}>
                      <div className={`h-full ${it.state === "done" ? "bg-emerald-400" : "bg-[var(--admin-accent)]"}`} style={{ width: `${pct}%` }} />
                    </div>
                  ) : null}
                  <p className={`mt-1 text-[0.7rem] ${tone}`}>
                    {it.state === "uploading"
                      ? `Uploading… ${pct}%`
                      : it.state === "done"
                        ? "✓ Uploaded"
                        : it.state === "blocked"
                          ? "Can't upload"
                          : it.state === "error"
                            ? "Upload failed"
                            : "Ready"}
                    {it.message ? ` — ${it.message}` : ""}
                  </p>
                </div>
                {it.state !== "uploading" && !busy ? (
                  <button type="button" onClick={() => remove(it.id)} className="self-start text-xs text-white/40 hover:text-white" aria-label={`Remove ${it.file.name}`}>
                    ✕
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {/* Smart metadata: WHAT / WHY / WHERE so the library stays organised. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-white/50">
            What is it? <span className="text-white/30">(title — used when uploading a single file)</span>
          </span>
          <input name="title" placeholder="e.g. Spring Sale Hero, Sticky Lemon Brand Logo" className={FIELD} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-white/50">
            Why / purpose <span className="text-white/30">(category)</span>
          </span>
          <select name="usage_type" className={FIELD}>
            <option value="">— choose a purpose —</option>
            {MEDIA_PURPOSES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-white/50">Status</span>
          <select name="status" defaultValue="draft" className={FIELD}>
            <option value="draft">Draft (staff only)</option>
            <option value="published">Published (public)</option>
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-white/50">
            Where will it go? <span className="text-white/30">(placement tags, comma separated)</span>
          </span>
          <input name="tags" list="placement-suggestions" placeholder="home-hero, menu-banner" className={FIELD} />
          <datalist id="placement-suggestions">
            {PLACEMENT_SUGGESTIONS.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-white/50">
            Alt text <span className="text-white/30">(accessibility — describe the image; videos on banners are decorative)</span>
          </span>
          <input name="alt_text" placeholder="Describe what's in the image" className={FIELD} />
        </label>
      </div>

      {summary ? (
        <div role="status" className="rounded-lg border border-white/15 bg-white/[0.03] p-3 text-xs text-white/80">
          {summary}
        </div>
      ) : null}

      <Button type="submit" variant="confirm" disabled={busy || pending === 0}>
        {busy ? "Uploading…" : pending > 1 ? `Upload ${pending} files` : "Upload"}
      </Button>

      {/* Canva size cheat-sheet — create art at the right size the first time. */}
      <details className="rounded-xl border border-white/10 bg-black/40 p-4 text-xs text-white/70">
        <summary className="cursor-pointer select-none font-semibold text-[var(--admin-accent)]">
          🎨 Canva size cheat-sheet — build art at the right size
        </summary>
        <p className="mt-2 text-white/45">
          Create a custom-size canvas in Canva using these dimensions, then export as WebP or PNG. Design textless art — headings and
          buttons are layered on top automatically.
        </p>
        <p className="mt-2 text-white/45">
          <strong className="text-white/70">Moving banner?</strong> Export an <strong className="text-white/70">MP4 Video</strong> at the
          same size (Canva → Share → Download → MP4 Video, 1080p). Keep it a 5–15 second loop with no important text in the motion, and
          aim for under 8 MB. An MP4 is usually 5–10× smaller than the same animation as a GIF, so it loads faster for shoppers. Banner
          videos play silently on loop; shoppers who turn on “reduce motion” see the still poster instead, and everyone gets a pause
          button.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-left">
            <thead className="text-[0.65rem] uppercase tracking-wide text-white/40">
              <tr>
                <th className="py-1 pr-4">Slot</th>
                <th className="py-1 pr-4">Canva size</th>
                <th className="py-1">Aspect</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {imageSpecCheatSheet().map((s) => (
                <tr key={s.id}>
                  <td className="py-1.5 pr-4 text-white/70">{s.title}</td>
                  <td className="py-1.5 pr-4 font-mono text-white">
                    {s.presets[0].width}×{s.presets[0].height}
                    {s.transparent ? " (transparent PNG)" : ""}
                  </td>
                  <td className="py-1.5 font-mono text-white/50">{s.aspectLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </form>
  );
}
