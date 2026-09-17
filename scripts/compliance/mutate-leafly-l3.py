#!/usr/bin/env python3
"""SLICE L-3 mutation harness -- "test the tests".

L-3 is the slice that decides whether a stranger on the internet can place a
real order, and whether a product is labelled medical at a store with no
medical endorsement. Both of those are compliance decisions, so a green suite
is not sufficient evidence. The question this harness answers is the harder
one: if somebody broke a gate, WOULD THE SUITE NOTICE?

Every mutation below is a real, plausible regression. Most are the exact
failure this slice exists to prevent, deliberately reintroduced:

  * orderability that no longer fails closed
  * a DOH High-THC product becoming orderable (statutory -- WAC 246-70)
  * `medical: true` at an unendorsed store (the L-11 defect, restored)
  * `availableForPickup` omitted, leaving a sold-out item orderable
  * the DOH category silently dropped at the syndication boundary
  * the ordering toggle defaulting ON

The four harness lessons carried from L-2 are kept verbatim, because each one
was learned by being burned:

1. NEVER pipe vitest into sed/grep to read its result -- the pipeline's exit
   code becomes the last command's, so every failure reports as a pass.
2. Do the replacement in Python with plain `.replace`, never `perl -e`.
3. VERIFY THE MUTATION ACTUALLY CHANGED THE FILE. A pattern that no longer
   matches mutates nothing, the suite passes, and the harness scores it CAUGHT
   -- inflating the score exactly when the harness has stopped working.
4. Verify the baseline is GREEN before mutating. Mutation results are
   meaningless on a red baseline.

A fifth is added here: ambiguity is an ERROR, not a coin flip. If a pattern
appears more than once the harness refuses rather than mutating an arbitrary
occurrence.
"""
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

ORDERABILITY = Path("src/lib/leafly/orderability-core.ts")
PAYLOAD = Path("src/lib/leafly/payload-core.ts")
FEED = Path("src/lib/syndication/menu-feed-core.ts")
SETTINGS = Path("src/lib/syndication/sync-settings-core.ts")

# The vitest files that must notice. Kept as one invocation because the modules
# are interdependent -- the schema test exercises the builder and the gates at
# once, which is exactly the integration we care about.
TESTS = [
    "tests/compliance/leafly-payload-schema.test.ts",
    "tests/compliance/leafly-contract.test.ts",
    "tests/compliance/leafly-orderability.test.ts",
]

# The pure self-tests run separately because they THROW rather than report, and
# several mutations below are designed to be caught by an embedded assertion.
SELFTEST_ENTRY = "scripts/compliance/run-pure-selftests.ts"

