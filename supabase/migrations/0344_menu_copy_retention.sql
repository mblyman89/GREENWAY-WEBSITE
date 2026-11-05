-- supabase/migrations/0344_menu_copy_retention.sql  (PERF round P1/P2)
--
-- Owner (2026-11-05): "A lot of the pages, main admin cockpit included, are very very slow to
-- load ... I need my back office to be lightning fast." Then: "Please proceed to fix all issues,
-- big and small ... I want optimization and efficiency to be paramount now that we are in live
-- production."
--
-- WHY (measured read-only 2026-11-05, pg_stat_statements since 2026-10-28):
--   * menu_items held 720,163 rows (755 MB of a 1.4 GB database) for 2,288 products: every
--     received or re-staged manifest writes a FULL new copy of the menu (about 2,200 items) and
--     nothing ever removed the old copies. 327 versions in 5 days, 93 in the last 24 hours.
--   * latest_menu_facts (0305) sorted every one of those rows on each call: 6.0 s for all keys,
--     2.8 s for 40 keys; 880 calls averaged 879 ms (max 7.9 s, against the 8 s API timeout). The
--     app's fallback, a 1,000-row OFFSET walk of the whole table, ran 5,622 times at 2.15 s each
--     (3.4 hours of database time), the single largest cost on the server.
--
-- WHAT THIS FILE DOES:
--   1. product_latest_facts: ONE row per product key holding the newest category / POS type /
--      POS category / vendor / brand, by EXACTLY the 0305 rule (created_at descending, id
--      ascending as the tie-break, blank keys skipped). Kept current by statement-level triggers
--      on menu_items (insert and update), and backfilled here from every existing row. Rows are
--      never deleted, so clearing old menu copies can never change a past sale's category.
--   2. latest_menu_facts(p_keys) keeps its signature and answer but reads that small table
--      (milliseconds instead of seconds). Now SECURITY INVOKER (service_role reads the table).
--   3. prune_menu_version_items(p_keep_archived, p_max_versions): removes the ITEMS (and, by the
--      existing ON DELETE CASCADE, the variants) of old ARCHIVED, INTAKE-origin, non-test menu
--      versions. The version row itself stays (history, counts, summary_json, fact review), and
--      gets summary_json.items_pruned_at / items_pruned. Always kept with their items: the
--      published version, every staged version, every import-origin version (import_id set:
--      the import pages read them), every test version, the newest p_keep_archived archived
--      intake versions (at least 3), and anything archived in the last 10 minutes. Bounded per
--      call (p_max_versions, 1..500) so an API call stays far below the 8 s timeout; returns
--      {versions, items, remaining}.
--
-- WHY NOTHING ELSE BREAKS (verified 2026-11-05): no table references menu_items / menu_variants
-- except menu_variants (cascade). order_lines.variant_id, inventory_lots.menu_source_variant_id
-- and pos_cart_adjustments.variant_id are TEXT source ids with zero matches against
-- menu_variants.id. publish_menu_version (0236) promotes a staged version; an archived version
-- is never re-published (clean_slate_test_data restores is_test rows only, which are kept).
--
-- SECURITY: the three trigger bodies (product_latest_facts_sync / _on_delete / _on_truncate) are
-- SECURITY DEFINER (justified): a trigger must keep the facts table current whichever role writes
-- menu_items, and they write only that table. No role can execute them directly. Pinned
-- search_path. Everything else is SECURITY INVOKER.
--
-- Idempotent: safe to run twice. APPLY MANUALLY in the Supabase SQL editor (standing rule).
-- Then run scripts/ops/menu-copy-reclaim.sql once (the backlog + VACUUM FULL), owner only.
-- Until this file is applied the app keeps working: it still calls latest_menu_facts (old body)
-- and treats a missing prune function as "not yet applied".

-- The one-time backfill below sorts every existing menu_items row (about 6 s on the Micro plan).
-- These apply to this run only (the SQL editor runs the file as one transaction).
set local statement_timeout = '15min';
set local work_mem = '64MB';

