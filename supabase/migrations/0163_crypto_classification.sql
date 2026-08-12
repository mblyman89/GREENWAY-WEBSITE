-- =============================================================================
-- 0163_crypto_classification.sql
--
-- R1-B — the persistence layer for the Koinly-style crypto tax engine.
--
-- R1-A added the PURE classification vocabulary (the "dictionary": transaction
-- primitives + the full tag set, each tag's tax treatment and plain-English
-- note). This migration adds the two tables that STORE the owner's decisions on
-- top of the already-synced crypto_transactions rows:
--
--   1. crypto_tx_classifications — one row per classified transaction. Records
--      the chosen tag (from the R1-A vocabulary), an optional owner note, the
--      primitive it was classified as, whether the owner overrode the auto
--      suggestion, and a light audit trail (source + who + when). Nothing here
--      re-interprets tax meaning — the tag key points back into the R1-A
--      dictionary, which stays the single source of truth.
--
--   2. crypto_classification_rules — the rules engine. Plain-English "recipes"
--      ("Flare FTSO reward -> Staking income") that auto-suggest a tag for
--      matching transactions, so Michael doesn't hand-tag thousands of rows.
--      Rules only ever SUGGEST; an owner classification always wins.
--
-- These are additive and independent of the sync path. Syncing keeps writing
-- crypto_transactions exactly as before; classification is a separate layer the
-- upcoming UI (R1-E) and reports (R1-F) read.
--
-- STANDING RULES honored:
--   * NOTHING DELETED — additive tables only; no existing column/table touched.
--   * Idempotent — create table/index if not exists; drop policy if exists then
--     create; safe to re-run.
--   * Ships working PRE-MIGRATION — the store layer degrades gracefully when
--     these tables are absent (reads return empty, writes no-op), so nothing
--     breaks until this migration is applied.
--   * Money/tax integrity — tags reference the R1-A vocabulary (validated in the
--     store layer, not by a DB enum, so the vocabulary can grow without a
--     schema change); no monetary math lives here.
--   * RLS = staff only (public.is_staff()); set_updated_at() trigger; audit
--     columns (classified_by / classified_at).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. crypto_tx_classifications — owner's tag decision per transaction.
-- ---------------------------------------------------------------------------
create table if not exists public.crypto_tx_classifications (
  id                 uuid primary key default gen_random_uuid(),

  -- The transaction this classification applies to. Cascade so classifications
  -- vanish with a (re)built transaction, never orphan.
  transaction_id     uuid not null
                       references public.crypto_transactions(id) on delete cascade,

  -- The primitive this tx was classified as (deposit/withdrawal/trade/transfer).
  -- Stored for provability and to validate the tag against R1-A's validOn set.
  primitive          text not null
                       check (primitive in ('deposit','withdrawal','trade','transfer')),

  -- The chosen tag KEY from the R1-A vocabulary (e.g. 'reward_ftso','sell').
  -- Deliberately a free text key (not a DB enum) so the vocabulary can grow in
  -- code without a migration; the store layer validates it against R1-A.
  tag_key            text not null,

  -- Optional plain-English owner note ("Enosys FTSO epoch reward").
  note               text,

  -- TRUE when the owner accepted the auto suggestion unchanged; FALSE when they
  -- overrode it. Lets the UI show "auto" vs "you set this".
  auto_suggested     boolean not null default false,

  -- Where this classification came from: 'owner' (manual), 'rule' (rules
  -- engine), or 'default' (conservative fallback). Audit / explainability.
  source             text not null default 'owner'
                       check (source in ('owner','rule','default')),

  -- If it came from a rule, which one (nullable). Set null on rule delete so the
  -- classification itself survives.
  rule_id            uuid,

  -- Audit trail.
  classified_by      uuid references auth.users(id),
  classified_at      timestamptz not null default now(),

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- One classification per transaction (the current decision). Re-classifying
-- upserts this row.
create unique index if not exists uq_crypto_tx_classifications_tx
  on public.crypto_tx_classifications (transaction_id);

-- Fast filtering of the classify screen by tag.
create index if not exists idx_crypto_tx_classifications_tag
  on public.crypto_tx_classifications (tag_key);

-- ---------------------------------------------------------------------------
-- 2. crypto_classification_rules — the rules engine (auto-suggest recipes).
-- ---------------------------------------------------------------------------
create table if not exists public.crypto_classification_rules (
  id                 uuid primary key default gen_random_uuid(),

  -- Human name/description shown in the rules UI ("Flare FTSO reward -> income").
  name               text not null,

  -- The tag KEY (R1-A vocabulary) this rule assigns when it matches.
  tag_key            text not null,

  -- Match conditions (all provided conditions must match — AND). Every column is
  -- nullable so a rule can be as broad or narrow as needed. NULL = "don't care".
  match_chain        text
                       check (match_chain is null or
                              match_chain in ('ethereum','flare','songbird','xrpl','coreum')),
  match_direction    text
                       check (match_direction is null or
                              match_direction in ('in','out','self')),
  match_tx_type      text
                       check (match_tx_type is null or
                              match_tx_type in ('transfer','swap','lp_add','lp_remove','reward','fee','other')),
  match_asset_id     text references public.crypto_assets(id),
  -- Optional case-insensitive substring match on the counterparty address.
  match_counterparty text,

  -- Lower priority number = evaluated first; first matching rule wins.
  priority           integer not null default 100,

  -- Rules can be turned off without deleting them.
  active             boolean not null default true,

  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_crypto_classification_rules_active
  on public.crypto_classification_rules (active, priority);

-- ---------------------------------------------------------------------------
-- updated_at triggers (reuse public.set_updated_at()).
-- ---------------------------------------------------------------------------
drop trigger if exists trg_crypto_tx_classifications_updated on public.crypto_tx_classifications;
create trigger trg_crypto_tx_classifications_updated before update on public.crypto_tx_classifications
  for each row execute function public.set_updated_at();

drop trigger if exists trg_crypto_classification_rules_updated on public.crypto_classification_rules;
create trigger trg_crypto_classification_rules_updated before update on public.crypto_classification_rules
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — staff only, matching every other crypto_* table.
-- ---------------------------------------------------------------------------
alter table public.crypto_tx_classifications   enable row level security;
alter table public.crypto_classification_rules enable row level security;

drop policy if exists crypto_tx_classifications_staff_all on public.crypto_tx_classifications;
create policy crypto_tx_classifications_staff_all on public.crypto_tx_classifications
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists crypto_classification_rules_staff_all on public.crypto_classification_rules;
create policy crypto_classification_rules_staff_all on public.crypto_classification_rules
  for all using (public.is_staff()) with check (public.is_staff());
