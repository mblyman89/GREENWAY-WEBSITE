-- scripts/recon/cultivera-mail-docs-0293-pg-check.sql  (R74 S7 - migration 0293)
--
-- Scenario check for 0293_cultivera_mail_docs.sql on Postgres 15 with every
-- migration applied. ONE transaction, rolled back: no rows remain.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/cultivera-mail-docs-0293-pg-check.sql
--
-- Each refusal MUST raise with the expected text and sits beside a valid write
-- that MUST be accepted. "R74 0293 CHECK PASSED" then ROLLBACK = all clear.
begin;

create or replace function pg_temp.must_fail(sql text, expect text) returns void
language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if position(expect in sqlerrm) = 0 and sqlstate <> expect then
      raise exception 'probe raised the WRONG error. expected %, got [%] %  -- %', expect, sqlstate, sqlerrm, sql;
    end if;
    return;
  end;
  raise exception 'probe was ACCEPTED but must be refused (expected %): %', expect, sql;
end $$;

do $$
declare
  n    int;
  id1  uuid;
  id2  uuid;
  sha  text := repeat('ab', 32);
begin
  -- 0. shape: one table, RLS on, guard not security definer, 2 policies, GIN on barcodes
  select count(*) into n from pg_class where relname = 'cultivera_mail_docs' and relkind = 'r' and relrowsecurity;
  assert n = 1, 'one table with RLS on';
  select count(*) into n from pg_proc where proname = 'cultivera_mail_docs_guard' and prosecdef;
  assert n = 0, 'the guard is not security definer';
  select count(*) into n from pg_policies where tablename = 'cultivera_mail_docs';
  assert n = 2, 'staff read + admin write policies';
  select count(*) into n from pg_indexes where indexname = 'cultivera_mail_docs_barcodes_idx' and indexdef ilike '%gin%';
  assert n = 1, 'barcode lookup index is GIN';

  -- 1. the insert is the claim: the same (mailbox, gmail id, index) twice stores one row
  insert into public.cultivera_mail_docs (mailbox, gmail_id, doc_index, subject, filename, kind, source, storage_key, bytes, sha256, status)
    values ('stephen@greenwaymarijuana.com', 'g0293aaaa', 0, 'Manifest', 'm.json', 'json', 'attachment',
            'mail-harvest/stephen_greenwaymarijuana.com/g0293aaaa/0-m.json', 120, sha, 'stored')
    returning id into id1;
  insert into public.cultivera_mail_docs (mailbox, gmail_id, doc_index, kind, source, status)
    values ('stephen@greenwaymarijuana.com', 'g0293aaaa', 0, 'pdf', 'attachment', 'skipped')
    on conflict (mailbox, gmail_id, doc_index) do nothing;
  select count(*) into n from public.cultivera_mail_docs where gmail_id = 'g0293aaaa';
  assert n = 1, 'one row per document';
  perform pg_temp.must_fail(
    $q$insert into public.cultivera_mail_docs (mailbox, gmail_id, doc_index, kind, source, status) values ('stephen@greenwaymarijuana.com', 'g0293aaaa', 0, 'pdf', 'attachment', 'skipped')$q$,
    'cultivera_mail_docs_once');
  -- a second document of the same email, and an email with nothing
  insert into public.cultivera_mail_docs (mailbox, gmail_id, doc_index, kind, source, status, note)
    values ('stephen@greenwaymarijuana.com', 'g0293aaaa', 1, 'pdf', 'attachment', 'failed', 'Gmail attachment: HTTP 404');
  insert into public.cultivera_mail_docs (mailbox, gmail_id, doc_index, kind, source, status)
    values ('stephen@greenwaymarijuana.com', 'g0293bbbb', 0, 'none', 'email', 'no_documents')
    returning id into id2;

  -- 2. vocabularies and shapes
  perform pg_temp.must_fail($q$insert into public.cultivera_mail_docs (mailbox, gmail_id, doc_index, kind, source, status) values ('Stephen@X.test', 'g0293cccc', 0, 'pdf', 'attachment', 'skipped')$q$, 'cultivera_mail_docs_mailbox_ck');
  perform pg_temp.must_fail($q$insert into public.cultivera_mail_docs (mailbox, gmail_id, doc_index, kind, source, status) values ('s@x.test', 'bad id!', 0, 'pdf', 'attachment', 'skipped')$q$, 'cultivera_mail_docs_gmail_id_ck');
  perform pg_temp.must_fail($q$insert into public.cultivera_mail_docs (mailbox, gmail_id, doc_index, kind, source, status) values ('s@x.test', 'g0293cccc', 1000, 'pdf', 'attachment', 'skipped')$q$, 'cultivera_mail_docs_index_ck');
  perform pg_temp.must_fail($q$insert into public.cultivera_mail_docs (mailbox, gmail_id, doc_index, kind, source, status) values ('s@x.test', 'g0293cccc', 0, 'docx', 'attachment', 'skipped')$q$, 'cultivera_mail_docs_kind_ck');
  perform pg_temp.must_fail($q$insert into public.cultivera_mail_docs (mailbox, gmail_id, doc_index, kind, source, status) values ('s@x.test', 'g0293cccc', 0, 'pdf', 'drive', 'skipped')$q$, 'cultivera_mail_docs_source_ck');
  perform pg_temp.must_fail($q$insert into public.cultivera_mail_docs (mailbox, gmail_id, doc_index, kind, source, status) values ('s@x.test', 'g0293cccc', 0, 'pdf', 'attachment', 'done')$q$, 'cultivera_mail_docs_status_ck');
  perform pg_temp.must_fail($q$insert into public.cultivera_mail_docs (mailbox, gmail_id, doc_index, kind, source, status, source_format) values ('s@x.test', 'g0293cccc', 0, 'pdf', 'attachment', 'skipped', 'leafly')$q$, 'cultivera_mail_docs_format_ck');
  -- kept status needs a file; a file needs a sane key / size / fingerprint
  perform pg_temp.must_fail($q$insert into public.cultivera_mail_docs (mailbox, gmail_id, doc_index, kind, source, status) values ('s@x.test', 'g0293cccc', 0, 'pdf', 'attachment', 'stored')$q$, 'cultivera_mail_docs_file_ck');
  perform pg_temp.must_fail($q$insert into public.cultivera_mail_docs (mailbox, gmail_id, doc_index, kind, source, status, storage_key, bytes, sha256) values ('s@x.test', 'g0293cccc', 0, 'pdf', 'attachment', 'stored', 'elsewhere/x.pdf', 1, repeat('ab', 32))$q$, 'cultivera_mail_docs_file_ck');
  perform pg_temp.must_fail($q$insert into public.cultivera_mail_docs (mailbox, gmail_id, doc_index, kind, source, status, storage_key, bytes, sha256) values ('s@x.test', 'g0293cccc', 0, 'pdf', 'attachment', 'stored', 'mail-harvest/x.pdf', 1, 'NOTHEX')$q$, 'cultivera_mail_docs_file_ck');
  perform pg_temp.must_fail($q$insert into public.cultivera_mail_docs (mailbox, gmail_id, doc_index, kind, source, status, storage_key, bytes, sha256) values ('s@x.test', 'g0293cccc', 0, 'pdf', 'attachment', 'skipped', 'mail-harvest/x.pdf', 1, repeat('ab', 32))$q$, 'cultivera_mail_docs_file_ck');
  -- no_documents is exactly kind none + source email
  perform pg_temp.must_fail($q$insert into public.cultivera_mail_docs (mailbox, gmail_id, doc_index, kind, source, status) values ('s@x.test', 'g0293cccc', 0, 'pdf', 'email', 'no_documents')$q$, 'cultivera_mail_docs_no_docs_ck');
  perform pg_temp.must_fail($q$insert into public.cultivera_mail_docs (mailbox, gmail_id, doc_index, kind, source, status) values ('s@x.test', 'g0293cccc', 0, 'none', 'email', 'skipped')$q$, 'cultivera_mail_docs_no_docs_ck');
  -- lines is an array and line_count matches it
  perform pg_temp.must_fail($q$insert into public.cultivera_mail_docs (mailbox, gmail_id, doc_index, kind, source, status, lines, line_count) values ('s@x.test', 'g0293cccc', 0, 'pdf', 'attachment', 'skipped', '{}'::jsonb, 0)$q$, 'cultivera_mail_docs_lines_ck');
  perform pg_temp.must_fail($q$insert into public.cultivera_mail_docs (mailbox, gmail_id, doc_index, kind, source, status, lines, line_count) values ('s@x.test', 'g0293cccc', 0, 'pdf', 'attachment', 'skipped', '[["1",1,"a","Flower",100]]'::jsonb, 2)$q$, 'cultivera_mail_docs_lines_ck');
  -- parsed needs lines and a format
  perform pg_temp.must_fail($q$insert into public.cultivera_mail_docs (mailbox, gmail_id, doc_index, kind, source, status, storage_key, bytes, sha256, source_format) values ('s@x.test', 'g0293cccc', 0, 'json', 'attachment', 'parsed', 'mail-harvest/x.json', 1, repeat('ab', 32), 'wcia')$q$, 'cultivera_mail_docs_parsed_ck');

  -- 3. what was received never changes
  perform pg_temp.must_fail(format($q$update public.cultivera_mail_docs set subject = 'edited' where id = %L$q$, id1), 'CULTIVERA_MAIL_DOC_IMMUTABLE');
  perform pg_temp.must_fail(format($q$update public.cultivera_mail_docs set sha256 = repeat('cd', 32) where id = %L$q$, id1), 'CULTIVERA_MAIL_DOC_IMMUTABLE');
  perform pg_temp.must_fail(format($q$update public.cultivera_mail_docs set gmail_id = 'g0293zzzz' where id = %L$q$, id1), 'CULTIVERA_MAIL_DOC_IMMUTABLE');

  -- 4. a kept file may be (re)read: stored -> parsed is accepted, with its lines
  update public.cultivera_mail_docs
     set status = 'parsed', source_format = 'wcia', manifest_number = '0001234567',
         lines = '[["1234567890123456",10,"Blue Dream 3.5g","Usable Marijuana",450]]'::jsonb,
         line_count = 1, barcodes = array['1234567890123456']
   where id = id1;
  select count(*) into n from public.cultivera_mail_docs where barcodes @> array['1234567890123456'];
  assert n = 1, 'found by barcode';
  update public.cultivera_mail_docs set status = 'unreadable', source_format = null, lines = '[]'::jsonb, line_count = 0, barcodes = '{}' where id = id1;
  -- a skipped / no_documents row never becomes a kept one
  perform pg_temp.must_fail(format($q$update public.cultivera_mail_docs set status = 'skipped' where id = %L$q$, id1), 'CULTIVERA_MAIL_DOC_STATUS');
  perform pg_temp.must_fail(format($q$update public.cultivera_mail_docs set status = 'failed', note = 'x' where id = %L$q$, id2), 'CULTIVERA_MAIL_DOC_STATUS');

  -- 5. never deleted
  perform pg_temp.must_fail(format($q$delete from public.cultivera_mail_docs where id = %L$q$, id1), 'CULTIVERA_MAIL_DOC_KEPT');
  perform pg_temp.must_fail(format($q$delete from public.cultivera_mail_docs where id = %L$q$, id2), 'CULTIVERA_MAIL_DOC_KEPT');

  raise notice 'R74 0293 CHECK PASSED';
end $$;

rollback;
