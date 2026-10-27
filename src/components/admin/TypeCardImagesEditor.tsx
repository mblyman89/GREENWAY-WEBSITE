"use client";

/**
 * TypeCardImagesEditor — the "Type Cards" tab on the Home page editor.
 *
 * R41 S3: was "six fixed tiles, image only". Now a full card-list editor:
 * rename (Enter = second line), the small "Shop now →" line, link (the shared
 * LinkPicker: filtered menu, category, blog post / newsletter, page, …),
 * image (Media Library), show/hide, reorder (↑/↓ buttons — keyboard and
 * screen-reader friendly, WCAG 2.2 SC 2.5.7), delete, add (max 12) and
 * "Reset to the original six". A live mini preview mirrors the tile grid.
 *
 * Kept the file name + export (F-10) so nothing else churns. The whole list is
 * posted as one hidden `type_cards_json` field and re-normalized on the server
 * (type-cards-core) — the client is never trusted.
 */
import { useMemo, useState } from "react";
import {
  ContentImageField,
  type MediaChoice,
} from "@/components/admin/ContentImageField";
import { Button } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/admin/ux";
import { LinkPicker, type PickerPost } from "@/components/admin/banner-studio/LinkPicker";
import { checkHref, describeHref } from "@/lib/cms/link-target-core";
import {
  DEFAULT_TYPE_CARD_CTA,
  MAX_TYPE_CARDS,
  MAX_TYPE_CARD_CTA,
  MAX_TYPE_CARD_LABEL,
  defaultTypeCards,
  nextTypeCardId,
  normalizeTypeCards,
  normalizeTypeCardAdvanced,
  IMAGE_FOCUSES,
  type TypeCard,
  type TypeCardAdvanced,
} from "@/lib/cms/type-cards-core";
import { HERO_COLORS, HERO_FONTS, heroFontStack, type ImageFocus } from "@/lib/loyalty/loyalty-hero-core";
import { isVideoSrc } from "@/lib/media/upload-policy-core";
import { BasicMode, DesignCard } from "@/components/admin/banner-studio/BannerEditorShell";
import { CardEditorShell } from "@/components/admin/banner-studio/CardEditorShell";
import { DesignedCard } from "@/components/site/DesignedCard";
import { cardDesign } from "@/lib/cms/banner-design-core";

const input =
  "w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-[var(--admin-accent)] focus:outline-none";
const label = "mb-1 block text-[0.68rem] font-semibold uppercase tracking-wide text-white/60";

type Pending = { kind: "delete"; id: string } | { kind: "reset" } | null;

