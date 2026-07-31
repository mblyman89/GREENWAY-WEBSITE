/**
 * src/lib/specials/specials-presentation-core.ts
 *
 * SLICE 106 — the PURE single source of truth for how the /specials
 * "Weekly Cannabis Deals" grid is PRESENTED. This module governs ONLY
 * presentation (which weekday cards show, their order, an optional copy
 * override, the offer-badge style, and whether the two deal sections show).
 *
 * IT NEVER TOUCHES DISCOUNT MATH. All pricing, offer derivation, and the
 * customer copy defaults come from the promotions engine
 * (src/lib/promotions/published-rules-core.ts). This layer sits on top at
 * render time and is LIVE-LOOK-SAFE: the default settings reproduce today's
 * page byte-for-byte (every day visible, natural Mon→Sun order, no overrides,
 * "classic" badge, both sections on). A page can therefore never blank or
 * change until a staff member deliberately edits a setting and publishes.
 *
 * Storage: ONE content_blocks JSON row `specials.deals.presentation`
 * (field_type "richjson"). field_type / draft_value / published_value are
 * plain unconstrained text columns (supabase/migrations/0005_slice5_cms.sql
 * L100-102), so this needs NO migration — same basis as SLICE 105 "select"
 * and SLICE 105b "richdoc".
 */

/**
 * The ONE content_blocks row that stores the Specials presentation settings.
 * Lives here (a plain module) so both the "use server" actions file and the
 * editor page can import it — a "use server" file may only export async
 * functions, so the block-key constant cannot live there.
 */
export const SPECIALS_PRESENTATION_BLOCK = "specials.deals.presentation";

/** The seven store weekdays in natural display order (matches SpecialsContent). */
export const SPECIALS_WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export type SpecialsWeekday = (typeof SPECIALS_WEEKDAYS)[number];

/** Offer-badge styles for the weekly-deal cards (purely visual). */
export const BADGE_STYLES = ["classic", "bold", "minimal"] as const;
export type BadgeStyle = (typeof BADGE_STYLES)[number];

export function isBadgeStyle(v: unknown): v is BadgeStyle {
  return typeof v === "string" && (BADGE_STYLES as readonly string[]).includes(v);
}

