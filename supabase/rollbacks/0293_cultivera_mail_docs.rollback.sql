-- Rollback for 0293_cultivera_mail_docs.sql  (R74 S7)
--
-- Safe for stock and money: nothing in the database reads this table, and no
-- lot or manifest points at it. What is lost is the list of harvested vendor
-- documents and what was read from them. The files themselves stay in the
-- pos-raw bucket (mail-harvest/...), and the emails stay in the mailbox. To
-- harvest again after re-applying 0293, also clear the site setting
-- cultivera_mail_harvest_cursor.
drop trigger if exists cultivera_mail_docs_guard on public.cultivera_mail_docs;
drop function if exists public.cultivera_mail_docs_guard();
drop table if exists public.cultivera_mail_docs;
notify pgrst, 'reload schema';