# (file, name, from, to)
MUTATIONS = [
    # ------------------------------------------------------ orderability core
    # The fail-closed direction is the whole safety property. Each of these
    # flips one condition to the permissive side.
    (ORDERABILITY, "orderability ignores the owner's ordering toggle",
     "  if (!input.pickupEnabled) {\n    return { availableForPickup: false, reason: \"pickup_disabled\" };\n  }",
     "  if (false) {\n    return { availableForPickup: false, reason: \"pickup_disabled\" };\n  }"),
    (ORDERABILITY, "STATUTORY: high_thc becomes orderable (WAC 246-70 hard gate removed)",
     "  if (isDohCategoryBlockedFromPickup(input.dohCategory)) {\n    return { availableForPickup: false, reason: \"doh_restricted\" };\n  }",
     "  if (false) {\n    return { availableForPickup: false, reason: \"doh_restricted\" };\n  }"),
    (ORDERABILITY, "out-of-stock items become orderable",
     "  if (!input.inStock) {\n    return { availableForPickup: false, reason: \"out_of_stock\" };\n  }",
     "  if (false) {\n    return { availableForPickup: false, reason: \"out_of_stock\" };\n  }"),
    (ORDERABILITY, "an orderable item silently carries a refusal reason (report corruption)",
     "  return { availableForPickup: true, reason: null };",
     '  return { availableForPickup: true, reason: "out_of_stock" };'),
    (ORDERABILITY, "the DOH pickup-block table is silently emptied",
     'export const DOH_CATEGORIES_BLOCKED_FROM_PICKUP: readonly DohCategory[] = ["high_thc"] as const;',
     "export const DOH_CATEGORIES_BLOCKED_FROM_PICKUP: readonly DohCategory[] = [] as const;"),
    (ORDERABILITY, "the block table blocks the WRONG category (general_use instead of high_thc)",
     'export const DOH_CATEGORIES_BLOCKED_FROM_PICKUP: readonly DohCategory[] = ["high_thc"] as const;',
     'export const DOH_CATEGORIES_BLOCKED_FROM_PICKUP: readonly DohCategory[] = ["general_use"] as const;'),
    (ORDERABILITY, "blocked-category check inverted",
     "  return DOH_CATEGORIES_BLOCKED_FROM_PICKUP.includes(category);",
     "  return !DOH_CATEGORIES_BLOCKED_FROM_PICKUP.includes(category);"),
    (ORDERABILITY, "an unknown DOH category is treated as blocked (would block the whole menu)",
     "  if (!category || !isDohCategory(category)) return false;",
     "  if (!category || !isDohCategory(category)) return true;"),
    # ---- the medical endorsement gate (L-11) ----
    (ORDERABILITY, "L-11 RETURNS: medical no longer requires an endorsement",
     "  if (!input.endorsed) return false;",
     "  if (false) return false;"),
    (ORDERABILITY, "medical no longer requires a verified DOH category",
     "  const c = input.dohCategory;\n  return !!c && isDohCategory(c);",
     "  return true;"),
    (ORDERABILITY, "medical returns TRUE when called with no input at all",
     "  if (!input) return false;",
     "  if (!input) return true;"),
    (ORDERABILITY, "medical accepts a junk category string",
     "  return !!c && isDohCategory(c);",
     "  return !!c;"),

    # --------------------------------------------------------- payload mapper
    (PAYLOAD, "L-09 REGRESSES: availableForPickup is no longer emitted at all",
     "  out.availableForPickup = decideOrderability({",
     "  void decideOrderability({"),
    (PAYLOAD, "availableForPickup omitted when false (leaves sold-out items orderable)",
     "  out.availableForPickup = decideOrderability({\n    inStock: item.inStock,\n    dohCategory: item.dohCategory ?? null,\n    pickupEnabled: opts?.pickupEnabled === true,\n  }).availableForPickup;",
     "  const _ap = decideOrderability({\n    inStock: item.inStock,\n    dohCategory: item.dohCategory ?? null,\n    pickupEnabled: opts?.pickupEnabled === true,\n  }).availableForPickup;\n  if (_ap) out.availableForPickup = _ap;"),
    (PAYLOAD, "availableForPickup hardcoded TRUE (bypasses every gate)",
     "  out.availableForPickup = decideOrderability({\n    inStock: item.inStock,\n    dohCategory: item.dohCategory ?? null,\n    pickupEnabled: opts?.pickupEnabled === true,\n  }).availableForPickup;",
     "  out.availableForPickup = true;"),
    (PAYLOAD, "the mapper stops passing the DOH category to the gate",
     "    dohCategory: item.dohCategory ?? null,\n    pickupEnabled: opts?.pickupEnabled === true,",
     "    dohCategory: null,\n    pickupEnabled: opts?.pickupEnabled === true,"),
    (PAYLOAD, "the mapper stops passing real stock state to the gate",
     "  out.availableForPickup = decideOrderability({\n    inStock: item.inStock,",
     "  out.availableForPickup = decideOrderability({\n    inStock: true,"),
    (PAYLOAD, "the ordering toggle defaults ON in the mapper",
     "    pickupEnabled: opts?.pickupEnabled === true,\n  }).availableForPickup;",
     "    pickupEnabled: opts?.pickupEnabled !== false,\n  }).availableForPickup;"),
    (PAYLOAD, "the endorsement is assumed true when building variants",
     "    endorsed: opts?.medicallyEndorsed === true,",
     "    endorsed: true,"),
    (PAYLOAD, "the product's DOH category is dropped on the way to the medical gate",
     "  const medical: VariantMedicalInput = {\n    endorsed: opts?.medicallyEndorsed === true,\n    dohCategory: item.dohCategory ?? null,\n  };",
     "  const medical: VariantMedicalInput = {\n    endorsed: opts?.medicallyEndorsed === true,\n    dohCategory: \"general_use\",\n  };"),
    (PAYLOAD, "variantMedicalFlag bypasses the gate and hardcodes true",
     "export function variantMedicalFlag(input?: VariantMedicalInput): boolean {\n  return resolveVariantMedical(input);\n}",
     "export function variantMedicalFlag(_input?: VariantMedicalInput): boolean {\n  return true;\n}"),
    (PAYLOAD, "the synthesized default variant skips the medical gate",
     "    medical: variantMedicalFlag(medical),\n    price: Math.round(item.priceMinorUnits),",
     "    medical: true,\n    price: Math.round(item.priceMinorUnits),"),
    (PAYLOAD, "builder drops the options so every gate silently reverts to default",
     "    const result = toLeaflyItemResult(item, opts);",
     "    const result = toLeaflyItemResult(item);"),

    # ------------------------------------------------ syndication feed mapper
    (FEED, "the DOH category is dropped at the syndication boundary",
     "    ...(item.doh_category ? { dohCategory: item.doh_category } : {}),",
     "    ...(false ? { dohCategory: item.doh_category } : {}),"),
    (FEED, "every syndicated product is stamped with an invented DOH category",
     "    ...(item.doh_category ? { dohCategory: item.doh_category } : {}),",
     '    dohCategory: item.doh_category ?? "general_use",'),

    # ------------------------------------------------------- owner's settings
    (SETTINGS, "ordering defaults ON (public can order the moment this merges)",
     "  sendPickupAvailability: false,",
     "  sendPickupAvailability: true,"),
    (SETTINGS, "the ordering toggle can never be turned on",
     '    sendPickupAvailability: asBool(r["sendPickupAvailability"], d.sendPickupAvailability),',
     "    sendPickupAvailability: false,"),
    (SETTINGS, "the ordering toggle can never be turned OFF once on",
     '    sendPickupAvailability: asBool(r["sendPickupAvailability"], d.sendPickupAvailability),',
     "    sendPickupAvailability: true,"),
    (SETTINGS, "L-10 tail regresses: images default off again",
     "  sendImages: true,\n  sendStrains: true,\n  forceResend: false,\n  syncMode: \"post\",",
     "  sendImages: false,\n  sendStrains: true,\n  forceResend: false,\n  syncMode: \"post\","),

    # ------------------------------------- the owner-facing ordering summary
    # A correct gate the owner cannot see is half a fix. If this summary lies,
    # the statutory High-THC block looks like a bug, and the pressure will be to
    # "fix" the thing that is actually protecting him. So the explanation is
    # held to the same standard as the wire.
    (ORDERABILITY, "the summary counts a blocked item as orderable (over-reports)",
     "    if (decision.availableForPickup) {\n      orderable += 1;\n      continue;\n    }",
     "    if (true) {\n      orderable += 1;\n      continue;\n    }"),
    (ORDERABILITY, "the summary never counts anything as orderable (under-reports)",
     "    if (decision.availableForPickup) {\n      orderable += 1;\n      continue;\n    }",
     "    if (decision.availableForPickup) {\n      continue;\n    }"),
    (ORDERABILITY, "the summary silently drops blocked items (totals stop reconciling)",
     "    const bucket = groups.get(decision.reason) ?? { count: 0, examples: [] };\n    bucket.count += 1;",
     "    const bucket = groups.get(decision.reason) ?? { count: 0, examples: [] };"),
    (ORDERABILITY, "the summary ignores the owner's ordering toggle (shows orderable when it is off)",
     "      pickupEnabled: opts.pickupEnabled === true,",
     "      pickupEnabled: true,"),
    (ORDERABILITY, "the summary stops naming the blocked products (count with no evidence)",
     "      bucket.examples.push(name !== \"\" ? name : item.id);",
     "      bucket.examples.push(\"\");"),
    (ORDERABILITY, "the example cap is removed (a 400-item menu floods the admin page)",
     "    if (bucket.examples.length < ORDERABILITY_SUMMARY_EXAMPLE_LIMIT) {",
     "    if (true) {"),
    (ORDERABILITY, "the summary reports a raw enum code instead of a human sentence",
     "      label: orderabilityReasonLabel(reason),",
     "      label: reason,"),
    # NOTE: a `Math.random()` shuffle was considered here and REJECTED. With two
    # groups it is a coin flip, so it would be caught only ~50% of the time and
    # the harness score would change between runs. A harness that reports a
    # different number each run cannot be used as evidence. Removing the sort
    # entirely is the deterministic equivalent, and the test feeds the groups in
    # the opposite order to the one they must display in, so it is really caught.
    (ORDERABILITY, "group ordering is dropped (display follows accidental menu order)",
     "    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));",
     "    .slice();"),
    (ORDERABILITY, "examples stop using the product name and fall back to opaque ids",
     "      bucket.examples.push(name !== \"\" ? name : item.id);",
     "      bucket.examples.push(item.id);"),
    (ORDERABILITY, "the smallest cause is listed first, burying the real problem",
     "    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));",
     "    .sort((a, b) => a.count - b.count || a.reason.localeCompare(b.reason));"),
    (ORDERABILITY, "the summary total stops matching the menu it was given",
     "  return { total: items.length, orderable, blocked };",
     "  return { total: orderable, orderable, blocked };"),
    (ORDERABILITY, "STATUTORY LABEL: the DOH refusal stops citing WAC 246-70",
     '        "This is a DOH High-THC product. By WAC 246-70 it may be sold only to a " +',
     '        "This item is not available for pickup. " +'),
]


