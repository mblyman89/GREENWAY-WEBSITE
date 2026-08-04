-- 0151_manifest_invoice_override.sql
-- Editable Invoice # for the intake table.
--
-- The Invoice # shown in the "Incoming (email)" table is DERIVED at read time
-- (order/invoice # parsed from the vendor payload, else the manifest number).
-- The owner needs to CORRECT it when the derived value is wrong. This adds a
-- dedicated, purpose-built override column that, when set, wins over the
-- derived value everywhere the invoice # is displayed.
--
-- Additive + idempotent (safe to run more than once). NULL by default, so every
-- existing row keeps its current derived Invoice # until the owner overrides it.
alter table public.inbound_manifests
  add column if not exists invoice_number_override text;

comment on column public.inbound_manifests.invoice_number_override is
  'Owner-entered Invoice/Order # correction. When non-null, overrides the value derived from raw_payload/manifest_number in the intake UI.';
