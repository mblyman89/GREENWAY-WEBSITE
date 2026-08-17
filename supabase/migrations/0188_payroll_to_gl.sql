-- =============================================================================
-- 0188 — PAYROLL REACHES THE GENERAL LEDGER, AND THE EMPLOYEE-AS-COGS QUESTION
-- (slice books-04)
--
-- OWNER CONTEXT, recorded verbatim (standing rule 1):
--
--   "I would like the ability to assign employees as cogs so I can write them
--    off."
--
--   "I want push back... like if I loan my employees some money... I want to be
--    able to make entries manually, but the system pushes back and try's to help
--    me enter it correctly rather than rejecting it out right."
--
--   "I really think it's smart to not just block, but explain why, and even
--    better, show me a way to do it properly."
--
--   "I would like all the help I can get and for it to be accurate and precise
--    stated from actual verbatim text from authoritative sources."
--
-- -----------------------------------------------------------------------------
-- THE ANSWER, AND WHY IT IS NOT A SIMPLE YES
-- -----------------------------------------------------------------------------
-- The request is the most legally dangerous one in this project, and it is
-- dangerous in a way that FEELS safe, because every cannabis operator has heard
-- that "you can put payroll in COGS." For a GROWER that is often true. For
-- Greenway it is mostly false, and the difference is not a matter of opinion.
--
-- Greenway is an I-502 RETAILER: it buys finished, packaged product from
-- licensed producers/processors and resells it. In tax language that makes
-- Greenway a RESELLER, not a PRODUCER. The regulations write two completely
-- different inventory rules for those two words:
--
--   Reg. §1.471-3(b)  RESELLER — invoice price less trade discounts, plus
--                     "transportation or other necessary charges incurred in
--                      acquiring possession of the goods"
--                     THERE IS NO DIRECT-LABOR CLAUSE. None.
--
--   Reg. §1.471-3(c)  PRODUCER — raw materials, PLUS "expenditures for direct
--                     labor", plus indirect production costs "including...
--                     an appropriate portion of management expenses, but not
--                     including any cost of selling."
--
-- The producer paragraph is the one everybody quotes. It is not Greenway's
-- paragraph. And even it refuses selling costs.
--
-- The last escape hatch, §263A, is closed by its own regulation:
--   Reg. §1.263A-1(e)(2)(ii): "Resellers must capitalize the acquisition costs
--   of property acquired for resale."
--
-- Three Tax Court cases decided exactly this against dispensaries that did far
-- MORE hands-on work than Greenway does:
--   • Patients Mutual (Harborside), 151 T.C. 176 (2018) — reseller.
--   • Alternative Health Care Advocates, 151 T.C. 225 (2018) — reseller.
--   • Richmond Patients Group, T.C. Memo 2020-52 — still a reseller even though
--     it "inspected, sent out for testing, trimmed, dried and maintained the
--     stock, and packaged and labeled marijuana."
--
-- SO THE HONEST ANSWER IS:
--   Budtender wages          → §280E takes them. Cannot be COGS. Ever.
--   Manager/security/admin   → §280E takes them. Cannot be COGS.
--   RECEIVING / INTAKE labor → a NARROW, EVIDENCE-GATED door exists, because
--                              §1.471-3(b) protects "necessary charges incurred
--                              in ACQUIRING POSSESSION of the goods."
--
-- That narrow door is the whole value of this slice, and it is why this file
-- exists: it makes the right answer the one that actually gets recorded, and it
-- makes the wrong answer impossible to record by accident.
--
-- -----------------------------------------------------------------------------
-- WHAT THIS MIGRATION DOES
--   §1  gl_payroll_labor_roles — the closed labor taxonomy, as a REFERENCE
--       TABLE mirroring src/lib/accounting/payroll-cogs-core.ts. The TypeScript
--       core remains the brain; this table exists so the database can validate
--       what the app claims, and so a human reading the schema can see the
--       §280E treatment of every role without reading TypeScript.
--   §2  THE EVIDENCE SURFACE. time_punches (0037) records only clock-in and
--       clock-out with punch_kind in ('work','break'). There is NO task
--       attribution anywhere in this database. Without it, the narrow door of
--       §1.471-3(b) is purely theoretical — there is nothing to prove with.
--       §2 adds task attribution, additively and without touching the existing
--       CHECK constraint, so the time clock keeps working exactly as it does.
--   §3  gl_payroll_allocations — the effective-dated, DOCUMENTED time split per
--       employee, refusing to exist without a written basis.
--   §4  Bridge columns on payroll_runs linking a run to the journal it produced.
--   §5  gl_post_payroll_run() — posts a CLASSIFIED payroll run through the
--       EXISTING gl_submit_journal(), never around it.
--   §6  Owner-only RLS.
--   §7  gl_audit_payroll_wiring() — a self-check that returns problems only.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES *NOT* DO
--   * It does NOT re-implement the §280E labor rules in SQL. Two copies of a
--     tax rule drift, and the drifting copy is always the one nobody tests. The
--     rules live in ONE place: payroll-cogs-core.ts, which carries ~150
--     assertions plus 1,300 fuzz iterations across two independent gates.
--   * It does NOT add a gl_posting_templates row for payroll. The 0174 CHECK
--     constraint on gl_posting_templates.source_kind deliberately allows only
--     ('pos_sale','excise','purchase','bank'). Payroll is excluded BY DESIGN:
--     a payroll run must never be auto-postable, because the §280E split
--     requires a human judgement every single period. That exclusion is
--     respected here, not worked around.
--   * It does NOT touch the ACH payroll surface (0057/0094). 0185 §4 leaves
--     payroll alone on purpose so an ADMIN can still pay employees. Paying
--     people and writing the tax consequence into the ledger are two different
--     jobs; only the second one is owner-only.
--   * It does NOT loosen the time_punches punch_kind CHECK. Additive only.
--
-- STANDING RULES HONOURED
--   rule 1  — the owner's words are recorded verbatim
--   rule 2  — every tax position cites its authority, in the comments below
--   rule 6  — applied MANUALLY in the Supabase SQL editor
--   rule 7  — money is integer cents; rates are integer milli-percent
--   rule 12 — assumptions are RECORDED, never applied silently
--   rule 14 — when in doubt, REFUSE
--
-- IDEMPOTENT. Safe to run repeatedly, as repo law requires.
-- REQUIRES 0185 (public.is_owner()) and the 0172–0178 books migrations.
--
-- APPLY MANUALLY in the Supabase SQL editor (standing rule 6).
-- =============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- §0  PRECONDITION — refuse to run out of order rather than half-apply.
-- ═══════════════════════════════════════════════════════════════════════════
do $precheck$
begin
  if to_regprocedure('public.is_owner()') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0188 needs public.is_owner(), which migration 0185 creates. Run 0185_books_owner_only.sql first, then 0186, 0187, then this file.';
  end if;

  if to_regclass('public.gl_journals') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0188 needs the general ledger from 0172. Run the 0172-0178 books migrations first.';
  end if;

  if to_regprocedure('public.gl_submit_journal(text,date,text,text,text,jsonb,text,bigint,boolean,text,text,boolean)') is null
     and to_regproc('public.gl_submit_journal') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0188 posts through gl_submit_journal(), which migration 0174 creates. Run 0174_gl_posting_service.sql first.';
  end if;

  -- The payroll ACH tables from 0057 are what this migration bridges INTO the
  -- ledger. Without them there is nothing to bridge.
  if to_regclass('public.payroll_runs') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0188 bridges payroll_runs (migration 0057) to the ledger. Run 0057_payroll_ach.sql first.';
  end if;

  if to_regclass('public.employees') is null then
    raise exception
      'MIGRATION_OUT_OF_ORDER: 0188 needs the employees roster from migration 0037. Run 0037_staffing_timeclock.sql first.';
  end if;
