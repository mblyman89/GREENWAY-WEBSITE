-- Rollback for 0282_ccrs_mail_messages.sql  (CCRS Bible v2 slice S-18a)
--
-- Safe for the ledger: 0282 adds one table that nothing in the database
-- reads. Every outcome the owner applied from it was written to ccrs_files /
-- ccrs_file_rows by 0249's ccrs_record_outcome and stays there. What is lost
-- is the stored copy of the CCRS emails themselves; they are still in the
-- Gmail mailbox. The hub's "CCRS email" panel says "apply update 0282" again.
drop trigger if exists ccrs_mail_messages_guard on public.ccrs_mail_messages;
drop function if exists public.ccrs_mail_messages_guard();
drop table if exists public.ccrs_mail_messages;
notify pgrst, 'reload schema';
