-- 0249_ccrs_upload_lifecycle.sql  (CCRS Bible v2 slice S-12c)
--
-- WHY. 0248 (S-12b) records every file we emit, but nothing yet records what
-- happened next. Without that, a lot we Insert this week is still absent from
-- ccrs_filed_entities next week, so routing Inserts it AGAIN and CCRS answers
-- "Duplicate External Identifier". This migration records the rest of the
-- Part 05 section A lifecycle, and moves the ledger as CCRS answers:
--
--   ccrs_mark_uploaded      emitted  -> uploaded   (operator: "I uploaded this at HH:MM")
--   ccrs_record_outcome     uploaded -> succeeded | errored | reconciling | closed
--   ccrs_abandon_file       emitted  -> abandoned  (never uploaded; bytes kept)
--   ccrs_preprod_ledger_start   lets PREprod exports be recorded too (empty start)
--
-- GROUNDING.
--   * Part 05 section A table: on success, entities -> filed (tentative);
--     Strain/Area/Sale/Adjustment files close on the success email; Inventory
--     and Product close only after a copy diff or after a later Update of the
--     same ids succeeds (which proves they exist).
--   * U-17 CLOSED FALSE (PREprod P20261006A): CCRS accepts row by row and the
--     error CSV lists the failing rows; the rows NOT listed were filed. This
--     supersedes Part 05's older "all rows uncertain" for an error email whose
--     every line we can match to one of our rows. When a line cannot be
--     matched, the old LAW 4 rule still applies: every row uncertain.
--   * Part 05 section D.2: a file-fatal message (CheckSum ...) rejects every
--     row; the file closes and a new file is assembled.
--   * Part 05 section E: no email within 60 minutes of upload -> reconciling.
--   * Part 05 section A rule: an emitted file's bytes must re-hash to sha256 at
--     upload time. Part 05 section C / Brian A27: upload the next file when the
--     previous one's success email arrives; override only with a logged reason.
--
-- No new tables or columns. Every function is service-role only, pins
-- search_path, is NOT security definer, and is idempotent to re-create.
-- Rollback: supabase/rollbacks/0249_ccrs_upload_lifecycle.rollback.sql

-- ---------------------------------------------------------------------------
-- 1) Upload group of a file type (Group 1 -> 2 -> 3, [G L1057-L1058]).
--    Mirrors uploadGroupOf() in ccrs-batch-core.ts (a vitest compares them).
-- ---------------------------------------------------------------------------
create or replace function public.ccrs_upload_group(p_type text)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_type
    when 'Strain' then 1 when 'Area' then 1 when 'Product' then 1
    when 'Inventory' then 2
    when 'InventoryAdjustment' then 3 when 'InventoryTransfer' then 3 when 'Sale' then 3
  end
$$;

-- ---------------------------------------------------------------------------
-- 2) ccrs_mark_uploaded: the operator uploaded the STORED bytes.
-- ---------------------------------------------------------------------------
create or replace function public.ccrs_mark_uploaded(
  p_file_id uuid, p_uploaded_at timestamptz, p_by uuid default null, p_override text default null)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  f        public.ccrs_files%rowtype;
  v_hash   text;
  v_block  text[];
  v_refs   text[];
