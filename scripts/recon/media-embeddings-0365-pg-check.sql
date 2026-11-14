-- D244 R-4 post-apply scenario check for 0365_media_embeddings.
-- Run by scripts/compliance/verify-migrations-execute.ts after every
-- migration has been applied. One transaction, rolled back.
--
-- The scenario (works with AND without pgvector; CI has none, Supabase has it):
--   * one embedding per (photo, kind); twice refused; bad kind / status / dims refused;
--   * deleting the photo deletes its embeddings;
--   * health counts the indexed photos; capability says whether vectors are on;
--   * with pgvector: the nearest photo to a query ranks first, archived photos
--     are never returned, Find similar skips the photo itself;
--   * without pgvector: the search functions return no rows (word search only);
--   * service role only, RLS on;
--   * rollback drops the table, then re-apply runs.
\set ON_ERROR_STOP on
begin;

insert into public.media_assets (id, storage_key, filename, mime_type, status, usage_type, title) values
  ('00000000-0000-4000-8000-000000036501', 'product/a365000000000001-a.png', 'a.png', 'image/png', 'published', 'product', 'Blue Dream jar'),
  ('00000000-0000-4000-8000-000000036502', 'product/a365000000000002-b.png', 'b.png', 'image/png', 'published', 'product', 'Gelato pre-roll'),
  ('00000000-0000-4000-8000-000000036503', 'product/a365000000000003-c.png', 'c.png', 'image/png', 'archived', 'product', 'Old Blue Dream');

insert into public.media_embeddings (media_id, kind, model, dims, source_hash) values
  ('00000000-0000-4000-8000-000000036501', 'text', 'gemini-embedding-2', 768, 'h1'),
  ('00000000-0000-4000-8000-000000036501', 'image', 'gemini-embedding-2', 768, 'h1i'),
  ('00000000-0000-4000-8000-000000036502', 'text', 'gemini-embedding-2', 768, 'h2'),
  ('00000000-0000-4000-8000-000000036503', 'text', 'gemini-embedding-2', 768, 'h3');

do $$
declare ok boolean;
begin
  ok := false;
  begin
    insert into public.media_embeddings (media_id, kind, model, dims, source_hash) values ('00000000-0000-4000-8000-000000036501', 'text', 'm', 768, 'x');
  exception when unique_violation then ok := true;
  end;
  assert ok, 'one embedding per photo and kind';
  ok := false;
  begin
    insert into public.media_embeddings (media_id, kind, model, dims, source_hash) values ('00000000-0000-4000-8000-000000036502', 'audio', 'm', 768, 'x');
  exception when check_violation then ok := true;
  end;
  assert ok, 'unknown kind refused';
  ok := false;
  begin
    insert into public.media_embeddings (media_id, kind, model, dims, source_hash, status) values ('00000000-0000-4000-8000-000000036502', 'image', 'm', 768, 'x', 'maybe');
  exception when check_violation then ok := true;
  end;
  assert ok, 'unknown status refused';
  ok := false;
  begin
    insert into public.media_embeddings (media_id, kind, model, dims, source_hash) values ('00000000-0000-4000-8000-000000036502', 'image', 'm', 5000, 'x');
  exception when check_violation then ok := true;
  end;
  assert ok, 'dims out of range refused';
  assert ((public.media_embedding_health())->>'text_done')::int >= 2, 'health counts live text rows';
  assert (public.media_embedding_capability()) ? 'column_ready', 'capability answers';
  assert (select relrowsecurity from pg_class where oid = 'public.media_embeddings'::regclass), 'RLS on';
  assert not has_table_privilege('anon', 'public.media_embeddings', 'select'), 'anon cannot read';
  assert not has_table_privilege('authenticated', 'public.media_embeddings', 'select'), 'authenticated cannot read';
  assert has_table_privilege('service_role', 'public.media_embeddings', 'update'), 'service role writes';
  assert not has_function_privilege('anon', 'public.media_vector_search(text, integer)', 'execute'), 'anon cannot search';
  assert has_function_privilege('service_role', 'public.media_vector_search(text, integer)', 'execute'), 'service role searches';
end
$$;

-- Vectors: a unit vector on axis 1 for photo 1, axis 2 for photo 2, axis 1
-- for the archived photo 3. A query on axis 1 must return photo 1 first and
-- never photo 3.
do $$
declare
  v1 text := '[1' || repeat(',0', 767) || ']';
  v2 text := '[0,1' || repeat(',0', 766) || ']';
  first uuid;
  n int;
begin
  if ((public.media_embedding_capability())->>'column_ready')::boolean then
    execute 'update public.media_embeddings set embedding = $1::text::' || (select format('%I', n.nspname) from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'vector') || '.vector where media_id in ($2, $3)'
      using v1, '00000000-0000-4000-8000-000000036501'::uuid, '00000000-0000-4000-8000-000000036503'::uuid;
    execute 'update public.media_embeddings set embedding = $1::text::' || (select format('%I', n.nspname) from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'vector') || '.vector where media_id = $2'
      using v2, '00000000-0000-4000-8000-000000036502'::uuid;
    select s.media_id into first from public.media_vector_search(v1, 10) s where s.kind = 'text' order by s.similarity desc limit 1;
    assert first = '00000000-0000-4000-8000-000000036501', 'nearest photo ranks first';
    assert not exists (select 1 from public.media_vector_search(v1, 10) s where s.media_id = '00000000-0000-4000-8000-000000036503'), 'archived never returned';
    assert exists (select 1 from public.media_vector_search(v1, 10) s where s.kind = 'image'), 'picture rows searched too';
    select count(*) into n from public.media_vector_neighbors('00000000-0000-4000-8000-000000036501', 10) s where s.media_id = '00000000-0000-4000-8000-000000036501';
    assert n = 0, 'find similar skips the photo itself';
    assert exists (select 1 from public.media_vector_neighbors('00000000-0000-4000-8000-000000036501', 10) s where s.media_id = '00000000-0000-4000-8000-000000036502'), 'find similar lists the other live photo';
    raise notice '0365 check: pgvector path verified';
  else
    assert not exists (select 1 from public.media_vector_search(v1, 10)), 'no pgvector: search returns no rows';
    assert not exists (select 1 from public.media_vector_neighbors('00000000-0000-4000-8000-000000036501', 10)), 'no pgvector: neighbors returns no rows';
    raise notice '0365 check: no-pgvector path verified';
  end if;
end
$$;

delete from public.media_assets where id = '00000000-0000-4000-8000-000000036501';
do $$
begin
  assert (select count(*) from public.media_embeddings where media_id = '00000000-0000-4000-8000-000000036501') = 0, 'embeddings go with the photo';
end
$$;

\ir ../../supabase/rollbacks/0365_media_embeddings.rollback.sql
do $$
begin
  assert to_regclass('public.media_embeddings') is null, 'rollback drops the table';
  assert to_regprocedure('public.media_vector_search(text, integer)') is null, 'rollback drops the search';
end
$$;
\ir ../../supabase/migrations/0365_media_embeddings.sql
do $$
begin
  assert to_regclass('public.media_embeddings') is not null, 're-apply after rollback';
  raise notice 'MEDIA EMBEDDINGS 0365 CHECK PASSED';
end
$$;

rollback;
