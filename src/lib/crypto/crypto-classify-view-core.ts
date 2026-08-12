/**
 * src/lib/crypto/crypto-classify-view-core.ts
 *
 * PURE view-model for the R1-E "Classify" screen. NO I/O, no server-only
 * imports — safe under tsx and vitest. Turns raw transactions + their stored
 * classifications into ready-to-render rows so the page/component contain no
 * business logic (and the logic is fully unit-tested here).
 *
 * For each transaction it computes:
 *   - the PRIMITIVE (deposit/withdrawal/trade/transfer) from the stored
 *     direction + swap flag (R1-A mapDirectionToPrimitive),
 *   - the EFFECTIVE tag: the owner's stored tag if present, otherwise the
 *     conservative default (R1-A defaultTagForPrimitive) which never invents
 *     income — flagged as `isClassified` so the UI can show "needs review",
 *   - the plain-English tax note for that tag,
 *   - the set of VALID tag options for the row's primitive (so the dropdown
 *     only ever offers sensible choices),
 *   - a display-friendly amount/label bundle the caller passes through.
 *
 * It also summarizes progress ("42 of 130 classified") so Michael can see how
 * much review is left.
 */

import {
  getTagDefinition,
  tagsForPrimitive,
  defaultTagForPrimitive,
  mapDirectionToPrimitive,
  type TxPrimitive,
  type TagDefinition,
} from "./crypto-classification-core";
import { splitDisplayAmount } from "./crypto-ui-core";

export type ClassifyDirection = "in" | "out" | "self" | null;

/** The minimal transaction shape the classify view needs. */
export interface ClassifyTxInput {
  id: string;
  assetId: string | null;
  direction: ClassifyDirection;
  isSwap: boolean;
  /** Pre-formatted human amount ("1.5"), from the caller. */
  amountDisplay: string;
  /** Pre-formatted asset symbol/label, from the caller. */
  assetLabel: string;
  /** Pre-formatted date/time string, from the caller (or ""). */
  whenDisplay: string;
  /** Short/full tx hash for reference, from the caller. */
  txRef: string;
}

/** A tag option offered in the row's dropdown. */
export interface TagOption {
  key: string;
  label: string;
  note: string;
}

/** A fully-resolved row ready to render. */
export interface ClassifyRow {
  txId: string;
  primitive: TxPrimitive;
  primitiveLabel: string;
  amountDisplay: string;
  /** Compact amount for the cell (<= 4 decimals, TRUNCATED never rounded). */
  amountShort: string;
  /** Full exact amount for the hover tooltip. */
  amountFull: string;
  /** True when amountShort dropped digits => UI shows the full-precision tooltip. */
  amountTruncated: boolean;
  assetLabel: string;
  whenDisplay: string;
  txRef: string;
  /** The tag currently in effect (owner's, or the conservative default). */
  effectiveTagKey: string;
  effectiveTagLabel: string;
  /** Plain-English "what this means for your taxes" for the effective tag. */
  taxNote: string;
  /** True only when the OWNER has explicitly classified this row. */
  isClassified: boolean;
  /** Valid tag choices for this row's primitive. */
  options: TagOption[];
}

export interface ClassifyView {
  rows: ClassifyRow[];
  total: number;
  classifiedCount: number;
  unclassifiedCount: number;
  progressText: string;
}

const PRIMITIVE_LABEL: Record<TxPrimitive, string> = {
  deposit: "Received",
  withdrawal: "Sent",
  trade: "Trade / swap",
  transfer: "Wallet transfer",
};

/** Plain-English label for a primitive (for the row's "type" column). */
export function primitiveLabel(primitive: TxPrimitive): string {
  return PRIMITIVE_LABEL[primitive];
}

function toOptions(primitive: TxPrimitive): TagOption[] {
  return tagsForPrimitive(primitive).map((d: TagDefinition) => ({
    key: d.key,
    label: d.label,
    note: d.plainNote,
  }));
}

/**
 * Build the classify view. `classifiedByTxId` maps a transaction id to the
 * owner's stored tag key (present only for rows the owner actually classified).
 * A stored tag that is somehow invalid for the row's primitive is ignored (we
 * fall back to the default) so the screen never shows a nonsensical pairing.
 */
export function buildClassifyView(
  txs: readonly ClassifyTxInput[],
  classifiedByTxId: ReadonlyMap<string, string>,
): ClassifyView {
  const rows: ClassifyRow[] = [];
  let classified = 0;

  for (const tx of txs) {
    const primitive = mapDirectionToPrimitive((tx.direction ?? "in") as "in" | "out" | "self", tx.isSwap);
    const options = toOptions(primitive);
    const validKeys = new Set(options.map((o) => o.key));

    const ownerTag = classifiedByTxId.get(tx.id);
    const ownerValid = ownerTag != null && validKeys.has(ownerTag);
    const effectiveTagKey = ownerValid ? (ownerTag as string) : defaultTagForPrimitive(primitive);
    const def = getTagDefinition(effectiveTagKey);
    const isClassified = ownerValid;
    if (isClassified) classified += 1;

    const amountParts = splitDisplayAmount(tx.amountDisplay, 4);
    rows.push({
      txId: tx.id,
      primitive,
      primitiveLabel: PRIMITIVE_LABEL[primitive],
      amountDisplay: tx.amountDisplay,
      amountShort: amountParts.short,
      amountFull: amountParts.full,
      amountTruncated: amountParts.isTruncated,
      assetLabel: tx.assetLabel,
      whenDisplay: tx.whenDisplay,
      txRef: tx.txRef,
      effectiveTagKey,
      effectiveTagLabel: def ? def.label : effectiveTagKey,
      taxNote: def ? def.plainNote : "",
      isClassified,
      options,
    });
  }

  const total = rows.length;
  const unclassified = total - classified;
  const progressText =
    total === 0
      ? "No transactions to classify yet."
      : `${classified} of ${total} classified${unclassified > 0 ? ` — ${unclassified} need review` : " — all done"}`;

  return {
    rows,
    total,
    classifiedCount: classified,
    unclassifiedCount: unclassified,
    progressText,
  };
}

