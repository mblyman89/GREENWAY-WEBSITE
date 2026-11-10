-- Rollback for 0356_menu_card_fallback_many.sql (D225).
-- Run MANUALLY only if needed.
--
-- Goes back to ONE picture per website category (the 0355 shape). For each
-- category the FIRST picture in the owner order is kept and the extra ones
-- are removed from the list. The pictures themselves stay in the media
-- library. Cards stop rotating and show the one kept picture.
delete from public.menu_card_fallback_images f
 using (
   select id,
          row_number() over (partition by website_category order by sort_order, created_at, id) as rn
     from public.menu_card_fallback_images
 ) ranked
 where f.id = ranked.id
   and ranked.rn > 1;

drop index if exists public.idx_menu_card_fallback_images_category_order;
drop index if exists public.uq_menu_card_fallback_images_category_media;

alter table public.menu_card_fallback_images drop constraint if exists menu_card_fallback_images_sort_order_check;
alter table public.menu_card_fallback_images drop constraint if exists menu_card_fallback_images_pkey;
alter table public.menu_card_fallback_images add constraint menu_card_fallback_images_pkey primary key (website_category);
alter table public.menu_card_fallback_images drop column if exists sort_order;
alter table public.menu_card_fallback_images drop column if exists id;

notify pgrst, 'reload schema';
