#!/usr/bin/env python3
"""
apply-l4-snapshot.py — Slice L4, the order_lines millilitre SNAPSHOT.

The completion (pickup) gate does not re-price an order; it re-reads the stored
order_lines. Weight, category and both 0217 classifications are snapshotted for
that reason. Volume was not, so placement and pickup would disagree about the
exact products this slice exists for.

This wires the snapshot end to end, mirroring the AN-1 unit_grams pattern:

  types.ts        OrderLineRow.unit_volume_ml (numeric may arrive as string)
                  NewOrderLineInput.unitVolumeMl
  orders-store.ts conditional write + a new rung on the missing-column ladder
  order-pricing.ts the completion gate reads it back into the LimitCartLine

Every edit asserts EXACTLY ONE anchor match and reads back from disk.
Idempotent: an already-applied edit reports SKIP.
"""

import sys

EDITS = [
    # -------------------------------------------------------- types.ts ---
    (
        "src/lib/orders/types.ts",
        "OrderLineRow.unit_volume_ml",
        """  unit_grams?: number | string | null;
  /**
   * SLICE 16 — sale-time snapshot of the low-THC beverage classification""",
        """  unit_grams?: number | string | null;
  /**
   * SLICE L4 — sale-time millilitres-per-unit snapshot (migration 0223).
   * Null/absent on legacy rows and on anything with no known volume, which the
   * gate then meters on the weight-carried basis. Postgres numeric may
   * deserialize as string; consumers normalize via
   * variant-grams-core.normalizeUnitGrams (a generic positive-numeric
   * coercion that applies no gram semantics).
   *
   * WHY SNAPSHOT: the pickup gate re-reads stored lines, and a 1.5 L bottle
   * has no parseable weight at all. Re-deriving would meter it at placement in
   * millilitres and at pickup on a 28 g category default — the two evaluations
   * would reach different verdicts about the same basket.
   */
  unit_volume_ml?: number | string | null;
  /**
   * SLICE 16 — sale-time snapshot of the low-THC beverage classification""",
    ),
    (
        "src/lib/orders/types.ts",
        "NewOrderLineInput.unitVolumeMl",
        """  /** AN-1 — grams one unit weighs (from the variant label; null = unknown). */
  unitGrams?: number | null;
  /** SLICE 16 — low-THC beverage classification snapshot (migration 0216;""",
        """  /** AN-1 — grams one unit weighs (from the variant label; null = unknown). */
  unitGrams?: number | null;
  /** SLICE L4 — millilitres one unit contains, snapshot (migration 0223).
   *  null = unknown → the gate keeps the weight-carried basis. */
  unitVolumeMl?: number | null;
  /** SLICE 16 — low-THC beverage classification snapshot (migration 0216;""",
    ),
    # --------------------------------------------------- orders-store.ts ---
    (
        "src/lib/orders/orders-store.ts",
        "orders-store write signature",
        """    withOtherwiseTaken: boolean,
  ) =>""",
        """    withOtherwiseTaken: boolean,
    withUnitVolumeMl: boolean,
  ) =>""",
    ),
    (
        "src/lib/orders/orders-store.ts",
        "orders-store unit_volume_ml write",
        """      ...(withUnitGrams && typeof l.unitGrams === "number" && l.unitGrams > 0
        ? { unit_grams: l.unitGrams }
        : {}),""",
        """      ...(withUnitGrams && typeof l.unitGrams === "number" && l.unitGrams > 0
        ? { unit_grams: l.unitGrams }
        : {}),
      // SLICE L4 — sale-time VOLUME snapshot (migration 0223); omitted when
      // unknown so those lines keep the weight-carried gate math. Without this
      // the pickup gate re-reads a 1.5 L bottle as a 28 g default and reaches
      // a different verdict than placement did on the same basket.
      ...(withUnitVolumeMl && typeof l.unitVolumeMl === "number" && l.unitVolumeMl > 0
        ? { unit_volume_ml: l.unitVolumeMl }
        : {}),""",
    ),
    # ---------------------------------------------------- order-pricing ---
    (
        "src/lib/orders/order-pricing.ts",
        "completion gate volume read-back",
        """    const grams = lineGramsFromUnit(normalizeUnitGrams(line.unit_grams), line.quantity);""",
        """    const grams = lineGramsFromUnit(normalizeUnitGrams(line.unit_grams), line.quantity);
    // SLICE L4: read back the placement-time VOLUME snapshot (migration 0223)
    // and meter the whole line in millilitres. normalizeUnitGrams is reused
    // deliberately — it is a generic "positive numeric or null" coercion that
    // also handles PostgREST returning numeric columns as strings, and it
    // applies NO gram semantics (see its use for unit_thc_mg below). Legacy
    // rows and unknown-volume items stay null, and the engine then uses the
    // weight-carried basis, exactly as it did before L4.
    const volumeMl = lineVolumeMl(normalizeUnitGrams(line.unit_volume_ml), line.quantity);""",
    ),
    (
        "src/lib/orders/order-pricing.ts",
        "completion gate volume on the limit line",
        """    limitLines.push({
      category,
      quantity: line.quantity,
      ...(grams !== null ? { grams } : {}),
      lowThcLiquid: lowThc,""",
        """    limitLines.push({
      category,
      quantity: line.quantity,
      ...(grams !== null ? { grams } : {}),
      ...(volumeMl !== null && volumeMl > 0 ? { volumeMl } : {}),
      lowThcLiquid: lowThc,""",
    ),
]

