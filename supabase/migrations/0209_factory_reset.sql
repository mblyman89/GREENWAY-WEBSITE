-- =============================================================================
-- 0209 — THE FACTORY RESET (books-80)
-- =============================================================================
-- The owner asked, in his own words:
--
--   "Can I test everything and every feature and then completely wipe away all
--    testing to give me a clean slate to start business on November 1st? I
--    don't want to have a bunch of stuff stuck on the books from all of my
--    testing. Is there a factory reset option we can use before we go live so I
--    can have a clean completely empty database to work with?"
--
-- A reset already existed: reset_operational_data(), migration 0069, guarded in
-- 0097, extended in 0140. The honest answer to his question was still NO, and
-- here is why, measured rather than assumed:
--
--   • Migrations on disk run 0001..0208; the reset was last extended at 0140.
--     Sixty-eight migrations stale.
--   • Those migrations create 250 tables. The old reset deleted from 66.
--   • The 184 it never touched included the ENTIRE GENERAL LEDGER, because the
--     ledger was born at 0172 — thirty-two migrations AFTER the reset was last
--     taught anything: gl_journals, gl_journal_lines, gl_periods,
--     gl_audit_events, gl_opening_balances, gl_bank_matches,
--     gl_bank_reconciliations. Also payroll_ytd_accumulators and
--     sick_leave_ledger, either of which would corrupt a real W-2 if it
--     survived.
--
-- So pressing "Reset operational data" the morning he asked would have deleted
-- his test sales and left every test JOURNAL ENTRY on the books. His trial
-- balance would have opened November 1st showing rehearsal numbers. Recorded
-- as D-62.
--
-- ── WHY A HAND-TYPED LIST IS THE BUG, NOT THE FIX ────────────────────────────
-- 0140's own header explains that it exists because "0069 was written before
-- many newer operational tables existed." It fixed that by typing more names.
-- Then 68 more migrations landed and it rotted identically. This file is still,
-- necessarily, a list of DELETE statements — SQL offers nothing else — but it is
-- no longer the DECISION. The decision lives in
-- src/lib/accounting/factory-reset-core.ts, where every one of the 250 tables is
-- classified WIPE or KEEP, and an unclassified table REFUSES rather than
-- defaulting. A test reads the real migrations off disk and fails the build
-- when: (a) a table exists that nobody classified, or (b) this file does not
-- delete something the core says to delete. The staleness that caused D-62 is
-- now a red test instead of a wrong number on a tax return.
--
-- ── THE RETENTION PERIOD: FIVE YEARS, NOT THREE ──────────────────────────────
-- Migrations 0097 and 0140 both tell the operator that WAC 314-55-087 requires
-- THREE years. That is the pre-2024 text. WAC 314-55-087(1), as amended by
-- WSR 24-19-040 (filed 9/11/2024, effective 10/12/2024), requires records to be
-- kept "on the licensed premises for a five-year period." The repo's own
-- verified scrape says so at docs/COMPLIANCE_BIBLE.md §3.6 and
-- docs/INVENTORY_COMPLIANCE_WA.md §2, and the Bible adds: "anything in this
-- repo still saying three years is stale." The old guard is stale. Recorded as
-- D-63; this file states five and cites the amendment.
--
-- ── WHY IMMUTABILITY IS NOT WEAKENED ─────────────────────────────────────────
-- Posted journals cannot be deleted:
--   0172_gl_foundation.sql:529  GL_IMMUTABLE — a posted journal cannot be deleted
--   0172_gl_foundation.sql:569  GL_IMMUTABLE — its lines cannot be removed
--   0172_gl_foundation.sql:585  GL_IMMUTABLE — gl_audit_events is append-only
-- Those guards are right and they stay. A factory reset is not an exception to
-- immutability during trading; it is the act of declaring that the trading never
-- happened because it was a rehearsal. So the guards gain ONE narrow escape
-- hatch, keyed on a TRANSACTION-LOCAL setting that only this function sets:
--
--   set_config('greenway.factory_reset', 'on', true)   -- true = local to tx
--
-- Transaction-local matters. If this function raises halfway through, the
-- setting dies with the rolled-back transaction and the books are protected
-- again with no cleanup step. `alter table ... disable trigger` would have left
-- the ledger globally unguarded if anything went wrong, so it is deliberately
-- not used, and a test asserts this file does not use it.
--
-- ── NO NEW ENV VARS ──────────────────────────────────────────────────────────
--   "vercel hides keys by default, and I have like 56 keys, and I don't want to
--    go track them all down right now."
-- Everything here runs inside the EXISTING Supabase project against the existing
-- keys. No new environment variable, no new project, no re-keying. That is why
-- integration_credentials is on the KEEP list: wiping it would send him hunting
-- through those 56 hidden variables, which is the job he asked to avoid.
--
-- SECURITY DEFINER + is_owner(): the books are owner-only (migration 0185), and
-- this is the most destructive door in the application.
--
-- Idempotent: create-or-replace only. APPLY MANUALLY in the Supabase SQL editor
-- (standing rule 6).
-- =============================================================================

-- ═════════════════════════════════════════════════════════════════════════════
-- §1  THE ESCAPE HATCH IN THE IMMUTABILITY GUARDS
--
-- Re-created here rather than edited in place at 0172, so that reading 0172
-- alone never leaves someone believing posted journals are absolutely
-- undeletable when they are not. The exception is stated where it is granted.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.gl_factory_reset_active()
returns boolean language sql stable as $$
  select coalesce(current_setting('greenway.factory_reset', true), 'off') = 'on';
$$;