begin
  select * into f from public.ccrs_files where id = p_file_id for update;
  if not found then
    raise exception 'CCRS_FILE_NOT_FOUND: %', p_file_id using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext('ccrs_lifecycle:' || f.env));
  if f.state <> 'emitted' then
    raise exception 'CCRS_UPLOAD_NOT_EMITTED: % is %, only an emitted file can be marked uploaded', f.file_name, f.state
      using errcode = 'check_violation';
  end if;
  if p_uploaded_at is null or p_uploaded_at > now() + interval '5 minutes'
     or p_uploaded_at < f.emitted_at - interval '1 minute' then
    raise exception 'CCRS_UPLOAD_TIME: % is not between the emission (%) and now', p_uploaded_at, f.emitted_at
      using errcode = 'check_violation';
  end if;
  select encode(sha256(convert_to(c.content, 'UTF8')), 'hex') into v_hash
    from public.ccrs_file_contents c where c.file_id = f.id;
  if v_hash is distinct from f.sha256 then
    raise exception 'CCRS_UPLOAD_BYTES_CHANGED: the stored bytes of % no longer hash to its sha256', f.file_name
      using errcode = 'check_violation';
  end if;
  -- (a) Pacing (Brian A27, Part 05 C): every EARLIER file of this env must
  --     have been answered (or abandoned). An emitted file nobody uploaded
  --     blocks too: abandon it explicitly or upload it first.
  select array_agg(o.file_name || ' (' || o.state || ')' order by o.stamp_at)
    into v_block
    from public.ccrs_files o
   where o.env = f.env and o.id <> f.id and o.stamp_at is not null and o.stamp_at < f.stamp_at
     and o.state in ('emitted', 'uploaded');
  -- (b) Dependencies, re-checked NOW against what the ledger holds (the same
  --     rules as verifyOutboxAgainstLedger, L_REF_*): an earlier file's
  --     rejected or uncertain row is exactly what this file may depend on.
  --     A closed lot still exists in CCRS (QoH 0), so it counts as held here.
  select array_agg(x.ref order by x.ref) into v_refs
    from (
      select distinct 'Product "' || (r.payload->>'Product') || '"' as ref
        from public.ccrs_file_rows r
       where r.file_id = f.id and f.file_type = 'Inventory'
         and not exists (select 1 from public.ccrs_filed_entities e
                          where e.env = f.env and e.file_type = 'Product' and e.filed_name = r.payload->>'Product'
                            and e.state in ('seed', 'filed', 'confirmed'))
      union
      select distinct 'Strain "' || (r.payload->>'Strain') || '"'
        from public.ccrs_file_rows r
       where r.file_id = f.id and f.file_type = 'Inventory' and coalesce(r.payload->>'Strain', '') <> ''
         and not exists (select 1 from public.ccrs_filed_entities e
                          where e.env = f.env and e.file_type = 'Strain' and lower(e.external_id) = lower(r.payload->>'Strain')
                            and e.state in ('seed', 'filed', 'confirmed'))
      union
      select distinct 'Area "' || (r.payload->>'Area') || '"'
        from public.ccrs_file_rows r
       where r.file_id = f.id and f.file_type = 'Inventory'
         and not exists (select 1 from public.ccrs_filed_entities e
                          where e.env = f.env and e.file_type = 'Area' and e.filed_name = r.payload->>'Area'
                            and e.state in ('seed', 'filed', 'confirmed'))
      union
      select distinct 'lot ' || (r.payload->>'InventoryExternalIdentifier')
        from public.ccrs_file_rows r
       where r.file_id = f.id and f.file_type in ('Sale', 'InventoryAdjustment')
         and not exists (select 1 from public.ccrs_filed_entities e
                          where e.env = f.env and e.file_type = 'Inventory' and e.external_id = r.payload->>'InventoryExternalIdentifier'
                            and e.state in ('seed', 'filed', 'confirmed', 'closed'))
    ) x;
  if v_refs is not null then
    v_block := coalesce(v_block, '{}') || array['CCRS does not hold ' || cardinality(v_refs) || ' thing(s) this file names: '
               || array_to_string(v_refs[1:20], ', ') || case when cardinality(v_refs) > 20 then ', ...' else '' end];
  end if;
  if v_block is not null and length(trim(coalesce(p_override, ''))) < 10 then
    raise exception 'CCRS_UPLOAD_NOT_READY: settle these first (or give a reason of 10+ characters): %', array_to_string(v_block, '; ')
      using errcode = 'check_violation';
  end if;
  update public.ccrs_files
     set state = 'uploaded', uploaded_at = p_uploaded_at, uploaded_by = p_by,
         notes = case when v_block is null then notes
                      else concat_ws(E'\n', notes, 'UPLOAD ORDER OVERRIDE: ' || trim(p_override)
                                     || ' [was waiting on: ' || array_to_string(v_block, '; ') || ']') end
   where id = f.id;
  update public.ccrs_file_rows set state = 'submitted' where file_id = f.id and state = 'emitted';
  return jsonb_build_object('id', f.id, 'file_name', f.file_name, 'state', 'uploaded',
                            'overridden', v_block is not null, 'waiting_on', coalesce(to_jsonb(v_block), '[]'::jsonb));
end $$;

comment on function public.ccrs_mark_uploaded(uuid, timestamptz, uuid, text) is
  'S-12c: emitted -> uploaded. Re-hashes the stored bytes; refuses while an earlier file is unanswered or a named lot/product/strain/area is not held, unless a 10+ character reason is logged (Part 05 A, C).';

