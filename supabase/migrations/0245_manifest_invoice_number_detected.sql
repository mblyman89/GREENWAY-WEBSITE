-- 0245_manifest_invoice_number_detected.sql  (R26)
-- Persist the invoice / order # FOUND in a manifest's documents.
--
-- Before R26 the Invoice # column was derived at read time from ONE document
-- (the stored raw_payload: the primary manifest's text or the transfer JSON).
-- The vendor's INVOICE PDF riding the same email, where the invoice/order #
-- actually prints, was never consulted, and "Run AI extract" found the number
-- but never saved it. R26 scans ALL of a manifest's documents
-- (invoice-number-core) and stores what it found here, with provenance.
--
-- Display precedence (manifest-table-core.invoiceNumberForRow):
--   invoice_number_override (owner) > invoice_number_detected (this column;
--   the transfer JSON is scanned first, vision values are grounded in the PDF
--   text layer) > payload re-scan (rows staged before R26) > manifest_number.
--
-- Additive + idempotent. NULL by default: every existing row keeps its current
-- derived Invoice # until a document scan finds one. The app's writer is
-- no-op-safe when this migration has not been applied yet (42703 / PGRST204).
alter table public.inbound_manifests
  add column if not exists invoice_number_detected text,
  add column if not exists invoice_number_source text;

comment on column public.inbound_manifests.invoice_number_detected is
  'Invoice/Order # found by scanning ALL of the manifest''s documents (R26). Never the manifest number. Owner override still wins.';
comment on column public.inbound_manifests.invoice_number_source is
  'Provenance of invoice_number_detected, e.g. "invoice:vision+layer:QGT_INVOICE.pdf" (role:how:document).';
