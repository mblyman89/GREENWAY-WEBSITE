/**
 * src/lib/crypto/crypto-classification-core.ts
 *
 * PURE classification vocabulary for the Crypto tax engine (R1-A). NO I/O, no
 * server-only imports — safe under tsx and vitest. This is the "dictionary"
 * every later slice reads: it defines the transaction PRIMITIVES (the four
 * buckets every on-chain movement falls into) and the full TAG set (equal to
 * or better than Koinly's), and for each tag it declares:
 *
 *   - taxTreatment  — how the tag is taxed (income | disposal | acquisition-cost
 *     | non-taxable | transfer | trade). This is the single source of truth the
 *     cost-basis engine (R1-C) and reports (R1-F) consult; nothing downstream
 *     guesses.
 *   - validOn       — which primitive(s) the tag may be applied to (a "gift
 *     sent" tag makes no sense on a Deposit). The classifier UI (R1-E) uses this
 *     to offer only sensible tags.
 *   - plainNote     — a one-line, plain-English "what this means for your taxes"
 *     sentence for Michael (a coding + tax novice). Community pain point #1 was
 *     opaque math; every tag here explains itself.
 *   - createsIncome / isDisposal / isAcquisition — derived booleans the engine
 *     keys off so it never re-interprets the treatment string.
 *
 * Design sources: research/r1-koinly-classification-recon.md §1 (Koinly's four
 * primitives + full tag vocabulary + three tax outcomes) and §2 (US tax
 * correctness — income at FMV, capital gains on disposals, non-taxable moves).
 * Chain-native extras (FTSO / delegation reward, Flare/Songbird airdrop) are
 * Greenway differentiators per §5, approved by Michael.
 *
 * IMPORTANT: this module is intentionally I/O-free and deterministic. It maps
 * cleanly onto the existing `crypto_transactions` row (direction in/out/self +
 * auto tx_type) — see mapDirectionToPrimitive() — but stores nothing itself.
 * R1-B adds the persistence layer on top.
 */

// ---------------------------------------------------------------------------
// Transaction primitives — the four buckets every movement falls into.
// Mirrors Koinly's Deposit / Withdrawal / Trade / Transfer, named for clarity.
// ---------------------------------------------------------------------------

/**
 * The high-level shape of a movement, independent of its tax meaning:
 *   - "deposit"  : value came INTO a wallet from outside your control
 *   - "withdrawal": value LEFT a wallet to outside your control
 *   - "trade"    : one asset became another (a swap/exchange) — a disposal + an
 *                  acquisition in a single event
 *   - "transfer" : a move BETWEEN two of your own wallets — not taxable, but the
 *                  cost basis + acquisition date must carry across
 */
export type TxPrimitive = "deposit" | "withdrawal" | "trade" | "transfer";

export const TX_PRIMITIVES: readonly TxPrimitive[] = [
  "deposit",
  "withdrawal",
  "trade",
  "transfer",
] as const;

// ---------------------------------------------------------------------------
// Tax treatment — the single source of truth for how a tagged movement is taxed.
// ---------------------------------------------------------------------------

/**
 *   - "income"           : taxed as ordinary income at fair-market-value on the
 *                          day received (also becomes the cost basis of the coins
 *                          received). E.g. staking/FTSO rewards, airdrops, pay.
 *   - "disposal"         : a taxable sale — realizes capital gain/loss vs. basis.
 *   - "acquisition-cost" : a purchase/receipt that ADDS a cost-basis lot but is
 *                          NOT itself taxable (buying with cash, receiving a gift
 *                          you now hold).
 *   - "non-taxable"      : no tax event and no basis change beyond bookkeeping
 *                          (e.g. moving your own coins; a non-taxable return).
 *   - "transfer"         : an own-wallet move — non-taxable, but basis + holding
 *                          period carry across wallets (per-wallet 2025 rule).
 *   - "trade"            : a swap — the disposed leg realizes gain/loss and the
 *                          received leg opens a new basis lot at FMV.
 */
export type TaxTreatment =
  | "income"
  | "disposal"
  | "acquisition-cost"
  | "non-taxable"
  | "transfer"
  | "trade";

