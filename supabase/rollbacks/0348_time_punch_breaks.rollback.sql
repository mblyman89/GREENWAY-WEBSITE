-- supabase/rollbacks/0348_time_punch_breaks.rollback.sql  (D211)
--
-- Undo 0348_time_punch_breaks.sql. The break punches themselves stay (punch_kind = 'break' is 0037's,
-- and payroll still leaves them unpaid). Before the columns are dropped, the reason and note of every
-- break are appended to that punch's `notes` as "[Break: lunch - <note>]", so the pre-0348 app still
-- shows why. Run the whole file as ONE transaction (the Supabase SQL editor does).

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'time_punches'
                and column_name = 'break_reason') then
    update public.time_punches
       set notes = btrim(coalesce(notes, '') || ' [Break: ' || break_reason
                   || coalesce(' - ' || break_note, '') || ']')
     where break_reason is not null
       and coalesce(notes, '') not like '%[Break:%';
  end if;
end
$$;

drop index if exists public.time_punches_open_break_idx;
alter table public.time_punches drop constraint if exists time_punches_break_other_needs_note;
alter table public.time_punches drop constraint if exists time_punches_break_note_len;
alter table public.time_punches drop constraint if exists time_punches_break_shape;
alter table public.time_punches drop constraint if exists time_punches_break_reason_values;
alter table public.time_punches drop column if exists break_note;
alter table public.time_punches drop column if exists break_reason;

notify pgrst, 'reload schema';
