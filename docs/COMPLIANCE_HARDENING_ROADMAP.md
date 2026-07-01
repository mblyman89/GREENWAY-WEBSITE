# Compliance Hardening — Roadmap (Slices 105–110)

**Owner intent (verbatim, this round):** "at this point I want to harden the ccrs
functions, and make sure every compliance related thing is baked in to protect me from
making a violation." + "please do the expert professional standard way, even if its the
hard way."

**Theme.** Turn compliance from *validates-on-demand* into *blocks-the-dangerous-action-
at-the-gate*. No new features — every slice makes an existing capability refuse to let the
owner commit a violation. Grounded in the WA LCB CCRS retailer file spec, WAC 314-55, and
the DOH medical rules already documented. Drafts-only for machine output; idempotent
migrations (owner runs manually); branch → PR → squash-merge; money in cents.

Standing rules respected: CCRS compliance + 🔴 DOH MEDICAL CANNABIS COMPLIANCE (binding).

---

## Slice 105 — CCRS pre-submission HARD GATE [HIGH] ✅ DONE
- PURE `ccrs-submit-gate-core.ts` `assertCcrsBatchSubmittable({syncIssues, verifierProblems,
  files, classifyWarning})` → `{ submittable, errors, warnings, issues }`. Consolidates
  builder sync issues + offline verifier problems + per-file warnings (classified with the
  REAL `classifyWarning`, so ERROR-prefixed file warnings are blocking, not buried).
- Export route `/admin/reports/compliance/batch-export` now **REFUSES (409)** to emit the
  .zip when any blocking error exists — the malformed CSVs are never created. Previously it
  wrote a DO-NOT-UPLOAD note into the README but still handed over the bad files.
- Report page uses the SAME verdict: the download button is **disabled** with the error
  count until the batch is clean, so the UI and the route agree exactly.
- Tests: 10 tsx assertions (clean/ sync-error / verifier-error / ERROR-file-warning /
  dedup / ordering / summary / injected classifier).

## Slice 106 — CCRS reporting-deadline guard [HIGH]
- PURE deadline calculator grounded in the CCRS retailer reporting cadence. Flag any period
  whose submission window is open/closing/overdue relative to today, and whether a batch was
  exported for it (using `ccrs_export_batches`). Surface a red signal before it's late.

## Slice 107 — Inventory "cannot go live dirty" gate [HIGH]
- Harden lot activation: a lot missing a required CCRS identifier / lab result / with a
  failed COA cannot be flipped to active/sellable. Reuse the Slice-97 intake-review flags;
  block `acceptManifest` / `finalizeManifestDispositions` / lot activation with reasons.

## Slice 108 — CCRS identifier integrity assertions [MED]
- Extend `ccrs-identifiers.ts` with strict format assertions (UBI/license shape, non-empty,
  no in-batch collisions) so a malformed or duplicate identifier can never reach a file.

## Slice 109 — Sales-limit enforcement at POS (hard block + logged override) [HIGH]
- Extend `sales-limits-core` so an over-limit cart is BLOCKED (medical vs. rec profile chosen
  from VERIFIED card status), with a permission-gated, logged manager override (auditable).

## Slice 110 — "Compliance Health" panel [MED]
- One read-only screen running every gate: latest CCRS batch submittable?, deadline status,
  dirty lots, expiring medical cards, exempt-record completeness. One-glance "am I safe?".

---

## STATUS
- [x] Slice 105 — CCRS pre-submission hard gate — HIGH
- [ ] Slice 106 — CCRS reporting-deadline guard — HIGH
- [ ] Slice 107 — Inventory can't-go-live-dirty gate — HIGH
- [ ] Slice 108 — CCRS identifier integrity assertions — MED
- [ ] Slice 109 — Sales-limit enforcement at POS — HIGH
- [ ] Slice 110 — Compliance Health panel — MED
