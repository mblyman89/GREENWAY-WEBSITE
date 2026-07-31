"use client";

/**
 * LoyaltyHeroEditor (SLICE 123 / LOY-1) — the "special" banner editor for the
 * /loyalty hero. Unlike the other banner editors (where the eyebrow/title/
 * subtitle wording lives in Site Content), THIS editor owns everything about the
 * hero banner:
 *
 *   • background image (desktop) + a separate mobile image, each with its own
 *     focus (Creative-Studio / Media-Library friendly via ContentImageField),
 *   • THREE overlay text blocks (eyebrow / title / subtitle), each with:
 *       – editable text (press Enter to STACK lines like the classic art),
 *       – a FONT family (bold display / clean sans / cursive script),
 *       – an on-brand COLOR (white / gold / Greenway green / orange / soft),
 *       – a show/hide toggle,
 *       – an optional bigger "script size" for a cursive line,
 *   • text horizontal align + vertical align.
 *
 * A live PREVIEW renders the REAL public <LoyaltyHeroBanner> with the current
 * state, so what staff see here is exactly what shoppers get. State serializes
 * into the hidden `draft_value` of the ONE "richjson" block
 * (loyalty.hero.presentation); Save draft / Publish / Restore reuse the same
 * battle-tested content-block machinery as Site Content.
 */

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/admin/ui";
import { ContentImageField, type MediaChoice } from "@/components/admin/ContentImageField";
import type { ImageSpec } from "@/lib/cms/image-spec-core";
import { LoyaltyHeroBanner } from "@/components/loyalty/LoyaltyHeroBanner";
import {
  LOYALTY_HERO_PRESENTATION_BLOCK,
  TEXT_ALIGNS,
  TEXT_VALIGNS,
  IMAGE_FOCUSES,
  HERO_FONTS,
  HERO_COLORS,
  SCRIPT_SCALE_MIN,
  SCRIPT_SCALE_MAX,
  isScriptHeroFont,
  normalizeLoyaltyHeroPresentation,
  serializeLoyaltyHeroPresentation,
  type LoyaltyHeroPresentation,
  type HeroTextBlock,
  type TextAlign,
  type TextVAlign,
  type ImageFocus,
} from "@/lib/loyalty/loyalty-hero-core";

export type LoyaltyHeroRevisionVM = {
  id: string;
  created_at: string;
  actor_email: string | null;
};

type Props = {
  draftJson: string | null;
  publishedJson: string | null;
  revisions: LoyaltyHeroRevisionVM[];
  saveDraftAction: (formData: FormData) => void | Promise<void>;
  publishAction: (formData: FormData) => void | Promise<void>;
  restoreAction: (formData: FormData) => void | Promise<void>;
  mediaChoices: MediaChoice[];
  /** Image spec for the wide desktop banner (loyalty.hero.image). */
  desktopSpec?: ImageSpec;
  /** Image spec for the mobile banner (loyalty.hero.image_mobile). */
  mobileSpec?: ImageSpec;
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
const IMAGE_FOCUS_LABELS: Record<ImageFocus, string> = {
  center: "Center",
  top: "Top",
  bottom: "Bottom",
  left: "Left",
  right: "Right",
};

const INPUT_CLASS =
  "rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm text-[var(--admin-text)] placeholder:text-[var(--admin-text-faint)] focus:border-[var(--admin-accent)] focus:outline-none";

function safeParse(json: string | null): unknown {
  if (!json || !json.trim()) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function initialPresentation(props: Props): LoyaltyHeroPresentation {
  return normalizeLoyaltyHeroPresentation(
    safeParse(props.draftJson) ?? safeParse(props.publishedJson) ?? null,
  );
}

/** A small segmented button group (align / focus pickers). */
function Segmented<T extends string>({
  options,
  value,
  labels,
  onChange,
}: {
  options: readonly T[];
  value: T;
  labels: Record<T, string>;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={`rounded-[var(--admin-radius-sm)] px-3 py-1.5 text-sm font-semibold transition ${
            value === o
              ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)] ring-1 ring-[var(--admin-accent)]/40"
              : "border border-[var(--admin-border)] text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)] hover:text-[var(--admin-text)]"
          }`}
        >
          {labels[o]}
        </button>
      ))}
    </div>
  );
}

