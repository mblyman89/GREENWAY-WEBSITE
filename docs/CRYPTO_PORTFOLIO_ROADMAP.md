# Crypto Portfolio Integration — ROADMAP

> Read `CRYPTO_PORTFOLIO_BIBLE.md` first. This roadmap sequences the build into
> small, independently-shippable slices (**one feature per PR**). Task-level
> checkboxes live in `CRYPTO_PORTFOLIO_TASKLIST.md`.
>
> Guiding principles: **slow & meticulous**, **read-only/watch-only**, **money in
> integer minor units**, **pure cores first**, **full battery before merge**,
> **ships working pre-migration**, **IRS-bulletproof audit trail**.

---

## Phasing at a glance

```
Phase 0  Foundations & safety rails        C0
Phase 1  Data model (schema)               C1
Phase 2  Read layer + Banking-page shell   C2, C3
Phase 3  XRPL connector (fastest win)      C4, C5           ← XRP + Sologenic + USDT-on-XRPL
Phase 4  EVM connector via Subsquid        C6, C7, C8       ← Ethereum + USDT-on-ETH, then Flare, then Songbird
Phase 5  Valuation (USD)                   C9               ← CoinGecko current + historical
Phase 6  Sync engine (backfill + daily)    C10, C11
Phase 7  Advanced tx typing (LP etc.)      C12
Phase 8  Tax / cost-basis engine           C13, C14         ← the IRS-bulletproof payoff
Phase 9  UX polish, exports, alerts        C15, C16
```

Each `C#` is one PR. Order respects dependencies; we can pause between any two.

---

## Phase 0 — Foundations & safety rails

### C0 — Docs + pure primitives (NO schema, NO network) ← **SLICE ONE**
**Goal:** commit the bible/roadmap/tasklist to git (survives resets) AND land the
tiny, pure, fully-tested primitives every later slice depends on, with zero risk.

- Commit `CRYPTO_PORTFOLIO_BIBLE.md`, `CRYPTO_PORTFOLIO_ROADMAP.md`,
  `CRYPTO_PORTFOLIO_TASKLIST.md`.
- New pure core `src/lib/crypto/crypto-core.ts`:
  - `Chain` enum/type (`ethereum|flare|songbird|xrpl`) + display helpers.
  - `CryptoAsset` registry (ETH, USDT, FLR, SGB, XRP, SOLO) with **verified
    decimals**, chain, contract/issuer, coingecko id.
  - `TxDirection` (`in|out|self`) and `TxType`
    (`transfer|swap|lp_add|lp_remove|fee|reward|other`).
  - `normalizeMinorUnits(raw, decimals)` / `formatTokenAmount(...)` — exact,
    string-safe (no float drift).
  - `usdValueCents(rawAmount, decimals, unitPriceUsd)` — integer cents, rounded
    deterministically.
  - `isEvmChain(chain)`, address validators (basic shape checks for `0x…` vs XRPL
    `r…`), all pure.
  - `__runCryptoCoreTests()` self-test.
- Wire self-test into `scripts/compliance/run-pure-selftests.ts`.
- Vitest mirror `tests/compliance/crypto-core.test.ts`.
- **No DB, no network, no UI.** Nothing user-visible changes. Pure safety.

