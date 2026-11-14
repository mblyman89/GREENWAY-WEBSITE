create table if not exists public.media_embeddings (
  media_id     uuid not null references public.media_assets(id) on delete cascade,
  kind         text not null,
  model        text not null,
  dims         integer not null,
  source_hash  text not null,
  status       text not null default 'done',
  note         text,
  attempts     integer not null default 1,
  embedded_at  timestamptz not null default now(),
  constraint media_embeddings_pk primary key (media_id, kind),
  constraint media_embeddings_kind_chk check (kind in ('text', 'image')),
  constraint media_embeddings_status_chk check (status in ('done', 'failed', 'skipped')),
  constraint media_embeddings_dims_chk check (dims between 128 and 3072),
  constraint media_embeddings_attempts_chk check (attempts between 0 and 1000),
  constraint media_embeddings_model_chk check (length(model) between 1 and 120),
  constraint media_embeddings_hash_chk check (length(source_hash) between 1 and 200)
);

create index if not exists idx_media_embeddings_status on public.media_embeddings (status, kind) where status <> 'done';

alter table public.media_embeddings enable row level security;
revoke all on table public.media_embeddings from public, anon, authenticated;
grant select, insert, update, delete on table public.media_embeddings to service_role;

comment on table public.media_embeddings is
  'D244 R-4 (0365): one embedding per (photo, kind) for hybrid semantic photo search. kind text = the photo words, image = the picture. model + source_hash = exactly what was embedded. The vector column exists only when pgvector is available. Service role only.';

create or replace function public.media_vector_search(p_embedding text, p_limit integer default 40)
returns table (media_id uuid, kind text, similarity real)
language sql
stable
set search_path = public, pg_temp
as $$select null::uuid, null::text, null::real where false;
$$;

create or replace function public.media_vector_neighbors(p_id uuid, p_limit integer default 24)
returns table (media_id uuid, kind text, similarity real)
language sql
stable
set search_path = public, pg_temp
as $$select null::uuid, null::text, null::real where false;
$$;

do $$declare
  vs text;
  sp text;
begin
  if not exists (select 1 from pg_available_extensions where name = 'vector') then
    raise notice '0365: pgvector is not available on this database; photo search stays word-only (re-run this file after enabling it).';
    return;
  end if;
  if not exists (select 1 from pg_extension where extname = 'vector') then
    create schema if not exists extensions;
    create extension if not exists vector with schema extensions;
  end if;
  select n.nspname into vs from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'vector';
  sp := format('public, %I, pg_temp', vs);

  perform set_config('search_path', sp, true);

  execute format('alter table public.media_embeddings add column if not exists embedding %I.vector(768)', vs);
  execute format('create index if not exists idx_media_embeddings_text_hnsw on public.media_embeddings using hnsw (embedding %I.vector_cosine_ops) where kind = %L and status = %L', vs, 'text', 'done');
  execute format('create index if not exists idx_media_embeddings_image_hnsw on public.media_embeddings using hnsw (embedding %I.vector_cosine_ops) where kind = %L and status = %L', vs, 'image', 'done');

  execute format($f$create or replace function public.media_vector_search(p_embedding text, p_limit integer default 40)
    returns table (media_id uuid, kind text, similarity real)
    language sql
    stable
    set search_path = %s
    as $body$with t as (
        select e.media_id, e.kind, (1 - (e.embedding <=> p_embedding::vector(768)))::real as similarity
          from public.media_embeddings e
         where e.kind = 'text' and e.status = 'done' and e.embedding is not null
         order by e.embedding <=> p_embedding::vector(768)
         limit least(greatest(coalesce(p_limit, 40), 1), 100)
      ),
      i as (
        select e.media_id, e.kind, (1 - (e.embedding <=> p_embedding::vector(768)))::real as similarity
          from public.media_embeddings e
         where e.kind = 'image' and e.status = 'done' and e.embedding is not null
         order by e.embedding <=> p_embedding::vector(768)
         limit least(greatest(coalesce(p_limit, 40), 1), 100)
      )
      select x.media_id, x.kind, x.similarity
        from (select * from t union all select * from i) x
        join public.media_assets m on m.id = x.media_id
       where m.status <> 'archived'
       order by x.similarity desc, x.media_id;
$body$
$f$, sp);

  execute format($f$create or replace function public.media_vector_neighbors(p_id uuid, p_limit integer default 24)
    returns table (media_id uuid, kind text, similarity real)
    language sql
    stable
    set search_path = %s
    as $body$with t as (
        select e.media_id, e.kind, (1 - (e.embedding <=> s.embedding))::real as similarity
          from public.media_embeddings s
          join public.media_embeddings e on e.kind = s.kind and e.status = 'done' and e.embedding is not null and e.media_id <> s.media_id
         where s.media_id = p_id and s.kind = 'text' and s.status = 'done' and s.embedding is not null
         order by e.embedding <=> s.embedding
         limit least(greatest(coalesce(p_limit, 24), 1), 100)
      ),
      i as (
        select e.media_id, e.kind, (1 - (e.embedding <=> s.embedding))::real as similarity
          from public.media_embeddings s
          join public.media_embeddings e on e.kind = s.kind and e.status = 'done' and e.embedding is not null and e.media_id <> s.media_id
         where s.media_id = p_id and s.kind = 'image' and s.status = 'done' and s.embedding is not null
         order by e.embedding <=> s.embedding
         limit least(greatest(coalesce(p_limit, 24), 1), 100)
      )
      select x.media_id, x.kind, x.similarity
        from (select * from t union all select * from i) x
        join public.media_assets m on m.id = x.media_id
       where m.status <> 'archived'
       order by x.similarity desc, x.media_id;
$body$
$f$, sp);
end
$$;

