-- ===========================================================================
-- 0107_discovery_competitor_suppliers.sql
--
-- Task H (S7): per-competitor WHOLESALE SOURCING from the monthly CCRS
-- transformer. Wholesale SaleHeaders in the monthly extract carry BOTH sides
-- of the transfer (seller LicenseeId -> buyer SoldToLicenseeId), so the
-- aggregator can attribute each tracked competitor's wholesale purchases to
-- the suppliers they bought from. This migration adds the three columns the
-- transformer persists per competitor per dataset (month):
--
--   * wholesale_line_count  - wholesale purchase lines observed this month
--   * wholesale_spend_minor - what the competitor spent, in MINOR UNITS
--   * top_suppliers         - top suppliers by spend (<= 10), jsonb:
--       [{licenseeId, licenseNumber, name, dba, lineCount, spendMinor}]
--
-- Existing rows (S3-S6 uploads) default to zero/empty — an honest "no
-- sourcing data captured for this dataset", never a fabricated value.
-- Re-uploading a monthly zip after this migration back-fills them.
--
-- Idempotent (safe to re-run). No RLS change needed: policies on
-- discovery_competitor_stats are row-level (0106) and cover new columns.
--
-- APPLY MANUALLY (owner applies migrations by hand, per standing rules).
-- ===========================================================================

alter table public.discovery_competitor_stats
  add column if not exists wholesale_line_count  integer not null default 0,
  add column if not exists wholesale_spend_minor bigint  not null default 0,
  add column if not exists top_suppliers         jsonb   not null default '[]'::jsonb;
