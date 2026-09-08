#!/usr/bin/env python3
"""
SLICE T4 - one fault, one warning.

Measured defect (probe-dup-warn.ts): a sizeless "Liquid Edible" or "Tincture"
produced TWO net_volume_missing diagnostics for a single fault, because the
original L5 block and the new bucket pass both cover those two types.

The old block is now strictly SUBSUMED by the bucket pass:
  - coverage: old = 2 inventory types; new = every type in the ml bucket.
  - accuracy: old fires whenever the VOLUME is null, even when a WEIGHT
    measured the product (a 1.7 oz salve). New fires only when nothing at all
    measured it. So deleting the old block also removes a false warning.

Removing it, rather than suppressing the duplicate, keeps one owner of the
rule. The surviving message keeps the "72 fl oz" wording that
tests/compliance/liquid-volume-plumbing.test.ts pins.
"""

import os

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TARGET = os.path.join(REPO, "src/lib/pos/draft-injection-core.ts")

OLD_BLOCK = '''      } else if (
        LIQUID_VOLUME_TYPES.has(invType) &&
        // SLICE L5: silent when a human already measured it — the whole point
        // of the receiving gate is that this case no longer exists.
        !(typeof measured === "number" && Number.isFinite(measured) && measured > 0)
      ) {
        // A liquid with NO derivable volume is the case that broke the limit.
        // Surface it so the dock can measure the bottle instead of letting
        // the register invent a size.
        diagnostics.push({
          severity: "warning",
          code: "net_volume_missing",
          message: "This liquid has no package volume, so the 72 fl oz limit cannot be measured.",
          context: {
            draft_id: d.id,
            pos_product_key: key,
            productName: d.name,
            displayName: d.name,
            inventoryType: invType,
            reasons: vol.reasons,
          },
        });
      }
'''

NEW_BLOCK = '''      }
      // SLICE T4: the "no derivable volume" warning USED TO LIVE HERE, keyed on
      // LIQUID_VOLUME_TYPES. It moved to the bucket pass below, which covers
      // every inventory type the statute meters in fluid ounces instead of the
      // two that were on the old list, and which stays quiet when a WEIGHT has
      // already measured the package. Warning in both places reported one
      // fault twice.
'''

OLD_MSG = '''          message:
            "This product counts against the 72 fluid ounce limit but has no package size, so the limit cannot be measured.",'''

NEW_MSG = '''          message:
            "This product counts against the 72 fl oz limit but has no package size, so the limit cannot be measured.",'''


def edit(text, old, new, label):
    if text.count(new) == 1 and text.count(old) == 0:
        print(f"  {label}: already applied")
        return text
    assert text.count(old) == 1, f"{label}: found {text.count(old)} copies of the OLD text, expected 1"
    assert text.count(new) == 0, f"{label}: found {text.count(new)} copies of the NEW text, expected 0"
    out = text.replace(old, new, 1)
    assert out != text, f"{label}: no-op"
    print(f"  {label}: applied")
    return out


def main():
    with open(TARGET, "r", encoding="utf-8") as f:
        text = f.read()
    original = text

    text = edit(text, OLD_BLOCK, NEW_BLOCK, "remove subsumed L5 warning block")
    text = edit(text, OLD_MSG, NEW_MSG, "keep the '72 fl oz' wording tests pin")

    if text == original:
        print("Nothing to do.")
        return

    with open(TARGET, "w", encoding="utf-8") as f:
        f.write(text)

    # Read back from disk. Never trust the write.
    with open(TARGET, "r", encoding="utf-8") as f:
        disk = f.read()
    assert disk == text, "disk content does not match what we wrote"
    assert disk.count('code: "net_volume_missing"') == 1, (
        f'expected exactly 1 net_volume_missing site, found {disk.count(chr(39))}'
    )
    assert disk.count("72 fl oz limit") == 1, "expected exactly one '72 fl oz limit' message"
    assert "This liquid has no package volume" not in disk, "old message still present"
    print("Verified on disk: exactly one net_volume_missing site.")


if __name__ == "__main__":
    main()
