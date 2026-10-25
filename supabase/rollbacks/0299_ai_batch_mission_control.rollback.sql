-- Rollback for 0299_ai_batch_mission_control.sql (R74 S41).
-- Rows in state 'lost' go back to 'expired' so the 0295 check fits again.
drop function if exists public.ai_batch_budget_spend();
drop function if exists public.ai_batch_send_release(text);
drop function if exists public.ai_batch_send_lease(text, integer);
drop table if exists public.ai_batch_events;
delete from public.site_settings where key = 'ai_batch_send_lease';
update public.ai_batches set state = 'expired' where state = 'lost';
alter table public.ai_batches drop constraint if exists ai_batches_state_check_s41;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.ai_batches'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%submitting%') then
    alter table public.ai_batches add constraint ai_batches_state_check
      check (state in ('submitting', 'pending', 'running', 'succeeded', 'failed', 'canceled', 'expired', 'ingesting', 'ingested'));
  end if;
end $$;
alter table public.ai_batches drop column if exists poll_error;
alter table public.ai_batches drop column if exists poll_status;
alter table public.ai_batches drop column if exists last_polled_at;
alter table public.ai_batches drop column if exists google_update_time;
alter table public.ai_batches drop column if exists google_create_time;
alter table public.ai_batches drop column if exists batch_stats;
alter table public.ai_batches drop column if exists google_state;
notify pgrst, 'reload schema';
