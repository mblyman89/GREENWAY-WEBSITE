-- =============================================================================
-- ROLLBACK for 0245_manifest_invoice_number_detected.sql (R26)
-- =============================================================================
-- This file is NOT a migration. It lives outside supabase/migrations on
-- purpose, so the migration runner (scripts/compliance/verify-migrations-execute.ts,
-- which reads only supabase/migrations/*.sql) never applies it.
--
-- Reverting the code is enough; the two columns can stay unused. Running this
-- FORGETS every invoice / order # the document scan found. The Invoice #
-- column falls back to the owner override, then the stored payload re-scan,
-- then the manifest number (the pre-R26 behaviour). The timeline keeps its
-- "Invoice # found in the documents" events.
-- =============================================================================

alter table public.inbound_manifests drop column if exists invoice_number_source;
alter table public.inbound_manifests drop column if exists invoice_number_detected;
