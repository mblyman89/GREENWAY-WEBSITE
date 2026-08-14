-- =============================================================================
-- 0176 — OPENING BALANCES (slice F5)
--
-- THE CUT-OVER WORKSHEET. This is where Michael's business stops being a pile of
-- Sage exports and bank statements and becomes a set of books that starts at a
-- known, evidenced point in time.
--
-- WHY THIS IS THE MOST DANGEROUS SLICE IN THE ACCOUNTING BRANCH
-- Every number that follows — every P&L, every balance sheet, every 280E
-- calculation, every tax return — is measured FROM the opening balance. If the
-- opening balance is wrong, nothing downstream can be right, and the error is
-- invisible because everything still balances. The IRS does not audit whether
-- your books balance; it audits whether your numbers are TRUE. So this slice is
-- built around one idea: a number without a document is not an opening balance,
-- it is a guess wearing a suit.
--
-- THE SHAPE OF IT
--   1. gl_opening_balances — a STAGING WORKSHEET. Editable, deletable, allowed
--      to be incomplete and unbalanced while it is being built. It is a
--      workspace, not a ledger. NOTHING here affects the books.
--   2. gl_bless_opening_balances() — the one door out. It validates the ENTIRE
--      worksheet and only then creates a real journal through gl_submit_journal.
--      Nothing partial. An opening balance sheet that is half-posted is a lie.
--   3. gl_close_opening_balance_equity() — moves whatever is left in 40400
--      Opening Balance Equity to 40300 Retained Earnings, as its own entry,
--      because it is its own assertion.
--
-- WHY A WORKSHEET AT ALL, INSTEAD OF JUST KEYING A JOURNAL
-- Because the cut-over is not one sitting. It is weeks of "where is the payoff
-- letter for the Timberland loan", "which of these three inventory counts is
-- real", "does this bank balance include the deposit in transit". A journal
-- cannot be half-finished; a worksheet must be. Separating them is what lets
-- the work be done honestly instead of being rushed into the ledger.
--
-- STANDING RULES HONOURED HERE
--   rule 7  — money is integer cents, always
--   rule 10 — the line in the sand is 2026-01-01; the opening entry is 2025-12-31
--   rule 12 — assumptions are RECORDED (assumption_note), never applied silently
--   rule 14 — when in doubt, REFUSE; every ambiguity below raises
--   rule 16 — the gate is WIRED: blessing goes through gl_submit_journal, the
--             same door every other entry uses, so it inherits every control
--   rule 19 — the 0175 lesson is honoured: this migration NEVER calls an
--             admin-guarded function at migration time (there is no logged-in
--             user in the SQL editor)
--
-- IDEMPOTENT. Safe to run repeatedly, as repo law requires.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- §1  THE WORKSHEET
--
-- One row = one line of the opening balance sheet = one number that must be
-- defended. The columns are chosen so that an auditor can answer, for any row,
-- three questions without leaving the table: what is it, how much, and how do
-- you know.
-- -----------------------------------------------------------------------------
create table if not exists public.gl_opening_balances (
  id             uuid primary key default gen_random_uuid(),

  entity_id      uuid not null references public.gl_entities(id) on delete restrict,

  -- The account this balance lands in. Stored as a CODE (not a uuid) because
  -- that is what a human reads off a trial balance, and because gl_submit_journal
  -- resolves codes itself — keeping the same vocabulary end to end.
  account_code   text not null,

  -- Positive = debit, negative = credit. Integer cents. Never zero: a zero
  -- opening balance is not a balance, it is an absence, and absences are not
  -- recorded.
  amount_cents   bigint not null check (amount_cents <> 0),

  -- ---------------------------------------------------------------- EVIDENCE
  -- THE POINT OF THE WHOLE SLICE. Every opening number must point at something
  -- a human can pick up. These are NOT NULL and length-checked because an
  -- evidence field that can be blank is an evidence field that will be blank.
  evidence_kind  text not null
                   check (evidence_kind in (
                     'bank_statement',      -- cash
                     'loan_statement',      -- notes payable, mortgage
                     'inventory_count',     -- physical count at cut-over
                     'fixed_asset_schedule',-- equipment, leasehold
                     'ap_aging',            -- accounts payable
                     'ar_aging',            -- accounts receivable
                     'tax_notice',          -- excise / sales / B&O balances
                     'payroll_report',      -- accrued payroll, withholding
                     'sage_trial_balance',  -- prior system
                     'k1_or_return',        -- equity history
                     'legal_document',      -- leases, notes, agreements
                     'other')),

  -- Where the document IS. A filename, a Sage report number, a statement date —
  -- whatever lets someone put their hands on it.
  evidence_ref   text not null check (length(btrim(evidence_ref)) >= 3),

  -- What the document SAYS, in the preparer's own words. This is the sentence
  -- that gets read back in an audit.
  evidence_note  text,

  -- rule 12: if a number involved a judgement call, it is written down HERE,
  -- attached to the number it affected — not in a separate document nobody opens.
  assumption_note text,

  -- ------------------------------------------------------------ LIFECYCLE
  -- A row is 'staged' while it is being worked. Blessing stamps every row
  -- 'posted' and freezes it (see the guard trigger in §3). 'excluded' lets a
  -- preparer set a row aside WITHOUT deleting it, so the decision not to include
  -- something is itself part of the record.
  status         text not null default 'staged'
                   check (status in ('staged','excluded','posted')),

  exclusion_reason text,

  -- Set when blessed, so every posted row points at the entry it became.
  journal_id     uuid references public.gl_journals(id) on delete restrict,

  prepared_by    uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- A row set aside must SAY WHY. "We left it out" is not an audit answer.
  constraint gl_ob_excluded_needs_reason
    check (status <> 'excluded' or length(btrim(coalesce(exclusion_reason,''))) >= 3),

  -- A posted row must point at its journal; a non-posted row must not pretend to.
  constraint gl_ob_posted_has_journal
    check ((status = 'posted' and journal_id is not null)
           or (status <> 'posted' and journal_id is null))
);