comment on function public.gl_factory_reset_active() is
  '0209: TRUE only inside a transaction that gl_factory_reset() has marked. Transaction-local by construction: a rollback un-sets it with no cleanup. The single documented exception to GL_IMMUTABLE.';

create or replace function public.gl_guard_posted_journal()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    -- 0209: the factory reset may discard rehearsal books. Nothing else may.
    if public.gl_factory_reset_active() then
      return old;
    end if;
    if old.status in ('posted','reversed') then
      raise exception 'GL_IMMUTABLE: journal % is posted and cannot be deleted. Reverse it instead (ASC 250).', old.id
        using errcode = 'raise_exception';
    end if;
    return old;
  end if;

  if old.status in ('posted','reversed') then
    -- Permit ONLY the reversal-linkage bookkeeping and the posted->reversed flip.
    if (new.entity_id      is distinct from old.entity_id)
    or (new.journal_date   is distinct from old.journal_date)
    or (new.journal_no     is distinct from old.journal_no)
    or (new.source_kind    is distinct from old.source_kind)
    or (new.memo           is distinct from old.memo)
    or (new.posted_at      is distinct from old.posted_at)
    or (new.posted_by      is distinct from old.posted_by)
    or (new.status not in ('posted','reversed'))
    then
      raise exception 'GL_IMMUTABLE: journal % is posted; posted entries cannot be edited. Reverse and repost (ASC 250).', old.id
        using errcode = 'raise_exception';
    end if;
  end if;

  return new;
end $$;

create or replace function public.gl_guard_posted_lines()
returns trigger language plpgsql as $$
declare
  jstatus text;
  jid uuid;
begin
  -- 0209: during a factory reset the lines go with their journals.
  if tg_op = 'DELETE' and public.gl_factory_reset_active() then
    return old;
  end if;

  jid := case when tg_op = 'DELETE' then old.journal_id else new.journal_id end;
  select status into jstatus from public.gl_journals where id = jid;

  if jstatus in ('posted','reversed') then
    raise exception 'GL_IMMUTABLE: journal % is posted; its lines cannot be added, changed or removed. Reverse and repost (ASC 250).', jid
      using errcode = 'raise_exception';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;

create or replace function public.gl_guard_audit_append_only()
returns trigger language plpgsql as $$
begin
  -- 0209: the append-only trail of a rehearsal is itself rehearsal data. Note
  -- this permits DELETE only; UPDATE is still refused unconditionally, because
  -- there is no legitimate reason to REWRITE an audit event, ever.
  if tg_op = 'DELETE' and public.gl_factory_reset_active() then
    return old;
  end if;
  raise exception 'GL_IMMUTABLE: gl_audit_events is append-only.'
    using errcode = 'raise_exception';
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- §2  WHAT COUNTS AS REAL TRADE
--
-- The old guard asked two questions: completed orders, CCRS batches. It could
-- not have asked about journals or filed excise returns because neither existed
-- at 0097. All four are asked here.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.gl_factory_reset_preview()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orders   integer := 0;
  v_ccrs     integer := 0;
  v_excise   integer := 0;
  v_journals integer := 0;
begin
  if not public.is_owner() then
    raise exception 'RESET_NOT_OWNER: only the owner may inspect or run the factory reset.'
      using errcode = 'raise_exception';
  end if;

  select count(*) into v_orders from public.orders where status = 'completed';
  select (select count(*) from public.ccrs_export_batches)
       + (select count(*) from public.ccrs_adjustment_batches)
    into v_ccrs;
  select count(*) into v_excise from public.excise_return_batches;
  select count(*) into v_journals from public.gl_journals where status in ('posted','reversed');

  return jsonb_build_object(
    'completed_orders',      v_orders,
    'ccrs_batches',          v_ccrs,
    'excise_returns_filed',  v_excise,
    'posted_journals',       v_journals,
    'looks_like_real_trade', (v_orders > 0 or v_ccrs > 0 or v_excise > 0 or v_journals > 0),
    'retention_cite',        'WAC 314-55-087(1)',
    'retention_years',       5
  );
end $$;

comment on function public.gl_factory_reset_preview() is
  '0209: owner-only. Reports the four kinds of evidence that real trade has occurred (completed sales, CCRS files, filed excise returns, posted journals) so the reset screen can warn BEFORE anything is destroyed. Read-only.';

