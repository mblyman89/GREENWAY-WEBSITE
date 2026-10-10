-- scripts/r36/testing-labs.selftest.sql  (R36 #4, single-table 0256)
--   psql -v ON_ERROR_STOP=1 -d greenway -f scripts/r36/testing-labs.selftest.sql
-- One transaction, rolled back. Every assertion raises on failure.
begin;

do $$
declare n int;
begin
  -- seed
  select count(*) into n from public.testing_labs where status = 'active';
  if n <> 4 then raise exception 'expected 4 active labs, got %', n; end if;
  select count(*) into n from public.testing_labs where status = 'historical';
  if n <> 7 then raise exception 'expected 7 historical labs, got %', n; end if;
  select count(*) into n from public.testing_labs where status = 'platform';
  if n <> 1 then raise exception 'expected 1 platform row, got %', n; end if;
  if (select string_agg(lab_number::text, ',' order by lab_number) from public.testing_labs where status = 'active') <> '3,9,12,18' then
    raise exception 'active lab numbers wrong';
  end if;
  if (select string_agg(lab_number::text, ',' order by lab_number) from public.testing_labs where status = 'historical') <> '4,6,7,8,21,22,25' then
    raise exception 'historical lab numbers wrong';
  end if;
  if (select coa_hosts from public.testing_labs where status = 'platform') is distinct from array['files.cultivera.com']::text[] then
    raise exception 'Cultivera platform row must carry files.cultivera.com';
  end if;
  if (select lab_number from public.testing_labs where status = 'platform') is not null then
    raise exception 'platform row has a lab number';
  end if;
  if (select coa_hosts from public.testing_labs where lab_number = 3) is distinct from array['certs.conflabs.com']::text[] then
    raise exception 'certs.conflabs.com not on lab #3';
  end if;
  if (select coa_hosts from public.testing_labs where lab_number = 12) is distinct from array['gglabs-j.github.io']::text[] then
    raise exception 'gglabs-j.github.io not on lab #12';
  end if;
  select count(*) into n from public.testing_labs where cardinality(coa_hosts) > 0;
  if n <> 3 then raise exception 'expected exactly 3 rows with hosts, got %', n; end if;
  if (select name from public.testing_labs where lab_number = 7) <> 'Testing Technologies, Inc.' then
    raise exception 'lab #7 name wrong';
  end if;
end$$;

-- good owner rows are accepted (plain DNS names, punycode, several hosts)
insert into public.testing_labs (name, lab_number, status, coa_hosts)
  values ('New Lab NW', 31, 'owner_added', '{certs.newlab-wa.com,xn--bcher-kva.example-lab.xn--p1ai}');
insert into public.testing_labs (name) values ('Owner Lab Without Number');
update public.testing_labs set coa_hosts = coa_hosts || '{files2.newlab-wa.com}'::text[] where lab_number = 31;
do $$
begin
  if (select cardinality(coa_hosts) from public.testing_labs where lab_number = 31) <> 3 then
    raise exception 'host append failed';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'testing_labs_set_updated_at' and tgrelid = 'public.testing_labs'::regclass) then
    raise exception 'updated_at trigger missing';
  end if;
end$$;

-- every bad host is refused by the constraint (alone, and hidden among good ones)
do $$
declare bad text;
begin
  foreach bad in array array[
    'Files.Cultivera.com', 'https://x.com', 'x.com/path', 'x.com:443', '*.x.com', '127.0.0.1', '10.1.2.3',
    '::1', 'localhost', 'lab', '-bad.com', 'bad-.com', 'a..com', 'lab.c0m', 'lab .com', 'user@lab.com', 'x.com.', 'lab.c', 'ab.c'
  ] loop
    begin
      insert into public.testing_labs (name, status, coa_hosts) values ('Bad Host Lab', 'owner_added', array[bad]);
      raise exception 'ACCEPTED bad host %', bad;
    exception when check_violation then null;
    end;
    begin
      insert into public.testing_labs (name, status, coa_hosts) values ('Bad Host Lab', 'owner_added', array['good-lab.com', bad]);
      raise exception 'ACCEPTED bad host % behind a good one', bad;
    exception when check_violation then null;
    end;
  end loop;
  begin
    insert into public.testing_labs (name, status, coa_hosts) values ('Null Host Lab', 'owner_added', array[null]::text[]);
    raise exception 'ACCEPTED null host';
  exception when check_violation then null;
  end;
  begin
    insert into public.testing_labs (name, status, coa_hosts)
      select 'Many Hosts Lab', 'owner_added', array_agg('h' || g || '.lab.com') from generate_series(1, 21) g;
    raise exception 'ACCEPTED 21 hosts';
  exception when check_violation then null;
  end;
  begin
    insert into public.testing_labs (name, status, coa_hosts) values ('Null Array Lab', 'owner_added', null);
    raise exception 'ACCEPTED null coa_hosts';
  exception when not_null_violation then null;
  end;
end$$;

-- 20 hosts is the limit, and is accepted
insert into public.testing_labs (name, status, coa_hosts)
  select 'Twenty Hosts Lab', 'owner_added', array_agg('h' || g || '.lab.com') from generate_series(1, 20) g;

-- duplicates / bad values refused
do $$
begin
  begin
    insert into public.testing_labs (name, status) values ('confidence analytics', 'owner_added');
    raise exception 'ACCEPTED duplicate lab name (case-insensitive)';
  exception when unique_violation then null;
  end;
  begin
    insert into public.testing_labs (name, lab_number, status) values ('Other Lab', 18, 'owner_added');
    raise exception 'ACCEPTED duplicate lab number';
  exception when unique_violation then null;
  end;
  begin
    insert into public.testing_labs (name, status) values ('Bad Status Lab', 'certified');
    raise exception 'ACCEPTED bad status';
  exception when check_violation then null;
  end;
  begin
    insert into public.testing_labs (name, lab_number, status) values ('Numbered Platform', 40, 'platform');
    raise exception 'ACCEPTED platform with a lab number';
  exception when check_violation then null;
  end;
  begin
    insert into public.testing_labs (name, status) values (' Padded ', 'owner_added');
    raise exception 'ACCEPTED untrimmed name';
  exception when check_violation then null;
  end;
  begin
    insert into public.testing_labs (name, status) values ('X', 'owner_added');
    raise exception 'ACCEPTED 1-char name';
  exception when check_violation then null;
  end;
  begin
    insert into public.testing_labs (name, website, status) values ('Js Lab', 'javascript:alert(1)', 'owner_added');
    raise exception 'ACCEPTED javascript: website';
  exception when check_violation then null;
  end;
  begin
    insert into public.testing_labs (name, lab_number, status) values ('Zero Lab', 0, 'owner_added');
    raise exception 'ACCEPTED lab number 0';
  exception when check_violation then null;
  end;
  begin
    insert into public.testing_labs (name, notes, status) values ('Long Notes Lab', repeat('n', 1001), 'owner_added');
    raise exception 'ACCEPTED 1001-char notes';
  exception when check_violation then null;
  end;
end$$;

-- RLS on with both policies; default status is owner_added
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.testing_labs'::regclass) then raise exception 'RLS off on testing_labs'; end if;
  if (select count(*) from pg_policies where tablename = 'testing_labs') <> 2 then raise exception 'expected 2 policies'; end if;
  if (select status from public.testing_labs where name = 'Owner Lab Without Number') <> 'owner_added' then
    raise exception 'default status wrong';
  end if;
end$$;

rollback;
\echo 'testing-labs selftest: ALL PASSED'
