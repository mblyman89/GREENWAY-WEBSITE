/**
 * SLICE F (SHOP-6) — the on-card DOH pill.
 *
 * Michael: "Let's lock in the blue pill that says DOH" and put it "with the
 * other pills". These pins lock the HONEST, GRACEFUL behavior the card relies
 * on:
 *   - non-compliant items yield null → the card renders NO pill (so an empty
 *     medical registry shows nothing, exactly like today),
 *   - a DOH-compliant item (via dohCompliant OR a dohCategory) yields a spec
 *     labelled "DOH" in the active BLUE tone,
 *   - the pill is independent of the cannabinoid block (a non-cannabis DOH item
 *     still shows the pill),
 *   - the colour is a one-line change: three named tones exist and the active
 *     one is blue.
 */
import { describe, expect, it } from "vitest";

import type { GreenwayMenuItem } from "@/lib/leafly/types";
import {
  DOH_PILL_LABEL,
  DOH_PILL_TONE,
  DOH_PILL_TONE_BLUE,
  DOH_PILL_TONE_GREEN,
  DOH_PILL_TONE_PURPLE,
  dohPillForItem,
  shouldShowDohPill,
} from "@/lib/menu/menu-doh-badge-core";

function item(over: Partial<GreenwayMenuItem> & { id: string }): GreenwayMenuItem {
  return {
    name: "Test Item",
    brand: "Test Brand",
    category: "flower",
    priceMinorUnits: 3000,
    ...over,
  } as GreenwayMenuItem;
}

describe("menu-doh-badge-core", () => {
  it("shows nothing for a non-compliant item (empty registry / pre-migration)", () => {
    expect(dohPillForItem(item({ id: "a" }))).toBeNull();
    expect(dohPillForItem(item({ id: "b", dohCompliant: false }))).toBeNull();
    expect(dohPillForItem(item({ id: "c", dohCategory: null }))).toBeNull();
    expect(shouldShowDohPill(item({ id: "d" }))).toBe(false);
  });

  it("shows a blue DOH pill for a dohCompliant item", () => {
    const spec = dohPillForItem(item({ id: "e", dohCompliant: true }));
    expect(spec).not.toBeNull();
    expect(spec!.label).toBe("DOH");
    expect(spec!.label).toBe(DOH_PILL_LABEL);
    expect(spec!.tone.id).toBe("blue");
    expect(spec!.tone).toBe(DOH_PILL_TONE);
    expect(shouldShowDohPill(item({ id: "e2", dohCompliant: true }))).toBe(true);
  });

  it("lights the pill from a DOH category alone", () => {
    const spec = dohPillForItem(item({ id: "f", dohCategory: "high_cbd" }));
    expect(spec).not.toBeNull();
    expect(spec!.label).toBe("DOH");
  });

  it("shows the pill even for a non-cannabis DOH item", () => {
    const spec = dohPillForItem(item({ id: "g", category: "paraphernalia", dohCompliant: true }));
    expect(spec).not.toBeNull();
  });

  it("exposes three named tones so the colour is a one-line change", () => {
    expect(DOH_PILL_TONE_BLUE.id).toBe("blue");
    expect(DOH_PILL_TONE_PURPLE.id).toBe("purple");
    expect(DOH_PILL_TONE_GREEN.id).toBe("green");
    // Active tone is blue (Michael's pick) and carries all three class fragments.
    expect(DOH_PILL_TONE.id).toBe("blue");
    expect(DOH_PILL_TONE.border.length).toBeGreaterThan(0);
    expect(DOH_PILL_TONE.text.length).toBeGreaterThan(0);
    expect(DOH_PILL_TONE.dot.length).toBeGreaterThan(0);
  });
});