# The missing-column retry ladder gains a rung. Each existing call site takes
# one more argument; the new rung drops the 0223 column when it is absent.
LADDER = [
    (
        "src/lib/orders/orders-store.ts",
        "ladder call 1 (full row)",
        """    .insert(buildLineRows(true, true, true, true));
  if (linesError && isMissingColumnError(linesError)) {
    // SLICE 17 rung: drop the otherwise_taken snapshot (0217 unapplied).
    ({ error: linesError } = await admin
      .from("order_lines")
      .insert(buildLineRows(true, true, true, false)));
  }
  if (linesError && isMissingColumnError(linesError)) {
    ({ error: linesError } = await admin
      .from("order_lines")
      .insert(buildLineRows(true, true, false, false)));
  }
  if (linesError && isMissingColumnError(linesError)) {
    ({ error: linesError } = await admin
      .from("order_lines")
      .insert(buildLineRows(true, false, false, false)));
  }
  if (linesError && isMissingColumnError(linesError)) {
    ({ error: linesError } = await admin
      .from("order_lines")
      .insert(buildLineRows(false, false, false, false)));
  }""",
        """    .insert(buildLineRows(true, true, true, true, true));
  if (linesError && isMissingColumnError(linesError)) {
    // SLICE L4 rung: drop the unit_volume_ml snapshot (0223 unapplied). Placing
    // an order must never fail because the owner has not run a migration yet;
    // the gate simply falls back to the weight-carried basis for that line,
    // which for every ounce-labelled product is the identical verdict.
    ({ error: linesError } = await admin
      .from("order_lines")
      .insert(buildLineRows(true, true, true, true, false)));
  }
  if (linesError && isMissingColumnError(linesError)) {
    // SLICE 17 rung: drop the otherwise_taken snapshot (0217 unapplied).
    ({ error: linesError } = await admin
      .from("order_lines")
      .insert(buildLineRows(true, true, true, false, false)));
  }
  if (linesError && isMissingColumnError(linesError)) {
    ({ error: linesError } = await admin
      .from("order_lines")
      .insert(buildLineRows(true, true, false, false, false)));
  }
  if (linesError && isMissingColumnError(linesError)) {
    ({ error: linesError } = await admin
      .from("order_lines")
      .insert(buildLineRows(true, false, false, false, false)));
  }
  if (linesError && isMissingColumnError(linesError)) {
    ({ error: linesError } = await admin
      .from("order_lines")
      .insert(buildLineRows(false, false, false, false, false)));
  }""",
    ),
]


def apply(edits) -> bool:
    applied = skipped = 0
    for path, label, old, new in edits:
        with open(path, "r", encoding="utf-8") as fh:
            src = fh.read()
        if new in src:
            print(f"SKIP    {label}")
            skipped += 1
            continue
        count = src.count(old)
        if count != 1:
            print(f"FAIL    {label}: anchor matched {count} times in {path}")
            return False
        src = src.replace(old, new, 1)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(src)
        with open(path, "r", encoding="utf-8") as fh:
            if new not in fh.read():
                print(f"FAIL    {label}: disk read-back missing")
                return False
        print(f"APPLIED {label}")
        applied += 1
    print(f"  -> {applied} applied, {skipped} skipped")
    return True


if __name__ == "__main__":
    ok = apply(EDITS) and apply(LADDER)
    sys.exit(0 if ok else 1)