end;
$precheck$;

-- ═══════════════════════════════════════════════════════════════════════════
-- §1  THE LABOR TAXONOMY
--
-- A CLOSED list. "Closed" is the point: an open-ended list of job titles is
-- exactly how "warehouse associate" quietly becomes a COGS account and nobody
-- can explain why three years later, in an audit, under oath.
--
-- treatment:
--   acquisition — work done ACQUIRING POSSESSION of goods. Reg. §1.471-3(b).
--                 The ONLY reseller labor that may ever touch inventory, and
--                 only with the evidence package in §3.
--   selling     — selling the goods. §280E takes it. Reg. §1.471-3(c) excludes
--                 selling cost even for PRODUCERS, so there is no argument.
--   admin       — running the store. §280E takes it (Patients Mutual).
--   production  — growing/processing. Legal for a PRODUCER, and impossible for
--                 Greenway, whose licence is retail. Present so the branch is
--                 VISIBLE and explainable rather than silently missing.
--   separate    — work for the ATM or landholding business. Not a cannabis
--                 trade, so §280E does not reach it (Alternative Health Care
--                 Advocates turns on the SEPARATE-TRADE question).
--   owner       — owner/officer compensation. Its own conversation.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.gl_payroll_labor_roles (
  code               text primary key
                       check (code = lower(btrim(code)) and length(btrim(code)) >= 3),

  label              text not null check (length(btrim(label)) >= 3),

  treatment          text not null
                       check (treatment in
                         ('acquisition','selling','admin','production','separate','owner')),

  -- The account this role's wages land in.
  account_code       text not null check (account_code ~ '^[1-9][0-9]{4}$'),

  cost_class         text not null
                       check (cost_class in
                         ('cogs_direct','cogs_allocable','nondeductible_280e',
                          'separate_business','personal','none')),

  -- TRUE when this role may NEVER be capitalised into inventory, whatever the
  -- paperwork says. This is the belt to the braces of the CHECK below.
  never_inventoriable boolean not null default false,

  -- Why, in one plain sentence, so the schema teaches too.
  plain_english      text not null check (length(btrim(plain_english)) >= 20),

  -- The authority behind the treatment.
  authority          text not null check (length(btrim(authority)) >= 5),

  sort_order         integer not null default 100,
  is_active          boolean not null default true,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- ─── THE STRUCTURAL GUARANTEE ──────────────────────────────────────────
  -- A role that may never be inventoried must not point at a COGS account.
  -- This is not a nicety: it is the constraint that makes "budtender wages in
  -- COGS" physically unrepresentable, rather than merely discouraged.
  constraint gl_payroll_role_never_cogs_chk
    check (not (never_inventoriable and account_code like '6%')),

  -- Anything landing in a 6xxxx account must carry a COGS cost class, matching
  -- the gl_accounts_cogs_cost_class_chk rule from 0173.
  constraint gl_payroll_role_cogs_class_chk
    check (account_code not like '6%' or cost_class in ('cogs_direct','cogs_allocable')),

  -- A reseller's labor is NEVER a direct product cost. If it gets into
  -- inventory at all it is an ALLOCABLE charge of acquiring possession, and it
  -- must be labelled that way, because the label is what an examiner reads.
  constraint gl_payroll_role_allocable_only_chk
    check (cost_class <> 'cogs_direct')
);