export function TypeCardImagesEditor({
  cards: initialCards,
  isCustom,
  mediaChoices,
  posts = [],
  saveAction,
}: {
  /** Current list (custom list, or the six defaults with legacy images). */
  cards: TypeCard[];
  /** True once the owner has saved a custom list. */
  isCustom: boolean;
  mediaChoices: MediaChoice[];
  /** Published blog posts / newsletters for the link picker. */
  posts?: PickerPost[];
  saveAction: (formData: FormData) => void | Promise<void>;
}) {
  const [cards, setCards] = useState<TypeCard[]>(() => initialCards.map((c) => ({ ...c })));
  const [openId, setOpenId] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);

  const initialJson = useMemo(() => JSON.stringify(normalizeTypeCards(initialCards)), [initialCards]);
  const json = JSON.stringify(normalizeTypeCards(cards));
  const dirty = json !== initialJson;
  const blogTitles = useMemo(() => Object.fromEntries(posts.map((p) => [p.slug, p.title])), [posts]);
  const visible = cards.filter((c) => c.enabled);

  const update = (id: string, patch: Partial<TypeCard>) =>
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  // R47: advanced options; an all-default block is removed (classic tile).
  const updateAdv = (id: string, patch: Partial<TypeCardAdvanced>) =>
    setCards((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const adv = normalizeTypeCardAdvanced({ ...(c.adv ?? {}), ...patch });
        const next = { ...c };
        if (adv) next.adv = adv;
        else delete next.adv;
        return next;
      }),
    );
  const move = (index: number, dir: -1 | 1) =>
    setCards((prev) => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  // R63: opening a card turns its custom design ON by default (the studio is
  // what opens). A design the owner switched off stays off (his choice).
  const openCard = (id: string | null) => {
    setOpenId(id);
    if (!id) return;
    setCards((prev) =>
      prev.map((c) => {
        if (c.id !== id || c.adv?.design) return c;
        const adv = normalizeTypeCardAdvanced({ ...(c.adv ?? {}), design: newCardDesign(c) });
        return adv ? { ...c, adv } : c;
      }),
    );
  };
  const add = () => {
    if (cards.length >= MAX_TYPE_CARDS) return;
    const id = nextTypeCardId(cards);
    setCards([
      ...cards,
      { id, label: "New card", href: "/menu", image: "", cta: DEFAULT_TYPE_CARD_CTA, enabled: true },
    ]);
    openCard(id);
  };

  const pickingCard = cards.find((c) => c.id === picking) ?? null;

  return (
    <form action={saveAction} className="space-y-5">
      <input type="hidden" name="type_cards_json" value={json} />
      {/* R63: the ONE shared card-editor UI (preview strip scrolls sideways). */}
      <CardEditorShell
        icon="🗂️"
        title="Shop by Category — Type Cards"
        count={`${cards.length} / ${MAX_TYPE_CARDS} cards · ${visible.length} showing`}
        dirty={dirty}
        intro={<>These are the tiles under the &ldquo;Shop by Category&rdquo; banner on your homepage. Rename them,
          change where they go, give them a photo, put them in any order, hide or delete them, or add new
          ones (up to {MAX_TYPE_CARDS}). Press Enter in a name to split it onto two lines. Pick square-ish
          photos with no words in them, because the name sits in a bar along the bottom. Changes go live
          when you press Save.</>}
        emptyNote="No cards are showing, so the tile row is hidden on your homepage. The banner above it still shows."
        items={cards.map((c) => ({
          id: c.id,
          name: c.label || "New card",
          sub: `→ ${describeHref(c.href, { blogTitles })}`,
          shown: c.enabled,
          badges: c.image ? (
            <span className="rounded-full bg-[var(--admin-accent)]/15 px-2 py-0.5 text-[0.6rem] font-semibold text-[var(--admin-accent)]">
              photo
            </span>
          ) : null,
          tile: c.adv?.design?.enabled ? (
            <DesignedCard design={c.adv.design} imageSrc={c.image} legacy={{ title: c.label, subtitle: c.cta }} label={c.label} />
          ) : (
            <ClassicTile c={c} />
          ),
        }))}
        openId={openId}
        onOpen={openCard}
        onMove={move}
        onShownChange={(id, enabled) => update(id, { enabled })}
        renderEditor={(id) => {
          const c = cards.find((x) => x.id === id);
          if (!c) return null;
          const check = checkHref(c.href);
          return (
            <>
                  {/* R61-S3: the shared Design Studio, card-shaped (one engine for every banner + card). */}
                  <DesignCard
                    mediaChoices={mediaChoices}
                    title="Card Design Studio"
                    description="Design this card like a banner: move and style the name and small line, add shapes, stickers, animations, smoke and buttons. No buttons = the whole card is the link. Untick to go back to the classic card."
                    design={c.adv?.design ?? null}
                    onChange={(d) => updateAdv(c.id, { design: d ?? undefined })}
                    legacy={{ title: c.label, subtitle: c.cta }}
                    imageSrc={c.image}
                    imageAlt=""
                    preset="section"
                    seed={{ title: c.label, subtitle: c.cta }}
                    makeNew={() => newCardDesign(c)}
                    posts={posts}
                    onLegacyEdit={(bind, text) => {
                      if (bind === "title") update(c.id, { label: text.slice(0, MAX_TYPE_CARD_LABEL) });
                      else if (bind === "subtitle") update(c.id, { cta: text.slice(0, MAX_TYPE_CARD_CTA) });
                    }}
                  />
                  <BasicMode hint="name, link, photo and the classic card options">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-3">
                      <div>
                        <label className={label} htmlFor={`tc-label-${c.id}`}>
                          Card name ({MAX_TYPE_CARD_LABEL} letters max, Enter for a 2nd line)
                        </label>
                        <textarea
                          id={`tc-label-${c.id}`}
                          rows={2}
                          maxLength={MAX_TYPE_CARD_LABEL}
                          value={c.label}
                          onChange={(e) => update(c.id, { label: e.target.value })}
                          className={input}
                        />
                      </div>
                      <div>
                        <label className={label} htmlFor={`tc-cta-${c.id}`}>
                          Small line under the name (leave blank to hide it)
                        </label>
                        <input
                          id={`tc-cta-${c.id}`}
                          maxLength={MAX_TYPE_CARD_CTA}
                          value={c.cta}
                          onChange={(e) => update(c.id, { cta: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.preventDefault();
                          }}
                          className={input}
                        />
                      </div>
                      <div>
                        <span className={label}>Where it goes</span>
                        <div className="flex gap-2">
                          <input
                            aria-label="Card link"
                            value={c.href}
                            onChange={(e) => update(c.id, { href: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.preventDefault();
                            }}
                            className={input}
                          />
                          <Button type="button" variant="neutral" size="sm" onClick={() => setPicking(c.id)}>
                            Pick a link…
                          </Button>
                        </div>
                        <p className="mt-1 text-xs text-white/50">→ {describeHref(c.href, { blogTitles })}</p>
                        {check.message ? (
                          <p
                            className={`mt-1 text-xs ${check.level === "block" ? "text-red-400" : "text-[var(--admin-gold)]"}`}
                          >
                            {check.level === "block"
                              ? `${check.message} This card will go to the menu instead.`
                              : check.message}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <label className="inline-flex items-center gap-2 text-sm text-white/80">
                          <input
                            type="checkbox"
                            checked={c.enabled}
                            onChange={(e) => update(c.id, { enabled: e.target.checked })}
                          />
                          Show this card
                        </label>
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          onClick={() => setPending({ kind: "delete", id: c.id })}
                        >
                          Delete card
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <span className={label}>Photo, GIF or video (optional)</span>
                        <ContentImageField
                          value={c.image}
                          onChange={(next) => update(c.id, { image: next })}
                          mediaChoices={mediaChoices}
                          allowVideo
                        />
                      </div>
                      <TypeCardAdvancedEditor
                        card={c}
                        mediaChoices={mediaChoices}
                        onChange={(patch) => updateAdv(c.id, patch)}
                        onReset={() =>
                          setCards((prev) =>
                            prev.map((x) => {
                              if (x.id !== c.id) return x;
                              const next = { ...x };
                              // R61-S3: the card design is kept (it has its own switch).
                              if (x.adv?.design) next.adv = { design: x.adv.design };
                              else delete next.adv;
                              return next;
                            }),
                          )
                        }
                      />
                    </div>
                  </div>
                  </BasicMode>
            </>
          );
        }}
        footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="neutral" onClick={add} disabled={cards.length >= MAX_TYPE_CARDS}>
            ＋ Add card
          </Button>
          {cards.length >= MAX_TYPE_CARDS ? (
            <span className="text-xs text-white/50">You have the most cards allowed ({MAX_TYPE_CARDS}).</span>
          ) : null}
          <Button type="button" variant="neutral" onClick={() => setPending({ kind: "reset" })}>
            Reset to the original six
          </Button>
        </div>
        }
      />

      <div className="flex items-center gap-3">
        <Button type="submit" variant="save" disabled={!dirty && isCustom}>
          Save Type Cards
        </Button>
        <span className="text-xs text-white/50">
          {dirty ? "Saving publishes these cards to the live homepage." : "No changes yet."}
        </span>
      </div>

      {pickingCard ? (
        <LinkPicker
          value={pickingCard.href}
          posts={posts}
          onPick={(href) => {
            update(pickingCard.id, { href });
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      ) : null}

      <ConfirmDialog
        open={pending !== null}
        title={pending?.kind === "reset" ? "Go back to the original six cards?" : "Delete this card?"}
        description={
          pending?.kind === "reset"
            ? "Your names, links, order and added cards are replaced by Flower, Prerolls, Concentrates, Edibles, Liquids and Topicals. Photos you set on those six are kept. Nothing changes on the live site until you press Save."
            : "It disappears from this list. Nothing changes on the live site until you press Save, and you can leave the page without saving to get it back."
        }
        confirmLabel={pending?.kind === "reset" ? "Reset" : "Delete"}
        tone="danger"
        onConfirm={() => {
          if (pending?.kind === "delete") {
            setCards((prev) => prev.filter((c) => c.id !== pending.id));
          } else if (pending?.kind === "reset") {
            const images: Record<string, string> = {};
            for (const c of cards) if (c.image) images[c.id] = c.image;
            setCards(defaultTypeCards(images));
          }
          setOpenId(null);
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    </form>
  );
}

// ── R47: advanced options for one card ──────────────────────────────────────

const FOCUS_LABEL: Record<ImageFocus, string> = {
  center: "Center",
  top: "Top",
  bottom: "Bottom",
  left: "Left",
  right: "Right",
};

function TypeCardAdvancedEditor({
  card,
  mediaChoices,
  onChange,
  onReset,
}: {
  card: TypeCard;
  mediaChoices: MediaChoice[];
  onChange: (patch: Partial<TypeCardAdvanced>) => void;
  onReset: () => void;
}) {
  const a = card.adv ?? {};
  const [open, setOpen] = useState<boolean>(!!card.adv);
  const pill = (on: boolean) =>
    `rounded-md px-2.5 py-1 text-xs font-semibold ${
      on
        ? "bg-[var(--admin-accent)]/15 text-[var(--admin-accent)] ring-1 ring-[var(--admin-accent)]/40"
        : "border border-white/15 text-white/60 hover:text-white"
    }`;
  const swatches = (value: string | undefined, set: (v: string | undefined) => void) => (
    <div className="mt-1 flex flex-wrap gap-1.5">
      <button
        type="button"
        onClick={() => set(undefined)}
        className={`h-7 rounded-full border px-2 text-[0.6rem] text-white/70 ${!value ? "ring-2 ring-[var(--admin-accent)]" : "border-white/20"}`}
      >
        Classic
      </button>
      {HERO_COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          title={c.label}
          aria-label={c.label}
          onClick={() => set(c.id)}
          className={`h-7 w-7 rounded-full border ${value === c.id ? "ring-2 ring-[var(--admin-accent)]" : "border-white/20"}`}
          style={{ backgroundColor: c.hex }}
        />
      ))}
    </div>
  );
  const toLocal = (iso?: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const fromLocal = (v: string) => {
    if (!v) return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  };
  return (
    <div className="rounded-[var(--admin-radius)] border border-white/10 p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-left text-xs font-semibold text-white"
      >
        <span>✨ Advanced options</span>
        <span className="text-white/50">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <div className="mt-3 space-y-3">
          <div>
            <span className={label}>Phone picture or video (optional)</span>
            <ContentImageField
              value={a.imageMobile ?? ""}
              onChange={(v) => onChange({ imageMobile: v })}
              mediaChoices={mediaChoices}
              allowVideo
            />
          </div>
          <div>
            <span className={label}>Picture focus — computer</span>
            <div className="flex flex-wrap gap-1.5">
              {IMAGE_FOCUSES.map((f) => (
                <button key={f} type="button" className={pill((a.imageFocus ?? "center") === f)} onClick={() => onChange({ imageFocus: f })}>
                  {FOCUS_LABEL[f]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className={label}>Picture focus — phone</span>
            <div className="flex flex-wrap gap-1.5">
              {IMAGE_FOCUSES.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={pill((a.imageFocusMobile ?? a.imageFocus ?? "center") === f)}
                  onClick={() => onChange({ imageFocusMobile: f })}
                >
                  {FOCUS_LABEL[f]}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>
              Zoom ({a.zoom ?? 100}%)
              <input
                type="range"
                min={100}
                max={200}
                step={5}
                value={a.zoom ?? 100}
                onChange={(e) => onChange({ zoom: Number(e.target.value) })}
                className="mt-1 w-full accent-[var(--admin-accent)]"
              />
            </label>
            <label className={label}>
              Darken picture ({a.dim ?? 0}%)
              <input
                type="range"
                min={0}
                max={80}
                step={5}
                value={a.dim ?? 0}
                onChange={(e) => onChange({ dim: Number(e.target.value) })}
                className="mt-1 w-full accent-[var(--admin-accent)]"
              />
            </label>
          </div>
          <div>
            <span className={label}>Name style</span>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["bar", "Bar along the bottom (classic)"],
                  ["overlay", "On the picture"],
                  ["hidden", "Hide the words (picture only)"],
                ] as const
              ).map(([v, l]) => (
                <button key={v} type="button" className={pill((a.textStyle ?? "bar") === v)} onClick={() => onChange({ textStyle: v })}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <label className={label}>
            Name font
            <select
              className={`${input} mt-1`}
              value={a.labelFont ?? ""}
              onChange={(e) => onChange({ labelFont: e.target.value || undefined })}
            >
              <option value="">Classic (site font)</option>
              {(["display", "sans", "script"] as const).map((g) => (
                <optgroup key={g} label={g === "display" ? "Display (bold)" : g === "sans" ? "Clean sans" : "Script (cursive)"}>
                  {HERO_FONTS.filter((f) => f.group === g).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <div>
            <span className={label}>Name colour</span>
            {swatches(a.labelColor, (v) => onChange({ labelColor: v }))}
          </div>
          <div>
            <span className={label}>Small line colour</span>
            {swatches(a.ctaColor, (v) => onChange({ ctaColor: v }))}
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-white/80">
            <input type="checkbox" checked={a.newTab === true} onChange={(e) => onChange({ newTab: e.target.checked })} />
            Open the link in a new tab
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>
              Show from (optional)
              <input
                type="datetime-local"
                className={`${input} mt-1`}
                value={toLocal(a.scheduleStart)}
                onChange={(e) => onChange({ scheduleStart: fromLocal(e.target.value) })}
              />
            </label>
            <label className={label}>
              Show until (optional)
              <input
                type="datetime-local"
                className={`${input} mt-1`}
                value={toLocal(a.scheduleEnd)}
                onChange={(e) => onChange({ scheduleEnd: fromLocal(e.target.value) })}
              />
            </label>
          </div>
          {card.adv ? (
            <button type="button" onClick={onReset} className="text-xs text-white/50 underline hover:text-white">
              Reset advanced options (back to the classic card)
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** R61-S3 / R63: the first card-shaped design for a Type card. */
function newCardDesign(c: TypeCard) {
  return cardDesign({ ratio: 0.75, ratioMobile: 1.33, subtitle: !!c.cta });
}

/** The classic (no custom design) mini tile for the preview strip. */
function ClassicTile({ c }: { c: TypeCard }) {
  return (
                <div
                  className="relative flex aspect-[3/4] flex-col justify-end overflow-hidden rounded-lg border border-white/15 bg-white/5"
                >
                  {c.image && isVideoSrc(c.image) ? (
                    <video
                      src={c.image}
                      muted
                      loop
                      playsInline
                      autoPlay
                      className="absolute inset-0 h-full w-full object-cover"
                      style={{ objectPosition: c.adv?.imageFocus ?? "center" }}
                    />
                  ) : c.image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- admin preview of an arbitrary media URL
                    <img loading="lazy" decoding="async"
                      src={c.image}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover"
                      style={{
                        objectPosition: c.adv?.imageFocus ?? "center",
                        ...(c.adv?.zoom ? { transform: `scale(${c.adv.zoom / 100})` } : {}),
                      }}
                    />
                  ) : null}
                  {c.adv?.dim ? (
                    <span className="absolute inset-0 bg-black" style={{ opacity: c.adv.dim / 100 }} />
                  ) : null}
                  {c.adv?.textStyle === "hidden" ? null : (
                    <div
                      className={`relative px-1 py-1 text-center ${c.adv?.textStyle === "overlay" ? "bg-gradient-to-b from-transparent to-black/70" : "bg-black/85"}`}
                    >
                      <p
                        className="whitespace-pre-line text-[0.6rem] font-black uppercase leading-tight text-white"
                        style={{
                          ...(c.adv?.labelFont ? { fontFamily: heroFontStack(c.adv.labelFont) } : {}),
                          ...(c.adv?.labelColor ? { color: HERO_COLORS.find((x) => x.id === c.adv?.labelColor)?.hex } : {}),
                        }}
                      >
                        {c.label || "New card"}
                      </p>
                      {c.cta ? (
                        <p
                          className="text-[0.45rem] font-black uppercase tracking-widest text-[var(--admin-accent)]"
                          style={c.adv?.ctaColor ? { color: HERO_COLORS.find((x) => x.id === c.adv?.ctaColor)?.hex } : undefined}
                        >
                          {c.cta}
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>
  );
}
