/**
 * src/lib/crypto/crypto-classification-store-core.ts
 *
 * PURE shape + logic for the R1-B classification persistence layer. NO I/O, no
 * server-only imports — safe under tsx and vitest. The async Supabase readers /
 * writers live in ./crypto-classification-store and re-use these mappers and
 * builders so all the branchy logic is unit-tested here.
 *
 * Responsibilities (pure):
 *   1. Record types + DB row shapes for crypto_tx_classifications and
 *      crypto_classification_rules (migration 0163) + row→record mappers.
 *   2. buildClassificationUpsertRow — turn a validated (transaction, primitive,
 *      tag, note, source) into the exact DB row we upsert. Validates the tag
 *      against the R1-A vocabulary AND its validity on the primitive; refuses to
 *      build an invalid row (never store a nonsense classification).
 *   3. matchRuleToTransaction / firstMatchingRule — the rules-engine matcher:
 *      given the owner's active rules (already sorted by priority) and a
 *      transaction, return the tag a rule SUGGESTS (or null). Rules only ever
 *      suggest; an owner classification always wins (enforced in the store).
 */

import type { Chain, TxDirection, TxType } from "./crypto-core";
import type { CryptoTransactionRecord } from "./crypto-store-core";
import {
  isKnownTag,
  isTagValidOnPrimitive,
  mapDirectionToPrimitive,
  type TxPrimitive,
} from "./crypto-classification-core";

// ---------------------------------------------------------------------------
// Record types (camelCase app shape).
// ---------------------------------------------------------------------------

export type ClassificationSource = "owner" | "rule" | "default";

export interface CryptoTxClassificationRecord {
  id: string;
  transactionId: string;
  primitive: TxPrimitive;
  tagKey: string;
  note: string | null;
  autoSuggested: boolean;
  source: ClassificationSource;
  ruleId: string | null;
  classifiedBy: string | null;
  classifiedAt: string | null;
}

export interface CryptoClassificationRuleRecord {
  id: string;
  name: string;
  tagKey: string;
  matchChain: Chain | null;
  matchDirection: TxDirection | null;
  matchTxType: TxType | null;
  matchAssetId: string | null;
  matchCounterparty: string | null;
  priority: number;
  active: boolean;
}

// ---------------------------------------------------------------------------
// DB row shapes (snake_case, exactly as stored/read).
// ---------------------------------------------------------------------------

export interface ClassificationRow {
  id: string;
  transaction_id: string;
  primitive: string;
  tag_key: string;
  note: string | null;
  auto_suggested: boolean | null;
  source: string | null;
  rule_id: string | null;
  classified_by: string | null;
  classified_at: string | null;
}

export interface RuleRow {
  id: string;
  name: string;
  tag_key: string;
  match_chain: string | null;
  match_direction: string | null;
  match_tx_type: string | null;
  match_asset_id: string | null;
  match_counterparty: string | null;
  priority: number | null;
  active: boolean | null;
}

/** The exact upsert payload for crypto_tx_classifications. */
export interface ClassificationUpsertRow {
  transaction_id: string;
  primitive: TxPrimitive;
  tag_key: string;
  note: string | null;
  auto_suggested: boolean;
  source: ClassificationSource;
  rule_id: string | null;
  classified_by: string | null;
}

// ---------------------------------------------------------------------------
// Coercion helpers.
// ---------------------------------------------------------------------------

const PRIMITIVES = new Set<TxPrimitive>(["deposit", "withdrawal", "trade", "transfer"]);
const SOURCES = new Set<ClassificationSource>(["owner", "rule", "default"]);