create index if not exists gl_opening_balances_entity_idx
  on public.gl_opening_balances (entity_id, status);
create index if not exists gl_opening_balances_journal_idx
  on public.gl_opening_balances (journal_id);

comment on table public.gl_opening_balances is
  'Staging worksheet for the 2025-12-31 cut-over. Rows are editable while staged and FROZEN once blessed. Every row must carry evidence; a number without a document is not an opening balance.';

-- -----------------------------------------------------------------------------
-- §2  KEEP updated_at HONEST
-- -----------------------------------------------------------------------------
create or replace function public.gl_ob_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists gl_ob_touch on public.gl_opening_balances;
create trigger gl_ob_touch
  before update on public.gl_opening_balances
  for each row execute function public.gl_ob_touch_updated_at();

-- -----------------------------------------------------------------------------
-- §3  ONCE BLESSED, FROZEN
--
-- A posted worksheet row is evidence of what was posted. If it could still be
-- edited, the worksheet and the ledger could disagree, and the worksheet is
-- exactly what an auditor would reach for to check the ledger. Correcting a
-- posted opening balance is done the way every other correction is done in this
-- system: by REVERSING the journal (ASC 250), never by quietly editing history.
-- -----------------------------------------------------------------------------
create or replace function public.gl_ob_guard_frozen()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'posted' then
      raise exception 'GL_OB_FROZEN: this opening balance line has already been posted (journal %). Posted history is corrected by reversing the journal, never by deleting the evidence of it.', old.journal_id
        using errcode = 'raise_exception';
    end if;
    return old;
  end if;

  -- UPDATE. The only permitted transition out of 'posted' is none at all.
  if old.status = 'posted' then
    raise exception 'GL_OB_FROZEN: this opening balance line has already been posted (journal %). Correct it by reversing that journal, not by editing the worksheet.', old.journal_id
      using errcode = 'raise_exception';
  end if;

  return new;
end $$;

drop trigger if exists gl_ob_frozen on public.gl_opening_balances;
create trigger gl_ob_frozen
  before update or delete on public.gl_opening_balances
  for each row execute function public.gl_ob_guard_frozen();

