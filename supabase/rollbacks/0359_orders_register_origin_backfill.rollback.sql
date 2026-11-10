-- Rollback for 0359_orders_register_origin_backfill.sql (D226).
-- Run MANUALLY only if needed.
--
-- Puts every order 0359 relabelled back to the origin it had before (it was
-- greenway for all of them), using the list 0359 kept, then drops that
-- list. Nothing is deleted from public.orders. The app still keeps register
-- sales off the Online Orders board afterwards, because it also recognises
-- them by pos_client_uuid.
update public.orders o
   set origin = b.previous_origin
  from public.orders_origin_backfill_0359 b
 where o.id = b.order_id
   and o.origin = 'register';

drop table if exists public.orders_origin_backfill_0359;

notify pgrst, 'reload schema';