-- ---------------------------------------------------------------------------
-- 3) ccrs_promote_rows (internal): what CCRS now holds because these rows of
--    file f landed. Set-based so a 10,000-row chunk is one pass.
--      Insert (and Strain, which has no Operation) -> entity filed (tentative);
--        Inventory with QuantityOnHand 0 -> closed (the seed rule, Part 03 D.4).
--      Update  -> last_*; Product/Area Name follows the Update; Inventory QoH
--        0 -> closed, a closed lot updated above 0 -> filed (re-open).
--      Delete  -> deleted.
--    A new Inventory entity gets product_external_id = the ONE present Product
--    entity holding the row's Product name exactly; resolveProductName()
--    withholds a ledger lot that has none, so an unresolved name is reported.
-- ---------------------------------------------------------------------------
create or replace function public.ccrs_promote_rows(p_file_id uuid, p_row_ids uuid[], p_at timestamptz)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  f      public.ccrs_files%rowtype;
  v_unres integer;
begin
  select * into f from public.ccrs_files where id = p_file_id;
  if coalesce(array_length(p_row_ids, 1), 0) = 0 then
    return 0;
  end if;

  with ins as (
    select distinct on (r.external_id) r.*
      from public.ccrs_file_rows r
     where r.file_id = f.id and r.id = any(p_row_ids) and coalesce(r.operation, 'Insert') = 'Insert'
     order by r.external_id, r.row_no
  )
  insert into public.ccrs_filed_entities as e
    (env, file_type, external_id, filed_name, product_external_id, state, source,
     first_filed_at, last_operation, last_file_id, last_payload)
  select f.env, f.file_type, i.external_id,
         case f.file_type when 'Product' then i.payload->>'Name' when 'Area' then i.payload->>'Area'
                          when 'Strain' then i.external_id end,
         case when f.file_type = 'Inventory' then (
           select case when count(*) = 1 then min(p.external_id) end
             from public.ccrs_filed_entities p
            where p.env = f.env and p.file_type = 'Product' and p.filed_name = i.payload->>'Product'
              and p.state in ('seed', 'filed', 'confirmed')) end,
         case when f.file_type = 'Inventory' and nullif(i.payload->>'QuantityOnHand', '')::numeric = 0 then 'closed' else 'filed' end,
         'file:' || f.file_name, p_at, 'Insert', f.id, i.payload
    from ins i
  on conflict (env, file_type, external_id) do update
     set state = excluded.state, filed_name = excluded.filed_name, product_external_id = excluded.product_external_id,
         first_filed_at = excluded.first_filed_at, last_operation = 'Insert', last_file_id = excluded.last_file_id,
         last_payload = excluded.last_payload
   where e.state = 'deleted';

  update public.ccrs_filed_entities e
     set last_operation = 'Update', last_file_id = f.id, last_payload = r.payload,
         filed_name = case f.file_type when 'Product' then r.payload->>'Name' when 'Area' then r.payload->>'Area' else e.filed_name end,
         state = case
                   when f.file_type = 'Inventory' and nullif(r.payload->>'QuantityOnHand', '')::numeric = 0 then 'closed'
                   when f.file_type = 'Inventory' and e.state = 'closed' then 'filed'
                   else e.state end
    from public.ccrs_file_rows r
   where r.file_id = f.id and r.id = any(p_row_ids) and r.operation = 'Update'
     and e.env = f.env and e.file_type = f.file_type and e.external_id = r.external_id
     and e.state in ('seed', 'filed', 'confirmed', 'closed');

  update public.ccrs_filed_entities e
     set state = 'deleted', last_operation = 'Delete', last_file_id = f.id, last_payload = r.payload
    from public.ccrs_file_rows r
   where r.file_id = f.id and r.id = any(p_row_ids) and r.operation = 'Delete'
     and e.env = f.env and e.file_type = f.file_type and e.external_id = r.external_id;

  update public.ccrs_file_rows r
     set entity_id = e.id
    from public.ccrs_filed_entities e
   where r.file_id = f.id and r.id = any(p_row_ids) and r.entity_id is null
     and e.env = f.env and e.file_type = f.file_type and e.external_id = r.external_id;

  if f.file_type = 'Inventory' then
    select count(*) into v_unres
      from public.ccrs_filed_entities e
     where e.env = f.env and e.file_type = 'Inventory' and e.last_file_id = f.id
       and e.last_operation = 'Insert' and e.product_external_id is null;
    if v_unres > 0 then
      insert into public.ccrs_file_issues (file_id, severity, code, message)
      values (f.id, 'warning', 'W_LOT_PRODUCT_UNRESOLVED',
              v_unres || ' lot(s) filed by this file name a Product that is not exactly one held Product; '
              || 'next week they are withheld until the ledger names their Product (resolveProductName).');
    end if;
  end if;
  return coalesce(array_length(p_row_ids, 1), 0);
