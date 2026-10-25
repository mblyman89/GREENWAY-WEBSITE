-- scripts/recon/ai-batch-mission-control-0299-pg-check.sql  (R74 S41 - migration 0299)
--
-- Scenario check for 0299_ai_batch_mission_control.sql on Postgres 15 with
-- every migration applied. ONE transaction, rolled back: no rows remain.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f scripts/recon/ai-batch-mission-control-0299-pg-check.sql
--
-- "R74 0299 CHECK PASSED" then ROLLBACK = all clear.
begin;

do $$
declare
  b uuid;
  ok boolean;
  n int;
begin
  -- 'lost' is a valid batch state; nonsense is not.
  insert into public.ai_batches (model, state) values ('gemini-test', 'lost') returning id into b;
  begin
    update public.ai_batches set state = 'nonsense' where id = b;
    raise exception 'state check accepted nonsense';
  exception when check_violation then null;
  end;
  update public.ai_batches set google_state = 'BATCH_STATE_RUNNING', batch_stats = '{"total":2}'::jsonb, poll_status = 200, last_polled_at = now() where id = b;

  -- The message log: severity / kind checked; batch delete keeps the message.
  insert into public.ai_batch_events (kind, severity, title, batch_id) values ('poll', 'warn', 'test', b);
  begin
    insert into public.ai_batch_events (kind, title) values ('nonsense', 'x');
    raise exception 'kind check accepted nonsense';
  exception when check_violation then null;
  end;
  delete from public.ai_batches where id = b;
  select count(*) into n from public.ai_batch_events where title = 'test' and batch_id is null;
  if n <> 1 then raise exception 'event lost with its batch (%).', n; end if;

  -- One sender at a time.
  delete from public.site_settings where key = 'ai_batch_send_lease';
  ok := public.ai_batch_send_lease('a', 60);
  if not ok then raise exception 'first holder refused'; end if;
  ok := public.ai_batch_send_lease('b', 60);
  if ok then raise exception 'second holder got the lease'; end if;
  ok := public.ai_batch_send_lease('a', 60);
  if not ok then raise exception 'same holder refused'; end if;
  perform public.ai_batch_send_release('a');
  ok := public.ai_batch_send_lease('b', 60);
  if not ok then raise exception 'released lease not reusable'; end if;

  -- Budget never goes below 0.
  insert into public.site_settings (key, label, value_json, updated_at)
  values ('ai_batch_control', 'test', '{"paused":false,"budget":1}'::jsonb, now())
  on conflict (key) do update set value_json = jsonb_set(public.site_settings.value_json, '{budget}', '1');
  if public.ai_batch_budget_spend() <> 0 then raise exception 'budget spend wrong'; end if;
  if public.ai_batch_budget_spend() <> 0 then raise exception 'budget went below zero'; end if;

  raise notice 'R74 0299 CHECK PASSED';
end $$;

rollback;
