-- =============================================================================
-- 0177_owner_override.sql   (slice F6)
--
-- THE SOLE-OPERATOR OVERRIDE.
--
-- WHY THIS EXISTS
-- 0174 built segregation of duties: above $5,000.00 an entry needs an approver
-- who is not its author. That is the correct default and it stays. But Greenway
-- is one owner doing all of the administrative work, with eight employees who do
-- not touch the books. Under 0174 as written, NOBODY could approve the opening
-- balances. The control did not protect the business, it locked the business out
-- of its own ledger — and a control that cannot be obeyed gets routed around
-- within a week, which is worse than no control at all.
--
-- WHAT THE OWNER DECIDED (recorded verbatim, standing rule 12)
--   "I think a one time approval for beginning balances is acceptable. I would
--    also like an over ride for my self. I won't be having anyone else help me
--    with admin activities, and so I would rather have the ability to check my
--    own work... I agree with segregation of duties typically, just not in this
--    case where it's a one man job done by the one owner."
--
-- THE PROFESSIONAL POSITION I TOOK
-- I did not simply switch the control off, and here is the reasoning, because it
-- is the whole point of this migration:
--
-- An override that leaves no trace is indistinguishable from having no control.
-- If the books are ever examined, "the owner approved his own entries" is a
-- finding. "The owner approved his own entries, and here is every one of them,
-- with the date, the amount, and his written reason at the moment he did it" is
-- a DOCUMENTED CONTROL ENVIRONMENT for a single-member business. The IRS and any
-- auditor see sole proprietors self-approve constantly; what they punish is
-- self-approval that cannot be RECONSTRUCTED.
--
-- So the override is granted in full, exactly as asked, and every use of it is
-- recorded. This is not friction for its own sake. It is the difference between
-- an explanation and an admission.
--
-- WHAT THIS MIGRATION DOES
--   1. Adds the audit event kinds this slice records.
--   2. gl_override_log — an append-only record of every override actually USED.
--      Not the policy, the USES. Nothing may update or delete a row in it.
--   3. Extends gl_approval_policy with owner_override_enabled + its reason.
--   4. Teaches gl_approve_journal to honour the override AND log each use.
--   5. Teaches the posting trigger the same, so the rule cannot be walked around
--      by updating gl_journals directly.
--   6. Exempts opening_balance from second-approver entirely (the one-time
--      cut-over the owner prepares personally from Sage statements).
--   7. gl_set_owner_override() — the only supported way to turn it on or off,
--      admin-only, reason mandatory, every change audited.
--   8. gl_override_report() — plain-English "here is every time I overrode the
--      books", which is the artefact that makes the override defensible.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
-- It does not weaken the DOUBLE-ENTRY rules, the line in the sand, the period
-- locks, or the reversal-only correction path. The owner asked to be able to
-- approve his own work, not to be able to write books that do not balance.
-- Those refusals stay absolute, because they protect him from mistakes rather
-- than from other people.
--
-- IDEMPOTENT. Applied by hand in the SQL editor, where there is NO logged-in
-- user, so nothing here may call an admin-guarded, user-facing function.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Audit event kinds.
-- -----------------------------------------------------------------------------
-- Same pattern 0174 used: drop by both possible names, recreate with a stable
-- one, so this block is safely repeatable. The full list must be restated
-- because a CHECK constraint cannot be appended to.
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
                        'approval_policy_changed',
                        -- new in 0177
                        'owner_override_used',
                        'owner_override_enabled',
                        'owner_override_disabled'));


