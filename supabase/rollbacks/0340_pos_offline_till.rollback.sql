-- supabase/rollbacks/0340_pos_offline_till.rollback.sql  (D170 O1)
--
-- Restores the pos_sale_events event_type CHECK exactly as 0339 set it
-- (verified against production 2026-11-04). Run ONLY if 0340 must be undone.
--
-- Any till_action rows already stored would violate the restored CHECK, so
-- this file refuses to run while they exist (review them first). Without
-- 0340 the iPads keep offline drawer actions queued (rejected, still shown).

do $$
begin
  if exists (select 1 from public.pos_sale_events where event_type = 'till_action') then
    raise exception 'till_action rows exist; review them before rolling back 0340';
  end if;
end $$;

alter table public.pos_sale_events
  drop constraint if exists pos_sale_events_event_type_check;
alter table public.pos_sale_events
  add constraint pos_sale_events_event_type_check
  check (event_type in ('sale', 'punch', 'no_sale', 'manual_id_verification', 'medical_card_capture', 'cart_adjustment', 'offline_auth'));
