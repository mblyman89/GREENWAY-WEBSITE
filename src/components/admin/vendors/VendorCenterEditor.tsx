"use client";

/**
 * R64 — full control of the Vendors page center section: heading, paragraph,
 * alignment, buttons (email or link, three styles, up to 4), the email line,
 * and the contact cards (add / remove / reorder / hide; title, blurb, email,
 * subject, accent colour) with a column choice. Save draft → Publish, same as
 * every page block. "Back to the original" stores a blank draft (the page then
 * uses the older per-field wording again once published).
 */
import { useState } from "react";
import { Button } from "@/components/admin/ui";
import {
  blankButton,
  blankCard,
  CENTER_ACCENTS,
  CENTER_BUTTON_STYLES,
  CENTER_MAX_BUTTONS,
  CENTER_MAX_CARDS,
  serializeVendorCenter,
  VENDOR_CENTER_BLOCK,
  type CenterButton,
  type CenterCard,
  type CenterColumns,
  type VendorCenter,
} from "@/lib/vendors/vendor-center-core";

const INPUT =
  "mt-1 w-full rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm text-[var(--admin-text)]";
const LABEL = "block text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]";
const BOX = "rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4";
const SMALL_BTN =
  "rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] px-2 py-1 text-xs text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)] disabled:opacity-40";

