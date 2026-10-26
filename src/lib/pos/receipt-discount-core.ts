/**
 * src/lib/pos/receipt-discount-core.ts  (Discount transparency slice)
 *
 * PURE discount breakdown + presentation rows shared by EVERY surface that
 * shows a discount: the register cart / tender screens, the printed register
 * receipt (PassPRNT HTML), the emailed register receipt, the website checkout
 * summary, the website order confirmation, and the printed online pickup
 * receipt (ESC/POS text). No I/O, no React, no server-only imports — safe for
 * the tsx self-test harness, the register bundle and the browser.
 *
 * Owner, verbatim: "show more details about the before price, the discount
 * taken, the percent per line item, total percent off the order, why and how
 * maybe ... Because we spread the discount out between all products so
 * nothing gets sold under cost ... I want it to be crystal clear what exactly
 * is going on with discounts". And: "I want these features to also be
 * settings on my receipt builder. It should be included on the online receipt
 * builder too."
 *
 * What it does
 * ------------
 * 1. `computeDiscountBreakdown` decomposes each line's TOTAL saving
 *    (regular − charged, tax-inclusive, exact cents) into the parts that
 *    produced it, in the order the register applies them:
 *        deal (promotion engine, incl. bundle spread + cost-floor clamp)
 *        → manager price adjustment → medical tax exemption
 *        → loyalty reward → special discount (employee/veteran/industry).
 *    The parts ALWAYS sum to the line total (any rounding residue lands on
 *    the deal part), so the receipt can never print numbers that do not add
 *    up — the one thing that would create the doubt the owner wants gone.
 * 2. It explains the deal: parses the engine's label ("Sunday · 3 for 2",
 *    "Happy Hour · 15% off", "Saturday · 30% one item + 15%", "· BOGO",
 *    "· $5.00 off") into a deal name + a plain-English mechanic sentence,
 *    and flags lines where the cost floor capped the advertised deal.
 * 3. It builds an order-level summary: regular total, total saved, total
 *    percent off, savings per deal / program, and "how your discounts work"
 *    notes that only mention mechanics actually present in THIS order.
 * 4. `DiscountDisplayConfig` is the owner-editable switchboard (what is shown
 *    and how). Two copies live in the receipt config: one for the register,
 *    one for online orders.
 *
 * Money is MINOR UNITS (cents) everywhere. Percentages are display-only and
 * are computed from the exact cents, never the other way round.
 */

// ---------------------------------------------------------------------------
// Owner-editable display switches
// ---------------------------------------------------------------------------

export type DiscountDisplayConfig = {
  /** Show the regular ("before") price on discounted lines. */
  showRegularPrice: boolean;
  /** Show the money saved on each discounted line. */
  showLineSavings: boolean;
  /** Show the percent off on each discounted line. */
  showLinePercent: boolean;
  /** Show the name of the deal that applied to the line. */
  showDealName: boolean;
  /** Show a one-sentence "how this deal works" under the deal name. */
  showDealMechanic: boolean;
  /** Say so when the cost floor capped the advertised deal on a line. */
  showCostFloorNote: boolean;
  /** Show loyalty / special / manager / medical reductions per line. */
  showOtherDiscounts: boolean;
  /** Print the order-level savings summary block. */
  showOrderSummary: boolean;
  /** Show the total percent off the whole order in the summary. */
  showOrderPercent: boolean;
  /** List savings per deal / program in the summary. */
  showDealBreakdown: boolean;
  /** Print the "how your discounts work" notes. */
  showExplanation: boolean;
  /** Decimal places on percentages (0, 1 or 2). */
  percentDecimals: number;
  /** Heading of the summary block. */
  summaryTitle: string;
  /** Extra owner wording appended to the explanation notes ("" = none). */
  explanationText: string;
};

export const DISCOUNT_SUMMARY_TITLE_MAX = 40;
export const DISCOUNT_EXPLANATION_MAX = 400;

export const DEFAULT_DISCOUNT_DISPLAY_CONFIG: DiscountDisplayConfig = {
  showRegularPrice: true,
  showLineSavings: true,
  showLinePercent: true,
  showDealName: true,
  showDealMechanic: true,
  showCostFloorNote: true,
  showOtherDiscounts: true,
  showOrderSummary: true,
  showOrderPercent: true,
  showDealBreakdown: true,
  showExplanation: true,
  percentDecimals: 1,
  summaryTitle: "YOUR SAVINGS",
  explanationText: "",
};

function coerceBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return fallback;
}

/** Normalize untrusted input (site_settings JSON, form, snapshot). Never throws. */
export function normalizeDiscountDisplayConfig(raw: unknown): DiscountDisplayConfig {
  const d = DEFAULT_DISCOUNT_DISPLAY_CONFIG;
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return { ...d };
  const o = raw as Record<string, unknown>;
  const decRaw = typeof o.percentDecimals === "string" ? Number(o.percentDecimals) : o.percentDecimals;
  const percentDecimals =
    typeof decRaw === "number" && Number.isFinite(decRaw)
      ? Math.max(0, Math.min(2, Math.round(decRaw)))
      : d.percentDecimals;
  const title = typeof o.summaryTitle === "string" ? o.summaryTitle.trim() : "";
  const expl = typeof o.explanationText === "string" ? o.explanationText.trim() : "";
  return {
    showRegularPrice: coerceBool(o.showRegularPrice, d.showRegularPrice),
    showLineSavings: coerceBool(o.showLineSavings, d.showLineSavings),
    showLinePercent: coerceBool(o.showLinePercent, d.showLinePercent),
    showDealName: coerceBool(o.showDealName, d.showDealName),
    showDealMechanic: coerceBool(o.showDealMechanic, d.showDealMechanic),
    showCostFloorNote: coerceBool(o.showCostFloorNote, d.showCostFloorNote),
    showOtherDiscounts: coerceBool(o.showOtherDiscounts, d.showOtherDiscounts),
    showOrderSummary: coerceBool(o.showOrderSummary, d.showOrderSummary),
    showOrderPercent: coerceBool(o.showOrderPercent, d.showOrderPercent),
    showDealBreakdown: coerceBool(o.showDealBreakdown, d.showDealBreakdown),
    showExplanation: coerceBool(o.showExplanation, d.showExplanation),
    percentDecimals,
    summaryTitle: (title || d.summaryTitle).slice(0, DISCOUNT_SUMMARY_TITLE_MAX),
    explanationText: expl.slice(0, DISCOUNT_EXPLANATION_MAX),
  };
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * One line as any surface knows it. Only the first four fields are required;
 * every other field is optional so historical snapshots and thin callers
 * (the website knows no cost floor, an old order row knows no label) simply
 * explain less instead of guessing.
 */
export type DiscountLineInput = {
  productName: string;
  quantity: number;
  /** Regular (pre-discount) tax-inclusive unit price. */
  regularUnitMinor: number;
  /** What was actually charged per unit (tax-inclusive). */
  finalUnitMinor: number;
  /** Engine label, e.g. "Sunday Funday · 3 for 2". */
  appliedLabel?: string | null;
  /** Engine's effective percent for the line (display only). */
  promoPercent?: number | null;
  /** Unit price after the deal, before any later reduction. */
  promoUnitMinor?: number | null;
  /** The cost floor limited the deal on this line. */
  atCostFloor?: boolean | null;
  /** Unit price after a manager override (promoUnitMinor is what it replaced). */
  overrideUnitMinor?: number | null;
  /** Tax the medical patient did not pay on this line (LINE total). */
  medicalSavingsMinor?: number | null;
  /** Per-UNIT loyalty reward reduction. */
  loyaltyUnitMinor?: number | null;
  /** Label for the loyalty reward (e.g. "Loyalty reward GW-1234"). */
  loyaltyLabel?: string | null;
  /** Per-UNIT special-discount reduction (employee / veteran / industry). */
  specialUnitMinor?: number | null;
  /** Label for the special discount (e.g. "Veteran discount (10%)"). */
  specialLabel?: string | null;
};

// ---------------------------------------------------------------------------
// Deal label parsing
// ---------------------------------------------------------------------------

export type DealMechanic =
  | { kind: "percent"; percent: number }
  | { kind: "fixed"; offMinor: number }
  | { kind: "bundle"; n: number; m: number }
  | { kind: "bogo" }
  | { kind: "topItem"; topPercent: number; restPercent: number }
  | { kind: "unknown" };

export type ParsedDeal = { name: string; mechanic: DealMechanic };

const SEP = " \u00b7 ";

/** Split an engine label into the deal's name and its mechanic. */
export function parseDealLabel(label: string | null | undefined): ParsedDeal | null {
  const raw = (label ?? "").trim();
  if (!raw) return null;
  const at = raw.lastIndexOf(SEP);
  if (at < 0) return { name: raw, mechanic: { kind: "unknown" } };
  const name = raw.slice(0, at).trim() || raw;
  const suffix = raw.slice(at + SEP.length).trim();
  let m: RegExpMatchArray | null;
  if ((m = suffix.match(/^(\d+(?:\.\d+)?)% off$/i))) {
    return { name, mechanic: { kind: "percent", percent: Number(m[1]) } };
  }
  if ((m = suffix.match(/^\$(\d+)(?:\.(\d{1,2}))? off$/i))) {
    const cents = Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
    return { name, mechanic: { kind: "fixed", offMinor: cents } };
  }
  if ((m = suffix.match(/^(\d+) for (\d+)$/i))) {
    return { name, mechanic: { kind: "bundle", n: Number(m[1]), m: Number(m[2]) } };
  }
  if (/^bogo$/i.test(suffix)) return { name, mechanic: { kind: "bogo" } };
  if ((m = suffix.match(/^(\d+(?:\.\d+)?)% one item \+ (\d+(?:\.\d+)?)%$/i))) {
    return {
      name,
      mechanic: { kind: "topItem", topPercent: Number(m[1]), restPercent: Number(m[2]) },
    };
  }
  // Not a suffix we recognise: keep the whole label as the name.
  return { name: raw, mechanic: { kind: "unknown" } };
}

function money(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minor));
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Short mechanic tag, e.g. "15% off", "Buy 3, pay for 2". */
export function dealMechanicShort(m: DealMechanic): string {
  switch (m.kind) {
    case "percent":
      return `${trimNum(m.percent)}% off`;
    case "fixed":
      return `${money(m.offMinor)} off each`;
    case "bundle":
      return `Buy ${m.n}, pay for ${m.m}`;
    case "bogo":
      return "Buy one, get one";
    case "topItem":
      return `${trimNum(m.topPercent)}% off one item + ${trimNum(m.restPercent)}% off the rest`;
    default:
      return "";
  }
}