export const TAX_TREATMENTS: readonly TaxTreatment[] = [
  "income",
  "disposal",
  "acquisition-cost",
  "non-taxable",
  "transfer",
  "trade",
] as const;

// ---------------------------------------------------------------------------
// Tag definition.
// ---------------------------------------------------------------------------

export interface TagDefinition {
  /** Stable machine key stored on the classification row. Never change these. */
  readonly key: string;
  /** Human label for the classify UI. */
  readonly label: string;
  /** How this tag is taxed — the downstream engine's source of truth. */
  readonly taxTreatment: TaxTreatment;
  /** Primitives this tag may be applied to. */
  readonly validOn: readonly TxPrimitive[];
  /** One-line plain-English tax meaning for Michael. */
  readonly plainNote: string;
  /** True when receiving these coins is ordinary income at FMV on receipt. */
  readonly createsIncome: boolean;
  /** True when this realizes a capital gain/loss (a taxable disposal leg). */
  readonly isDisposal: boolean;
  /** True when this opens/extends a cost-basis lot. */
  readonly isAcquisition: boolean;
}

// Small helper so every definition stays consistent and its derived booleans
// are computed once from the treatment (never hand-typed inconsistently).
function def(
  key: string,
  label: string,
  taxTreatment: TaxTreatment,
  validOn: readonly TxPrimitive[],
  plainNote: string,
): TagDefinition {
  const createsIncome = taxTreatment === "income";
  const isDisposal = taxTreatment === "disposal" || taxTreatment === "trade";
  const isAcquisition =
    taxTreatment === "income" ||
    taxTreatment === "acquisition-cost" ||
    taxTreatment === "trade";
  return {
    key,
    label,
    taxTreatment,
    validOn,
    plainNote,
    createsIncome,
    isDisposal,
    isAcquisition,
  };
}

// Convenience primitive sets.
const IN: readonly TxPrimitive[] = ["deposit"];
const OUT: readonly TxPrimitive[] = ["withdrawal"];
const IN_OR_TRADE: readonly TxPrimitive[] = ["deposit", "trade"];
const OUT_OR_TRADE: readonly TxPrimitive[] = ["withdrawal", "trade"];

// ---------------------------------------------------------------------------
// The full tag vocabulary. Grouped by intent; order is display order.
// Equal-or-better than Koinly's set (research §1) plus chain-native extras (§5).
// ---------------------------------------------------------------------------

