# CCRS Hardening II + Batch Trust — Roadmap (Slices 93–98)

**Owner request (verbatim):** "Yes please proceed with the next 6 slices. Start with
whatever you think is most logical. I trust you to use your best judgement to keep me safe."

**Best-judgment rationale.** The previous round hardened CCRS file *generation*
(Slices 87–92). Guardrails that have never been exercised against real batch output,
or whose severity is mis-classified, can't be fully trusted. This round makes the
batch **trustworthy end-to-end**: correct error severity, a self-verifying dry-run,
and an employee-facing "do not upload until errors are fixed" gate. It closes a real
gap found while planning: Slice-92 `ERROR —` product warnings were being surfaced as
mere `warning` severity, so a batch-blocking mis-mapping looked harmless.

All work follows the standing rules: grounded (never guessed), drafts-only,
idempotent, branch → PR → squash-merge, money in cents, Pacific dates, and the
binding **CCRS compliance** rule (valid enums, 3-row header, exact columns, clamps).

---

## Slice 93 — Sync-issue severity is honest (guardrail integrity)  [CRITICAL]
- **Problem:** `buildCcrsBatch` promotes every file warning to `severity: "warning"`,
  even the Slice-92 `ERROR —` product warnings (invalid InventoryCategory/Type) that
  will get the WHOLE batch rejected by the LCB. It also caps at 5 warnings/file, so a
  6th blocking error can vanish.
- **Fix (pure + wired):** add `classifyWarning(message)` in `ccrs-batch-core.ts` →
  `"error" | "warning"` (an `ERROR`-prefixed or known-blocking message ⇒ error).
  In `buildCcrsBatch`, map each carried warning through it; raise the per-file cap for
  ERROR-level messages so blocking issues are never hidden; keep non-error noise capped.
- **Tests:** `ERROR —` ⇒ error; ordinary note ⇒ warning; blocking never dropped.

## Slice 94 — End-to-end CCRS batch dry-run harness (verifiable trust)  [HIGH]
- **Problem:** no offline, seedable verification that a *whole* assembled batch is
  byte-correct. We test builders in isolation but never the composed output.
- **Fix (pure):** a `verifyCcrsBatch(files)` in `ccrs-batch-core.ts` that, given the
  assembled `{type, csv}` files, asserts for EACH: exact 3-row header, `NumberRecords`
  == data-row count, header row == `CCRS_COLUMNS[type]`, `\r\n` line endings, every
  data row has the right column count, dates look `MM/DD/YYYY`, and (Product) every
  category/type pair validates or is flagged. Returns a structured report (never
  throws). Add `__runCcrsBatchCoreTests()` cases with hand-built good/bad batches.
- **No network / no DB** — pure over the produced strings.

## Slice 95 — "Do not upload" gate + error summary in README & report  [HIGH]
- **Fix:** in the batch-export README and the sync-report surface, when any `error`
  sync issue exists, lead with a bold **"⛔ DO NOT UPLOAD — N blocking error(s) must
  be fixed first"** banner and list errors before warnings; show counts. Wire the
  pure `verifyCcrsBatch` report into the README so the downloaded zip self-documents.
- **Tests:** README contains the gate line iff errors exist.

## Slice 96 — Batch export unit-safety: excise/tax + quantity sanity  [HIGH]
- **Fix:** add pure `verifySaleNumericColumns(rows)` checks that Sale rows have
  non-negative Quantity/UnitPrice and that tax columns are integers-in-cents-consistent
  with our money rule; flag negatives/NaN as errors (grounded in the Sale template).
  Surface via sync issues. NO silent correction.
- **Tests:** negative qty flagged; good rows pass.

## Slice 97 — Vendor intake: employee validation queue (drafts-only)  [MED]
- Reuse the EXISTING `intake-parser.ts` (WCIA + generic). Add a pure
  `summarizeIntakeForReview(parsed)` that produces an employee-facing, drafts-only
  review summary (line count, $0/sample flags, missing COA, vendor license present?)
  so a human validates before anything is committed. NO auto-commit.
- **Tests:** summary flags samples + missing COA.
- **DEFERRED (needs your decision):** inbound `vendor_intake@` email webhook infra —
  I will NOT guess the mail provider/DNS; raised at end of round.

## Slice 98 — Vendor ACH draft file (reuse NACHA core, drafts-only)  [MED]
- Reuse EXISTING `nacha-core.ts` (`buildNachaFile`). Add a pure
  `vendorPaymentsToNacha(payments, originator)` adapter that maps vendor payables
  (amounts in CENTS) → `AchEntry[]` and returns the NACHA result, plus a validation
  pass (routing check-digit, positive amounts). Output is a DRAFT for employee review
  before transmission. NO bank transmission.
- **Tests:** valid payment builds; bad routing flagged.

---

## STATUS
- [x] Slice 93 — Honest sync-issue severity — CRITICAL
- [x] Slice 94 — E2E batch dry-run harness (verifyCcrsBatch) — HIGH
- [x] Slice 95 — "Do not upload" gate + error summary — HIGH
- [x] Slice 96 — Sale numeric-column safety — HIGH
- [ ] Slice 97 — Vendor intake review summary (drafts-only) — MED
- [ ] Slice 98 — Vendor ACH draft (reuse NACHA) — MED
