"use client";

/**
 * R61 S1 — THE one shared banner-editor shell.
 *
 * Every banner editor in the admin (home carousel slides, page sections such
 * as the home Types / Brands banners, the Shop carousel, the Loyalty hero, the
 * Specials top hero and Today's Deal banner, and — R61 S3 — the home Type
 * cards and the Specials weekday cards) goes through these two pieces:
 *
 *   • <DesignCard>  — the "Use custom design" switch + the lazy Banner Studio.
 *   • <BasicMode>   — the collapsed "classic fields" drawer under the studio.
 *
 * So the owner only ever edits / enhances ONE version: change the studio, this
 * shell, or the public <DesignedBanner> and every page editor updates at once.
 * Data models stay per page (each editor keeps its own save action); only the
 * UI is shared.
 */
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/admin/ui";
import type { MediaChoice } from "@/components/admin/ContentImageField";
import type { PickerPost } from "@/components/admin/banner-studio/LinkPicker";
import { designFromLegacy, type BannerDesign, type DesignBind, type DesignPreset } from "@/lib/cms/banner-design-core";
import type { BrandSaved } from "@/lib/brand/brand-kit-core";
import { listBrandBannersAction, saveBrandBannerAction } from "@/app/admin/settings/branding/brand-actions";

/**
 * R64: the Brand hub's saved banners inside every Design Studio — start from
 * one (replaces this design, still needs Save draft) or save this design to
 * the brand kit's library.
 */
function BrandBannersRow({ design, imageSrc, onPick }: { design: BannerDesign; imageSrc: string; onPick: (d: BannerDesign) => void }) {
  const [list, setList] = useState<BrandSaved[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = async () => {
    setBusy(true);
    setMsg(null);
    try {
      setList(await listBrandBannersAction());
    } catch {
      setMsg("Couldn't load the saved brand banners.");
    }
    setBusy(false);
  };
  return (
    <div className="rounded-lg border border-white/10 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Brand banners:</span>
        <Button type="button" variant="neutral" size="sm" disabled={busy} onClick={() => void (list ? setList(null) : load())}>
          {list ? "Hide saved brand banners" : "Start from a saved brand banner"}
        </Button>
        <Button
          type="button"
          variant="neutral"
          size="sm"
          disabled={busy}
          onClick={async () => {
            const name = window.prompt("Name for this saved brand banner:", "Saved banner");
            if (name === null) return;
            setBusy(true);
            const r = await saveBrandBannerAction({ name, image: imageSrc, design }).catch(() => ({ ok: false as const, error: "Couldn't save it." }));
            setBusy(false);
            if (r.ok) {
              setMsg("Saved to Website → Branding → Saved banners.");
              if (list) setList(r.banners);
            } else setMsg(r.error);
          }}
        >
          Save this design to brand banners
        </Button>
      </div>
      {msg ? <p className="mt-1 text-[var(--admin-gold)]">{msg}</p> : null}
      {list ? (
        list.length === 0 ? (
          <p className="mt-2 text-[var(--admin-text-muted)]">No saved brand banners yet — add some in Website → Branding.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {list.map((b) => (
              <button
                key={b.id}
                type="button"
                className="rounded border border-white/15 px-2 py-1 hover:border-[var(--admin-accent)]"
                onClick={() => {
                  if (!window.confirm(`Replace this design with "${b.name}"? (Your picture stays; Save draft to keep it.)`)) return;
                  onPick({ ...b.design, enabled: true });
                  setMsg(`Loaded "${b.name}" — Save draft to keep it.`);
                }}
              >
                {b.name}
              </button>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}

const BannerStudio = dynamic(() => import("@/components/admin/banner-studio/BannerStudio"), {
  ssr: false,
  loading: () => <p className="text-xs text-[var(--admin-text-muted)]">Loading the design studio…</p>,
});

const CARD = "rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4";

export function DesignCard({
  title,
  description,
  design,
  onChange,
  legacy,
  imageSrc,
  imageAlt,
  preset,
  seed,
  posts,
  mediaChoices,
  onLegacyEdit,
  makeNew,
  brandBanners = true,
}: {
  title: string;
  description: string;
  design: BannerDesign | null;
  onChange: (d: BannerDesign | null) => void;
  legacy: { eyebrow?: string; title?: string; subtitle?: string };
  imageSrc: string;
  imageAlt: string;
  preset: DesignPreset;
  /** Today's classic look, so turning design on starts from what's live. */
  seed: Parameters<typeof designFromLegacy>[0];
  posts: PickerPost[];
  /** R42 Q4: media library choices for the optional phone picture. */
  mediaChoices?: MediaChoice[];
  /** R53: double-click editing of a bound text box writes the banner's own field. */
  onLegacyEdit?: (bind: NonNullable<DesignBind>, text: string) => void;
  /** R61 S3: optional custom first design (e.g. a card-shaped frame). */
  makeNew?: () => BannerDesign;
  /** R64: show the "saved brand banners" row (off inside the Brand hub itself). */
  brandBanners?: boolean;
}) {
  // R53: the studio is open by default (owner: studio first, basic second).
  const [open, setOpen] = useState(true);
  const on = !!design?.enabled;
  return (
    <div className={CARD}>
      <div className="mb-1 text-sm font-semibold">🎨 {title}</div>
      <p className="mb-3 text-xs text-[var(--admin-text-muted)]">{description}</p>
      <label className="inline-flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            if (e.target.checked) {
              onChange(
                design ? { ...design, enabled: true } : makeNew ? makeNew() : designFromLegacy({ ...seed, preset }),
              );
              setOpen(true);
            } else if (design) {
              // Keep the design stored but switched off (ticking again restores it).
              onChange({ ...design, enabled: false });
            }
          }}
          className="h-4 w-4 accent-[var(--admin-accent)]"
        />
        Use custom design
      </label>
      {design && !on ? (
        <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
          Your custom design is saved but switched off, so the classic look shows. Tick the box to bring it back.
        </p>
      ) : null}
      {on && design ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="neutral" size="sm" onClick={() => setOpen((v) => !v)}>
              {open ? "Hide design studio" : "Open design studio"}
            </Button>
          </div>
          {brandBanners ? <BrandBannersRow design={design} imageSrc={imageSrc} onPick={(d) => onChange(d)} /> : null}
          {open ? (
            <BannerStudio
              design={design}
              onChange={(d) => onChange(d)}
              legacy={legacy}
              imageSrc={imageSrc}
              imageAlt={imageAlt}
              posts={posts}
              mediaChoices={mediaChoices}
              onLegacyEdit={onLegacyEdit}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The classic fields, collapsed under the studio. A native <details> keeps
 * every field mounted inside its form, so closed fields still save.
 */
export function BasicMode({
  hint = "classic words, buttons, focus and text position",
  defaultOpen = false,
  children,
}: {
  hint?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="rounded-lg border border-white/10 p-3" open={defaultOpen || undefined}>
      <summary className="cursor-pointer text-sm font-semibold">
        Basic mode <span className="font-normal opacity-60">({hint})</span>
      </summary>
      <div className="mt-4 space-y-4">{children}</div>
    </details>
  );
}