function move<T>(list: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const next = list.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function RowTools({ i, n, onMove, onRemove }: { i: number; n: number; onMove: (d: -1 | 1) => void; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-1">
      <button type="button" className={SMALL_BTN} disabled={i === 0} onClick={() => onMove(-1)} aria-label="Move up">
        ↑
      </button>
      <button type="button" className={SMALL_BTN} disabled={i === n - 1} onClick={() => onMove(1)} aria-label="Move down">
        ↓
      </button>
      <button type="button" className={`${SMALL_BTN} text-[var(--admin-danger)]`} onClick={onRemove}>
        Remove
      </button>
    </div>
  );
}

export function VendorCenterEditor({
  initial,
  isCustom,
  savedJson,
  publishedJson,
  saveDraftAction,
  publishAction,
  resetAction,
}: {
  /** The center to start from (saved draft, else live, else today's look). */
  initial: VendorCenter;
  /** True when a custom center draft exists (vs. the original fields). */
  isCustom: boolean;
  savedJson: string;
  publishedJson: string;
  saveDraftAction: (fd: FormData) => void | Promise<void>;
  publishAction: (fd: FormData) => void | Promise<void>;
  resetAction: (fd: FormData) => void | Promise<void>;
}) {
  const [c, setC] = useState<VendorCenter>(initial);
  const value = serializeVendorCenter(c);
  const dirty = isCustom ? value !== savedJson : value !== serializeVendorCenter(initial);
  const live = savedJson === publishedJson;
  const set = (p: Partial<VendorCenter>) => setC((x) => ({ ...x, ...p }));
  const setButton = (i: number, p: Partial<CenterButton>) =>
    setC((x) => ({ ...x, buttons: x.buttons.map((b, k) => (k === i ? { ...b, ...p } : b)) }));
  const setCard = (i: number, p: Partial<CenterCard>) =>
    setC((x) => ({ ...x, cards: x.cards.map((b, k) => (k === i ? { ...b, ...p } : b)) }));

  return (
    <form className="space-y-4">
      <input type="hidden" name="block_key" value={VENDOR_CENTER_BLOCK} />
      <input type="hidden" name="draft_value" value={value} />

      <div className={`${BOX} flex flex-wrap items-center justify-between gap-3`}>
        <div>
          <h2 className="text-lg font-black text-[var(--admin-text)]">Center section</h2>
          <p className="text-xs text-[var(--admin-text-muted)]">
            The container between the two banners: heading, paragraph, buttons and the contact cards.
            {isCustom ? "" : " You're starting from what the page shows today."}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`text-xs font-semibold ${live && !dirty ? "text-[var(--admin-accent)]" : "text-[var(--admin-gold)]"}`}>
            {dirty ? "Unsaved changes" : live ? "Live & up to date" : "Draft not published yet"}
          </span>
          <label className="flex items-center gap-2 text-sm text-[var(--admin-text)]">
            <input type="checkbox" checked={c.show} onChange={(e) => set({ show: e.target.checked })} />
            Show this section
          </label>
        </div>
      </div>

      {/* Text */}
      <div className={`${BOX} space-y-3`}>
        <h3 className="text-sm font-black text-[var(--admin-text)]">Heading & paragraph</h3>
        <label className={LABEL}>
          Heading
          <input value={c.heading} onChange={(e) => set({ heading: e.target.value })} className={INPUT} maxLength={160} />
        </label>
        <label className={LABEL}>
          Paragraph (press Enter for a new line)
          <textarea value={c.body} onChange={(e) => set({ body: e.target.value })} rows={5} className={INPUT} maxLength={2000} />
        </label>
        <label className={LABEL}>
          Alignment
          <select value={c.align} onChange={(e) => set({ align: e.target.value === "left" ? "left" : "center" })} className={INPUT}>
            <option value="center">Centered (default)</option>
            <option value="left">Left</option>
          </select>
        </label>
      </div>

      {/* Buttons */}
      <div className={`${BOX} space-y-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-black text-[var(--admin-text)]">Buttons ({c.buttons.length} of {CENTER_MAX_BUTTONS})</h3>
          <button
            type="button"
            className={SMALL_BTN}
            disabled={c.buttons.length >= CENTER_MAX_BUTTONS}
            onClick={() => set({ buttons: [...c.buttons, blankButton()] })}
          >
            + Add button
          </button>
        </div>
        {c.buttons.length === 0 ? <p className="text-xs text-[var(--admin-text-muted)]">No buttons — the section shows just the words and cards.</p> : null}
        {c.buttons.map((b, i) => (
          <div key={b.id} className="space-y-2 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm font-semibold text-[var(--admin-text)]">
                <input type="checkbox" checked={b.show} onChange={(e) => setButton(i, { show: e.target.checked })} />
                Button {i + 1}
              </label>
              <RowTools
                i={i}
                n={c.buttons.length}
                onMove={(d) => set({ buttons: move(c.buttons, i, d) })}
                onRemove={() => set({ buttons: c.buttons.filter((_, k) => k !== i) })}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className={LABEL}>
                Label
                <input value={b.label} onChange={(e) => setButton(i, { label: e.target.value })} className={INPUT} maxLength={80} />
              </label>
              <label className={LABEL}>
                Opens
                <select value={b.kind} onChange={(e) => setButton(i, { kind: e.target.value === "link" ? "link" : "email" })} className={INPUT}>
                  <option value="email">An email draft</option>
                  <option value="link">A page or website</option>
                </select>
              </label>
              <label className={LABEL}>
                Style
                <select value={b.style} onChange={(e) => setButton(i, { style: e.target.value as CenterButton["style"] })} className={INPUT}>
                  {CENTER_BUTTON_STYLES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {b.kind === "email" ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <label className={LABEL}>
                  Email address
                  <input type="email" value={b.email} onChange={(e) => setButton(i, { email: e.target.value })} className={INPUT} />
                </label>
                <label className={LABEL}>
                  Subject line (body stays blank)
                  <input value={b.subject} onChange={(e) => setButton(i, { subject: e.target.value })} className={INPUT} maxLength={200} />
                </label>
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                <label className={LABEL}>
                  Link (/page-on-this-site or https://…)
                  <input value={b.href} onChange={(e) => setButton(i, { href: e.target.value })} className={INPUT} placeholder="/locations" />
                </label>
                <label className="flex items-center gap-2 pb-2 text-sm text-[var(--admin-text)]">
                  <input type="checkbox" checked={b.newTab} onChange={(e) => setButton(i, { newTab: e.target.checked })} />
                  New tab
                </label>
              </div>
            )}
          </div>
        ))}
        <div className="grid gap-2 sm:grid-cols-[auto_1fr] sm:items-end">
          <label className="flex items-center gap-2 pb-2 text-sm text-[var(--admin-text)]">
            <input type="checkbox" checked={c.showEmailLine} onChange={(e) => set({ showEmailLine: e.target.checked })} />
            Show the small email line under the buttons
          </label>
          {c.showEmailLine ? (
            <label className={LABEL}>
              Email line text
              <input value={c.emailLine} onChange={(e) => set({ emailLine: e.target.value })} className={INPUT} maxLength={200} />
            </label>
          ) : null}
        </div>
      </div>

      {/* Cards */}
      <div className={`${BOX} space-y-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-black text-[var(--admin-text)]">Contact cards ({c.cards.length} of {CENTER_MAX_CARDS})</h3>
          <button
            type="button"
            className={SMALL_BTN}
            disabled={c.cards.length >= CENTER_MAX_CARDS}
            onClick={() => set({ cards: [...c.cards, blankCard()] })}
          >
            + Add card
          </button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={LABEL}>
            Heading above the cards (optional)
            <input value={c.cardsHeading} onChange={(e) => set({ cardsHeading: e.target.value })} className={INPUT} maxLength={160} />
          </label>
          <label className={LABEL}>
            Cards per row on a computer
            <select value={c.columns} onChange={(e) => set({ columns: e.target.value as CenterColumns })} className={INPUT}>
              <option value="auto">Automatic (5, as today)</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="5">5</option>
            </select>
          </label>
        </div>
        {c.cards.map((card, i) => (
          <div key={card.id} className="space-y-2 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm font-semibold text-[var(--admin-text)]">
                <input type="checkbox" checked={card.show} onChange={(e) => setCard(i, { show: e.target.checked })} />
                {card.title || `Card ${i + 1}`}
              </label>
              <RowTools
                i={i}
                n={c.cards.length}
                onMove={(d) => set({ cards: move(c.cards, i, d) })}
                onRemove={() => set({ cards: c.cards.filter((_, k) => k !== i) })}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={LABEL}>
                Title
                <input value={card.title} onChange={(e) => setCard(i, { title: e.target.value })} className={INPUT} maxLength={120} />
              </label>
              <label className={LABEL}>
                Title colour
                <select value={card.accent} onChange={(e) => setCard(i, { accent: e.target.value as CenterCard["accent"] })} className={INPUT}>
                  {CENTER_ACCENTS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className={LABEL}>
              Description
              <textarea value={card.blurb} onChange={(e) => setCard(i, { blurb: e.target.value })} rows={2} className={INPUT} maxLength={600} />
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={LABEL}>
                Email address (blank = card isn&apos;t clickable)
                <input type="email" value={card.email} onChange={(e) => setCard(i, { email: e.target.value })} className={INPUT} />
              </label>
              <label className={LABEL}>
                Subject line (body stays blank)
                <input value={card.subject} onChange={(e) => setCard(i, { subject: e.target.value })} className={INPUT} maxLength={200} />
              </label>
            </div>
          </div>
        ))}
      </div>

      <div className={`${BOX} flex flex-wrap items-center gap-2`}>
        <Button type="submit" variant="save" size="sm" formAction={saveDraftAction}>
          Save draft
        </Button>
        <Button type="submit" variant="primary" size="sm" formAction={publishAction} disabled={dirty || live}>
          Publish
        </Button>
        {isCustom ? (
          <Button type="submit" variant="neutral" size="sm" formAction={resetAction}>
            Back to the original
          </Button>
        ) : null}
        <span className="text-xs text-[var(--admin-text-muted)]">
          {dirty ? "Save draft first, then Publish." : "Publish makes the saved draft live."} Email addresses that aren&apos;t valid are dropped on save.
        </span>
      </div>
    </form>
  );
}
