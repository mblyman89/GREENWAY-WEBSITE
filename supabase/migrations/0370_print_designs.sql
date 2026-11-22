-- ============================================================================
-- 0370 - PRINT STUDIO SAVED DESIGNS  (D263 S8)
--
-- Owner (D263): "saved print designs ... a new DB table is fine". One row per
-- Print Studio piece (banner, flyer, sign, sticker, business card...). `doc`
-- is the whole piece as JSON: the print size preset, every page's design and
-- picture link (the same JSON the studio keeps in the browser). `rev` is a
-- compare-and-set counter so two computers can't silently overwrite each
-- other. Templates are ordinary rows with is_template = true.
--
-- Archive, never delete. No foreign keys (people recorded by e-mail like the
-- merch designs), so the factory reset only lists it as KEEP. Service role
-- only, RLS on. Idempotent: safe to run more than once.
-- ROLLBACK: supabase/rollbacks/0370_print_designs.rollback.sql
-- ============================================================================

create table if not exists public.print_designs (
  id               text primary key,
  name             text not null,
  preset_id        text not null,
  doc              jsonb not null,
  is_template      boolean not null default false,
  rev              integer not null default 1,
  created_by_email text,
  updated_by_email text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  archived_at      timestamptz,
  constraint print_designs_id_chk check (id ~ '^[A-Za-z0-9_-]{1,60}$'),
  constraint print_designs_name_chk check (length(btrim(name)) between 1 and 80),
  constraint print_designs_preset_chk check (preset_id ~ '^[A-Za-z0-9_.-]{1,60}$'),
  constraint print_designs_doc_chk check (jsonb_typeof(doc) = 'object'),
  constraint print_designs_size_chk check (octet_length(doc::text) <= 2000000),
  constraint print_designs_rev_chk check (rev >= 1)
);

create index if not exists idx_print_designs_live_updated
  on public.print_designs (updated_at desc) where archived_at is null;

alter table public.print_designs enable row level security;
revoke all on table public.print_designs from public, anon, authenticated;
grant select, insert, update, delete on table public.print_designs to service_role;

comment on table public.print_designs is
  'D263 S8 (0370): Print Studio pieces and templates saved on the server (any computer). rev = compare-and-set. Archive, never delete. Service role only.';

notify pgrst, 'reload schema';