**Why first:** guarantees the bible is in git (Michael's explicit ask), and gives
every future slice a verified, tested foundation for units/decimals/typing — the
stuff that, if wrong, breaks tax math. Lowest risk, highest leverage.

---

## Phase 1 — Data model

### C1 — `crypto_*` schema foundation (migration only; ships working pre-migration)
- Migration `NNNN_crypto_foundation.sql` creating `crypto_wallets`,
  `crypto_assets`, `crypto_balances`, `crypto_transactions`, `crypto_sync_state`
  (+ `crypto_price_snapshots` optional), mirroring Plaid migration style:
  `if not exists`, unique idempotency indexes, `set_updated_at()` trigger, RLS
  staff-only.
- Seed `crypto_assets` with the six verified assets (decimals from bible §2.1).
- **No app reads yet** beyond a "not configured" guard. No behavior change.

---

## Phase 2 — Read layer + Banking-page shell

### C2 — Crypto store (read-only) + "not configured" safety
- `src/lib/crypto/crypto-store.ts`: typed readers `listCryptoWallets()`,
  `listCryptoBalances(walletId)`, `listCryptoTransactions(walletId, limit)`,
  `getCryptoSyncState(walletId)` — all return `[]`/null when tables missing
  (mirrors Plaid store resilience). Pure-ish; DB only.

### C3 — "Crypto Portfolio" page (empty-state shell) ✅ DONE
- **Delivered as its OWN dedicated page `src/app/admin/crypto/page.tsx`** (three
  tabs: Portfolio / Wallets / Health), mirroring the `/admin/plaid` precedent
  rather than living inside the Banking vault. Nav entry "Crypto Portfolio"
  (`\u20bf`) added to `admin-nav-data.ts`, gated on `settings.manage`.
- Pure presentation brain `src/lib/crypto/crypto-ui-core.ts` (imports crypto-core
  only; NO server-only) is the tax-safety centerpiece: **HONEST portfolio totals**
  (sums ONLY holdings with a real USD price; any held-but-unpriced holding is
  counted separately and NEVER folded in as a guessed $0), **exact token amounts**
  (formats from stored integer minor units / issued-token decimal strings, never
  floats), address masking, add-wallet validation with plain-English errors,
  watch-only posture (structurally always "we never move your funds"), and
  sync-health read-outs. Backed by `__runCryptoUiCoreTests()` + a vitest mirror.
- "Add wallet (watch-only)" server action `src/app/admin/crypto/actions.ts`
  (gate `settings.manage` → `parseAddWallet` → `addWatchOnlyWallet` → audit).
  `addWatchOnlyWallet()` write added to `crypto-store.ts` using an explicit
  find-then-insert-or-update that respects the functional `(chain, lower(address))`
  unique index. Reads live but show empty until later sync slices populate them.

---

## Phase 3 — XRPL connector (the fastest win; no infra to run)

### C4 — XRPL client (read-only) against XRP Cluster
- `src/lib/crypto/xrpl/xrpl-client.ts`: thin wrapper over `xrplcluster.com`
  (HTTPS JSON-RPC), calling `account_info`, `account_lines`, `account_tx`.
  Honors fair-use (throttle, retry/backoff, failover-friendly). No keys.
- Pure mappers `xrpl-map-core.ts`: raw XRPL payloads → `CryptoTransaction` /
  balance rows (XRP via drops/6-dec; SOLO + USDT-on-XRPL via trust lines).
  `__runXrplMapCoreTests()` with fixture payloads.

### C5 — XRPL balances + backfill wiring (read → store)
- Fetch balances (`account_info` + `account_lines`) → `crypto_balances`.
- Backfill `account_tx` (paginated by `marker`) → `crypto_transactions`.
- Sync-state cursor (`ledger_index_max`) recorded for daily incremental later.

---

## Phase 4 — EVM connector via Subsquid

### C6 — Subsquid squid: Ethereum (+ USDT-on-ETH) indexer
- Standalone squid project (in-repo folder, e.g. `crypto-indexer/`) built from the
  EVM template: indexes native ETH transfers + ERC-20 transfers (incl. USDT
  `0xdAC1…`) touching tracked addresses → Postgres. Decide self-host vs Cloud
  (bible §2). Read model exposed to the app (GraphQL or shared DB read).
- Pure mappers `evm-map-core.ts`: squid rows → `CryptoTransaction` (direction,
  decimals, tx_type=transfer baseline). Self-tests.

### C7 — Add Flare to the squid (ready dataset `flare-mainnet`)  ⭐ HEAVIEST EVM SLICE
- **Flare is Michael's PRIMARY DeFi venue** ("I almost exclusively use Flare for
  all things DeFi"). This is NOT a copy of C6 — it is the most complex and most
  tax-critical connector slice.
- Extend the squid to Flare native + tokens; wire to store.
- Beyond plain transfers, capture the DeFi/contract-interaction surface: DEX
  router **swaps**, LP pair **mint/burn** (Uniswap-V2-style Mint/Burn/Swap logs),
  **reward/claim** events, and **WFLR** deposit/withdraw. Preserve raw decoded
  logs in `crypto_transactions.raw` so C12 can classify (never guess a type at
  ingest). Confirm the exact DEX/router/pool contracts from Michael's wallet
  history before hard-coding any protocol address.
- Give this slice the "heavy, expert" treatment Michael explicitly requested.

### C8 — Add Songbird via EVM-RPC mode
- Index Songbird through `EvmRpcDataSourceBuilder` against
  `songbird-api.flare.network` (no prebuilt dataset). Document the slower path.

---

## Phase 4b — Cosmos connector (Coreum + Pulsara)

### C8b — Coreum/Cosmos client (read-only) + mappers
- **Best free+powerful method:** Coreum is a Cosmos SDK L1. Read it directly via
  the standard **Cosmos REST/LCD + Tendermint RPC** (free public endpoints:
  Polkachu `coreum-api.polkachu.com` / `coreum-rpc.polkachu.com`, plus others on
  comparenodes; self-host `cored` if we ever want our own node). No paid API.
- `src/lib/crypto/cosmos/coreum-client.ts`: thin read-only wrapper —
  `bank/v1beta1/balances/{address}` (TX + SARA + any held denoms),
  `bank/v1beta1/denoms_metadata` (READ decimals live → confirm/​upgrade
  `crypto_assets.decimals`; never guess), Tendermint `tx_search`
  (`message.sender`/`transfer.recipient`) for full history backfill.
- Pure mappers `coreum-map-core.ts`: raw Cosmos tx/events → `crypto_transactions`
  rows. Classifies **Pulsara liquidity-pool** activity (LP add/remove/swap) and
  staking rewards. `__runCoreumMapCoreTests()` with fixture payloads.
- **Verified facts:** Coreum native = `ucoreum` (6 dec, BitGo-verified); address
  prefix `core1…`; chain-id `coreum-mainnet-1`. Pulsara runs ON Coreum → same
  `core1…` address, read through the SAME endpoints (not a separate chain).

### C8c — TX migration handling (CORE→TX auto, SOLO→TX manual)
- Use `crypto_asset_migrations` to link old CORE/SOLO cost basis forward to TX
  without deleting history. CORE→TX already auto-converted in-wallet (record for
  audit). SOLO→TX pending — when Michael converts, record the event with the
  **official verified ratio** (pulled from tx.org FAQ, confirmed with Michael)
  and a documented tax treatment (keep-history; not tax advice).

---

## Phase 5 — Valuation

### C9 — CoinGecko USD valuation (current + historical)
- `src/lib/crypto/pricing/coingecko-core.ts` (pure mappers) +
  `coingecko-client.ts` (server). Fill `usd_value_cents` on balances and
  `usd_value_cents_at_time` on transactions (historical price by date). Cache into
  `crypto_price_snapshots` for reproducible, audit-stable reports. Free-tier
  rate-limit aware.

---

## Phase 6 — Sync engine

### C10 — Backfill orchestrator (chunked, resumable)
- One-shot full history per wallet across connectors; resumable via cursors;
  progress surfaced in UI. Idempotent upserts (no dupes on re-run).

### C11 — Daily incremental sync (once/day per account)
- Scheduled job (mirror Plaid sync cadence): pull only new activity since last
  cursor/ledger/block; update balances; value new tx via CoinGecko. Status +
  last-sync timestamps on the Banking page.

---

## Phase 7 — Advanced transaction typing

### C12 — LP & complex activity classification  ⭐ TAX MAKE-OR-BREAK (Flare-first)
- Detect & label liquidity-pool add/remove, swaps, LP-token mint/burn, rewards,
  fees — per chain. Pure classifier cores with fixtures; `tx_type` populated for
  tax correctness. This is where "handle LP transactions" is delivered.
- **Primary target is FLARE** — Michael's near-exclusive DeFi venue — with the
  Pulsara/Coreum LP case as the secondary target. `tx_type` must be assigned by a
  PURE, fixture-tested classifier from the decoded event shape (never drifting
  heuristics), with the source log kept for audit. This slice + C13 are where the
  Flare LP lifecycle (add = disposal into position; remove = re-acquire at new
  basis; swap = disposition) becomes "IRS-bulletproof".

---

## Phase 8 — Tax / cost-basis engine (the IRS-bulletproof payoff)

### C13 — Cost-basis lots & disposals (FIFO first)
- Pure engine building acquisition lots and computing realized gain/loss on
  disposals (swaps, sales, spends, LP removes). Every figure traceable to source
  tx + snapshot price. Deterministic, fully unit-tested.

### C14 — Tax reports & exports (8949/Schedule-D-style detail)
- Generate CPA-ready gain/loss detail + CSV/PDF exports. Clear disclaimer:
  faithful record, not tax advice.

---

## Phase 9 — UX polish, exports, alerts

### C15 — Portfolio UX polish
- Holdings breakdown per token, per-wallet drill-down, transaction history views,
  value-over-time, nicknames, connect/disconnect flows. Print-friendly.

### C16 — Alerts, health & exports
- Sync-health badges, failure alerts, full-portfolio export, reconciliation aids.

---

## Dependency notes

- C0 blocks everything (primitives).
- C1 blocks C2+ (schema).
- C4–C5 (XRPL) are independent of C6–C8 (EVM) — can run in parallel conceptually,
  but we go one PR at a time.
- C9 (valuation) depends on tx/balances existing (needs C5 and/or C6).
- C13–C14 (tax) depend on complete, typed, valued transactions (C9 + C12).

## Definition of done (every slice)

- Pure core with self-tests + vitest mirror (where logic exists).
- Full battery green; `next.config.ts` restored identical.
- Read-only / watch-only; no private keys; money in integer minor units.
- Ships working pre-migration; nothing breaks if tables/data absent.
- Reported to Michael in plain English via `ask`; docs updated in git.

_Last updated: 2026-08-10._
