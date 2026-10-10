-- Rollback for 0256_testing_labs.sql (R36 #4).
-- The COA reader keeps working without this table: its three built-in hosts
-- (incl. files.cultivera.com) live in code. Owner-added labs / hosts are lost.
drop table if exists public.testing_labs;
drop function if exists public.testing_lab_hosts_valid(text[]);
notify pgrst, 'reload schema';