revoke all on function public.gl_factory_reset_preview() from public;
grant execute on function public.gl_factory_reset_preview() to authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- §3  THE RESET
--
-- Delete order is child -> parent. The blocking FK edges among WIPE tables were
-- MEASURED from the migrations, not guessed. Five edges are ON DELETE RESTRICT
-- and therefore dictate order:
--     gl_bank_matches          -> gl_journals
--     gl_opening_balances      -> gl_journals
--     sick_leave_ledger        -> pay_periods
--     sick_leave_ledger        -> sick_leave_requests
--     vendor_manifest_payments -> inbound_manifests
-- Everything else either cascades or sets null, but children are still deleted
-- explicitly so the per-table counts the owner sees are honest rather than
-- silently absorbed by a cascade.
--
-- Every `delete` carries `where true`: Postgres/Supabase can run with a
-- safeguard that rejects an unqualified DELETE, and `where true` matches all
-- rows while satisfying it.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.gl_factory_reset(
  confirm_phrase               text,
  acknowledge_wac_314_55_087   boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  counts   jsonb := '{}'::jsonb;
  n        integer;
  v_orders   integer := 0;
  v_ccrs     integer := 0;
  v_excise   integer := 0;
  v_journals integer := 0;
  v_trade    boolean;
  v_actor    uuid := auth.uid();
begin
  -- ── Who ────────────────────────────────────────────────────────────────────
  if not public.is_owner() then
    raise exception 'RESET_NOT_OWNER: only the owner may run the factory reset.'
      using errcode = 'raise_exception';
  end if;

  -- ── Deliberate intent ──────────────────────────────────────────────────────
  -- A boolean argument can be passed by accident, by a stale client, or by a
  -- half-written script. A typed phrase cannot. This is the most destructive
  -- operation in the application and it asks for the sentence in full.
  if coalesce(btrim(confirm_phrase), '') <> 'ERASE ALL TEST DATA' then
    raise exception 'RESET_BAD_CONFIRMATION: type exactly ERASE ALL TEST DATA to confirm. Nothing has been deleted.'
      using errcode = 'raise_exception';
  end if;

  -- ── Is this still a rehearsal? ─────────────────────────────────────────────
  select count(*) into v_orders from public.orders where status = 'completed';
  select (select count(*) from public.ccrs_export_batches)
       + (select count(*) from public.ccrs_adjustment_batches)
    into v_ccrs;
  select count(*) into v_excise from public.excise_return_batches;
  select count(*) into v_journals from public.gl_journals where status in ('posted','reversed');
  v_trade := (v_orders > 0 or v_ccrs > 0 or v_excise > 0 or v_journals > 0);

  if v_trade and not acknowledge_wac_314_55_087 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'RETENTION GUARD (WAC 314-55-087(1)): refusing to wipe — %s completed sale(s), %s CCRS file(s), '
        '%s filed excise return(s) and %s posted journal entr(ies) exist. Records must be kept on the '
        'licensed premises for a FIVE-year period (WSR 24-19-040, effective 10/12/2024) and produced for '
        'the LCB on request. Export everything first, then re-run with acknowledge_wac_314_55_087 := true.',
        v_orders, v_ccrs, v_excise, v_journals
      );
  end if;

  -- ── Open the one door in the immutability guards, for this transaction only ─
  perform set_config('greenway.factory_reset', 'on', true);

  -- ══ 1. Sales, the register and the safe ═══════════════════════════════════
  delete from public.customer_returns where true;          get diagnostics n = row_count; counts := counts || jsonb_build_object('customer_returns', n);
  delete from public.receipt_print_jobs where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('receipt_print_jobs', n);
  delete from public.pos_sale_events where true;           get diagnostics n = row_count; counts := counts || jsonb_build_object('pos_sale_events', n);
  delete from public.special_discount_uses where true;     get diagnostics n = row_count; counts := counts || jsonb_build_object('special_discount_uses', n);
  delete from public.order_events where true;              get diagnostics n = row_count; counts := counts || jsonb_build_object('order_events', n);
  delete from public.order_lines where true;               get diagnostics n = row_count; counts := counts || jsonb_build_object('order_lines', n);
  delete from public.medical_exempt_sales where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('medical_exempt_sales', n);
  delete from public.sales_limit_events where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('sales_limit_events', n);
  -- leafly_register_interrupts (migration 0229, slice L-14) — the blocking
  -- cancellation alerts shown at a register, and the record of who answered
  -- each one. Deleted HERE, immediately above public.orders, for two reasons
  -- rather than by habit:
  --
  --   1. It is a CHILD of public.orders via local_order_id ... on delete
  --      cascade. Deleting orders first would take these rows with it silently
  --      and report a count of 0, so the reset would under-report what it
  --      destroyed. Child-before-parent, as everywhere else in this function.
  --   2. The explicit delete is NOT redundant with the cascade: local_order_id
  --      is nullable (an interrupt about an order we hold no row for is the
  --      anomaly worth keeping), and such a row would not cascade at all. It
  --      would survive into go-live as exactly the unclearable modal this
  --      table exists to prevent.
  --
  -- And it is emptied AT ALL for a behavioural reason, not a cosmetic one: an
  -- open interrupt (resolved_at is null) BLOCKS the till holding its order,
  -- and the partial unique index would then refuse to raise a real interrupt
  -- for that same order id — so a leftover practice row would both brick a
  -- register and suppress a genuine Leafly cancellation.
  delete from public.leafly_register_interrupts where true; get diagnostics n = row_count; counts := counts || jsonb_build_object('leafly_register_interrupts', n);
  delete from public.orders where true;                    get diagnostics n = row_count; counts := counts || jsonb_build_object('orders', n);

  delete from public.till_verifications where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('till_verifications', n);
  delete from public.drawer_drops where true;              get diagnostics n = row_count; counts := counts || jsonb_build_object('drawer_drops', n);
  delete from public.drawer_counts where true;             get diagnostics n = row_count; counts := counts || jsonb_build_object('drawer_counts', n);
  delete from public.safe_swaps where true;                get diagnostics n = row_count; counts := counts || jsonb_build_object('safe_swaps', n);
  delete from public.safe_counts where true;               get diagnostics n = row_count; counts := counts || jsonb_build_object('safe_counts', n);
  -- books-98: bags before sessions. deposit_bag_sessions references BOTH
  -- deposit_bags and drawer_sessions, so it has to go first or the delete
  -- trips a foreign key on a table the reset is about to empty anyway.
  delete from public.deposit_bag_sessions where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('deposit_bag_sessions', n);
  delete from public.deposit_bags where true;              get diagnostics n = row_count; counts := counts || jsonb_build_object('deposit_bags', n);
  delete from public.drawer_sessions where true;           get diagnostics n = row_count; counts := counts || jsonb_build_object('drawer_sessions', n);

  -- SLICE 27: the order announcer. Only the two EVENT tables are emptied.
  -- announcer_devices, announcer_settings and announcer_sounds are KEEP in
  -- src/lib/accounting/factory-reset-core.ts for the same reason pos_devices
  -- and receipt_printer_settings are: a Raspberry Pi bolted to the wall in the
  -- storage room is hardware you own, not a rehearsal event. Wiping it would
  -- silently unpair every speaker in the building and present on go-live
  -- morning as "the announcer just stopped working".
  --
  -- Queue before pairings is not arbitrary: both carry a foreign key to
  -- announcer_devices, and announcer_pairings.device_id is ON DELETE SET NULL,
  -- so neither blocks the other -- but keeping child-before-parent order here
  -- means this block stays correct if those constraints are ever tightened.
  delete from public.announcer_queue where true;           get diagnostics n = row_count; counts := counts || jsonb_build_object('announcer_queue', n);
  delete from public.announcer_pairings where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('announcer_pairings', n);

  -- ══ 2. Tax and compliance filings ════════════════════════════════════════
  delete from public.excise_return_drafts where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('excise_return_drafts', n);
  delete from public.excise_return_batches where true;     get diagnostics n = row_count; counts := counts || jsonb_build_object('excise_return_batches', n);
  delete from public.ccrs_adjustment_batches where true;   get diagnostics n = row_count; counts := counts || jsonb_build_object('ccrs_adjustment_batches', n);
  delete from public.ccrs_export_batches where true;       get diagnostics n = row_count; counts := counts || jsonb_build_object('ccrs_export_batches', n);
  delete from public.ccrs_week_submissions where true;     get diagnostics n = row_count; counts := counts || jsonb_build_object('ccrs_week_submissions', n);
  delete from public.compliance_reminder_log where true;   get diagnostics n = row_count; counts := counts || jsonb_build_object('compliance_reminder_log', n);
  delete from public.syndication_logs where true;          get diagnostics n = row_count; counts := counts || jsonb_build_object('syndication_logs', n);
  delete from public.syndication_sync_state where true;    get diagnostics n = row_count; counts := counts || jsonb_build_object('syndication_sync_state', n);
  -- Leafly Order API (migration 0225, slice L-5). Added here rather than in a
  -- new migration because this function is `create or replace` and the repo's
  -- factory-reset test reads THIS file to prove the SQL and the core cannot
  -- drift; a second copy of the function elsewhere is what produced D-62.
  --
  -- There is deliberately NO foreign key between these two tables:
  -- leafly_webhook_events.order_id is plain text, because the activation and
  -- deactivation webhooks legitimately carry no orderId and a FK would reject a
  -- correctly signed Leafly delivery. So the delete order is not forced by a
  -- constraint. The log is still emptied first, to match the child-before-parent
  -- convention used throughout this function and to stay correct if a FK is
  -- ever added.
  --
  -- leafly_webhook_events also carries the unique body_sha256 idempotency
  -- index. Rehearsal rows left behind would keep answering "already seen" for
  -- their fingerprints, so a real webhook repeating a test body would be
  -- silently dropped -- the one case where failing to wipe a log changes
  -- future behaviour instead of merely leaving clutter.
  -- leafly_outbound_attempts (migration 0226, slice L-6) is the OUTBOUND half:
  -- every acknowledge/status call we made to Leafly, plus every one the pure
  -- core refused to make. Emptied first because it is the most order-dependent
  -- of the three, and emptied AT ALL for a reason specific to it: a rehearsal
  -- row saying "acknowledged" against a Leafly order id is exactly the kind of
  -- evidence a later certification review would read as real activity. Leafly
  -- grades "by review of logged activity", so leaving practice rows in the
  -- outbound log does not merely clutter -- it misrepresents.
  -- leafly_sync_runs (migration 0227, slice L-7) is the SCHEDULER's log: every
  -- automatic tick and every manual button press, including the ticks that
  -- correctly decided to do nothing. Emptied first among the Leafly tables
  -- because it is pure operational telemetry with no foreign keys into the
  -- others, and emptied AT ALL for a reason of its own: the consecutive-failure
  -- count that drives the backoff is derived from this log, so rehearsal
  -- failures left behind would have the scheduler start go-live day already
  -- backed off, syncing every few hours instead of on schedule, for failures
  -- that happened during practice. That is the rare case where NOT wiping a log
  -- changes future behaviour rather than merely leaving clutter.
  delete from public.leafly_sync_runs where true;          get diagnostics n = row_count; counts := counts || jsonb_build_object('leafly_sync_runs', n);
  delete from public.leafly_outbound_attempts where true;  get diagnostics n = row_count; counts := counts || jsonb_build_object('leafly_outbound_attempts', n);
  delete from public.leafly_webhook_events where true;     get diagnostics n = row_count; counts := counts || jsonb_build_object('leafly_webhook_events', n);
  delete from public.leafly_orders where true;             get diagnostics n = row_count; counts := counts || jsonb_build_object('leafly_orders', n);

  -- ══ 3. Payroll, time and the year-to-date figures ════════════════════════
  -- payroll_ytd_accumulators and sick_leave_ledger are the two the old reset
  -- missed that would have corrupted a real W-2. sick_leave_ledger references
  -- BOTH pay_periods and sick_leave_requests ON DELETE RESTRICT, so it goes
  -- before either.
  delete from public.payroll_run_lines where true;         get diagnostics n = row_count; counts := counts || jsonb_build_object('payroll_run_lines', n);
  delete from public.payroll_runs where true;              get diagnostics n = row_count; counts := counts || jsonb_build_object('payroll_runs', n);
  delete from public.payroll_source_documents where true;  get diagnostics n = row_count; counts := counts || jsonb_build_object('payroll_source_documents', n);
  delete from public.payroll_ytd_accumulators where true;  get diagnostics n = row_count; counts := counts || jsonb_build_object('payroll_ytd_accumulators', n);
  delete from public.filed_form_941_totals where true;     get diagnostics n = row_count; counts := counts || jsonb_build_object('filed_form_941_totals', n);
  delete from public.sick_leave_ledger where true;         get diagnostics n = row_count; counts := counts || jsonb_build_object('sick_leave_ledger', n);
  delete from public.sick_leave_requests where true;       get diagnostics n = row_count; counts := counts || jsonb_build_object('sick_leave_requests', n);
  delete from public.wage_orders where true;               get diagnostics n = row_count; counts := counts || jsonb_build_object('wage_orders', n);
  delete from public.time_punches where true;              get diagnostics n = row_count; counts := counts || jsonb_build_object('time_punches', n);
  delete from public.shifts where true;                    get diagnostics n = row_count; counts := counts || jsonb_build_object('shifts', n);
  delete from public.pay_periods where true;               get diagnostics n = row_count; counts := counts || jsonb_build_object('pay_periods', n);
  delete from public.employee_ssn_reveals where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('employee_ssn_reveals', n);

  -- ══ 4. Purchasing and vendor bills ═══════════════════════════════════════
  delete from public.purchase_order_lines where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('purchase_order_lines', n);
  delete from public.purchase_orders where true;           get diagnostics n = row_count; counts := counts || jsonb_build_object('purchase_orders', n);

  -- ══ 5. Product imports and menus ═════════════════════════════════════════
  delete from public.ai_suggestions where true;               get diagnostics n = row_count; counts := counts || jsonb_build_object('ai_suggestions', n);
  delete from public.product_master_suggestions where true;   get diagnostics n = row_count; counts := counts || jsonb_build_object('product_master_suggestions', n);
  delete from public.catalog_product_drafts where true;       get diagnostics n = row_count; counts := counts || jsonb_build_object('catalog_product_drafts', n);
  delete from public.menu_variants where true;                get diagnostics n = row_count; counts := counts || jsonb_build_object('menu_variants', n);
  delete from public.menu_items where true;                   get diagnostics n = row_count; counts := counts || jsonb_build_object('menu_items', n);
  delete from public.menu_versions where true;                get diagnostics n = row_count; counts := counts || jsonb_build_object('menu_versions', n);
  delete from public.pos_import_diagnostics where true;       get diagnostics n = row_count; counts := counts || jsonb_build_object('pos_import_diagnostics', n);
  delete from public.pos_fact_reviews where true;             get diagnostics n = row_count; counts := counts || jsonb_build_object('pos_fact_reviews', n);
  delete from public.pos_imports where true;                  get diagnostics n = row_count; counts := counts || jsonb_build_object('pos_imports', n);

  delete from public.cultivera_menu_items where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('cultivera_menu_items', n);
  delete from public.cultivera_menu_snapshots where true;  get diagnostics n = row_count; counts := counts || jsonb_build_object('cultivera_menu_snapshots', n);
  delete from public.growflow_menu_items where true;       get diagnostics n = row_count; counts := counts || jsonb_build_object('growflow_menu_items', n);
  delete from public.growflow_menu_snapshots where true;   get diagnostics n = row_count; counts := counts || jsonb_build_object('growflow_menu_snapshots', n);
  delete from public.leaflink_menu_items where true;       get diagnostics n = row_count; counts := counts || jsonb_build_object('leaflink_menu_items', n);
  delete from public.leaflink_menu_snapshots where true;   get diagnostics n = row_count; counts := counts || jsonb_build_object('leaflink_menu_snapshots', n);
  delete from public.emailed_menu_items where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('emailed_menu_items', n);
  delete from public.emailed_menu_snapshots where true;    get diagnostics n = row_count; counts := counts || jsonb_build_object('emailed_menu_snapshots', n);

  -- ══ 6. Inventory, deliveries and the practice audits ═════════════════════
  delete from public.inventory_audit_postings where true;  get diagnostics n = row_count; counts := counts || jsonb_build_object('inventory_audit_postings', n);
  delete from public.inventory_audit_lines where true;     get diagnostics n = row_count; counts := counts || jsonb_build_object('inventory_audit_lines', n);
  delete from public.inventory_audit_history where true;   get diagnostics n = row_count; counts := counts || jsonb_build_object('inventory_audit_history', n);
  delete from public.inventory_audit_sessions where true;  get diagnostics n = row_count; counts := counts || jsonb_build_object('inventory_audit_sessions', n);

  delete from public.cycle_count_lines where true;         get diagnostics n = row_count; counts := counts || jsonb_build_object('cycle_count_lines', n);
  delete from public.cycle_counts where true;              get diagnostics n = row_count; counts := counts || jsonb_build_object('cycle_counts', n);
  delete from public.destruction_events where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('destruction_events', n);
  delete from public.vendor_returns where true;            get diagnostics n = row_count; counts := counts || jsonb_build_object('vendor_returns', n);
  delete from public.trade_sample_events where true;       get diagnostics n = row_count; counts := counts || jsonb_build_object('trade_sample_events', n);
  delete from public.sample_json_imports where true;       get diagnostics n = row_count; counts := counts || jsonb_build_object('sample_json_imports', n);
  delete from public.inventory_adjustments where true;     get diagnostics n = row_count; counts := counts || jsonb_build_object('inventory_adjustments', n);
  delete from public.lab_results where true;               get diagnostics n = row_count; counts := counts || jsonb_build_object('lab_results', n);
  delete from public.inventory_lots where true;            get diagnostics n = row_count; counts := counts || jsonb_build_object('inventory_lots', n);

  -- vendor_manifest_payments references inbound_manifests ON DELETE RESTRICT
  -- (and noncannabis_invoices ON DELETE RESTRICT per 0112), so it precedes both.
  delete from public.vendor_manifest_payments where true;  get diagnostics n = row_count; counts := counts || jsonb_build_object('vendor_manifest_payments', n);
  delete from public.manifest_documents where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('manifest_documents', n);
  delete from public.manifest_events where true;           get diagnostics n = row_count; counts := counts || jsonb_build_object('manifest_events', n);
  delete from public.inbound_manifests where true;         get diagnostics n = row_count; counts := counts || jsonb_build_object('inbound_manifests', n);

  delete from public.noncannabis_invoice_lines where true; get diagnostics n = row_count; counts := counts || jsonb_build_object('noncannabis_invoice_lines', n);
  delete from public.noncannabis_invoices where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('noncannabis_invoices', n);
  delete from public.noncannabis_adjustments where true;   get diagnostics n = row_count; counts := counts || jsonb_build_object('noncannabis_adjustments', n);

  -- ══ 7. Customers and loyalty ═════════════════════════════════════════════
  delete from public.loyalty_redemptions where true;       get diagnostics n = row_count; counts := counts || jsonb_build_object('loyalty_redemptions', n);
  delete from public.loyalty_ledger where true;            get diagnostics n = row_count; counts := counts || jsonb_build_object('loyalty_ledger', n);
  delete from public.loyalty_accounts where true;          get diagnostics n = row_count; counts := counts || jsonb_build_object('loyalty_accounts', n);
  delete from public.loyalty_signups where true;           get diagnostics n = row_count; counts := counts || jsonb_build_object('loyalty_signups', n);
  delete from public.patient_authorizations where true;    get diagnostics n = row_count; counts := counts || jsonb_build_object('patient_authorizations', n);
  delete from public.customers where true;                 get diagnostics n = row_count; counts := counts || jsonb_build_object('customers', n);

  -- ══ 8. Banking, ATM, crypto and loans ════════════════════════════════════
  -- The ACTIVITY clears; the CONNECTIONS stay (D-65). Kept on purpose in this
  -- section: plaid_items, plaid_accounts, atm_connection and manual_loans, plus
  -- the crypto wallets/assets/rules carved out earlier. Their sync cursors are
  -- rewound at the end of the section so kept logins cannot hide lost history.
  delete from public.plaid_webhook_events where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('plaid_webhook_events', n);
  delete from public.plaid_holdings where true;            get diagnostics n = row_count; counts := counts || jsonb_build_object('plaid_holdings', n);
  delete from public.plaid_mortgages where true;           get diagnostics n = row_count; counts := counts || jsonb_build_object('plaid_mortgages', n);
  delete from public.plaid_transactions where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('plaid_transactions', n);
  -- plaid_accounts and plaid_items are KEPT (D-65). They are the LINK, not the
  -- activity: the encrypted access token, the institution, and the owner's own
  -- main/atm/credit role assignment. Deleting them would force a fresh Plaid
  -- Link with bank credentials and MFA per institution after every rehearsal.

  delete from public.atm_reconciliation where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('atm_reconciliation', n);
  delete from public.atm_settlements where true;           get diagnostics n = row_count; counts := counts || jsonb_build_object('atm_settlements', n);
  delete from public.atm_cash_loads where true;            get diagnostics n = row_count; counts := counts || jsonb_build_object('atm_cash_loads', n);
  delete from public.atm_transactions where true;          get diagnostics n = row_count; counts := counts || jsonb_build_object('atm_transactions', n);
  delete from public.atm_terminal_status where true;       get diagnostics n = row_count; counts := counts || jsonb_build_object('atm_terminal_status', n);
  -- atm_connection is KEPT (D-65): the encrypted PAI login, terminal HG26499
  -- and the discovered report endpoints. Re-discovering those is a manual job.

  delete from public.crypto_tx_classifications where true; get diagnostics n = row_count; counts := counts || jsonb_build_object('crypto_tx_classifications', n);
  delete from public.crypto_transfer_matches where true;   get diagnostics n = row_count; counts := counts || jsonb_build_object('crypto_transfer_matches', n);
  delete from public.crypto_transactions where true;       get diagnostics n = row_count; counts := counts || jsonb_build_object('crypto_transactions', n);
  delete from public.crypto_balances where true;           get diagnostics n = row_count; counts := counts || jsonb_build_object('crypto_balances', n);
  delete from public.crypto_price_snapshots where true;    get diagnostics n = row_count; counts := counts || jsonb_build_object('crypto_price_snapshots', n);
  delete from public.crypto_sync_state where true;         get diagnostics n = row_count; counts := counts || jsonb_build_object('crypto_sync_state', n);

  delete from public.manual_loan_payments where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('manual_loan_payments', n);
  -- manual_loans is KEPT (D-65): terms typed off the owner's paperwork
  -- (principal, rate in milli-percent, term, dates). Nothing re-derives them.

  -- ── Rewind the readers on the connections we kept ────────────────────────
  -- D-65. Plaid's /transactions/sync only ever returns what changed SINCE the
  -- saved cursor. Keeping plaid_items while emptying plaid_transactions would
  -- therefore leave the bank connected, healthy, and permanently missing its
  -- history: Plaid resumes past the deleted rows and never re-sends them, and
  -- nothing raises an error. Clearing the cursor restores "full backfill" (see
  -- initSyncState in src/lib/plaid/sync-core.ts, where null means from-scratch).
  -- These are UPDATEs, not deletes, so they change no row count above.
  update public.plaid_items
     set transactions_cursor   = null,
         last_successful_sync  = null
   where transactions_cursor is not null
      or last_successful_sync is not null;

  -- The PAI pull is date-ranged rather than cursor-based, so this one is
  -- honesty rather than correctness: do not advertise a successful sync for
  -- data that no longer exists.
  update public.atm_connection
     set last_sync_at = null,
         last_error   = null
   where last_sync_at is not null
      or last_error is not null;

  -- ══ 9. THE BOOKS — what the old reset never touched ══════════════════════
  -- gl_bank_matches and gl_opening_balances reference gl_journals ON DELETE
  -- RESTRICT, so both precede it. gl_journal_lines precedes gl_journals for the
  -- same reason. This is the section that answers the owner's question.
  delete from public.gl_bank_matches where true;             get diagnostics n = row_count; counts := counts || jsonb_build_object('gl_bank_matches', n);
  delete from public.gl_bank_reconciliations where true;     get diagnostics n = row_count; counts := counts || jsonb_build_object('gl_bank_reconciliations', n);
  delete from public.gl_classification_suggestions where true; get diagnostics n = row_count; counts := counts || jsonb_build_object('gl_classification_suggestions', n);
  delete from public.gl_opening_balances where true;         get diagnostics n = row_count; counts := counts || jsonb_build_object('gl_opening_balances', n);
  delete from public.gl_payroll_allocations where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('gl_payroll_allocations', n);
  delete from public.gl_override_log where true;             get diagnostics n = row_count; counts := counts || jsonb_build_object('gl_override_log', n);
  delete from public.gl_template_changes where true;         get diagnostics n = row_count; counts := counts || jsonb_build_object('gl_template_changes', n);
  delete from public.gl_account_proposals where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('gl_account_proposals', n);
  delete from public.gl_journal_lines where true;            get diagnostics n = row_count; counts := counts || jsonb_build_object('gl_journal_lines', n);
  delete from public.gl_journals where true;                 get diagnostics n = row_count; counts := counts || jsonb_build_object('gl_journals', n);
  delete from public.gl_periods where true;                  get diagnostics n = row_count; counts := counts || jsonb_build_object('gl_periods', n);
  delete from public.gl_audit_events where true;             get diagnostics n = row_count; counts := counts || jsonb_build_object('gl_audit_events', n);

  -- ══ 10. Research scrapes, helper chat and meters ═════════════════════════
  delete from public.discovery_ccrs_sales where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('discovery_ccrs_sales', n);
  delete from public.discovery_ccrs_products where true;   get diagnostics n = row_count; counts := counts || jsonb_build_object('discovery_ccrs_products', n);
  delete from public.discovery_ccrs_lab where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('discovery_ccrs_lab', n);
  delete from public.discovery_ccrs_licensees where true;  get diagnostics n = row_count; counts := counts || jsonb_build_object('discovery_ccrs_licensees', n);
  delete from public.discovery_benchmarks where true;      get diagnostics n = row_count; counts := counts || jsonb_build_object('discovery_benchmarks', n);
  delete from public.discovery_market_signals where true;  get diagnostics n = row_count; counts := counts || jsonb_build_object('discovery_market_signals', n);
  delete from public.discovery_competitor_stats where true; get diagnostics n = row_count; counts := counts || jsonb_build_object('discovery_competitor_stats', n);
  delete from public.discovery_supplier_stats where true;  get diagnostics n = row_count; counts := counts || jsonb_build_object('discovery_supplier_stats', n);
  delete from public.discovery_producer_stats where true;  get diagnostics n = row_count; counts := counts || jsonb_build_object('discovery_producer_stats', n);
  delete from public.discovery_product_leads where true;   get diagnostics n = row_count; counts := counts || jsonb_build_object('discovery_product_leads', n);
  delete from public.discovery_vendor_leads where true;    get diagnostics n = row_count; counts := counts || jsonb_build_object('discovery_vendor_leads', n);
  delete from public.discovery_competitors where true;     get diagnostics n = row_count; counts := counts || jsonb_build_object('discovery_competitors', n);
  delete from public.discovery_doh_sellers where true;     get diagnostics n = row_count; counts := counts || jsonb_build_object('discovery_doh_sellers', n);
  delete from public.discovery_datasets where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('discovery_datasets', n);

  delete from public.promotion_audit_snapshots where true; get diagnostics n = row_count; counts := counts || jsonb_build_object('promotion_audit_snapshots', n);
  delete from public.equipment_service_events where true;  get diagnostics n = row_count; counts := counts || jsonb_build_object('equipment_service_events', n);
  delete from public.newsletter_email_events where true;   get diagnostics n = row_count; counts := counts || jsonb_build_object('newsletter_email_events', n);
  delete from public.newsletter_sends where true;          get diagnostics n = row_count; counts := counts || jsonb_build_object('newsletter_sends', n);
  delete from public.inbound_email_log where true;         get diagnostics n = row_count; counts := counts || jsonb_build_object('inbound_email_log', n);
  delete from public.sage_chat_messages where true;        get diagnostics n = row_count; counts := counts || jsonb_build_object('sage_chat_messages', n);
  delete from public.sage_import_uploads where true;       get diagnostics n = row_count; counts := counts || jsonb_build_object('sage_import_uploads', n);
  delete from public.ai_usage where true;                  get diagnostics n = row_count; counts := counts || jsonb_build_object('ai_usage', n);

  -- ── Shut the door explicitly. It would also close on commit or rollback. ───
  perform set_config('greenway.factory_reset', 'off', true);

  -- ── The audit log is KEPT, and this is why: it records the reset itself. ───
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, after_json)
  values (
    v_actor,
    'ops.factory_reset',
    'database',
    'factory_reset',
    jsonb_build_object(
      'reset_at', now(),
      'acknowledged_wac_314_55_087', acknowledge_wac_314_55_087,
      'looked_like_real_trade', v_trade,
      'evidence_at_reset', jsonb_build_object(
        'completed_orders', v_orders,
        'ccrs_batches', v_ccrs,
        'excise_returns_filed', v_excise,
        'posted_journals', v_journals
      ),
      'tables', counts
    )
  );

  return jsonb_build_object(
    'ok', true,
    'reset_at', now(),
    'acknowledged_wac_314_55_087', acknowledge_wac_314_55_087,
    'retention_cite', 'WAC 314-55-087(1)',
    'retention_years', 5,
    'evidence_at_reset', jsonb_build_object(
      'completed_orders', v_orders,
      'ccrs_batches', v_ccrs,
      'excise_returns_filed', v_excise,
      'posted_journals', v_journals
    ),
    'tables', counts,
    'tables_emptied', (select count(*) from jsonb_each_text(counts)),
    'total_rows_deleted', (
      select coalesce(sum((value)::int), 0) from jsonb_each_text(counts)
    )
  );
