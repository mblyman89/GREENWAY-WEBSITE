/**
 * src/lib/inventory/sample-intake-cap-core.ts
 *
 * H16b Samples Slice B — PURE decision core for the incoming trade-sample cap
 * hard block at manifest finalize (WAC 314-55-096(1)(f)(ii): a processor may
 * transfer no more than 120 sample units per quarter to a given retailer).
 *
 * This module holds ONLY the deterministic math so it can be unit-tested with no
 * database: given the manifest's sample lines (each already annotated with its
 * mapped product_type, its activation-gate verdict, and whether it was already
 * recorded), it computes how many NEW sample units this finalize would add, then
 * asks the shared evaluateCap() whether that must be blocked.
 *
 * The server helper (preflightManifestSampleCap in intake-store.ts) does the I/O
 * — read the manifest, its sample lots, the vendor's existing quarter usage, and
 * the owner settings — then delegates the verdict to this core so the pre-flight
 * and the Slice A ledger never disagree about what counts.
 */
import {
  evaluateCap,
  type SampleSettings,
  type SampleProductType,
} from "@/lib/compliance/trade-samples-core";

/** One sample line on a manifest, reduced to only what the cap math needs. */
export type IntakeSampleLine = {
  /** received quantity = the number of sample PACKAGES/units for this line. */
  receivedQty: number;
  /** true when the reviewer is refusing this line at the dock (never counted). */
  rejectedAtDock: boolean;
  /** activation-gate verdict: a dirty lot that CANNOT activate never counts. */
  canActivate: boolean;
  /** true when an incoming event already exists for this lot (idempotent). */
  alreadyRecorded: boolean;
  /**
   * product_type mapped from the LCB type + name (useable|concentrate|infused),
   * or null when the line is not a lawful cannabis sample product (accessory/
   * merch) and therefore is NOT recorded to the sample ledger.
   */
  productType: SampleProductType | null;
};

/** The addable-unit total this finalize would newly record for the processor. */
export function addableSampleUnits(lines: IntakeSampleLine[]): number {
  let units = 0;
  for (const line of lines) {
    if (line.rejectedAtDock) continue; // refused at dock → never received
    if (!line.canActivate) continue; // dirty lot held in quarantine → never live
    if (line.alreadyRecorded) continue; // counted in a prior finalize → no double
    if (!line.productType) continue; // not a lawful cannabis sample → skipped
    units += Math.max(1, Math.trunc(Number(line.receivedQty) || 0));
  }
  return units;
}

export type IntakeCapVerdict = {
  /** true only when the WHOLE finalize must be refused (block on the cap). */
  blocked: boolean;
  /** new sample units this finalize would add for the processor. */
  addUnits: number;
  /** processor's units already recorded this quarter (the running usage). */
  usedUnits: number;
  /** the cap in force (incoming units per quarter). */
  capUnits: number;
  /** explain-string surfaced to the reviewer when blocked (null otherwise). */
  message: string | null;
};

/**
 * Decide whether finalizing this manifest must be hard-blocked on the incoming
 * cap. Blocks ONLY when the projected units exceed the cap AND enforcement is on
 * (settings.enforce && settings.hardBlock) — warn-only mode never blocks, and a
 * manifest with zero addable sample units is never blocked.
 */
export function evaluateIntakeSampleCap(args: {
  lines: IntakeSampleLine[];
  usedUnits: number;
  settings: SampleSettings;
}): IntakeCapVerdict {
  const addUnits = addableSampleUnits(args.lines);
  if (addUnits === 0) {
    return {
      blocked: false,
      addUnits: 0,
      usedUnits: args.usedUnits,
      capUnits: args.settings.incomingUnitsPerQuarter,
      message: null,
    };
  }
  const evaln = evaluateCap({
    direction: "incoming",
    usedUnits: args.usedUnits,
    addUnits,
    settings: args.settings,
  });
  return {
    blocked: evaln.block,
    addUnits,
    usedUnits: args.usedUnits,
    capUnits: evaln.capUnits,
    message: evaln.block ? evaln.message : null,
  };
}