end $$;

comment on function public.ccrs_promote_rows(uuid, uuid[], timestamptz) is
  'S-12c internal: move ccrs_filed_entities to what CCRS holds after rows of a file landed (Part 05 A).';

-- ---------------------------------------------------------------------------
-- 4) ccrs_record_outcome: what CCRS answered for an uploaded file.
--    p_outcome:
--      success          "CCRS Processing Successful" for this exact file name
--      error-benign     error CSV whose every message is benign (Duplicate Strain)
--      error-rows       error CSV, every line matched to one of our rows;
--                       p_rejected = [{row_no, message, uncertain}]
--      error-fatal      a file-fatal message (CheckSum / header): every row rejected
--      error-unmatched  error CSV we could not match row by row: LAW 4, all uncertain
--      no-email         nothing 60+ minutes after upload (Part 05 E)
-- ---------------------------------------------------------------------------
create or replace function public.ccrs_record_outcome(
  p_file_id uuid, p_outcome text, p_at timestamptz,
  p_rejected jsonb default '[]'::jsonb, p_messages text[] default null)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  f          public.ccrs_files%rowtype;
  v_closable boolean;
  v_rej      uuid[];
  v_ok       uuid[];
  v_unc      uuid[];
  v_n        integer;
  v_final    text;
  v_closed_earlier integer := 0;
