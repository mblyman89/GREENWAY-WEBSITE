#!/usr/bin/env python3
"""
T1 consumers — both production call sites must supply the derived WEIGHT.

The assessment cannot see a weight it is not given, so a fix confined to the
pure core would change nothing in production. Both call sites already run
extractNameFacts; deriveNetWeightGrams reads the SAME sizes array, so no new
parsing is introduced and the two cannot drift.
"""
import io
import sys

DRAFTS = "src/lib/inventory/catalog-drafts.ts"
PAGE = "src/app/admin/inventory/drafts/page.tsx"


def patch(path: str, old: str, new: str, label: str) -> None:
    t = io.open(path, encoding="utf-8").read()
    # Counting `new` is the only check that holds when `old` is a substring of
    # `new` (the append case), where `new in t and old not in t` silently
    # re-applies the edit.
    if t.count(new) == 1:
        print(f"  {label}: already applied")
        return
    assert t.count(new) == 0, f"{label}: found {t.count(new)} copies of the new text"
    n = t.count(old)
    assert n == 1, f"{label}: anchor matched {n}x (expected 1)"
    io.open(path, "w", encoding="utf-8").write(t.replace(old, new, 1))
    back = io.open(path, encoding="utf-8").read()
    assert back.count(new) == 1, f"{label}: did not land on disk"
    if old not in new:
        assert old not in back, f"{label}: old text survived"
    print(f"  {label}: applied")


# ---- server: the approval gate ---------------------------------------------
t = io.open(DRAFTS, encoding="utf-8").read()
if "deriveNetWeightGrams" not in t:
    old_imp = 'import { deriveNetVolumeMl } from "@/lib/compliance/liquid-volume-derivation-core";'
    new_imp = (
        "import {\n"
        "  deriveNetVolumeMl,\n"
        "  deriveNetWeightGrams,\n"
        '} from "@/lib/compliance/liquid-volume-derivation-core";'
    )
    if old_imp in t:
        patch(DRAFTS, old_imp, new_imp, "drafts import")
    else:
        raise AssertionError("drafts: could not find the derivation import to extend")
else:
    print("  drafts import: already applied")

patch(
    DRAFTS,
    """  const volumeAssessment = assessReceivingVolume({
    resolvedWebsiteCategory: choice.chosenWebsiteCategory ?? resolution.websiteCategory,
    derivedVolumeMl: derivedVolume.netVolumeMl,
  });""",
    """  // SLICE T1 — the weight comes from the SAME sizes array the volume came
  // from, so a salve labelled "2oz" is already measured and the gate has
  // nothing to ask. Deriving it from a second source is how the two would
  // drift apart.
  const derivedWeightGrams = deriveNetWeightGrams(derivedFacts.sizes);
  const volumeAssessment = assessReceivingVolume({
    resolvedWebsiteCategory: choice.chosenWebsiteCategory ?? resolution.websiteCategory,
    derivedVolumeMl: derivedVolume.netVolumeMl,
    derivedWeightGrams,
  });""",
    "drafts assessment",
)

# ---- UI: the card that shows the question ----------------------------------
t = io.open(PAGE, encoding="utf-8").read()
if "deriveNetWeightGrams" not in t:
    old_imp = 'import { deriveNetVolumeMl } from "@/lib/compliance/liquid-volume-derivation-core";'
    new_imp = (
        "import {\n"
        "  deriveNetVolumeMl,\n"
        "  deriveNetWeightGrams,\n"
        '} from "@/lib/compliance/liquid-volume-derivation-core";'
    )
    if old_imp in t:
        patch(PAGE, old_imp, new_imp, "page import")
    else:
        raise AssertionError("page: could not find the derivation import to extend")
else:
    print("  page import: already applied")

patch(
    PAGE,
    """        assessReceivingVolume({
          resolvedWebsiteCategory: resolutions[i]?.websiteCategory ?? null,
          derivedVolumeMl: deriveNetVolumeMl({
            rawName: d.name,
            sizes: facts.sizes,
            packCount: facts.packCount,
          }).netVolumeMl,
        }),""",
    """        assessReceivingVolume({
          resolvedWebsiteCategory: resolutions[i]?.websiteCategory ?? null,
          derivedVolumeMl: deriveNetVolumeMl({
            rawName: d.name,
            sizes: facts.sizes,
            packCount: facts.packCount,
          }).netVolumeMl,
          // SLICE T1 — a weight-labelled salve is already measured, so the
          // card must not show a question the server will not ask.
          derivedWeightGrams: deriveNetWeightGrams(facts.sizes),
        }),""",
    "page assessment",
)

print("T1 consumers: done")
sys.exit(0)
