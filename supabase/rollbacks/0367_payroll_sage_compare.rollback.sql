-- Rollback for 0367_payroll_sage_compare.sql (D248 slice 4).
-- Run MANUALLY only if needed. Drops the comparison table and every Sage
-- amount typed into it. Nothing else reads it.
drop table if exists public.payroll_sage_comparisons;
