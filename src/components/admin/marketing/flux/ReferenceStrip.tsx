"use client";

/**
 * ReferenceStrip — FLUX reference images, labelled exactly as FLUX sees them:
 * the first is "image 1", the second "image 2", … (BFL: refer to references by
 * position and put the base image first). Reorder, remove, pick from the media
 * library, or upload. Large uploads are downscaled in the browser so they fit
 * the 4.5 MB request limit (BFL downsizes oversized references anyway).
 */
import { useRef, useState } from "react";
import { uploadFluxReferenceAction } from "@/app/admin/marketing/midjourney/actions";
import { MEDIA_UPLOAD_MAX_BYTES } from "@/lib/media/gif-core";
import { useToast } from "@/components/admin/ux";

export type RefImage = { id: string; url: string; label: string };

const ACCEPT = "image/png,image/jpeg,image/webp";
const MAX_EDGE = 2048;

/** Re-encode a too-big image to fit the upload cap (keeps alpha via WebP). */
async function shrinkImage(file: File): Promise<File> {
  if (file.size <= MEDIA_UPLOAD_MAX_BYTES) return file;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const type = file.type === "image/png" ? "image/webp" : "image/jpeg";
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.92));
  if (!blob) return file;
  const ext = type === "image/webp" ? "webp" : "jpg";
  return new File([blob], file.name.replace(/\.[a-z0-9]+$/i, "") + "." + ext, { type });
}

export function ReferenceStrip({
  value,
  onChange,
  max,
  library,
  onLibraryAdd,
}: {
  value: RefImage[];
  onChange: (next: RefImage[]) => void;
  max: number;
  library: RefImage[];
  onLibraryAdd: (r: RefImage) => void;
}) {
  const { toast } = useToast();
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const free = max - value.length;

  function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const next = value.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  function toggle(r: RefImage) {
    if (value.some((v) => v.url === r.url)) onChange(value.filter((v) => v.url !== r.url));
    else if (free > 0) onChange([...value, r]);
    else toast({ tone: "error", message: `This model takes up to ${max} reference images.` });
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    if (free <= 0) {
      toast({ tone: "error", message: `This model takes up to ${max} reference images. Remove one first.` });
      return;
    }
    setUploading(true);
    const added: RefImage[] = [];
    try {
      for (const f of Array.from(files).slice(0, free)) {
        if (!ACCEPT.split(",").includes(f.type)) {
          toast({ tone: "error", message: `${f.name}: use PNG, JPEG or WebP.` });
          continue;
        }
        const file = await shrinkImage(f).catch(() => f);
        const fd = new FormData();
        fd.set("file", file);
        const res = await uploadFluxReferenceAction(fd);
        if (res.ok) {
          added.push(res.reference);
          onLibraryAdd(res.reference);
        } else toast({ tone: "error", message: res.error });
      }
      if (added.length) onChange([...value, ...added].slice(0, max));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const q = filter.trim().toLowerCase();
  const shown = (q ? library.filter((r) => r.label.toLowerCase().includes(q)) : library).slice(0, 120);

  return (
    <div>
      <div className="flex flex-wrap items-start gap-2">
        {value.map((r, i) => (
          <figure key={r.url} className="group relative w-[92px] overflow-hidden rounded-lg border border-[var(--admin-border-strong)] bg-[var(--admin-canvas)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img loading="lazy" decoding="async" src={r.url} alt={r.label} className="h-[72px] w-full object-cover" />
            <figcaption className="truncate px-1.5 py-1 text-[0.65rem] font-bold text-[var(--admin-accent)]" title={r.label}>
              image {i + 1}
            </figcaption>
            <div className="absolute inset-x-0 top-0 flex justify-between gap-0.5 p-0.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
              <button type="button" aria-label={`Move image ${i + 1} left`} onClick={() => move(i, -1)} disabled={i === 0} className="rounded bg-black/70 px-1.5 text-xs text-white disabled:opacity-30">‹</button>
              <button type="button" aria-label={`Remove image ${i + 1}`} onClick={() => onChange(value.filter((_, k) => k !== i))} className="rounded bg-black/70 px-1.5 text-xs text-white">✕</button>
              <button type="button" aria-label={`Move image ${i + 1} right`} onClick={() => move(i, 1)} disabled={i === value.length - 1} className="rounded bg-black/70 px-1.5 text-xs text-white disabled:opacity-30">›</button>
            </div>
          </figure>
        ))}
        {free > 0 && (
          <div className="flex h-[96px] w-[92px] flex-col gap-1">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="flex-1 rounded-lg border border-dashed border-[var(--admin-border-strong)] text-[0.7rem] font-semibold text-[var(--admin-text-muted)] hover:border-[var(--admin-accent)] hover:text-[var(--admin-accent)] disabled:opacity-50">
              {uploading ? "Uploading…" : "⬆ Upload"}
            </button>
            <button type="button" onClick={() => setPicking((p) => !p)} className="flex-1 rounded-lg border border-dashed border-[var(--admin-border-strong)] text-[0.7rem] font-semibold text-[var(--admin-text-muted)] hover:border-[var(--admin-accent)] hover:text-[var(--admin-accent)]">
              {picking ? "Close library" : "🖼 Library"}
            </button>
          </div>
        )}
        <input ref={fileRef} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => void upload(e.target.files)} />
      </div>
      <p className="mt-1.5 text-[0.7rem] text-[var(--admin-text-faint)]">
        {value.length}/{max} · In your prompt, call them <strong>image 1</strong>, <strong>image 2</strong>… and say what each one is for. Put the base image first.
      </p>

      {picking && (
        <div className="mt-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-canvas)] p-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search your media library…"
            className="mb-2 w-full rounded-md border border-[var(--admin-border-strong)] bg-[var(--admin-surface-2)] px-2 py-1.5 text-xs text-[var(--admin-text)] outline-none focus:border-[var(--admin-accent)]"
          />
          {shown.length === 0 ? (
            <p className="p-2 text-xs text-[var(--admin-text-muted)]">No images found. Upload one instead.</p>
          ) : (
            <div className="grid max-h-64 grid-cols-4 gap-1.5 overflow-y-auto sm:grid-cols-6">
              {shown.map((r) => {
                const idx = value.findIndex((v) => v.url === r.url);
                return (
                  <button
                    key={r.url}
                    type="button"
                    onClick={() => toggle(r)}
                    title={r.label}
                    className={`relative overflow-hidden rounded-md border-2 ${idx >= 0 ? "border-[var(--admin-accent)]" : "border-transparent hover:border-[var(--admin-border-strong)]"}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.url} alt={r.label} loading="lazy" className="aspect-square w-full object-cover" />
                    {idx >= 0 && <span className="absolute left-0.5 top-0.5 rounded bg-[var(--admin-accent)] px-1 text-[0.6rem] font-bold text-black">image {idx + 1}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
