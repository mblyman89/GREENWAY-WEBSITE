"use client";

/**
 * MediaDropzone — a drag-and-drop upload surface for the Media Library (UX-4).
 * Wraps the existing uploadMediaAction (multipart form): users can drag files
 * onto the zone or click to browse, see thumbnail previews of what they're
 * about to upload, then set usage/tags/alt/status and submit. No new server
 * endpoint — same action, nicer experience.
 */
import { useRef, useState } from "react";
import { MEDIA_PURPOSES, PLACEMENT_SUGGESTIONS } from "@/lib/media/taxonomy";

type Preview = { name: string; url: string; isImage: boolean };

export function MediaDropzone({
  uploadAction,
}: {
  uploadAction: (formData: FormData) => void | Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [previews, setPreviews] = useState<Preview[]>([]);

  function buildPreviews(files: FileList | null) {
    if (!files) return;
    const next: Preview[] = [];
    for (const f of Array.from(files)) {
      const isImage = f.type.startsWith("image/");
      next.push({ name: f.name, url: isImage ? URL.createObjectURL(f) : "", isImage });
    }
    setPreviews(next);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files && inputRef.current) {
      inputRef.current.files = e.dataTransfer.files;
      buildPreviews(e.dataTransfer.files);
    }
  }

  return (
    <form
      action={uploadAction}
      encType="multipart/form-data"
      className="space-y-4 rounded-xl border border-white/10 bg-[#0a0a0a] p-5"
    >
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
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center transition ${
          dragging
            ? "border-[#7ed957] bg-[#7ed957]/10"
            : "border-white/20 bg-black hover:border-[#7ed957]/50 hover:bg-white/[0.02]"
        }`}
      >
        <span className="text-3xl">⬆️</span>
        <p className="text-sm font-semibold text-white">
          Drag &amp; drop images here, or <span className="text-[#7ed957]">click to browse</span>
        </p>
        <p className="text-xs text-white/40">PNG, JPG, WEBP, GIF, SVG, or PDF · up to 10 MB each</p>
        <input
          ref={inputRef}
          type="file"
          name="files"
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,application/pdf"
          className="hidden"
          onChange={(e) => buildPreviews(e.target.files)}
        />
      </div>

      {/* Previews */}
      {previews.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-white/50">
            {previews.length} file{previews.length === 1 ? "" : "s"} ready to upload
          </p>
          <div className="flex flex-wrap gap-2">
            {previews.map((p, i) => (
              <div
                key={i}
                className="flex h-20 w-20 flex-col items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black"
                title={p.name}
              >
                {p.isImage && p.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.url} alt={p.name} className="h-full w-full object-contain" />
                ) : (
                  <span className="text-2xl">📄</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Smart metadata: WHAT / WHY / WHERE so the library stays organised. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-white/50">
            What is it? <span className="text-white/30">(title)</span>
          </span>
          <input
            name="title"
            placeholder="e.g. Spring Sale Hero, Sticky Lemon Brand Logo"
            className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-white/50">
            Why / purpose <span className="text-white/30">(category)</span>
          </span>
          <select
            name="usage_type"
            className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
          >
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
          <select
            name="status"
            defaultValue="draft"
            className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
          >
            <option value="draft">Draft (staff only)</option>
            <option value="published">Published (public)</option>
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-white/50">
            Where will it go? <span className="text-white/30">(placement tags, comma separated)</span>
          </span>
          <input
            name="tags"
            list="placement-suggestions"
            placeholder="home-hero, menu-banner"
            className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
          />
          <datalist id="placement-suggestions">
            {PLACEMENT_SUGGESTIONS.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-white/50">
            Alt text <span className="text-white/30">(accessibility — describe the image)</span>
          </span>
          <input
            name="alt_text"
            placeholder="Describe what's in the image"
            className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
          />
        </label>
      </div>
      <button
        type="submit"
        className="rounded-full bg-[#7ed957] px-5 py-2 text-sm font-semibold text-black hover:bg-[#6cc746]"
      >
        Upload
      </button>
    </form>
  );
}