function cleanText(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

function coercePrimitive(v: string | null | undefined): TxPrimitive {
  const t = (v ?? "").trim();
  return PRIMITIVES.has(t as TxPrimitive) ? (t as TxPrimitive) : "deposit";
}

function coerceSource(v: string | null | undefined): ClassificationSource {
  const t = (v ?? "").trim();
  return SOURCES.has(t as ClassificationSource) ? (t as ClassificationSource) : "owner";
}

// ---------------------------------------------------------------------------
// Row → record mappers.
// ---------------------------------------------------------------------------

export function toClassificationRecord(row: ClassificationRow): CryptoTxClassificationRecord {
  return {
    id: String(row.id),
    transactionId: String(row.transaction_id),
    primitive: coercePrimitive(row.primitive),
    tagKey: String(row.tag_key),
    note: cleanText(row.note),
    autoSuggested: row.auto_suggested === true,
    source: coerceSource(row.source),
    ruleId: cleanText(row.rule_id),
    classifiedBy: cleanText(row.classified_by),
    classifiedAt: cleanText(row.classified_at),
  };
}

export function toRuleRecord(row: RuleRow): CryptoClassificationRuleRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    tagKey: String(row.tag_key),
    matchChain: (cleanText(row.match_chain) as Chain | null),
    matchDirection: (cleanText(row.match_direction) as TxDirection | null),
    matchTxType: (cleanText(row.match_tx_type) as TxType | null),
    matchAssetId: cleanText(row.match_asset_id),
    matchCounterparty: cleanText(row.match_counterparty),
    priority: typeof row.priority === "number" ? row.priority : 100,
    active: row.active !== false,
  };
}

// ---------------------------------------------------------------------------
// buildClassificationUpsertRow — validated, never-nonsense row builder.
// Returns null (and never throws) when the tag is unknown or invalid on the
// primitive, so the caller can surface a clean error rather than store garbage.
// ---------------------------------------------------------------------------

export interface BuildClassificationInput {
  transactionId: string;
  primitive: TxPrimitive;
  tagKey: string;
  note?: string | null;
  source?: ClassificationSource;
  ruleId?: string | null;
  classifiedBy?: string | null;
  autoSuggested?: boolean;
}

export function buildClassificationUpsertRow(
  input: BuildClassificationInput,
): ClassificationUpsertRow | null {
  const transactionId = cleanText(input.transactionId);
  if (transactionId === null) return null;
  if (!PRIMITIVES.has(input.primitive)) return null;
  if (!isKnownTag(input.tagKey)) return null;
  if (!isTagValidOnPrimitive(input.tagKey, input.primitive)) return null;

  const source = coerceSource(input.source);
  return {
    transaction_id: transactionId,
    primitive: input.primitive,
    tag_key: input.tagKey,
    note: cleanText(input.note),
    auto_suggested: input.autoSuggested === true,
    source,
    rule_id: cleanText(input.ruleId),
    classified_by: cleanText(input.classifiedBy),
  };
}

// ---------------------------------------------------------------------------
// Rules engine matcher (pure).
// ---------------------------------------------------------------------------

/**
 * True if `rule` matches `tx`. Every provided (non-null) condition must match
 * (AND); a null condition means "don't care". Inactive rules never match.
 * Counterparty match is case-insensitive substring.
 */
export function matchRuleToTransaction(
  rule: CryptoClassificationRuleRecord,
  tx: CryptoTransactionRecord,
): boolean {
  if (!rule.active) return false;
  if (rule.matchChain !== null && rule.matchChain !== tx.chain) return false;
  if (rule.matchDirection !== null && rule.matchDirection !== tx.direction) return false;
  if (rule.matchTxType !== null && rule.matchTxType !== tx.txType) return false;
  if (rule.matchAssetId !== null && rule.matchAssetId !== tx.assetId) return false;
  if (rule.matchCounterparty !== null) {
    const cp = (tx.counterparty ?? "").toLowerCase();
    if (!cp.includes(rule.matchCounterparty.toLowerCase())) return false;
  }
  return true;
}

/**
 * Given rules (sorted ascending by priority) and a transaction, return the
 * first rule that both matches AND yields a tag valid on the transaction's
 * primitive — plus that primitive. Returns null when nothing applies. This
 * never stores anything; it produces a SUGGESTION the store may apply.
 */
