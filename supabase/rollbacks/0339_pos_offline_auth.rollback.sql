-- supabase/rollbacks/0339_pos_offline_auth.rollback.sql  (D161)
--
-- Restores the pos_sale_events event_type CHECK exactly as 0301 set it
-- (verified against production 2026-11-04). Run ONLY if 0339 must be undone.
--
-- Any offline_auth rows already stored would violate the restored CHECK, so
-- this file refuses to run while they exist (move or delete them first, after
-- the owner has reviewed them). Offline unlock keeps working on the iPads
-- without 0339; only the audit events are rejected (and kept on the iPad).

do $$
begin
  if exists (select 1 from public.pos_sale_events where event_type = 'offline_auth') then
    raise exception 'offline_auth rows exist; review them before rolling back 0339';
  end if;
end $$;

alter table public.pos_sale_events
  drop constraint if exists pos_sale_events_event_type_check;
alter table public.pos_sale_events
  add constraint pos_sale_events_event_type_check
  check (event_type in ('sale', 'punch', 'no_sale', 'manual_id_verification', 'medical_card_capture', 'cart_adjustment'));
