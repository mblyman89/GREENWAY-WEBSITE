-- =============================================================================
-- 0174_gl_posting_service.sql — F3: THE ONE DOOR INTO THE LEDGER
-- =============================================================================
-- IDEMPOTENT. Safe to run repeatedly. Silent on success.
--
-- WHAT WAS MISSING
-- ----------------
-- 0172 built the vault: tables, immutability triggers, and gl_post_journal(),
-- which refuses out-of-balance entries, closed periods, control-account plugs
-- and untagged 280E lines. 0173 built the chart. But a grep of the entire
-- application returns NOTHING that writes to gl_journals. The vault has
-- excellent locks and no door. The only way to record a transaction today is to
-- hand-type SQL in the Supabase console — which is exactly the unaudited,
-- un-repeatable path that produced the Sage drift in the first place.
--
-- This migration builds the door, and it builds it so that the door itself
-- cannot be used carelessly:
--
--   1. gl_journals.idempotency_key + line_fingerprint
--        The same real-world event (a webhook redelivered, a double-clicked
--        button, a replayed import) can be submitted any number of times and
--        will produce EXACTLY ONE journal. A resubmission with the SAME content
--        returns the original. A resubmission with DIFFERENT content is
--        REFUSED, not silently ignored and not silently posted — that is an
--        invoice being edited after the fact, and it needs a human.
--
--   2. gl_posting_templates
--        Nothing auto-posts without a template Michael approved IN ADVANCE. A
--        template carries a tolerance, a hard ceiling, an effective window, and
--        an approval. The CHECK constraint makes it structurally impossible to
--        even CREATE a template for an accrual, a depreciation entry, an
--        opening balance or an intercompany transfer — the judgment calls.
--
--   3. gl_template_changes
--        Every change to a template is recorded with a reason, and a template
--        cannot be edited without supplying a NEW reason. This exists because
--        of a specific decision (research/bookkeeping/12 §1.3): the owner asked
--        for tolerances that loosen themselves once the system has "learned the
--        patterns". A system that widens its own tolerances on the strength of
--        its own track record is grading its own homework — every entry it
--        wrongly auto-posted becomes evidence that it should auto-post more.
--        So the platform MEASURES readiness and REPORTS it; a human, on a dated
--        row, with a written reason, is the only thing that can widen a limit.
--
--   4. gl_submit_journal()
--        The door. Header + lines + optional auto-post, in ONE transaction.
--        It re-derives every automation decision server-side rather than
--        trusting the caller's flag, so a bug in the TypeScript layer cannot
--        cause an accrual to post itself.
--
--   5. gl_submit_intercompany_pair()
--        Both halves of an intercompany transfer, or neither. A half-posted
--        intercompany entry is drift by construction.
--
-- STANDING RULE 14 governs every decision below: where a rule could be a
-- warning or a refusal, it is a refusal.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Idempotency on the journal header.
-- -----------------------------------------------------------------------------
-- NULLABLE on purpose: a hand-keyed manual entry has no external event to be
-- idempotent ON, and forcing a synthetic key there would be a lie. But anything
-- arriving from a machine MUST carry one, and gl_submit_journal() enforces that.
alter table public.gl_journals
  add column if not exists idempotency_key text;

alter table public.gl_journals
  add column if not exists line_fingerprint text;

comment on column public.gl_journals.idempotency_key is
  'Natural key of the originating real-world event: entity:source_kind:source_ref (colons inside a component are escaped). Deliberately human-readable rather than a hash, so an auditor can see which sale or invoice a journal came from. Null only for hand-keyed entries.';

comment on column public.gl_journals.line_fingerprint is
  'Order-independent fingerprint of the economic content (account|amount|cost_class per line, sorted). Lets a resubmission of the same key be classified as a harmless duplicate or a genuine conflict.';

-- The unique index is what actually makes double-posting impossible. The
-- application check is a courtesy that produces a good error message; THIS is
-- the guarantee, and it holds even against two concurrent transactions.
create unique index if not exists uq_gl_journals_idempotency_key
  on public.gl_journals (idempotency_key)
  where idempotency_key is not null;

-- -----------------------------------------------------------------------------
-- 1b) The audit trail needs two new event kinds.
-- -----------------------------------------------------------------------------
-- 0172's gl_audit_events.event_kind CHECK does not include 'journal_autoposted'
-- or 'journal_submitted'. Without this, the very first entry the machine posts
-- would abort on a constraint violation AFTER the journal had been written —
-- caught here by reading 0172 rather than assuming, and proven by executing the
-- migration against real PostgreSQL before Michael ever pastes it in.
--
-- The constraint is dropped by its auto-generated name and recreated with a
-- stable one, so this block is safely repeatable.
alter table public.gl_audit_events
  drop constraint if exists gl_audit_events_event_kind_check;
alter table public.gl_audit_events
  drop constraint if exists gl_audit_events_event_kind_allowed;
alter table public.gl_audit_events
  add constraint gl_audit_events_event_kind_allowed
  check (event_kind in ('journal_posted','journal_reversed',
                        'period_closed','period_reopened',
                        'period_locked','account_created',
                        'account_deactivated','opening_balance_posted',
                        'journal_submitted','journal_autoposted',
                        'template_approved','journal_approved',
                        'approval_policy_changed'));

