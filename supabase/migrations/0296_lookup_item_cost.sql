-- 0296_lookup_item_cost.sql  (R74 S37)
--
-- The exact cost of each product lookup, so the cost ledger by manifest and
-- by vendor is a sum of real numbers instead of an estimate.
--
-- lookup_job_items.cost_cents: estimated US cents (Gemini Batch prices x the
-- tokens and searches Google reported for this product's answer). A product
-- family (2nd lot, size variant) is asked ONCE: the cost lands on its first
-- lot; the other lots stay 0. A retry adds to it. null = not measured (live
-- lookups, rows from before this migration): the console estimates those and
-- says so. Idempotent; additive only.
alter table public.lookup_job_items add column if not exists cost_cents numeric(10,3);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lookup_job_items_cost_cents_check') then
    alter table public.lookup_job_items
      add constraint lookup_job_items_cost_cents_check check (cost_cents is null or cost_cents >= 0);
  end if;
end $$;

comment on column public.lookup_job_items.cost_cents is
  'R74 S37: estimated US cents this product''s lookup cost at Gemini Batch prices (first lot of a family carries it; null = not measured).';

notify pgrst, 'reload schema';
