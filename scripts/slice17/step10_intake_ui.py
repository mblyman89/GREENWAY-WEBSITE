#!/usr/bin/env python3
"""SLICE 17 step 10 — wire the intake classification into the fact-review form
and its server action.

This is the surface where the flag actually gets SET. Because an unflagged
suppository falls into the effectively-unlimited 2016 g liquid bucket, this
form is the control that makes WAC 314-55-095(1)(d)(i)(D) real. Without it the
migration, the engine and the back-office setting would all exist and nothing
would ever be classified.

Mirrors the SLICE 16 low-THC block exactly: a tri-state <select> whose blank
option means "leave as-is", a numeric FixField, and an explanatory paragraph.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if not (ROOT / "package.json").is_file():
    raise SystemExit(f"repo root wrong: {ROOT}")

PAGE = "src/app/admin/menu-imports/[id]/facts/page.tsx"
ACTIONS = "src/app/admin/menu-imports/actions.ts"

EDITS: list[tuple[str, str, str]] = [
    # ---- the form block, inserted right after the SLICE 16 block ----------
    (
        PAGE,
        """              qualify. Take the figure from the invoice or the physical package and note the lot number
              below. Anything left unclassified is counted against the regular 72 oz liquid limit.
            </p>
          </div>""",
        """              qualify. Take the figure from the invoice or the physical package and note the lot number
              below. Anything left unclassified is counted against the regular 72 oz liquid limit.
            </p>
          </div>

          {/* SLICE 17 \u2014 "otherwise taken into the body" (WAC 314-55-095(1)(d)(i)(D)). */}
          <div className="rounded-lg border border-[var(--admin-orange)]/25 bg-[var(--admin-orange)]/[0.04] p-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--admin-orange)]">
              Otherwise taken into the body (10 unit limit)
            </p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-[11px] uppercase tracking-wide text-white/45">
                  Is this taken into the body another way?
                </label>
                <select
                  name="otherwiseTaken"
                  defaultValue=""
                  className="admin-focus mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-xs text-white"
                >
                  <option value="">
                    {row.facts.otherwiseTaken === null
                      ? "Leave unclassified (NOT counted against the 10 unit limit)"
                      : `Leave as-is (currently ${row.facts.otherwiseTaken ? "yes" : "no"})`}
                  </option>
                  <option value="yes">Yes \u2014 suppository or similar (10 unit limit)</option>
                  <option value="no">No \u2014 smoked, eaten, or applied to the skin</option>
                </select>
              </div>
              <FixField
                label="Individual units per PACKAGE"
                name="unitsPerPackage"
                placeholder={str(row.facts.unitsPerPackage)}
              />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-white/45">
              This covers products taken into the body by any route <em>other</em> than inhaling,
              swallowing, or applying to the skin &mdash; in practice,{" "}
              <strong>suppositories</strong> (WAC 314-55-010(40)). Count the individual items in the
              sealed package: a <strong>box of six is 6</strong>, and all six count against the
              customer&rsquo;s ten-unit limit. This is <strong>not</strong> the same as servings.
              <br />
              <strong className="text-[var(--admin-orange)]">Please classify these carefully.</strong>{" "}
              A suppository left unclassified is treated as an ordinary topical and counts against the
              72 oz liquid limit instead, which is so large it effectively imposes{" "}
              <strong>no limit at all</strong>. Unlike the beverage question above, leaving this blank
              is <em>not</em> the safe option.
            </p>
          </div>""",
    ),
    # ---- the server action ------------------------------------------------
    (
        ACTIONS,
        """    if (!lowThc.ok) {
      redirect(dest + "?error=" + encodeURIComponent(lowThc.error));
    } else {
      Object.assign(facts, lowThc.facts);
    }""",
        """    if (!lowThc.ok) {
      redirect(dest + "?error=" + encodeURIComponent(lowThc.error));
    } else {
      Object.assign(facts, lowThc.facts);
    }

    // \u2500\u2500 SLICE 17: the "otherwise taken into the body" classification \u2500\u2500\u2500\u2500\u2500
    // Same shape as the low-THC parse above and for the same reason: the rules
    // live in the pure core so they can be unit-tested, and this action only
    // translates a failure into a redirect. See
    // parseOtherwiseTakenClassification() for why each rule exists \u2014 the short
    // version is that a missing units-per-package count would make the register
    // read a box of six as one unit and undercount the statutory limit 6x.
    const otherwiseTaken = parseOtherwiseTakenClassification(
      String(formData.get("otherwiseTaken") ?? ""),
      String(formData.get("unitsPerPackage") ?? ""),
    );
    if (!otherwiseTaken.ok) {
      redirect(dest + "?error=" + encodeURIComponent(otherwiseTaken.error));
    } else {
      Object.assign(facts, otherwiseTaken.facts);
    }""",
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
