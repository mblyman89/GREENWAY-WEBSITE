-- supabase/rollbacks/0343_drawer_count_integrity.rollback.sql  (D180 S3)
--
-- Undo 0343_drawer_count_integrity.sql. The money stays right: before the column is dropped,
-- every reconciled drawer whose reconciled figure differs from the closer's count gets the old
-- (pre-0343) shape back - closing_count_minor := reconciled_count_minor - because the pre-0343
-- app posts the books, deposit and EOD from closing_count_minor. The closer's own figure is still
-- in drawer_counts (count_type 'close') and in the notes, exactly as before 0343.
-- The second-count warnings (second_count_flags) are also in the audit log, so nothing is lost.

drop trigger if exists drawer_sessions_counts_immutable on public.drawer_sessions;
drop function if exists public.drawer_sessions_counts_immutable();

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'drawer_sessions'
                and column_name = 'reconciled_count_minor') then
    update public.drawer_sessions
       set closing_count_minor = reconciled_count_minor
     where reconciled_count_minor is not null
       and closing_count_minor is distinct from reconciled_count_minor;
  end if;
end
$$;

alter table public.drawer_sessions drop constraint if exists drawer_sessions_second_count_flags_known;
alter table public.drawer_sessions drop constraint if exists drawer_sessions_reconciled_count_nonneg;
alter table public.drawer_sessions drop column if exists second_count_entered_by_login;
alter table public.drawer_sessions drop column if exists second_count_flags;
alter table public.drawer_sessions drop column if exists second_count_opened_at;
alter table public.drawer_sessions drop column if exists reconciled_count_minor;
