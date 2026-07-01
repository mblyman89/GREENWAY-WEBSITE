"use client";

/**
 * ContentImageField — the editor control for an "image" content block.
 *
 * A banner/image block stores a single string: the public URL or site-relative
 * path of the image (e.g. "/home/hero-banner.webp" or a Supabase media public
 * URL). This control lets a non-technical editor:
 *   - see a live thumbnail of the current draft image
 *   - pick from the published Media Library (grid of thumbnails)
 *   - or paste a direct image URL / path
 *
 * It is intentionally NOT a free uploader here — uploads happen in the Media
 * Library so every asset is catalogued. This keeps the content model clean and
 * gives the editor a curated, on-brand set of images to choose from.
 *
 * The chosen value is mirrored into a hidden input (name="draft_value") so the
 * parent <form action={saveDraftAction}> submits it exactly like a text block.
 */
import { useMemo, useState } from "react";
import type { ImageSpec } from "@/lib/cms/image-spec-core";
import { ImageSpecHelper } from "@/components/admin/ImageSpecHelper";

export type MediaChoice = {
  id: string;
  url: string;
  title: string;
  usageType: string | null;
};

export function ContentImageField({
  value,
  onChange,
  mediaChoices,
  spec,
}: {
  value: string;
  onChange: (next: string) => void;
  mediaChoices: MediaChoice[];
  /** Optional Canva-ready sizing hint for this slot. */
  spec?: ImageSpec;
}) {
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState("");
  const [broken, setBroken] = useState(false);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return mediaChoices;
    return mediaChoices.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        (m.usageType ?? "").toLowerCase().includes(q) ||
        m.url.toLowerCase().includes(q),
    );
  }, [mediaChoices, filter]);

  function choose(url: string) {
    setBroken(false);
    onChange(url);
    setPicking(false);
  }

  return (
    <div className="space-y-2">
      {/* Live thumbnail preview */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="relative h-24 w-44 shrink-0 overflow-hidden rounded-lg border border-white/15 bg-[#050505]">
          {value && !broken ? (
            // Plain <img> (not next/image) so any path/URL renders without
            // remote-domain config; this is the editor preview only.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value}
              alt="Current banner"
              className="h-full w-full object-cover"
              onError={() => setBroken(true)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-center text-[0.65rem] text-white/40">
              {broken ? "Image not found" : "No image set"}
            </div>
          )}
        </div>

        <div className="min-w-[12rem] flex-1 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setPicking((p) => !p)}
              className="rounded-lg border border-[#7ed957]/40 bg-[#7ed957]/10 px-3 py-1.5 text-xs font-bold text-[#7ed957] transition hover:bg-[#7ed957]/20"
            >
              🖼 Choose from Media Library
            </button>
            {value && (
              <button
                type="button"
                onClick={() => choose("")}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/60 hover:bg-white/10"
              >
                Clear
              </button>
            )}
          </div>
          <label className="block text-[0.65rem] font-semibold uppercase tracking-wide text-white/40">
            …or paste an image path / URL
          </label>
          <input
            type="text"
            value={value}
            onChange={(e) => {
              setBroken(false);
              onChange(e.target.value);
            }}
            placeholder="/home/hero-banner.webp  or  https://…"
            className="w-full rounded-lg border border-white/15 bg-black px-3 py-1.5 text-xs text-white outline-none focus:border-[#7ed957]"
          />
        </div>
      </div>

      {/* Canva-ready sizing hint for this slot */}
      {spec && <ImageSpecHelper spec={spec} />}

      {/* Media picker grid */}
      {picking && (
        <div className="rounded-lg border border-white/10 bg-black/40 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter images…"
              className="w-full max-w-xs rounded-lg border border-white/15 bg-black px-3 py-1.5 text-xs text-white outline-none focus:border-[#7ed957]"
            />
            <a
              href="/admin/media"
              target="_blank"
              rel="noreferrer"
              className="whitespace-nowrap rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/70 hover:bg-white/10"
            >
              + Upload in Media Library ↗
            </a>
          </div>
          {filtered.length === 0 ? (
            <p className="px-1 py-4 text-center text-xs text-white/40">
              {mediaChoices.length === 0
                ? "No published images yet. Upload images in the Media Library, then they'll appear here."
                : "No images match that filter."}
            </p>
          ) : (
            <div className="grid max-h-72 grid-cols-2 gap-2 overflow-auto sm:grid-cols-3 md:grid-cols-4">
              {filtered.map((m) => {
                const selected = m.url === value;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => choose(m.url)}
                    title={m.title}
                    className={`group relative overflow-hidden rounded-lg border text-left transition ${
                      selected
                        ? "border-[#7ed957] ring-2 ring-[#7ed957]"
                        : "border-white/10 hover:border-white/30"
                    }`}
                  >
                    <div className="relative aspect-[16/10] w-full bg-[#050505]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={m.url}
                        alt={m.title}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="truncate px-1.5 py-1 text-[0.6rem] text-white/60">
                      {m.title}
                    </div>
                    {selected && (
                      <span className="absolute right-1 top-1 rounded-full bg-[#7ed957] px-1.5 text-[0.6rem] font-bold text-black">
                        ✓
                      </span>
                    )}
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
