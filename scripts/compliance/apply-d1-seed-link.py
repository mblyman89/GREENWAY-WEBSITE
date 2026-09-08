#!/usr/bin/env python3
"""
SLICE D1 (follow-up) - stop the Tuesday tiers from being defined TWICE.

Recon finding: seedRuleSnapshots() builds each rule's config from
seedConfigFor(promoKey) and NEVER reads the seed row's own fields. So after the
first Tuesday edit the tiers existed in two independent places:

  1. DAILY_DEAL_SEEDS["daily.tuesday"].qtyTiers   (new, and DEAD - nothing read it)
  2. seedConfigFor("daily.tuesday")               (live, hand-written duplicate)

Two hand-maintained copies of the same numbers is precisely the bug class this
slice exists to remove (the website cart having its own copy of the engine's
arithmetic is what let Doobie Tuesday rot to 14%). This edit makes
seedConfigFor DERIVE the tiers from the seed row, so the seed is the single
source of truth and the dead field becomes load-bearing.
"""

import os

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PUBLISHED = os.path.join(REPO, "src/lib/promotions/published-rules-core.ts")

OLD = '''    case "daily.tuesday":
      // Doobie Tuesday (SLICE D1): 1-3 prerolls 20%, 4+ 25%. This replaces an
      // eitherOr config that resolved to whichever option saved the customer
      // LESS, which made the advertised 4-for-3 unreachable and dropped a
      // 6-preroll cart to 16%.
      return {
        qtyTiers: [
          { at: 1, percent: 20 },
          { at: 4, percent: 25 },
        ],
      };'''

NEW = '''    case "daily.tuesday": {
      // Doobie Tuesday (SLICE D1): 1-3 prerolls 20%, 4+ 25%. This replaces an
      // eitherOr config that resolved to whichever option saved the customer
      // LESS, which made the advertised 4-for-3 unreachable and dropped a
      // 6-preroll cart to 16%.
      //
      // DERIVED from the seed row rather than restated here: seedRuleSnapshots()
      // builds config from this function and ignores the seed's own fields, so
      // hand-writing the tiers in both places would let them silently diverge.
      // The seed is the single source of truth; this reads it.
      const tiers = DAILY_DEAL_SEEDS.find((s) => s.promoKey === "daily.tuesday")?.qtyTiers;
      return tiers?.length ? { qtyTiers: tiers.map((t) => ({ ...t })) } : {};
    }'''

EDITS = [(PUBLISHED, OLD, NEW, "published: Tuesday tiers derive from seed")]


def edit(text, old, new, label):
    if text.count(new) == 1:
        print(f"  {label}: already applied")
        return text
    assert text.count(old) == 1, f"{label}: found {text.count(old)} copies of OLD, expected 1"
    out = text.replace(old, new, 1)
    assert out != text, f"{label}: no-op"
    print(f"  {label}: applied")
    return out


def main():
    by_file = {}
    for path, old, new, label in EDITS:
        by_file.setdefault(path, []).append((old, new, label))

    for path, edits in by_file.items():
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
        original = text
        for old, new, label in edits:
            text = edit(text, old, new, label)
        if text == original:
            continue
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        with open(path, "r", encoding="utf-8") as f:
            assert f.read() == text, f"{path}: disk mismatch"

    with open(PUBLISHED, "r", encoding="utf-8") as f:
        pub = f.read()
    # The literal tier numbers must no longer be restated in seedConfigFor.
    assert pub.count('DAILY_DEAL_SEEDS.find((s) => s.promoKey === "daily.tuesday")?.qtyTiers') == 1, (
        "seedConfigFor does not derive the Tuesday tiers from the seed"
    )
    assert "eitherOr: { flatPercent: 20, bundle: { n: 4, m: 3 } }" not in pub, (
        "the Tuesday eitherOr fallback is still present"
    )
    print("Verified on disk.")


if __name__ == "__main__":
    main()
