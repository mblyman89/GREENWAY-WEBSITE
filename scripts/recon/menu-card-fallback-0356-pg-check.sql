-- D225 post-apply scenario check for 0356_menu_card_fallback_many.
-- Run by scripts/compliance/verify-migrations-execute.ts after every
-- migration has been applied. One transaction, rolled back.
--
-- The scenario:
--   * an existing 0355 row (one picture per category) survives the upgrade
--     with an id and sort_order 0;
--   * a category now holds MANY pictures, in sort order;
--   * the SAME picture twice in one category is refused;
--   * the same picture in two different categories is fine;
--   * an unknown category and a negative sort order are refused;
--   * removing the media row removes only its list entries (cascade);
--   * service role only, RLS on;
--   * the rollback keeps the FIRST picture per category, then re-apply runs.
\set ON_ERROR_STOP on
begin;

-- Start from the 0355 shape with one real row, then upgrade.
\ir ../../supabase/rollbacks/0356_menu_card_fallback_many.rollback.sql

insert into public.media_assets (id, storage_key, filename, mime_type, status, usage_type, title) values
  ('00000000-0000-4000-8000-000000035601', 'product/a356000000000001-a.png', 'a.png', 'image/png', 'published', 'product', 'Jar one'),
  ('00000000-0000-4000-8000-000000035602', 'product/a356000000000002-b.png', 'b.png', 'image/png', 'published', 'product', 'Jar two'),
  ('00000000-0000-4000-8000-000000035603', 'product/a356000000000003-c.png', 'c.png', 'image/png', 'published', 'product', 'Jar three');

insert into public.menu_card_fallback_images (website_category, media_id)
  values ('flower', '00000000-0000-4000-8000-000000035601');

\ir ../../supabase/migrations/0356_menu_card_fallback_many.sql

do $$
declare
  refused boolean;
  first_id uuid;
begin
  select id into first_id from public.menu_card_fallback_images
   where website_category = 'flower' and sort_order = 0;
  if first_id is null then raise exception 'the existing 0355 row did not survive the upgrade'; end if;

  insert into public.menu_card_fallback_images (website_category, media_id, sort_order) values
    ('flower', '00000000-0000-4000-8000-000000035602', 1),
    ('flower', '00000000-0000-4000-8000-000000035603', 2);
  if (select count(*) from public.menu_card_fallback_images where website_category = 'flower') <> 3 then
    raise exception 'a category did not accept many pictures';
  end if;
  if (select string_agg(media_id::text, ',' order by sort_order) from public.menu_card_fallback_images where website_category = 'flower')
     <> '00000000-0000-4000-8000-000000035601,00000000-0000-4000-8000-000000035602,00000000-0000-4000-8000-000000035603' then
    raise exception 'sort order was not kept';
  end if;

  refused := false;
  begin
    insert into public.menu_card_fallback_images (website_category, media_id, sort_order)
      values ('flower', '00000000-0000-4000-8000-000000035602', 9);
  exception when unique_violation then refused := true;
  end;
  if not refused then raise exception 'the same picture twice in one category was accepted'; end if;

  insert into public.menu_card_fallback_images (website_category, media_id)
    values ('edible-solid', '00000000-0000-4000-8000-000000035602');

  refused := false;
  begin
    insert into public.menu_card_fallback_images (website_category, media_id)
      values ('pre-roll', '00000000-0000-4000-8000-000000035603');
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'an unknown website category was accepted'; end if;

  refused := false;
  begin
    insert into public.menu_card_fallback_images (website_category, media_id, sort_order)
      values ('topical', '00000000-0000-4000-8000-000000035603', -1);
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'a negative sort order was accepted'; end if;

  delete from public.media_assets where id = '00000000-0000-4000-8000-000000035602';
  if (select count(*) from public.menu_card_fallback_images where website_category = 'flower') <> 2 then
    raise exception 'removing one picture did not leave the other two';
  end if;
  if exists (select 1 from public.menu_card_fallback_images where website_category = 'edible-solid') then
    raise exception 'removing the picture left its list entry in another category';
  end if;

  if not has_table_privilege('service_role', 'public.menu_card_fallback_images', 'select')
     or not has_table_privilege('service_role', 'public.menu_card_fallback_images', 'insert')
     or not has_table_privilege('service_role', 'public.menu_card_fallback_images', 'update')
     or not has_table_privilege('service_role', 'public.menu_card_fallback_images', 'delete') then
    raise exception 'service_role is missing a grant on menu_card_fallback_images';
  end if;
  if has_table_privilege('anon', 'public.menu_card_fallback_images', 'select')
     or has_table_privilege('authenticated', 'public.menu_card_fallback_images', 'select')
     or has_table_privilege('authenticated', 'public.menu_card_fallback_images', 'insert') then
    raise exception 'menu_card_fallback_images is reachable outside the service role';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.menu_card_fallback_images'::regclass) then
    raise exception 'row level security is off on menu_card_fallback_images';
  end if;
end $$;

-- Re-run (idempotent), then rollback keeps the first picture, then re-apply.
\ir ../../supabase/migrations/0356_menu_card_fallback_many.sql
\ir ../../supabase/rollbacks/0356_menu_card_fallback_many.rollback.sql
do $$
begin
  if (select count(*) from public.menu_card_fallback_images where website_category = 'flower') <> 1 then
    raise exception 'rollback did not go back to one picture per category';
  end if;
  if (select media_id from public.menu_card_fallback_images where website_category = 'flower')
     <> '00000000-0000-4000-8000-000000035601'::uuid then
    raise exception 'rollback did not keep the first picture';
  end if;
end $$;
\ir ../../supabase/migrations/0356_menu_card_fallback_many.sql
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'menu_card_fallback_images' and column_name = 'sort_order'
  ) then
    raise exception 're-apply did not add sort_order';
  end if;
end $$;

\echo MENU CARD FALLBACK 0356 CHECK PASSED
rollback;
