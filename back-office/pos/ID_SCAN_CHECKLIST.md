# POS ID Scan — Handoff Verification Checklist

Use this to confirm the hardened ID-scan flow is working. Companion to
`ID_SCAN_RESEARCH.md` and `ID_SCAN_ROADMAP.md`; scanner config in
`DURASCAN_D760_SETUP.md`.

## A. Code / build (already verified at merge)

- [x] `isCompleteAamvaPayload` exists in `src/lib/pos/id-scan-core.ts` and returns true
      only for a parseable AAMVA payload with valid DBB (DOB) **and** DBA (expiry).
- [x] `feedIdCaptureKey` + `ID_CAPTURE_FALLBACK_IDLE_MS` exist in
      `src/lib/pos/id-capture-core.ts`.
- [x] `src/app/pos/SaleFlow.tsx` ID gate uses `feedIdCaptureKey`, finalizes on
      `r.complete`, and re-arms the `ID_CAPTURE_FALLBACK_IDLE_MS` fallback timer.
- [x] Pure runner green: `npx tsx scripts/compliance/run-pure-selftests.ts`.
- [x] `npx tsc --noEmit` clean.
- [x] eslint clean on touched files.
- [x] vitest green for id-scan-core + id-capture-core (41/41).

## B. Scanner config (do once per D760 — see DURASCAN_D760_SETUP.md)

- [ ] D760 is in **HID / keyboard (Basic) mode**.
- [ ] Driver's License **PDF417** parsing enabled.
- [ ] Inter-character / transmit delay **minimized**.
- [ ] Suffix set to **Enter / CR**.
- [ ] Scanner paired to the iPad and typing into a text field works (test in Notes).

## C. Floor test (POS on the iPad)

- [ ] Open a new sale so the **ID gate** is showing ("Ready to scan").
- [ ] Scan the back (PDF417) of a **valid, unexpired, 21+** driver license.
      → Expected: finalizes **near-instantly**, no "reading" hang, sale proceeds.
- [ ] Scan an **expired** license → gate rejects with expiry error, offers manual.
- [ ] Scan an **under-21** license → gate rejects (age), offers manual.
- [ ] Scan a **non-AAMVA** barcode → gate does not hang; resolves via fallback and
      shows the parse error / manual path (no stray characters left in fields).
- [ ] Repeat the valid-license scan **5×** → consistent instant success (no
      intermittent 5–7s failure).

## D. Regression sanity

- [ ] Manual verification path still works (type DOB / expiry).
- [ ] Medical-card path unchanged.
- [ ] 40+ visual bypass unchanged.
- [ ] Typing into normal form fields (INPUT/TEXTAREA/SELECT) is **not** captured by the
      scan buffer.

## If a scan still fails

1. Confirm the scan lands in a plain text field as one continuous string ending in
   Enter (test in iPad Notes). If not, it is a **scanner config** issue → re-check
   section B / `DURASCAN_D760_SETUP.md`.
2. If it types but the gate still errors, capture the raw string and confirm it begins
   with `ANSI ` and contains `DBB` and `DBA`. Share it (with PII redacted) for
   diagnosis.