comment on table public.gl_payroll_labor_roles is
  'Closed taxonomy of labor roles and their Section 280E treatment. Mirrors LABOR_ROLES in src/lib/accounting/payroll-cogs-core.ts, which is the authoritative implementation. Greenway is a RESELLER, so Reg. 1.471-3(b) governs and only acquisition labor (acquiring possession of goods) may ever reach inventory - and only with the evidence package in gl_payroll_allocations.';

comment on column public.gl_payroll_labor_roles.never_inventoriable is
  'TRUE means this labor can never be capitalised into inventory regardless of paperwork. Enforced structurally by gl_payroll_role_never_cogs_chk.';

-- Seed / re-seed the taxonomy. Idempotent by primary key.
insert into public.gl_payroll_labor_roles
  (code, label, treatment, account_code, cost_class, never_inventoriable, plain_english, authority, sort_order)
values
  ('receiving',
   'Receiving / intake - meeting deliveries, checking manifests, vaulting product',
   'acquisition', '61000', 'cogs_allocable', false,
   'This is the one kind of store labor that can legally ride into inventory, because it is work done acquiring possession of the goods. It needs proof: task-level time records tied to specific deliveries.',
   'Reg. 1.471-3(b) - transportation or other necessary charges incurred in acquiring possession of the goods',
   10),

  ('delivery_driver',
   'Driver collecting product from a supplier',
   'acquisition', '61000', 'cogs_allocable', false,
   'Driving to collect product is acquiring possession, so this time can ride into inventory with the same proof receiving needs.',
   'Reg. 1.471-3(b) - charges incurred in acquiring possession of the goods',
   20),

  ('budtender',
   'Budtender / sales associate',
   'selling', '71010', 'nondeductible_280e', true,
   'Selling the product is exactly what Section 280E disallows, and even the producer rule refuses selling costs. This can never be cost of goods sold.',
   'IRC 280E; Reg. 1.471-3(c) - but not including any cost of selling; Patients Mutual 151 T.C. 176',
   30),

  ('marketing',
   'Marketing, menus and promotions',
   'selling', '71010', 'nondeductible_280e', true,
   'Marketing is selling. Section 280E takes it, and no allocation study can rescue it.',
   'IRC 280E; Reg. 1.471-3(c) - not including any cost of selling',
   40),

  ('management',
   'Store manager / assistant manager',
   'admin', '71010', 'nondeductible_280e', true,
   'Running the store is an operating expense of trafficking, which is the precise thing Section 280E denies. Harborside argued this and lost.',
   'IRC 280E; Patients Mutual (Harborside) 151 T.C. 176 (2018)',
   50),

  ('security',
   'Security / door staff',
   'admin', '71010', 'nondeductible_280e', true,
   'Security protects the business, not the acquisition of the goods, so Section 280E takes it.',
   'IRC 280E; Patients Mutual 151 T.C. 176',
   60),

  ('compliance',
   'Compliance / traceability administration',
   'admin', '71010', 'nondeductible_280e', true,
   'Compliance work is a cost of being allowed to operate. It is disallowed, even though it is mandatory.',
   'IRC 280E; Patients Mutual 151 T.C. 176',
   70),

  ('inventory_count',
   'Physical inventory counts and CCRS reconciliation',
   'admin', '71010', 'nondeductible_280e', true,
   'Counting what you already own is not acquiring it. This is the most common place operators overreach, so it is blocked on purpose.',
   'Reg. 1.471-3(b) - possession has already been acquired; IRC 280E',
   80),

  ('cultivation_labor',
   'Growing / cultivating plants',
   'production', '61000', 'cogs_allocable', false,
   'Real production labor for a licensed producer. Greenway holds a retail licence, so this is blocked for Greenway - it is here so the rule is visible rather than silently missing.',
   'Reg. 1.471-3(c) - expenditures for direct labor',
   90),

  ('processing_labor',
   'Extracting or manufacturing infused product',
   'production', '61000', 'cogs_allocable', false,
   'Real processing labor for a licensed processor. Blocked for Greenway for the same licence reason.',
   'Reg. 1.471-3(c) - expenditures for direct labor',
   100),

  ('atm_operation',
   'Work on the ATM business',
   'separate', '71010', 'separate_business', true,
   'The ATM business is not a cannabis trade, so Section 280E does not reach it - but the wages have to be recorded against that business, not this one.',
   'Alternative Health Care Advocates 151 T.C. 225 (2018) - separate trade or business',
   110),

  ('landholding',
   'Work on the Geiger rental property',
   'separate', '71010', 'separate_business', true,
   'Rental property work belongs to the landholding company, and its wages are fully deductible there.',
   'Alternative Health Care Advocates 151 T.C. 225 (2018)',
   120),

  ('owner_officer',
   'Owner / officer compensation',
   'owner', '71010', 'nondeductible_280e', true,
   'Owner pay for running a cannabis retailer is disallowed like any other operating cost, and it also has to be reasonable and actually paid.',
   'IRC 280E; IRC 162(a)(1) - reasonable allowance for salaries',
   130)