-- -----------------------------------------------------------------------------
-- 2) gl_posting_templates — pre-approved recurring entries.
-- -----------------------------------------------------------------------------
create table if not exists public.gl_posting_templates (
  id                uuid primary key default gen_random_uuid(),

  code              text not null unique
                      check (length(btrim(code)) >= 3),

  entity_id         uuid not null references public.gl_entities(id) on delete restrict,

  -- THE STRUCTURAL GUARANTEE. Only the four evidence-derived kinds may exist as
  -- a template at all. An accrual is an opinion about the future; a depreciation
  -- entry is a schedule; an opening balance is the foundation of every number
  -- that follows; an intercompany transfer is ~24 entries a year and the most
  -- drift-prone entry there is. None of them can be given a template here, so
  -- none of them can ever auto-post, no matter what any future code believes.
  source_kind       text not null
                      check (source_kind in ('pos_sale','excise','purchase','bank')),

  description       text not null check (length(btrim(description)) >= 10),

  is_active         boolean not null default false,

  -- APPROVAL. Both columns move together or the template cannot fire.
  approved_by       uuid references auth.users(id),
  approved_at       timestamptz,

  effective_from    date not null,
  effective_to      date,

  -- Tolerance: BOTH legs apply, and the wider of the two admits the variance.
  -- An absolute cent floor stops a two-cent rounding difference on a $12 bill
  -- from blocking; a percentage ceiling stops a $50,000 variance on a $1,000,000
  -- invoice from being waved through. Milli-percent per standing rule 4.
  tol_abs_cents     bigint not null default 0 check (tol_abs_cents >= 0),
  tol_milli_pct     integer not null default 0 check (tol_milli_pct >= 0),

  -- Hard ceiling. No single automatic entry may exceed this, ever, for any
  -- reason. This is the backstop that would have caught the $4,624,697.31 plug
  -- even if every other control had been misconfigured.
  max_autopost_cents bigint not null check (max_autopost_cents > 0),

  -- Every edit must supply a NEW reason (enforced by trigger below). This is
  -- the mechanism that keeps tolerance-widening a deliberate human act.
  change_reason     text not null check (length(btrim(change_reason)) >= 10),

  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint gl_posting_templates_window
    check (effective_to is null or effective_to >= effective_from),

  -- THE LINE IN THE SAND applies here too: a template cannot be made effective
  -- before the books begin, because it could then only ever fire on an entry
  -- the ledger would refuse anyway.
  constraint gl_posting_templates_line_in_the_sand
    check (effective_from >= date '2026-01-01'),

  -- Approval is all-or-nothing.
  constraint gl_posting_templates_approval_pairing
    check ( (approved_by is null and approved_at is null)
            or (approved_by is not null and approved_at is not null) ),

  -- An ACTIVE template that nobody approved is the single most dangerous row
  -- this table could hold, so the database refuses to store one.
  constraint gl_posting_templates_active_requires_approval
    check ( is_active = false or (approved_by is not null and approved_at is not null) )
);

comment on table public.gl_posting_templates is
  'Pre-approved recurring entries. Only pos_sale, excise, purchase and bank may have templates: those are derived from evidence already in the system. Estimates, allocations and judgments have no template and therefore can never auto-post.';

create index if not exists idx_gl_posting_templates_entity
  on public.gl_posting_templates (entity_id, source_kind) where is_active;

-- -----------------------------------------------------------------------------
-- 3) gl_template_changes — append-only history of every template edit.
-- -----------------------------------------------------------------------------
create table if not exists public.gl_template_changes (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid not null references public.gl_posting_templates(id) on delete cascade,
  template_code text not null,
  change_kind   text not null check (change_kind in ('created','updated','deleted')),
  reason        text not null,
  before_row    jsonb,
  after_row     jsonb,
  actor         uuid references auth.users(id),
  created_at    timestamptz not null default now()
);

comment on table public.gl_template_changes is
  'Append-only record of every posting-template change, with the reason. A widened tolerance is always traceable to a person, a date and a sentence.';

create index if not exists idx_gl_template_changes_template
  on public.gl_template_changes (template_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 4) Triggers protecting the templates.
-- -----------------------------------------------------------------------------

-- (a) A template cannot be edited without a NEW reason. Reusing the previous
--     sentence is not a reason; it is a rubber stamp.
create or replace function public.gl_guard_template_change_reason()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    -- updated_at is maintained by a separate trigger and must not itself count
    -- as a change requiring justification.
    if to_jsonb(new) - 'updated_at' - 'change_reason'
       is distinct from to_jsonb(old) - 'updated_at' - 'change_reason'
    then
      if new.change_reason is not distinct from old.change_reason then
        raise exception 'GL_TEMPLATE_NEEDS_REASON: template % was changed without a new written reason. Every change to an automatic posting rule must say why, in its own words.', new.code
          using errcode = 'raise_exception';
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_gl_templates_reason on public.gl_posting_templates;
create trigger trg_gl_templates_reason
  before update on public.gl_posting_templates
  for each row execute function public.gl_guard_template_change_reason();