-- 1. The facts table ---------------------------------------------------------------------------
create table if not exists public.product_latest_facts (
  source_item_id          text primary key,
  row_id                  uuid not null,
  row_created_at          timestamptz not null,
  category                text,
  pos_inventory_type      text,
  pos_inventory_category  text,
  vendor_name             text,
  brand_name              text,
  updated_at              timestamptz not null default now(),
  constraint product_latest_facts_key_not_blank check (source_item_id <> '')
);

comment on table public.product_latest_facts is
  '0344 (PERF): newest category / POS type / POS category / vendor / brand per menu product key, by the 0305 rule (created_at desc, id asc). Maintained by triggers on menu_items; never deleted, so pruning old menu copies cannot change a past sale''s bucket.';

alter table public.product_latest_facts enable row level security;
revoke all on table public.product_latest_facts from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.product_latest_facts from service_role;
grant select on table public.product_latest_facts to service_role;

-- 2. The trigger function (statement level, one upsert per statement) -------------------------
create or replace function public.product_latest_facts_sync()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.product_latest_facts as t
         (source_item_id, row_id, row_created_at, category, pos_inventory_type,
          pos_inventory_category, vendor_name, brand_name, updated_at)
  select distinct on (n.source_item_id)
         n.source_item_id, n.id, n.created_at, n.category, n.pos_inventory_type,
         n.pos_inventory_category, n.vendor_name, n.brand_name, now()
    from new_rows n
   where n.source_item_id is not null
     and n.source_item_id <> ''
   order by n.source_item_id, n.created_at desc, n.id asc
  on conflict (source_item_id) do update
     set row_id                 = excluded.row_id,
         row_created_at         = excluded.row_created_at,
         category               = excluded.category,
         pos_inventory_type     = excluded.pos_inventory_type,
         pos_inventory_category = excluded.pos_inventory_category,
         vendor_name            = excluded.vendor_name,
         brand_name             = excluded.brand_name,
         updated_at             = now()
   where (excluded.row_created_at > t.row_created_at
          or (excluded.row_created_at = t.row_created_at and excluded.row_id <= t.row_id))
     and (t.row_id, t.row_created_at, t.category, t.pos_inventory_type, t.pos_inventory_category, t.vendor_name, t.brand_name)
         is distinct from
         (excluded.row_id, excluded.row_created_at, excluded.category, excluded.pos_inventory_type,
          excluded.pos_inventory_category, excluded.vendor_name, excluded.brand_name);
  return null;
end;
$$;

comment on function public.product_latest_facts_sync() is
  '0344 (PERF): statement-level trigger body. Upserts the newest row per key from the statement''s new rows into product_latest_facts, only when it is newer by the 0305 rule (or is the same row) and something changed.';

revoke all on function public.product_latest_facts_sync() from public, anon, authenticated, service_role;

drop trigger if exists menu_items_latest_facts_ins on public.menu_items;
create trigger menu_items_latest_facts_ins
  after insert on public.menu_items
  referencing new table as new_rows
  for each statement execute function public.product_latest_facts_sync();

drop trigger if exists menu_items_latest_facts_upd on public.menu_items;
create trigger menu_items_latest_facts_upd
  after update on public.menu_items
  referencing new table as new_rows
  for each statement execute function public.product_latest_facts_sync();

