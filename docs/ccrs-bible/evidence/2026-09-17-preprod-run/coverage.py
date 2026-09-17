"""Which of the 14 observed rejections would our EXISTING pre-flight have caught
before the file ever left the building? Facts only -- gates read from
src/lib/compliance/ccrs-preflight-core.ts in the fresh clone.
"""

GATES = {
    "E7_TOTALCOST_ZERO":            "Inventory TotalCost == 0",
    "E8_ONHAND_GT_INITIAL":         "QuantityOnHand > InitialQuantity",
    "E9_UNITWEIGHT_ZERO_USABLE":    "Usable Cannabis with UnitWeightGrams == 0",
    "E10_DESCRIPTION_REQUIRED":     "Usable Cannabis with empty Description",
    "E11_STRAIN_NAME_RESERVED":     "Strain in {unknown, thc, other}",
    "E12_EXCISE_NOT_37PCT":         "excise != 37% of taxable base",
    "E13_ADJUSTMENT_DETAIL_MISSING":"Other/Theft adjustment with no detail",
}

OBSERVED = [
    ("T-11",  "Duplicate Strain. The Strain must be unique for the LicenseNumber", None,
     "server state (already filed) - not knowable locally, and HARMLESS per [G L0325]"),
    ("T-12",  "Duplicate Strain. The Strain must be unique for the LicenseNumber", None,
     "same; the probe's purpose (filename case) was answered by acceptance of the NAME"),
    ("T-14",  "Strain name is invalid cannot be Unknown THC or Other", "E11_STRAIN_NAME_RESERVED", ""),
    ("T-16r", "Duplicate External Identifier", None, "server state - needs the identifier ledger"),
    ("T-17",  "Duplicate External Identifier", None, "server state - needs the identifier ledger"),
    ("T-18",  "If Useable Cannabis is selected Unit Weight Gram cannot be Zero", "E9_UNITWEIGHT_ZERO_USABLE", ""),
    ("T-31",  "Total Cost cannot equal zero", "E7_TOTALCOST_ZERO", ""),
    ("T-32",  "QuantityOnHand is greater than InitialQuantity", "E8_ONHAND_GT_INITIAL", ""),
    ("T-33",  "Duplicate External Identifier", None, "server state - needs the identifier ledger"),
    ("T-35",  "ExternalIdentifier not found", None, "server state - needs the identifier ledger"),
    ("T-37",  "Invalid Product", None, "local! we hold the Product list we filed -> NEW GATE possible"),
    ("T-42",  "Only Medical Sales Excise tax can be 0", "E12_EXCISE_NOT_37PCT", ""),
    ("T-48",  "Inventory Adjustment Details missing", "E13_ADJUSTMENT_DETAIL_MISSING", ""),
    ("T-54",  "CheckSum and number of records don't match", None, "local! NumberRecords vs rows -> NEW GATE E14"),
]

caught = [o for o in OBSERVED if o[2]]
ledger = [o for o in OBSERVED if not o[2] and "ledger" in o[3]]
newgate = [o for o in OBSERVED if not o[2] and "NEW GATE" in o[3]]
benign = [o for o in OBSERVED if not o[2] and "HARMLESS" in o[3] or (not o[2] and "answered by acceptance" in o[3])]

print("CAUGHT TODAY by existing pre-flight:", len(caught))
for t, msg, gate, _ in caught:
    print(f"   {t:6} {gate:32} <- {msg}")

print("\nWOULD NEED A NEW *LOCAL* GATE (cheap, no server state):", len(newgate))
for t, msg, _, why in newgate:
    print(f"   {t:6} {msg}\n          {why}")

print("\nNEEDS THE IDENTIFIER LEDGER (server state we must mirror locally):", len(ledger))
for t, msg, _, why in ledger:
    print(f"   {t:6} {msg}")

print("\nBENIGN / NOT WORTH BLOCKING:", len(benign))
for t, msg, _, why in benign:
    print(f"   {t:6} {msg}")

print()
print("=" * 78)
print(f"Existing gates catch      {len(caught)}/14")
print(f"+ two cheap new gates     {len(caught)+len(newgate)}/14   (E14 NumberRecords, E15 Product-name join)")
print(f"+ identifier ledger       {len(caught)+len(newgate)+len(ledger)}/14")
print(f"remaining are benign duplicates: {len(benign)}")
print()
print("CONCLUSION: the identifier ledger is worth more than any other single")
print("improvement -- it is the ONLY thing standing between us and 4 of the 14")
print("failure modes, and it is exactly what the examiner's 'use the update path'")
print("instruction requires us to build.")