export const TAG_DEFINITIONS: readonly TagDefinition[] = [
  // --- Incoming, taxable as income (FMV on receipt) ---
  def(
    "reward_staking",
    "Staking reward",
    "income",
    IN,
    "Taxed as ordinary income at its dollar value the day you received it; that value also becomes your cost basis.",
  ),
  def(
    "reward_ftso",
    "FTSO / delegation reward",
    "income",
    IN,
    "Flare/Songbird delegation rewards are ordinary income at their dollar value on the day received.",
  ),
  def(
    "reward_mining",
    "Mining reward",
    "income",
    IN,
    "Mined coins are ordinary income at their dollar value on the day received.",
  ),
  def(
    "airdrop",
    "Airdrop",
    "income",
    IN,
    "Airdropped tokens are ordinary income at their dollar value when you gained control of them.",
  ),
  def(
    "fork",
    "Hard fork",
    "income",
    IN,
    "Coins from a hard fork are ordinary income at their value when you could first use them.",
  ),
  def(
    "interest",
    "Interest / yield",
    "income",
    IN,
    "Interest or lending yield is ordinary income at its dollar value when received.",
  ),
  def(
    "income_payment",
    "Payment received (income)",
    "income",
    IN,
    "Crypto received as pay for goods or services is ordinary income at its dollar value on receipt.",
  ),
  def(
    "reward_referral",
    "Referral / bonus reward",
    "income",
    IN,
    "Referral or promo bonuses are ordinary income at their dollar value when received.",
  ),

  // --- Incoming, not income but adds cost basis ---
  def(
    "buy",
    "Buy / purchase",
    "acquisition-cost",
    IN_OR_TRADE,
    "Not taxable now; what you paid (plus fees) becomes the cost basis you subtract when you later sell.",
  ),
  def(
    "gift_received",
    "Gift received",
    "acquisition-cost",
    IN,
    "Receiving a gift isn't taxable now; you generally carry over the giver's original cost basis and purchase date.",
  ),

  // --- Incoming, not taxable at all ---
  def(
    "deposit_non_taxable",
    "Non-taxable deposit",
    "non-taxable",
    IN,
    "A non-taxable receipt (e.g. a returned amount) — no tax and no new gain.",
  ),

  // --- Outgoing, taxable disposals (capital gain/loss vs. basis) ---
  def(
    "sell",
    "Sell / sale",
    "disposal",
    OUT_OR_TRADE,
    "A taxable sale: your gain or loss is the sale value minus your cost basis, split into short- or long-term.",
  ),
  def(
    "spend",
    "Spend / payment made",
    "disposal",
    OUT,
    "Spending crypto is a taxable sale at its value when spent; gain or loss is that value minus your cost basis.",
  ),
  def(
    "gift_sent",
    "Gift sent",
    "non-taxable",
    OUT,
    "Giving crypto as a gift is generally not a taxable sale for you; large gifts may need a gift-tax form.",
  ),
  def(
    "donation",
    "Charitable donation",
    "non-taxable",
    OUT,
    "Donating crypto to a qualified charity is generally not a taxable sale and may be deductible.",
  ),
  def(
    "lost_stolen",
    "Lost / stolen",
    "disposal",
    OUT,
    "Coins lost or stolen leave your holdings; treatment varies — we flag it so your accountant can decide.",
  ),

  // --- Outgoing, not taxable ---
  def(
    "withdrawal_non_taxable",
    "Non-taxable withdrawal",
    "non-taxable",
    OUT,
    "An outgoing move that isn't a sale (e.g. posting collateral) — no tax event.",
  ),

  // --- Own-wallet transfer (non-taxable, basis carries across) ---
  def(
    "transfer",
    "Transfer between your wallets",
    "transfer",
    ["transfer"],
    "Moving your own coins between your wallets is not taxable; the cost basis and purchase date follow the coins.",
  ),

  // --- Fees ---
  def(
    "fee",
    "Network / transaction fee",
    "acquisition-cost",
    OUT,
    "A standalone fee — added to the cost of the related buy or subtracted from the proceeds of the related sale.",
  ),

  // --- Trade (swap: disposal of one asset + acquisition of another) ---
  def(
    "trade",
    "Trade / swap",
    "trade",
    ["trade"],
    "Swapping one coin for another is a taxable sale of the first; the second starts a new cost basis at its value.",
  ),

  // --- Liquidity provision (flagged; treatment is position-dependent) ---
  def(
    "lp_add",
    "Add liquidity",
    "non-taxable",
    OUT,
    "Adding to a liquidity pool — we track it separately; whether it's a taxable swap depends on the pool, so we flag it.",
  ),
  def(
    "lp_remove",
    "Remove liquidity",
    "non-taxable",
    IN,
    "Removing from a liquidity pool — tracked separately and flagged, since treatment depends on the pool.",
  ),
] as const;

// Index for O(1) lookup by key.
const TAG_BY_KEY: ReadonlyMap<string, TagDefinition> = new Map(
  TAG_DEFINITIONS.map((t) => [t.key, t]),
);

// ---------------------------------------------------------------------------
// Public lookups.
// ---------------------------------------------------------------------------

/** All tag keys, in display order. */
export function tagKeys(): string[] {
  return TAG_DEFINITIONS.map((t) => t.key);
}

/** Look up a tag definition by its stable key, or null if unknown. */
export function getTagDefinition(key: string): TagDefinition | null {
  return TAG_BY_KEY.get(key) ?? null;
}

/** True if the key is a known tag. */
export function isKnownTag(key: string): boolean {
  return TAG_BY_KEY.has(key);
}

/** Tags that may be applied to a given primitive (for the classify UI). */
export function tagsForPrimitive(primitive: TxPrimitive): TagDefinition[] {
  return TAG_DEFINITIONS.filter((t) => t.validOn.includes(primitive));
}