on conflict (code) do update set
  label               = excluded.label,
  treatment           = excluded.treatment,
  account_code        = excluded.account_code,
  cost_class          = excluded.cost_class,
  never_inventoriable = excluded.never_inventoriable,
  plain_english       = excluded.plain_english,
  authority           = excluded.authority,
  sort_order          = excluded.sort_order,
  updated_at          = now();

-- ═══════════════════════════════════════════════════════════════════════════
-- §2  THE EVIDENCE SURFACE — task attribution on the time clock.
--
-- WHY THIS SECTION EXISTS AT ALL:
-- Migration 0037 records time as clock-in / clock-out with
-- punch_kind in ('work','break'). Nothing anywhere in this database records
-- WHAT a person was doing. That means that today, the narrow door of
-- Reg. §1.471-3(b) cannot be walked through: there is no evidence to walk with.
--
-- Cohan v. Commissioner, 39 F.2d 540 (2d Cir. 1930) allows an estimate when
-- SOME credible basis exists. Cannabis cases have been consistently hostile to
-- unsupported allocations, and IRC §6001 requires records sufficient to
-- establish the amount. An after-the-fact percentage typed into a box is not a
-- record; it is a guess wearing a record's clothes.
--
-- So this section builds the record. It is ADDITIVE: the punch_kind CHECK is
-- untouched, every column is nullable, and the existing time clock keeps
-- working unchanged for staff who never touch this.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.time_punches
  add column if not exists labor_role_code text;

alter table public.time_punches
  add column if not exists inbound_manifest_id uuid;

alter table public.time_punches
  add column if not exists task_note text;

do $tp$
begin
  -- Point the role at the taxonomy. Guarded so a re-run is silent.
  if not exists (
    select 1 from pg_constraint
     where conname = 'time_punches_labor_role_fk'
       and conrelid = 'public.time_punches'::regclass
  ) then
    alter table public.time_punches
      add constraint time_punches_labor_role_fk
      foreign key (labor_role_code)
      references public.gl_payroll_labor_roles(code)
      on delete set null;
  end if;

  -- Tie acquisition minutes to the actual delivery, when the manifests table
  -- exists. THIS is the column that turns "I think it was about 10%" into
  -- "these 42 punches, each tied to a numbered manifest."
  if to_regclass('public.inbound_manifests') is not null
     and not exists (
       select 1 from pg_constraint
        where conname = 'time_punches_manifest_fk'
          and conrelid = 'public.time_punches'::regclass
     ) then
    alter table public.time_punches
      add constraint time_punches_manifest_fk
      foreign key (inbound_manifest_id)
      references public.inbound_manifests(id)
      on delete set null;
  end if;
end;
$tp$;

comment on column public.time_punches.labor_role_code is
  'What the person was actually DOING, from gl_payroll_labor_roles. Nullable: the time clock works without it. Required in substance before any acquisition-labor allocation can be substantiated (IRC 6001).';

comment on column public.time_punches.inbound_manifest_id is
  'The delivery this punch was spent receiving. This is the evidence that turns an estimated percentage into a documented one under Reg. 1.471-3(b).';

create index if not exists time_punches_labor_role_idx
  on public.time_punches (labor_role_code) where labor_role_code is not null;

create index if not exists time_punches_manifest_idx
  on public.time_punches (inbound_manifest_id) where inbound_manifest_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- §3  THE DOCUMENTED TIME SPLIT
--
-- Effective-dated, per employee, in integer milli-percent, and REFUSING to
-- exist without a written basis — the same non-negotiable that
-- gl_allocation_configs (0172) already applies to rent.
--
-- 0173's own comment on account 61000 already demanded "a documented allocation
-- study (gl_allocation_configs)". This table is the code that finally ENFORCES
-- that sentence for labor.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.gl_payroll_allocations (
  id                uuid primary key default gen_random_uuid(),

  employee_id       uuid not null references public.employees(id) on delete cascade,

  labor_role_code   text not null references public.gl_payroll_labor_roles(code) on delete restrict,

  -- Share of this employee's paid time, integer milli-percent (10% = 10000).
  -- Integer, never float: a float percentage silently loses cents at scale, and
  -- lost cents in a §280E split are lost dollars on the return.
  share_milli_pct   integer not null
                      check (share_milli_pct >= 0 and share_milli_pct <= 100000),

  effective_from    date not null,
  effective_to      date,

  -- NON-NEGOTIABLE, exactly as gl_allocation_configs requires for rent.
  document_ref      text not null check (length(btrim(document_ref)) >= 3),
  basis_note        text not null check (length(btrim(basis_note)) >= 3),

  -- How the split was measured, so the method is auditable, not just the number.
  days_of_records   integer not null default 0 check (days_of_records >= 0),
  contemporaneous   boolean not null default false,
  task_level_detail boolean not null default false,
  tied_to_manifests boolean not null default false,

  approved_by       text,
  approved_on       date,

  active            boolean not null default true,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (employee_id, labor_role_code, effective_from),

  constraint gl_payroll_alloc_dates_ordered
    check (effective_to is null or effective_to >= effective_from)
);

