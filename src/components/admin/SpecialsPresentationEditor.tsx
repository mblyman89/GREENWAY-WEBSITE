"use client";

/**
 * SpecialsPresentationEditor — the novice-safe editor for HOW the /specials
 * "Weekly Cannabis Deals" page is PRESENTED (Website → Specials, SLICE 106,
 * upgraded in SLICE 111).
 *
 * It edits PRESENTATION ONLY: which weekday cards show, their order, the
 * offer-badge style, optional per-day copy overrides, the two section toggles,
 * and — new in SLICE 111 — the "Today's Deal" banner IMAGE (with the same
 * Media-Library + paste-URL + Canva-size helpers every other image slot gets),
 * the banner's text alignment (left/center/right + top/center/bottom), and how
 * many live products the "today" grid shows. It NEVER changes discount math — a
 * clear banner + deep links point staff to /admin/promotions for pricing.
 *
 * The page is split into two tabs so it stays clean:
 *   • "Weekly deal cards" — the 7 day-of-the-week explainer cards.
 *   • "Today's Deal banner & products" — the wide banner image + alignment and
 *     the live-products grid count.
 *
 * State serializes to the hidden `draft_value` of the ONE "richjson" block
 * (specials.deals.presentation) and posts to the SAME content-store actions as
 * Site Content, so it inherits draft → publish → History/restore for free.
 * Defaults are byte-identical to today's look, so nothing changes until edited.
 */
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/admin/ui";
import { ContentImageField, type MediaChoice } from "@/components/admin/ContentImageField";
import type { ImageSpec } from "@/lib/cms/image-spec-core";
import {
  BADGE_STYLES,
  TEXT_ALIGNS,
  TEXT_VALIGNS,
  IMAGE_FOCUSES,
  TODAYS_DEALS_COUNT_MIN,
  TODAYS_DEALS_COUNT_MAX,
  clampTodaysDealsCount,
  type BadgeStyle,
  type DayPresentation,
  type SpecialsPresentation,
  type SpecialsWeekday,
  type TextAlign,
  type TextVAlign,
  type ImageFocus,
  normalizeSpecialsPresentation,
  serializeSpecialsPresentation,
  orderedVisibleWeekdays,
  dayPresentationFor,
} from "@/lib/specials/specials-presentation-core";

export type SpecialsRevisionVM = {
  id: string;
  created_at: string;
  actor_email: string | null;
};

/** A read-only snapshot of what the engine currently says for each weekday, so
 *  the editor can show the LIVE copy that an override would replace. */
export type WeekdayEngineCopy = {
  weekday: SpecialsWeekday;
  title: string;
  offer: string;
  description: string;
  fromDatabase: boolean;
};

const BADGE_LABELS: Record<BadgeStyle, string> = {
  classic: "Classic (current look)",
  bold: "Bold (filled chip)",
  minimal: "Minimal (subtle)",
};

const TEXT_ALIGN_LABELS: Record<TextAlign, string> = {
  left: "Left",
  center: "Center",
  right: "Right",
};

const TEXT_VALIGN_LABELS: Record<TextVAlign, string> = {
  top: "Top",
  center: "Middle",
  bottom: "Bottom",
};

/** Where the IMAGE's subject sits inside the banner frame. This is independent
 *  of the text position, so staff can move the words to one side and keep the
 *  photo's subject on the other side (no collision). */
const IMAGE_FOCUS_LABELS: Record<ImageFocus, string> = {
  center: "Center",
  top: "Top",
  bottom: "Bottom",
  left: "Left",
  right: "Right",
};

/** Dark-theme input class shared by all text/select boxes here. */
const INPUT_CLASS =
  "rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm text-[var(--admin-text)] placeholder:text-[var(--admin-text-faint)] focus:border-[var(--admin-accent)] focus:outline-none";

type TabKey = "hero" | "cards" | "banner";

type Props = {
  draftJson: string | null;
  publishedJson: string | null;
  engineCopy: WeekdayEngineCopy[];
  revisions: SpecialsRevisionVM[];
  saveDraftAction: (formData: FormData) => void | Promise<void>;
  publishAction: (formData: FormData) => void | Promise<void>;
  restoreAction: (formData: FormData) => void | Promise<void>;
  mediaChoices: MediaChoice[];
  spec?: ImageSpec;
  /** SLICE 119: image spec for the per-weekday deal-card photo (portrait-ish). */
  cardSpec?: ImageSpec;
  /** SLICE 122 (SET-3): image spec for the TOP hero banner (wide). */
  heroSpec?: ImageSpec;
};

