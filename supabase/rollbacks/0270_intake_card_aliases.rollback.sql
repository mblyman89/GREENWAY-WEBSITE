-- =============================================================================
-- ROLLBACK for 0270_intake_card_aliases.sql (R50 A1)
-- =============================================================================
-- This file is NOT a migration. It lives outside supabase/migrations on
-- purpose, so the migration runner never applies it.
--
-- Running this FORGETS every saved "this product is that Cultivera card"
-- answer. The next delivery of each of those products is added as its own
-- card again (the pre-A1 behaviour) and the suggestion shows again. Nothing
-- on the live menu changes when it runs. The code treats a missing table as
-- "no aliases".
-- =============================================================================

drop table if exists public.intake_card_aliases;
notify pgrst, 'reload schema';
