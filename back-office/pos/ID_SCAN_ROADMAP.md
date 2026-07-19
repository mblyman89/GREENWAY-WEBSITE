# POS ID Scan — Roadmap & Slice Status

Roadmap for hardening the POS "scan an ID to start a sale" flow. Companion doc to
`ID_SCAN_RESEARCH.md` (design/root-cause) and `ID_SCAN_CHECKLIST.md` (verification).

## Goal

Scanning a driver-license PDF417 on the POS ID gate should finalize **near-instantly**
and reliably, on the current front end (Safari on iPad, plain URL), with no new
hardware or companion software.

## Architecture decision

- **Chosen:** keyboard-wedge (HID) capture + **content-driven completion**. The scanner
  types the decoded AAMVA payload; the app finalizes the instant the buffer parses to a
  gate-ready license, with a stall-proof idle fallback. Correct for
  Safari-on-iPad → App Store. No dependencies added.
- **Ruled out for this setup:** Socket CaptureJS / Companion (local-only,
  `localhost:18481`, no iOS Companion service; would require Rumba or a native app).
  See research doc §5.

## Slices

| Slice | Status | PR   | Main commit | Summary |
|-------|--------|------|-------------|---------|
| IDS-1 | ✅ done | #593 | 7e988f7f | Pure core: `isCompleteAamvaPayload`, `feedIdCaptureKey`, `ID_CAPTURE_FALLBACK_IDLE_MS`; self-tests in `id-scan-core.ts` / `id-capture-core.ts` + vitest. |
| IDS-2 | ✅ done | #594 | 7abc11ac | Wire `SaleFlow.tsx` ID gate: finalize-on-complete (`feedIdCaptureKey` → `r.complete` → `finalizeNow()`), else re-arm `ID_CAPTURE_FALLBACK_IDLE_MS` fallback timer. |
| IDS-3 | 🚧 this PR | — | — | Handoff docs: research, roadmap, checklist, D760 setup sheet. |

## Verify suite (baseline, all green)

- Pure runner: `npx tsx scripts/compliance/run-pure-selftests.ts`
- Types: `npx tsc --noEmit`
- Lint: eslint on touched files
- Unit: `node_modules/.bin/vitest run` — id-scan-core + id-capture-core files 41/41
- Crawler: pytest (unrelated to this feature)

Post-IDS-1 counts: id-scan-core 66/0, id-capture-core 19/0.

## Future (only if it becomes necessary)

- **Native CaptureSDK (App-Mode):** if and only if a **native iOS app** ships (App
  Store), Socket's App-Mode delivers 2D data faster than HID and enables richer scanner
  control. This is optional — the HID + content-driven path already gives instant,
  reliable results. Do **not** adopt CaptureSDK/Companion for the current
  Safari-on-iPad front end.
- **Telemetry (optional):** if any floor reliability issue recurs, add lightweight
  timing logs (first-key → complete) behind a debug flag to measure real-world scan
  latency; not required today.
