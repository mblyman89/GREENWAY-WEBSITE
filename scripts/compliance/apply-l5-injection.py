#!/usr/bin/env python3
"""
L5 step 3 — carry the human's MEASUREMENT through injection to the menu.

Without this the gate would take a real measurement from a receiver and then
throw it away at injection, leaving net_volume_ml null and the 28 g fallback in
charge. The gate would LOOK like it worked and change nothing.

Precedence: the HUMAN's measurement outranks the name derivation. A person who
read the bottle beats a regex that read the title — and the gate only fires when
the derivation found nothing anyway, so in practice they never disagree.

Idempotent; every edit asserts one anchor match and reads back off disk.
"""
import io
import sys

CORE = "src/lib/pos/draft-injection-core.ts"
SERVER = "src/lib/pos/draft-injection.ts"

EDITS = [
    # 1. the draft shape carries the measured volume
    (
        CORE,
        """  chosen_otherwise_taken?: boolean | null;
  chosen_units_per_package?: number | null;
  chosen_low_thc_liquid?: boolean | null;
  chosen_unit_thc_mg?: number | null;
};""",
        """  chosen_otherwise_taken?: boolean | null;
  chosen_units_per_package?: number | null;
  chosen_low_thc_liquid?: boolean | null;
  chosen_unit_thc_mg?: number | null;
  /**
   * SLICE L5 (migration 0224): the package volume a HUMAN measured at receiving
   * because the product name stated no size. Without carrying it here the gate
   * would take a real measurement and then discard it at injection, leaving
   * net_volume_ml null and the 28 g fallback in charge — the gate would look
   * like it worked and change nothing. Null = nobody was asked to measure.
   */
  chosen_net_volume_ml?: number | null;
};""",
        "chosen_net_volume_ml?: number | null;",
    ),
    # 2. the human measurement outranks the name derivation
    (
        CORE,
        """      if (vol.netVolumeMl !== null && vol.source !== null) {
        netVolumeMl = vol.netVolumeMl;
        factProvenance.net_volume_ml = vol.source;""",
        """      // SLICE L5: a HUMAN who measured the bottle outranks a regex that read
      // the title. In practice they never disagree — the receiving gate only
      // fires when the derivation found nothing — but when a person has gone to
      // the package and read it, that is the better fact and it wins.
      const measured = d.chosen_net_volume_ml;
      if (typeof measured === "number" && Number.isFinite(measured) && measured > 0) {
        netVolumeMl = measured;
        factProvenance.net_volume_ml = "human";
      } else if (vol.netVolumeMl !== null && vol.source !== null) {
        netVolumeMl = vol.netVolumeMl;
        factProvenance.net_volume_ml = vol.source;""",
        "factProvenance.net_volume_ml = \"human\";",
    ),
    # 3. the missing-volume diagnostic must not fire when a human measured
    (
        CORE,
        """      } else if (LIQUID_VOLUME_TYPES.has(invType)) {""",
        """      } else if (
        LIQUID_VOLUME_TYPES.has(invType) &&
        // SLICE L5: silent when a human already measured it — the whole point
        // of the receiving gate is that this case no longer exists.
        !(typeof measured === "number" && Number.isFinite(measured) && measured > 0)
      ) {""",
        "the whole point\n        // of the receiving gate is that this case no longer exists.",
    ),
    # 4. the server must actually SELECT the column (widest fallback tier)
    (
        SERVER,
        """    const COMPLIANCE_COLS =
      ", chosen_otherwise_taken, chosen_units_per_package, chosen_low_thc_liquid, chosen_unit_thc_mg";""",
        """    const COMPLIANCE_COLS =
      ", chosen_otherwise_taken, chosen_units_per_package, chosen_low_thc_liquid, chosen_unit_thc_mg" +
      // SLICE L5 (migration 0224). Appended to the SAME widest tier so a
      // database missing 0224 degrades exactly as one missing 0218 does:
      // it loses the measured volume and keeps injecting, rather than failing
      // every injection outright.
      ", chosen_net_volume_ml";""",
        ", chosen_net_volume_ml\";",
    ),
    # 5. the server-side row type
    (
        SERVER,
        """      chosen_low_thc_liquid?: boolean | null;""",
        """      chosen_low_thc_liquid?: boolean | null;
      /** SLICE L5 (0224): the receiver's measured package volume, in ml. */
      chosen_net_volume_ml?: number | null;""",
        "/** SLICE L5 (0224): the receiver's measured package volume, in ml. */",
    ),
]


def main() -> int:
    for path, old, new, marker in EDITS:
        src = io.open(path, encoding="utf-8").read()
        if marker in src:
            print(f"SKIP  {path}: already applied ({marker[:46]}...)")
            continue
        count = src.count(old)
        assert count == 1, f"{path}: anchor matched {count}x, expected 1\n---\n{old}\n---"
        io.open(path, "w", encoding="utf-8").write(src.replace(old, new, 1))
        back = io.open(path, encoding="utf-8").read()
        assert back.count(new) == 1, f"{path}: new text present {back.count(new)}x"
        print(f"OK    {path}: applied and verified on disk ({marker[:46]}...)")
    print("\nAll L5 injection edits verified on disk.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
