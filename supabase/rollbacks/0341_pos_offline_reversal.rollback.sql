-- supabase/rollbacks/0341_pos_offline_reversal.rollback.sql  (D170 O2/O3)
--
-- Restores the pos_sale_events event_type CHECK exactly as 0340 set it.
-- Run ONLY if 0341 must be undone.
--
-- Any reversal rows already stored would violate the restored CHECK, so
-- this file refuses to run while they exist (review them first). Without
-- 0341 the iPads keep offline voids and returns queued (rejected, still shown).

do $$
begin
  if exists (select 1 from public.pos_sale_events where event_type = 'reversal') then
    raise exception 'reversal rows exist; review them before rolling back 0341';
  end if;
end $$;

alter table public.pos_sale_events
  drop constraint if exists pos_sale_events_event_type_check;
alter table public.pos_sale_events
  add constraint pos_sale_events_event_type_check
  check (event_type in ('sale', 'punch', 'no_sale', 'manual_id_verification', 'medical_card_capture', 'cart_adjustment', 'offline_auth', 'till_action'));
