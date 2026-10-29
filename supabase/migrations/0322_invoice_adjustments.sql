-- 0322_invoice_adjustments.sql  (Fix Phase 3.4 · F-04-24 · owner Fix 3.4 message)
--
-- WHY. The owner, verbatim:
--   "this new manifest has a credit amount on it, and the system did not see
--    it or did and disregarded it. i am hoping we can add intelligent logic to
--    the system that helps it identify credits, discounts, price reductions,
--    negative numbers, etc, so it can give an accurate invoice amount."
--   "if the system isnt able to work out if there is a credit or discount, i
--    need a way to add a credit or discount to the invoice before paying for
--    it in the vendor payments page."
-- His Bellevue Cannabis Company invoice (#01M6 24SC 4JCC B917) printed 27 lots
-- ($2,974.70), line 28 "- Discount: Credit 1 -299.70 -299.70" and "Invoice
-- Total: 2,675.00". The manifest parser keeps lot lines only, so the payable
-- was $299.70 too high.
--
-- WHAT.
--   inbound_manifests (columns only, all nullable / defaulted):
--     invoice_total_minor        bigint  - the invoice's printed total (cents)
--     invoice_adjustments        jsonb   - credits/discounts READ from the
--                                          invoice: [{kind, amountMinor, label}]
--     invoice_adjustments_minor  bigint  - their sum (<= 0), what the payable
--                                          and the vendor bill subtract
--     invoice_adjustments_note   text    - plain-English reconciliation note
--     invoice_manual_adjustments jsonb  - credits/discounts a manager ADDS by
--                                          hand on Vendor payments:
--       [{id, kind, amountMinor (<0), reason, by, at, voidedAt?, voidedBy?, voidReason?}]
--       Never deleted: a wrong one is voided (kept with who/when/why), and
--       each add/void is also written to the delivery's timeline
--       (manifest_events). Kept on inbound_manifests (a WIPE table) so the
--       factory reset (0240, 139 tables) needs no change.
--
-- SAFE / IDEMPOTENT: add column if not exists and a guarded check.
-- Nothing existing is changed. Apply MANUALLY in the
-- Supabase SQL editor. Before it is applied the app still works: credits are
-- shown on the page but not saved, and "Add credit" says the migration is
-- needed.
-- Rollback: supabase/rollbacks/0322_invoice_adjustments.rollback.sql.

do $$
begin
  if to_regclass('public.inbound_manifests') is null then
    raise exception 'MIGRATION_OUT_OF_ORDER: 0322 needs public.inbound_manifests';
  end if;
end $$;

alter table public.inbound_manifests
  add column if not exists invoice_total_minor bigint,
  add column if not exists invoice_adjustments jsonb not null default '[]'::jsonb,
  add column if not exists invoice_adjustments_minor bigint not null default 0,
  add column if not exists invoice_adjustments_note text,
  add column if not exists invoice_manual_adjustments jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inbound_manifests_invoice_adjustments_minor_nonpos') then
    alter table public.inbound_manifests
      add constraint inbound_manifests_invoice_adjustments_minor_nonpos check (invoice_adjustments_minor <= 0);
  end if;
end $$;
