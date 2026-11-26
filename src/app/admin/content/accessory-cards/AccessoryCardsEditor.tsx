"use client";
/**
 * OI-ACC S4 - the simple card editor (same shape as Merch Studio's category
 * cards: picture from the media library, name, short line, Up / Down). The
 * whole list is sent as one JSON field; the server re-normalizes it.
 */
import { useState } from "react";
import { ContentImageField, type MediaChoice } from "@/components/admin/ContentImageField";
import { NC_TYPE_LIMITS } from "@/lib/noncannabis/types-core";
import { saveAccessoryCardsAction, publishAccessoryCardsAction } from "./actions";

type Card = { value: string; typeLabel: string; label: string; text: string; image: string; changed: boolean };

const btn = "rounded-md px-3 py-1.5 text-xs font-bold";
const input = "w-full rounded-md border border-[var(--admin-border)] bg-transparent px-3 py-2 text-sm text-[var(--admin-text)]";

export function AccessoryCardsEditor({
  cards: initial,
  mediaChoices,
  disabled,
  archiveAction,
}: {
  cards: Card[];
  mediaChoices: MediaChoice[];
  disabled: boolean;
  archiveAction: (fd: FormData) => Promise<void>;
}) {
  const [cards, setCards] = useState(initial);
  const set = (i: number, patch: Partial<Card>) => setCards((c) => c.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: -1 | 1) =>
    setCards((c) => {
      const n = [...c];
      [n[i], n[i + d]] = [n[i + d], n[i]];
      return n;
    });
  const payload = JSON.stringify(cards.map(({ value, label, text, image }) => ({ value, label, text, image })));

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap gap-2">
        <input type="hidden" name="cards" value={payload} />
        <button type="submit" formAction={saveAccessoryCardsAction} disabled={disabled} className={`${btn} border border-[var(--admin-border)] text-[var(--admin-text)]`}>Save draft</button>
        <button type="submit" formAction={publishAccessoryCardsAction} disabled={disabled} className={`${btn} bg-[var(--admin-accent)] text-black`}>Publish to the shop</button>
      </form>
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((c, i) => (
          <li key={c.value} className="space-y-2 rounded-xl border border-[var(--admin-border)] p-3">
            <div className="flex items-center justify-between text-xs text-[var(--admin-text-faint)]">
              <span>Type: <b className="text-[var(--admin-text)]">{c.typeLabel}</b>{c.changed ? " - unpublished changes" : ""}</span>
              <span className="flex gap-1">
                <button type="button" className={`${btn} border border-[var(--admin-border)]`} disabled={i === 0} onClick={() => move(i, -1)}>Up</button>
                <button type="button" className={`${btn} border border-[var(--admin-border)]`} disabled={i === cards.length - 1} onClick={() => move(i, 1)}>Down</button>
              </span>
            </div>
            {c.image ? (
              // eslint-disable-next-line @next/next/no-img-element -- owner-picked card picture preview
              <img src={c.image} alt="" className="aspect-[4/3] w-full rounded-md object-cover" />
            ) : (
              <div className="flex aspect-[4/3] w-full items-center justify-center rounded-md bg-black/30 text-xs text-[var(--admin-text-faint)]">No picture yet</div>
            )}
            <ContentImageField value={c.image} onChange={(v) => set(i, { image: v })} mediaChoices={mediaChoices} />
            <input className={input} value={c.label} maxLength={NC_TYPE_LIMITS.cardLabel} placeholder="Card name" aria-label="Card name" onChange={(e) => set(i, { label: e.target.value })} />
            <textarea className={input} rows={4} value={c.text} maxLength={NC_TYPE_LIMITS.cardText} placeholder="Short text (optional)" aria-label="Card text" onChange={(e) => set(i, { text: e.target.value })} />
            <form action={archiveAction}>
              <input type="hidden" name="back" value="cards" />
              <input type="hidden" name="value" value={c.value} />
              <button type="submit" disabled={disabled} className={`${btn} border border-[var(--admin-danger)]/60 text-[var(--admin-text-muted)]`}>Archive type</button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
