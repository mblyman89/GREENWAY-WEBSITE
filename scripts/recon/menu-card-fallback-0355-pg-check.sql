-- D224 post-apply scenario check for 0355_menu_card_fallback_images.
-- Run by scripts/compliance/verify-migrations-execute.ts after every
-- migration has been applied. One transaction, rolled back.
--
-- The scenario:
--   * a fallback for a real website category is accepted;
--   * a second row for the SAME category is refused (one picture per category);
--   * an unknown category is refused;
--   * swapping the picture is an upsert on the category;
--   * removing the media row removes the fallback (cascade);
--   * service role only, RLS on;
--   * rollback then re-apply both run.
\set ON_ERROR_STOP on
begin;

\ir ../../supabase/migrations/0355_menu_card_fallback_images.sql

insert into public.media_assets (id, storage_key, filename, mime_type, status, usage_type, title) values
  ('00000000-0000-4000-8000-000000035501', 'product/a355000000000001-a.png', 'a.png', 'image/png', 'published', 'product', 'Flower jar'),
  ('00000000-0000-4000-8000-000000035502', 'product/a355000000000002-b.png', 'b.png', 'image/png', 'published', 'product', 'Gummies');

do $$
declare
  refused boolean;
begin
  insert into public.menu_card_fallback_images (website_category, media_id)
    values ('flower', '00000000-0000-4000-8000-000000035501');

  refused := false;
  begin
    insert into public.menu_card_fallback_images (website_category, media_id)
      values ('flower', '00000000-0000-4000-8000-000000035502');
  exception when unique_violation then refused := true;
  end;
  if not refused then raise exception 'a second picture for the same category was accepted'; end if;

  refused := false;
  begin
    insert into public.menu_card_fallback_images (website_category, media_id)
      values ('pre-roll', '00000000-0000-4000-8000-000000035502');
  exception when check_violation then refused := true;
  end;
  if not refused then raise exception 'an unknown website category was accepted'; end if;

  insert into public.menu_card_fallback_images (website_category, media_id)
    values ('flower', '00000000-0000-4000-8000-000000035502')
    on conflict (website_category) do update set media_id = excluded.media_id, updated_at = now();
  if (select media_id from public.menu_card_fallback_images where website_category = 'flower')
     <> '00000000-0000-4000-8000-000000035502'::uuid then
    raise exception 'the upsert did not swap the picture';
  end if;
  if (select count(*) from public.menu_card_fallback_images) <> 1 then
    raise exception 'the upsert added a row instead of swapping';
  end if;

  insert into public.menu_card_fallback_images (website_category, media_id)
    values ('edible-solid', '00000000-0000-4000-8000-000000035501');
  delete from public.media_assets where id = '00000000-0000-4000-8000-000000035501';
  if exists (select 1 from public.menu_card_fallback_images where website_category = 'edible-solid') then
    raise exception 'removing the picture left its fallback row';
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

-- Rollback then re-apply, so both files are proven.
\ir ../../supabase/rollbacks/0355_menu_card_fallback_images.rollback.sql
do $$
begin
  if to_regclass('public.menu_card_fallback_images') is not null then raise exception 'rollback left the table'; end if;
end $$;
\ir ../../supabase/migrations/0355_menu_card_fallback_images.sql
do $$
begin
  if to_regclass('public.menu_card_fallback_images') is null then raise exception 're-apply did not create the table'; end if;
end $$;

\echo MENU CARD FALLBACK 0355 CHECK PASSED
rollback;