# Harness lesson 6, learned the hard way on this very slice: this script spawns
# vitest once per mutation, and with 41 mutations an uncapped Node heap on a
# 3939 MB box eventually took the whole tmux server down with it. The run died
# silently mid-sweep -- which is the worst possible failure for a harness,
# because a truncated log looks a lot like a finished one. Two fixes:
#   * cap the Node heap explicitly, and run vitest single-threaded so there is
#     one worker instead of one per core;
#   * flush every line (`-u` when invoked, plus flush=True below) so a log that
#     stops mid-sweep is visibly incomplete rather than empty.
CHILD_ENV = {
    "NODE_OPTIONS": "--max-old-space-size=1536",
}


def run(cmd: list[str]) -> int:
    """Run a command, capturing output. Returns the REAL exit code.

    Never piped -- see harness lesson 1.
    """
    import os

    env = {**os.environ, **CHILD_ENV}
    return subprocess.run(
        cmd,
        cwd=REPO,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=env,
    ).returncode


def suite_fails() -> bool:
    """True when EITHER the vitest files OR the pure self-tests go red.

    `--no-file-parallelism --maxWorkers=1` keeps this to a single worker. The
    default runs files in parallel with a worker per core, and two concurrent
    Node heaps plus the parent is what exhausted memory on this box.

    Harness lesson 7: these two flag names were CHECKED against `vitest --help`
    in this exact installed version before being used. The first attempt used
    `--poolOptions.threads.singleThread`, which this version rejects outright
    with `CACError: Unknown option`. That is a non-zero exit, so every mutation
    would have scored CAUGHT for the wrong reason -- a harness reporting 41/41
    while never actually running a test. The baseline check is what caught it,
    which is precisely why the baseline check exists.
    """
    if run(
        [
            "npx",
            "vitest",
            "run",
            "--no-file-parallelism",
            "--maxWorkers=1",
            *TESTS,
        ]
    ) != 0:
        return True
    if run(["npx", "tsx", SELFTEST_ENTRY]) != 0:
        return True
    return False


