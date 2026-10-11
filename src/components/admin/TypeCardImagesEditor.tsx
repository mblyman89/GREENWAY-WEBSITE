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
  type TypeCard,
} from "@/lib/cms/type-cards-core";

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
  const move = (index: number, dir: -1 | 1) =>
    setCards((prev) => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  const add = () => {
    if (cards.length >= MAX_TYPE_CARDS) return;
    const id = nextTypeCardId(cards);
    setCards([
      ...cards,
      { id, label: "New card", href: "/menu", image: "", cta: DEFAULT_TYPE_CARD_CTA, enabled: true },
    ]);
    setOpenId(id);
  };

  const pickingCard = cards.find((c) => c.id === picking) ?? null;

  return (
    <form action={saveAction} className="space-y-5">
      <input type="hidden" name="type_cards_json" value={json} />
      <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-base">🗂️</span>
          <h3 className="text-sm font-semibold text-white">Shop by Category — Type Cards</h3>
          <span className="rounded-full border border-white/15 px-2 py-0.5 text-[0.6rem] font-semibold text-white/50">
            {cards.length} / {MAX_TYPE_CARDS} cards · {visible.length} showing
          </span>
          {dirty ? (
            <span className="rounded-full bg-[var(--admin-gold)]/15 px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--admin-gold)]">
              ● unsaved edits
            </span>
          ) : null}
        </div>
        <p className="mb-4 text-xs text-white/50">
          These are the tiles under the &ldquo;Shop by Category&rdquo; banner on your homepage. Rename them,
          change where they go, give them a photo, put them in any order, hide or delete them, or add new
          ones (up to {MAX_TYPE_CARDS}). Press Enter in a name to split it onto two lines. Pick square-ish
          photos with no words in them, because the name sits in a bar along the bottom. Changes go live
          when you press Save.
        </p>

        {/* Live mini preview */}
        <div className="mb-5 rounded-[var(--admin-radius)] border border-white/10 bg-black/30 p-3">
          <p className={label}>Preview (how the tiles line up on a computer)</p>
          {visible.length === 0 ? (
            <p className="text-xs text-[var(--admin-gold)]">
              No cards are showing, so the tile row is hidden on your homepage. The banner above it still
              shows.
            </p>
          ) : (
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: `repeat(${Math.min(visible.length, 6)}, minmax(0, 1fr))` }}
            >
              {visible.map((c) => (
                <div
                  key={c.id}
                  className="relative flex aspect-[3/4] flex-col justify-end overflow-hidden rounded-lg border border-white/15 bg-white/5"
                >
                  {c.image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- admin preview of an arbitrary media URL
                    <img src={c.image} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  ) : null}
                  <div className="relative bg-black/85 px-1 py-1 text-center">
                    <p className="whitespace-pre-line text-[0.6rem] font-black uppercase leading-tight text-white">
                      {c.label || "New card"}
                    </p>
                    {c.cta ? (
                      <p className="text-[0.45rem] font-black uppercase tracking-widest text-[var(--admin-accent)]">
                        {c.cta}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <ol className="space-y-2">
          {cards.map((c, i) => {
            const open = openId === c.id;
            const check = checkHref(c.href);
            return (
              <li
                key={c.id}
                className={`rounded-[var(--admin-radius)] border ${c.enabled ? "border-white/10" : "border-dashed border-white/10 opacity-70"} bg-black/20`}
              >
                <div className="flex flex-wrap items-center gap-2 p-2">
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label={`Move ${c.label || "card"} up`}
                      className="rounded px-1.5 text-xs text-white/70 hover:bg-white/10 disabled:opacity-30"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      disabled={i === cards.length - 1}
                      aria-label={`Move ${c.label || "card"} down`}
                      className="rounded px-1.5 text-xs text-white/70 hover:bg-white/10 disabled:opacity-30"
                    >
                      ▼
                    </button>
                  </div>
                  <span className="w-5 text-center text-xs text-white/40">{i + 1}</span>
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : c.id)}
                    aria-expanded={open}
                    className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-white"
                  >
                    {(c.label || "New card").replace(/\n/g, " ")}
                    <span className="ml-2 text-xs font-normal text-white/40">
                      → {describeHref(c.href, { blogTitles })}
                    </span>
                  </button>
                  {c.image ? (
                    <span className="rounded-full bg-[var(--admin-accent)]/15 px-2 py-0.5 text-[0.6rem] font-semibold text-[var(--admin-accent)]">
                      photo
                    </span>
                  ) : null}
                  {!c.enabled ? (
                    <span className="rounded-full border border-white/15 px-2 py-0.5 text-[0.6rem] text-white/50">hidden</span>
                  ) : null}
                  <Button type="button" variant="neutral" size="sm" onClick={() => setOpenId(open ? null : c.id)}>
                    {open ? "Close" : "Edit"}
                  </Button>
                </div>

                {open ? (
                  <div className="grid gap-4 border-t border-white/10 p-3 md:grid-cols-2">
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
                    <div>
                      <span className={label}>Photo (optional)</span>
                      <ContentImageField
                        value={c.image}
                        onChange={(next) => update(c.id, { image: next })}
                        mediaChoices={mediaChoices}
                      />
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>

        <div className="mt-3 flex flex-wrap items-center gap-2">
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
      </div>

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
