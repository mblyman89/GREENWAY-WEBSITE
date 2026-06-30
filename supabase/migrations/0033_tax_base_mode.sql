-- 0033_tax_base_mode.sql  (Run 5 / Slice 21)
--
-- Tax-base robustness: record HOW stored line prices relate to tax, so the
-- reporting/compliance engine self-corrects if pricing semantics ever change.
--
--   pre_tax        -> stored price is the pre-tax, post-discount base (today).
--   tax_inclusive  -> stored price already includes tax; reports back it out.
--   auto           -> detect per-order from header figures (subtotal/total/tax).
--
-- Idempotent: safe to run multiple times.

ALTER TABLE public.tax_settings
  ADD COLUMN IF NOT EXISTS tax_base_mode text NOT NULL DEFAULT 'pre_tax';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tax_settings_tax_base_mode_chk'
  ) THEN
    ALTER TABLE public.tax_settings
      ADD CONSTRAINT tax_settings_tax_base_mode_chk
      CHECK (tax_base_mode IN ('pre_tax', 'tax_inclusive', 'auto'));
  END IF;
END $$;

-- Ensure the singleton row reflects the default if it predates this column.
UPDATE public.tax_settings
  SET tax_base_mode = COALESCE(tax_base_mode, 'pre_tax')
  WHERE tax_base_mode IS NULL;