comment on table public.gl_payroll_allocations is
  'Effective-dated labor time splits in integer milli-percent, per employee. A document reference and written basis are REQUIRED - an unsupported labor allocation cannot be stored. Enforces the allocation-study requirement that migration 0173 already stated for account 61000. The blocking logic lives in payroll-cogs-core.ts; this table is the evidence of record.';

create index if not exists gl_payroll_alloc_employee_idx
  on public.gl_payroll_allocations (employee_id) where active;

create index if not exists gl_payroll_alloc_role_idx
  on public.gl_payroll_allocations (labor_role_code) where active;

-- ─── THE TRIPWIRE ────────────────────────────────────────────────────────
-- A trigger, not just a CHECK, because this rule spans two tables: it has to
-- look up the role to know whether the claim is legal. Everything it refuses is
-- also refused by payroll-cogs-core.ts; this is the second lock on the same
-- door, for the case where a row arrives by some route the app did not write.
create or replace function public.gl_payroll_allocation_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.gl_payroll_labor_roles%rowtype;
begin
  select * into v_role
    from public.gl_payroll_labor_roles
   where code = new.labor_role_code;

  if not found then
    raise exception
      'GL_PAYROLL_UNKNOWN_ROLE: there is no labor role called %. The list is closed on purpose - add the role to the taxonomy first, with its Section 280E treatment and authority.',
      new.labor_role_code
      using errcode = 'raise_exception';
  end if;

  -- The claim that would cost the most money if it were wrong.
  if v_role.never_inventoriable and v_role.account_code like '6%' then
    raise exception
      'GL_PAYROLL_SELLING_LABOR_TO_COGS: % is selling or operating labor and can never be cost of goods sold. Section 280E disallows it, and Reg. 1.471-3(c) excludes any cost of selling even for producers.',
      new.labor_role_code
      using errcode = 'raise_exception';
  end if;

  -- An acquisition claim without the evidence method recorded is exactly the
  -- unsupported estimate the cannabis cases keep rejecting.
  if v_role.treatment = 'acquisition' and new.active and new.share_milli_pct > 0 then
    if not new.task_level_detail then
      raise exception
        'GL_PAYROLL_NO_TASK_DETAIL: an acquisition-labor split needs time recorded against TASKS, not just clock-in and clock-out. IRC 6001 requires records sufficient to establish the amount. Record labor_role_code on the time punches first.'
        using errcode = 'raise_exception';
    end if;

    if not new.tied_to_manifests then
      raise exception
        'GL_PAYROLL_NOT_TIED_TO_DELIVERIES: receiving time has to be tied to specific deliveries to prove it was spent acquiring possession under Reg. 1.471-3(b). Set inbound_manifest_id on the receiving punches.'
        using errcode = 'raise_exception';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.gl_payroll_allocation_guard() is
  'Refuses labor allocations that Section 280E and Reg. 1.471-3(b) do not permit. The same rules are enforced and tested in src/lib/accounting/payroll-cogs-core.ts; this trigger is the second lock on the same door.';

drop trigger if exists gl_payroll_allocations_guard on public.gl_payroll_allocations;
create trigger gl_payroll_allocations_guard
  before insert or update on public.gl_payroll_allocations
  for each row execute function public.gl_payroll_allocation_guard();

do $t$
begin
  if to_regprocedure('public.set_updated_at()') is not null then
    execute 'drop trigger if exists gl_payroll_allocations_set_updated_at on public.gl_payroll_allocations';
    execute 'create trigger gl_payroll_allocations_set_updated_at before update on public.gl_payroll_allocations for each row execute function public.set_updated_at()';

    execute 'drop trigger if exists gl_payroll_labor_roles_set_updated_at on public.gl_payroll_labor_roles';
    execute 'create trigger gl_payroll_labor_roles_set_updated_at before update on public.gl_payroll_labor_roles for each row execute function public.set_updated_at()';
  end if;
end;
$t$;

-- ═══════════════════════════════════════════════════════════════════════════
-- §4  THE BRIDGE — a payroll run points at the journal it produced.
--
-- This is what makes posting idempotent and what lets any GL line be traced
-- back to a paystub. Additive columns on the EXISTING 0057 table; the ACH
-- surface is otherwise untouched.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.payroll_runs
  add column if not exists gl_journal_id uuid;

alter table public.payroll_runs
  add column if not exists gl_posted_at timestamptz;

-- The content fingerprint from payrollContentFingerprint() in the TS core. It
-- is stored so a CORRECTED run is recognised as DIFFERENT rather than being
-- swallowed as a duplicate of the run it corrects.
alter table public.payroll_runs
  add column if not exists gl_content_fingerprint text;

do $br$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'payroll_runs_gl_journal_fk'
       and conrelid = 'public.payroll_runs'::regclass
  ) then
    alter table public.payroll_runs
      add constraint payroll_runs_gl_journal_fk
      foreign key (gl_journal_id)
      references public.gl_journals(id)
      on delete set null;
  end if;
end;
$br$;

