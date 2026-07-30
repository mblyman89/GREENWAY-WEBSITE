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
};

export type SpecialsPresentation = {
  /** Show the "Weekly Cannabis Deals" explainer grid (the 7 cards). */
  showWeeklyGrid: boolean;
  /** Show the "Today's Deals" live product grid (SpecialsDailyDeals). */
  showTodaysDeals: boolean;
  /** Offer-chip visual style on the weekly cards. */
  badgeStyle: BadgeStyle;
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
    };
  });

  return { showWeeklyGrid, showTodaysDeals, badgeStyle, days };
}

/** Serialize to the stored JSON string (stable key order for clean diffs). */
export function serializeSpecialsPresentation(p: SpecialsPresentation): string {
  const norm = normalizeSpecialsPresentation(p);
  return JSON.stringify({
    showWeeklyGrid: norm.showWeeklyGrid,
    showTodaysDeals: norm.showTodaysDeals,
    badgeStyle: norm.badgeStyle,
    days: norm.days.map((d) => {
      const out: Record<string, unknown> = {
        weekday: d.weekday,
        visible: d.visible,
        order: d.order,
      };
      if (d.titleOverride) out.titleOverride = d.titleOverride;
      if (d.offerOverride) out.offerOverride = d.offerOverride;
      if (d.descriptionOverride) out.descriptionOverride = d.descriptionOverride;
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
      { weekday: "Tuesday", visible: true, order: 2, titleOverride: "Two-fer Tuesday", offerOverride: "  ", descriptionOverride: "Buy more save more" },
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

  return { passed };
}
