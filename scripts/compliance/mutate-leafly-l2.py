#!/usr/bin/env python3
"""SLICE L-2 mutation harness -- "test the tests".

The owner's instruction for this slice was "Test it, test the tests." A passing
suite proves the code does what the suite checks. It does not prove the suite
checks anything worth checking. Mutation testing is the only way to find that
out: make a plausible BAD EDIT, and if the suite still passes, the suite has a
hole exactly the size of that edit.

Every mutation below is a REAL regression that could plausibly be introduced by
a future edit -- in most cases it is literally one of the defects this slice
just repaired, put back. If the suite does not go red, the defect can return
unnoticed and the repair was temporary.

Three harness lessons from earlier slices are baked in on purpose:

1. NEVER pipe vitest into sed/grep to read its result. The pipeline's exit code
   becomes the LAST command's, which is always 0, so every failure reports as a
   pass and the harness cheerfully announces a perfect score.

2. Do the replacement in Python with plain string `.replace`, never `perl -e`.
   The sources contain regex literals full of `$`, `\\s` and `?` that perl's -e
   quoting mangles.

3. VERIFY THE MUTATION ACTUALLY CHANGED THE FILE before running the suite. A
   pattern that no longer matches (because the source was refactored) silently
   mutates nothing, the suite passes, and the harness scores it as CAUGHT --
   the single most dangerous failure mode a mutation harness has, because it
   inflates the score precisely when the harness has stopped working.

A fourth is added here: the harness ALSO verifies the suite is green BEFORE any
mutation is applied. Mutation results are meaningless if the baseline is red.
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

PAYLOAD = Path("src/lib/leafly/payload-core.ts")
VALIDATE = Path("src/lib/leafly/payload-validate-core.ts")
ORIGIN = Path("src/lib/orders/order-origin-core.ts")
SETTINGS = Path("src/lib/syndication/apply-settings-core.ts")
PREFLIGHT = Path("src/lib/syndication/preflight-core.ts")

# The suites that must notice. Kept as one vitest invocation because these
# modules are interdependent: the schema test exercises the builder, the toggle
# layer and our own validator at once, which is the point.
TESTS = [
    "tests/compliance/leafly-payload-schema.test.ts",
    "tests/compliance/order-origin.test.ts",
    "tests/compliance/leafly-contract.test.ts",
]

# The pure self-tests run separately because they throw rather than report, and
# several mutations below are designed to be caught by an embedded assertion
# rather than by a vitest file.
SELFTEST_ENTRY = "scripts/compliance/run-pure-selftests.ts"

# (file, name, from, to)
MUTATIONS = [
    # ---------------------------------------------------------------- payload
    # Each of these puts back one of the eight original field-name defects.
    (PAYLOAD, "L-04 returns: `strain` renamed back to `strainName`",
     "  out.strain = strain && strain.length > 0 ? strain : null;",
     "  (out as Record<string, unknown>).strainName = strain && strain.length > 0 ? strain : null;"),
    (PAYLOAD, "L-05 returns: `brand` emitted as null instead of omitted",
     "  if (brand && brand.length > 0) out.brand = brand;",
     "  out.brand = (brand && brand.length > 0 ? brand : null) as string;"),
    (PAYLOAD, "new defect returns: `description` emitted as null",
     "  if (description !== null) out.description = description;",
     "  out.description = description as string;"),
    (PAYLOAD, "L-03 returns: variant loses `amount`",
     "    amount: au.amount,\n    unit: au.unit,\n    inventoryLevel: variantInventoryLevel(v),",
     "    unit: au.unit,\n    inventoryLevel: variantInventoryLevel(v),"),
    (PAYLOAD, "L-12 returns: cartridge funnels to Concentrate again",
     '  cartridge: "Cartridge",', '  cartridge: "Concentrate",'),
    (PAYLOAD, 'L-12 returns: tincture emits the invented type "tincture"',
     '  tincture: "Edible",', '  tincture: "tincture" as LeaflyFunnelType,'),
    (PAYLOAD, "totals carry a `type` key again (v1-shaped drift)",
     "  return { content: compound.content, unit: compound.unit };",
     "  return { type: compound.type, content: compound.content, unit: compound.unit } as LeaflyTotalCompound;"),
    (PAYLOAD, "compounds attached even when Leafly ignores them for the type",
     "  const unit = compoundUnitForType(itemType);\n  if (unit === null) return null; // Leafly ignores compounds for this type",
     '  const unit = compoundUnitForType(itemType) ?? "percent";'),
    (PAYLOAD, "RULE 3 BREACH: a missing weight is invented as 1g",
     "  // Weight-only type (Flower) with no usable weight in the label.\n  return null;",
     '  return { amount: 1, unit: "g" };'),
    (PAYLOAD, "RULE 3 BREACH: milligrams silently converted on weight types",
     "    default:\n      return null; // mg, and anything else we do not trust",
     '    case "mg":\n      return { amount: weight.value / 1000, unit: "g" };\n    default:\n      return null;'),
    (PAYLOAD, "unreadable potency becomes 0 instead of null",
     "  if (!Number.isFinite(numeric)) return { type, content: null, unit };",
     "  if (!Number.isFinite(numeric)) return { type, content: 0, unit };"),
    (PAYLOAD, 'missing strain becomes the placeholder "NA"',
     "  out.strain = strain && strain.length > 0 ? strain : null;",
     '  out.strain = strain && strain.length > 0 ? strain : "NA";'),
    (PAYLOAD, "blank name passes through (violates minLength 1)",
     "  const name = item.name.trim();\n  if (name.length === 0) {",
     "  const name = item.name;\n  if (false) {"),
    (PAYLOAD, "name no longer trimmed",
     "  const name = item.name.trim();", "  const name = item.name;"),
    (PAYLOAD, "availableForPickup switched on by this slice (L-09 is L-3's call)",
     "  const out: LeaflyItem = {\n    id: item.id,\n    type,\n    name,\n    variants,\n  };",
     "  const out: LeaflyItem = {\n    id: item.id,\n    type,\n    name,\n    variants,\n    availableForPickup: true,\n  };"),
    (PAYLOAD, "an item with no legal variant is emitted anyway (minItems 1)",
     "  if (variants.length === 0) return { item: null, rejected };",
     "  if (false) return { item: null, rejected };"),
    (PAYLOAD, "rejections silently swallowed instead of reported",
     "    rejected.push(...result.rejected);", "    void result.rejected;"),
    (PAYLOAD, "imageUrl emitted untrimmed / when blank",
     '  if (typeof item.imageUrl === "string" && item.imageUrl.trim() !== "") {',
     '  if (typeof item.imageUrl === "string") {'),

    # --------------------------------------------------------------- validate
    # The validator is itself a safety net, so its own holes matter.
    (VALIDATE, "validator stops checking unknown keys",
     "  for (const key of Object.keys(obj)) {\n    if (known.has(key)) continue;",
     "  for (const key of Object.keys(obj)) {\n    if (true) continue;"),
    (VALIDATE, "validator downgrades forbidden aliases to warnings",
     '      c.error(\n        "forbidden_field_alias",', '      c.warn(\n        "forbidden_field_alias",'),
    (VALIDATE, "validator accepts any compound unit",
     "  if (!isLeaflyCompoundUnit(rec.unit)) {", "  if (false) {"),
    (VALIDATE, "validator stops cross-checking unit against item type",
     "  } else if (rec.unit !== expectedUnit) {", "  } else if (false) {"),
    (VALIDATE, "validator accepts an out-of-enum variant unit",
     "    if (!isLeaflyVariantUnit(rec.unit)) {", "    if (false) {"),
    (VALIDATE, "validator stops requiring the six variant fields",
     '  for (const key of ["id", "medical", "price", "amount", "unit", "inventoryLevel"]) {\n    if (!(key in rec)) {',
     '  for (const key of ["id", "medical", "price", "amount", "unit", "inventoryLevel"]) {\n    if (false) {'),
    (VALIDATE, "validator accepts a non-funnel item type",
     "  } else if (!isLeaflyFunnelType(itemType)) {", "  } else if (false) {"),
    (VALIDATE, "validator accepts null in a non-nullable field",
     '    if (rec[key] === null) {\n      c.error(\n        "item_null_in_non_nullable",',
     '    if (false) {\n      c.error(\n        "item_null_in_non_nullable",'),
    (VALIDATE, "validator accepts a placeholder strain",
     "      } else if (/^(na|n\\/a|none|unknown|null|n\\.a\\.)$/i.test(s)) {",
     "      } else if (false) {"),
    (VALIDATE, "validator accepts a zero price",
     "    } else if (rec.price < LEAFLY_PRICE_MIN_MINOR_UNITS) {", "    } else if (false) {"),
    (VALIDATE, "validator accepts a fractional (dollars-as-cents) price",
     "    } else if (!Number.isInteger(rec.price)) {", "    } else if (false) {"),
    (VALIDATE, "validator stops detecting duplicate variant ids",
     "    } else if (seenIds.has(rec.id)) {", "    } else if (false) {"),
    (VALIDATE, "validator stops detecting duplicate item ids",
     "          if (seenItemIds.has(id)) {", "          if (false) {"),
    (VALIDATE, "RULE 3 BREACH: validator repairs the payload instead of reporting",
     "    } else if (rec.price < LEAFLY_PRICE_MIN_MINOR_UNITS) {",
     "    } else if (((rec.price = Math.max(1, rec.price as number)), false)) {"),
    (VALIDATE, "ok flips true when errors exist (fail-open)",
     "    ok: errors.length === 0,", "    ok: true,"),
    (VALIDATE, "assert stops throwing on an invalid payload",
     "  if (!result.ok) throw new LeaflyPayloadInvalidError(result);",
     "  if (false) throw new LeaflyPayloadInvalidError(result);"),

    # --------------------------------------------------------------- settings
    (SETTINGS, "sendImages made a no-op again (the dead-toggle defect)",
     "    if (!toggles.sendImages) out.imageUrl = null;", "    void toggles.sendImages;"),
    (SETTINGS, "description nulled instead of omitted (illegal null)",
     "    // `description` is a non-nullable string in the schema -> omit the key.\n"
     "    if (!toggles.sendDescriptions) delete out.description;",
     "    // `description` is a non-nullable string in the schema -> omit the key.\n"
     "    if (!toggles.sendDescriptions) out.description = null as unknown as string;"),
    (SETTINGS, "totals nulled instead of omitted (illegal null)",
     "      delete out.total_thc;\n      delete out.total_cbd;",
     "      out.total_thc = null as never;\n      out.total_cbd = null as never;"),
    (SETTINGS, "strain omitted instead of nulled (loses the 'no strain' signal)",
     "    if (!toggles.sendStrains) out.strain = null;",
     "    if (!toggles.sendStrains) delete out.strain;"),
    (SETTINGS, "toggle layer mutates the caller's items",
     "    const out: LeaflyItem = { ...item };", "    const out: LeaflyItem = item;"),

    # -------------------------------------------------------------- preflight
    (PREFLIGHT, "leafly weight error downgraded to a warning",
     '          severity: "error",\n          code: "leafly_missing_weight",',
     '          severity: "warning",\n          code: "leafly_missing_weight",'),
    (PREFLIGHT, "leafly weight check fires on every type (unusable noise)",
     "        leaflyWeightIsMandatory(item.category) &&", "        true &&"),
    (PREFLIGHT, "leafly weight check never fires at all",
     "        leaflyWeightIsMandatory(item.category) &&", "        false &&"),
    (PREFLIGHT, "weight-mandatory logic inverted",
     '  return !(units as readonly string[]).includes("each");',
     '  return (units as readonly string[]).includes("each");'),

    # ----------------------------------------------------------------- origin
    (ORIGIN, "THE OWNER'S REQUEST BROKEN: both order types share one chime",
     '  leafly: "bell",', '  leafly: "chime",'),
    (ORIGIN, "a chime the Pi cannot synthesise (would 404 and fall back)",
     '  leafly: "bell",', '  leafly: "leafly-chime.wav",'),
    (ORIGIN, "a chime id with a slash (Pi treats it as a storage path)",
     '  leafly: "bell",', '  leafly: "sounds/bell",'),
    (ORIGIN, "resolveOriginSound can return an empty string",
     '  if (configured !== "") return configured;\n  return ORIGIN_DEFAULT_SOUND_IDS[input.origin];',
     "  return configured;"),
    (ORIGIN, "unknown origin throws instead of defaulting (loses the order)",
     "  return isOrderOrigin(trimmed) ? trimmed : DEFAULT_ORDER_ORIGIN;",
     "  if (!isOrderOrigin(trimmed)) throw new Error(`unknown origin ${trimmed}`);\n  return trimmed;"),
    (ORIGIN, "default origin becomes a marketplace (would suppress our email)",
     'export const DEFAULT_ORDER_ORIGIN: OrderOrigin = "greenway";',
     'export const DEFAULT_ORDER_ORIGIN: OrderOrigin = "leafly";'),
    (ORIGIN, "we start emailing Leafly's customers (marketplace breach)",
     "  return !isMarketplaceOrigin(origin);", "  return true;"),
    (ORIGIN, "staff stop being emailed about marketplace orders",
     "export function mayEmailStaffForOrigin(_origin: OrderOrigin): boolean {\n  return true;",
     "export function mayEmailStaffForOrigin(_origin: OrderOrigin): boolean {\n  return !isMarketplaceOrigin(_origin);"),
    (ORIGIN, "register sales start being announced (speaker cries wolf)",
     "export function shouldAnnounceOrigin(origin: OrderOrigin): boolean {\n  return isPickupOrigin(origin);",
     "export function shouldAnnounceOrigin(origin: OrderOrigin): boolean {\n  return true;"),
    (ORIGIN, "the announcement stops distinguishing Leafly",
     '  const lead = input.origin === "leafly" ? "New Leafly order" : "New online order";',
     '  const lead = "New online order";'),
    (ORIGIN, "two origins share one staff label",
     '    case "leafly":\n      return "Leafly";', '    case "leafly":\n      return "Website";'),
    (ORIGIN, "the receipt line stops naming Leafly",
     '      return "LEAFLY ORDER — placed on Leafly";', '      return "ONLINE ORDER";'),
    (ORIGIN, "the receipt line overflows a 42-column thermal receipt",
     '      return "LEAFLY ORDER — placed on Leafly";',
     '      return "LEAFLY MARKETPLACE ORDER — placed by the customer on Leafly.com";'),
    (ORIGIN, "isOrderOrigin becomes loose (accepts padded/uppercase)",
     '  return typeof value === "string" && (ORDER_ORIGINS as readonly string[]).includes(value);',
     '  return typeof value === "string" && (ORDER_ORIGINS as readonly string[]).includes(value.trim().toLowerCase());'),
]


def run(cmd: list[str]) -> int:
    """Run a command, return its exit code. Never piped -- see lesson 1."""
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        cwd=REPO,
        env={**os.environ, "NODE_OPTIONS": "--max-old-space-size=2500"},
    ).returncode


def suite_fails() -> bool:
    """True when ANY guard notices. Vitest first (cheap), self-tests second."""
    if run(["npx", "vitest", "run", *TESTS]) != 0:
        return True
    return run(["npx", "tsx", SELFTEST_ENTRY]) != 0


def main() -> int:
    files = {PAYLOAD, VALIDATE, ORIGIN, SETTINGS, PREFLIGHT}
    originals = {f: (REPO / f).read_text() for f in files}
    backups = {f: Path(f"/tmp/l2-mut-{f.name}.bak") for f in files}
    for f in files:
        shutil.copy(REPO / f, backups[f])

    print("=== SLICE L-2 mutation testing ===")
    print(f"    {len(MUTATIONS)} mutations across {len(files)} files\n")

    # Lesson 4: a mutation score is meaningless on a red baseline.
    print("--- baseline (must be GREEN before any mutation) ---")
    if suite_fails():
        print("  BASELINE IS RED -- aborting. Fix the suite before mutating it.")
        for f in files:
            (REPO / f).write_text(originals[f])
        return 1
    print("  baseline GREEN\n")

    caught = 0
    missed: list[str] = []
    harness_errors: list[str] = []

    try:
        for i, (path, name, frm, to) in enumerate(MUTATIONS, start=1):
            # Restore every file so mutations never stack.
            for f in files:
                (REPO / f).write_text(originals[f])

            src = originals[path]
            if frm not in src:
                # Lesson 3: this is an error, NOT a pass.
                print(f"  M{i:02d} HARNESS ERROR -- pattern not found: {name}")
                harness_errors.append(name)
                continue
            if src.count(frm) > 1:
                print(f"  M{i:02d} HARNESS ERROR -- pattern is ambiguous ({src.count(frm)}x): {name}")
                harness_errors.append(name)
                continue

            mutated = src.replace(frm, to, 1)
            if mutated == src:
                print(f"  M{i:02d} HARNESS ERROR -- mutation was a no-op: {name}")
                harness_errors.append(name)
                continue

            (REPO / path).write_text(mutated)

            if suite_fails():
                caught += 1
                print(f"  M{i:02d} CAUGHT   [{path.name}] {name}")
            else:
                print(f"  M{i:02d} *** SURVIVED *** [{path.name}] {name}")
                missed.append(f"[{path.name}] {name}")
    finally:
        for f in files:
            (REPO / f).write_text(originals[f])
        # Prove the restore worked -- a harness that corrupts the tree is worse
        # than no harness.
        for f in files:
            assert (REPO / f).read_text() == originals[f], f"RESTORE FAILED for {f}"
        print("\n  all sources restored byte-identical")

    total = len(MUTATIONS)
    print(f"\n=== L-2: {caught}/{total} caught, {len(missed)} survived, "
          f"{len(harness_errors)} harness error(s) ===")
    for m in missed:
        print(f"    SURVIVED: {m}")
    for h in harness_errors:
        print(f"    HARNESS ERROR: {h}")

    return 0 if (caught == total and not harness_errors) else 1


if __name__ == "__main__":
    sys.exit(main())