const BLOCK_KEY = "specials.deals.presentation";

function initialPresentation(props: Props): SpecialsPresentation {
  // Prefer the draft (in-progress edits), else the published value, else the
  // live-look-safe default (normalize handles null/blank).
  return normalizeSpecialsPresentation(
    safeParse(props.draftJson) ?? safeParse(props.publishedJson) ?? null,
  );
}

function safeParse(json: string | null): unknown {
  if (!json || !json.trim()) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function SpecialsPresentationEditor(props: Props) {
  const { engineCopy, revisions, saveDraftAction, publishAction, restoreAction, mediaChoices, spec, cardSpec, heroSpec } =
    props;
  const [pres, setPres] = useState<SpecialsPresentation>(() => initialPresentation(props));
  const [showHistory, setShowHistory] = useState(false);
  const [tab, setTab] = useState<TabKey>("hero");
  const formRef = useRef<HTMLFormElement>(null);

  const serialized = useMemo(() => serializeSpecialsPresentation(pres), [pres]);
  const publishedSerialized = useMemo(
    () => serializeSpecialsPresentation(normalizeSpecialsPresentation(safeParse(props.publishedJson))),
    [props.publishedJson],
  );
  const dirtyVsPublished = serialized !== publishedSerialized;

  const engineByDay = useMemo(
    () => new Map(engineCopy.map((c) => [c.weekday, c] as const)),
    [engineCopy],
  );

  // ── mutations (pure, immutable) ─────────────────────────────────────────────
  function setGlobal<K extends keyof SpecialsPresentation>(key: K, value: SpecialsPresentation[K]) {
    setPres((p) => ({ ...p, [key]: value }));
  }
  function updateDay(weekday: SpecialsWeekday, patch: Partial<DayPresentation>) {
    setPres((p) => ({
      ...p,
      days: p.days.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)),
    }));
  }
  function moveDay(weekday: SpecialsWeekday, dir: -1 | 1) {
    setPres((p) => {
      // Reorder by the current display order (ordered by `order`, natural tie-break).
      const ordered = [...p.days].sort(
        (a, b) => a.order - b.order || p.days.indexOf(a) - p.days.indexOf(b),
      );
      const i = ordered.findIndex((d) => d.weekday === weekday);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ordered.length) return p;
      const swapped = [...ordered];
      [swapped[i], swapped[j]] = [swapped[j], swapped[i]];
      // Reassign contiguous order indices.
      const orderByWeekday = new Map(swapped.map((d, idx) => [d.weekday, idx] as const));
      return {
        ...p,
        days: p.days.map((d) => ({ ...d, order: orderByWeekday.get(d.weekday) ?? d.order })),
      };
    });
  }

  // Days in current display order for the editor rows.
  const orderedDays = useMemo(
    () =>
      [...pres.days].sort(
        (a, b) => a.order - b.order || pres.days.indexOf(a) - pres.days.indexOf(b),
      ),
    [pres.days],
  );
  const visibleOrder = useMemo(() => orderedVisibleWeekdays(pres), [pres]);

  return (
    <div className="space-y-6">
      {/* Caution / boundary banner. */}
      <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]">
        <strong>This controls how deals are PRESENTED — not the prices.</strong> Turn day cards on or
        off, reorder them, restyle the offer badge, tweak the wording, and set the Today&rsquo;s Deal
        banner image. The actual discounts, percentages, and offers are set in{" "}
        <Link href="/admin/promotions" className="underline hover:no-underline">
          Promotions
        </Link>{" "}
        (test them in the{" "}
        <Link href="/admin/promotions/simulator" className="underline hover:no-underline">
          discount simulator
        </Link>
        ). Nothing goes live until you click <strong>Publish</strong>.
      </div>

      {/* ── Tab bar ───────────────────────────────────────────────────────── */}
      <nav className="flex flex-wrap gap-1.5 border-b border-[var(--admin-border)] pb-3">
        {(
          [
            { key: "hero" as const, label: "Top hero" },
            { key: "cards" as const, label: "Weekly deal cards" },
            { key: "banner" as const, label: "Today's Deal banner & products" },
          ]
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-[var(--admin-radius-sm)] px-3 py-1.5 text-sm font-semibold transition ${
              tab === t.key
                ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)] ring-1 ring-[var(--admin-accent)]/40"
                : "text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)] hover:text-[var(--admin-text)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "hero" ? (
        /* ── Top hero tab (page-order tab 1) ─────────────────────────────── */
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Controls column */}
          <div className="space-y-5">
            {/* Copy note: the words come from Site Content / inline editing. */}
            <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
              <div className="mb-1 text-sm font-semibold">Hero wording</div>
              <p className="text-xs text-[var(--admin-text-muted)]">
                The hero&rsquo;s <strong>eyebrow</strong>, <strong>title</strong>, and{" "}
                <strong>subtitle</strong> are edited in{" "}
                <Link href="/admin/site-content" className="text-[var(--admin-accent)] hover:underline">
                  Site Content
                </Link>{" "}
                (or by clicking them directly in{" "}
                <Link href="/specials?preview=1" className="text-[var(--admin-accent)] hover:underline" target="_blank" rel="noreferrer">
                  Preview
                </Link>
                ). This tab controls the hero <strong>image</strong> and where the text sits over it.
              </p>
            </div>

            {/* Hero image (moved here from the retired Pages builder). */}
            <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
              <div className="mb-1 text-sm font-semibold">Top hero image</div>
              <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
                The big banner at the very top of the Specials page. Paste a URL or pick one from the
                Media Library. <strong>Leave blank</strong> to keep the built-in gradient look (no
                photo). The image sits behind a dark fade so the wording stays readable.
              </p>
              <ContentImageField
                value={pres.heroBannerImage}
                onChange={(next) => setGlobal("heroBannerImage", next)}
                mediaChoices={mediaChoices}
                spec={heroSpec}
              />
            </div>

            {/* Hero text position. */}
            <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
              <div className="mb-1 text-sm font-semibold">Hero text position</div>
              <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
                Nudge the eyebrow / title / subtitle so they sit nicely over your image.
              </p>
              <div className="space-y-3">
                <div>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                    Horizontal
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {TEXT_ALIGNS.map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => setGlobal("heroBannerTextAlign", a)}
                        className={`rounded-[var(--admin-radius-sm)] px-3 py-1.5 text-sm font-semibold transition ${
                          pres.heroBannerTextAlign === a
                            ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)] ring-1 ring-[var(--admin-accent)]/40"
                            : "border border-[var(--admin-border)] text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)] hover:text-[var(--admin-text)]"
                        }`}
                      >
                        {TEXT_ALIGN_LABELS[a]}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                    Vertical
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {TEXT_VALIGNS.map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => setGlobal("heroBannerVerticalAlign", a)}
                        className={`rounded-[var(--admin-radius-sm)] px-3 py-1.5 text-sm font-semibold transition ${
                          pres.heroBannerVerticalAlign === a
                            ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)] ring-1 ring-[var(--admin-accent)]/40"
                            : "border border-[var(--admin-border)] text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)] hover:text-[var(--admin-text)]"
                        }`}
                      >
                        {TEXT_VALIGN_LABELS[a]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Hero image focus (independent of the text). */}
            <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
              <div className="mb-1 text-sm font-semibold">Image focus</div>
              <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
                Slide the picture so its main subject shows next to your text &mdash; this moves the{" "}
                <strong>image</strong> on its own, so the words and the artwork never collide.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {IMAGE_FOCUSES.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setGlobal("heroBannerImageFocus", f)}
                    className={`rounded-[var(--admin-radius-sm)] px-3 py-1.5 text-sm font-semibold transition ${
                      pres.heroBannerImageFocus === f
                        ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)] ring-1 ring-[var(--admin-accent)]/40"
                        : "border border-[var(--admin-border)] text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)] hover:text-[var(--admin-text)]"
                    }`}
                  >
                    {IMAGE_FOCUS_LABELS[f]}
                  </button>
                ))}
              </div>
            </div>

            {/* Creative Studio nudge for on-brand hero art. */}
            <p className="text-xs text-[var(--admin-text-muted)]">
              Need on-brand artwork? Generate a wide hero in{" "}
              <Link href="/admin/creative" className="text-[var(--admin-accent)] hover:underline">
                Creative Studio
              </Link>{" "}
              &mdash; pick the <strong>&ldquo;Specials &mdash; top hero banner&rdquo;</strong> preset,
              then paste or Media-Library-pick it above.
            </p>
          </div>

          {/* Hero preview column */}
          <div className="lg:sticky lg:top-4 lg:self-start">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
              Hero preview
            </div>
            <HeroPreview
              image={pres.heroBannerImage}
              textAlign={pres.heroBannerTextAlign}
              verticalAlign={pres.heroBannerVerticalAlign}
              imageFocus={pres.heroBannerImageFocus}
            />
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              <a href="/specials" target="_blank" rel="noreferrer" className="text-[var(--admin-accent)] hover:underline">
                View live /specials ↗
              </a>
            </div>
          </div>
        </div>
      ) : tab === "cards" ? (
        <>
          {/* Section toggle + badge style (cards-only controls). */}
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex items-center gap-3 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-3 text-sm">
              <input
                type="checkbox"
                checked={pres.showWeeklyGrid}
                onChange={(e) => setGlobal("showWeeklyGrid", e.target.checked)}
              />
              <span>
                <span className="font-semibold">Show the weekly deal cards</span>
                <span className="block text-xs text-[var(--admin-text-muted)]">
                  The 7 day-of-the-week explainer cards.
                </span>
              </span>
            </label>
            <label className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-3 text-sm">
              <span className="font-semibold">Offer badge style</span>
              <select
                value={pres.badgeStyle}
                onChange={(e) => setGlobal("badgeStyle", e.target.value as BadgeStyle)}
                className={`mt-2 w-full ${INPUT_CLASS}`}
              >
                {BADGE_STYLES.map((s) => (
                  <option key={s} value={s}>
                    {BADGE_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* ── Editor column: one row per weekday ────────────────────────── */}
            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                Weekday cards (top to bottom = left to right on the page)
              </div>
              {orderedDays.map((day, index) => {
                const engine = engineByDay.get(day.weekday);
                return (
                  <div
                    key={day.weekday}
                    className={`rounded-[var(--admin-radius-sm)] border p-3 ${
                      day.visible
                        ? "border-[var(--admin-border)] bg-[var(--admin-surface)]"
                        : "border-dashed border-[var(--admin-border)] bg-[var(--admin-surface)]/40 opacity-70"
                    }`}
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-black uppercase tracking-wide">{day.weekday}</span>
                      {engine?.fromDatabase ? (
                        <span className="rounded-full bg-[var(--admin-accent)]/15 px-2 py-0.5 font-semibold text-[var(--admin-accent)]">
                          published promo
                        </span>
                      ) : null}
                      <label className="ml-2 flex items-center gap-1 font-medium">
                        <input
                          type="checkbox"
                          checked={day.visible}
                          onChange={(e) => updateDay(day.weekday, { visible: e.target.checked })}
                        />
                        Show
                      </label>
                      <div className="ml-auto flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveDay(day.weekday, -1)}
                          disabled={index === 0}
                          aria-label={`Move ${day.weekday} up`}
                          className="rounded border border-[var(--admin-border)] px-2 py-1 disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveDay(day.weekday, 1)}
                          disabled={index === orderedDays.length - 1}
                          aria-label={`Move ${day.weekday} down`}
                          className="rounded border border-[var(--admin-border)] px-2 py-1 disabled:opacity-30"
                        >
                          ↓
                        </button>
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-3">
                      <label className="text-xs">
                        <span className="text-[var(--admin-text-muted)]">Title override</span>
                        <input
                          type="text"
                          value={day.titleOverride ?? ""}
                          placeholder={engine?.title || "(promo title)"}
                          onChange={(e) => updateDay(day.weekday, { titleOverride: e.target.value })}
                          className={`mt-1 w-full ${INPUT_CLASS}`}
                        />
                      </label>
                      <label className="text-xs">
                        <span className="text-[var(--admin-text-muted)]">Offer override</span>
                        <input
                          type="text"
                          value={day.offerOverride ?? ""}
                          placeholder={engine?.offer || "(e.g. 25% off)"}
                          onChange={(e) => updateDay(day.weekday, { offerOverride: e.target.value })}
                          className={`mt-1 w-full ${INPUT_CLASS}`}
                        />
                      </label>
                      <label className="text-xs">
                        <span className="text-[var(--admin-text-muted)]">Description override</span>
                        <input
                          type="text"
                          value={day.descriptionOverride ?? ""}
                          placeholder={engine?.description || "(promo description)"}
                          onChange={(e) =>
                            updateDay(day.weekday, { descriptionOverride: e.target.value })
                          }
                          className={`mt-1 w-full ${INPUT_CLASS}`}
                        />
                      </label>
                    </div>
                    <p className="mt-1.5 text-[11px] text-[var(--admin-text-muted)]">
                      Leave a box blank to keep the wording from Promotions. Overrides change the
                      wording on the card only — never the discount.
                    </p>

                    {/* SLICE 119: optional REAL photo for THIS weekday's card. When
                        blank the card shows the built-in product mockup; when set
                        the card's white panel shows this photo instead. */}
                    <div className="mt-3">
                      <span className="text-xs text-[var(--admin-text-muted)]">Card photo (optional)</span>
                      <div className="mt-1">
                        <ContentImageField
                          value={day.image ?? ""}
                          onChange={(v) => updateDay(day.weekday, { image: v })}
                          mediaChoices={mediaChoices}
                          spec={cardSpec}
                        />
                      </div>
                      <p className="mt-1 text-[11px] text-[var(--admin-text-muted)]">
                        Leave blank to keep the built-in product graphic on this card.
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── Preview column: as customers see it ───────────────────────── */}
            <div className="lg:sticky lg:top-4 lg:self-start">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                As customers see it
              </div>
              <div className="max-h-[70vh] space-y-3 overflow-auto rounded-[var(--admin-radius-lg)] border border-white/10 bg-black p-5 text-white">
                {!pres.showWeeklyGrid ? (
                  <p className="text-sm text-white/60">The weekly deal cards are hidden.</p>
                ) : visibleOrder.length === 0 ? (
                  <p className="text-sm text-white/60">All day cards are hidden.</p>
                ) : (
                  visibleOrder.map((weekday) => {
                    const day = dayPresentationFor(pres, weekday);
                    const engine = engineByDay.get(weekday);
                    const title = day?.titleOverride || engine?.title || weekday;
                    const offer = day?.offerOverride || engine?.offer || "";
                    const desc = day?.descriptionOverride || engine?.description || "";
                    return (
                      <div
                        key={weekday}
                        className="rounded-[1rem] border border-white/10 bg-[#101010] p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-[0.6rem] font-black uppercase tracking-[0.18em] text-[var(--orange)]">
                              {weekday}
                            </p>
                            <p className="mt-1 text-lg font-black uppercase leading-tight text-white">
                              {title}
                            </p>
                          </div>
                          {offer ? (
                            <span
                              className={
                                pres.badgeStyle === "bold"
                                  ? "rounded-full bg-[var(--orange)] px-2 py-1 text-xs font-black uppercase text-black"
                                  : pres.badgeStyle === "minimal"
                                    ? "rounded-full border border-white/15 px-2 py-1 text-xs font-black uppercase text-white/85"
                                    : "rounded-full border border-[var(--orange)]/60 bg-black/55 px-2 py-1 text-xs font-black uppercase text-[var(--orange)]"
                              }
                            >
                              {offer.replace(/\s*off$/i, "")}
                            </span>
                          ) : null}
                        </div>
                        {desc ? <p className="mt-2 text-sm text-zinc-300">{desc}</p> : null}
                      </div>
                    );
                  })
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                <a href="/specials" target="_blank" rel="noreferrer" className="text-[var(--admin-accent)] hover:underline">
                  View live /specials ↗
                </a>
                <Link href="/admin/promotions" className="text-[var(--admin-accent)] hover:underline">
                  Edit prices &amp; offers in Promotions →
                </Link>
              </div>
            </div>
          </div>
        </>
      ) : (
        /* ── Today's Deal banner & products tab ─────────────────────────────── */
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Controls column */}
          <div className="space-y-5">
            {/* Show + count, side by side. */}
            <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={pres.showTodaysDeals}
                  onChange={(e) => setGlobal("showTodaysDeals", e.target.checked)}
                />
                <span>
                  <span className="font-semibold">Show today&rsquo;s live products</span>
                  <span className="block text-xs text-[var(--admin-text-muted)]">
                    The grid of real on-deal products for today (with the wide banner above it).
                  </span>
                </span>
              </label>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <label className="text-sm font-semibold" htmlFor="todays-count">
                  Products to show
                </label>
                <input
                  id="todays-count"
                  type="number"
                  min={TODAYS_DEALS_COUNT_MIN}
                  max={TODAYS_DEALS_COUNT_MAX}
                  step={1}
                  value={pres.todaysDealsCount}
                  disabled={!pres.showTodaysDeals}
                  onChange={(e) => setGlobal("todaysDealsCount", clampTodaysDealsCount(e.target.value))}
                  className={`w-24 ${INPUT_CLASS} disabled:opacity-40`}
                />
                <span className="text-xs text-[var(--admin-text-muted)]">
                  Between {TODAYS_DEALS_COUNT_MIN} and {TODAYS_DEALS_COUNT_MAX}. Default is 16.
                </span>
              </div>
            </div>

            {/* Banner image picker (reuses the site-wide helper). */}
            <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
              <div className="mb-1 text-sm font-semibold">Today&rsquo;s Deal banner image</div>
              <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
                The wide banner that sits above the live-products grid. Paste a URL or pick one from
                the Media Library. Leave blank to keep the built-in artwork. The banner title &amp;
                subtitle come from Promotions and stay as-is.
              </p>
              <ContentImageField
                value={pres.todaysDealsBannerImage}
                onChange={(next) => setGlobal("todaysDealsBannerImage", next)}
                mediaChoices={mediaChoices}
                spec={spec}
              />
            </div>

            {/* Text alignment controls. */}
            <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
              <div className="mb-1 text-sm font-semibold">Banner text position</div>
              <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
                Nudge the title &amp; subtitle so they always sit nicely over whatever image you
                choose.
              </p>
              <div className="space-y-3">
                <div>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                    Horizontal
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {TEXT_ALIGNS.map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => setGlobal("todaysDealsBannerTextAlign", a)}
                        className={`rounded-[var(--admin-radius-sm)] px-3 py-1.5 text-sm font-semibold transition ${
                          pres.todaysDealsBannerTextAlign === a
                            ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)] ring-1 ring-[var(--admin-accent)]/40"
                            : "border border-[var(--admin-border)] text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)] hover:text-[var(--admin-text)]"
                        }`}
                      >
                        {TEXT_ALIGN_LABELS[a]}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                    Vertical
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {TEXT_VALIGNS.map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => setGlobal("todaysDealsBannerVerticalAlign", a)}
                        className={`rounded-[var(--admin-radius-sm)] px-3 py-1.5 text-sm font-semibold transition ${
                          pres.todaysDealsBannerVerticalAlign === a
                            ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)] ring-1 ring-[var(--admin-accent)]/40"
                            : "border border-[var(--admin-border)] text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)] hover:text-[var(--admin-text)]"
                        }`}
                      >
                        {TEXT_VALIGN_LABELS[a]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Image focus control — moves the IMAGE's subject independently of
                the text, so the words never collide with the artwork. Uses the
                SAME object-position mapping as the public SectionBanner. */}
            <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
              <div className="mb-1 text-sm font-semibold">Image focus</div>
              <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
                Slide the picture so its main subject shows next to your text &mdash; this moves the{" "}
                <strong>image</strong> on its own, so the words and the artwork never sit on top of
                each other. Tip: if your text is on the <em>left</em>, set the focus to the{" "}
                <em>right</em> (and vice-versa).
              </p>
              <div className="flex flex-wrap gap-1.5">
                {IMAGE_FOCUSES.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setGlobal("todaysDealsBannerImageFocus", f)}
                    className={`rounded-[var(--admin-radius-sm)] px-3 py-1.5 text-sm font-semibold transition ${
                      pres.todaysDealsBannerImageFocus === f
                        ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)] ring-1 ring-[var(--admin-accent)]/40"
                        : "border border-[var(--admin-border)] text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)] hover:text-[var(--admin-text)]"
                    }`}
                  >
                    {IMAGE_FOCUS_LABELS[f]}
                  </button>
                ))}
              </div>
            </div>

            {/* Nudge to Creative Studio for on-brand banner art. */}
            <p className="text-xs text-[var(--admin-text-muted)]">
              Need on-brand artwork? Generate a wide banner in{" "}
              <Link href="/admin/creative" className="text-[var(--admin-accent)] hover:underline">
                Creative Studio
              </Link>{" "}
              — pick the <strong>&ldquo;Specials banner&rdquo;</strong> preset and the{" "}
              <strong>&ldquo;Specials — Today&rsquo;s Deal banner&rdquo;</strong> destination, then
              paste or Media-Library-pick it above.
            </p>

            {/* SLICE 122 (SET-3): the TOP hero image now lives in the "Top hero"
                tab of THIS editor (moved out of the retired Pages builder). */}
            <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
              <div className="mb-1 text-sm font-semibold">Looking for the big top banner?</div>
              <p className="text-xs text-[var(--admin-text-muted)]">
                The image at the very top of the Specials page is now set in the{" "}
                <strong>&ldquo;Top hero&rdquo;</strong> tab above &mdash; image, text position, and
                image focus, all with a live preview.
              </p>
            </div>
          </div>

          {/* Banner preview column */}
          <div className="lg:sticky lg:top-4 lg:self-start">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
              Banner preview
            </div>
            {pres.showTodaysDeals ? (
              <BannerPreview
                image={pres.todaysDealsBannerImage}
                textAlign={pres.todaysDealsBannerTextAlign}
                verticalAlign={pres.todaysDealsBannerVerticalAlign}
                imageFocus={pres.todaysDealsBannerImageFocus}
                count={pres.todaysDealsCount}
              />
            ) : (
              <div className="rounded-[var(--admin-radius-lg)] border border-white/10 bg-black p-5 text-sm text-white/60">
                Today&rsquo;s live products grid (and its banner) is hidden.
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              <a href="/specials" target="_blank" rel="noreferrer" className="text-[var(--admin-accent)] hover:underline">
                View live /specials ↗
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ── Save / Publish ─────────────────────────────────────────────────── */}
      <form ref={formRef} className="flex flex-wrap items-center gap-3 border-t border-[var(--admin-border)] pt-4">
        <input type="hidden" name="block_key" value={BLOCK_KEY} />
        <input type="hidden" name="draft_value" value={serialized} />
        <Button type="submit" formAction={saveDraftAction} variant="save">
          Save draft
        </Button>
        <Button type="submit" formAction={publishAction} variant="primary">
          Publish
        </Button>
        {dirtyVsPublished ? (
          <span className="rounded-full bg-[var(--admin-gold-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--admin-gold)]">
            Unpublished changes
          </span>
        ) : (
          <span className="text-xs text-[var(--admin-text-muted)]">Matches what&rsquo;s live.</span>
        )}
      </form>

      {/* ── History / restore ──────────────────────────────────────────────── */}
      <div className="border-t border-[var(--admin-border)] pt-4">
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          className="text-sm font-semibold text-[var(--admin-accent)] hover:underline"
        >
          {showHistory ? "Hide" : "Show"} publish history ({revisions.length})
        </button>
        {showHistory ? (
          revisions.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
              No published versions yet. Once you Publish, each version is saved here so you can
              restore it.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {revisions.map((rev) => (
                <li
                  key={rev.id}
                  className="flex flex-wrap items-center gap-3 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] px-3 py-2 text-sm"
                >
                  <span className="text-[var(--admin-text-muted)]">
                    {new Date(rev.created_at).toLocaleString()}
                  </span>
                  {rev.actor_email ? (
                    <span className="text-[var(--admin-text-muted)]">by {rev.actor_email}</span>
                  ) : null}
                  <form action={restoreAction} className="ml-auto">
                    <input type="hidden" name="revision_id" value={rev.id} />
                    <button
                      type="submit"
                      className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] px-3 py-1 font-medium hover:bg-[var(--admin-surface-hover)]"
                    >
                      Restore into draft
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </div>
  );
}

/** Small WYSIWYG-ish preview of the wide banner that mirrors how SectionBanner
 *  positions its overlay text for a given alignment (editor-only visual). */
const PREVIEW_FOCUS_OBJECT_CLASS: Record<ImageFocus, string> = {
  center: "object-center",
  top: "object-top",
  bottom: "object-bottom",
  left: "object-left",
  right: "object-right",
};

function BannerPreview({
  image,
  textAlign,
  verticalAlign,
  imageFocus,
  count,
}: {
  image: string;
  textAlign: TextAlign;
  verticalAlign: TextVAlign;
  imageFocus: ImageFocus;
  count: number;
}) {
  const src = image && image.trim() ? image.trim() : "/home/hero-banner.webp";
  const justify =
    verticalAlign === "top" ? "justify-start" : verticalAlign === "bottom" ? "justify-end" : "justify-center";
  const items =
    textAlign === "center" ? "items-center text-center" : textAlign === "right" ? "items-end text-right" : "items-start text-left";
  const gradient =
    textAlign === "right"
      ? "bg-[linear-gradient(270deg,rgba(0,0,0,0.85)_0%,rgba(0,0,0,0.15)_70%)]"
      : textAlign === "center"
        ? "bg-[linear-gradient(180deg,rgba(0,0,0,0.35)_0%,rgba(0,0,0,0.75)_100%)]"
        : "bg-[linear-gradient(90deg,rgba(0,0,0,0.85)_0%,rgba(0,0,0,0.15)_70%)]";
  // Image focus is now its OWN control (matches the public SectionBanner
  // mapping) instead of being shoved opposite the text — so the preview is a
  // faithful mirror of what shoppers will see.
  const objectPos = PREVIEW_FOCUS_OBJECT_CLASS[imageFocus];
  return (
    <div className="space-y-2">
      <div className="relative aspect-[16/6] w-full overflow-hidden rounded-[var(--admin-radius-lg)] border border-white/10 bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Banner preview" className={`absolute inset-0 h-full w-full object-cover ${objectPos}`} />
        <div className={`absolute inset-0 ${gradient}`} />
        <div className={`relative flex h-full flex-col px-5 py-4 ${justify} ${items}`}>
          <p className="text-[0.6rem] font-black uppercase tracking-[0.18em] text-[var(--orange)]">
            Today&rsquo;s Deal
          </p>
          <p className="mt-1 text-lg font-black uppercase leading-tight text-white">
            (title from Promotions)
          </p>
          <p className="text-sm text-zinc-300">(subtitle from Promotions)</p>
        </div>
      </div>
      <p className="text-xs text-[var(--admin-text-muted)]">
        Below the banner, up to <strong>{count}</strong> live on-deal product{count === 1 ? "" : "s"} for
        today will show. Title &amp; subtitle come from Promotions.
      </p>
    </div>
  );
}

/**
 * SLICE 122 (SET-3): a faithful live preview of the TOP hero, mirroring the
 * public SpecialsContent hero — direction-aware gradient by textAlign (the
 * LEFT/default keeps today's 100deg fade intent), object-position by image
 * focus, and vertical justify. Blank image => gradient-only (today's look).
 */
function HeroPreview({
  image,
  textAlign,
  verticalAlign,
  imageFocus,
}: {
  image: string;
  textAlign: TextAlign;
  verticalAlign: TextVAlign;
  imageFocus: ImageFocus;
}) {
  const src = image && image.trim() ? image.trim() : "";
  const justify =
    verticalAlign === "top" ? "justify-start" : verticalAlign === "bottom" ? "justify-end" : "justify-center";
  const column =
    textAlign === "right" ? "items-end" : textAlign === "center" ? "items-center" : "items-start";
  const items =
    textAlign === "center" ? "items-center text-center" : textAlign === "right" ? "items-end text-right" : "items-start text-left";
  // Mirrors SpecialsContent's heroGradientClass (LEFT default = today's 100deg).
  const gradient =
    textAlign === "right"
      ? "bg-[linear-gradient(260deg,rgba(0,0,0,0.96)_0%,rgba(0,0,0,0.7)_48%,rgba(0,0,0,0.18)_100%)]"
      : textAlign === "center"
        ? "bg-[linear-gradient(180deg,rgba(0,0,0,0.82)_0%,rgba(0,0,0,0.62)_50%,rgba(0,0,0,0.82)_100%)]"
        : "bg-[linear-gradient(100deg,rgba(0,0,0,0.96)_0%,rgba(0,0,0,0.7)_48%,rgba(0,0,0,0.18)_100%)]";
  const objectPos = PREVIEW_FOCUS_OBJECT_CLASS[imageFocus];
  return (
    <div className="space-y-2">
      <div
        className={`relative flex aspect-[16/6] w-full flex-col overflow-hidden rounded-[var(--admin-radius-lg)] border border-white/10 bg-[#1a1a1e] ${justify} ${column}`}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="Hero preview" className={`absolute inset-0 h-full w-full object-cover ${objectPos}`} />
        ) : null}
        <div className={`absolute inset-0 ${gradient}`} />
        <div className={`relative flex max-w-[80%] flex-col px-5 py-4 ${items}`}>
          <p className="inline-flex rounded-full border border-white/20 bg-black/40 px-2 py-0.5 text-[0.55rem] font-black uppercase tracking-[0.2em] text-[var(--greenway)]">
            (eyebrow from Site Content)
          </p>
          <p className="mt-1 text-lg font-black uppercase leading-tight text-white">
            (title from Site Content)
          </p>
          <p className="text-sm text-zinc-300">(subtitle from Site Content)</p>
        </div>
      </div>
      <p className="text-xs text-[var(--admin-text-muted)]">
        The eyebrow, title & subtitle come from Site Content; this tab sets the image + where the
        text and picture sit. Blank image keeps the built-in gradient look.
      </p>
    </div>
  );
}