/* ------------------------------------------------------------------------- *
 * Self-test — runnable in CI via tests/compliance/sample-intake-cap.test.ts. *
 * ------------------------------------------------------------------------- */
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`sample-intake-cap-core self-test: ${msg}`);
}

export function __runSampleIntakeCapCoreTests(): void {
  const settings: SampleSettings = {
    enforce: true,
    hardBlock: true,
    incomingUnitsPerQuarter: 120,
    outgoingUnitsPerEmployee: 30,
    maxFlowerGrams: 3.5,
    maxConcentrateGrams: 1,
    maxInfusedMg: 100,
    maxThcMgPerServing: 10,
  };
  const line = (over: Partial<IntakeSampleLine> = {}): IntakeSampleLine => ({
    receivedQty: 1,
    rejectedAtDock: false,
    canActivate: true,
    alreadyRecorded: false,
    productType: "useable",
    ...over,
  });

  // addable units respects every skip rule
  assert(addableSampleUnits([line({ receivedQty: 5 })]) === 5, "clean line counts received qty");
  assert(addableSampleUnits([line({ rejectedAtDock: true, receivedQty: 5 })]) === 0, "refused skipped");
  assert(addableSampleUnits([line({ canActivate: false, receivedQty: 5 })]) === 0, "dirty/held skipped");
  assert(addableSampleUnits([line({ alreadyRecorded: true, receivedQty: 5 })]) === 0, "already-recorded skipped");
  assert(addableSampleUnits([line({ productType: null, receivedQty: 5 })]) === 0, "non-cannabis skipped");
  assert(addableSampleUnits([line({ receivedQty: 0 })]) === 1, "qty floored to at least 1 unit");
  assert(
    addableSampleUnits([line({ receivedQty: 3 }), line({ productType: "concentrate", receivedQty: 2 })]) === 5,
    "sums mixed product types",
  );

  // under cap → no block
  const under = evaluateIntakeSampleCap({ lines: [line({ receivedQty: 10 })], usedUnits: 100, settings });
  assert(!under.blocked && under.addUnits === 10, "100 + 10 = 110 under 120 → allowed");

  // exactly at cap → no block (120 is allowed; >120 is not)
  const atCap = evaluateIntakeSampleCap({ lines: [line({ receivedQty: 20 })], usedUnits: 100, settings });
  assert(!atCap.blocked && atCap.addUnits === 20, "100 + 20 = 120 exactly at cap → allowed");

  // over cap + enforce + hardBlock → BLOCK
  const over = evaluateIntakeSampleCap({ lines: [line({ receivedQty: 21 })], usedUnits: 100, settings });
  assert(over.blocked && over.addUnits === 21 && !!over.message, "100 + 21 = 121 over 120 → blocked with message");
  assert(/314-55-096/.test(over.message ?? ""), "block message cites WAC 314-55-096");

  // over cap but warn-only (hardBlock off) → no block
  const warn = evaluateIntakeSampleCap({
    lines: [line({ receivedQty: 21 })],
    usedUnits: 100,
    settings: { ...settings, hardBlock: false },
  });
  assert(!warn.blocked && warn.message === null, "warn-only over cap does not block");

  // over cap but enforcement off → no block
  const off = evaluateIntakeSampleCap({
    lines: [line({ receivedQty: 21 })],
    usedUnits: 100,
    settings: { ...settings, enforce: false },
  });
  assert(!off.blocked, "enforcement off over cap does not block");

  // zero addable units (all skipped) → never blocked even when way over
  const zero = evaluateIntakeSampleCap({
    lines: [line({ rejectedAtDock: true })],
    usedUnits: 999,
    settings,
  });
  assert(!zero.blocked && zero.addUnits === 0, "zero addable units never blocks");
}
