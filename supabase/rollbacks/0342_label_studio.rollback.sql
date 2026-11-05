-- supabase/rollbacks/0342_label_studio.rollback.sql  (D177 S6)
--
-- Undo 0342_label_studio.sql. Refuses while any print history exists: the history is an
-- operations record and is never thrown away by a rollback. Saved designs are dropped with
-- their table (re-create them in the Label Studio if 0342 is applied again).
-- After this, the Label Studio still prints; saving designs / history shows the 0342 hint.

do $guard$
begin
  if to_regclass('public.label_print_log') is not null
     and exists (select 1 from public.label_print_log) then
    raise exception 'ROLLBACK_REFUSED: label_print_log has rows (print history is kept). Nothing was changed.';
  end if;
end
$guard$;

drop function if exists public.label_template_set_default(uuid, text);
drop table if exists public.label_print_log;
drop table if exists public.label_templates;

notify pgrst, 'reload schema';
