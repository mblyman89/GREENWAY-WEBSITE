# CCRS manifest.csv import — advance manifest staging (Slice 84)

This documents the third way to bring an incoming transfer into the back office
so staff can **see it before it physically arrives** and stage it for the
accept/reject dock workflow (Slices 81–83). It sits alongside the two paths that
already existed (Slice 74):

1. **WCIA Transfer Data Link / JSON** (vendor's structured file) — *recommended*.
2. **Manual entry** (type it in).
3. **CCRS manifest.csv** — *new in Slice 84*, the state's own format.

## Why this is the real "Cultivera parity" and not magic

Verified against the LCB (WSLCB) documentation and Cultivera's own support docs:

- **There is NO automatic inbound feed from the state.** In CCRS, the **sending
  (origin) licensee** uploads a `manifest.csv`; on success CCRS emails a PDF
  confirmation to the sending licensee, the receiving licensee, the integrator,
  and the transporter. The receiver **cannot pull a live "incoming" query**.
  (Source: https://lcb.wa.gov/ccrs/manifests)
- So a retailer sees a transfer "before it arrives" purely because the **vendor
  hands them a structured file in advance** — the WCIA JSON, or the CCRS
  `manifest.csv`. That's exactly what this feature ingests.

## The CCRS manifest.csv format (authoritative)

Downloaded from the LCB template (`docs/fixtures/ccrs-manifest-template.csv`) and
the CCRS Transportation Manifest User Guide. It is a **hybrid** file:

- **Header block** (rows before the item table): column A is the attribute NAME,
  column B is its VALUE. 21 attributes, ending at
  `DestinationLicenseeEmailAddress` — e.g. `SubmittedBy`, `SubmittedDate`,
  `NumberRecords`, `ExternalManifestIdentifier`, `Header Operation`,
  `TransportationType`, `OriginLicenseNumber`, `OriginLicenseePhone`,
  `OriginLicenseeEmailAddress`, `TransportationLicenseNumber`, `DriverName`,
  `DepartureDateTime`, `ArrivalDateTime`, `VIN #`, `VehiclePlateNumber`,
  `VehicleModel`, `VehicleMake`, `VehicleColor`, `DestinationLicenseNumber`,
  `DestinationLicenseePhone`, `DestinationLicenseeEmailAddress`.
- **Item table header row**, exact order:
  `InventoryExternalIdentifier, PlantExternalIdentifier, Quantity, UOM,
  WeightPerUnit, ServingsPerUnit, ExternalIdentifier, LabTestExternalIdentifier,
  CreatedBy, CreatedDate, UpdatedBy, UpdatedDate, Operation`.
- **One item row per transported inventory item / plant.**
- Valid `UOM` values: **`Each`** or **`Gram`**. Dates are `MM/DD/YYYY`;
  datetimes are `MM/DD/YYYY hh:mm AM/PM`.

## Honest limitation (surfaced, never guessed)

The CCRS manifest **only** carries identifiers, quantities, UOM, weight, and the
lab-test external identifier. It carries **no product name, strain, brand,
category, price, or COA URL** — those live in the separate CCRS
Product/Inventory/LabTest files, not the manifest. Therefore a CSV import stages
**sparse draft lines**, and every line carries a warning telling staff to enrich
it before accepting. This is consistent with the standing rule that machine
output is always a draft for a human to validate. If the vendor can send the
WCIA JSON instead, prefer it — it includes the product + COA detail.

## What the code does (for maintainers)

- **Pure parser** `src/lib/inventory/ccrs-manifest-csv-core.ts`:
  - `splitCsvRows(text)` — quote-aware CSV splitter.
  - `parseCcrsManifestCsv(text)` → `{ header, items, warnings }` (detects the
    item-table header row; tolerant of header attributes in any order, spaced
    keys like `Header Operation` / `VIN #`, and the template's trailing commas).
  - `ccrsToParsedManifest(parse)` → a `ParsedManifest`-compatible object plus a
    `transport` block (driver / plate / VIN / vehicle / departure / arrival /
    ETA) lifted from the header.
  - `ccrsDateToIso(v)` — normalizes CCRS dates/datetimes to `YYYY-MM-DD`.
  - `__runCcrsManifestCsvTests()` — 53 self-tests (run via a throwaway tsx
    harness), including the real LCB blank-template layout.
- **Action** `importManifestCsvAction` in
  `src/app/admin/inventory/intake/actions.ts`: parse → map → `stageManifest`
  (same path as JSON) → seed transport/ETA via `updateManifestTransport` →
  redirect to the manifest review screen. Then the existing pipeline
  (pending → in_transit → received → accept/reject dock) takes over unchanged.
- **UI**: a "Or paste the CCRS manifest.csv" card on `/admin/inventory/intake`.
- `source_format = 'ccrs-csv'` is stored on `inbound_manifests` (free-text
  column, no schema change needed); lab rows are tagged `ccrs-manifest-csv`.

No database migration is required for this slice.