begin
  select * into f from public.ccrs_files where id = p_file_id for update;
  if not found then
    raise exception 'CCRS_FILE_NOT_FOUND: %', p_file_id using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext('ccrs_lifecycle:' || f.env));
  if f.state <> 'uploaded' then
    raise exception 'CCRS_OUTCOME_NOT_UPLOADED: % is %; record the upload first (an answer is recorded once)', f.file_name, f.state
      using errcode = 'check_violation';
  end if;
  if p_outcome is null or p_outcome not in ('success', 'error-benign', 'error-rows', 'error-fatal', 'error-unmatched', 'no-email') then
    raise exception 'CCRS_OUTCOME_BAD: %', p_outcome using errcode = 'check_violation';
  end if;
  if p_at is null or p_at > now() + interval '5 minutes' or p_at < f.uploaded_at - interval '5 minutes' then
    raise exception 'CCRS_OUTCOME_TIME: % is not between the upload (%) and now', p_at, f.uploaded_at
      using errcode = 'check_violation';
  end if;
  if p_outcome = 'no-email' and p_at < f.uploaded_at + interval '60 minutes' then
    raise exception 'CCRS_OUTCOME_SLA_NOT_REACHED: wait until 60 minutes after the upload (%) before declaring no email', f.uploaded_at
      using errcode = 'check_violation';
  end if;
  if p_outcome like 'error-%' and coalesce(array_length(p_messages, 1), 0) = 0 then
    raise exception 'CCRS_OUTCOME_NO_MESSAGES: an error outcome stores the distinct CCRS messages' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(coalesce(p_rejected, '[]'::jsonb)) <> 'array' then
    raise exception 'CCRS_OUTCOME_BAD_REJECTED: p_rejected must be an array' using errcode = 'check_violation';
  end if;
  if (p_outcome = 'error-rows') <> (jsonb_array_length(coalesce(p_rejected, '[]'::jsonb)) > 0) then
    raise exception 'CCRS_OUTCOME_BAD_REJECTED: error-rows needs the rejected rows, and only error-rows takes any'
      using errcode = 'check_violation';
  end if;
  if p_outcome = 'error-rows' then
    if exists (select 1 from jsonb_array_elements(p_rejected) x
                where jsonb_typeof(x->'row_no') <> 'number' or coalesce(x->>'message', '') = ''
                   or jsonb_typeof(coalesce(x->'uncertain', 'null'::jsonb)) <> 'boolean')
       or (select count(distinct (x->>'row_no')) from jsonb_array_elements(p_rejected) x) <> jsonb_array_length(p_rejected)
       or exists (select 1 from jsonb_array_elements(p_rejected) x
                   where not exists (select 1 from public.ccrs_file_rows r
                                      where r.file_id = f.id and r.row_no = (x->>'row_no')::integer)) then
      raise exception 'CCRS_OUTCOME_BAD_REJECTED: every rejected entry needs a distinct row_no of this file, a message and uncertain true/false'
        using errcode = 'check_violation';
    end if;
  end if;

  v_closable := f.file_type in ('Strain', 'Area', 'Sale', 'InventoryAdjustment', 'InventoryTransfer');

  -- Partition the file's rows.
  select coalesce(array_agg(r.id) filter (where x.row_no is not null), '{}'),
         coalesce(array_agg(r.id) filter (where x.row_no is null), '{}')
    into v_rej, v_ok
    from public.ccrs_file_rows r
    left join (select (e->>'row_no')::integer as row_no from jsonb_array_elements(coalesce(p_rejected, '[]'::jsonb)) e) x
      on x.row_no = r.row_no
   where r.file_id = f.id;

  if p_outcome in ('success', 'error-benign', 'error-rows') then
    -- rejected rows (error-rows only)
    update public.ccrs_file_rows r
       set state = case when (x->>'uncertain')::boolean then 'uncertain' else 'rejected' end
      from jsonb_array_elements(coalesce(p_rejected, '[]'::jsonb)) x
     where r.id = any(v_rej) and r.row_no = (x->>'row_no')::integer;
    insert into public.ccrs_file_issues (file_id, row_id, severity, code, message)
    select f.id, r.id, 'error',
           case when (x->>'uncertain')::boolean then 'CCRS_ROW_CONTRADICTS_LEDGER' else 'CCRS_ROW_REJECTED' end,
           'row ' || r.row_no || ' (' || r.external_id || '): ' || (x->>'message')
      from jsonb_array_elements(coalesce(p_rejected, '[]'::jsonb)) x
      join public.ccrs_file_rows r on r.file_id = f.id and r.row_no = (x->>'row_no')::integer;
    -- a rejection that contradicts the ledger (Duplicate External Identifier on
    -- an Insert, ExternalIdentifier not found on an Update) makes the entity
    -- uncertain: routing withholds it until a copy settles it.
    select coalesce(array_agg(r.id), '{}') into v_unc
      from jsonb_array_elements(coalesce(p_rejected, '[]'::jsonb)) x
      join public.ccrs_file_rows r on r.file_id = f.id and r.row_no = (x->>'row_no')::integer
     where (x->>'uncertain')::boolean;
    insert into public.ccrs_filed_entities as e (env, file_type, external_id, state, source, last_operation, last_file_id, last_payload)
    select distinct on (r.external_id) f.env, f.file_type, r.external_id, 'uncertain', 'file:' || f.file_name, r.operation, f.id, r.payload
      from public.ccrs_file_rows r where r.id = any(v_unc)
     order by r.external_id, r.row_no
    on conflict (env, file_type, external_id) do update
       set state = 'uncertain', last_file_id = excluded.last_file_id;
    -- every other row landed (U-17 CLOSED FALSE)
    perform public.ccrs_promote_rows(f.id, v_ok, p_at);
    if v_closable then
      update public.ccrs_file_rows set state = 'confirmed' where id = any(v_ok);
    end if;
    if p_outcome = 'success' then
      update public.ccrs_files set state = 'succeeded', success_email_at = p_at where id = f.id;
      v_final := 'succeeded';
    else
      update public.ccrs_files set state = 'errored', error_email_at = p_at, error_messages = p_messages where id = f.id;
      v_final := 'errored';
    end if;
    if cardinality(v_unc) > 0 then
      update public.ccrs_files set state = 'reconciling' where id = f.id;
      v_final := 'reconciling';
    elsif v_closable then
      update public.ccrs_files set state = 'closed' where id = f.id;
      v_final := 'closed';
    end if;

    -- Part 05 A: a later successful Update of the same ids proves an earlier
    -- Inventory/Product file's rows exist -> confirmed; a file whose rows are
    -- all settled closes.
    if f.file_type in ('Inventory', 'Product') then
      with proof as (
        select r.external_id from public.ccrs_file_rows r
         where r.id = any(v_ok) and r.operation = 'Update'
      ), hit as (
        update public.ccrs_file_rows g set state = 'confirmed'
          from public.ccrs_files gf
         where g.file_id = gf.id and gf.env = f.env and gf.file_type = f.file_type and gf.id <> f.id
           and gf.stamp_at < f.stamp_at and gf.state in ('succeeded', 'errored')
           and g.state = 'submitted' and g.external_id in (select external_id from proof)
        returning g.file_id, g.external_id
      ), ent as (
        update public.ccrs_filed_entities e set state = 'confirmed'
         where e.env = f.env and e.file_type = f.file_type and e.state = 'filed'
           and e.external_id in (select external_id from hit)
        returning 1
      )
      select count(*) into v_n from ent;
      update public.ccrs_files gf set state = 'closed'
       where gf.env = f.env and gf.file_type = f.file_type and gf.id <> f.id and gf.state in ('succeeded', 'errored')
         and gf.stamp_at < f.stamp_at
         and not exists (select 1 from public.ccrs_file_rows g
                          where g.file_id = gf.id and g.state not in ('confirmed', 'rejected', 'withheld'));
      get diagnostics v_closed_earlier = row_count;
    end if;

  elsif p_outcome = 'error-fatal' then
    update public.ccrs_file_rows set state = 'rejected' where file_id = f.id;
    update public.ccrs_files set state = 'errored', error_email_at = p_at, error_messages = p_messages where id = f.id;
    update public.ccrs_files set state = 'closed' where id = f.id;
    v_final := 'closed';

  else  -- error-unmatched | no-email : LAW 4, nobody knows which rows landed
    update public.ccrs_file_rows set state = 'uncertain' where file_id = f.id;
    -- existence is unknown only for Insert/Delete (an Update never changes
    -- whether CCRS holds the record)
    insert into public.ccrs_filed_entities as e (env, file_type, external_id, state, source, last_operation, last_file_id, last_payload)
    select distinct on (r.external_id) f.env, f.file_type, r.external_id, 'uncertain', 'file:' || f.file_name,
           coalesce(r.operation, 'Insert'), f.id, r.payload
      from public.ccrs_file_rows r
     where r.file_id = f.id and coalesce(r.operation, 'Insert') in ('Insert', 'Delete')
     order by r.external_id, r.row_no
    on conflict (env, file_type, external_id) do update
       set state = 'uncertain', last_file_id = excluded.last_file_id;
    if p_outcome = 'error-unmatched' then
      update public.ccrs_files set state = 'errored', error_email_at = p_at, error_messages = p_messages where id = f.id;
    end if;
    update public.ccrs_files set state = 'reconciling' where id = f.id;
    v_final := 'reconciling';
  end if;

  update public.ccrs_file_rows r
     set entity_id = e.id
    from public.ccrs_filed_entities e
   where r.file_id = f.id and r.entity_id is null
     and e.env = f.env and e.file_type = f.file_type and e.external_id = r.external_id;

  return jsonb_build_object(
    'id', f.id, 'file_name', f.file_name, 'outcome', p_outcome, 'state', v_final,
    'rows', jsonb_build_object(
      'total', (select count(*) from public.ccrs_file_rows where file_id = f.id),
      'rejected', (select count(*) from public.ccrs_file_rows where file_id = f.id and state = 'rejected'),
      'uncertain', (select count(*) from public.ccrs_file_rows where file_id = f.id and state = 'uncertain'),
      'landed', (select count(*) from public.ccrs_file_rows where file_id = f.id and state in ('submitted', 'confirmed'))),
    'earlier_files_closed', v_closed_earlier);