comment on function public.media_vector_search(text, integer) is
  'D244 R-4 (0365): nearest photos to a query embedding (768 numbers as text), up to p_limit of each kind (text, image), archived excluded, similarity = 1 - cosine distance. No rows when pgvector is off. Service role only.';
comment on function public.media_vector_neighbors(uuid, integer) is
  'D244 R-4 (0365): photos whose words / picture are nearest to one photo (Find similar). No rows when pgvector is off or the photo is not indexed. Service role only.';

create or replace function public.media_embedding_capability()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$select jsonb_build_object(
    'vector_available', exists (select 1 from pg_available_extensions where name = 'vector'),
    'vector_installed', exists (select 1 from pg_extension where extname = 'vector'),
    'vector_version', (select extversion from pg_extension where extname = 'vector'),
    'column_ready', exists (
      select 1 from pg_attribute
       where attrelid = 'public.media_embeddings'::regclass and attname = 'embedding' and not attisdropped
    )
  );
$$;

create or replace function public.media_embedding_health()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$select jsonb_build_object(
    'live_images', (select count(*) from public.media_assets m where m.status <> 'archived' and m.mime_type like 'image/%'),
    'text_done', (select count(*) from public.media_embeddings e join public.media_assets m on m.id = e.media_id
                   where m.status <> 'archived' and e.kind = 'text' and e.status = 'done'),
    'image_done', (select count(*) from public.media_embeddings e join public.media_assets m on m.id = e.media_id
                    where m.status <> 'archived' and e.kind = 'image' and e.status = 'done'),
    'failed', (select count(*) from public.media_embeddings where status = 'failed'),
    'skipped', (select count(*) from public.media_embeddings where status = 'skipped'),
    'last_embedded_at', (select max(embedded_at) from public.media_embeddings where status = 'done'),
    'models', coalesce((select jsonb_agg(distinct model) from public.media_embeddings where status = 'done'), '[]'::jsonb)
  );
$$;

comment on function public.media_embedding_capability() is
  'D244 R-4 (0365): is pgvector available / installed, and does media_embeddings have its vector column. Service role only.';
comment on function public.media_embedding_health() is
  'D244 R-4 (0365): how much of the live photo library is indexed for semantic search (text / image), failures, skips, last run, models. Service role only.';

revoke all on function public.media_vector_search(text, integer) from public, anon, authenticated;
revoke all on function public.media_vector_neighbors(uuid, integer) from public, anon, authenticated;
revoke all on function public.media_embedding_capability() from public, anon, authenticated;
revoke all on function public.media_embedding_health() from public, anon, authenticated;
grant execute on function public.media_vector_search(text, integer) to service_role;
grant execute on function public.media_vector_neighbors(uuid, integer) to service_role;
grant execute on function public.media_embedding_capability() to service_role;
grant execute on function public.media_embedding_health() to service_role;

notify pgrst, 'reload schema';