/** One plain-English sentence explaining HOW the deal produced this price. */
export function dealMechanicSentence(m: DealMechanic): string {
  switch (m.kind) {
    case "percent":
      return `${trimNum(m.percent)}% off the regular price.`;
    case "fixed":
      return `${money(m.offMinor)} off the regular price of each item.`;
    case "bundle":
      return (
        `Buy ${m.n}, pay for ${m.m}: the value of the free item${m.n - m.m === 1 ? "" : "s"} is shared ` +
        "across every item in the deal, to the cent, so no item is sold below its cost."
      );
    case "bogo":
      return (
        "Buy one, get one: the discount earned on the lower-priced item is shared across " +
        "the matching items so no item is sold below its cost."
      );
    case "topItem":
      return (
        `${trimNum(m.topPercent)}% off one item (the lowest-priced) and ${trimNum(m.restPercent)}% off ` +
        "everything else in the deal; multi-unit lines show the blended price."
      );
    default:
      return "";
  }
}

function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

/** Format a ratio as a percent with `decimals` places, trailing zeros trimmed. */
export function formatPercent(numerator: number, denominator: number, decimals = 1): string {
  if (!(denominator > 0) || !(numerator > 0)) return "0%";
  const dec = Math.max(0, Math.min(2, Math.round(decimals)));
  const pct = (numerator / denominator) * 100;
  // Round DOWN at the last place so we never overstate a saving.
  const factor = 10 ** dec;
  const floored = Math.floor(pct * factor + 1e-9) / factor;
  const fixed = floored.toFixed(dec);
  const trimmed = dec > 0 ? fixed.replace(/\.?0+$/, "") : fixed;
  return `${trimmed}%`;
}

// ---------------------------------------------------------------------------
// Breakdown
// ---------------------------------------------------------------------------

export type DiscountPartKind = "deal" | "override" | "medical" | "loyalty" | "special";

export type DiscountPart = {
  kind: DiscountPartKind;
  /** Customer-facing label, e.g. "Happy Hour", "Loyalty reward". */
  label: string;
  /** Saving on the WHOLE line, cents (positive = customer saved). */
  amountMinor: number;
};

