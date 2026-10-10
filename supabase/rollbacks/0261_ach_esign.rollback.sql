-- Rollback for 0261_ach_esign.sql (R39 S6).
--
-- Refuses once anything has been SIGNED: a signed session is evidence for an
-- authorization (E-SIGN 7001(d), RCW 1.80.110; owner Q7/Q8) and must not be
-- dropped with the table. Unsigned (started / cancelled) sessions hold no
-- agreement and go with the table.
--
-- The e-signed documents and authorizations live in 0258 tables and are NOT
-- touched by this rollback.
do $$
begin
  if to_regclass('public.ach_esign_sessions') is not null
     and exists (select 1 from public.ach_esign_sessions where state = 'signed') then
    raise exception 'ROLLBACK REFUSED: ach_esign_sessions holds signed sessions (signing evidence). Export them first; do not drop.';
  end if;
end $$;

drop function if exists public.ach_esign_complete(uuid, uuid, timestamptz, text, text, text, boolean, jsonb, jsonb, jsonb);
drop table if exists public.ach_esign_sessions;
drop function if exists public.ach_esign_guard();