/** Horizontal text placement for the "Today's Deal" wide banner. */
export const TEXT_ALIGNS = ["left", "center", "right"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

export function isTextAlign(v: unknown): v is TextAlign {
  return typeof v === "string" && (TEXT_ALIGNS as readonly string[]).includes(v);
}

/** Vertical text placement for the "Today's Deal" wide banner. */
export const TEXT_VALIGNS = ["top", "center", "bottom"] as const;
export type TextVAlign = (typeof TEXT_VALIGNS)[number];

export function isTextVAlign(v: unknown): v is TextVAlign {
  return typeof v === "string" && (TEXT_VALIGNS as readonly string[]).includes(v);
}

/**
 * Where the "Today's Deal" banner IMAGE sits, INDEPENDENT of the text.
 * SLICE 117 bug fix: historically the banner image's position was hard-wired to
 * the text alignment, so moving the text also shoved the image. This gives the
 * image its own control. Default "right" reproduces today's exact look (because
 * the default text-align is "left", the legacy code shoved the image right), so
 * the live page is byte-identical until staff choose otherwise.
 */
export const IMAGE_FOCUSES = ["center", "top", "bottom", "left", "right"] as const;
export type ImageFocus = (typeof IMAGE_FOCUSES)[number];

export function isImageFocus(v: unknown): v is ImageFocus {
  return typeof v === "string" && (IMAGE_FOCUSES as readonly string[]).includes(v);
}

/**
 * How many "Today's Deals" product cards to show. Today's hardcoded value is
 * 16 (SpecialsDailyDeals LIMIT). We allow 1..24 (the grid is up to 4 wide, so
 * this keeps whole rows sensible) and default to 16 so nothing changes until a
 * staff member edits it.
 */
export const TODAYS_DEALS_COUNT_DEFAULT = 16;
export const TODAYS_DEALS_COUNT_MIN = 1;
export const TODAYS_DEALS_COUNT_MAX = 24;

/** Clamp any input to a valid Today's-Deals product count (default 16). */
export function clampTodaysDealsCount(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return TODAYS_DEALS_COUNT_DEFAULT;
  const i = Math.trunc(n);
  if (i < TODAYS_DEALS_COUNT_MIN) return TODAYS_DEALS_COUNT_MIN;
  if (i > TODAYS_DEALS_COUNT_MAX) return TODAYS_DEALS_COUNT_MAX;
  return i;
}

/**
 * Per-day presentation. `visible` hides the card; `order` is a small integer
 * used to sort the visible cards (ties keep natural weekday order); the three
 * optional overrides let staff tweak the card COPY without touching the
 * promotion mechanics. An empty/undefined override means "use the engine/seed
 * copy" (live-look-safe).
 */
export type DayPresentation = {
  weekday: SpecialsWeekday;
  visible: boolean;
  order: number;
  /** Optional copy overrides (blank => fall back to the engine/seed copy). */
  titleOverride?: string;
  offerOverride?: string;
  descriptionOverride?: string;
  /**
   * SLICE 119: optional REAL photo for this weekday's card. When blank the card
   * shows the built-in CSS "package" mockup (live-look-safe default); when set
   * the card's white artwork panel shows this image instead.
   */
  image?: string;
};

export type SpecialsPresentation = {
  /** Show the "Weekly Cannabis Deals" explainer grid (the 7 cards). */
  showWeeklyGrid: boolean;
  /** Show the "Today's Deals" live product grid (SpecialsDailyDeals). */
  showTodaysDeals: boolean;
  /** Offer-chip visual style on the weekly cards. */
  badgeStyle: BadgeStyle;
  /**
   * "Today's Deal" WIDE BANNER background image (the strip above the live
   * product grid). Blank string => keep the built-in default art
   * (/home/hero-banner.webp) so the page is unchanged until staff pick one.
   * The banner's TEXT (title/subtitle) still comes from Promotions — staff
   * only swap the image + choose how the text sits over it.
   */
  todaysDealsBannerImage: string;
  /** Horizontal placement of the banner text over the image (default left). */
  todaysDealsBannerTextAlign: TextAlign;
  /** Vertical placement of the banner text over the image (default center). */
  todaysDealsBannerVerticalAlign: TextVAlign;
  /**
   * Where the banner IMAGE sits, independent of the text (SLICE 117 bug fix).
   * Default "right" reproduces today's exact look (legacy code shoved the image
   * right whenever the text was left-aligned, which is the default).
   */
  todaysDealsBannerImageFocus: ImageFocus;
  /**
   * SLICE 120 (SET-1): where the TOP hero's TEXT (eyebrow/title/subtitle +
   * buttons) sits over the hero image. Historically the hero was a hardcoded
   * block that ignored placement entirely (text pinned left, vertically
   * centered), so staff could edit the copy but could not MOVE it. These three
   * give the hero the same placement controls as the "Today's Deal" banner.
   * Defaults reproduce today's exact look byte-for-byte:
   *  - text left, vertically centered (the hardcoded layout),
   *  - image focus "right" (matches the old `content.imageFocus ?? "right"`).
   */
  heroBannerTextAlign: TextAlign;
  /** Vertical placement of the TOP hero text (default center = today's look). */
  heroBannerVerticalAlign: TextVAlign;
  /** Where the TOP hero IMAGE sits, independent of the text (default right). */
  heroBannerImageFocus: ImageFocus;
  /**
   * SLICE 122 (SET-3): the TOP hero background image, now owned by THIS editor
   * (moved out of the retired Pages builder). Blank string => keep today's
   * gradient-only hero (no image), so the live page is byte-identical until
   * staff upload one and Publish. When set, the image sits behind the dark
   * fade with heroBannerImageFocus / placement applied.
   */
  heroBannerImage: string;
  /** How many live product cards to show under the banner (default 16). */
  todaysDealsCount: number;
  /** Per-weekday settings (always all 7, natural order). */
  days: DayPresentation[];
};

/**
 * The LIVE-LOOK-SAFE default: identical to today's page. Every day visible,
 * order = natural index, no copy overrides, classic badge, both sections on.
 */
export function defaultSpecialsPresentation(): SpecialsPresentation {
  return {
    showWeeklyGrid: true,
    showTodaysDeals: true,
    badgeStyle: "classic",
    // Live-look-safe: blank image keeps the built-in banner art, count 16 and
    // left/center text placement reproduce today's SpecialsDailyDeals exactly.
    todaysDealsBannerImage: "",
    todaysDealsBannerTextAlign: "left",
    todaysDealsBannerVerticalAlign: "center",
    // "right" = byte-identical to the legacy look (left text shoved image right).
    todaysDealsBannerImageFocus: "right",
    // SLICE 120 (SET-1): TOP hero placement. left + center + right reproduce the
    // old hardcoded hero exactly (text pinned left, vertically centered, image
    // focus "right"), so the live page is unchanged until staff move it.
    heroBannerTextAlign: "left",
    heroBannerVerticalAlign: "center",
    heroBannerImageFocus: "right",
    // SLICE 122 (SET-3): blank => today's gradient-only hero (no image), so the
    // live page is unchanged until staff upload one and Publish.
    heroBannerImage: "",
    todaysDealsCount: TODAYS_DEALS_COUNT_DEFAULT,
    days: SPECIALS_WEEKDAYS.map((weekday, i) => ({
      weekday,
      visible: true,
      order: i,
    })),
  };
}

function cleanOverride(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
}

/**
 * Coerce an unknown object into a valid, complete SpecialsPresentation. Missing
 * or malformed fields fall back to the live-look-safe default. This guarantees
 * a page NEVER blanks on bad data and unknown weekdays are dropped.
 */
export function normalizeSpecialsPresentation(
  input: unknown,
): SpecialsPresentation {
  const base = defaultSpecialsPresentation();
  if (!input || typeof input !== "object") return base;
  const obj = input as Record<string, unknown>;

  const showWeeklyGrid =
    typeof obj.showWeeklyGrid === "boolean" ? obj.showWeeklyGrid : base.showWeeklyGrid;
  const showTodaysDeals =
    typeof obj.showTodaysDeals === "boolean" ? obj.showTodaysDeals : base.showTodaysDeals;
  const badgeStyle = isBadgeStyle(obj.badgeStyle) ? obj.badgeStyle : base.badgeStyle;

  // "Today's Deal" banner extras (all fall back to the live-look-safe default).
  const todaysDealsBannerImage =
    typeof obj.todaysDealsBannerImage === "string"
      ? obj.todaysDealsBannerImage.trim()
      : base.todaysDealsBannerImage;
  const todaysDealsBannerTextAlign = isTextAlign(obj.todaysDealsBannerTextAlign)
    ? obj.todaysDealsBannerTextAlign
    : base.todaysDealsBannerTextAlign;
  const todaysDealsBannerVerticalAlign = isTextVAlign(obj.todaysDealsBannerVerticalAlign)
    ? obj.todaysDealsBannerVerticalAlign
    : base.todaysDealsBannerVerticalAlign;
  const todaysDealsBannerImageFocus = isImageFocus(obj.todaysDealsBannerImageFocus)
    ? obj.todaysDealsBannerImageFocus
    : base.todaysDealsBannerImageFocus;

  // SLICE 120 (SET-1): TOP hero placement (all fall back to the live-look-safe
  // default so the hero is byte-identical until staff move the text/image).
  const heroBannerTextAlign = isTextAlign(obj.heroBannerTextAlign)
    ? obj.heroBannerTextAlign
    : base.heroBannerTextAlign;
  const heroBannerVerticalAlign = isTextVAlign(obj.heroBannerVerticalAlign)
    ? obj.heroBannerVerticalAlign
    : base.heroBannerVerticalAlign;
  const heroBannerImageFocus = isImageFocus(obj.heroBannerImageFocus)
    ? obj.heroBannerImageFocus
    : base.heroBannerImageFocus;
  // SLICE 122 (SET-3): TOP hero image (moved from the retired Pages builder).
  const heroBannerImage =
    typeof obj.heroBannerImage === "string"
      ? obj.heroBannerImage.trim()
      : base.heroBannerImage;
  const todaysDealsCount =
    obj.todaysDealsCount === undefined
      ? base.todaysDealsCount
      : clampTodaysDealsCount(obj.todaysDealsCount);

  // Index any provided day entries by weekday so we can merge onto the full 7.
  const byWeekday = new Map<SpecialsWeekday, Record<string, unknown>>();
  if (Array.isArray(obj.days)) {
    for (const raw of obj.days) {
      if (!raw || typeof raw !== "object") continue;
      const d = raw as Record<string, unknown>;
      const wd = d.weekday;
      if (typeof wd === "string" && (SPECIALS_WEEKDAYS as readonly string[]).includes(wd)) {
        byWeekday.set(wd as SpecialsWeekday, d);
      }
    }
  }

  const days: DayPresentation[] = SPECIALS_WEEKDAYS.map((weekday, i) => {
    const d = byWeekday.get(weekday);
    if (!d) return { weekday, visible: true, order: i };
    return {
      weekday,
      visible: typeof d.visible === "boolean" ? d.visible : true,
      order: Number.isFinite(d.order as number) ? Math.trunc(d.order as number) : i,
      titleOverride: cleanOverride(d.titleOverride),
      offerOverride: cleanOverride(d.offerOverride),
      descriptionOverride: cleanOverride(d.descriptionOverride),
      image: cleanOverride(d.image),
    };
  });

  return {
    showWeeklyGrid,
    showTodaysDeals,
    badgeStyle,
    todaysDealsBannerImage,
    todaysDealsBannerTextAlign,
    todaysDealsBannerVerticalAlign,
    todaysDealsBannerImageFocus,
    heroBannerTextAlign,
    heroBannerVerticalAlign,
    heroBannerImageFocus,
    heroBannerImage,
    todaysDealsCount,
    days,
  };
}

/** Serialize to the stored JSON string (stable key order for clean diffs). */
export function serializeSpecialsPresentation(p: SpecialsPresentation): string {
  const norm = normalizeSpecialsPresentation(p);
  return JSON.stringify({
    showWeeklyGrid: norm.showWeeklyGrid,
    showTodaysDeals: norm.showTodaysDeals,
    badgeStyle: norm.badgeStyle,
    todaysDealsBannerImage: norm.todaysDealsBannerImage,
    todaysDealsBannerTextAlign: norm.todaysDealsBannerTextAlign,
    todaysDealsBannerVerticalAlign: norm.todaysDealsBannerVerticalAlign,
    todaysDealsBannerImageFocus: norm.todaysDealsBannerImageFocus,
    heroBannerTextAlign: norm.heroBannerTextAlign,
    heroBannerVerticalAlign: norm.heroBannerVerticalAlign,
    heroBannerImageFocus: norm.heroBannerImageFocus,
    heroBannerImage: norm.heroBannerImage,
    todaysDealsCount: norm.todaysDealsCount,
    days: norm.days.map((d) => {
      const out: Record<string, unknown> = {
        weekday: d.weekday,
        visible: d.visible,
        order: d.order,
      };
      if (d.titleOverride) out.titleOverride = d.titleOverride;
      if (d.offerOverride) out.offerOverride = d.offerOverride;
      if (d.descriptionOverride) out.descriptionOverride = d.descriptionOverride;
      if (d.image) out.image = d.image;
      return out;
    }),
  });
}

/**
 * Parse a stored JSON string. Returns null on missing / invalid JSON so callers
 * can decide to fall back to the default (never blank a page).
 */
export function parseSpecialsPresentation(
  json: string | null | undefined,
): SpecialsPresentation | null {
  if (!json || !json.trim()) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  return normalizeSpecialsPresentation(raw);
}

/**
 * Resolve the settings to use for rendering: the parsed stored value when valid,
 * otherwise the live-look-safe default. This is what public pages call.
 */
export function resolveSpecialsPresentation(
  storedJson: string | null | undefined,
): SpecialsPresentation {
  return parseSpecialsPresentation(storedJson) ?? defaultSpecialsPresentation();
}

/**
 * A minimal card shape the resolver reorders/filters. The caller supplies the
 * full card objects keyed by weekday; we only decide order + visibility +
 * copy overrides. (Generic so both the storefront card type and tests fit.)
 */
export type OrderableCard = { day: string };

/**
 * Given the presentation settings and the natural-order cards (keyed by their
 * `day`), return ONLY the visible cards in the configured order. Cards whose
 * weekday is not mentioned in settings keep their natural position and stay
 * visible (live-look-safe for any future card). Deterministic and pure.
 */
export function orderedVisibleWeekdays(
  presentation: SpecialsPresentation,
): SpecialsWeekday[] {
  return presentation.days
    .filter((d) => d.visible)
    .map((d) => ({ d, naturalIndex: SPECIALS_WEEKDAYS.indexOf(d.weekday) }))
    .sort((a, b) => a.d.order - b.d.order || a.naturalIndex - b.naturalIndex)
    .map((x) => x.d.weekday);
}

/** Look up a single day's presentation (or a default entry). */
export function dayPresentationFor(
  presentation: SpecialsPresentation,
  weekday: string,
): DayPresentation | null {
  return presentation.days.find((d) => d.weekday === weekday) ?? null;
}

/**
 * True when a published weekday promotion would be HIDDEN by these presentation
 * settings (weekly grid off, or that specific day's card set invisible). Used by
 * the promotions dashboard warning. `weekdayLabel` is the SpecialsWeekday label.
 */
export function isWeekdayHiddenByPresentation(
  presentation: SpecialsPresentation,
  weekdayLabel: string,
): boolean {
  if (!presentation.showWeeklyGrid) return true;
  const d = dayPresentationFor(presentation, weekdayLabel);
  return d ? !d.visible : false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure self-tests (throw on failure). Registered in the pure-selftest runner.
// ─────────────────────────────────────────────────────────────────────────────
export function __runSpecialsPresentationCoreTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`specials-presentation-core: ${msg}`);
    passed += 1;
  };

  // Default is live-look-safe.
  const def = defaultSpecialsPresentation();
  ok(def.showWeeklyGrid && def.showTodaysDeals, "default shows both sections");
  ok(def.badgeStyle === "classic", "default badge is classic");
  ok(def.days.length === 7, "default has 7 days");
  ok(def.days.every((d, i) => d.weekday === SPECIALS_WEEKDAYS[i]), "default days in natural order");
  ok(def.days.every((d) => d.visible), "default all days visible");
  ok(def.days.every((d, i) => d.order === i), "default order = natural index");
  ok(
    def.days.every((d) => !d.titleOverride && !d.offerOverride && !d.descriptionOverride),
    "default has no copy overrides",
  );

  // orderedVisibleWeekdays default = natural Mon→Sun.
  const natural = orderedVisibleWeekdays(def);
  ok(natural.length === 7 && natural[0] === "Monday" && natural[6] === "Sunday", "default order Mon→Sun");

  // Hiding + reordering.
  const custom = normalizeSpecialsPresentation({
    showWeeklyGrid: true,
    showTodaysDeals: false,
    badgeStyle: "bold",
    days: [
      { weekday: "Sunday", visible: true, order: 0 },
      { weekday: "Monday", visible: false, order: 1 },
      { weekday: "Tuesday", visible: true, order: 2, titleOverride: "Two-fer Tuesday", offerOverride: "  ", descriptionOverride: "Buy more save more", image: "/media/tuesday.webp" },
      // SLICE 119: a blank/whitespace image must normalize to undefined.
      { weekday: "Wednesday", visible: true, order: 3, image: "   " },
    ],
  });
  ok(custom.showTodaysDeals === false, "custom hides Today's Deals");
  ok(custom.badgeStyle === "bold", "custom badge bold");
  const order = orderedVisibleWeekdays(custom);
  ok(!order.includes("Monday"), "hidden Monday dropped");
  ok(order[0] === "Sunday", "Sunday reordered to front (order 0)");
  const tue = dayPresentationFor(custom, "Tuesday")!;
  ok(tue.titleOverride === "Two-fer Tuesday", "override title kept");
  ok(tue.offerOverride === undefined, "blank/whitespace override normalized to undefined");
  ok(tue.descriptionOverride === "Buy more save more", "override description kept");
  // SLICE 119: per-day image.
  ok(tue.image === "/media/tuesday.webp", "per-day image kept");
  ok(
    dayPresentationFor(custom, "Wednesday")!.image === undefined,
    "blank/whitespace image normalized to undefined",
  );

  // Unknown weekday dropped; missing days filled visible/natural.
  const withJunk = normalizeSpecialsPresentation({
    days: [{ weekday: "Funday", visible: false, order: 0 }, { weekday: "Friday", visible: false, order: 3 }],
  });
  ok(withJunk.days.length === 7, "unknown weekday dropped, still 7 days");
  ok(withJunk.days.find((d) => d.weekday === "Monday")!.visible === true, "unmentioned day defaults visible");
  ok(withJunk.days.find((d) => d.weekday === "Friday")!.visible === false, "known day setting applied");

  // Serialize → parse round-trip.
  const json = serializeSpecialsPresentation(custom);
  const round = parseSpecialsPresentation(json)!;
  ok(round.badgeStyle === "bold" && round.showTodaysDeals === false, "round-trip preserves globals");
  ok(dayPresentationFor(round, "Tuesday")!.titleOverride === "Two-fer Tuesday", "round-trip preserves overrides");
  ok(dayPresentationFor(round, "Tuesday")!.image === "/media/tuesday.webp", "round-trip preserves per-day image");
  // SLICE 119: a day with no image must NOT serialize an `image` key (byte-identical defaults).
  ok(!/"weekday":"Monday"[^}]*"image"/.test(json), "days without an image omit the image key");

  // Bad JSON / empty → null (caller falls back).
  ok(parseSpecialsPresentation("not json") === null, "bad JSON → null");
  ok(parseSpecialsPresentation("") === null, "empty → null");
  ok(parseSpecialsPresentation(null) === null, "null → null");

  // resolve() never returns null and default JSON reproduces the default.
  const resolvedDefault = resolveSpecialsPresentation(null);
  ok(resolvedDefault.days.length === 7, "resolve(null) → full default");
  const resolvedRound = resolveSpecialsPresentation(serializeSpecialsPresentation(def));
  ok(
    JSON.stringify(resolvedRound) === JSON.stringify(def),
    "serialized default resolves back to the default (byte-identical intent)",
  );

  // hidden-by-presentation logic.
  ok(isWeekdayHiddenByPresentation(custom, "Monday") === true, "Monday hidden flagged");
  ok(isWeekdayHiddenByPresentation(custom, "Tuesday") === false, "Tuesday visible not flagged");
  const gridOff = normalizeSpecialsPresentation({ showWeeklyGrid: false });
  ok(isWeekdayHiddenByPresentation(gridOff, "Wednesday") === true, "grid off hides every day");

  // isBadgeStyle guard.
  ok(isBadgeStyle("classic") && isBadgeStyle("bold") && isBadgeStyle("minimal"), "valid badge styles");
  ok(!isBadgeStyle("neon") && !isBadgeStyle(3), "invalid badge styles rejected");

  // ── Today's Deal banner extras (SLICE 111) ────────────────────────────────
  // Default is live-look-safe: blank image, 16 cards, left/center placement.
  ok(def.todaysDealsBannerImage === "", "default banner image blank (keeps built-in art)");
  ok(def.todaysDealsBannerTextAlign === "left", "default banner text-align left (today's look)");
  ok(def.todaysDealsBannerVerticalAlign === "center", "default banner vertical-align center");
  // SLICE 117: default image-focus "right" reproduces the legacy look exactly.
  ok(def.todaysDealsBannerImageFocus === "right", "default banner image-focus right (legacy look)");
  ok(def.todaysDealsCount === 16, "default today's-deals count is 16 (matches LIMIT)");

  // ── TOP hero placement (SLICE 120 / SET-1) ─────────────────────────────
  // Defaults reproduce the old hardcoded hero exactly: text left, vertically
  // centered, image focus "right".
  ok(def.heroBannerTextAlign === "left", "default hero text-align left (today's look)");
  ok(def.heroBannerVerticalAlign === "center", "default hero vertical-align center (today's look)");
  ok(def.heroBannerImageFocus === "right", "default hero image-focus right (today's look)");
  ok(def.heroBannerImage === "", "default hero image blank (gradient-only, today's look)");

  // Text-align + vertical-align guards.
  ok(isTextAlign("left") && isTextAlign("center") && isTextAlign("right"), "valid text aligns");
  ok(!isTextAlign("justify") && !isTextAlign(1), "invalid text aligns rejected");
  ok(isTextVAlign("top") && isTextVAlign("center") && isTextVAlign("bottom"), "valid vertical aligns");
  ok(!isTextVAlign("middle") && !isTextVAlign(null), "invalid vertical aligns rejected");

  // Image-focus guard (SLICE 117 bug fix).
  ok(
    isImageFocus("center") &&
      isImageFocus("top") &&
      isImageFocus("bottom") &&
      isImageFocus("left") &&
      isImageFocus("right"),
    "valid image focuses",
  );
  ok(!isImageFocus("middle") && !isImageFocus(null) && !isImageFocus(2), "invalid image focuses rejected");

  // Count clamp: below min -> min, above max -> max, non-finite -> default 16.
  ok(clampTodaysDealsCount(0) === 1, "count clamps up to min 1");
  ok(clampTodaysDealsCount(99) === 24, "count clamps down to max 24");
  ok(clampTodaysDealsCount(8) === 8, "count keeps a valid value");
  ok(clampTodaysDealsCount(8.9) === 8, "count truncates decimals");
  ok(clampTodaysDealsCount("12") === 12, "count parses numeric strings");
  ok(clampTodaysDealsCount("abc") === 16, "count non-numeric -> default 16");
  ok(clampTodaysDealsCount(undefined) === 16, "count undefined -> default 16");

  // Normalize coerces bad extras back to safe values.
  const banner = normalizeSpecialsPresentation({
    todaysDealsBannerImage: "  /media/specials.webp  ",
    todaysDealsBannerTextAlign: "right",
    todaysDealsBannerVerticalAlign: "bottom",
    todaysDealsBannerImageFocus: "top",
    todaysDealsCount: 40,
  });
  ok(banner.todaysDealsBannerImage === "/media/specials.webp", "banner image trimmed");
  ok(banner.todaysDealsBannerTextAlign === "right", "banner text-align applied");
  ok(banner.todaysDealsBannerVerticalAlign === "bottom", "banner vertical-align applied");
  ok(banner.todaysDealsBannerImageFocus === "top", "banner image-focus applied");
  ok(banner.todaysDealsCount === 24, "banner count clamped to max 24");
  const badExtras = normalizeSpecialsPresentation({
    todaysDealsBannerTextAlign: "nope",
    todaysDealsBannerVerticalAlign: "nope",
    todaysDealsBannerImageFocus: "nope",
    todaysDealsCount: NaN,
  });
  ok(badExtras.todaysDealsBannerTextAlign === "left", "bad text-align -> default left");
  ok(badExtras.todaysDealsBannerVerticalAlign === "center", "bad vertical-align -> default center");
  ok(badExtras.todaysDealsBannerImageFocus === "right", "bad image-focus -> default right");
  ok(badExtras.todaysDealsCount === 16, "NaN count -> default 16");

  // Round-trip of the new fields.
  const bannerRound = parseSpecialsPresentation(serializeSpecialsPresentation(banner))!;
  ok(bannerRound.todaysDealsBannerImage === "/media/specials.webp", "round-trip keeps banner image");
  ok(bannerRound.todaysDealsBannerTextAlign === "right", "round-trip keeps text-align");
  ok(bannerRound.todaysDealsBannerVerticalAlign === "bottom", "round-trip keeps vertical-align");
  ok(bannerRound.todaysDealsBannerImageFocus === "top", "round-trip keeps image-focus");
  ok(bannerRound.todaysDealsCount === 24, "round-trip keeps count");

  // ── TOP hero placement: apply / reject / round-trip (SLICE 120 / SET-1) ──
  const hero = normalizeSpecialsPresentation({
    heroBannerTextAlign: "center",
    heroBannerVerticalAlign: "top",
    heroBannerImageFocus: "left",
    heroBannerImage: "  /media/hero.webp  ",
  });
  ok(hero.heroBannerTextAlign === "center", "hero text-align applied");
  ok(hero.heroBannerVerticalAlign === "top", "hero vertical-align applied");
  ok(hero.heroBannerImageFocus === "left", "hero image-focus applied");
  ok(hero.heroBannerImage === "/media/hero.webp", "hero image trimmed + applied");
  const badHero = normalizeSpecialsPresentation({
    heroBannerTextAlign: "nope",
    heroBannerVerticalAlign: "nope",
    heroBannerImageFocus: "nope",
  });
  ok(badHero.heroBannerTextAlign === "left", "bad hero text-align -> default left");
  ok(badHero.heroBannerVerticalAlign === "center", "bad hero vertical-align -> default center");
  ok(badHero.heroBannerImageFocus === "right", "bad hero image-focus -> default right");
  ok(badHero.heroBannerImage === "", "bad hero image -> default blank");
  const heroRound = parseSpecialsPresentation(serializeSpecialsPresentation(hero))!;
  ok(heroRound.heroBannerTextAlign === "center", "round-trip keeps hero text-align");
  ok(heroRound.heroBannerVerticalAlign === "top", "round-trip keeps hero vertical-align");
  ok(heroRound.heroBannerImageFocus === "left", "round-trip keeps hero image-focus");
  ok(heroRound.heroBannerImage === "/media/hero.webp", "round-trip keeps hero image");

  return { passed };
}