export type LineDiscountBreakdown = {
  productName: string;
  quantity: number;
  regularUnitMinor: number;
  finalUnitMinor: number;
  regularLineMinor: number;
  finalLineMinor: number;
  /** Total saving on the line (sum of `parts`). */
  savedLineMinor: number;
  discounted: boolean;
  deal: ParsedDeal | null;
  /** Headline percent the deal advertises (when parseable). */
  dealHeadlinePercent: number | null;
  /** The cost floor capped this line's deal. */
  atCostFloor: boolean;
  parts: DiscountPart[];
};

export type DealSummaryRow = {
  kind: DiscountPartKind;
  label: string;
  /** Short mechanic tag for deals ("Buy 3, pay for 2"); "" otherwise. */
  detail: string;
  amountMinor: number;
  /** Units on lines that received this saving. */
  units: number;
};

export type OrderDiscountSummary = {
  regularTotalMinor: number;
  finalTotalMinor: number;
  savedTotalMinor: number;
  itemCount: number;
  discountedItemCount: number;
  byDeal: DealSummaryRow[];
  anyBundleSpread: boolean;
  anyCostFloor: boolean;
  anyMedical: boolean;
  anyLoyaltyOrSpecial: boolean;
  anyOverride: boolean;
};

export type DiscountBreakdown = {
  lines: LineDiscountBreakdown[];
  summary: OrderDiscountSummary;
};