-- -----------------------------------------------------------------------------
-- §4  VALIDATE A ROW THE MOMENT IT IS WRITTEN
--
-- Catching a bad account code at BLESS time means finding it after weeks of
-- data entry. Catching it at INSERT time means finding it while the preparer
-- still has the document open. Both checks exist; this is the early one.
-- -----------------------------------------------------------------------------
create or replace function public.gl_ob_validate_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_acct public.gl_accounts%rowtype;
begin
  select * into v_acct from public.gl_accounts where code = btrim(new.account_code);

  if not found then
    raise exception 'GL_OB_UNKNOWN_ACCOUNT: there is no account % in the chart of accounts', new.account_code
      using errcode = 'raise_exception';
  end if;

  if not v_acct.active then
    raise exception 'GL_OB_INACTIVE_ACCOUNT: account % (%) is not active and cannot carry an opening balance', v_acct.code, v_acct.name
      using errcode = 'raise_exception';
  end if;

  -- A parent/header account is a heading, not a place money sits. Posting to one
  -- makes a balance sheet that foots but cannot be explained line by line.
  if exists (select 1 from public.gl_accounts c where c.parent_code = v_acct.code) then
    raise exception 'GL_OB_PARENT_ACCOUNT: account % (%) is a heading with child accounts. Put the balance on the specific account underneath it.', v_acct.code, v_acct.name
      using errcode = 'raise_exception';
  end if;

  -- An OPENING balance is a BALANCE SHEET fact: what we owned and owed at a
  -- point in time. Income and expense accounts measure a PERIOD, and the period
  -- before cut-over is closed — its net result is retained earnings, not a P&L
  -- balance. Allowing a revenue opening balance would double-count prior income.
  if v_acct.type in ('income','expense','cogs','other_income','other_expense') then
    raise exception 'GL_OB_NOT_BALANCE_SHEET: account % (%) is a % account. Opening balances are balance-sheet only; prior-period results belong in Retained Earnings (40300).', v_acct.code, v_acct.name, v_acct.type
      using errcode = 'raise_exception';
  end if;

  -- THE ACCOUNT MUST BE PERMITTED FOR THIS SET OF BOOKS.
  --
  -- Some accounts are entity-scoped: '10100 Cash on Hand — Vault' is
  -- allowed_entity_codes = {greenway}, the inventory accounts are greenway-only,
  -- '10300 Bank — ATM Vault' is {atm,greenway}. gl_post_journal enforces this
  -- with GL_ACCOUNT_NOT_ALLOWED_FOR_ENTITY — but that fires at POST time, which
  -- is the very end of the cut-over, potentially weeks after the row was keyed.
  --
  -- Proven by probe, before this check existed: a row putting greenway's vault
  -- cash on the landholding books was accepted by the worksheet without a
  -- murmur. It would have sat there looking correct through every summary and
  -- every review, then detonated at the final step with an error naming a line
  -- number rather than a document. The whole point of a staging worksheet is to
  -- fail EARLY, while the preparer still has the statement in front of them.
  if v_acct.allowed_entity_codes is not null then
    if not exists (select 1 from public.gl_entities e
                    where e.id = new.entity_id
                      and e.code = any(v_acct.allowed_entity_codes)) then
      raise exception 'GL_OB_ACCOUNT_NOT_ALLOWED_FOR_ENTITY: account % (%) may only be used by these books: %. It cannot carry an opening balance on this set of books.',
        v_acct.code, v_acct.name, array_to_string(v_acct.allowed_entity_codes, ', ')
        using errcode = 'raise_exception';
    end if;
  end if;

  -- NOTE ON CONTROL ACCOUNTS, deliberately NOT blocked here.
  -- A/P, inventory, payroll and the bank accounts are control accounts, and
  -- gl_post_journal refuses manual journals into them. But an opening balance is
  -- exactly where those balances must legitimately be established — a cut-over
  -- with no opening A/P and no opening inventory would be useless. 0172 §6 scopes
  -- that guard to source_kind = 'manual' for this reason, and 0173's own message
  -- names opening_balance as a permitted source. So control accounts are allowed
  -- through, by design and not by oversight.

  -- Normalise so downstream comparisons are exact.
  new.account_code := btrim(new.account_code);
  return new;
end $$;

drop trigger if exists gl_ob_validate on public.gl_opening_balances;
create trigger gl_ob_validate
  before insert or update on public.gl_opening_balances
  for each row execute function public.gl_ob_validate_row();