/** True if `tagKey` is a sensible choice for `primitive`. */
export function isTagValidOnPrimitive(
  tagKey: string,
  primitive: TxPrimitive,
): boolean {
  const d = TAG_BY_KEY.get(tagKey);
  return d != null && d.validOn.includes(primitive);
}

// ---------------------------------------------------------------------------
// Default classification from the raw crypto_transactions row.
// direction (in/out/self) is the ground truth we already store (migration 0160).
// This gives a sensible STARTING tag Michael can accept or override — it never
// silently finalizes anything.
// ---------------------------------------------------------------------------

export type TxDirection = "in" | "out" | "self";

/**
 * Map the stored direction (+ whether the row is a swap) onto a primitive.
 * A "self" direction means an own-wallet transfer; a swap tx_type means a trade;
 * otherwise in => deposit, out => withdrawal.
 */
export function mapDirectionToPrimitive(
  direction: TxDirection,
  isSwap: boolean,
): TxPrimitive {
  if (isSwap) return "trade";
  if (direction === "self") return "transfer";
  return direction === "in" ? "deposit" : "withdrawal";
}

/**
 * A conservative DEFAULT tag key for a freshly-synced row. We deliberately pick
 * the most neutral, non-income default so we never invent taxable income the
 * user didn't confirm:
 *   - trade    -> "trade"
 *   - transfer -> "transfer"
 *   - deposit  -> "buy"  (adds basis; NOT income — income requires confirmation)
 *   - withdraw -> "sell" (a disposal; the safe assumption is a taxable sale)
 * The classify UI (R1-E) surfaces this as a suggestion, not a decision.
 */
export function defaultTagForPrimitive(primitive: TxPrimitive): string {
  switch (primitive) {
    case "trade":
      return "trade";
    case "transfer":
      return "transfer";
    case "deposit":
      return "buy";
    case "withdrawal":
      return "sell";
  }
}

// ---------------------------------------------------------------------------
// Self-tests (bare-call style; throws on failure, prints pass line).
// ---------------------------------------------------------------------------