function int(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

function headlinePercent(m: DealMechanic | undefined): number | null {
  if (!m) return null;
  if (m.kind === "percent") return m.percent;
  if (m.kind === "topItem") return m.topPercent;
  return null;
}

/** Decompose one line's saving into its parts (parts always sum exactly). */
export function breakdownLine(l: DiscountLineInput): LineDiscountBreakdown {
  const qty = Math.max(0, Math.round(l.quantity));
  const regular = Math.max(0, Math.round(l.regularUnitMinor));
  const final = Math.max(0, Math.round(l.finalUnitMinor));
  const regularLine = regular * qty;
  const finalLine = final * qty;
  const total = Math.max(0, regularLine - finalLine);
  const deal = parseDealLabel(l.appliedLabel);

  const loyalty = Math.max(0, (int(l.loyaltyUnitMinor) ?? 0) * qty);
  const special = Math.max(0, (int(l.specialUnitMinor) ?? 0) * qty);
  const medical = Math.max(0, int(l.medicalSavingsMinor) ?? 0);
  const promoUnit = int(l.promoUnitMinor);
  const overrideUnit = int(l.overrideUnitMinor);
  const override =
    overrideUnit != null && promoUnit != null ? (promoUnit - overrideUnit) * qty : 0;

  let dealAmt =
    promoUnit != null ? Math.max(0, (regular - promoUnit) * qty) : total - loyalty - special - medical - override;
  if (dealAmt < 0) dealAmt = 0;
  // Residue (rounding in the medical reprice, a thin caller) lands on the
  // deal part so the parts ALWAYS add up to the line's real saving.
  const residue = total - (dealAmt + override + medical + loyalty + special);
  if (residue !== 0) {
    if (dealAmt + residue >= 0 && (dealAmt > 0 || deal)) dealAmt += residue;
  }

  const parts: DiscountPart[] = [];
  if (dealAmt !== 0) parts.push({ kind: "deal", label: deal?.name ?? "Sale price", amountMinor: dealAmt });
  if (override !== 0) parts.push({ kind: "override", label: "Manager price adjustment", amountMinor: override });
  if (medical > 0) parts.push({ kind: "medical", label: "Medical tax exemption", amountMinor: medical });
  if (loyalty > 0) {
    parts.push({ kind: "loyalty", label: (l.loyaltyLabel ?? "").trim() || "Loyalty reward", amountMinor: loyalty });
  }
  if (special > 0) {
    parts.push({ kind: "special", label: (l.specialLabel ?? "").trim() || "Special discount", amountMinor: special });
  }
  // Still not adding up (residue could not land on a deal): show it honestly
  // as a generic line rather than letting the parts disagree with the total.
  const sum = parts.reduce((s, p) => s + p.amountMinor, 0);
  if (sum !== total) {
    const gap = total - sum;
    const generic = parts.find((p) => p.kind === "deal");
    if (generic && generic.amountMinor + gap >= 0) generic.amountMinor += gap;
    else if (gap > 0) parts.unshift({ kind: "deal", label: "Sale price", amountMinor: gap });
  }

  return {
    productName: l.productName,
    quantity: qty,
    regularUnitMinor: regular,
    finalUnitMinor: final,
    regularLineMinor: regularLine,
    finalLineMinor: finalLine,
    savedLineMinor: total,
    discounted: total > 0,
    deal,
    dealHeadlinePercent: headlinePercent(deal?.mechanic),
    atCostFloor: l.atCostFloor === true,
    parts: parts.filter((p) => p.amountMinor !== 0),
  };
}

/** Breakdown of a whole order. */
export function computeDiscountBreakdown(lines: readonly DiscountLineInput[]): DiscountBreakdown {
  const out = lines.map(breakdownLine);
  const byKey = new Map<string, DealSummaryRow>();
  let anyBundleSpread = false;
  let anyCostFloor = false;
  let anyMedical = false;
  let anyLoyaltyOrSpecial = false;
  let anyOverride = false;
  for (const l of out) {
    if (l.atCostFloor && l.discounted) anyCostFloor = true;
    const mk = l.deal?.mechanic.kind;
    for (const p of l.parts) {
      if (p.kind === "deal" && (mk === "bundle" || mk === "bogo" || mk === "topItem")) anyBundleSpread = true;
      if (p.kind === "medical") anyMedical = true;
      if (p.kind === "loyalty" || p.kind === "special") anyLoyaltyOrSpecial = true;
      if (p.kind === "override") anyOverride = true;
      const detail = p.kind === "deal" && l.deal ? dealMechanicShort(l.deal.mechanic) : "";
      // Group deals by name+mechanic so "Happy Hour 15%" and a different
      // day's deal never merge; other programs group by label.
      const key = `${p.kind}|${p.label}|${p.kind === "deal" ? detail : ""}`;
      const row = byKey.get(key) ?? { kind: p.kind, label: p.label, detail, amountMinor: 0, units: 0 };
      row.amountMinor += p.amountMinor;
      row.units += l.quantity;
      byKey.set(key, row);
    }
  }
  const order: Record<DiscountPartKind, number> = { deal: 0, override: 1, medical: 2, loyalty: 3, special: 4 };
  const byDeal = Array.from(byKey.values())
    .filter((r) => r.amountMinor !== 0)
    .sort((a, b) => order[a.kind] - order[b.kind] || b.amountMinor - a.amountMinor);
  const regularTotalMinor = out.reduce((s, l) => s + l.regularLineMinor, 0);
  const finalTotalMinor = out.reduce((s, l) => s + l.finalLineMinor, 0);
  return {
    lines: out,
    summary: {
      regularTotalMinor,
      finalTotalMinor,
      savedTotalMinor: out.reduce((s, l) => s + l.savedLineMinor, 0),
      itemCount: out.reduce((s, l) => s + l.quantity, 0),
      discountedItemCount: out.reduce((s, l) => s + (l.discounted ? l.quantity : 0), 0),
      byDeal,
      anyBundleSpread,
      anyCostFloor,
      anyMedical,
      anyLoyaltyOrSpecial,
      anyOverride,
    },
  };
}

// ---------------------------------------------------------------------------
// Presentation rows (shared by HTML, email, ESC/POS and React renderers)
// ---------------------------------------------------------------------------

/**
 * A row printed under a product. `amountMinor` (when present) is a SAVING
 * and renders right-aligned as "-$X.XX"; `emphasis` rows are the headline
 * saving for the line.
 */
export type DiscountTextRow = { text: string; amountMinor?: number; emphasis?: boolean };

/** Rows printed under one discounted line, honouring the owner's switches. */
export function lineDiscountRows(
  line: LineDiscountBreakdown,
  cfg: DiscountDisplayConfig,
): DiscountTextRow[] {
  if (!line.discounted) return [];
  const rows: DiscountTextRow[] = [];
  const dec = cfg.percentDecimals;

  if (cfg.showRegularPrice) {
    rows.push({
      text:
        line.quantity > 1
          ? `Regular ${line.quantity} x ${money(line.regularUnitMinor)} = ${money(line.regularLineMinor)}`
          : `Regular price ${money(line.regularUnitMinor)}`,
    });
  }

  if (cfg.showLineSavings || cfg.showLinePercent) {
    const pct = formatPercent(line.savedLineMinor, line.regularLineMinor, dec);
    const text =
      cfg.showLineSavings && cfg.showLinePercent
        ? `You saved ${pct} on this item`
        : cfg.showLineSavings
          ? "You saved on this item"
          : `${pct} off`;
    rows.push(
      cfg.showLineSavings
        ? { text, amountMinor: line.savedLineMinor, emphasis: true }
        : { text, emphasis: true },
    );
  }

  const multiPart = line.parts.length > 1;
  for (const p of line.parts) {
    if (p.kind === "deal") {
      if (cfg.showDealName) {
        const tag = line.deal ? dealMechanicShort(line.deal.mechanic) : "";
        const name = line.deal ? `Deal: ${p.label}${tag ? ` (${tag})` : ""}` : `Deal: ${p.label}`;
        rows.push(multiPart && cfg.showLineSavings ? { text: name, amountMinor: p.amountMinor } : { text: name });
      }
      if (cfg.showDealMechanic && line.deal) {
        const s = dealMechanicSentence(line.deal.mechanic);
        if (s) rows.push({ text: s });
      }
      if (cfg.showCostFloorNote && line.atCostFloor) {
        const eff = formatPercent(p.amountMinor, line.regularLineMinor, dec);
        const head = line.dealHeadlinePercent;
        rows.push({
          text:
            head != null
              ? `Capped at our cost: this item got ${eff} instead of ${trimNum(head)}% because our pricing never goes below what we paid for the product.`
              : `Capped at our cost: this item's deal was limited to ${eff} because our pricing never goes below what we paid for the product.`,
        });
      }
    } else if (cfg.showOtherDiscounts) {
      rows.push({ text: p.label, amountMinor: p.amountMinor });
    }
  }

  if (line.quantity > 1 && (cfg.showRegularPrice || cfg.showLineSavings)) {
    rows.push({
      text: `Your price ${money(line.finalUnitMinor)} each (was ${money(line.regularUnitMinor)})`,
    });
  }
  return rows;
}

export type SummaryRow = { label: string; value: string; emphasis?: boolean };

export type OrderSummaryBlock = {
  title: string;
  rows: SummaryRow[];
  notes: string[];
};

/**
 * The order-level block. Returns null when there is nothing to say (no
 * saving) or the owner switched the block off.
 */
export function orderSummaryBlock(
  summary: OrderDiscountSummary,
  cfg: DiscountDisplayConfig,
): OrderSummaryBlock | null {
  if (summary.savedTotalMinor <= 0) return null;
  const rows: SummaryRow[] = [];
  const notes: string[] = [];
  const dec = cfg.percentDecimals;

  if (cfg.showOrderSummary) {
    rows.push({ label: "Regular price total", value: money(summary.regularTotalMinor) });
    if (cfg.showDealBreakdown) {
      for (const r of summary.byDeal) {
        const label = r.detail ? `${r.label} (${r.detail})` : r.label;
        rows.push({ label: `  ${label}`, value: `-${money(r.amountMinor)}` });
      }
    }
    rows.push({ label: "Total discounts", value: `-${money(summary.savedTotalMinor)}`, emphasis: true });
    rows.push({ label: "Your price (tax incl.)", value: money(summary.finalTotalMinor) });
    if (cfg.showOrderPercent) {
      rows.push({
        label: "Total off your order",
        value: formatPercent(summary.savedTotalMinor, summary.regularTotalMinor, dec),
        emphasis: true,
      });
    }
    rows.push({
      label: "Items discounted",
      value: `${summary.discountedItemCount} of ${summary.itemCount}`,
    });
  }

  if (cfg.showExplanation) {
    notes.push(
      "Only one deal applies to each item. When more than one deal qualifies you automatically get the bigger one; deals never stack.",
    );
    if (summary.anyBundleSpread) {
      notes.push(
        "Bundle-style deals (buy N pay for M, BOGO, one-item specials) are shared across every qualifying item in exact cents, so each item keeps a fair price and none is sold below cost. The per-item savings add up exactly to the deal.",
      );
    }
    if (summary.anyCostFloor) {
      notes.push(
        "Some discounts were capped at our cost: our pricing never sells a product below what the store paid for it, so on those items you received the largest discount possible instead of the full advertised percent.",
      );
    }
    if (summary.anyLoyaltyOrSpecial) {
      notes.push(
        "Loyalty rewards and special discounts are taken after the deal price and spread across the items they apply to.",
      );
    }
    if (summary.anyOverride) {
      notes.push("A manager price adjustment was approved on this order and is shown on the item it applies to.");
    }
    if (summary.anyMedical) {
      notes.push("Medical: eligible taxes were removed for a registered patient and are counted as a saving.");
    }
    notes.push("All prices include tax. Savings are measured against the regular tax-included price.");
    const extra = cfg.explanationText.trim();
    if (extra) notes.push(extra);
  }

  if (rows.length === 0 && notes.length === 0) return null;
  return { title: cfg.summaryTitle.trim() || DEFAULT_DISCOUNT_DISPLAY_CONFIG.summaryTitle, rows, notes };
}

/**
 * True when the deal name is already printed by the discount rows, so the
 * receipt's item-detail line should not print it a second time.
 */
export function dealNameShownInRows(line: LineDiscountBreakdown, cfg: DiscountDisplayConfig): boolean {
  return line.discounted && cfg.showDealName && line.parts.some((p) => p.kind === "deal");
}

// ---------------------------------------------------------------------------
// Self-tests (wired into scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runReceiptDiscountCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.error(`  FAIL receipt-discount-core: ${label}`);
    }
  };
  const cfg = DEFAULT_DISCOUNT_DISPLAY_CONFIG;

  // Label parsing
  ok(parseDealLabel("Happy Hour \u00b7 15% off")?.mechanic.kind === "percent", "percent label");
  ok(parseDealLabel("Happy Hour \u00b7 15% off")?.name === "Happy Hour", "percent name");
  const b = parseDealLabel("Sunday \u00b7 Funday \u00b7 3 for 2");
  ok(b?.name === "Sunday \u00b7 Funday" && b.mechanic.kind === "bundle", "bundle label, title with separator");
  ok(parseDealLabel("Tue \u00b7 BOGO")?.mechanic.kind === "bogo", "bogo label");
  const fx = parseDealLabel("Vendor \u00b7 $5.00 off");
  ok(fx?.mechanic.kind === "fixed" && fx.mechanic.offMinor === 500, "fixed label cents");
  const top = parseDealLabel("Super Saturday \u00b7 30% one item + 15%");
  ok(top?.mechanic.kind === "topItem" && top.mechanic.topPercent === 30, "top-item label");
  ok(parseDealLabel("Clearance")?.name === "Clearance", "no suffix keeps label");
  ok(parseDealLabel("") === null && parseDealLabel(null) === null, "blank label null");

  // Percent formatting never overstates
  ok(formatPercent(1, 3, 1) === "33.3%", "33.3%");
  ok(formatPercent(2, 3, 1) === "66.6%", "66.6% floors (not 66.7)");
  ok(formatPercent(15, 100, 1) === "15%", "trailing zero trimmed");
  ok(formatPercent(0, 100, 1) === "0%" && formatPercent(5, 0, 1) === "0%", "zero guards");
  ok(formatPercent(1, 8, 2) === "12.5%", "12.5% at 2dp trims");

  // Simple percent line
  const simple = breakdownLine({
    productName: "Blue Dream",
    quantity: 1,
    regularUnitMinor: 3000,
    finalUnitMinor: 2550,
    appliedLabel: "Happy Hour \u00b7 15% off",
    promoUnitMinor: 2550,
  });
  ok(simple.savedLineMinor === 450, "saved 450");
  ok(simple.parts.length === 1 && simple.parts[0].amountMinor === 450, "one deal part");

  // Full stack: deal + override + medical + loyalty — parts sum exactly
  const stack = breakdownLine({
    productName: "Gummy",
    quantity: 2,
    regularUnitMinor: 2000,
    finalUnitMinor: 1150,
    appliedLabel: "Sunday \u00b7 3 for 2",
    promoUnitMinor: 1700,
    overrideUnitMinor: 1600,
    medicalSavingsMinor: 700,
    loyaltyUnitMinor: 100,
  });
  const sum = stack.parts.reduce((s, p) => s + p.amountMinor, 0);
  ok(stack.savedLineMinor === 1700, "stack total 1700");
  ok(sum === stack.savedLineMinor, "stack parts sum to the line saving");
  ok(stack.parts.find((p) => p.kind === "override")?.amountMinor === 200, "override part 200");
  ok(stack.parts.find((p) => p.kind === "deal")?.amountMinor === 600, "deal part 600");

  // Thin caller (no promoUnit): deal = total minus the known others
  const thin = breakdownLine({
    productName: "X",
    quantity: 1,
    regularUnitMinor: 1000,
    finalUnitMinor: 800,
    specialUnitMinor: 50,
    specialLabel: "Veteran discount (5%)",
  });
  ok(thin.parts.find((p) => p.kind === "deal")?.amountMinor === 150, "thin deal = 150");
  ok(thin.parts.find((p) => p.kind === "special")?.label.startsWith("Veteran"), "special label kept");

  // Undiscounted line: no rows
  const none = breakdownLine({ productName: "Y", quantity: 1, regularUnitMinor: 500, finalUnitMinor: 500 });
  ok(!none.discounted && lineDiscountRows(none, cfg).length === 0, "no rows when not discounted");

  // Order summary
  const bd = computeDiscountBreakdown([
    { productName: "A", quantity: 1, regularUnitMinor: 3000, finalUnitMinor: 2000, appliedLabel: "Sun \u00b7 3 for 2", promoUnitMinor: 2000 },
    { productName: "B", quantity: 2, regularUnitMinor: 1500, finalUnitMinor: 1000, appliedLabel: "Sun \u00b7 3 for 2", promoUnitMinor: 1000, atCostFloor: true },
    { productName: "C", quantity: 1, regularUnitMinor: 900, finalUnitMinor: 900 },
  ]);
  ok(bd.summary.regularTotalMinor === 6900, "regular total");
  ok(bd.summary.savedTotalMinor === 2000, "saved total");
  ok(bd.summary.byDeal.length === 1 && bd.summary.byDeal[0].amountMinor === 2000, "deals grouped");
  ok(bd.summary.anyBundleSpread && bd.summary.anyCostFloor, "flags set");
  ok(bd.summary.discountedItemCount === 3 && bd.summary.itemCount === 4, "item counts");
  const block = orderSummaryBlock(bd.summary, cfg);
  ok(block !== null && block.rows.some((r) => r.label === "Total off your order" && r.value === "28.9%"), "order percent row (floored)");
  ok(block !== null && block.notes.some((n) => n.includes("exact cents")), "spread note present");
  ok(block !== null && block.notes.some((n) => n.includes("below what the store paid")), "cost floor note present");

  // Rows honour switches
  const rowsAll = lineDiscountRows(bd.lines[1], cfg);
  ok(rowsAll.some((r) => r.text.startsWith("Regular 2 x")), "multi-qty regular row");
  ok(rowsAll.some((r) => r.text.startsWith("Capped at our cost")), "cost floor row");
  ok(rowsAll.some((r) => r.text.startsWith("Deal: Sun (Buy 3, pay for 2)")), "deal name row with mechanic tag");
  const off = normalizeDiscountDisplayConfig({
    showRegularPrice: false,
    showLineSavings: false,
    showLinePercent: false,
    showDealName: false,
    showDealMechanic: false,
    showCostFloorNote: false,
    showOtherDiscounts: false,
  });
  ok(lineDiscountRows(bd.lines[1], off).length === 0, "all line switches off -> no rows");
  const offSummary = normalizeDiscountDisplayConfig({ showOrderSummary: false, showExplanation: false });
  ok(orderSummaryBlock(bd.summary, offSummary) === null, "summary + explanation off -> null");
  ok(orderSummaryBlock(computeDiscountBreakdown([]).summary, cfg) === null, "no savings -> null");

  // Normalization
  ok(normalizeDiscountDisplayConfig(null).showOrderSummary === true, "null -> defaults");
  ok(normalizeDiscountDisplayConfig({ percentDecimals: 9 }).percentDecimals === 2, "decimals clamped");
  ok(normalizeDiscountDisplayConfig({ percentDecimals: "0" }).percentDecimals === 0, "decimals from string");
  ok(normalizeDiscountDisplayConfig({ summaryTitle: "   " }).summaryTitle === "YOUR SAVINGS", "blank title -> default");
  ok(normalizeDiscountDisplayConfig({ explanationText: "x".repeat(900) }).explanationText.length === DISCOUNT_EXPLANATION_MAX, "explanation clamped");
  ok(normalizeDiscountDisplayConfig({ showDealName: "false" }).showDealName === false, "string bool");
  const custom = orderSummaryBlock(bd.summary, normalizeDiscountDisplayConfig({ explanationText: "Ask us anything!" }));
  ok(custom !== null && custom.notes[custom.notes.length - 1] === "Ask us anything!", "owner text appended last");

  console.log(`receipt-discount-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`receipt-discount-core: ${fail} failure(s)`);
}