end $$;

comment on function public.gl_factory_reset(text, boolean) is
  '0209 (books-80): THE factory reset. Owner-only, requires the typed phrase ERASE ALL TEST DATA, and empties every table classified WIPE by src/lib/accounting/factory-reset-core.ts — INCLUDING the general ledger, which reset_operational_data() (0069/0097/0140) never touched because the ledger was born 32 migrations later (D-62). Keeps the chart of accounts, entities, shareholders, settings, integration credentials, the knowledge base, curated catalogue, people, logins and the audit log. Also keeps the CONNECTIONS themselves (D-65) — plaid_items, plaid_accounts, atm_connection, manual_loans and the crypto wallets/assets/rules — so a rehearsal never costs a re-link through Plaid MFA or a re-entry of the PAI password; their activity still clears, and their sync cursors are rewound so the wiped history genuinely re-downloads. Retention guard cites WAC 314-55-087(1) FIVE years per WSR 24-19-040 eff. 10/12/2024 (the old guard said three — D-63). Immutability is not weakened: it gains one transaction-local exception via gl_factory_reset_active().';

revoke all on function public.gl_factory_reset(text, boolean) from public;
grant execute on function public.gl_factory_reset(text, boolean) to authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- §4  THE AUDIT: does the ledger actually come out empty?
--
-- Returns ONLY problems. An empty result means the reset left nothing behind.
-- Written this way on purpose: a function that returns rows on success invites
-- someone to glance at output and assume it passed.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.gl_audit_factory_reset()
returns table (problem text, detail text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'RESET_NOT_OWNER: only the owner may audit the factory reset.'
      using errcode = 'raise_exception';
  end if;

  -- The books must be empty.
  return query
    select 'JOURNALS_REMAIN'::text,
           format('%s journal(s) still on the books', count(*))::text
    from public.gl_journals having count(*) > 0;

  return query
    select 'JOURNAL_LINES_REMAIN'::text,
           format('%s journal line(s) still present', count(*))::text
    from public.gl_journal_lines having count(*) > 0;

  return query
    select 'PERIODS_REMAIN'::text,
           format('%s accounting period(s) still present', count(*))::text
    from public.gl_periods having count(*) > 0;

  -- The year-to-date figures must be empty, or the first real W-2 is wrong.
  return query
    select 'PAYROLL_YTD_REMAINS'::text,
           format('%s year-to-date payroll row(s) survived — a real W-2 would be overstated', count(*))::text
    from public.payroll_ytd_accumulators having count(*) > 0;

  return query
    select 'SICK_LEAVE_REMAINS'::text,
           format('%s sick-leave ledger row(s) survived', count(*))::text
    from public.sick_leave_ledger having count(*) > 0;

  -- Inventory must be empty so the October 31st count starts from nothing.
  return query
    select 'INVENTORY_REMAINS'::text,
           format('%s inventory lot(s) survived', count(*))::text
    from public.inventory_lots having count(*) > 0;

  -- And the structure must have SURVIVED. A reset that emptied the chart of
  -- accounts would leave an app that cannot post, which is also a failure.
  return query
    select 'CHART_OF_ACCOUNTS_LOST'::text,
           'gl_accounts is empty — the reset destroyed the chart of accounts; re-apply migration 0173'::text
    from public.gl_accounts having count(*) = 0;

  return query
    select 'ENTITIES_LOST'::text,
           'gl_entities is empty — re-apply migration 0172'::text
    from public.gl_entities having count(*) = 0;

  return query
    select 'AUDIT_TRAIL_LOST'::text,
           'audit_logs holds no record of the reset — the evidence it happened is gone'::text
    from public.audit_logs
    where action = 'ops.factory_reset'
    having count(*) = 0;

  return;
end $$;

comment on function public.gl_audit_factory_reset() is
  '0209: owner-only. Returns ONLY problems after a factory reset — books/inventory/payroll-YTD that survived when they should not have, and chart-of-accounts/entities/audit-trail that vanished when they should not have. Empty result = the reset did exactly what it promised.';

revoke all on function public.gl_audit_factory_reset() from public;
grant execute on function public.gl_audit_factory_reset() to authenticated, service_role;