-- -----------------------------------------------------------------------------
-- 2) gl_override_log — every USE of the override, append-only.
-- -----------------------------------------------------------------------------
-- gl_audit_events already records a great deal. This table exists separately and
-- deliberately: it is the SHORT list. When someone asks "when did you approve
-- your own work and why", the answer must be one small table that can be read
-- end to end in a minute, not a filter across thousands of routine posting
-- events. An artefact nobody can read is not evidence.
create table if not exists public.gl_override_log (
  id             uuid primary key default gen_random_uuid(),

  entity_id      uuid not null references public.gl_entities(id) on delete restrict,
  journal_id     uuid references public.gl_journals(id) on delete set null,

  -- What was overridden. Kept as free-ish text with a closed list so the report
  -- can group it, but new kinds can be added by a later migration.
  override_kind  text not null
                   check (override_kind in ('self_approval',
                                            'opening_balance_self_approval',
                                            'threshold_bypass')),

  -- The money involved, so the report can be read without joining anything.
  amount_cents   bigint not null,
  threshold_cents bigint not null,

  -- WHO. An override nobody can be held to is not an override, it is a hole.
  actor          uuid not null references auth.users(id),

  -- WHY. This is the field that turns a finding into an explanation. It is not
  -- optional and it cannot be a shrug: ten characters minimum, same bar 0174
  -- set for changing the approval policy itself.
  reason         text not null check (length(btrim(reason)) >= 10),

  created_at     timestamptz not null default now()
);

comment on table public.gl_override_log is
  'Append-only record of every time the owner override was actually USED to approve or post an entry that segregation of duties would otherwise have refused. Rows can never be changed or deleted. This is the artefact that makes sole-operator self-approval defensible rather than invisible.';

create index if not exists idx_gl_override_log_created
  on public.gl_override_log (created_at desc);
create index if not exists idx_gl_override_log_entity
  on public.gl_override_log (entity_id, created_at desc);

-- APPEND-ONLY, ENFORCED.
-- A log that can be edited after the fact is worth nothing — it would let the
-- record be tidied up precisely when it matters most. This is the same stance
-- 0176 takes on posted opening balance rows.
create or replace function public.gl_override_log_is_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'GL_OVERRIDE_LOG_APPEND_ONLY: the override log records what was actually done and can never be edited or deleted. If an override was a mistake, reverse the journal — that correction is itself part of the record.'
    using errcode = 'raise_exception';
end $$;

drop trigger if exists trg_gl_override_log_no_update on public.gl_override_log;
create trigger trg_gl_override_log_no_update
  before update or delete on public.gl_override_log
  for each row execute function public.gl_override_log_is_append_only();


-- -----------------------------------------------------------------------------
-- 3) The policy gains an explicit owner override.
-- -----------------------------------------------------------------------------
-- WHY A SECOND FLAG RATHER THAN REUSING allow_self_approval.
-- 0174's allow_self_approval means "self-approval is permitted". The owner asked
-- for something broader and more deliberate: a standing executive override that
-- is KNOWN to be on, is REPORTED on, and whose every use is logged. Reusing the
-- old flag would have made "quietly permitted" and "deliberately overridden"
-- indistinguishable in the data, and those are different facts about the books.
alter table public.gl_approval_policy
  add column if not exists owner_override_enabled boolean not null default false;
alter table public.gl_approval_policy
  add column if not exists owner_override_reason text;
alter table public.gl_approval_policy
  add column if not exists owner_override_set_by uuid references auth.users(id);
alter table public.gl_approval_policy
  add column if not exists owner_override_set_at timestamptz;

-- Claiming the override requires saying why, in writing, at length. Twenty
-- characters is the same bar 0174 set for self_approval_reason.
alter table public.gl_approval_policy
  drop constraint if exists gl_approval_policy_override_needs_reason;
alter table public.gl_approval_policy
  add constraint gl_approval_policy_override_needs_reason
  check (owner_override_enabled = false
         or (owner_override_reason is not null
             and length(btrim(owner_override_reason)) >= 20));

comment on column public.gl_approval_policy.owner_override_enabled is
  'When true, the owner may approve entries he wrote himself, at any amount. Every use is written to gl_override_log. Granted deliberately for a single-operator business; it is not a default.';