// ---------------------------------------------------------------------------
// Self-tests (bare-call style; throws on failure, prints pass line).
// ---------------------------------------------------------------------------

function eq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `crypto-classify-view-core: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function makeTx(p: Partial<ClassifyTxInput>): ClassifyTxInput {
  return {
    id: p.id ?? "tx",
    assetId: p.assetId ?? "a",
    direction: p.direction ?? "in",
    isSwap: p.isSwap ?? false,
    amountDisplay: p.amountDisplay ?? "1",
    assetLabel: p.assetLabel ?? "FLR",
    whenDisplay: p.whenDisplay ?? "2026-01-01",
    txRef: p.txRef ?? "0xabc",
  };
}

export function __runCryptoClassifyViewCoreTests(): void {
  eq(primitiveLabel("deposit"), "Received", "deposit label");
  eq(primitiveLabel("transfer"), "Wallet transfer", "transfer label");

  // Unclassified deposit -> conservative default "buy" (never income), flagged.
  const v1 = buildClassifyView([makeTx({ id: "t1", direction: "in" })], new Map());
  eq(v1.rows.length, 1, "one row");
  eq(v1.rows[0].primitive, "deposit", "in -> deposit");
  eq(v1.rows[0].effectiveTagKey, "buy", "default deposit tag = buy");
  eq(v1.rows[0].isClassified, false, "not owner-classified");
  eq(v1.classifiedCount, 0, "0 classified");
  eq(v1.progressText.includes("need review"), true, "progress mentions review");
  // options for a deposit include buy + reward tags, exclude gift_sent
  const depKeys = v1.rows[0].options.map((o) => o.key);
  eq(depKeys.includes("buy"), true, "deposit offers buy");
  eq(depKeys.includes("reward_ftso"), true, "deposit offers FTSO reward");
  eq(depKeys.includes("gift_sent"), false, "deposit does NOT offer gift sent");

  // Amount split: long-decimal amounts get a 4-dp cell + full-precision tooltip.
  const vAmt = buildClassifyView(
    [makeTx({ id: "amt", amountDisplay: "123.123456789" })],
    new Map(),
  );
  eq(vAmt.rows[0].amountShort, "123.1234", "classify amount short 4 dp");
  eq(vAmt.rows[0].amountFull, "123.123456789", "classify amount full exact");
  eq(vAmt.rows[0].amountTruncated, true, "classify amount truncated flag");
  const vAmt2 = buildClassifyView([makeTx({ id: "amt2", amountDisplay: "1.5" })], new Map());
  eq(vAmt2.rows[0].amountTruncated, false, "classify short amount not truncated");

  // Owner-classified row uses the owner's tag + its note + counts as classified.
  const v2 = buildClassifyView(
    [makeTx({ id: "t2", direction: "in" })],
    new Map([["t2", "reward_ftso"]]),
  );
  eq(v2.rows[0].effectiveTagKey, "reward_ftso", "owner tag wins");
  eq(v2.rows[0].isClassified, true, "counts as classified");
  eq(v2.rows[0].effectiveTagLabel, "FTSO / delegation reward", "owner tag label");
  eq(v2.rows[0].taxNote.length > 10, true, "owner tag has note");
  eq(v2.classifiedCount, 1, "1 classified");
  eq(v2.progressText.includes("all done"), true, "all done when fully classified");

  // A stored tag invalid for the primitive is ignored -> falls back to default.
  const v3 = buildClassifyView(
    [makeTx({ id: "t3", direction: "in" })],
    new Map([["t3", "gift_sent"]]), // gift_sent isn't valid on a deposit
  );
  eq(v3.rows[0].effectiveTagKey, "buy", "invalid stored tag ignored -> default");
  eq(v3.rows[0].isClassified, false, "invalid stored tag not counted as classified");

  // Swap -> trade primitive; withdrawal default = sell; transfer default = transfer.
  const v4 = buildClassifyView(
    [
      makeTx({ id: "s", direction: "in", isSwap: true }),
      makeTx({ id: "o", direction: "out" }),
      makeTx({ id: "self", direction: "self" }),
    ],
    new Map(),
  );
  eq(v4.rows[0].primitive, "trade", "swap -> trade");
  eq(v4.rows[0].effectiveTagKey, "trade", "trade default");
  eq(v4.rows[1].effectiveTagKey, "sell", "withdrawal default = sell");
  eq(v4.rows[2].effectiveTagKey, "transfer", "self -> transfer default");

  // Empty input -> friendly progress.
  const v5 = buildClassifyView([], new Map());
  eq(v5.total, 0, "no rows");
  eq(v5.progressText, "No transactions to classify yet.", "empty progress text");

  console.log("crypto-classify-view-core self-tests: all passed");
}
