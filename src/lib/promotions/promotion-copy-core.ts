/**
 * src/lib/promotions/promotion-copy-core.ts  (D135, owner 2026-11-02)
 *
 * WARN-AND-SUGGEST checker for promotion wording. The owner asked: "I also
 * want to be warned if the text we use is misleading or unlawful or
 * inappropriate, etc. not block, just warn and suggest."
 *
 * It NEVER blocks. Every finding carries why it matters and a suggested
 * rewrite. Two families:
 *
 *  1. LEGAL / APPROPRIATE wording (Washington cannabis advertising rules):
 *     - WAC 314-55-155(1)(a): advertising may not be false or misleading,
 *       may not encourage over-consumption, may not make curative or
 *       therapeutic claims, and may not appeal to people under 21.
 *     - RCW 69.50.357: cannabis may not be given away ("free"); the engine
 *       also never prices below acquisition cost.
 *     - WAC 314-55-018: no vendor-funded deals (a supplier may not pay for
 *       or "sponsor" a retailer's promotion).
 *     - WAC 314-55-095 / RCW 69.50.360: purchase limits exist, so "no limit"
 *       or "unlimited" is untrue.
 *     The word lists line up with src/lib/ai/compliance-patterns.json (the
 *     site-wide copy scan), narrowed and phrased for deal copy.
 *
 *  2. MISLEADING-vs-MECHANICS checks (the 11/2 investigation found copy and
 *     config disagreeing: Thursday named PERMA but targeted other brands;
 *     Wednesday said "20% off" while the config ran 15/20/30 at $50+):
 *     - a percent in the text the deal never gives,
 *     - "N for M" / BOGO wording the mechanics don't deliver,
 *     - a dollar threshold that isn't a spend tier,
 *     - a weekday name that isn't the deal's day,
 *     - a product type in the text that the deal doesn't cover,
 *     - "storewide / everything" on a deal that isn't storewide,
 *     - a menu brand named in the text that the deal doesn't target.
 *
 * Pure (no React, no DB, no server-only) so the same checks run live in the
 * form (client island) and on the server (promotion page + list).
 */

export type CopyField = "title" | "description" | "bonus_note";

export type CopyFinding = {
  /** "legal" = wording that can break an advertising rule; "accuracy" = may mislead. */
  kind: "legal" | "accuracy";
  field: CopyField | "all";
  label: string;
  found: string;
  why: string;
  suggest: string;
  cite?: string;
};

export type CopyCheckInput = {
  title: string;
  description?: string | null;
  bonusNote?: string | null;
  discountType?: string;
  discountPercent?: number;
  config?: {
    qtyTiers?: { at: number; percent: number }[];
    weightTiers?: { at: number; percent: number }[];
    spendTiers?: { at: number; percent: number }[];
    bogo?: { buyQty: number; getQty: number; getPercent: number };
    basketNforM?: { n: number; m: number };
    basketTopItem?: { topPercent: number; restPercent: number };
    eitherOr?: { flatPercent: number; bundle: { n: number; m: number } };
  } | null;
  /** 0=Sun..6=Sat, null for a dated promo. */
  weekday?: number | null;
  /** Undefined = targets unknown (list view) — target checks are skipped. */
  storewide?: boolean;
  targetCategories?: string[];
  targetBrands?: string[];
  /** Live menu brands, for "named in text but not targeted". */
  knownBrands?: string[];
};

// ---------------------------------------------------------------------------
// 1. Wording rules
// ---------------------------------------------------------------------------

type WordRule = {
  re: RegExp;
  kind: CopyFinding["kind"];
  label: string;
  why: string;
  suggest: string;
  cite?: string;
};

const WAC_155 = "WAC 314-55-155(1)(a)";