comment on column public.payroll_runs.gl_journal_id is
  'The general ledger journal this payroll run produced. Null means the run has been paid but never recorded in the books.';

comment on column public.payroll_runs.gl_content_fingerprint is
  'Content hash from payrollContentFingerprint() in payroll-cogs-core.ts. Distinguishes a CORRECTED run from a duplicate posting of the same run.';

create index if not exists payroll_runs_gl_journal_idx
  on public.payroll_runs (gl_journal_id) where gl_journal_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- §5  POSTING — delegate to gl_submit_journal(), never around it.
--
-- This function is a THIN BRIDGE. Every guarantee — balance, idempotency,
-- period locks, approval thresholds, the line-in-the-sand date — already lives
-- in gl_submit_journal(), and this does not reimplement any of it. It
-- classifies nothing: the caller supplies lines that payroll-cogs-core.ts has
-- already classified, blocked or blessed.
--
-- NOTE ON auto_post: payroll is NEVER auto-posted. The parameter is not even
-- offered. gl_posting_templates deliberately excludes payroll (0174), and the
-- reason is that the §280E labor split is a human judgement every period.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.gl_post_payroll_run(
  p_entity_code          text,
  p_pay_date             date,
  p_source_ref           text,
  p_memo                 text,
  p_lines                jsonb,
  p_expected_cents       bigint  default null,
  p_assumption_note      text    default null,
  p_run_id               uuid    default null,
  p_content_fingerprint  text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result     jsonb;
  v_journal_id uuid;
  v_existing   text;
  v_line       jsonb;
  v_line_no    integer := 0;
  v_acct       text;
  v_class      text;
  v_type       text;
begin
  -- OWNER-ONLY. Paying employees stays an ADMIN job (0185 §4 leaves the ACH
  -- surface alone on purpose). Writing the tax consequence into the ledger is
  -- a different job, and only the person who signs the return does it.
  if not public.is_owner() then
    raise exception 'GL_NOT_OWNER: only the owner may post to the books'
      using errcode = 'insufficient_privilege';
  end if;

  if p_source_ref is null or btrim(p_source_ref) = '' then
    raise exception 'GL_NO_SOURCE_REF: a payroll run must carry an idempotency reference so it cannot be posted twice'
      using errcode = 'raise_exception';
  end if;

  -- A payroll run that has already been posted, and whose CONTENT has since
  -- changed, is a correction — not a re-post. Refuse rather than silently
  -- overwrite, because silently overwriting a posted payroll is how a quarter
  -- of withholding disappears.
  if p_run_id is not null and p_content_fingerprint is not null then
    select gl_content_fingerprint into v_existing
      from public.payroll_runs
     where id = p_run_id
       and gl_journal_id is not null;

    if v_existing is not null and v_existing is distinct from btrim(p_content_fingerprint) then
      raise exception
        'GL_PAYROLL_RUN_CHANGED: this payroll run has already been posted, and the numbers have changed since. Post a correcting entry instead of re-posting - the original journal stays, and the correction shows what changed and why.'
        using errcode = 'raise_exception';
    end if;
  end if;

  -- ─── THE SILENT-WRONG-ANSWER GUARD ──────────────────────────────────────
  -- gl_submit_journal() defaults a missing cost_class to 'none'. For most
  -- entries that is harmless. For PAYROLL it is the worst possible failure
  -- mode, because every §280E report reads cost_class, NOT the account number.
  -- A payroll journal posted without cost classes BALANCES PERFECTLY and is
  -- silently wrong: the wages disappear from the disallowed column and the
  -- receiving labor disappears from COGS. Nothing looks broken. The only
  -- symptom is a wrong tax return.
  --
  -- So payroll refuses to travel without its labels. This was found by an
  -- end-to-end test that posted eight lines which balanced to zero and were
  -- all tagged 'none'.
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_line_no := v_line_no + 1;
    v_acct  := btrim(coalesce(v_line->>'account_code', ''));
    v_class := btrim(coalesce(v_line->>'cost_class', ''));

    if v_class = '' then
      raise exception
        'GL_PAYROLL_NO_COST_CLASS: payroll line % (account %) has no cost class. Every 280E report reads the cost class, not the account number, so posting without it would balance perfectly and still produce a wrong tax return.',
        v_line_no, coalesce(nullif(v_acct, ''), '(none)')
        using errcode = 'raise_exception';
    end if;

    -- Read the account's REAL type from the chart rather than inferring it from
    -- the leading digit. The digit convention is a convention; the type column
    -- is the fact. (gl_submit_journal raises GL_UNKNOWN_ACCOUNT for an account
    -- that does not exist, so a null here simply means "leave it to the
    -- delegate" rather than "assume it is fine".)
    select a.type into v_type
      from public.gl_accounts a
     where a.code = v_acct;

    -- A COGS account is an inventory claim. It must SAY so.
    if v_type = 'cogs' and v_class not in ('cogs_direct','cogs_allocable') then
      raise exception
        'GL_PAYROLL_COGS_CLASS_MISMATCH: payroll line % posts to cost-of-goods account % but is labelled %. A cost that rides into inventory has to be labelled as one.',
        v_line_no, v_acct, v_class
        using errcode = 'raise_exception';
    end if;

    -- The reseller rule: a reseller has no DIRECT labor. If labor reaches
    -- inventory at all it is an ALLOCABLE charge of acquiring possession.
    if v_class = 'cogs_direct' then
      raise exception
        'GL_PAYROLL_DIRECT_LABOR_CLAIMED: payroll line % claims direct labor. Reg. 1.471-3(b), the reseller rule, has no direct-labor clause at all - only charges incurred in acquiring possession of the goods, which are allocable.',
        v_line_no
        using errcode = 'raise_exception';
    end if;

    -- An EXPENSE line tagged 'none' is the same silent failure as a missing
    -- label: the wages vanish from the disallowed column and the 280E report
    -- quietly understates what the statute takes. Balance-sheet lines (the
    -- withholding liability, the advance receivable, the bank) are legitimately
    -- 'none', because they are not costs at all -- so only expense and COGS
    -- lines are held to this.
    if v_type in ('expense','cogs') and v_class = 'none' then
      raise exception
        'GL_PAYROLL_UNCLASSIFIED_EXPENSE: payroll line % posts wages to account % with no 280E treatment. Wages are either disallowed by 280E, or they belong to a separate business, or they are an allocable cost of acquiring goods - but they are never simply unclassified.',
        v_line_no, v_acct
        using errcode = 'raise_exception';
    end if;
  end loop;

  -- Delegate. Every guarantee lives in one place.
  v_result := public.gl_submit_journal(
    p_entity_code       => p_entity_code,
    p_journal_date      => p_pay_date,
    p_source_kind       => 'payroll',
    p_source_ref        => btrim(p_source_ref),
    p_memo              => p_memo,
    p_lines             => p_lines,
    p_template_code     => null,
    p_expected_cents    => p_expected_cents,
    p_auto_post         => false,     -- payroll is NEVER auto-posted.
    p_assumption_note   => p_assumption_note,
    p_intercompany_ref  => null,
    p_three_way_matched => false
  );

  v_journal_id := nullif(v_result->>'journal_id', '')::uuid;

  -- Stamp the bridge so the paystub and the ledger point at each other.
  if v_journal_id is not null and p_run_id is not null then
    update public.payroll_runs
       set gl_journal_id          = v_journal_id,
           gl_posted_at           = now(),
           gl_content_fingerprint = coalesce(btrim(p_content_fingerprint), gl_content_fingerprint)
     where id = p_run_id;
  end if;

  return v_result;
end;
$$;

comment on function public.gl_post_payroll_run(text, date, text, text, jsonb, bigint, text, uuid, text) is
  'Posts a CLASSIFIED payroll run to the general ledger through gl_submit_journal(), then links the run to the journal. The Section 280E labor classification is performed and tested in src/lib/accounting/payroll-cogs-core.ts; this function deliberately contains no tax logic of its own. Never auto-posts. Owner-only.';

revoke all on function public.gl_post_payroll_run(text, date, text, text, jsonb, bigint, text, uuid, text) from public;
grant execute on function public.gl_post_payroll_run(text, date, text, text, jsonb, bigint, text, uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- §6  ROW LEVEL SECURITY — owner-only, matching 0185.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.gl_payroll_labor_roles enable row level security;
alter table public.gl_payroll_allocations enable row level security;

drop policy if exists gl_payroll_labor_roles_owner_all on public.gl_payroll_labor_roles;
create policy gl_payroll_labor_roles_owner_all
  on public.gl_payroll_labor_roles
  for all
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

drop policy if exists gl_payroll_allocations_owner_all on public.gl_payroll_allocations;
create policy gl_payroll_allocations_owner_all
  on public.gl_payroll_allocations
  for all
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- ═══════════════════════════════════════════════════════════════════════════
-- §7  THE SELF-CHECK
--
-- Run this after applying the migration:
--
--     select * from gl_audit_payroll_wiring();
--
-- AN EMPTY RESULT MEANS EVERYTHING IS CORRECT. This function only ever returns
-- PROBLEMS. It is a smoke alarm: silence is the good outcome.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.gl_audit_payroll_wiring()
returns table (area text, problem text)
language sql
stable
security definer
set search_path = public
as $$
  -- (a) Every labor role must point at an account that actually exists in the
  --     chart. A phantom account reference only fails at posting time, which is
  --     the worst possible moment to find out.
  select 'labor_role'::text,
         format('role %s points at account %s, which is not in the chart of accounts',
                r.code, r.account_code)::text
    from public.gl_payroll_labor_roles r
   where r.is_active
     and not exists (select 1 from public.gl_accounts a where a.code = r.account_code)

  union all

  -- (b) THE BIG ONE. Selling or operating labor must never point at COGS.
  --     A CHECK constraint already forbids this; the audit reports it anyway,
  --     because a constraint that was somehow dropped fails silently forever.
  select 'section_280e'::text,
         format('role %s is never-inventoriable but points at COGS account %s - this is the single most expensive mistake a cannabis retailer can make',
                r.code, r.account_code)::text
    from public.gl_payroll_labor_roles r
   where r.is_active
     and r.never_inventoriable
     and r.account_code like '6%'

  union all

  -- (c) A reseller's labor is never a DIRECT product cost.
  select 'section_280e'::text,
         format('role %s claims cost class cogs_direct; a reseller has no direct labor, only allocable charges of acquiring possession (Reg. 1.471-3(b))',
                r.code)::text
    from public.gl_payroll_labor_roles r
   where r.is_active
     and r.cost_class = 'cogs_direct'

  union all

  -- (d) An allocation to COGS with no evidence method recorded is the exact
  --     unsupported estimate the cannabis cases reject.
  select 'substantiation'::text,
         format('employee %s has an active %s allocation of %s milli-percent with no task-level time records behind it',
                a.employee_id, a.labor_role_code, a.share_milli_pct)::text
    from public.gl_payroll_allocations a
    join public.gl_payroll_labor_roles r on r.code = a.labor_role_code
   where a.active
     and a.share_milli_pct > 0
     and r.treatment = 'acquisition'
     and not a.task_level_detail

  union all

  select 'substantiation'::text,
         format('employee %s has an active %s allocation that is not tied to specific deliveries, so it cannot be proved under Reg. 1.471-3(b)',
                a.employee_id, a.labor_role_code)::text
    from public.gl_payroll_allocations a
    join public.gl_payroll_labor_roles r on r.code = a.labor_role_code
   where a.active
     and a.share_milli_pct > 0
     and r.treatment = 'acquisition'
     and not a.tied_to_manifests

  union all

  -- (e) A time split that does not add to 100% means some paid time is
  --     unaccounted for, and unaccounted time is where mistakes hide.
  select 'allocation'::text,
         format('employee %s has active allocations totalling %s milli-percent, not 100000 (100%%)',
                t.employee_id, t.total)::text
    from (
      select a.employee_id, sum(a.share_milli_pct) as total
        from public.gl_payroll_allocations a
       where a.active and a.effective_to is null
       group by a.employee_id
    ) t
   where t.total <> 100000

  union all

  -- (f) The evidence surface must exist, or the narrow door is theoretical.
  select 'evidence'::text,
         'time_punches.labor_role_code is missing; there is no way to record WHAT anyone was doing, so no acquisition-labor claim can ever be substantiated'::text
   where not exists (
     select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name   = 'time_punches'
        and column_name  = 'labor_role_code'
   )

  union all

  -- (g) The bridge must exist, or nothing can be traced to a paystub.
  select 'bridge'::text,
         'payroll_runs.gl_journal_id is missing; payroll cannot be traced to the ledger'::text
   where not exists (
     select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name   = 'payroll_runs'
        and column_name  = 'gl_journal_id'
   )

  union all

  -- (h) The posting function must exist.
  select 'posting'::text,
         'gl_post_payroll_run() is missing; payroll has no route to the ledger'::text
   where to_regprocedure(
     'public.gl_post_payroll_run(text,date,text,text,jsonb,bigint,text,uuid,text)'
   ) is null

  union all

  -- (i) Payroll must NOT have a posting template. If one ever appears, payroll
  --     could be auto-posted, and the Section 280E split would stop being a
  --     human judgement. This audit line is why that can never happen quietly.
  select 'posting'::text,
         'a gl_posting_templates row exists for payroll; payroll must never be auto-postable because the 280E labor split is a human judgement every period'::text
   where to_regclass('public.gl_posting_templates') is not null
     and exists (
       select 1 from public.gl_posting_templates where source_kind = 'payroll'
     )

  union all

  -- (j) Both new tables must have RLS on. A books table without RLS is readable
  --     by any authenticated session with a PostgREST call.
  select 'security'::text,
         format('table %s does not have row level security enabled', c.relname)::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('gl_payroll_labor_roles','gl_payroll_allocations')
     and c.relrowsecurity is false

  union all

  -- (k) The tripwire must be armed.
  select 'security'::text,
         'the gl_payroll_allocations_guard trigger is missing; unsupported labor allocations could be inserted directly'::text
   where not exists (
     select 1 from pg_trigger
      where tgname = 'gl_payroll_allocations_guard'
        and tgrelid = 'public.gl_payroll_allocations'::regclass
        and not tgisinternal
   );
$$;

comment on function public.gl_audit_payroll_wiring() is
  'Returns a row for every problem with the payroll-to-GL wiring. AN EMPTY RESULT MEANS EVERYTHING IS CORRECT - it reports only problems, like a smoke alarm.';

revoke all on function public.gl_audit_payroll_wiring() from public;
grant execute on function public.gl_audit_payroll_wiring() to authenticated;

-- =============================================================================
-- WHAT TO DO AFTER RUNNING THIS FILE
--
--   1. Run:  select * from gl_audit_payroll_wiring();
--      An EMPTY result means everything is wired correctly. If rows come back,
--      each one is a sentence describing exactly what is wrong.
--
--   2. Run:  select code, treatment, account_code, cost_class, plain_english
--              from gl_payroll_labor_roles order by sort_order;
--      This is the whole payroll side of 280E on one screen: which labor can
--      ever reach cost of goods sold (treatment = 'acquisition') and which
--      labor 280E takes no matter what (never_inventoriable = true).
--
--   3. The honest summary, in one line: of everything Greenway pays its people,
--      only RECEIVING and DRIVER-COLLECTION time can ever become cost of goods
--      sold, only with task-level records tied to specific deliveries, and only
--      up to a plausible share of payroll. Everything else is disallowed by
--      Section 280E - not by this software, but by the statute.
-- =============================================================================
