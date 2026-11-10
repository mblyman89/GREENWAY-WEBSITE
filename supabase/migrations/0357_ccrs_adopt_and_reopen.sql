-- 0357_ccrs_adopt_and_reopen.sql  (D228, CCRS hand-made file + reopen a set-aside email)
--
-- WHY. On 2026-11-10 the owner uploaded a hand-made PREprod Sale file
-- (Sale_413541_20261110150000.csv, the two refused rows with the fixed
-- excise). CCRS accepted it (PRE success email, Date Submitted 11:51:35 AM).
-- The hub could not apply that confirmation because the file was never in
-- the outbox (the name is unknown), and the email was then set aside. The
-- 0282 guard made a set-aside email final, so it could not be applied later
-- either. Renaming the file cannot help: CCRS refuses a line it already
-- holds (Duplicate Sale for Licensee) and the same data is never filed twice
-- [BRIAN A29].
--
-- WHAT.
--   1) ccrs_mail_messages gets three history columns (reopened_at,
--      reopened_by, reopen_note). reopen_note is append only: each reopen
--      adds one line that keeps the earlier set-aside note, who and when.
--   2) The 0282 guard is replaced. Everything it refused it still refuses,
--      with ONE exception: a DISMISSED email may go back to new when the
--      update also stamps a new reopened_at and appends to reopen_note.
--      An APPLIED email stays final (its answer is in the ledger).
--   3) ccrs_reopen_mail(id, by, reason): the only door for that move. Needs
--      a reason of 10 or more characters.
--   4) ccrs_adopt_handmade_file(env, file, uploaded_at, by, reason): stores
--      the EXACT bytes the owner uploaded under the EXACT name CCRS saw,
--      with the same byte checks as ccrs_emit_files (hash, CRLF, header,
--      NumberRecords, row width, same bytes never twice). The monotonic
--      stamp rule is the one check left out: CCRS already fixed this name
--      and a later export may hold a later stamp. Then it marks it uploaded
--      through ccrs_mark_uploaded (same byte, pacing and dependency checks, the
--      reason is the logged override) and finally sets uploaded_at to the
--      time CCRS gave (Date Submitted), which is before the hub stored it.
--      The file notes say ADOPTED so nobody mistakes it for an outbox file.
--      The name must match its type and its stamp must be the Pacific wall
--      clock of stamp_at, as every outbox name is.
--
-- Not security definer, search_path pinned, service role only.
-- Idempotent: safe to run more than once.
-- Rollback: supabase/rollbacks/0357_ccrs_adopt_and_reopen.rollback.sql

alter table public.ccrs_mail_messages add column if not exists reopened_at timestamptz;
alter table public.ccrs_mail_messages add column if not exists reopened_by uuid references public.staff_profiles(id) on delete set null;
alter table public.ccrs_mail_messages add column if not exists reopen_note text;

comment on column public.ccrs_mail_messages.reopen_note is
  'D228: append only. One line per reopen of a set-aside email, keeping the earlier set-aside note, who and when.';

-- Guard: what was received never changes. state leaves new once, except that
-- a dismissed email may return to new through ccrs_reopen_mail. Applied is
-- final. A stored email is never deleted.
create or replace function public.ccrs_mail_messages_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'CCRS_MAIL_KEPT: a received CCRS email is never deleted';
  end if;
  if new.mailbox is distinct from old.mailbox
     or new.gmail_id is distinct from old.gmail_id
     or new.received_at is distinct from old.received_at
     or new.from_header is distinct from old.from_header
     or new.subject is distinct from old.subject
     or new.body_text is distinct from old.body_text
     or new.csvs is distinct from old.csvs then
    raise exception 'CCRS_MAIL_IMMUTABLE: a received CCRS email is kept as received';
  end if;
  if new.reopen_note is distinct from old.reopen_note
     and (new.reopen_note is null
          or left(new.reopen_note, length(coalesce(old.reopen_note, ''))) <> coalesce(old.reopen_note, '')) then
    raise exception 'CCRS_MAIL_IMMUTABLE: the reopen history of a CCRS email is append only';
  end if;
  if old.state <> 'new' and new.state is distinct from old.state then
    if old.state = 'dismissed' and new.state = 'new'
       and new.reopened_at is not null and new.reopened_at is distinct from old.reopened_at
       and length(coalesce(new.reopen_note, '')) > length(coalesce(old.reopen_note, '')) then
      return new;
    end if;
    raise exception 'CCRS_MAIL_HANDLED: this email was already % (only a set-aside email can be reopened, with a reason)', old.state;
  end if;
  return new;
end
$$;

drop trigger if exists ccrs_mail_messages_guard on public.ccrs_mail_messages;
create trigger ccrs_mail_messages_guard
  before update or delete on public.ccrs_mail_messages
  for each row execute function public.ccrs_mail_messages_guard();