const WORD_RULES: WordRule[] = [
  {
    re: /\b(free|freebies?|on the house|complimentary|giveaways?|give[- ]?aways?|giving away|no charge)\b/i,
    kind: "legal",
    label: "\"Free\" or giveaway wording",
    why: "Cannabis can never be given away or advertised as free, and the register never prices it at $0.",
    suggest: "Say the real discount instead, e.g. \"Buy one, get one 50% off\" or \"3 for the price of 2\".",
    cite: "RCW 69.50.357",
  },
  {
    re: /\b(candy|candies|gummy bears?|kid|kids|kiddos?|children|childhood|cartoons?|toys?|mascots?|back[- ]to[- ]school|trick[- ]or[- ]treat|teens?|students?|lollipops?)\b/i,
    kind: "legal",
    label: "Could appeal to people under 21",
    why: "Deal copy may not use words, themes or images that appeal to children.",
    suggest: "Describe the product plainly, e.g. \"edibles\", \"chews\" or \"fruit-flavored edibles\". Avoid candy, kid, cartoon and school themes.",
    cite: WAC_155,
  },
  {
    re: /\b(cures?|cured|heals?|healing|treats? (?:your|pain|anxiety|insomnia)|remed(?:y|ies)|therapeutic|therapy|medicinal|medicine|relief|relieves?|pain|anxiety|insomnia|depression|nausea|inflammation|ptsd|arthritis|sleep aid|wellness benefits?)\b/i,
    kind: "legal",
    label: "Health or medical claim",
    why: "Deal copy may not claim cannabis treats, cures, relieves or prevents anything.",
    suggest: "Talk about the deal, product type, flavor or strain instead of effects on health.",
    cite: WAC_155,
  },
  {
    re: /\b(safe|safer|healthy|healthier|harmless|non-?addictive|no side effects|good for you)\b/i,
    kind: "legal",
    label: "Safety or health-benefit claim",
    why: "Calling cannabis safe or healthy is a health claim and can mislead.",
    suggest: "Remove the safety wording. If you mean lab testing, say \"lab tested\".",
    cite: WAC_155,
  },
  {
    re: /\b(get (?:really )?(?:high|blazed|wasted|stoned|baked|lit)|as much as you can|binge|over-?consume|stock up and smoke|megadose|double (?:the )?dose|max(?:imum)? high|blast off)\b/i,
    kind: "legal",
    label: "Encourages over-consumption",
    why: "Deal copy may not encourage using more cannabis or getting more intoxicated.",
    suggest: "Focus on value and choice, e.g. \"save on your favorite flower\".",
    cite: WAC_155,
  },
  {
    re: /\b(\d+\s*mg (?:per|a) (?:day|dose)|dosage|dosing|take \d+|start with \d+)\b/i,
    kind: "legal",
    label: "Dosing advice",
    why: "Promotions should not tell customers how much to take.",
    suggest: "Remove the dosing line. Staff can give product information in store.",
    cite: WAC_155,
  },
  {
    re: /\b(beer|wine|booze|alcohol|cocktails?|shots|liquor|vodka|whiskey|tequila|tobacco|cigarettes?|nicotine|happy hour)\b/i,
    kind: "legal",
    label: "Alcohol or tobacco association",
    why: "Linking cannabis deals with drinking or tobacco can read as encouraging combined use.",
    suggest: "Drop the alcohol/tobacco reference. For a time-of-day deal, say \"afternoon deal\" instead of \"happy hour\".",
    cite: WAC_155,
  },
  {
    re: /\b(guarantee[sd]?|miracle|clinically (?:proven|tested)|doctor[- ]recommended|physician[- ]recommended|fda[- ]approved|scientifically proven|proven to)\b/i,
    kind: "legal",
    label: "Unsupported claim",
    why: "Guarantees and authority claims (doctor, FDA, clinically proven) are misleading for cannabis.",
    suggest: "Remove the claim, or state a checkable fact (e.g. \"lab tested\").",
    cite: WAC_155,
  },
  {
    re: /\b(sponsored by|brought to you by|courtesy of|paid for by|presented by|in partnership with)\b/i,
    kind: "legal",
    label: "Sounds vendor-funded",
    why: "A supplier may not fund or sponsor a retailer's promotion. Wording like \"sponsored by\" suggests it is.",
    suggest: "Say \"Featuring [brand]\" or \"25% off [brand]\". Greenway sets and pays for the discount.",
    cite: "WAC 314-55-018",
  },
  {
    re: /\b(no limits?|unlimited|limitless|as many as you want)\b/i,
    kind: "legal",
    label: "\"No limit\" is untrue",
    why: "State purchase limits always apply, so \"unlimited\" misleads.",
    suggest: "Say \"mix and match\" or \"while supplies last\". Purchase limits apply.",
    cite: "WAC 314-55-095",
  },
  {
    re: /\b(lowest prices?|cheapest|best prices? in (?:town|the state|washington)|beat any price|price match|unbeatable|best weed|#1|number one)\b/i,
    kind: "accuracy",
    label: "Comparison or superlative claim",
    why: "\"Lowest/cheapest/best/#1\" is a factual claim. If it can't be proven it is misleading.",
    suggest: "Use a checkable statement, e.g. \"25% off all edibles today\".",
    cite: WAC_155,
  },
];

// ---------------------------------------------------------------------------
// 2. Mechanics helpers
// ---------------------------------------------------------------------------

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Product words in copy → the categories that would honor them. */
const PRODUCT_WORDS: { re: RegExp; label: string; cats: string[] }[] = [
  { re: /\bedibles?\b/i, label: "edibles", cats: ["edible-solid", "edible-liquid"] },
  { re: /\b(drinks?|beverages?|sodas?|seltzers?)\b/i, label: "drinks", cats: ["edible-liquid"] },
  { re: /\b(pre-?rolls?|joints?|doobies?)\b/i, label: "prerolls", cats: ["preroll", "preroll-pack", "infused-preroll", "infused-preroll-pack"] },
  { re: /\bblunts?\b/i, label: "blunts", cats: ["blunt", "infused-blunt"] },
  { re: /\b(vapes?|carts?|cartridges?|disposables?)\b/i, label: "vapes", cats: ["cartridge", "disposable-cartridge"] },
  { re: /\b(concentrates?|wax|dabs?|rosin|resin|shatter|badder|hash)\b/i, label: "concentrates", cats: ["concentrate"] },
  { re: /\btinctures?\b/i, label: "tinctures", cats: ["tincture"] },
  { re: /\brso\b/i, label: "RSO", cats: ["rso"] },
  { re: /\btopicals?\b/i, label: "topicals", cats: ["topical"] },
  { re: /\b(flower|bud|ounces?|oz|eighths?|quarters?)\b/i, label: "flower", cats: ["flower", "popcorn-bud", "infused-flower", "trim"] },
];

/** Every percent the deal can actually give. */
export function percentsTheDealGives(i: CopyCheckInput): Set<number> {
  const out = new Set<number>();
  const c = i.config ?? {};
  const add = (n: unknown) => {
    const v = Math.round(Number(n));
    if (Number.isFinite(v) && v > 0) out.add(v);
  };
  if ((i.discountType === "percent" || i.discountType === "fixed") && !c.eitherOr) add(i.discountPercent);
  for (const t of c.qtyTiers ?? []) add(t.percent);
  for (const t of c.weightTiers ?? []) add(t.percent);
  for (const t of c.spendTiers ?? []) add(t.percent);
  if (c.bogo) add(c.bogo.getPercent);
  if (c.basketTopItem) {
    add(c.basketTopItem.topPercent);
    add(c.basketTopItem.restPercent);
  }
  if (c.eitherOr) {
    add(c.eitherOr.flatPercent);
    const { n, m } = c.eitherOr.bundle;
    if (n > 0) add(((n - m) / n) * 100);
  }
  if (c.basketNforM && c.basketNforM.n > 0) add(((c.basketNforM.n - c.basketNforM.m) / c.basketNforM.n) * 100);
  // Engine defaults when a tier deal has no tiers (what the register would run).
  if (i.discountType === "weight_tier" && !(c.weightTiers ?? []).length) [15, 20, 30].forEach(add);
  if (i.discountType === "threshold_spend" && !(c.spendTiers ?? []).length) [15, 20, 30].forEach(add);
  if (i.discountType === "multi_item_tier" && !(c.qtyTiers ?? []).length && !c.eitherOr) [15, 25].forEach(add);
  if (i.discountType === "basket" && !c.basketTopItem && !c.basketNforM) add((1 / 3) * 100);
  return out;
}

function fieldTexts(i: CopyCheckInput): { field: CopyField; text: string }[] {
  return (
    [
      { field: "title" as const, text: i.title ?? "" },
      { field: "description" as const, text: i.description ?? "" },
      { field: "bonus_note" as const, text: i.bonusNote ?? "" },
    ]
  ).filter((f) => f.text.trim().length > 0);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "4 for 3", "4 for the price of 3", "buy 4 pay for 3", "buy 3 get 1". */
function bundlesInText(text: string): { n: number; m: number; raw: string }[] {
  const out: { n: number; m: number; raw: string }[] = [];
  const reFor = /\b(?:buy\s+)?(?:any\s+)?(\d{1,2})\s+(?:for|pay\s+for)\s+(?:the\s+price\s+of\s+)?(\d{1,2})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = reFor.exec(text))) {
    const n = Number(m[1]);
    const k = Number(m[2]);
    if (n > k && k >= 0) out.push({ n, m: k, raw: m[0] });
  }
  const reGet = /\bbuy\s+(\d{1,2})\s*,?\s*get\s+(\d{1,2})\b(?!\s*%)(?!\s+at\b)(?![^.]*%\s*off)/gi;
  while ((m = reGet.exec(text))) {
    const buy = Number(m[1]);
    const get = Number(m[2]);
    if (buy >= 1 && get >= 1) out.push({ n: buy + get, m: buy, raw: m[0] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The checker
// ---------------------------------------------------------------------------

export function checkPromotionCopy(i: CopyCheckInput): CopyFinding[] {
  const findings: CopyFinding[] = [];
  const texts = fieldTexts(i);
  const seen = new Set<string>();
  const push = (f: CopyFinding) => {
    const k = `${f.label}|${f.found.toLowerCase()}`;
    if (seen.has(k)) return;
    seen.add(k);
    findings.push(f);
  };

  // 1. Wording rules.
  for (const { field, text } of texts) {
    for (const r of WORD_RULES) {
      const m = text.match(r.re);
      if (m) push({ kind: r.kind, field, label: r.label, found: m[0], why: r.why, suggest: r.suggest, cite: r.cite });
    }
  }

  const all = texts.map((t) => t.text).join(" \n ");
  const c = i.config ?? {};

  // 2a. Percent in the text that the deal never gives.
  const gives = percentsTheDealGives(i);
  if (gives.size > 0) {
    const max = Math.max(...gives);
    const rePct = /(up to\s+)?(\d{1,2}(?:\.\d+)?)\s*%/gi;
    for (const { field, text } of texts) {
      let m: RegExpExecArray | null;
      while ((m = rePct.exec(text))) {
        const pct = Math.round(Number(m[2]));
        const upTo = Boolean(m[1]);
        const ok = upTo ? pct <= max : gives.has(pct);
        if (!ok) {
          push({
            kind: "accuracy",
            field,
            label: upTo ? "\"Up to\" is more than the deal gives" : "Percent doesn't match the deal",
            found: m[0].trim(),
            why: `The text says ${m[0].trim()}, but the register gives ${[...gives].sort((a, b) => a - b).map((p) => `${p}%`).join(" / ")}. What is advertised must match what is charged.`,
            suggest: `Change the text to the real number(s), or change the deal's settings to ${pct}%.`,
            cite: WAC_155,
          });
        }
      }
    }
  } else if (i.discountType && /\d{1,2}\s*%/.test(all)) {
    const m = all.match(/\d{1,2}\s*%/);
    push({
      kind: "accuracy",
      field: "all",
      label: "Text promises a discount the deal doesn't give",
      found: m ? m[0] : "%",
      why: "The deal's settings give 0% off, so the register will charge full price while the text promises a discount.",
      suggest: "Fill in the discount settings (or press \"Set up our daily deals\" for a routine day).",
      cite: WAC_155,
    });
  }

  // 2b. "N for M" / "buy X get Y" the mechanics don't deliver.
  for (const { field, text } of texts) {
    for (const b of bundlesInText(text)) {
      const eq = Math.round(((b.n - b.m) / b.n) * 100);
      const nForM = c.basketNforM && c.basketNforM.n === b.n && c.basketNforM.m === b.m;
      const eo = c.eitherOr && c.eitherOr.bundle.n === b.n && c.eitherOr.bundle.m === b.m;
      const bogoOk = c.bogo && c.bogo.buyQty + c.bogo.getQty === b.n && c.bogo.buyQty === b.m;
      const tierOk = (c.qtyTiers ?? []).some((t) => t.at <= b.n && t.percent >= eq);
      if (!nForM && !eo && !bogoOk && !tierOk) {
        push({
          kind: "accuracy",
          field,
          label: "Bundle wording doesn't match the deal",
          found: b.raw,
          why: `"${b.raw}" works out to about ${eq}% off ${b.n} items, but the deal's settings don't give that.`,
          suggest: `Set the mechanics to buy ${b.n} pay for ${b.m} (Basket deal), or a quantity tier of ${b.n}+ at ${eq}%. Otherwise remove the wording.`,
          cite: WAC_155,
        });
      }
    }
  }
  if (/\bbogo\b|buy one,? get one/i.test(all) && i.discountType && i.discountType !== "bogo" && !c.bogo) {
    push({
      kind: "accuracy",
      field: "all",
      label: "BOGO wording on a non-BOGO deal",
      found: (all.match(/\bbogo\b|buy one,? get one/i) ?? ["BOGO"])[0],
      why: "The text promises a buy-one-get-one, but the deal type is not BOGO.",
      suggest: "Pick the BOGO type and fill in buy/get/percent, or reword the deal.",
      cite: WAC_155,
    });
  }

  // 2c. Dollar thresholds that aren't spend tiers.
  if (i.discountType === "threshold_spend") {
    const tiers = (c.spendTiers ?? []).map((t) => Math.round(t.at / 100));
    const reUsd = /\$\s?(\d{1,4})(?:\.\d{2})?\s*(\+|or more|and up|or over)?/gi;
    for (const { field, text } of texts) {
      let m: RegExpExecArray | null;
      while ((m = reUsd.exec(text))) {
        const v = Number(m[1]);
        if (!tiers.includes(v)) {
          push({
            kind: "accuracy",
            field,
            label: "Dollar amount isn't a spend tier",
            found: m[0].trim(),
            why: tiers.length
              ? `The spend tiers start at ${tiers.map((t) => `$${t}`).join(" / ")}, not $${v}.`
              : "The deal has no spend tiers, so the engine falls back to 15% at $50, 20% at $100 and 30% at $150.",
            suggest: `Add a spend tier at $${v}, or change the text to match the tiers.`,
            cite: WAC_155,
          });
        }
      }
    }
  }

  // 2d. Weekday named that isn't the deal's day.
  if (typeof i.weekday === "number" && i.weekday >= 0 && i.weekday <= 6) {
    for (const { field, text } of texts) {
      DAY_NAMES.forEach((d, idx) => {
        if (idx === i.weekday) return;
        const m = text.match(new RegExp(`\\b${d}s?\\b`, "i"));
        if (m) {
          push({
            kind: "accuracy",
            field,
            label: "Mentions a different day",
            found: m[0],
            why: `This deal runs on ${DAY_NAMES[i.weekday as number]}s, but the text says ${m[0]}.`,
            suggest: "Fix the day in the text, or change the deal's weekday.",
          });
        }
      });
    }
  }

  // 2e/2f/2g. Targeting checks (only when targets are known).
  if (i.storewide !== undefined) {
    if (!i.storewide) {
      const cats = new Set((i.targetCategories ?? []).map((x) => x.toLowerCase()));
      const hasCatTargets = cats.size > 0;
      for (const { field, text } of texts) {
        if (hasCatTargets) {
          for (const w of PRODUCT_WORDS) {
            const m = text.match(w.re);
            if (m && !w.cats.some((x) => cats.has(x))) {
              push({
                kind: "accuracy",
                field,
                label: "Product type isn't in the deal",
                found: m[0],
                why: `The text mentions ${w.label}, but none of those categories (${w.cats.join(", ")}) are selected under "What it applies to".`,
                suggest: `Tick ${w.cats[0]} under "What it applies to", or take "${m[0]}" out of the text.`,
              });
            }
          }
        }
        const sw = text.match(/\b(storewide|store-wide|everything|entire store|whole store|all products)\b/i);
        if (sw) {
          push({
            kind: "accuracy",
            field,
            label: "Says storewide, but it isn't",
            found: sw[0],
            why: "The text promises everything, but the deal only covers what's selected under \"What it applies to\".",
            suggest: "Tick \"Storewide\", or name the categories the deal really covers.",
          });
        }
      }
    }
    const targeted = new Set((i.targetBrands ?? []).map((b) => b.toLowerCase().trim()));
    if (!i.storewide && (i.knownBrands ?? []).length > 0) {
      for (const b of i.knownBrands ?? []) {
        const name = b.trim();
        if (name.length < 4 || targeted.has(name.toLowerCase())) continue;
        const m = all.match(new RegExp(`(^|[^a-z0-9])(${escapeRe(name)})([^a-z0-9]|$)`, "i"));
        if (m) {
          push({
            kind: "accuracy",
            field: "all",
            label: "Brand named but not in the deal",
            found: m[2],
            why: `The text names ${name}, but ${name} isn't ticked under Brands. Its products won't get the discount.`,
            suggest: `Tick ${name} under Brands. If the menu lists it under a different brand name, tick that name too.`,
          });
        }
      }
    }
  }

  return findings;
}

export function summarizeCopyFindings(f: CopyFinding[]): string {
  if (f.length === 0) return "No wording problems found.";
  const legal = f.filter((x) => x.kind === "legal").length;
  const acc = f.length - legal;
  const parts: string[] = [];
  if (legal) parts.push(`${legal} wording rule${legal === 1 ? "" : "s"}`);
  if (acc) parts.push(`${acc} accuracy check${acc === 1 ? "" : "s"}`);
  return `Heads up: ${parts.join(" and ")} to review. Nothing is blocked.`;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runPromotionCopyTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`promotion-copy FAIL: ${name}`);
    }
  };
  const labels = (f: CopyFinding[]) => f.map((x) => x.label);
  const has = (f: CopyFinding[], l: string) => labels(f).includes(l);

  // Clean standard deals produce no findings.
  const monday = checkPromotionCopy({
    title: "Munchie Monday",
    description: "25% off edibles, RSO, drinks, and tinctures all day Monday.",
    discountType: "percent",
    discountPercent: 25,
    weekday: 1,
    storewide: false,
    targetCategories: ["edible-solid", "edible-liquid", "rso", "tincture"],
  });
  ok("monday clean", monday.length === 0);

  const tuesday = checkPromotionCopy({
    title: "Doobie Tuesday",
    description: "20% off prerolls, blunts, and packs — or buy 4 for the price of 3, mix and match.",
    bonusNote: "20% off · or 4 for 3 (25%)",
    discountType: "multi_item_tier",
    config: { qtyTiers: [{ at: 1, percent: 20 }, { at: 4, percent: 25 }] },
    weekday: 2,
    storewide: false,
    targetCategories: ["preroll", "blunt", "preroll-pack", "infused-preroll", "infused-blunt", "infused-preroll-pack"],
  });
  ok("tuesday clean (4 for 3 = 25% tier)", tuesday.length === 0);

  const wed = { title: "Wax Wednesday", description: "20% off concentrates and vapes — or 30% off when you spend $150 or more.", discountType: "threshold_spend", weekday: 3, storewide: false, targetCategories: ["cartridge", "disposable-cartridge", "concentrate", "rso"] };
  ok("wednesday clean with tiers", checkPromotionCopy({ ...wed, config: { spendTiers: [{ at: 0, percent: 20 }, { at: 15000, percent: 30 }] } }).length === 0);
  const wedEmpty = checkPromotionCopy({ ...wed, config: {} });
  ok("wednesday empty tiers: $150 flagged (engine falls back to $50/$100/$150)", has(wedEmpty, "Dollar amount isn't a spend tier") && wedEmpty.some((x) => x.why.includes("falls back")));
  ok("wednesday empty tiers: fallback 15/20/30 so 20 and 30 pass", !has(wedEmpty, "Percent doesn't match the deal"));

  const sat = checkPromotionCopy({ title: "Super Saturday", description: "30% off one item + 15% off everything else storewide.", discountType: "basket", config: { basketTopItem: { topPercent: 30, restPercent: 15 } }, weekday: 6, storewide: true });
  ok("saturday clean", sat.length === 0);
  const satBroken = checkPromotionCopy({ title: "Super Saturday", description: "30% off one item + 15% off everything else storewide.", discountType: "percent", discountPercent: 0, config: {}, weekday: 6, storewide: true });
  ok("saturday 0% flagged", has(satBroken, "Text promises a discount the deal doesn't give"));

  const sun = checkPromotionCopy({ title: "Ice Cream Sunday", description: "Buy any 3, pay the equivalent of 2.", bonusNote: "3-for-2 equivalent savings", discountType: "basket", config: { basketNforM: { n: 3, m: 2 } }, weekday: 0, storewide: true });
  ok("sunday clean", sun.length === 0);

  // Legal wording.
  ok("free flagged", has(checkPromotionCopy({ title: "Free preroll with any eighth" }), "\"Free\" or giveaway wording"));
  ok("free cites RCW", checkPromotionCopy({ title: "Free gift" })[0]?.cite === "RCW 69.50.357");
  ok("candy flagged", has(checkPromotionCopy({ title: "Candy land edibles" }), "Could appeal to people under 21"));
  ok("kids flagged", has(checkPromotionCopy({ title: "Kids eat free" }), "Could appeal to people under 21"));
  ok("pain flagged", has(checkPromotionCopy({ title: "Pain relief Tuesday" }), "Health or medical claim"));
  ok("safe flagged", has(checkPromotionCopy({ title: "Safe and healthy" }), "Safety or health-benefit claim"));
  ok("get high flagged", has(checkPromotionCopy({ title: "Get high for less" }), "Encourages over-consumption"));
  ok("beer flagged", has(checkPromotionCopy({ title: "Beer and buds" }), "Alcohol or tobacco association"));
  ok("happy hour flagged", has(checkPromotionCopy({ title: "Happy hour" }), "Alcohol or tobacco association"));
  ok("guaranteed flagged", has(checkPromotionCopy({ title: "Guaranteed lowest prices" }), "Unsupported claim"));
  ok("lowest flagged", has(checkPromotionCopy({ title: "Guaranteed lowest prices" }), "Comparison or superlative claim"));
  ok("sponsored flagged", has(checkPromotionCopy({ title: "Sponsored by Phat Panda" }), "Sounds vendor-funded"));
  ok("vendor cites 018", checkPromotionCopy({ title: "Brought to you by X" })[0]?.cite === "WAC 314-55-018");
  ok("unlimited flagged", has(checkPromotionCopy({ title: "Unlimited prerolls" }), "\"No limit\" is untrue"));
  ok("dosing flagged", has(checkPromotionCopy({ title: "Start with 5 mg" }), "Dosing advice") || has(checkPromotionCopy({ title: "Dosage tips" }), "Dosing advice"));
  ok("free-standing words not over-matched (freedom)", !has(checkPromotionCopy({ title: "Freedom Friday" }), "\"Free\" or giveaway wording"));
  ok("safely? not 'safe' word", !has(checkPromotionCopy({ title: "Safeway parking lot" }), "Safety or health-benefit claim"));
  ok("never blocks: returns array only", Array.isArray(checkPromotionCopy({ title: "" })));

  // Accuracy.
  const pct = checkPromotionCopy({ title: "30% off edibles", discountType: "percent", discountPercent: 25 });
  ok("percent mismatch", has(pct, "Percent doesn't match the deal"));
  ok("percent mismatch suggests", pct.find((x) => x.label === "Percent doesn't match the deal")!.suggest.includes("30%"));
  const upTo = checkPromotionCopy({ title: "Up to 40% off", discountType: "weight_tier", config: { weightTiers: [{ at: 7, percent: 15 }, { at: 28, percent: 30 }] } });
  ok("up to over max", has(upTo, "\"Up to\" is more than the deal gives"));
  ok("up to within max ok", checkPromotionCopy({ title: "Up to 30% by the ounce", discountType: "weight_tier", config: { weightTiers: [{ at: 7, percent: 15 }, { at: 28, percent: 30 }] } }).length === 0);
  const bundle = checkPromotionCopy({ title: "3 for 2 prerolls", discountType: "percent", discountPercent: 20 });
  ok("bundle mismatch", has(bundle, "Bundle wording doesn't match the deal"));
  ok("bogo wording on percent", has(checkPromotionCopy({ title: "BOGO edibles", discountType: "percent", discountPercent: 20 }), "BOGO wording on a non-BOGO deal"));
  ok("bogo type ok", !has(checkPromotionCopy({ title: "BOGO edibles", discountType: "bogo", config: { bogo: { buyQty: 1, getQty: 1, getPercent: 50 } } }), "BOGO wording on a non-BOGO deal"));
  const usd = checkPromotionCopy({ title: "30% off at $100+", discountType: "threshold_spend", config: { spendTiers: [{ at: 0, percent: 20 }, { at: 15000, percent: 30 }] } });
  ok("usd not a tier", has(usd, "Dollar amount isn't a spend tier"));
  const day = checkPromotionCopy({ title: "Munchie Monday", description: "All day Sunday", weekday: 1 });
  ok("other day flagged", has(day, "Mentions a different day") && day[0].found.toLowerCase() === "sunday");
  ok("own day fine", !has(checkPromotionCopy({ title: "Munchie Monday", weekday: 1 }), "Mentions a different day"));
  const cat = checkPromotionCopy({ title: "25% off edibles and vapes", discountType: "percent", discountPercent: 25, storewide: false, targetCategories: ["edible-solid"] });
  ok("vapes not targeted", has(cat, "Product type isn't in the deal") && cat.some((x) => x.found.toLowerCase() === "vapes"));
  ok("edibles targeted ok", !cat.some((x) => x.found.toLowerCase() === "edibles"));
  ok("storewide claim flagged", has(checkPromotionCopy({ title: "15% off everything", discountType: "percent", discountPercent: 15, storewide: false, targetCategories: ["flower"] }), "Says storewide, but it isn't"));
  ok("storewide true ok", !has(checkPromotionCopy({ title: "15% off everything", discountType: "percent", discountPercent: 15, storewide: true }), "Says storewide, but it isn't"));
  ok("targets unknown → skipped", !has(checkPromotionCopy({ title: "15% off everything", discountType: "percent", discountPercent: 15 }), "Says storewide, but it isn't"));
  const perma = checkPromotionCopy({ title: "Top Shelf Thursday", description: "25% off PERMA and Phat Panda", discountType: "percent", discountPercent: 25, weekday: 4, storewide: false, targetBrands: ["Phat Panda"], knownBrands: ["PERMA", "Phat Panda", "Sunny Smokes"] });
  ok("perma named but not targeted", has(perma, "Brand named but not in the deal") && perma.some((x) => x.found === "PERMA"));
  ok("targeted brand fine", !perma.some((x) => x.found === "Phat Panda"));
  ok("summary counts", summarizeCopyFindings(perma).includes("Nothing is blocked"));
  ok("summary empty", summarizeCopyFindings([]) === "No wording problems found.");
  ok("gives set eitherOr 20/25", (() => { const g = percentsTheDealGives({ title: "", discountType: "multi_item_tier", config: { eitherOr: { flatPercent: 20, bundle: { n: 4, m: 3 } } } }); return g.has(20) && g.has(25); })());

  return { passed, failed };
}
