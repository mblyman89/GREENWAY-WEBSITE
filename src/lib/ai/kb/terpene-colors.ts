/**
 * terpene-colors.ts — the terpene COLOR WHEEL, as verified static reference.
 *
 * Colors are a fixed, universally-recognized visual convention (the "terpene
 * wheel"): each terpene is shown in the color of its DOMINANT aroma family, so a
 * profile reads at a glance. This is reference data the owner does NOT edit, so
 * it lives in code (no DB column) keyed by the terpene slug.
 *
 * Grounded in the aroma → color convention documented on the industry terpene
 * wheel and the CannaCon terpene chart (aroma descriptions verified against
 * https://cannacon.org/cannabis-terpenes-explained and the SEED_TERPENES aroma
 * notes already in seed.ts):
 *
 *   citrus / lemon / orange ....... yellow  → orange   (limonene, valencene)
 *   pine / forest / evergreen ..... green                (pinene, camphene, carene)
 *   pepper / spice / clove ........ red / burgundy       (caryophyllene, sabinene)
 *   floral / lavender / rose ...... purple / violet      (linalool, geraniol, terpineol, nerolidol, bisabolol)
 *   earthy / musk / hops .......... amber / brown        (myrcene, humulene, fenchol, guaiol)
 *   mint / cooling / menthol ...... teal / mint          (eucalyptol, borneol, pulegone, phellandrene)
 *   sweet / herbal (light) ........ light green          (ocimene, terpinolene)
 *
 * Standing rules: grounded in verified reference (aroma family per seed.ts +
 * the terpene wheel), never guessing; non-medical (color reflects AROMA, not any
 * effect/health claim). Pure module, no I/O.
 */

export type TerpeneColor = {
  /** Solid accent color (for the swatch / bar). */
  color: string;
  /** Soft translucent background (for the card tint). */
  soft: string;
  /** The aroma family this color represents (for the caption). */
  family: string;
};

// Keyed by terpene slug (matches SEED_TERPENES slugs in seed.ts). Every value is
// a hex accent + a low-alpha tint of the same hue so cards look cohesive.
const TERPENE_COLORS: Record<string, TerpeneColor> = {
  // Citrus family — yellow → orange
  limonene: { color: "#f2c200", soft: "rgba(242,194,0,0.14)", family: "Citrus" },
  valencene: { color: "#f59e0b", soft: "rgba(245,158,11,0.14)", family: "Citrus" },

  // Pine / evergreen family — green
  pinene: { color: "#2f9e44", soft: "rgba(47,158,68,0.14)", family: "Pine" },
  camphene: { color: "#37915a", soft: "rgba(55,145,90,0.14)", family: "Pine" },
  carene: { color: "#40a86b", soft: "rgba(64,168,107,0.14)", family: "Pine" },

  // Pepper / spice family — red / burgundy
  caryophyllene: { color: "#c92a2a", soft: "rgba(201,42,42,0.13)", family: "Pepper / spice" },
  sabinene: { color: "#b23b3b", soft: "rgba(178,59,59,0.13)", family: "Pepper / spice" },

  // Floral family — purple / violet
  linalool: { color: "#7048e8", soft: "rgba(112,72,232,0.14)", family: "Floral" },
  geraniol: { color: "#c2255c", soft: "rgba(194,37,92,0.13)", family: "Floral / rose" },
  terpineol: { color: "#845ef7", soft: "rgba(132,94,247,0.13)", family: "Floral" },
  nerolidol: { color: "#9c6ade", soft: "rgba(156,106,222,0.13)", family: "Floral / woody" },
  bisabolol: { color: "#b197fc", soft: "rgba(177,151,252,0.16)", family: "Floral / chamomile" },

  // Earthy / musk / hops family — amber / brown
  myrcene: { color: "#a1691e", soft: "rgba(161,105,30,0.14)", family: "Earthy / musk" },
  humulene: { color: "#8c6d3f", soft: "rgba(140,109,63,0.14)", family: "Earthy / hops" },
  fenchol: { color: "#96712e", soft: "rgba(150,113,46,0.14)", family: "Earthy / camphor" },
  guaiol: { color: "#7a8450", soft: "rgba(122,132,80,0.14)", family: "Woody / pine" },

  // Mint / cooling family — teal / mint
  eucalyptol: { color: "#0ca678", soft: "rgba(12,166,120,0.14)", family: "Mint / cooling" },
  borneol: { color: "#12b3a6", soft: "rgba(18,179,166,0.14)", family: "Mint / camphor" },
  pulegone: { color: "#20c4b0", soft: "rgba(32,196,176,0.14)", family: "Mint" },
  phellandrene: { color: "#2bb3c0", soft: "rgba(43,179,192,0.14)", family: "Mint / citrus" },

  // Sweet / herbal (light) family — light green
  ocimene: { color: "#82c91e", soft: "rgba(130,201,30,0.14)", family: "Sweet / herbal" },
  terpinolene: { color: "#94d82d", soft: "rgba(148,216,45,0.14)", family: "Fresh / herbal" },
};

// Neutral fallback for any terpene not in the map (never crashes on new data).
const FALLBACK: TerpeneColor = {
  color: "#868e96",
  soft: "rgba(134,142,150,0.12)",
  family: "Aromatic",
};

/** Resolve the wheel color for a terpene slug (or its lowercased name). */
export function terpeneColor(slugOrName: string | null | undefined): TerpeneColor {
  const key = (slugOrName ?? "").toLowerCase().replace(/\s+/g, "-").trim();
  return TERPENE_COLORS[key] ?? FALLBACK;
}