-- -----------------------------------------------------------------------------
-- 4) Turning the override on and off — the ONLY supported way.
-- -----------------------------------------------------------------------------
-- Admin-only, reason mandatory, audited both ways. Turning a control OFF and
-- turning it back ON are equally significant events and both are recorded.
create or replace function public.gl_set_owner_override(
  p_entity_code text,
  p_enabled     boolean,
  p_reason      text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity public.gl_entities%rowtype;
  v_actor  uuid := auth.uid();
  v_was    boolean;
begin
  if not public.is_admin() then
    raise exception 'GL_FORBIDDEN: only an admin may change the approval override.'
      using errcode = 'insufficient_privilege';
  end if;

  -- An override granted by nobody is not a grant. Same reasoning as
  -- GL_NO_APPROVER_IDENTITY in 0174: this is a claim about WHO.
  if v_actor is null then
    raise exception 'GL_NO_ACTOR: changing the approval override must be done by a signed-in human, because the record has to name who decided it.'
      using errcode = 'raise_exception';
  end if;

  if p_enabled and (p_reason is null or length(btrim(p_reason)) < 20) then
    raise exception 'GL_OVERRIDE_REASON_REQUIRED: switching on the owner override needs a written reason of at least 20 characters. This is the sentence an examiner will read first.'
      using errcode = 'raise_exception';
  end if;

  select * into v_entity from public.gl_entities
   where code = btrim(coalesce(p_entity_code,''));
  if not found then
    raise exception 'GL_UNKNOWN_ENTITY: there is no set of books called %',
      coalesce(p_entity_code,'(null)')
      using errcode = 'raise_exception';
  end if;

  select owner_override_enabled into v_was
    from public.gl_approval_policy where entity_id = v_entity.id;
  if not found then
    raise exception 'GL_NO_APPROVAL_POLICY: no approval policy exists for these books, so there is nothing to override yet.'
      using errcode = 'raise_exception';
  end if;

  update public.gl_approval_policy
     set owner_override_enabled = p_enabled,
         owner_override_reason  = case when p_enabled then btrim(p_reason) else owner_override_reason end,
         owner_override_set_by  = v_actor,
         owner_override_set_at  = now(),
         change_reason          = case
                                    when p_enabled
                                    then 'Owner override enabled: ' || btrim(p_reason)
                                    else 'Owner override disabled: ' ||
                                         coalesce(nullif(btrim(coalesce(p_reason,'')), ''),
                                                  'returned to standard segregation of duties')
                                  end,
         updated_by             = v_actor
   where entity_id = v_entity.id;

  insert into public.gl_audit_events (event_kind, entity_id, actor, detail)
  values (case when p_enabled then 'owner_override_enabled' else 'owner_override_disabled' end,
          v_entity.id, v_actor,
          case when p_enabled
               then 'Owner override ON for ' || v_entity.code || ': ' || btrim(p_reason)
               else 'Owner override OFF for ' || v_entity.code end);

  return jsonb_build_object(
    'outcome',  case when p_enabled then 'override_enabled' else 'override_disabled' end,
    'entity',   v_entity.code,
    'was_enabled', v_was,
    'now_enabled', p_enabled,
    'message',  case when p_enabled
                     then 'Owner override is ON for ' || v_entity.name ||
                          '. You may now approve your own entries at any amount. Every time you do, it is recorded in the override log with your reason.'
                     else 'Owner override is OFF for ' || v_entity.name ||
                          '. Entries at or above the threshold now need a second approver again.' end);
end $$;

comment on function public.gl_set_owner_override(text, boolean, text) is
  'The only supported way to switch the owner override on or off. Admin-only, a written reason is required to enable it, and both directions are audited.';


-- -----------------------------------------------------------------------------
-- 5) gl_approve_journal — honour the override, and LOG EVERY USE.
-- -----------------------------------------------------------------------------
-- This replaces 0174's version. The body is 0174's, unchanged, except for the
-- self-approval decision, which now has three ways to be allowed instead of one,
-- and which records the fact when it is used.
create or replace function public.gl_approve_journal(
  p_journal_id uuid,
  p_note       text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  j          public.gl_journals%rowtype;
  v_pol      public.gl_approval_policy%rowtype;
  v_total    bigint;
  v_actor    uuid := auth.uid();
  v_is_self  boolean;
  v_over_thr boolean;
  v_kind     text;
  v_reason   text;
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

  -- AN ANONYMOUS APPROVAL IS NOT AN APPROVAL. Unchanged from 0174, and it stays
  -- absolute: the override is about WHICH human may approve, never about whether
  -- a human is identified at all.
  if v_actor is null then
    raise exception 'GL_NO_APPROVER_IDENTITY: nobody is signed in, so this approval could not be attributed to a person. An approval nobody can be held to is not an approval.'
      using errcode = 'raise_exception';
  end if;

  select coalesce(sum(abs(amount_cents)), 0) / 2 into v_total
  from public.gl_journal_lines where journal_id = j.id;

  select * into v_pol from public.gl_approval_policy where entity_id = j.entity_id;
  if not found then
    raise exception 'GL_NO_APPROVAL_POLICY: no approval policy exists for this set of books, so nothing can be approved until one is set'
      using errcode = 'raise_exception';
  end if;

  v_is_self  := (j.created_by is not null and j.created_by = v_actor);
  v_over_thr := (v_total >= v_pol.threshold_cents);

  if v_is_self and v_over_thr then
    -- THE DECISION. Three distinct ways this is permitted, and they are NOT the
    -- same fact, so each is recorded under its own name.
    if j.source_kind = 'opening_balance' then
      -- (a) The one-time cut-over. The owner prepares it personally from Sage
      --     statements, every line carries its own evidence, and it is reviewed
      --     as a whole before it posts. Requiring a second approver here would
      --     block the single entry the entire ledger is built on.
      v_kind   := 'opening_balance_self_approval';
      v_reason := 'One-time opening balance cut-over, prepared and reviewed by the owner from source statements. Every line carries its own evidence reference.';

    elsif v_pol.owner_override_enabled then
      -- (b) The standing executive override. Granted deliberately.
      v_kind   := 'self_approval';
      v_reason := coalesce(nullif(btrim(coalesce(p_note,'')), ''),
                           v_pol.owner_override_reason,
                           'Owner override: sole operator, no second approver available.');

    elsif v_pol.allow_self_approval then
      -- (c) 0174's narrower flag, still honoured so nothing that worked before
      --     stops working.
      v_kind   := 'self_approval';
      v_reason := coalesce(nullif(btrim(coalesce(p_note,'')), ''),
                           v_pol.self_approval_reason,
                           'Self-approval permitted by policy.');

    else
      raise exception 'GL_SELF_APPROVAL_REFUSED: this entry is % cents, at or above the % cent threshold for these books, so it needs a second pair of eyes. The person who wrote an entry cannot be the person who approves it.', v_total, v_pol.threshold_cents
        using errcode = 'raise_exception';
    end if;

    -- THE LOG. Written BEFORE the approval lands, so a failure here cannot
    -- produce an approved entry with no record of how it was allowed.
    insert into public.gl_override_log
      (entity_id, journal_id, override_kind, amount_cents, threshold_cents, actor, reason)
    values (j.entity_id, j.id, v_kind, v_total, v_pol.threshold_cents, v_actor, v_reason);

    insert into public.gl_audit_events (event_kind, entity_id, journal_id, actor, detail)
    values ('owner_override_used', j.entity_id, j.id, v_actor,
            format('%s: %s cents (threshold %s) — %s', v_kind, v_total, v_pol.threshold_cents, v_reason));
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
  'Blesses a draft. Self-approval above the threshold is allowed for the one-time opening balance cut-over, or when the owner override is on, or under 0174''s narrower allow_self_approval flag — and every such use is written to gl_override_log before the approval lands.';


-- -----------------------------------------------------------------------------
-- 6) The posting trigger must agree with the function.
-- -----------------------------------------------------------------------------
-- WHY THIS MATTERS MORE THAN IT LOOKS.
-- 0174 put the real enforcement in a BEFORE UPDATE trigger precisely so the rule
-- could not be walked around by updating gl_journals directly. If only
-- gl_approve_journal learned about the override, the trigger would still refuse
-- the post and the override would appear to work and then fail at the last step
-- — the exact shape of defect D-1 in the opening balance slice, where a function
-- was written against a constraint that would never have let it run.
create or replace function public.gl_guard_journal_approval()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_pol   public.gl_approval_policy%rowtype;
  v_total bigint;
