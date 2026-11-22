-- Rollback for 0370_print_designs.sql (D263 S8 Print Studio saved designs).
-- Run MANUALLY only if needed. Drops every saved print design and template
-- (drafts kept in each browser are not affected).
drop table if exists public.print_designs;
