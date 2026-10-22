-- Rollback for 0290_ach_notice_mail.sql (R41 S17).
--
-- REFUSES once a notice email has been stored: it is Greenway's record of
-- which bank notice emails arrived and who handled them. Export the rows
-- first and decide with the owner. Do not drop.
--
-- Otherwise it drops the table and its two trigger functions. The settings
-- row in site_settings (ach_notice_mail_settings) is left alone. Safe to re-run.
do $$
declare
  used boolean;
begin
  if to_regclass('public.ach_notice_mail') is not null then
    execute 'select exists (select 1 from public.ach_notice_mail)' into used;
    if used then
      raise exception 'ROLLBACK REFUSED: ach_notice_mail holds notice emails. Export them first; do not drop.';
    end if;
  end if;
end $$;

drop table if exists public.ach_notice_mail;
drop function if exists public.ach_notice_mail_guard();
drop function if exists public.ach_notice_mail_no_truncate();