-- 2b. Deletes and the factory reset keep the 0305 answer exact -------------------------------
-- clean_slate_test_data (0236) DELETES test versions: a key whose newest row was a test row must
-- go back to its newest remaining row, as 0305 would answer. A key with no rows left keeps its
-- last facts (a past sale still resolves). The prune below sets greenway.menu_prune for its own
-- transaction, so pruning old copies never changes a key's facts. The factory reset (0240)
-- TRUNCATEs menu_items: the facts are derived from those rows, so they are emptied with them.
create or replace function public.product_latest_facts_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('greenway.menu_prune', true), '') = 'on' then
    return null;
  end if;
  with hit as (
    select distinct o.source_item_id
      from old_rows o
      join public.product_latest_facts f
        on f.source_item_id = o.source_item_id and f.row_id = o.id
  ), newest as (
    select distinct on (mi.source_item_id)
           mi.source_item_id, mi.id, mi.created_at, mi.category, mi.pos_inventory_type,
           mi.pos_inventory_category, mi.vendor_name, mi.brand_name
      from public.menu_items mi
      join hit h on h.source_item_id = mi.source_item_id
     order by mi.source_item_id, mi.created_at desc, mi.id asc
  )
  update public.product_latest_facts f
     set row_id                 = n.id,
         row_created_at         = n.created_at,
         category               = n.category,
         pos_inventory_type     = n.pos_inventory_type,
         pos_inventory_category = n.pos_inventory_category,
         vendor_name            = n.vendor_name,
         brand_name             = n.brand_name,
         updated_at             = now()
    from newest n
   where f.source_item_id = n.source_item_id;
  return null;
end;
$$;

comment on function public.product_latest_facts_on_delete() is
  '0344 (PERF): statement-level AFTER DELETE body on menu_items. When the row a key''s facts came from is deleted (clean slate of test data), the key takes its newest remaining row (0305 rule). Keys with no rows left keep their facts. Skipped inside prune_menu_version_items (greenway.menu_prune).';

revoke all on function public.product_latest_facts_on_delete() from public, anon, authenticated, service_role;

drop trigger if exists menu_items_latest_facts_del on public.menu_items;
create trigger menu_items_latest_facts_del
  after delete on public.menu_items
  referencing old table as old_rows
  for each statement execute function public.product_latest_facts_on_delete();

create or replace function public.product_latest_facts_on_truncate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  truncate table public.product_latest_facts;
  return null;
end;
$$;

comment on function public.product_latest_facts_on_truncate() is
  '0344 (PERF): AFTER TRUNCATE on menu_items (the factory reset, 0240) empties product_latest_facts, which is derived from those rows.';

revoke all on function public.product_latest_facts_on_truncate() from public, anon, authenticated, service_role;

drop trigger if exists menu_items_latest_facts_trunc on public.menu_items;
create trigger menu_items_latest_facts_trunc
  after truncate on public.menu_items
  for each statement execute function public.product_latest_facts_on_truncate();

-- 3. Backfill from every existing row (one time; re-running changes nothing) ------------------
insert into public.product_latest_facts as t
       (source_item_id, row_id, row_created_at, category, pos_inventory_type,
        pos_inventory_category, vendor_name, brand_name, updated_at)
select distinct on (mi.source_item_id)
       mi.source_item_id, mi.id, mi.created_at, mi.category, mi.pos_inventory_type,
       mi.pos_inventory_category, mi.vendor_name, mi.brand_name, now()
  from public.menu_items mi
 where mi.source_item_id is not null
   and mi.source_item_id <> ''
 order by mi.source_item_id, mi.created_at desc, mi.id asc
on conflict (source_item_id) do update
   set row_id                 = excluded.row_id,
       row_created_at         = excluded.row_created_at,
       category               = excluded.category,
       pos_inventory_type     = excluded.pos_inventory_type,
       pos_inventory_category = excluded.pos_inventory_category,
       vendor_name            = excluded.vendor_name,
       brand_name             = excluded.brand_name,
       updated_at             = now()
 where excluded.row_created_at > t.row_created_at
    or (excluded.row_created_at = t.row_created_at and excluded.row_id < t.row_id);