def main() -> int:
    files = sorted({m[0] for m in MUTATIONS})
    originals = {f: (REPO / f).read_text() for f in files}

    print("=== SLICE L-3 mutation testing ===")
    print(f"    {len(MUTATIONS)} mutations across {len(files)} files\n")

    print("--- baseline (must be GREEN before any mutation) ---")
    if suite_fails():
        print("  BASELINE IS RED -- aborting. Fix the suite before mutating it.")
        for f in files:
            (REPO / f).write_text(originals[f])
        return 1
    print("  baseline GREEN\n", flush=True)

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
                print(f"  M{i:02d} HARNESS ERROR -- pattern not found: {name}", flush=True)
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
                print(f"  M{i:02d} CAUGHT   [{path.name}] {name}", flush=True)
            else:
                print(f"  M{i:02d} *** SURVIVED *** [{path.name}] {name}", flush=True)
                missed.append(f"[{path.name}] {name}")
    finally:
        for f in files:
            (REPO / f).write_text(originals[f])
        for f in files:
            assert (REPO / f).read_text() == originals[f], f"RESTORE FAILED for {f}"
        print("\n  all sources restored byte-identical")

    total = len(MUTATIONS)
    print(f"\n=== L-3: {caught}/{total} caught, {len(missed)} survived, "
          f"{len(harness_errors)} harness error(s) ===")
    for m in missed:
        print(f"    SURVIVED: {m}")
    for h in harness_errors:
        print(f"    HARNESS ERROR: {h}")

    return 0 if (caught == total and not harness_errors) else 1


if __name__ == "__main__":
    sys.exit(main())