end $$;

comment on function public.ccrs_record_outcome(uuid, text, timestamptz, jsonb, text[]) is
  'S-12c: record CCRS''s answer for an uploaded file and move the ledger (Part 05 A, D.2, E; U-17 CLOSED FALSE).';

-- ---------------------------------------------------------------------------
-- 5) ccrs_abandon_file: an emitted file that will never be uploaded.
-- ---------------------------------------------------------------------------
create or replace function public.ccrs_abandon_file(p_file_id uuid, p_reason text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  f public.ccrs_files%rowtype;
begin
  select * into f from public.ccrs_files where id = p_file_id for update;
  if not found then
    raise exception 'CCRS_FILE_NOT_FOUND: %', p_file_id using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext('ccrs_lifecycle:' || f.env));
  if f.state <> 'emitted' then
    raise exception 'CCRS_ABANDON_NOT_EMITTED: % is %; only a file that was never uploaded can be abandoned', f.file_name, f.state
      using errcode = 'check_violation';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'CCRS_ABANDON_REASON: give a reason of 10+ characters' using errcode = 'check_violation';
  end if;
  update public.ccrs_files
     set state = 'abandoned', notes = concat_ws(E'\n', notes, 'ABANDONED: ' || trim(p_reason))
   where id = f.id;
  return jsonb_build_object('id', f.id, 'file_name', f.file_name, 'state', 'abandoned');
