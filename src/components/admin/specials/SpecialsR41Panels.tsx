"use client";

/**
 * R41 S4 — Specials editor additions:
 *   • HeroButtonsCard: add / edit / remove / reorder / repoint the TOP hero
 *     buttons (max 4), with the shared LinkPicker (filtered menu, category,
 *     blog post / newsletter, page, phone/email, outside link).
 *   • DesignCard: the "🎨 Custom design" toggle + Banner Studio for the TOP
 *     hero and the Today's Deal banner.
 *
 * State lives in SpecialsPresentationEditor (the one presentation JSON); these
 * are controlled components. Everything is re-normalized server-side when the
 * presentation is read (normalizeSpecialsPresentation), so the client is never
 * trusted.
 */
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { Button } from "@/components/admin/ui";
import type { MediaChoice } from "@/components/admin/ContentImageField";
import { LinkPicker, type PickerPost } from "@/components/admin/banner-studio/LinkPicker";
import { checkHref, describeHref } from "@/lib/cms/link-target-core";
import { designFromLegacy, type BannerDesign, type DesignBind, type DesignPreset } from "@/lib/cms/banner-design-core";
import {
  MAX_SPECIALS_HERO_BUTTONS,
  MAX_SPECIALS_HERO_BUTTON_LABEL,
  type SpecialsHeroButton,
} from "@/lib/specials/specials-presentation-core";

const BannerStudio = dynamic(() => import("@/components/admin/banner-studio/BannerStudio"), {
  ssr: false,
  loading: () => <p className="text-xs text-[var(--admin-text-muted)]">Loading the design studio…</p>,
});

const INPUT =
  "w-full rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm text-[var(--admin-text)] placeholder:text-[var(--admin-text-faint)] focus:border-[var(--admin-accent)] focus:outline-none";
const CARD = "rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4";

const VARIANT_LABEL: Record<SpecialsHeroButton["variant"], string> = {
  solid: "Filled (green)",
  outline: "Outline",
  ghost: "Text link",
};

const noEnter = (e: React.KeyboardEvent) => {
  if (e.key === "Enter") e.preventDefault();
};

export function HeroButtonsCard({
  buttons,
  isSet,
  legacyButtons,
  posts,
  onChange,
}: {
  buttons: SpecialsHeroButton[];
  /** False until the owner saves buttons here (legacy row buttons render). */
  isSet: boolean;
  /** The buttons the live page shows today (from the old specials.hero row). */
  legacyButtons: SpecialsHeroButton[];
  posts: PickerPost[];
  onChange: (buttons: SpecialsHeroButton[], isSet: boolean) => void;
}) {
  const [picking, setPicking] = useState<number | null>(null);
  const blogTitles = useMemo(() => Object.fromEntries(posts.map((p) => [p.slug, p.title])), [posts]);
  // Before the first save here, show the live (legacy) buttons as the
  // starting point so the owner edits what customers actually see.
  const list = isSet ? buttons : legacyButtons;

  const commit = (next: SpecialsHeroButton[]) => onChange(next.slice(0, MAX_SPECIALS_HERO_BUTTONS), true);
  const update = (i: number, patch: Partial<SpecialsHeroButton>) =>
    commit(list.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };

  return (
    <div className={CARD}>
      <div className="mb-1 flex flex-wrap items-center gap-2 text-sm font-semibold">
        Hero buttons
        <span className="rounded-full border border-[var(--admin-border)] px-2 py-0.5 text-[0.6rem] font-semibold text-[var(--admin-text-muted)]">
          {list.length} / {MAX_SPECIALS_HERO_BUTTONS}
        </span>
      </div>
      <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
        The buttons under the hero wording. Add up to {MAX_SPECIALS_HERO_BUTTONS}, change the words, pick where
        each one goes, put them in order, or remove them all. Changes go live when you Publish.
        {!isSet ? " These are the buttons your page shows right now." : ""}
      </p>
      {list.length === 0 ? (
        <p className="mb-3 text-xs text-[var(--admin-gold)]">No buttons. The hero shows just the wording.</p>
      ) : null}
      <ol className="space-y-3">
        {list.map((b, i) => {
          const check = checkHref(b.href);
          return (
            <li key={i} className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-[var(--admin-text-muted)]">Button {i + 1}</span>
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label={`Move button ${i + 1} earlier`}
                  className="rounded px-1.5 text-xs hover:bg-[var(--admin-surface-hover)] disabled:opacity-30"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === list.length - 1}
                  aria-label={`Move button ${i + 1} later`}
                  className="rounded px-1.5 text-xs hover:bg-[var(--admin-surface-hover)] disabled:opacity-30"
                >
                  ▼
                </button>
                <label className="ml-auto inline-flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={b.enabled}
                    onChange={(e) => update(i, { enabled: e.target.checked })}
                  />
                  Show
                </label>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={() => commit(list.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <label className="text-xs">
                  <span className="mb-1 block text-[var(--admin-text-muted)]">Button words</span>
                  <input
                    className={INPUT}
                    value={b.label}
                    maxLength={MAX_SPECIALS_HERO_BUTTON_LABEL}
                    onChange={(e) => update(i, { label: e.target.value })}
                    onKeyDown={noEnter}
                  />
                </label>
                <label className="text-xs">
                  <span className="mb-1 block text-[var(--admin-text-muted)]">Look</span>
                  <select
                    className={INPUT}
                    value={b.variant}
                    onChange={(e) => update(i, { variant: e.target.value as SpecialsHeroButton["variant"] })}
                  >
                    {(Object.keys(VARIANT_LABEL) as SpecialsHeroButton["variant"][]).map((v) => (
                      <option key={v} value={v}>
                        {VARIANT_LABEL[v]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mt-2">
                <span className="mb-1 block text-xs text-[var(--admin-text-muted)]">Where it goes</span>
                <div className="flex gap-2">
                  <input
                    aria-label={`Button ${i + 1} link`}
                    className={INPUT}
                    value={b.href}
                    onChange={(e) => update(i, { href: e.target.value })}
                    onKeyDown={noEnter}
                  />
                  <Button type="button" variant="neutral" size="sm" onClick={() => setPicking(i)}>
                    Pick a link…
                  </Button>
                </div>
                <p className="mt-1 text-xs text-[var(--admin-text-muted)]">→ {describeHref(b.href, { blogTitles })}</p>
                {check.message ? (
                  <p className={`mt-1 text-xs ${check.level === "block" ? "text-[var(--admin-danger)]" : "text-[var(--admin-gold)]"}`}>
                    {check.level === "block" ? `${check.message} This button will be removed when saved.` : check.message}
                  </p>
                ) : null}
                {!b.label.trim() || !b.href.trim() ? (
                  <p className="mt-1 text-xs text-[var(--admin-gold)]">
                    A button needs both words and a link, or it won&rsquo;t show.
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="neutral"
          disabled={list.length >= MAX_SPECIALS_HERO_BUTTONS}
          onClick={() => commit([...list, { label: "Shop the menu", href: "/menu", variant: "solid", enabled: true }])}
        >
          ＋ Add button
        </Button>
        {isSet ? (
          <Button type="button" variant="neutral" onClick={() => onChange([], false)}>
            Go back to the old buttons
          </Button>
        ) : null}
      </div>
      {picking !== null && list[picking] ? (
        <LinkPicker
          value={list[picking].href}
          posts={posts}
          onPick={(href) => {
            update(picking, { href });
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      ) : null}
    </div>
  );
}

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
              onChange(design ? { ...design, enabled: true } : designFromLegacy({ ...seed, preset }));
              setOpen(true);
            } else if (design) {
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