-- 4. latest_menu_facts reads the small table (same signature, same answer) --------------------
create or replace function public.latest_menu_facts(p_keys text[] default null)
returns table (
  source_item_id          text,
  category                text,
  pos_inventory_type      text,
  pos_inventory_category  text,
  vendor_name             text,
  brand_name              text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select f.source_item_id, f.category, f.pos_inventory_type, f.pos_inventory_category,
         f.vendor_name, f.brand_name
    from public.product_latest_facts f
   where p_keys is null or f.source_item_id = any (p_keys)
$$;

comment on function public.latest_menu_facts(text[]) is
  'PERF2 / 0305, rewritten 0344: newest category, POS type/category, vendor and brand per menu product key, read from product_latest_facts (same created_at desc, id asc rule). p_keys null = all keys. Read-only.';

revoke all on function public.latest_menu_facts(text[]) from public, anon, authenticated;
grant execute on function public.latest_menu_facts(text[]) to service_role;

-- 5. The bounded prune -------------------------------------------------------------------------
create or replace function public.prune_menu_version_items(
  p_keep_archived integer default 5,
  p_max_versions  integer default 4
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_keep      integer := coalesce(p_keep_archived, 5);
  v_max       integer := least(greatest(coalesce(p_max_versions, 4), 1), 500);
  v_id        uuid;
  v_n         bigint;
  v_versions  integer := 0;
  v_items     bigint := 0;
  v_remaining integer := 0;
begin
  if v_keep < 3 then
    raise exception 'PRUNE_KEEP_TOO_SMALL: keep at least 3 archived menu copies (asked for %)', v_keep
      using errcode = '22023';
  end if;

  -- Pruning removes old COPIES; it must never change a key's facts (see 2b).
  perform set_config('greenway.menu_prune', 'on', true);

  for v_id in
    select mv.id
      from public.menu_versions mv
     where mv.status = 'archived'
       and mv.import_id is null
       and mv.is_test is not true
       and mv.updated_at < now() - interval '10 minutes'
       and mv.id not in (
             select k.id from public.menu_versions k
              where k.status = 'archived' and k.import_id is null and k.is_test is not true
              order by k.created_at desc, k.id desc
              limit v_keep)
       and exists (select 1 from public.menu_items mi where mi.menu_version_id = mv.id)
     order by mv.created_at asc, mv.id asc
     limit v_max
     for update of mv skip locked
  loop
    delete from public.menu_items where menu_version_id = v_id;
    get diagnostics v_n = row_count;
    update public.menu_versions
       set summary_json =
             case
               when summary_json is null then '{}'::jsonb
               when jsonb_typeof(summary_json) = 'object' then summary_json
               else jsonb_build_object('summary_before_prune', summary_json)
             end
             || jsonb_build_object('items_pruned_at', now(), 'items_pruned', v_n)
     where id = v_id;
    v_versions := v_versions + 1;
    v_items := v_items + v_n;
  end loop;

  select count(*) into v_remaining
    from public.menu_versions mv
   where mv.status = 'archived'
     and mv.import_id is null
     and mv.is_test is not true
     and mv.updated_at < now() - interval '10 minutes'
     and mv.id not in (
           select k.id from public.menu_versions k
            where k.status = 'archived' and k.import_id is null and k.is_test is not true
            order by k.created_at desc, k.id desc
            limit v_keep)
     and exists (select 1 from public.menu_items mi where mi.menu_version_id = mv.id);

  perform set_config('greenway.menu_prune', '', true);
  return jsonb_build_object('versions', v_versions, 'items', v_items, 'remaining', v_remaining);
end;
$$;

comment on function public.prune_menu_version_items(integer, integer) is
  '0344 (PERF): removes the items (and cascaded variants) of old archived intake-origin menu copies, keeping the newest p_keep_archived (>= 3), every published / staged / import-origin / test version and anything archived in the last 10 minutes. Version rows stay, stamped summary_json.items_pruned_at. At most p_max_versions (1..500) per call. Returns {versions, items, remaining}.';

revoke all on function public.prune_menu_version_items(integer, integer) from public, anon, authenticated;
grant execute on function public.prune_menu_version_items(integer, integer) to service_role;