/** The editor card for ONE overlay text block (eyebrow / title / subtitle). */
function BlockEditor({
  title,
  hint,
  block,
  multiline,
  onChange,
}: {
  title: string;
  hint: string;
  block: HeroTextBlock;
  multiline: boolean;
  onChange: (patch: Partial<HeroTextBlock>) => void;
}) {
  const scriptable = isScriptHeroFont(block.font);
  return (
    <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">{title}</div>
        <label className="flex items-center gap-2 text-xs text-[var(--admin-text-muted)]">
          <input
            type="checkbox"
            checked={block.show}
            onChange={(e) => onChange({ show: e.target.checked })}
          />
          Show
        </label>
      </div>
      <p className="mb-3 text-xs text-[var(--admin-text-muted)]">{hint}</p>

      {multiline ? (
        <textarea
          value={block.text}
          onChange={(e) => onChange({ text: e.target.value })}
          rows={3}
          placeholder="Type your text — press Enter to stack lines"
          className={`w-full ${INPUT_CLASS}`}
        />
      ) : (
        <input
          type="text"
          value={block.text}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder="Type your text"
          className={`w-full ${INPUT_CLASS}`}
        />
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
          Font
          <select
            value={block.font}
            onChange={(e) => onChange({ font: e.target.value })}
            className={`mt-1.5 w-full ${INPUT_CLASS}`}
          >
            <optgroup label="Display (bold headlines)">
              {HERO_FONTS.filter((f) => f.group === "display").map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Clean sans">
              {HERO_FONTS.filter((f) => f.group === "sans").map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Script (cursive)">
              {HERO_FONTS.filter((f) => f.group === "script").map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </optgroup>
          </select>
        </label>

        <div className="block text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
          Color
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {HERO_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                title={c.label}
                onClick={() => onChange({ color: c.id })}
                className={`h-8 w-8 rounded-full border transition ${
                  block.color === c.id
                    ? "ring-2 ring-[var(--admin-accent)] ring-offset-1 ring-offset-[var(--admin-surface)]"
                    : "border-white/20 hover:scale-105"
                }`}
                style={{ backgroundColor: c.hex }}
              />
            ))}
          </div>
        </div>
      </div>

      {scriptable ? (
        <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
          Cursive size ({block.scriptScale.toFixed(1)}×)
          <input
            type="range"
            min={SCRIPT_SCALE_MIN}
            max={SCRIPT_SCALE_MAX}
            step={0.1}
            value={block.scriptScale}
            onChange={(e) => onChange({ scriptScale: Number(e.target.value) })}
            className="mt-1.5 w-full accent-[var(--admin-accent)]"
          />
          <span className="font-normal normal-case text-[var(--admin-text-faint)]">
            Make the cursive flourish larger without changing the other lines.
          </span>
        </label>
      ) : null}
    </div>
  );
}

export function LoyaltyHeroEditor(props: Props) {
  const {
    revisions,
    saveDraftAction,
    publishAction,
    restoreAction,
    mediaChoices,
    desktopSpec,
    mobileSpec,
  } = props;
  const [pres, setPres] = useState<LoyaltyHeroPresentation>(() => initialPresentation(props));
  const [showHistory, setShowHistory] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const serialized = useMemo(() => serializeLoyaltyHeroPresentation(pres), [pres]);
  const publishedSerialized = useMemo(
    () =>
      serializeLoyaltyHeroPresentation(
        normalizeLoyaltyHeroPresentation(safeParse(props.publishedJson)),
      ),
    [props.publishedJson],
  );
  const dirtyVsPublished = serialized !== publishedSerialized;

  function setField<K extends keyof LoyaltyHeroPresentation>(
    key: K,
    value: LoyaltyHeroPresentation[K],
  ) {
    setPres((p) => ({ ...p, [key]: value }));
  }
  function patchBlock(
    which: "eyebrow" | "title" | "subtitle",
    patch: Partial<HeroTextBlock>,
  ) {
    setPres((p) => ({ ...p, [which]: { ...p[which], ...patch } }));
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
        <strong>This is your Loyalty banner — fully yours to style.</strong> Pick the background
        picture, then style the three lines of text (eyebrow, title, subtitle): choose a font, an
        on-brand color, and where they sit. Press <strong>Enter</strong> inside a text box to stack
        lines. The subtitle has a cursive option for a nice flourish. Nothing goes live until you
        click <strong>Publish</strong>.
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Controls column */}
        <div className="space-y-5">
          {/* Desktop image */}
          <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
            <div className="mb-1 text-sm font-semibold">Background image (desktop)</div>
            <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
              The wide banner on computers. Use a <strong>textless</strong> picture (the words are
              added below as editable text). Paste a URL or pick from the Media Library. Need
              on-brand art? Generate a &ldquo;Loyalty hero&rdquo; in Creative Studio.
            </p>
            <ContentImageField
              value={pres.image}
              onChange={(next) => setField("image", next)}
              mediaChoices={mediaChoices}
              spec={desktopSpec}
            />
          </div>

          {/* Mobile image */}
          <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
            <div className="mb-1 text-sm font-semibold">Background image (mobile)</div>
            <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
              A taller crop (about 3:1) that reads better on phones. Set a dedicated mobile image
              for the best result on small screens; if left blank the banner shows a plain dark
              panel with your text.
            </p>
            <ContentImageField
              value={pres.imageMobile}
              onChange={(next) => setField("imageMobile", next)}
              mediaChoices={mediaChoices}
              spec={mobileSpec}
            />
          </div>

          {/* Text position */}
          <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
            <div className="mb-1 text-sm font-semibold">Text position</div>
            <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
              Where all three lines of text sit over the picture. (The leaf art sits on the left by
              default, so the text starts on the right.)
            </p>
            <div className="space-y-3">
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                  Horizontal
                </div>
                <Segmented
                  options={TEXT_ALIGNS}
                  value={pres.textAlign}
                  labels={TEXT_ALIGN_LABELS}
                  onChange={(v) => setField("textAlign", v)}
                />
              </div>
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                  Vertical
                </div>
                <Segmented
                  options={TEXT_VALIGNS}
                  value={pres.verticalAlign}
                  labels={TEXT_VALIGN_LABELS}
                  onChange={(v) => setField("verticalAlign", v)}
                />
              </div>
            </div>
          </div>

          {/* Image focus (desktop + mobile) */}
          <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
            <div className="mb-1 text-sm font-semibold">Picture focus</div>
            <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
              Slide the picture so its subject (the leaf) shows next to your text. This moves the
              image on its own so the words and artwork never collide.
            </p>
            <div className="space-y-3">
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                  Desktop
                </div>
                <Segmented
                  options={IMAGE_FOCUSES}
                  value={pres.imageFocus}
                  labels={IMAGE_FOCUS_LABELS}
                  onChange={(v) => setField("imageFocus", v)}
                />
              </div>
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
                  Mobile
                </div>
                <Segmented
                  options={IMAGE_FOCUSES}
                  value={pres.imageFocusMobile}
                  labels={IMAGE_FOCUS_LABELS}
                  onChange={(v) => setField("imageFocusMobile", v)}
                />
              </div>
            </div>
          </div>

          {/* Three text blocks */}
          <BlockEditor
            title="Eyebrow (small kicker above the title)"
            hint="A short line above the headline — e.g. “A Smoking Deal!”. It sits above the leaf area."
            block={pres.eyebrow}
            multiline={false}
            onChange={(patch) => patchBlock("eyebrow", patch)}
          />
          <BlockEditor
            title="Title (the big headline)"
            hint="The main headline. Press Enter to stack lines, e.g. “Greenway / Loyalty / Points”."
            block={pres.title}
            multiline
            onChange={(patch) => patchBlock("title", patch)}
          />
          <BlockEditor
            title="Subtitle (the flourish line)"
            hint="A supporting line — great with a cursive font, e.g. “Earn Points With Every Purchase”."
            block={pres.subtitle}
            multiline={false}
            onChange={(patch) => patchBlock("subtitle", patch)}
          />
        </div>

        {/* Live preview column — renders the REAL public banner. */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
            Live preview (exactly what shoppers see)
          </div>
          {/* Force desktop rendering of the banner inside the preview frame so
              staff always see the wide layout; a note points to mobile. */}
          <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-white/10 bg-black p-3">
            <div className="loyalty-hero-preview">
              <LoyaltyHeroBanner presentation={pres} />
            </div>
          </div>
          <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
            This preview updates as you edit. The desktop banner is shown here; phones use the mobile
            image and a taller shape.
          </p>
          <div className="mt-2 flex flex-wrap gap-3 text-xs">
            <a
              href="/loyalty"
              target="_blank"
              rel="noreferrer"
              className="text-[var(--admin-accent)] hover:underline"
            >
              View live /loyalty ↗
            </a>
          </div>
        </div>
      </div>

      {/* Save / Publish */}
      <form
        ref={formRef}
        className="flex flex-wrap items-center gap-3 border-t border-[var(--admin-border)] pt-4"
      >
        <input type="hidden" name="block_key" value={LOYALTY_HERO_PRESENTATION_BLOCK} />
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

      {/* History / restore */}
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
