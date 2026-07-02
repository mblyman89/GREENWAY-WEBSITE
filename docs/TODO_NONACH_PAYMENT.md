# Non-ACH vendor payment recording (close hanging invoices)

Owner request (verbatim): "If I'm ever required for whatever reason to write a
check instead of ach, I need a way to tell the system that I paid via another
method. So I dont have hanging invoices. Please add this. Follow the standing
rules."

Goal: record a payment against an ACCEPTED manifest (the "invoice") via a NON-ACH
method (check / cash / wire / other) so the manifest stops showing as an
outstanding payable. Same guardrails as ACH (overpay BLOCKED, partial WARNING).
Money in CENTS. Drafts/records only — nothing transmitted. Manual migration.

## Tasks
- [x] Re-read current main HEAD: vendor-payables-store.ts, actions.ts,
      VendorAchForm.tsx, vendor-ach-core.ts, 0067 migration, page.tsx
- [x] Migration 0068: add payment_method + reference columns (idempotent)
- [x] Store: extend RecordManifestPaymentInput with paymentMethod + reference
- [x] Action: recordManualPaymentAction (guardrails -> record -> audit -> revalidate)
- [x] UI: ManualPaymentForm.tsx (method/reference/amount/note), mount on page
- [x] Verify: rm -rf .next && tsc --noEmit && npm run build
- [x] Verify passed: tsc --noEmit clean; npm run build BUILD_DONE_EXIT=0
      (/admin/vendor-payments in route table, no compile/type errors)
- [ ] Branch + PR + (owner) squash-merge; remind owner to apply 0068 manually