-- (b) Every change is recorded, automatically, whether it came through the
--     application or through the SQL console at 11pm.
create or replace function public.gl_audit_template_change()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into public.gl_template_changes
      (template_id, template_code, change_kind, reason, before_row, after_row, actor)
    values (new.id, new.code, 'created', new.change_reason, null, to_jsonb(new), auth.uid());
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.gl_template_changes
      (template_id, template_code, change_kind, reason, before_row, after_row, actor)
    values (new.id, new.code, 'updated', new.change_reason, to_jsonb(old), to_jsonb(new), auth.uid());
    return new;
  else
    insert into public.gl_template_changes
      (template_id, template_code, change_kind, reason, before_row, after_row, actor)
    values (old.id, old.code, 'deleted', old.change_reason, to_jsonb(old), null, auth.uid());
    return old;
  end if;
end $$;

drop trigger if exists trg_gl_templates_audit on public.gl_posting_templates;
create trigger trg_gl_templates_audit
  after insert or update or delete on public.gl_posting_templates
  for each row execute function public.gl_audit_template_change();

-- (c) The change log is append-only, exactly like gl_audit_events.
create or replace function public.gl_guard_template_changes_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'GL_APPEND_ONLY: gl_template_changes is a permanent record and cannot be % ', lower(tg_op)
    using errcode = 'raise_exception';
end $$;

drop trigger if exists trg_gl_template_changes_append_only on public.gl_template_changes;
create trigger trg_gl_template_changes_append_only
  before update or delete on public.gl_template_changes
  for each row execute function public.gl_guard_template_changes_append_only();

drop trigger if exists trg_gl_posting_templates_updated on public.gl_posting_templates;
create trigger trg_gl_posting_templates_updated
  before update on public.gl_posting_templates
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 5) Helpers: the idempotency key and the line fingerprint, computed in SQL so
--    the database and the application can never disagree about what "the same
--    event" means.
-- -----------------------------------------------------------------------------

create or replace function public.gl_idempotency_key(
  p_entity_code text,
  p_source_kind text,
  p_source_ref  text
)
returns text language plpgsql immutable as $$
declare
  e text := lower(btrim(coalesce(p_entity_code, '')));
  k text := lower(btrim(coalesce(p_source_kind, '')));
  r text := btrim(coalesce(p_source_ref, ''));