begin
  if not (old.status = 'draft' and new.status = 'posted') then
    return new;
  end if;

  if new.source_kind in ('pos_sale','excise','purchase','bank') then
    return new;
  end if;

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

  -- STILL ABSOLUTE, EVEN WITH THE OVERRIDE ON.
  -- The override says WHO may approve. It does not say an entry may post with no
  -- approval at all. Nothing above the threshold reaches the ledger unreviewed.
  if new.approved_by is null then
    raise exception 'GL_APPROVAL_REQUIRED: this entry is % cents, at or above the % cent threshold for these books, and has not been approved. Approve it first.', v_total, v_pol.threshold_cents
      using errcode = 'raise_exception';
  end if;

  if new.created_by is not null
     and new.approved_by = new.created_by
     and not v_pol.allow_self_approval
     and not v_pol.owner_override_enabled
     and new.source_kind <> 'opening_balance' then
    raise exception 'GL_SELF_APPROVAL_REFUSED: this entry was written and approved by the same person, and at % cents it is at or above the % cent threshold. Segregation of duties requires a second pair of eyes.', v_total, v_pol.threshold_cents
      using errcode = 'raise_exception';
  end if;

  return new;
end $$;


-- -----------------------------------------------------------------------------
-- 7) The override report — the artefact that makes this defensible.
-- -----------------------------------------------------------------------------
-- If the override is ever questioned, this is the answer, in one call, in plain
-- English. Admin-only, like every other financial report in this system.
create or replace function public.gl_override_report(
  p_entity_code text default null,
  p_from        date default null,
  p_to          date default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_rows   jsonb;
  v_count  bigint;
  v_total  bigint;
begin
  if not public.is_admin() then
    raise exception 'GL_FORBIDDEN: the override report is admin-only.'
      using errcode = 'insufficient_privilege';
  end if;

  select
    coalesce(jsonb_agg(x order by x->>'when' desc), '[]'::jsonb),
    count(*),
    coalesce(sum((x->>'amount_cents')::bigint), 0)
  into v_rows, v_count, v_total
  from (
    select jsonb_build_object(
             'when',            to_char(o.created_at, 'YYYY-MM-DD HH24:MI'),
             'books',           e.name,
             'entity_code',     e.code,
             'journal_no',      j.journal_no,
             'journal_date',    j.journal_date,
             'override_kind',   o.override_kind,
             'amount_cents',    o.amount_cents,
             'threshold_cents', o.threshold_cents,
             'approved_by',     u.email,
             'reason',          o.reason,
             'plain_english',
               case o.override_kind
                 when 'opening_balance_self_approval'
                   then 'Owner approved the one-time opening balance cut-over himself.'
                 when 'self_approval'
                   then 'Owner approved an entry he wrote himself, using the standing override.'
                 else 'Owner bypassed the approval threshold.'
               end
           ) as x
    from public.gl_override_log o
    join public.gl_entities e on e.id = o.entity_id
    left join public.gl_journals j on j.id = o.journal_id
    left join auth.users u on u.id = o.actor
    where (p_entity_code is null or e.code = p_entity_code)
      and (p_from is null or o.created_at >= p_from)
      and (p_to   is null or o.created_at <  (p_to + 1))
  ) s;

  return jsonb_build_object(
    'entity',        coalesce(p_entity_code, 'all books'),
    'override_count', v_count,
    'total_cents',   v_total,
    'overrides',     v_rows,
    'message',
      case when v_count = 0
           then 'No approval overrides have been used. Every entry above the threshold was approved under normal segregation of duties.'
           else v_count || ' approval override(s) recorded, covering ' ||
                to_char(v_total / 100.0, 'FM999,999,990.00') ||
                ' in total. Each one names who approved it and why.'
      end);
end $$;

comment on function public.gl_override_report(text, date, date) is
  'Plain-English report of every time the owner override was used: when, which books, how much, and the written reason. This is the artefact that turns sole-operator self-approval from a finding into an explanation.';


-- -----------------------------------------------------------------------------
-- 8) RLS on the override log.
-- -----------------------------------------------------------------------------
alter table public.gl_override_log enable row level security;

drop policy if exists gl_override_log_admin_read on public.gl_override_log;
create policy gl_override_log_admin_read on public.gl_override_log
  for select using (public.is_admin());

-- No insert/update/delete policy for anyone. Rows are written only by
-- gl_approve_journal, which is security definer, and the append-only trigger
-- refuses changes regardless of who asks.