function eq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `crypto-classification-core: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

export function __runCryptoClassificationCoreTests(): void {
  // --- vocabulary integrity ---
  eq(TX_PRIMITIVES.length, 4, "four primitives");
  eq(TAX_TREATMENTS.length, 6, "six tax treatments");
  eq(TAG_DEFINITIONS.length > 0, true, "tags exist");

  // Every tag: known treatment, non-empty validOn, non-empty note, keys unique.
  const seen = new Set<string>();
  for (const t of TAG_DEFINITIONS) {
    eq(seen.has(t.key), false, `duplicate tag key ${t.key}`);
    seen.add(t.key);
    eq(TAX_TREATMENTS.includes(t.taxTreatment), true, `tag ${t.key} has valid treatment`);
    eq(t.validOn.length > 0, true, `tag ${t.key} valid on at least one primitive`);
    for (const p of t.validOn) {
      eq(TX_PRIMITIVES.includes(p), true, `tag ${t.key} validOn is a real primitive`);
    }
    eq(t.plainNote.length > 10, true, `tag ${t.key} has a plain-English note`);
    // Derived booleans consistent with treatment.
    eq(t.createsIncome, t.taxTreatment === "income", `tag ${t.key} createsIncome derived`);
    eq(
      t.isDisposal,
      t.taxTreatment === "disposal" || t.taxTreatment === "trade",
      `tag ${t.key} isDisposal derived`,
    );
    eq(
      t.isAcquisition,
      t.taxTreatment === "income" ||
        t.taxTreatment === "acquisition-cost" ||
        t.taxTreatment === "trade",
      `tag ${t.key} isAcquisition derived`,
    );
  }

  // --- lookups ---
  eq(isKnownTag("reward_ftso"), true, "FTSO tag known");
  eq(isKnownTag("not_a_tag"), false, "unknown tag rejected");
  eq(getTagDefinition("sell")?.taxTreatment, "disposal", "sell is a disposal");
  eq(getTagDefinition("buy")?.taxTreatment, "acquisition-cost", "buy adds basis");
  eq(getTagDefinition("transfer")?.taxTreatment, "transfer", "transfer treatment");
  eq(getTagDefinition("trade")?.taxTreatment, "trade", "trade treatment");
  eq(getTagDefinition("nope"), null, "missing tag -> null");

  // FTSO / staking / airdrop are income and open a basis lot at FMV.
  for (const k of ["reward_ftso", "reward_staking", "airdrop", "interest"]) {
    const d = getTagDefinition(k);
    eq(d?.createsIncome, true, `${k} creates income`);
    eq(d?.isAcquisition, true, `${k} opens a basis lot`);
    eq(d?.isDisposal, false, `${k} is not a disposal`);
  }

  // Gifts sent / donations are NOT taxable disposals for the sender.
  eq(getTagDefinition("gift_sent")?.isDisposal, false, "gift sent not a disposal");
  eq(getTagDefinition("donation")?.isDisposal, false, "donation not a disposal");
  eq(getTagDefinition("gift_sent")?.taxTreatment, "non-taxable", "gift sent non-taxable");

  // Trade is both a disposal (of the sent leg) and an acquisition (of received).
  const trade = getTagDefinition("trade");
  eq(trade?.isDisposal, true, "trade disposes");
  eq(trade?.isAcquisition, true, "trade acquires");

  // --- validity per primitive ---
  eq(isTagValidOnPrimitive("reward_ftso", "deposit"), true, "FTSO valid on deposit");
  eq(isTagValidOnPrimitive("reward_ftso", "withdrawal"), false, "FTSO invalid on withdrawal");
  eq(isTagValidOnPrimitive("gift_sent", "withdrawal"), true, "gift sent valid on withdrawal");
  eq(isTagValidOnPrimitive("gift_sent", "deposit"), false, "gift sent invalid on deposit");
  eq(isTagValidOnPrimitive("transfer", "transfer"), true, "transfer valid on transfer");
  eq(isTagValidOnPrimitive("transfer", "deposit"), false, "transfer invalid on deposit");
  eq(isTagValidOnPrimitive("buy", "trade"), true, "buy valid on trade leg");
  eq(isTagValidOnPrimitive("sell", "trade"), true, "sell valid on trade leg");
  eq(isTagValidOnPrimitive("unknown", "deposit"), false, "unknown tag never valid");

  // tagsForPrimitive returns only valid tags and is non-empty for each primitive.
  for (const p of TX_PRIMITIVES) {
    const tags = tagsForPrimitive(p);
    eq(tags.length > 0, true, `primitive ${p} has at least one tag`);
    for (const t of tags) {
      eq(t.validOn.includes(p), true, `tagsForPrimitive(${p}) only returns valid tags`);
    }
  }

  // --- direction -> primitive mapping ---
  eq(mapDirectionToPrimitive("in", false), "deposit", "in -> deposit");
  eq(mapDirectionToPrimitive("out", false), "withdrawal", "out -> withdrawal");
  eq(mapDirectionToPrimitive("self", false), "transfer", "self -> transfer");
  eq(mapDirectionToPrimitive("in", true), "trade", "swap -> trade (in)");
  eq(mapDirectionToPrimitive("out", true), "trade", "swap -> trade (out)");
  eq(mapDirectionToPrimitive("self", true), "trade", "swap wins over self");

  // --- conservative defaults ---
  eq(defaultTagForPrimitive("deposit"), "buy", "deposit default = buy (not income)");
  eq(defaultTagForPrimitive("withdrawal"), "sell", "withdrawal default = sell");
  eq(defaultTagForPrimitive("transfer"), "transfer", "transfer default = transfer");
  eq(defaultTagForPrimitive("trade"), "trade", "trade default = trade");
  // Each default is itself a known tag valid on that primitive.
  for (const p of TX_PRIMITIVES) {
    const k = defaultTagForPrimitive(p);
    eq(isKnownTag(k), true, `default for ${p} is a known tag`);
    eq(isTagValidOnPrimitive(k, p), true, `default for ${p} is valid on ${p}`);
  }
  // Crucially: no primitive defaults to an income tag (never invent income).
  for (const p of TX_PRIMITIVES) {
    const d = getTagDefinition(defaultTagForPrimitive(p));
    eq(d?.createsIncome, false, `default for ${p} never creates income`);
  }

  console.log("crypto-classification-core self-tests: all passed");
}