-- ccrs_reopen_mail: dismissed -> new, with the reason and the old note kept.
create or replace function public.ccrs_reopen_mail(p_id uuid, p_by uuid, p_reason text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  m public.ccrs_mail_messages%rowtype;
  v_line text;
begin
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'CCRS_MAIL_REOPEN_REASON: give a reason of 10 or more characters' using errcode = 'check_violation';
  end if;
  select * into m from public.ccrs_mail_messages where id = p_id for update;
  if not found then
    raise exception 'CCRS_MAIL_NOT_FOUND: %', p_id using errcode = 'check_violation';
  end if;
  if m.state <> 'dismissed' then
    raise exception 'CCRS_MAIL_REOPEN_STATE: only a set-aside email can be reopened, this one is %', m.state
      using errcode = 'check_violation';
  end if;
  v_line := to_char(clock_timestamp() at time zone 'America/Los_Angeles', 'YYYY-MM-DD HH24:MI:SS') || ' PT reopened: ' || trim(p_reason)
            || ' [was set aside ' || coalesce(to_char(m.handled_at at time zone 'America/Los_Angeles', 'YYYY-MM-DD HH24:MI:SS') || ' PT', 'time unknown')
            || ' by ' || coalesce(m.handled_by::text, 'unknown') || ': ' || coalesce(m.handled_note, '') || ']';
  update public.ccrs_mail_messages
     set state = 'new', handled_at = null, handled_by = null, handled_note = null,
         reopened_at = clock_timestamp(), reopened_by = p_by,
         reopen_note = concat_ws(E'\n', reopen_note, v_line)
   where id = m.id;
  return jsonb_build_object('id', m.id, 'state', 'new', 'was', m.state, 'note', v_line);
end $$;

comment on function public.ccrs_reopen_mail(uuid, uuid, text) is
  'D228: a set-aside CCRS email back to new so it can be applied. Reason 10+ characters, the earlier note kept in reopen_note. Applied stays final.';

-- ccrs_adopt_handmade_file: store a hand-made file CCRS accepted, as uploaded.
create or replace function public.ccrs_adopt_handmade_file(
  p_env text, p_file jsonb, p_uploaded_at timestamptz, p_by uuid, p_reason text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_name  text := p_file->>'file_name';
  v_type  text := p_file->>'file_type';
  v_stamp timestamptz;
  v_content text;
  v_lines text[];
  v_cols  text[];
  v_n     integer;
  v_idcol text;
  v_id    uuid;
  v_up    jsonb;
begin
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'CCRS_ADOPT_REASON: give a reason of 10 or more characters' using errcode = 'check_violation';
  end if;
  if p_env not in ('preprod', 'prod') then
    raise exception 'CCRS_ADOPT_BAD_ENV: %', p_env using errcode = 'check_violation';
  end if;
  if v_type not in ('Strain', 'Area', 'Product', 'Inventory', 'Sale', 'InventoryAdjustment', 'InventoryTransfer')
     or v_name is null or v_name !~ ('^' || v_type || '_[0-9]+_[0-9]{14}\.csv$') then
    raise exception 'CCRS_ADOPT_NAME: % is not a CCRS file name of type %', v_name, v_type using errcode = 'check_violation';
  end if;
  v_stamp := nullif(p_file->>'stamp_at', '')::timestamptz;
  if v_stamp is null
     or to_char(v_stamp at time zone 'America/Los_Angeles', 'YYYYMMDDHH24MISS') <> substring(v_name from '_([0-9]{14})\.csv$') then
    raise exception 'CCRS_ADOPT_NAME: the stamp in % is not the Pacific time of stamp_at %', v_name, v_stamp using errcode = 'check_violation';
  end if;
  if p_uploaded_at is null or p_uploaded_at > now() + interval '5 minutes' or p_uploaded_at < now() - interval '30 days' then
    raise exception 'CCRS_ADOPT_TIME: % is not a CCRS Date Submitted from the last 30 days', p_uploaded_at using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.ccrs_files c where c.file_name = v_name) then
    raise exception 'CCRS_ADOPT_ALREADY_STORED: % is already in the outbox, apply its email instead', v_name using errcode = 'check_violation';
  end if;

  -- The same byte checks as ccrs_emit_files (0248), run here because the
  -- monotonic stamp rule cannot apply: CCRS already fixed this name, and a
  -- later export may already hold a later stamp.
  if exists (select 1 from public.ccrs_files c where c.env = p_env and c.sha256 = p_file->>'sha256') then
    raise exception 'CCRS_ADOPT_ALREADY_STORED: these exact bytes are already stored in %', p_env using errcode = 'check_violation';
  end if;
  v_content := p_file->>'content';
  if encode(sha256(convert_to(v_content, 'UTF8')), 'hex') is distinct from p_file->>'sha256' then
    raise exception 'CCRS_HASH_MISMATCH: % bytes do not hash to the stated sha256', v_name using errcode = 'check_violation';
  end if;
  if right(v_content, 2) <> E'\r\n' then
    raise exception 'CCRS_NOT_CRLF_TERMINATED: %', v_name using errcode = 'check_violation';
  end if;
  v_lines := string_to_array(left(v_content, -2), E'\r\n');
  if coalesce(array_length(v_lines, 1), 0) < 4 then
    raise exception 'CCRS_SHORT_HEADER: % has fewer than 4 header lines', v_name using errcode = 'check_violation';
  end if;
  v_n := array_length(v_lines, 1) - 4;
  if v_n < 1 or v_lines[3] <> ('NumberRecords,' || v_n::text) or (p_file->>'number_records')::integer <> v_n then
    raise exception 'CCRS_RECORD_COUNT_MISMATCH: % header says [%], stated %, data lines %',
      v_name, v_lines[3], p_file->>'number_records', v_n using errcode = 'check_violation';
  end if;
  v_cols := string_to_array(v_lines[4], ',');
  if exists (
    select 1 from unnest(v_lines[5:]) as d(line)
     where coalesce(array_length(string_to_array(d.line, ','), 1), 0) <> array_length(v_cols, 1)
  ) then
    raise exception 'CCRS_ROW_WIDTH: a data row of % does not have % cells when split on every comma',
      v_name, array_length(v_cols, 1) using errcode = 'check_violation';
  end if;

  -- born draft (0247 guard), then emitted, in this transaction
  insert into public.ccrs_files (env, file_type, purpose, chunk_no, chunk_of, file_name, number_records,
                                 distinct_ids, sum_qoh, sum_total_cost, control_totals, stamp_at)
  values (p_env, v_type, 'weekly', 1, 1, v_name, v_n, (p_file->>'distinct_ids')::integer,
          (p_file->>'sum_qoh')::numeric, (p_file->>'sum_total_cost')::numeric, p_file->'control_totals', v_stamp)
  returning id into v_id;
  insert into public.ccrs_file_contents (file_id, content, byte_length)
  values (v_id, v_content, octet_length(v_content));
  v_idcol := case v_type when 'Strain' then 'Strain' when 'Sale' then 'SaleDetailExternalIdentifier' else 'ExternalIdentifier' end;
  insert into public.ccrs_file_rows (file_id, row_no, entity_id, external_id, operation, payload, state)
  select v_id, d.n::integer, e.id, p.payload->>v_idcol, nullif(p.payload->>'Operation', ''), p.payload, 'emitted'
    from unnest(v_lines[5:]) with ordinality as d(line, n)
    cross join lateral (
      select jsonb_object_agg(u.col, u.val) as payload
        from unnest(v_cols, string_to_array(d.line, ',')) as u(col, val)
    ) p
    left join public.ccrs_filed_entities e
      on e.env = p_env and e.file_type = v_type and e.external_id = p.payload->>v_idcol;
  update public.ccrs_files
     set state = 'emitted', sha256 = p_file->>'sha256', storage_path = 'db:ccrs_file_contents/' || v_id, emitted_at = now()
   where id = v_id;

  v_up := public.ccrs_mark_uploaded(v_id, now(), p_by, p_reason);

  update public.ccrs_files
     set uploaded_at = p_uploaded_at,
         notes = concat_ws(E'\n', notes, 'ADOPTED hand-made file: uploaded to CCRS by hand at '
                 || to_char(p_uploaded_at at time zone 'America/Los_Angeles', 'YYYY-MM-DD HH24:MI:SS') || ' PT, stored by the hub afterwards. Reason: ' || trim(p_reason))
   where id = v_id;
  insert into public.ccrs_file_issues (file_id, severity, code, message)
  values (v_id, 'info', 'ADOPTED_HANDMADE', 'Hand-made file adopted after CCRS accepted it. Reason: ' || trim(p_reason));

  return jsonb_build_object('id', v_id, 'file_name', v_name, 'state', 'uploaded', 'uploaded_at', p_uploaded_at,
                            'overridden', coalesce((v_up->>'overridden')::boolean, false), 'waiting_on', coalesce(v_up->'waiting_on', '[]'::jsonb));
end $$;

comment on function public.ccrs_adopt_handmade_file(text, jsonb, timestamptz, uuid, text) is
  'D228: store the exact bytes of a hand-made CCRS file under its exact name (0248 checks), mark it uploaded (0249 checks, reason logged) at the CCRS Date Submitted time.';

revoke all on function public.ccrs_reopen_mail(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.ccrs_reopen_mail(uuid, uuid, text) to service_role;
revoke all on function public.ccrs_adopt_handmade_file(text, jsonb, timestamptz, uuid, text) from public, anon, authenticated;
grant execute on function public.ccrs_adopt_handmade_file(text, jsonb, timestamptz, uuid, text) to service_role;

notify pgrst, 'reload schema';
