-- Rollback for 0262_vendor_ach_esign.sql (R39 S7).
--
-- Refuses once any vendor has SIGNED: a signed invite is the evidence for a
-- vendor authorization (E-SIGN 7001(d), RCW 1.80.110; owner Q7/Q8) and must
-- not be dropped with the table. Unsigned (sent / cancelled) invites hold no
-- agreement and go with the table.
--
-- The e-signed documents, authorizations and vault rows live in 0143/0258
-- tables and are NOT touched by this rollback.
do $$
begin
  if to_regclass('public.vendor_esign_invites') is not null
     and exists (select 1 from public.vendor_esign_invites where state in ('signed', 'countersigned', 'rejected')) then
    raise exception 'ROLLBACK REFUSED: vendor_esign_invites holds signed invites (signing evidence). Export them first; do not drop.';
  end if;
end $$;

drop function if exists public.vendor_esign_reject(uuid, uuid, text);
drop function if exists public.vendor_esign_countersign(uuid, uuid, text, jsonb);
drop function if exists public.vendor_esign_complete(uuid, timestamptz, text, text, text, text, jsonb, jsonb, jsonb, jsonb);
drop table if exists public.vendor_esign_invites;
drop function if exists public.vendor_esign_guard();