-- -----------------------------------------------------------------------------
-- §5  THE WORKSHEET SUMMARY
--
-- Answers the only question that matters before blessing: is this thing ready,
-- and if not, exactly what is wrong with it? Returns numbers, not opinions.
-- Read-only and safe to call at any time.
-- -----------------------------------------------------------------------------
create or replace function public.gl_opening_balance_summary(p_entity_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_entity   public.gl_entities%rowtype;
  v_debits   bigint := 0;
  v_credits  bigint := 0;
  v_rows     integer := 0;
  v_excluded integer := 0;
  v_posted   integer := 0;
  v_diff     bigint;
begin
  if not public.is_admin() then
    raise exception 'GL_FORBIDDEN: the opening balance worksheet is admin-only.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_entity from public.gl_entities where code = btrim(coalesce(p_entity_code,''));
  if not found then
    raise exception 'GL_UNKNOWN_ENTITY: there is no set of books called %', coalesce(p_entity_code,'(null)')
      using errcode = 'raise_exception';
  end if;

  select
    coalesce(sum(amount_cents) filter (where amount_cents > 0 and status = 'staged'), 0),
    coalesce(sum(-amount_cents) filter (where amount_cents < 0 and status = 'staged'), 0),
    count(*) filter (where status = 'staged'),
    count(*) filter (where status = 'excluded'),
    count(*) filter (where status = 'posted')
  into v_debits, v_credits, v_rows, v_excluded, v_posted
  from public.gl_opening_balances
  where entity_id = v_entity.id;

  v_diff := v_debits - v_credits;

  return jsonb_build_object(
    'entity_code',   v_entity.code,
    'staged_rows',   v_rows,
    'excluded_rows', v_excluded,
    'posted_rows',   v_posted,
    'debits_cents',  v_debits,
    'credits_cents', v_credits,
    'difference_cents', v_diff,
    'balanced',      (v_diff = 0),
    -- The plug that WOULD be written to 40400 if blessed right now. Shown before
    -- blessing, deliberately: a preparer should never be surprised by it.
    'obe_plug_cents', -v_diff,
    'ready_to_bless', (v_rows > 0 and v_posted = 0)
  );
end $$;

comment on function public.gl_opening_balance_summary(text) is
  'Read-only readiness check for the opening balance worksheet: totals, difference, and the 40400 plug that blessing would create.';

-- -----------------------------------------------------------------------------
-- §6  BLESS — the one door from worksheet to ledger
--
-- WHAT IT DOES
--   validates the whole worksheet → builds the line set → adds the 40400 plug if
--   the sheet does not balance → hands it to gl_submit_journal (the SAME door
--   every other entry uses) → stamps the rows posted and frozen.
--
-- WHY A PLUG IS ALLOWED AT ALL
-- Because a real cut-over never balances on the first pass, and pretending
-- otherwise would push preparers to fudge a number until it did — which is the
-- actual danger. The plug is explicit, lands in an account whose entire purpose
-- is to be visible and temporary, and §7 exists to drive it back to zero. An
-- honest visible imbalance beats a hidden fudged one, every time.
--
-- IDEMPOTENT: blessing twice returns the FIRST journal and changes nothing,
-- because gl_submit_journal's idempotency key sees the identical entry.
-- -----------------------------------------------------------------------------
create or replace function public.gl_bless_opening_balances(
  p_entity_code text,
  p_memo        text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity   public.gl_entities%rowtype;
  v_rows     integer;
  v_diff     bigint;
  v_lines    jsonb;
  v_result   jsonb;
  v_journal  uuid;
  v_memo     text;
  v_missing  integer;
begin
  if not public.is_admin() then
    raise exception 'GL_FORBIDDEN: only an admin may bless the opening balances.'
      using errcode = 'insufficient_privilege';
  end if;

  -- An unattributable cut-over is worthless: the one entry the whole ledger
  -- rests on must name the human who vouched for it.
  if auth.uid() is null then
    raise exception 'GL_OB_NO_ACTOR: blessing the opening balances must be done by a signed-in human. The entry every other number depends on cannot be anonymous.'
      using errcode = 'raise_exception';
  end if;

  select * into v_entity from public.gl_entities where code = btrim(coalesce(p_entity_code,''));
  if not found then
    raise exception 'GL_UNKNOWN_ENTITY: there is no set of books called %', coalesce(p_entity_code,'(null)')
      using errcode = 'raise_exception';
  end if;

  -- (a) Already blessed? Return the original entry rather than making a second.
  select journal_id into v_journal
  from public.gl_opening_balances
  where entity_id = v_entity.id and status = 'posted'
  limit 1;

  if v_journal is not null then
    return jsonb_build_object(
      'outcome', 'already_blessed',
      'code', 'GL_OB_ALREADY_BLESSED',
      'journal_id', v_journal,
      'message', 'These opening balances were already posted. Nothing was changed.');
  end if;

  -- (b) Refuse an empty worksheet. An empty opening entry asserts that the
  --     business owned nothing and owed nothing, which is never true.
  select count(*) into v_rows
  from public.gl_opening_balances
  where entity_id = v_entity.id and status = 'staged';

  if v_rows = 0 then
    raise exception 'GL_OB_EMPTY: there are no staged opening balance rows for %. There is nothing to post.', v_entity.code
      using errcode = 'raise_exception';
  end if;

  -- (c) Evidence is not optional.
  --
  --     HONESTY NOTE: this check is currently UNREACHABLE, and that is recorded
  --     rather than glossed over. The column carries
  --         check (length(btrim(evidence_ref)) >= 3)
  --     and a column CHECK binds on UPDATE as well as INSERT, so a staged row
  --     with unusable evidence cannot be brought into existence. Proven by probe
  --     against blank, two-character, NULL and whitespace-padded values.
  --
  --     It is kept deliberately as defence in depth: if a future migration ever
  --     relaxes that column constraint, this is the second lock that still
  --     refuses to post an unevidenced number. It is NOT claimed as tested,
  --     because a test that cannot reach its target proves nothing.
  select count(*) into v_missing
  from public.gl_opening_balances
  where entity_id = v_entity.id
    and status = 'staged'
    and length(btrim(coalesce(evidence_ref,''))) < 3;

  if v_missing > 0 then
    raise exception 'GL_OB_NO_EVIDENCE: % opening balance row(s) have no usable evidence reference. Every opening number must point at a document.', v_missing
      using errcode = 'raise_exception';
  end if;

  -- (d) Build the lines. cost_class is forced to 'none': these are balance-sheet
  --     accounts, and 0173 constrains asset/liability/equity to 'none' anyway.
  select jsonb_agg(
           jsonb_build_object(
             'account_code', account_code,
             'amount_cents', amount_cents,
             'cost_class',   'none',
             'description',  left(coalesce(evidence_kind,'') || ': ' || coalesce(evidence_ref,''), 200)
           )
           order by account_code, id)
  into v_lines
  from public.gl_opening_balances
  where entity_id = v_entity.id and status = 'staged';

  -- (e) The plug, if needed.
  select coalesce(sum(amount_cents), 0) into v_diff
  from public.gl_opening_balances
  where entity_id = v_entity.id and status = 'staged';

  if v_diff <> 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object(
        'account_code', '40400',
        'amount_cents', -v_diff,
        'cost_class',   'none',
        'description',  'Opening Balance Equity — plug pending evidence'));
  end if;

  v_memo := coalesce(nullif(btrim(coalesce(p_memo,'')), ''),
                     'Opening balances at cut-over 2025-12-31 for ' || v_entity.code);

  -- (f) THROUGH THE FRONT DOOR. Not a direct insert: this inherits balance
  --     checking, the idempotency key, the fingerprint, period validation and
  --     the approval policy, exactly like every other entry in the system.
  --     p_auto_post is FALSE because opening_balance is not auto-post eligible
  --     (0174 §5) — the cut-over gets a human approval, by design.
  v_result := public.gl_submit_journal(
    p_entity_code    := v_entity.code,
    p_journal_date   := date '2025-12-31',
    p_source_kind    := 'opening_balance',
    p_source_ref     := 'opening-balance:' || v_entity.code,
    p_memo           := v_memo,
    p_lines          := v_lines,
    p_auto_post      := false,
    p_assumption_note := case when v_diff <> 0
      then 'Worksheet did not balance by ' || v_diff ||
           ' cents; the difference was plugged to 40400 Opening Balance Equity and must be resolved before the cut-over is complete.'
      else null end
  );

  v_journal := (v_result->>'journal_id')::uuid;

  -- (g) Stamp and freeze. Done LAST so a failure above leaves the worksheet
  --     fully editable rather than half-frozen.
  update public.gl_opening_balances
     set status = 'posted', journal_id = v_journal
   where entity_id = v_entity.id and status = 'staged';

  return jsonb_build_object(
    'outcome',    'blessed',
    'code',       'GL_OB_BLESSED',
    'journal_id', v_journal,
    'journal_status', v_result->>'status',
    'rows_posted', v_rows,
    'plug_cents', case when v_diff <> 0 then -v_diff else 0 end,
    'needs_second_approver', v_result->'needs_second_approver',
    'message',    'Opening balances posted as a DRAFT journal. It still needs approval before it hits the ledger.');
end $$;

comment on function public.gl_bless_opening_balances(text, text) is
  'Validates the whole opening balance worksheet and posts it as ONE draft journal via gl_submit_journal. Idempotent: blessing twice returns the original journal.';

-- -----------------------------------------------------------------------------
-- §7  CLOSE OPENING BALANCE EQUITY
--
-- 40400 exists to be temporary. Whatever sits in it after the cut-over is the
-- part of the balance sheet that is not yet evidenced, and leaving it there
-- forever would quietly turn "we have not finished" into "this is equity".
-- This moves the residual to 40300 Retained Earnings as its OWN entry, because
-- it is its own assertion and deserves its own date, memo and approval.
--
-- Deliberately refuses when there is nothing to close: an empty journal is
-- noise in the ledger and noise is what auditors trip over.
-- -----------------------------------------------------------------------------
create or replace function public.gl_close_opening_balance_equity(
  p_entity_code text,
  p_memo        text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_entity  public.gl_entities%rowtype;
  v_bal     bigint;
  v_result  jsonb;
  v_memo    text;
begin
  if not public.is_admin() then
    raise exception 'GL_FORBIDDEN: only an admin may close Opening Balance Equity.'
      using errcode = 'insufficient_privilege';
  end if;

  if auth.uid() is null then
    raise exception 'GL_OB_NO_ACTOR: closing Opening Balance Equity must be done by a signed-in human.'
      using errcode = 'raise_exception';
  end if;

  select * into v_entity from public.gl_entities where code = btrim(coalesce(p_entity_code,''));
  if not found then
    raise exception 'GL_UNKNOWN_ENTITY: there is no set of books called %', coalesce(p_entity_code,'(null)')
      using errcode = 'raise_exception';
  end if;

  -- Balance of 40400 across every line that COUNTS.
  --
  -- THIS READS gl_reportable_lines AND NOTHING ELSE. That view is 0175's single
  -- definition of "a ledger line that counts": journals whose status is posted OR
  -- reversed, never drafts. Its comment says every GL report must read from here,
  -- and it means it.
  --
  -- An earlier draft of this function queried gl_journal_lines directly with
  -- `j.status in ('posted','reversed') and j.reversed_by_journal_id is null`.
  -- That is wrong and silently so: excluding a reversed ORIGINAL while still
  -- including its REVERSING entry counts the reversal once with nothing to
  -- cancel against, so the computed balance is off by the full amount of the
  -- reversal. It is the very defect 0175 was written to make impossible, and it
  -- was reintroduced the moment this function went around the view. Do not
  -- "optimise" this back into a direct table read.
  select coalesce(sum(l.amount_cents), 0) into v_bal
  from public.gl_reportable_lines l
  where l.entity_id = v_entity.id
    and l.account_code = '40400';

  if v_bal = 0 then
    return jsonb_build_object(
      'outcome', 'nothing_to_close',
      'code',    'GL_OBE_ALREADY_ZERO',
      'balance_cents', 0,
      'message', 'Opening Balance Equity is already zero. No entry was made.');
  end if;

  v_memo := coalesce(nullif(btrim(coalesce(p_memo,'')), ''),
                     'Close Opening Balance Equity to Retained Earnings at cut-over');

  -- Reverse the residual out of 40400 and into 40300.
  --
  -- WHY source_kind IS 'opening_balance' AND NOT 'close'
  -- This entry is dated 2025-12-31, and 0172's gl_journals_line_in_the_sand
  -- constraint permits a pre-2026 date for EXACTLY ONE source_kind:
  --
  --   check ( journal_date >= date '2026-01-01'
  --           or (source_kind = 'opening_balance' and journal_date = date '2025-12-31') )
  --
  -- An earlier draft of this function used 'close' with the 2025-12-31 date. That
  -- combination satisfies neither arm, so every call would have died on a raw
  -- constraint violation: the function was dead code that had never been run.
  -- 0172 §8 also exempts only 'opening_balance' from period control, and no 2025
  -- period exists or can exist (gl_periods.fiscal_year is checked >= 2026), so
  -- posting would have failed a second time with GL_NO_PERIOD.
  --
  -- The alternative fix was to date this 2026-01-01 and keep 'close'. Rejected,
  -- and the reason matters: the balance sheet AS OF 2025-12-31 is the artifact
  -- every future number is measured from. Dating the close into 2026 would leave
  -- that balance sheet permanently showing a non-zero Opening Balance Equity and
  -- an understated Retained Earnings — the single most important report in the
  -- system, wrong on its face. Clearing OBE is part of the cut-over, so it
  -- carries the cut-over's date and the cut-over's kind.
  --
  -- The two cut-over entries stay distinct because their source_refs differ
  -- ('opening-balance:CODE' vs 'obe-close:CODE'), so their idempotency keys
  -- differ and neither can be mistaken for, or swallow, the other.
  v_result := public.gl_submit_journal(
    p_entity_code  := v_entity.code,
    p_journal_date := date '2025-12-31',
    p_source_kind  := 'opening_balance',
    p_source_ref   := 'obe-close:' || v_entity.code,
    p_memo         := v_memo,
    p_lines        := jsonb_build_array(
      jsonb_build_object('account_code','40400','amount_cents', -v_bal,
                         'cost_class','none','description','Clear Opening Balance Equity'),
      jsonb_build_object('account_code','40300','amount_cents',  v_bal,
                         'cost_class','none','description','Opening retained earnings at cut-over')),
    p_auto_post := false,
    p_assumption_note :=
      'Residual Opening Balance Equity of ' || v_bal ||
      ' cents reclassified to Retained Earnings. This represents prior-period results not separately evidenced at cut-over.'
  );

  return jsonb_build_object(
    'outcome',    'closed',
    'code',       'GL_OBE_CLOSED',
    'journal_id', v_result->>'journal_id',
    'journal_status', v_result->>'status',
    'moved_cents', v_bal,
    'message',    'Opening Balance Equity cleared to Retained Earnings as a DRAFT journal awaiting approval.');
end $$;

comment on function public.gl_close_opening_balance_equity(text, text) is
  'Moves any residual 40400 Opening Balance Equity to 40300 Retained Earnings as its own draft journal. No-op when 40400 is already zero.';

-- -----------------------------------------------------------------------------
-- §8  ACCESS
--
-- Same posture as the rest of the ledger (0172-0175): admin only, enforced by
-- RLS on the table AND by an explicit check inside every function, so neither
-- one alone is load-bearing.
-- -----------------------------------------------------------------------------
alter table public.gl_opening_balances enable row level security;

drop policy if exists gl_opening_balances_admin_all on public.gl_opening_balances;
create policy gl_opening_balances_admin_all on public.gl_opening_balances
  for all using (public.is_admin()) with check (public.is_admin());

revoke all on function public.gl_opening_balance_summary(text) from public;
revoke all on function public.gl_bless_opening_balances(text, text) from public;
revoke all on function public.gl_close_opening_balance_equity(text, text) from public;

grant execute on function public.gl_opening_balance_summary(text) to authenticated;
grant execute on function public.gl_bless_opening_balances(text, text) to authenticated;
grant execute on function public.gl_close_opening_balance_equity(text, text) to authenticated;

-- NOTE (the 0175 lesson, standing rule 19): this migration deliberately does NOT
-- call any of the functions above. They are admin-guarded, and a migration
-- applied by hand in the Supabase SQL editor has no logged-in user, so
-- is_admin() is false and any such call would fail. There is nothing to seed
-- here anyway — the worksheet starts empty, which is correct.
