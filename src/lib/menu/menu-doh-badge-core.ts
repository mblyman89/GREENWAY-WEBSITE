/**
 * SLICE F (SHOP-6, the final Shop slice) — the on-card DOH pill.
 *
 * Owner (Michael) decision, verbatim: "Let's lock in the blue pill that says
 * DOH." It should live "with the other pills, the 1:1 pill or cbd:cbg pill" for
 * consistency, i.e. in the SAME lane as the profile pill on the product card.
 *
 * This PURE core is the single source of truth for:
 *   - WHETHER a card shows the DOH pill (reuses SLICE D's isItemDohCompliant so
 *     the pill, the sidebar filter, and the register can never disagree), and
 *   - the pill's LABEL and its COLOR TOKENS.
 *
 * Colour is a ONE-LINE change (Michael: "we can always change the color pretty
 * easily right?") — swap DOH_PILL_TONE below and every surface follows, because
 * every card renders through ProductCardVisual. The tone is expressed as Tailwind
 * class strings (border / text / dot) so it matches the existing profile pill's
 * shape (rounded-full, backdrop-blur) while reading BLUE instead of green.
 *
 * PURE: no server-only / DB / React imports. Registered in the pure-selftest
 * runner. Ships WORKING pre-migration: a non-compliant item yields null → no
 * pill, exactly like today.
 */
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { isItemDohCompliant } from "@/lib/menu/menu-doh-core";

/** The word on the pill. Kept as a constant so wording is a one-line change. */
export const DOH_PILL_LABEL = "DOH";

/**
 * A pill colour tone expressed as Tailwind class fragments. `border` + `text`
 * dress the pill body; `dot` colours the little leading dot (mirroring the
 * profile pill's green dot). Swapping the active tone recolours every surface.
 */
export type DohPillTone = {
  readonly id: string;
  readonly border: string;
  readonly text: string;
  readonly dot: string;
};

/** BLUE tone (Michael's pick). Deliberately distinct from the green deal badge
 *  and the green-dot profile pill so the DOH pill never gets confused with a
 *  sale. To recolour later, add a tone below and point DOH_PILL_TONE at it. */
export const DOH_PILL_TONE_BLUE: DohPillTone = {
  id: "blue",
  border: "border-[#4a95e0]/70",
  text: "text-[#bcd8ff]",
  dot: "bg-[#4a95e0]",
};

/** Optional alternates so a future colour change is genuinely one line. */
export const DOH_PILL_TONE_PURPLE: DohPillTone = {
  id: "purple",
  border: "border-[#a768e6]/70",
  text: "text-[#ecd8ff]",
  dot: "bg-[#a768e6]",
};

export const DOH_PILL_TONE_GREEN: DohPillTone = {
  id: "green",
  border: "border-[var(--greenway)]/70",
  text: "text-[var(--greenway)]",
  dot: "bg-[var(--greenway)]",
};

/** THE ACTIVE TONE. Change this single assignment to recolour the DOH pill. */
export const DOH_PILL_TONE: DohPillTone = DOH_PILL_TONE_BLUE;

/** What ProductCardVisual needs to render the pill: label + the active tone. */
export type DohPillSpec = {
  readonly label: string;
  readonly tone: DohPillTone;
};

/**
 * Returns the DOH pill spec for an item, or null when the item is NOT
 * DOH-compliant (→ render nothing). Independent of the cannabinoid/profile
 * block so a DOH item ALWAYS shows its pill — even a non-cannabis DOH item, or
 * a DOH item whose profile pill is suppressed (a lone-THC product) or absent.
 */
export function dohPillForItem(
  item: Pick<GreenwayMenuItem, "dohCompliant" | "dohCategory">,
): DohPillSpec | null {
  if (!isItemDohCompliant(item)) return null;
  return { label: DOH_PILL_LABEL, tone: DOH_PILL_TONE };
}

/** Convenience predicate (mirrors dohPillForItem !== null) for callers/tests. */
export function shouldShowDohPill(
  item: Pick<GreenwayMenuItem, "dohCompliant" | "dohCategory">,
): boolean {
  return dohPillForItem(item) !== null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure self-tests (throw on failure). Registered in the pure-selftest runner.
// ─────────────────────────────────────────────────────────────────────────────

function testItem(over: Partial<GreenwayMenuItem> & { id: string }): GreenwayMenuItem {
  return {
    name: "Test Item",
    brand: "Test Brand",
    category: "flower",
    priceMinorUnits: 3000,
    ...over,
  } as GreenwayMenuItem;
}

export function __runMenuDohBadgeCoreTests(): { passed: number } {
  let passed = 0;
  const check = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`menu-doh-badge-core: ${msg}`);
    passed += 1;
  };

  // 1) Non-compliant → no pill (ships working pre-migration; empty registry).
  check(dohPillForItem(testItem({ id: "a" })) === null, "no flags → null");
  check(
    dohPillForItem(testItem({ id: "b", dohCompliant: false })) === null,
    "dohCompliant false → null",
  );
  check(shouldShowDohPill(testItem({ id: "b2", dohCompliant: false })) === false, "predicate false");

  // 2) dohCompliant true → BLUE pill labelled DOH.
  {
    const spec = dohPillForItem(testItem({ id: "c", dohCompliant: true }));
    check(spec !== null, "dohCompliant true → spec");
    check(spec!.label === "DOH", "label is DOH");
    check(spec!.tone.id === "blue", "active tone is blue (Michael's pick)");
    check(shouldShowDohPill(testItem({ id: "c2", dohCompliant: true })) === true, "predicate true");
  }

  // 3) A DOH CATEGORY alone also lights the pill (matches isItemDohCompliant).
  {
    const spec = dohPillForItem(testItem({ id: "d", dohCategory: "high_thc" }));
    check(spec !== null, "dohCategory high_thc → spec");
    check(spec!.label === "DOH", "category-only pill still labelled DOH");
  }
  check(
    dohPillForItem(testItem({ id: "e", dohCategory: null })) === null,
    "dohCategory null → null",
  );

  // 4) Non-cannabis DOH item still shows the pill (independent of cannabinoids).
  {
    const spec = dohPillForItem(
      testItem({ id: "f", category: "paraphernalia", dohCompliant: true }),
    );
    check(spec !== null, "non-cannabis DOH item still shows the pill");
  }

  // 5) The active tone is a proper blue tone with all three class fragments,
  //    and the alternates exist so a recolour is one line.
  check(DOH_PILL_TONE.border.length > 0 && DOH_PILL_TONE.text.length > 0 && DOH_PILL_TONE.dot.length > 0,
    "active tone has border/text/dot fragments");
  check(DOH_PILL_TONE_BLUE.id === "blue" && DOH_PILL_TONE_PURPLE.id === "purple" && DOH_PILL_TONE_GREEN.id === "green",
    "three named tones exist for easy recolour");

  return { passed };
}
