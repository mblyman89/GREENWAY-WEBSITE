#!/usr/bin/env python3
"""SLICE 17 step 7 — back office, per the owner's instruction:

  "It should be added to the back office with the other limits and settings and
   such. So everything is consistent."

Two files: the settings PAGE (summary tile + rec input + med input + an
explainer paragraph) and the server ACTION that parses the two new fields.

ANCHOR SAFETY
-------------
This file mixes THREE literal UTF-8 em dashes with SEVEN literal backslash-u
escape sequences in JSX string literals. Anchors below deliberately avoid both
so that neither encoding can cause a silent 0x match. Verified with `cat -A`.

The `lg:grid-cols-5` class appears THREE times (summary tiles, rec inputs, med
inputs) and all three must become 6, so each anchor carries enough surrounding
context to be unique. The script asserts count == 1 on every one.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if not (ROOT / "package.json").is_file():
    raise SystemExit(f"repo root wrong: {ROOT}")

PAGE = "src/app/admin/compliance/sales-limits/page.tsx"
ACTIONS = "src/app/admin/compliance/sales-limits/actions.ts"

EDITS: list[tuple[str, str, str]] = [
    # ================= PAGE: summary tile ==================================
    (
        PAGE,
        """        {/* Current effective limits */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">""",
        """        {/* Current effective limits */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">""",
    ),
    (
        PAGE,
        """            accent="gold"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard
            label="Enforcement\"""",
        """            accent="gold"
          />
          {/* SLICE 17. Counted in WHOLE UNITS (items), not weight. Medical is
              the same ten: WAC 314-55-095(2)(d) does not list this category at
              all, so there is no authority to triple it. */}
          <StatCard
            label="Otherwise taken into the body"
            value={formatLimitAmount("otherwise_taken", s.rec.otherwise_taken)}
            hint="suppositories &middot; medical the same"
            accent="orange"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard
            label="Enforcement\"""",
    ),
    # ================= PAGE: recreational input ============================
    (
        PAGE,
        """                    name="rec_low_thc_liquid"
                    defaultValue={s.rec.low_thc_liquid}
                    disabled={!isOwner}
                  />
                </Field>
              </div>""",
        """                    name="rec_low_thc_liquid"
                    defaultValue={s.rec.low_thc_liquid}
                    disabled={!isOwner}
                  />
                </Field>
                {/* SLICE 17 - a COUNT OF WHOLE ITEMS, not grams and not mg.
                    step=1 because half a suppository is not sellable. */}
                <Field
                  label={LIMIT_BUCKET_LABELS.otherwise_taken}
                  help="Whole units (items), NOT grams. Statutory max 10 units - WAC 314-55-095(1)(d)(i)(D). A box of six suppositories counts as six units."
                >
                  <Input
                    type="number"
                    step="1"
                    min="0"
                    name="rec_otherwise_taken"
                    defaultValue={s.rec.otherwise_taken}
                    disabled={!isOwner}
                  />
                </Field>
              </div>""",
    ),
    # ================= PAGE: medical input =================================
    (
        PAGE,
        """                    name="med_low_thc_liquid"
                    defaultValue={s.med.low_thc_liquid}
                    disabled={!isOwner}
                  />
                </Field>
              </div>""",
        """                    name="med_low_thc_liquid"
                    defaultValue={s.med.low_thc_liquid}
                    disabled={!isOwner}
                  />
                </Field>
                {/* SLICE 17 - NOT tripled, and for a different reason than the
                    low-THC bucket above. That one names the same 200 mg figure
                    for medical. This one is ABSENT from WAC 314-55-095(2)(d)
                    entirely, so nothing authorises raising it. */}
                <Field
                  label={LIMIT_BUCKET_LABELS.otherwise_taken}
                  help="Whole units (items). Statutory max is ALSO 10 for medical. WAC 314-55-095(2)(d) does not list this category, so there is no authority to triple it. Do not set 30."
                >
                  <Input
                    type="number"
                    step="1"
                    min="0"
                    name="med_otherwise_taken"
                    defaultValue={s.med.otherwise_taken}
                    disabled={!isOwner}
                  />
                </Field>
              </div>""",
    ),
    # ================= PAGE: grid widths for the two input rows ============
    # Both remaining lg:grid-cols-5 are the rec and med input grids. They are
    # disambiguated by the heading text that precedes each.
    # The unit caveat appears on BOTH headings, so each is anchored by the
    # heading label above it ("Recreational limits" / "Medical (DOH database)
    # limits"). A single shared anchor matched 2x and the guard rejected it.
    (
        PAGE,
        """                Recreational limits{" "}
                <span className="font-normal text-[var(--admin-muted)]">
                  (grams, except low-THC beverages which are mg of THC)
                </span>
              </h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">""",
        """                Recreational limits{" "}
                <span className="font-normal text-[var(--admin-muted)]">
                  (grams, except low-THC beverages which are mg of THC and
                  suppositories which are whole units)
                </span>
              </h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">""",
    ),
    (
        PAGE,
        """                Medical (DOH database) limits{" "}
                <span className="font-normal text-[var(--admin-muted)]">
                  (grams, except low-THC beverages which are mg of THC)
                </span>
              </h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">""",
        """                Medical (DOH database) limits{" "}
                <span className="font-normal text-[var(--admin-muted)]">
                  (grams, except low-THC beverages which are mg of THC and
                  suppositories which are whole units)
                </span>
              </h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">""",
    ),
    # ================= PAGE: explainer paragraph ===========================
    (
        PAGE,
        """            <p className="mt-2 text-xs text-[var(--admin-muted)]">
              Accessories, Greenway merch, and paraphernalia are not cannabis and""",
        """            <p className="mt-4 text-xs text-[var(--admin-muted)]">
              <strong className="text-[var(--admin-text)]">
                Products otherwise taken into the body are counted, not weighed:
              </strong>{" "}
              a cannabis product taken by a route other than inhaling, swallowing,
              or applying to the skin &mdash; in practice a suppository &mdash; is
              limited to{" "}
              {formatLimitAmount("otherwise_taken", s.rec.otherwise_taken)} per
              transaction (WAC 314-55-095(1)(d)(i)(D), defined at
              WAC 314-55-010(40)). This limit counts ITEMS rather than weight, so a
              box of six counts as six units (RCW 69.50.101). The medical figure is
              the same ten: WAC 314-55-095(2)(d) does not list this category at all,
              so unlike flower, edibles, or concentrate it does{" "}
              <em>not</em> triple for a DOH-database patient. A product is only
              counted this way once it has been classified as such at intake.
            </p>
            <p className="mt-2 text-xs text-[var(--admin-muted)]">
              Accessories, Greenway merch, and paraphernalia are not cannabis and""",
    ),
    # ================= ACTIONS: rec + med parse ============================
    (
        ACTIONS,
        """        low_thc_liquid: num(
          formData,
          "rec_low_thc_liquid",
          RECREATIONAL_LIMITS.low_thc_liquid,
        ),
      },
      RECREATIONAL_LIMITS,""",
        """        low_thc_liquid: num(
          formData,
          "rec_low_thc_liquid",
          RECREATIONAL_LIMITS.low_thc_liquid,
        ),
        // SLICE 17 - a COUNT of whole items, not grams. clampLimitProfile
        // floors this to an integer, so a pasted "10.6" becomes 10 rather
        // than being rejected or silently rounded up.
        otherwise_taken: num(
          formData,
          "rec_otherwise_taken",
          RECREATIONAL_LIMITS.otherwise_taken,
        ),
      },
      RECREATIONAL_LIMITS,""",
    ),
    (
        ACTIONS,
        """        low_thc_liquid: num(
          formData,
          "med_low_thc_liquid",
          MEDICAL_LIMITS.low_thc_liquid,
        ),
      },
      MEDICAL_LIMITS,""",
        """        low_thc_liquid: num(
          formData,
          "med_low_thc_liquid",
          MEDICAL_LIMITS.low_thc_liquid,
        ),
        // SLICE 17 - MEDICAL_LIMITS.otherwise_taken is 10, the SAME as
        // recreational, because WAC 314-55-095(2)(d) omits the category. The
        // clamp enforces that ceiling even if someone types 30 into the form.
        otherwise_taken: num(
          formData,
          "med_otherwise_taken",
          MEDICAL_LIMITS.otherwise_taken,
        ),
      },
      MEDICAL_LIMITS,""",
    ),
]

buffered: dict[Path, str] = {}
for rel, find, replace in EDITS:
    path = ROOT / rel
    if path not in buffered:
        buffered[path] = path.read_text(encoding="utf-8")
    text = buffered[path]
    n = text.count(find)
    if n != 1:
        raise SystemExit(f"ANCHOR FAIL ({n}x) in {rel}: {find[:80]!r}")
    buffered[path] = text.replace(find, replace)

for path, out in buffered.items():
    path.write_text(out, encoding="utf-8")
    print(f"PATCHED {path.relative_to(ROOT)}")
print(f"OK: {len(EDITS)} anchors applied across {len(buffered)} files")