export function firstMatchingRule(
  rulesSortedByPriority: readonly CryptoClassificationRuleRecord[],
  tx: CryptoTransactionRecord,
): { rule: CryptoClassificationRuleRecord; primitive: TxPrimitive } | null {
  const isSwap = tx.txType === "swap";
  const primitive = mapDirectionToPrimitive((tx.direction ?? "in") as TxDirection, isSwap);
  for (const rule of rulesSortedByPriority) {
    if (!matchRuleToTransaction(rule, tx)) continue;
    if (!isKnownTag(rule.tagKey)) continue;
    if (!isTagValidOnPrimitive(rule.tagKey, primitive)) continue;
    return { rule, primitive };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Self-tests (bare-call style; throws on failure, prints pass line).
// ---------------------------------------------------------------------------

function eq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `crypto-classification-store-core: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function makeTx(partial: Partial<CryptoTransactionRecord>): CryptoTransactionRecord {
  return {
    id: partial.id ?? "tx-1",
    walletId: partial.walletId ?? "w-1",
    assetId: partial.assetId ?? "a-1",
    chain: (partial.chain ?? "flare") as Chain,
    txHash: partial.txHash ?? "0xhash",
    eventIndex: partial.eventIndex ?? 0,
    direction: partial.direction ?? "in",
    txType: partial.txType ?? "other",
    amountRaw: partial.amountRaw ?? "1000",
    amountDecimal: partial.amountDecimal ?? null,
    decimalsAtEvent: partial.decimalsAtEvent ?? 18,
    feeRaw: partial.feeRaw ?? null,
    feeAssetId: partial.feeAssetId ?? null,
    usdValueCents: partial.usdValueCents ?? null,
    priceAsof: partial.priceAsof ?? null,
    counterparty: partial.counterparty ?? null,
    blockNumber: partial.blockNumber ?? null,
    blockTime: partial.blockTime ?? null,
    migrationId: partial.migrationId ?? null,
  };
}

function makeRule(partial: Partial<CryptoClassificationRuleRecord>): CryptoClassificationRuleRecord {
  return {
    id: partial.id ?? "r-1",
    name: partial.name ?? "rule",
    tagKey: partial.tagKey ?? "reward_ftso",
    matchChain: partial.matchChain ?? null,
    matchDirection: partial.matchDirection ?? null,
    matchTxType: partial.matchTxType ?? null,
    matchAssetId: partial.matchAssetId ?? null,
    matchCounterparty: partial.matchCounterparty ?? null,
    priority: partial.priority ?? 100,
    active: partial.active ?? true,
  };
}

export function __runCryptoClassificationStoreCoreTests(): void {
  // --- mappers ---
  const cRec = toClassificationRecord({
    id: "c1",
    transaction_id: "tx1",
    primitive: "deposit",
    tag_key: "reward_ftso",
    note: "  epoch reward ",
    auto_suggested: true,
    source: "rule",
    rule_id: "r9",
    classified_by: "u1",
    classified_at: "2026-01-02T00:00:00Z",
  });
  eq(cRec.primitive, "deposit", "classification primitive mapped");
  eq(cRec.tagKey, "reward_ftso", "classification tag mapped");
  eq(cRec.note, "epoch reward", "note trimmed");
  eq(cRec.autoSuggested, true, "auto_suggested mapped");
  eq(cRec.source, "rule", "source mapped");
  // unknown source / bad primitive coerce to safe defaults
  const cBad = toClassificationRecord({
    id: "c2",
    transaction_id: "tx2",
    primitive: "nonsense",
    tag_key: "sell",
    note: "   ",
    auto_suggested: null,
    source: "weird",
    rule_id: null,
    classified_by: null,
    classified_at: null,
  });
  eq(cBad.primitive, "deposit", "bad primitive -> deposit default");
  eq(cBad.source, "owner", "bad source -> owner default");
  eq(cBad.note, null, "whitespace note -> null");
  eq(cBad.autoSuggested, false, "null auto_suggested -> false");

  const rRec = toRuleRecord({
    id: "r1",
    name: "FTSO income",
    tag_key: "reward_ftso",
    match_chain: "flare",
    match_direction: "in",
    match_tx_type: "reward",
    match_asset_id: null,
    match_counterparty: "  0xABC ",
    priority: 5,
    active: null,
  });
  eq(rRec.matchChain, "flare", "rule chain mapped");
  eq(rRec.matchCounterparty, "0xABC", "rule counterparty trimmed");
  eq(rRec.active, true, "null active -> true");
  eq(rRec.priority, 5, "priority mapped");

  // --- buildClassificationUpsertRow ---
  const good = buildClassificationUpsertRow({
    transactionId: "tx1",
    primitive: "deposit",
    tagKey: "reward_ftso",
    note: "  hi ",
    source: "owner",
    classifiedBy: "u1",
    autoSuggested: false,
  });
  eq(good !== null, true, "valid row built");
  eq(good?.tag_key, "reward_ftso", "row tag");
  eq(good?.note, "hi", "row note trimmed");
  eq(good?.source, "owner", "row source");
  // unknown tag -> null
  eq(buildClassificationUpsertRow({ transactionId: "t", primitive: "deposit", tagKey: "nope" }), null, "unknown tag -> null");
  // tag invalid on primitive (gift_sent on a deposit) -> null
  eq(
    buildClassificationUpsertRow({ transactionId: "t", primitive: "deposit", tagKey: "gift_sent" }),
    null,
    "invalid tag/primitive -> null",
  );
  // empty transaction id -> null
  eq(
    buildClassificationUpsertRow({ transactionId: "   ", primitive: "deposit", tagKey: "buy" }),
    null,
    "empty tx id -> null",
  );

  // --- rule matching ---
  const ruleFlareRewardIn = makeRule({
    id: "rA",
    tagKey: "reward_ftso",
    matchChain: "flare",
    matchDirection: "in",
    matchTxType: "reward",
  });
  const ftsoTx = makeTx({ chain: "flare", direction: "in", txType: "reward" });
  eq(matchRuleToTransaction(ruleFlareRewardIn, ftsoTx), true, "rule matches FTSO reward");
  // wrong chain
  eq(
    matchRuleToTransaction(ruleFlareRewardIn, makeTx({ chain: "songbird", direction: "in", txType: "reward" })),
    false,
    "wrong chain no match",
  );
  // inactive never matches
  eq(matchRuleToTransaction(makeRule({ active: false, matchChain: "flare" }), ftsoTx), false, "inactive no match");
  // counterparty substring, case-insensitive
  const cpRule = makeRule({ tagKey: "sell", matchDirection: "out", matchCounterparty: "0xDEAD" });
  const cpTx = makeTx({ direction: "out", counterparty: "0xdeadBEEF" });
  eq(matchRuleToTransaction(cpRule, cpTx), true, "counterparty substring matches ci");
  eq(matchRuleToTransaction(cpRule, makeTx({ direction: "out", counterparty: "0xfeed" })), false, "counterparty no match");

  // --- firstMatchingRule: priority order + primitive validity ---
  const rules = [
    makeRule({ id: "hi", priority: 1, tagKey: "reward_staking", matchChain: "flare", matchDirection: "in" }),
    makeRule({ id: "lo", priority: 50, tagKey: "reward_ftso", matchChain: "flare", matchDirection: "in" }),
  ];
  const m = firstMatchingRule(rules, makeTx({ chain: "flare", direction: "in", txType: "reward" }));
  eq(m?.rule.id, "hi", "lowest priority number wins");
  eq(m?.primitive, "deposit", "in => deposit primitive");
  // a rule whose tag is invalid on the primitive is skipped
  const badPrimRule = [makeRule({ id: "x", tagKey: "gift_sent", matchDirection: "in" })];
  eq(firstMatchingRule(badPrimRule, makeTx({ direction: "in" })), null, "invalid tag on primitive skipped");
  // swap tx => trade primitive; a trade-valid rule applies
  const swapRules = [makeRule({ id: "sw", tagKey: "trade", matchTxType: "swap" })];
  const swapM = firstMatchingRule(swapRules, makeTx({ txType: "swap", direction: "in" }));
  eq(swapM?.primitive, "trade", "swap => trade primitive");
  eq(swapM?.rule.id, "sw", "swap rule applies");
  // no rules => null
  eq(firstMatchingRule([], ftsoTx), null, "no rules -> null");

  console.log("crypto-classification-store-core self-tests: all passed");
}
