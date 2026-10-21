-- Rollback for 0287_ach_timberland_comms_notices.sql (R41 S13).
--
-- REFUSES once any entry of the three new types exists (noc_wrong,
-- ofac_notice, bank_report_received): every row is a record, kept forever, and
-- the 0277 list could not hold it. Export the rows first and decide with the
-- owner. Do not delete.
--
-- Otherwise it puts the 0277 entry type list and the 0277 guard function back
-- VERBATIM. The table and its rows stay. Safe to re-run.
do $$
begin
  if exists (select 1 from public.ach_timberland_comms where entry_type in ('noc_wrong', 'ofac_notice', 'bank_report_received')) then
    raise exception 'ROLLBACK REFUSED: the Timberland log holds noc_wrong, ofac_notice or bank_report_received entries (records). Export them first; do not delete.';
  end if;
end $$;

alter table public.ach_timberland_comms drop constraint if exists ach_timberland_comms_entry_type_check;
alter table public.ach_timberland_comms add constraint ach_timberland_comms_entry_type_check
  check (entry_type in (
                  'amendment_notice', 'fee_notice', 'reserve_demand', 'auth_copy_request',
                  'over_limit_request', 'prefunding_notice', 'termination_notice',
                  'dual_approval_on', 'schedule_g_email_corrected', 'access_ready',
                  'countersigned_received', 'compromise_reported', 'reversal_needed',
                  'statement_received', 'other', 'done'));

create or replace function public.ach_timberland_comms_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  today date := (now() at time zone 'America/Los_Angeles')::date;
  target record;
begin
  if tg_op <> 'INSERT' then
    raise exception 'ACH_COMMS_APPEND_ONLY: the Timberland log is never changed or deleted. Add a new entry that corrects it.';
  end if;
  if not public.ach_write_by_owner(new.created_by) then
    raise exception 'ACH_OWNER_ONLY: only the owner adds to the Timberland log. Send it as a request for owner approval.';
  end if;
  if new.received_on > today then
    raise exception 'ACH_COMMS_DATE: the date cannot be in the future (%).', new.received_on;
  end if;
  if new.received_on < today - 400 then
    raise exception 'ACH_COMMS_DATE: the date is more than 400 days ago (%). Check the year.', new.received_on;
  end if;
  if new.occurred_at is not null and new.occurred_at > now() + interval '5 minutes' then
    raise exception 'ACH_COMMS_DATE: the time cannot be in the future.';
  end if;
  if new.entry_type = 'done' then
    if new.closes_id is null then
      raise exception 'ACH_COMMS_CLOSE: a done entry must name the item it closes.';
    end if;
    select entry_type, received_on into target from public.ach_timberland_comms where id = new.closes_id;
    if not found then
      raise exception 'ACH_COMMS_CLOSE: the item to close was not found.';
    end if;
    if target.entry_type not in ('amendment_notice', 'fee_notice', 'reserve_demand', 'auth_copy_request',
                                 'over_limit_request', 'prefunding_notice', 'compromise_reported',
                                 'reversal_needed', 'statement_received', 'termination_notice') then
      raise exception 'ACH_COMMS_CLOSE: a % entry has no clock to close.', target.entry_type;
    end if;
    if new.received_on < target.received_on then
      raise exception 'ACH_COMMS_CLOSE: it cannot be done before it arrived (%).', target.received_on;
    end if;
  end if;
  return new;
end $$;

revoke all on function public.ach_timberland_comms_guard() from public, anon, authenticated;

comment on table public.ach_timberland_comms is
  'R41 S10 (0277): the Timberland communications log. Append-only (never updated or deleted), owner-stamped. Due dates are computed in the app from the signed agreement.';
