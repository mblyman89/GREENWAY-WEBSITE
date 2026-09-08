#!/usr/bin/env python3
"""
L5 step 4 — let a human actually ANSWER the gate.

A gate that blocks an approval but gives nobody a way to satisfy it is not a
compliance control, it is an outage. This adds the two raw form fields to the
server action (passed through unparsed, exactly as SLICE 18-0 does — parsing
them here would duplicate rules, and duplicated compliance rules drift) and the
measurement input to the approval card.

Idempotent; every edit asserts one anchor match and reads back off disk.
"""
import io
import sys

ACTIONS = "src/app/admin/inventory/drafts/actions.ts"
PAGE = "src/app/admin/inventory/drafts/page.tsx"

EDITS = [
    # 1. read the raw fields
    (
        ACTIONS,
        """  const unitThcMg = (formData.get("unit_thc_mg") as string | null) ?? null;""",
        """  const unitThcMg = (formData.get("unit_thc_mg") as string | null) ?? null;
  // SLICE L5: the approver's MEASURED package volume. Raw strings for the same
  // reason as above — approveDraftWithPrice re-derives whether a measurement
  // was required and refuses anything it cannot trust, including a bare "oz".
  const volumeQuantity = (formData.get("net_volume_quantity") as string | null) ?? null;
  const volumeUnit = (formData.get("net_volume_unit") as string | null) ?? null;""",
        'const volumeQuantity = (formData.get("net_volume_quantity")',
    ),
    # 2. pass them through
    (
        ACTIONS,
        """    lowThcLiquid,
    unitThcMg,
  });""",
        """    lowThcLiquid,
    unitThcMg,
    volumeQuantity,
    volumeUnit,
  });""",
        "    volumeQuantity,\n    volumeUnit,\n  });",
    ),
    # 3a. import the volume gate + the same derivation the server uses
    (
        PAGE,
        """  assessReceivingClassification,""",
        """  assessReceivingClassification,
  // SLICE L5 — the volume gate and its placeholder.
  assessReceivingVolume,
  volumePickerPlaceholder,""",
        "  assessReceivingVolume,",
    ),
    # 3b. build the per-draft volume assessment alongside the compliance one
    (
        PAGE,
        """    complianceAssessments.set(
      d.id,
      assessReceivingClassification({
        productName: d.name,
        inventoryType: d.inventory_type,
        resolvedWebsiteCategory: resolutions[i]?.websiteCategory ?? null,
      }),
    );""",
        """    complianceAssessments.set(
      d.id,
      assessReceivingClassification({
        productName: d.name,
        inventoryType: d.inventory_type,
        resolvedWebsiteCategory: resolutions[i]?.websiteCategory ?? null,
      }),
    );
    // SLICE L5: does this draft need a human to MEASURE it? Derived with the
    // SAME pair the approval gate and draft injection use, so the card cannot
    // show a question the server will not ask, or hide one it will.
    // Display only — approveDraftWithPrice re-derives all of it server-side.
    {
      const facts = extractNameFacts(d.name);
      volumeAssessments.set(
        d.id,
        assessReceivingVolume({
          resolvedWebsiteCategory: resolutions[i]?.websiteCategory ?? null,
          derivedVolumeMl: deriveNetVolumeMl({
            rawName: d.name,
            sizes: facts.sizes,
            packCount: facts.packCount,
          }).netVolumeMl,
        }),
      );
    }""",
        "volumeAssessments.set(",
    ),
    # 3c. declare the map next to the others
    (
        PAGE,
        """  const categoryChoices = Object.entries(categoryLabelMap);""",
        """  const categoryChoices = Object.entries(categoryLabelMap);
  // SLICE L5: per-draft "must this be measured before it can be onboarded?".
  const volumeAssessments = new Map<string, ReturnType<typeof assessReceivingVolume>>();""",
        "const volumeAssessments = new Map<",
    ),
    # 3d. the derivation imports the page needs
    (
        PAGE,
        """import {
  assessReceivingClassification,""",
        """import { extractNameFacts } from "@/lib/inventory/fact-extraction-core";
import { deriveNetVolumeMl } from "@/lib/compliance/liquid-volume-derivation-core";
import {
  assessReceivingClassification,""",
        'import { extractNameFacts } from "@/lib/inventory/fact-extraction-core";',
    ),
    # 3e. look the assessment up per row, beside `ca`
    (
        PAGE,
        """                  const ca = complianceAssessments.get(d.id);""",
        """                  const ca = complianceAssessments.get(d.id);
                  const va = volumeAssessments.get(d.id);""",
        "const va = volumeAssessments.get(d.id);",
    ),
    # 3. the UI field, beside the low-THC prompt it belongs with
    (
        PAGE,
        """                                {/* T-314: manual GPT-4o + live web search lookup.""",
        """                                {/* SLICE L5: the VOLUME gate. Unlike the
                                    low-THC prompt above this one BLOCKS, and
                                    for the same reason otherwise_taken does:
                                    an unmeasured liquid has no volume for the
                                    limit engine to measure, falls back to a
                                    28 g default, and 72 packages of ANY size
                                    fit the 72 fl oz cap. Silence here does not
                                    fail closed — it disables a statutory
                                    limit. Shown only when the name gave us
                                    nothing, so nobody is asked to re-measure a
                                    bottle whose size we already read. */}
                                {view === "draft" && va?.needsVolumePick ? (
                                  <div className="flex w-48 flex-col gap-1 rounded border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-2">
                                    <label
                                      className="text-[10px] text-[var(--admin-text-faint)]"
                                      htmlFor={`net-volume-${d.id}`}
                                    >
                                      Package volume — required (the name states no size)
                                    </label>
                                    <Input
                                      id={`net-volume-${d.id}`}
                                      name="net_volume_quantity"
                                      inputMode="decimal"
                                      required
                                      placeholder={volumePickerPlaceholder({ needsVolumePick: true })}
                                      className="text-xs"
                                      aria-label="Package volume"
                                    />
                                    <Select
                                      name="net_volume_unit"
                                      required
                                      defaultValue=""
                                      className="text-xs"
                                      aria-label="Package volume unit"
                                    >
                                      <option value="" disabled>
                                        Pick a unit…
                                      </option>
                                      <option value="ml">ml</option>
                                      <option value="l">L</option>
                                      <option value="floz">fl oz</option>
                                    </Select>
                                    {/* Said plainly, because guessing wrong here
                                        is a ~4% error on a legal limit. */}
                                    <span className="text-[10px] text-[var(--admin-text-faint)]">
                                      A bare &quot;oz&quot; is not accepted — fl oz and weight oz
                                      are different amounts.
                                    </span>
                                  </div>
                                ) : null}
                                {/* T-314: manual GPT-4o + live web search lookup.""",
        'name="net_volume_quantity"',
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
    print("\nAll L5 UI edits verified on disk.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