end $$;

comment on function public.ccrs_abandon_file(uuid, text) is
  'S-12c: emitted -> abandoned with a logged reason. Bytes, name and hash are kept and never reused (Part 05 A).';

-- ---------------------------------------------------------------------------
-- 6) ccrs_preprod_ledger_start: let PREprod exports be recorded.
--    ccrs_ledger_slice reports a ledger "loaded" only when the env has a
--    closed seed file. PREprod has no Service Desk delivery, so it starts
--    EMPTY: nothing is assumed about what PREprod holds. Every PREprod export
--    then routes Insert for anything this ledger has not recorded, and
--    records the outcome, so a second PREprod run routes Update.
-- ---------------------------------------------------------------------------
create or replace function public.ccrs_preprod_ledger_start(p_by text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_note text;
  v_id   uuid;
begin
  perform pg_advisory_xact_lock(hashtext('ccrs_lifecycle:preprod'));
  select id into v_id from public.ccrs_files where env = 'preprod' and purpose = 'seed' and state = 'closed' limit 1;
  if v_id is not null then
    return jsonb_build_object('status', 'already', 'id', v_id);
  end if;
  if length(trim(coalesce(p_by, ''))) = 0 then
    raise exception 'CCRS_PREPROD_START_BY: who started it is recorded' using errcode = 'check_violation';
  end if;
  v_note := 'PREprod ledger started EMPTY at ' || to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD HH24:MI:SS')
            || ' Pacific by ' || trim(p_by) || '. Nothing is assumed about what PREprod already holds.';
  insert into public.ccrs_files (env, file_type, purpose, file_name, sha256, number_records, storage_path, state, notes)
  values ('preprod', 'Area', 'seed', 'preprod-ledger-start:' || to_char(now(), 'YYYYMMDDHH24MISS'),
          encode(sha256(convert_to(v_note, 'UTF8')), 'hex'), 0, 'none', 'closed', v_note)
  returning id into v_id;
  return jsonb_build_object('status', 'started', 'id', v_id);
end $$;

comment on function public.ccrs_preprod_ledger_start(text) is
  'S-12c: create the PREprod seed marker (empty) so PREprod exports are recorded and routed against what earlier PREprod runs filed.';

-- ---------------------------------------------------------------------------
-- 7) Grants: these write the State's record - service role only.
-- ---------------------------------------------------------------------------
revoke all on function public.ccrs_upload_group(text) from public, anon, authenticated;
revoke all on function public.ccrs_mark_uploaded(uuid, timestamptz, uuid, text) from public, anon, authenticated;
revoke all on function public.ccrs_promote_rows(uuid, uuid[], timestamptz) from public, anon, authenticated;
revoke all on function public.ccrs_record_outcome(uuid, text, timestamptz, jsonb, text[]) from public, anon, authenticated;
revoke all on function public.ccrs_abandon_file(uuid, text) from public, anon, authenticated;
revoke all on function public.ccrs_preprod_ledger_start(text) from public, anon, authenticated;
grant execute on function public.ccrs_upload_group(text) to service_role;
grant execute on function public.ccrs_mark_uploaded(uuid, timestamptz, uuid, text) to service_role;
grant execute on function public.ccrs_record_outcome(uuid, text, timestamptz, jsonb, text[]) to service_role;
-- ccrs_promote_rows is internal, but ccrs_record_outcome is NOT security definer,
-- so it runs with the caller's rights: the role that calls record_outcome must be
-- able to run the helper too (same pattern as 0248's seed_finalize ->
-- link_unfiled_migration_lots). Proven by scripts/recon/ccrs-lifecycle-e2e.ts run
-- with PGROLEURL logged in as service_role.
grant execute on function public.ccrs_promote_rows(uuid, uuid[], timestamptz) to service_role;
grant execute on function public.ccrs_abandon_file(uuid, text) to service_role;
grant execute on function public.ccrs_preprod_ledger_start(text) to service_role;
