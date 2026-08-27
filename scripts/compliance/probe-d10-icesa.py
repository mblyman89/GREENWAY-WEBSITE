"""books-66 probe: does the ICESA formula settle D-10?

KEPT ON PURPOSE, though it was written as a throwaway. `docs/DEFECTS.md` D-10
records why: the rounding half of D-10 stays open until an ESD document states
it, and the thing most likely to close it is a fifth filed quarter. When that
quarter arrives this file turns the question into one command instead of a
re-derivation from a paragraph. Add the quarter to QUARTERS and run it.

Do NOT wire this into the engine. It measures which rounding reading FITS the
filed figures; a reading that fits is a pattern, and standing rule 62d does not
allow a filed tax figure to be computed from a pattern. Its output is evidence
for a decision, not a decision.


ICESA Bulk Format Specification (WA ESD, revised Dec 2023), verbatim:
  "UI Taxes Due (taxable wages multiplied by the UI tax rate)"
  "EAF Assessment Amount ... (total taxable wages x EAF rate)"

That fixes the STRUCTURE (each fund's rate applied to taxable wages separately).
It says nothing about rounding. This probe measures which rounding survives.

Primary figures:
  Q1 2026 - 1ST_QUARTER_FORM_5208A.pdf (EAMS confirmation, filed 2026-03-19)
  Q2 2026 - tests/fixtures known-good-quarters.ts
"""

from decimal import Decimal, ROUND_HALF_UP, ROUND_DOWN

QUARTERS = [
    {"label": "Q1 2026", "taxable": Decimal("61531.21"), "ui": Decimal("227.66"), "eaf": Decimal("18.46")},
    {"label": "Q2 2026", "taxable": Decimal("68923.45"), "ui": Decimal("255.02"), "eaf": Decimal("20.68")},
]
UI_RATE = Decimal("0.0037")
EAF_RATE = Decimal("0.0003")
CENT = Decimal("0.01")


def money(x, mode):
    return x.quantize(CENT, rounding=mode)


READINGS = {
    "A-half-up   (rate x exact cents, round half up)":
        lambda t, r: money(t * r, ROUND_HALF_UP),
    "A-truncate  (rate x exact cents, drop remainder)":
        lambda t, r: money(t * r, ROUND_DOWN),
    "C-half-up   (drop wage cents, then rate, round half up)":
        lambda t, r: money(t.quantize(Decimal("1"), rounding=ROUND_DOWN) * r, ROUND_HALF_UP),
    "C-truncate  (drop wage cents, then rate, drop remainder)":
        lambda t, r: money(t.quantize(Decimal("1"), rounding=ROUND_DOWN) * r, ROUND_DOWN),
}

print("Each reading applies the rate PER FUND, which is the part ICESA settles.")
print("What varies below is only the rounding.\n")

survivors = []
for name, fn in READINGS.items():
    ok = True
    lines = []
    for q in QUARTERS:
        gui = fn(q["taxable"], UI_RATE)
        geaf = fn(q["taxable"], EAF_RATE)
        hit_ui = gui == q["ui"]
        hit_eaf = geaf == q["eaf"]
        ok = ok and hit_ui and hit_eaf
        lines.append(
            f"    {q['label']}  UI {gui} vs filed {q['ui']} {'ok' if hit_ui else 'MISS'}"
            f"   |  EAF {geaf} vs filed {q['eaf']} {'ok' if hit_eaf else 'MISS'}"
        )
    print(f"{'SURVIVES' if ok else 'refuted '}  {name}")
    for line in lines:
        print(line)
    print()
    if ok:
        survivors.append(name)

print(f"Readings that fit all four filed figures: {len(survivors)}")
for s in survivors:
    print(f"  - {s}")
if len(survivors) != 1:
    print("\nMore than one reading survives, or none does. Not safe to implement.")
else:
    print("\nExactly one reading fits. Still a pattern over four numbers, NOT a published rule.")