begin
  if e = '' or k = '' or r = '' then
    raise exception 'GL_NO_IDEMPOTENCY_KEY: an automatic entry needs an entity, a source kind and a stable source reference. Without one, a retry would post the same money twice.'
      using errcode = 'raise_exception';
  end if;
  -- Escape backslashes first, then colons, so that ("a:b","c") and ("a","b:c")
  -- can never collapse onto the same key.
  return replace(replace(e, '\', '\\'), ':', '\:') || ':' ||
         replace(replace(k, '\', '\\'), ':', '\:') || ':' ||
         replace(replace(r, '\', '\\'), ':', '\:');
end $$;

comment on function public.gl_idempotency_key(text, text, text) is
  'Mirrors buildIdempotencyKey() in src/lib/accounting/posting-core.ts. Kept in lockstep by scripts/accounting/posting-service-tests.sql.';

-- Fingerprint of the economic content. Order-independent (lines arrive in
-- whatever order the caller iterated), but sensitive to account, amount AND
-- cost class — because re-tagging an expense from nondeductible_280e to
-- cogs_direct is the same money and a completely different tax return.
create or replace function public.gl_line_fingerprint(p_lines jsonb)
returns text language sql immutable as $$
  select string_agg(part, ';' order by part)
  from (
    select coalesce(l->>'account_code', '') || '|' ||
           coalesce(l->>'amount_cents', '') || '|' ||
           coalesce(nullif(btrim(coalesce(l->>'cost_class', '')), ''), 'none') as part
    from jsonb_array_elements(p_lines) as l
  ) parts;
$$;

-- -----------------------------------------------------------------------------
-- 6) gl_submit_journal — THE DOOR.
-- -----------------------------------------------------------------------------
-- Returns jsonb:
--   { journal_id, journal_no, status, outcome, disposition, code }
--     outcome     : 'created' | 'duplicate'
--     disposition : 'posted'  | 'draft'
--
-- Everything happens in one transaction. If any check fails, nothing is written
-- at all — there is no half-created journal to clean up later.
--
-- p_auto_post is a REQUEST, never a permission. The function re-derives
-- eligibility from the template rows themselves, so if the TypeScript decision
-- core were ever wrong, or bypassed entirely, an accrual still cannot post
-- itself.
-- -----------------------------------------------------------------------------
create or replace function public.gl_submit_journal(
  p_entity_code       text,
  p_journal_date      date,
  p_source_kind       text,
  p_source_ref        text,
  p_memo              text,
  p_lines             jsonb,
  p_template_code     text    default null,
  p_expected_cents    bigint  default null,
  p_auto_post         boolean default false,
  p_assumption_note   text    default null,
  p_intercompany_ref  uuid    default null,
  p_three_way_matched boolean default false
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity      public.gl_entities%rowtype;
  v_key         text;
  v_fingerprint text;
  v_existing    public.gl_journals%rowtype;
  v_journal_id  uuid;
  v_no          bigint;
  v_tpl         public.gl_posting_templates%rowtype;
  v_line        jsonb;
  v_line_no     integer := 0;
  v_account     public.gl_accounts%rowtype;
  v_amount      bigint;
  v_abs_total   bigint := 0;
  v_diff        bigint;
  v_allowance   bigint;
  v_threshold   bigint;
begin
  -- (0) Shape checks before anything is written.
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'GL_TOO_FEW_LINES: an entry needs at least two lines; double-entry is not optional'
      using errcode = 'raise_exception';
  end if;

  select * into v_entity from public.gl_entities where code = lower(btrim(coalesce(p_entity_code, '')));
  if not found then
    raise exception 'GL_UNKNOWN_ENTITY: there is no set of books called %', coalesce(p_entity_code, '(null)')
      using errcode = 'raise_exception';
  end if;

  -- (1) Idempotency. A machine-sourced entry MUST be replay-safe; a hand-keyed
  --     manual entry has no external event to key on and is allowed through
  --     without one.
  if p_source_ref is not null and btrim(p_source_ref) <> '' then
    v_key := public.gl_idempotency_key(v_entity.code, p_source_kind, p_source_ref);
  elsif p_source_kind <> 'manual' and p_auto_post then
    raise exception 'GL_NO_IDEMPOTENCY_KEY: an automatic % entry must carry a source reference, otherwise a retry would post the same money twice', p_source_kind
      using errcode = 'raise_exception';
  end if;

  v_fingerprint := public.gl_line_fingerprint(p_lines);

  if v_key is not null then
    select * into v_existing from public.gl_journals where idempotency_key = v_key;
    if found then
      if v_existing.line_fingerprint is not distinct from v_fingerprint then
        -- Same event, same content: hand back the original and write nothing.
        return jsonb_build_object(
          'journal_id',  v_existing.id,
          'journal_no',  v_existing.journal_no,
          'status',      v_existing.status,
          'outcome',     'duplicate',
          'disposition', case when v_existing.status = 'draft' then 'draft' else 'posted' end,
          'code',        'GL_DUPLICATE_IGNORED'
        );
      end if;
      -- Same event, DIFFERENT content. Returning the original would hide it;
      -- posting the new one would double-count it. Both are drift.
      raise exception 'GL_POST_CONFLICT: % has already been recorded with different amounts or accounts. Nothing has been changed. Compare the two and reverse the original if it was wrong.', v_key
        using errcode = 'raise_exception';
    end if;
  end if;

  -- (2) Create the draft header.
  insert into public.gl_journals
    (entity_id, journal_date, status, source_kind, source_ref, memo,
     assumption_note, intercompany_ref, idempotency_key, line_fingerprint, created_by)
  values
    (v_entity.id, p_journal_date, 'draft', p_source_kind, p_source_ref, p_memo,
     p_assumption_note, p_intercompany_ref, v_key, v_fingerprint, auth.uid())
  returning id into v_journal_id;

  -- (3) Lines. Account codes are resolved here so callers never handle uuids,
  --     and an unknown code is a hard failure rather than a skipped line.
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_line_no := v_line_no + 1;

    select * into v_account
    from public.gl_accounts
    where code = btrim(coalesce(v_line->>'account_code', ''));

    if not found then
      raise exception 'GL_UNKNOWN_ACCOUNT: line % refers to account %, which is not in the chart of accounts', v_line_no, coalesce(v_line->>'account_code', '(null)')
        using errcode = 'raise_exception';
    end if;

    begin
      v_amount := (v_line->>'amount_cents')::bigint;
    exception when others then
      raise exception 'GL_BAD_AMOUNT: line % has an amount that is not a whole number of cents (%)', v_line_no, coalesce(v_line->>'amount_cents', '(null)')
        using errcode = 'raise_exception';
    end;

    v_abs_total := v_abs_total + abs(v_amount);

    insert into public.gl_journal_lines
      (journal_id, line_no, account_id, entity_id, amount_cents, cost_class, description)
    values
      (v_journal_id, v_line_no, v_account.id, v_entity.id, v_amount,
       coalesce(nullif(btrim(coalesce(v_line->>'cost_class', '')), ''), 'none'),
       v_line->>'description');
  end loop;

  -- Total DEBIT value of the entry: half the sum of absolute values, since a
  -- balanced entry's debits and credits are equal in magnitude.
  v_abs_total := v_abs_total / 2;

  -- (4) If the caller did not ask to post, we are done: a draft, waiting for a
  --     human. This is the default and always the safe answer.
  --
  --     THE VESTIBULE. The draft is told, right now, whether it will need a
  --     second approver, so a large entry cannot sit in a queue looking ready
  --     and then surprise someone at posting time. This is advisory only — the
  --     BEFORE UPDATE trigger in §8b is what actually enforces it — but a
  --     control nobody can see coming gets routed around, and one that is
  --     announced early gets obeyed.
  if not p_auto_post then
    select coalesce(threshold_cents, 500000) into v_threshold
    from public.gl_approval_policy where entity_id = v_entity.id;

    return jsonb_build_object(
      'journal_id', v_journal_id, 'journal_no', null, 'status', 'draft',
      'outcome', 'created', 'disposition', 'draft', 'code', 'GL_DRAFT_CREATED',
      'total_cents', v_abs_total,
      'needs_second_approver',
        (v_threshold is not null
         and v_abs_total >= v_threshold
         and p_source_kind not in ('pos_sale','excise','purchase','bank','reversal'))
    );
  end if;

  -- (5) AUTOMATION RE-DERIVED SERVER-SIDE. The caller's flag got us here; these
  --     checks decide. Every one of them raises rather than silently downgrading
  --     to a draft, because a caller that asked to post and got a draft without
  --     being told would leave entries sitting unnoticed.
  if p_source_kind not in ('pos_sale','excise','purchase','bank') then
    raise exception 'GL_AUTOPOST_NOT_ELIGIBLE: % entries are never posted automatically; they are estimates, allocations or judgments and always get a human review', p_source_kind
      using errcode = 'raise_exception';
  end if;

  if p_source_kind = 'purchase' and coalesce(p_three_way_matched, false) is not true then
    raise exception 'GL_AUTOPOST_NO_THREE_WAY_MATCH: a bill posts itself only when the purchase order, the goods receipt and the invoice all agree'
      using errcode = 'raise_exception';
  end if;

  if p_template_code is null or btrim(p_template_code) = '' then
    raise exception 'GL_AUTOPOST_NO_TEMPLATE: nothing posts automatically without a template approved in advance'
      using errcode = 'raise_exception';
  end if;

  select * into v_tpl from public.gl_posting_templates where code = btrim(p_template_code);
  if not found then
    raise exception 'GL_AUTOPOST_NO_TEMPLATE: there is no posting template called %', p_template_code
      using errcode = 'raise_exception';
  end if;
  if v_tpl.entity_id <> v_entity.id then
    raise exception 'GL_AUTOPOST_WRONG_ENTITY: template % belongs to a different set of books', v_tpl.code
      using errcode = 'raise_exception';
  end if;
  if v_tpl.source_kind <> p_source_kind then
    raise exception 'GL_AUTOPOST_WRONG_SOURCE_KIND: template % is for % entries, not % entries', v_tpl.code, v_tpl.source_kind, p_source_kind
      using errcode = 'raise_exception';
  end if;
  if not v_tpl.is_active then
    raise exception 'GL_AUTOPOST_TEMPLATE_INACTIVE: template % is switched off', v_tpl.code
      using errcode = 'raise_exception';
  end if;
  if v_tpl.approved_by is null or v_tpl.approved_at is null then
    raise exception 'GL_AUTOPOST_TEMPLATE_UNAPPROVED: template % has never been approved and cannot post anything by itself', v_tpl.code
      using errcode = 'raise_exception';
  end if;
  if p_journal_date < v_tpl.effective_from then
    raise exception 'GL_AUTOPOST_TEMPLATE_NOT_YET_EFFECTIVE: template % does not take effect until %', v_tpl.code, v_tpl.effective_from
      using errcode = 'raise_exception';
  end if;
  if v_tpl.effective_to is not null and p_journal_date > v_tpl.effective_to then
    raise exception 'GL_AUTOPOST_TEMPLATE_EXPIRED: template % expired on %', v_tpl.code, v_tpl.effective_to
      using errcode = 'raise_exception';
  end if;

  if v_abs_total > v_tpl.max_autopost_cents then
    raise exception 'GL_AUTOPOST_OVER_LIMIT: this entry (% cents) is larger than the ceiling of % cents set on template %', v_abs_total, v_tpl.max_autopost_cents, v_tpl.code
      using errcode = 'raise_exception';
  end if;

  -- Tolerance. Integer arithmetic throughout: bigint multiplication in
  -- PostgreSQL is exact, and the division floors, so an allowance never rounds
  -- UP and a variance one cent over the line is refused rather than generously
  -- admitted. (Mirrors isWithinTolerance() in posting-core.ts.)
  if p_expected_cents is not null then
    v_diff      := abs(v_abs_total - abs(p_expected_cents));
    v_allowance := (abs(p_expected_cents) * v_tpl.tol_milli_pct) / 100000;
    if v_diff > v_tpl.tol_abs_cents and v_diff > v_allowance then
      raise exception 'GL_AUTOPOST_OUT_OF_TOLERANCE: expected % cents but got % cents, a difference of % which is outside the tolerance on template %', abs(p_expected_cents), v_abs_total, v_diff, v_tpl.code
        using errcode = 'raise_exception';
    end if;
  end if;

  -- (6) Post it through the SAME gate every other entry goes through. Nothing
  --     here bypasses gl_post_journal's balance, entity, account, control-account,
  --     280E and period checks.
  v_no := public.gl_post_journal(v_journal_id);

  insert into public.gl_audit_events (event_kind, entity_id, journal_id, actor, detail)
  values ('journal_autoposted', v_entity.id, v_journal_id, auth.uid(),
          format('auto-posted journal #%s via template %s (%s cents)', v_no, v_tpl.code, v_abs_total));

  return jsonb_build_object(
    'journal_id', v_journal_id, 'journal_no', v_no, 'status', 'posted',
    'outcome', 'created', 'disposition', 'posted', 'code', 'GL_AUTOPOST_OK'
  );
end $$;

comment on function public.gl_submit_journal(text, date, text, text, text, jsonb, text, bigint, boolean, text, uuid, boolean) is
  'THE ONE DOOR into the ledger. Idempotent by source event, atomic, and it re-derives every automation decision from the template rows rather than trusting the caller. Returns jsonb describing what happened.';

-- -----------------------------------------------------------------------------
-- 7) gl_submit_intercompany_pair — both halves or neither.
-- -----------------------------------------------------------------------------
-- The $2,000/month Geiger rent is income in landholding and expense in greenway.
-- If only one half lands, the combined statements no longer eliminate and the
-- books have silently drifted. PL/pgSQL functions run inside the caller's
-- transaction, so an exception in the second half rolls back the first.
--
-- Note that this NEVER auto-posts: both halves are created as drafts, because
-- intercompany is a judgment call (roughly 24 entries a year — automating it
-- would save minutes and risk the balance sheet).
-- -----------------------------------------------------------------------------
create or replace function public.gl_submit_intercompany_pair(
  p_ref              uuid,
  p_journal_date     date,
  p_memo             text,
  p_entity_a         text,
  p_lines_a          jsonb,
  p_source_ref_a     text,
  p_entity_b         text,
  p_lines_b          jsonb,
  p_source_ref_b     text,
  p_assumption_note  text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_a jsonb;
  v_b jsonb;
begin
  if p_ref is null then
    raise exception 'GL_INTERCOMPANY_NO_REF: both halves of an intercompany transfer must share a reference so they can always be tied back together'
      using errcode = 'raise_exception';
  end if;
  if lower(btrim(coalesce(p_entity_a, ''))) = lower(btrim(coalesce(p_entity_b, ''))) then
    raise exception 'GL_INTERCOMPANY_SAME_ENTITY: an intercompany transfer needs two different sets of books'
      using errcode = 'raise_exception';
  end if;

  v_a := public.gl_submit_journal(
    p_entity_a, p_journal_date, 'intercompany', p_source_ref_a, p_memo, p_lines_a,
    null, null, false, p_assumption_note, p_ref, false);

  v_b := public.gl_submit_journal(
    p_entity_b, p_journal_date, 'intercompany', p_source_ref_b, p_memo, p_lines_b,
    null, null, false, p_assumption_note, p_ref, false);

  return jsonb_build_object('intercompany_ref', p_ref, 'half_a', v_a, 'half_b', v_b);
end $$;

comment on function public.gl_submit_intercompany_pair(uuid, date, text, text, jsonb, text, text, jsonb, text, text) is
  'Creates both halves of an intercompany transfer as drafts in one transaction. If either half fails, neither exists.';

-- -----------------------------------------------------------------------------
-- 8) Readiness view — MEASURES, never applies.
-- -----------------------------------------------------------------------------
-- Michael asked for tolerances that relax once the system has learned the
-- patterns. This view is that idea with the trigger left in human hands: it
-- reports how a template has actually performed so he can decide. Widening a
-- tolerance still means updating the row, with a reason, which lands in
-- gl_template_changes forever.
create or replace view public.gl_template_readiness as
select
  t.id,
  t.code,
  e.code                                             as entity_code,
  t.source_kind,
  t.tol_abs_cents,
  t.tol_milli_pct,
  t.max_autopost_cents,
  count(j.id)                                        as entries_posted,
  count(distinct date_trunc('month', j.journal_date)) as distinct_months,
  min(j.journal_date)                                as first_entry,
  max(j.journal_date)                                as last_entry
from public.gl_posting_templates t
join public.gl_entities e on e.id = t.entity_id
left join public.gl_journals j
  on j.entity_id = t.entity_id
 and j.source_kind = t.source_kind
 and j.status = 'posted'
group by t.id, t.code, e.code, t.source_kind, t.tol_abs_cents, t.tol_milli_pct, t.max_autopost_cents;

comment on view public.gl_template_readiness is
  'How each posting template has actually performed. Deliberately read-only and advisory: no code anywhere widens a tolerance from this. A system that relaxes its own controls on the strength of its own record is grading its own homework.';

-- -----------------------------------------------------------------------------
-- 8b) THE BOUNCER — segregation of duties on the manual-posting path.
-- -----------------------------------------------------------------------------
-- THE GAP THIS CLOSES. §5 of gl_submit_journal guards the AUTOMATIC path
-- exhaustively. The MANUAL path had no such guard: any draft, of any size, could
-- be posted by calling gl_post_journal directly, by the same person who wrote
-- it, with no second pair of eyes. requiresSecondApprover() existed in
-- posting-core.ts and NOTHING CALLED IT — a rule that lives only in TypeScript
-- that nobody invokes is not a control, it is a comment.
--
-- Self-review is the classic material weakness: the person who writes the entry
-- should not be the person who blesses it, above some threshold. Below the
-- threshold, requiring a second human on every $12 utility bill would make the
-- books unusable and the control would be routed around within a week — a
-- control that is too expensive to obey is not a control either.
--
-- So: a money threshold per entity, defaulting to $5,000.00, and above it a
-- posted entry needs an approver who is NOT its author.

create table if not exists public.gl_approval_policy (
  entity_id            uuid primary key references public.gl_entities(id) on delete restrict,

  -- Entries at or above this DEBIT total need a second person. Zero would mean
  -- "everything needs two people", which is legitimate but must be deliberate.
  threshold_cents      bigint not null default 500000 check (threshold_cents >= 0),

  -- The escape hatch, and it is deliberately narrow. A sole operator genuinely
  -- may have nobody else to ask; Greenway is Michael, his mother and his
  -- grandfather. Turning this on is a decision that gets a reason and an audit
  -- row, not a silent default.
  allow_self_approval  boolean not null default false,
  self_approval_reason text,

  change_reason        text not null check (length(btrim(change_reason)) >= 10),
  updated_by           uuid references auth.users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- If you claim you may approve your own work, you must say why, in writing.
  constraint gl_approval_policy_self_needs_reason
    check (allow_self_approval = false
           or (self_approval_reason is not null
               and length(btrim(self_approval_reason)) >= 20))
);

comment on table public.gl_approval_policy is
  'Per-entity segregation of duties. Above threshold_cents a posted entry needs an approver who is not its author. Self-approval is possible but must be switched on deliberately and explained in writing.';

alter table public.gl_journals
  add column if not exists approved_by uuid references auth.users(id);
alter table public.gl_journals
  add column if not exists approved_at timestamptz;
alter table public.gl_journals
  add column if not exists approval_note text;

-- Approval is all-or-nothing, exactly as it is for templates.
alter table public.gl_journals
  drop constraint if exists gl_journals_approval_pairing;
alter table public.gl_journals
  add constraint gl_journals_approval_pairing
  check ( (approved_by is null and approved_at is null)
          or (approved_by is not null and approved_at is not null) );

-- Seed a policy row for every entity that lacks one. Idempotent: existing rows,
-- including any threshold Michael has since changed by hand, are left alone.
insert into public.gl_approval_policy (entity_id, threshold_cents, change_reason)
select e.id, 500000, 'Initial policy seeded by migration 0174: entries of $5,000.00 or more require a second approver.'
from public.gl_entities e
where not exists (select 1 from public.gl_approval_policy p where p.entity_id = e.id);

drop trigger if exists trg_gl_approval_policy_updated_at on public.gl_approval_policy;
create trigger trg_gl_approval_policy_updated_at
  before update on public.gl_approval_policy
  for each row execute function public.set_updated_at();

-- gl_approve_journal — the ONLY way a draft gets blessed.
create or replace function public.gl_approve_journal(
  p_journal_id uuid,
  p_note       text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  j        public.gl_journals%rowtype;
  v_pol    public.gl_approval_policy%rowtype;
  v_total  bigint;
  v_actor  uuid := auth.uid();
begin
  select * into j from public.gl_journals where id = p_journal_id for update;
  if not found then
    raise exception 'GL_NOT_FOUND: journal % does not exist', p_journal_id
      using errcode = 'no_data_found';
  end if;
  if j.status <> 'draft' then
    raise exception 'GL_ALREADY_POSTED: journal % has status %; only a draft can be approved', j.id, j.status
      using errcode = 'raise_exception';
  end if;

  -- AN ANONYMOUS APPROVAL IS NOT AN APPROVAL. Segregation of duties is a claim
  -- about WHO, so an unattributable blessing is worthless: it cannot be compared
  -- against the author, and an auditor cannot ask the approver what they checked.
  -- Found by the adversarial suite, which ran with no session user and watched
  -- this function try to write a null approver.
  if v_actor is null then
    raise exception 'GL_NO_APPROVER_IDENTITY: nobody is signed in, so this approval could not be attributed to a person. An approval nobody can be held to is not an approval.'
      using errcode = 'raise_exception';
  end if;

  select coalesce(sum(abs(amount_cents)), 0) / 2 into v_total
  from public.gl_journal_lines where journal_id = j.id;

  select * into v_pol from public.gl_approval_policy where entity_id = j.entity_id;

  -- A missing policy row must FAIL CLOSED. The absent case is the one an
  -- attacker (or a future migration that adds an entity) would rely on.
  if not found then
    raise exception 'GL_NO_APPROVAL_POLICY: no approval policy exists for this set of books, so nothing can be approved until one is set'
      using errcode = 'raise_exception';
  end if;

  if v_total >= v_pol.threshold_cents
     and j.created_by is not null
     and v_actor is not null
     and j.created_by = v_actor
     and not v_pol.allow_self_approval then
    raise exception 'GL_SELF_APPROVAL_REFUSED: this entry is % cents, at or above the % cent threshold for these books, so it needs a second pair of eyes. The person who wrote an entry cannot be the person who approves it.', v_total, v_pol.threshold_cents
      using errcode = 'raise_exception';
  end if;

  update public.gl_journals
  set approved_by = v_actor, approved_at = now(),
      approval_note = p_note, updated_at = now()
  where id = j.id;

  insert into public.gl_audit_events (event_kind, entity_id, journal_id, actor, detail)
  values ('journal_approved', j.entity_id, j.id, v_actor,
          format('approved %s cents (threshold %s)', v_total, v_pol.threshold_cents));
end $$;

comment on function public.gl_approve_journal(uuid, text) is
  'Blesses a draft. Refuses when the approver is the author and the entry is at or above the entity threshold, unless self-approval has been deliberately switched on with a written reason.';

-- THE ENFORCEMENT POINT. A BEFORE UPDATE trigger on gl_journals, so the rule
-- binds no matter which function does the posting — gl_post_journal,
-- gl_submit_journal, or anything written years from now. Placing it here rather
-- than inside gl_post_journal is the whole point: this cannot be bypassed by a
-- future caller that forgets to check.
create or replace function public.gl_guard_journal_approval()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_pol   public.gl_approval_policy%rowtype;
  v_total bigint;
begin
  -- Only the draft -> posted transition is policed.
  if not (old.status = 'draft' and new.status = 'posted') then
    return new;
  end if;

  -- Machine-derived entries that came through the automatic path already passed
  -- §5: an approved, active, in-window template with a ceiling and a tolerance
  -- IS the approval, granted in advance by a human. Requiring a click per POS
  -- sale would defeat the automation entirely.
  if new.source_kind in ('pos_sale','excise','purchase','bank') then
    return new;
  end if;

  -- A reversal must never be blocked: refusing to let someone undo a bad entry
  -- would turn this control into a trap that PRESERVES an error.
  if new.source_kind = 'reversal' then
    return new;
  end if;

  select coalesce(sum(abs(amount_cents)), 0) / 2 into v_total
  from public.gl_journal_lines where journal_id = new.id;

  select * into v_pol from public.gl_approval_policy where entity_id = new.entity_id;
  if not found then
    raise exception 'GL_NO_APPROVAL_POLICY: no approval policy exists for this set of books, so nothing can be posted until one is set'
      using errcode = 'raise_exception';
  end if;

  if v_total < v_pol.threshold_cents then
    return new;
  end if;

  if new.approved_by is null then
    raise exception 'GL_APPROVAL_REQUIRED: this entry is % cents, at or above the % cent threshold for these books, and has not been approved. Have someone approve it first.', v_total, v_pol.threshold_cents
      using errcode = 'raise_exception';
  end if;

  if new.created_by is not null
     and new.approved_by = new.created_by
     and not v_pol.allow_self_approval then
    raise exception 'GL_SELF_APPROVAL_REFUSED: this entry was written and approved by the same person, and at % cents it is at or above the % cent threshold. Segregation of duties requires a second pair of eyes.', v_total, v_pol.threshold_cents
      using errcode = 'raise_exception';
  end if;

  return new;
end $$;

drop trigger if exists trg_gl_guard_journal_approval on public.gl_journals;
create trigger trg_gl_guard_journal_approval
  before update on public.gl_journals
  for each row execute function public.gl_guard_journal_approval();

-- -----------------------------------------------------------------------------
-- 8c) COMPLETING THE REVERSAL LOOP — a defect in 0172, found by execution.
-- -----------------------------------------------------------------------------
-- WHAT WAS WRONG. 0172 declared gl_journals.reversed_by_journal_id and
-- gl_reverse_journal READS it to refuse a second reversal:
--
--     if j.reversed_by_journal_id is not null then
--       raise exception 'GL_ALREADY_REVERSED: ...'
--
-- ...but NOTHING EVER WRITES THAT COLUMN. The guard therefore can never fire,
-- and the original never leaves 'posted'. Proven against real PostgreSQL, not
-- inferred: a $10.00 sale was posted, reversed, and then reversed AGAIN, and
-- the second reversal was accepted. Cash finished at -1,000 cents and revenue
-- at 1,000 cents that no customer ever paid.
--
-- WHY IT MATTERS. This is exactly the shape of the drift already in the Sage
-- data: negative inventory and negative ATM cash are what phantom entries look
-- like after a year. Reversing twice is not exotic — it is what a careful person
-- does when they are unsure the first correction went through.
--
-- Fixed here because 0174 is the door and Michael has not yet applied it.
-- 0172's immutability guard already permits this exact write (it explicitly
-- allows "the reversal-linkage bookkeeping and the posted->reversed flip"), so
-- the wiring was simply never completed.

create or replace function public.gl_mark_reversed()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_orig public.gl_journals%rowtype;
begin
  -- Only when a REVERSAL entry itself becomes posted.
  if not (old.status = 'draft' and new.status = 'posted') then
    return new;
  end if;
  if new.reverses_journal_id is null then
    return new;
  end if;

  select * into v_orig from public.gl_journals
   where id = new.reverses_journal_id for update;
  if not found then
    return new;
  end if;

  -- Belt and braces: if the original is already linked to a different
  -- reversal, refuse rather than overwrite the link and lose the history.
  if v_orig.reversed_by_journal_id is not null
     and v_orig.reversed_by_journal_id <> new.id then
    raise exception 'GL_ALREADY_REVERSED: journal % was already reversed by %; it cannot be reversed twice', v_orig.id, v_orig.reversed_by_journal_id
      using errcode = 'raise_exception';
  end if;

  update public.gl_journals
     set reversed_by_journal_id = new.id,
         status                 = 'reversed',
         updated_at             = now()
   where id = v_orig.id;

  return new;
end $$;

comment on function public.gl_mark_reversed() is
  'Closes the reversal loop 0172 left open: when a reversal posts, the original is linked and flipped to reversed, so gl_reverse_journal''s GL_ALREADY_REVERSED guard can actually fire. Without this a journal could be reversed repeatedly, inventing money.';

drop trigger if exists trg_gl_mark_reversed on public.gl_journals;
create trigger trg_gl_mark_reversed
  after update on public.gl_journals
  for each row execute function public.gl_mark_reversed();

-- -----------------------------------------------------------------------------
-- 9) Row-level security — the books remain admin-only.
-- -----------------------------------------------------------------------------
alter table public.gl_posting_templates enable row level security;
alter table public.gl_template_changes  enable row level security;

drop policy if exists gl_posting_templates_admin_all on public.gl_posting_templates;
create policy gl_posting_templates_admin_all on public.gl_posting_templates
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists gl_template_changes_admin_all on public.gl_template_changes;
create policy gl_template_changes_admin_all on public.gl_template_changes
  for all using (public.is_admin()) with check (public.is_admin());

alter table public.gl_approval_policy enable row level security;

drop policy if exists gl_approval_policy_admin_all on public.gl_approval_policy;
create policy gl_approval_policy_admin_all on public.gl_approval_policy
  for all using (public.is_admin()) with check (public.is_admin());
