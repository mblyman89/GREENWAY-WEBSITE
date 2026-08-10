# Crypto Portfolio Integration — TASK LIST

> Companion to `CRYPTO_PORTFOLIO_BIBLE.md` and `CRYPTO_PORTFOLIO_ROADMAP.md`.
> Check items off as they land. One slice = one PR. Never guess.

Legend: `[ ]` todo · `[x]` done · `[~]` in progress

---

## C0 — Docs + pure primitives ← **SLICE ONE (in progress)**
- [ ] Commit `docs/CRYPTO_PORTFOLIO_BIBLE.md`
- [ ] Commit `docs/CRYPTO_PORTFOLIO_ROADMAP.md`
- [ ] Commit `docs/CRYPTO_PORTFOLIO_TASKLIST.md`
- [ ] Create `src/lib/crypto/crypto-core.ts` (pure):
  - [ ] `Chain` type + `CHAIN_LABELS`, `isEvmChain`
  - [ ] `CryptoAsset` registry (ETH, USDT, FLR, SGB, XRP, SOLO) w/ verified decimals
  - [ ] `TxDirection`, `TxType`
  - [ ] `normalizeMinorUnits`, `formatTokenAmount` (string-safe, no float drift)
  - [ ] `usdValueCents` (deterministic integer cents)
  - [ ] address shape validators (`0x…` EVM, `r…` XRPL)
  - [ ] `__runCryptoCoreTests()`
- [ ] Wire self-test into `scripts/compliance/run-pure-selftests.ts`
- [ ] Vitest mirror `tests/compliance/crypto-core.test.ts`
- [ ] FULL BATTERY green; config restored identical
- [ ] PR opened, `compliance` green, squash-merged, main synced
- [ ] Reported to Michael via `ask`

## C1 — `crypto_*` schema foundation
- [ ] Migration `NNNN_crypto_foundation.sql` (tables + indexes + trigger + RLS)
- [ ] Seed `crypto_assets` (6 assets, verified decimals)
- [ ] Ships working pre-migration (guards in place)
- [ ] Battery green · PR · merge · sync · report

## C2 — Crypto store (read-only)
- [ ] `src/lib/crypto/crypto-store.ts` readers w/ "not configured" resilience
- [ ] Battery · PR · merge · report

## C3 — Banking-page Crypto section (shell)
- [ ] `src/components/admin/crypto/CryptoPortfolioSection.tsx` (StatCards + empty state)
- [ ] "Add wallet (watch-only)" action stub (address validation only)
- [ ] Rendered on `src/app/admin/settings/banking/page.tsx`
- [ ] Battery · PR · merge · report

## C4 — XRPL client + mappers
- [ ] `xrpl-client.ts` (account_info/lines/tx via xrplcluster.com, fair-use safe)
- [ ] `xrpl-map-core.ts` pure mappers + `__runXrplMapCoreTests()`
- [ ] Battery · PR · merge · report

## C5 — XRPL balances + backfill
- [ ] Balances → `crypto_balances`
- [ ] `account_tx` backfill (marker pagination) → `crypto_transactions`
- [ ] Cursor to `crypto_sync_state`
- [ ] Battery · PR · merge · report

## C6 — Subsquid squid: Ethereum (+ USDT)
- [ ] Squid project scaffolded (`crypto-indexer/`)
- [ ] Index native ETH + ERC-20 (USDT `0xdAC1…`) for tracked addresses
- [ ] `evm-map-core.ts` pure mappers + self-tests
- [ ] Self-host vs Cloud decision documented
- [ ] Battery · PR · merge · report

## C7 — Add Flare
- [ ] Extend squid to `flare-mainnet`; wire to store
- [ ] Battery · PR · merge · report

## C8 — Add Songbird (EVM-RPC mode)
- [ ] Index via `EvmRpcDataSourceBuilder` → `songbird-api.flare.network`
- [ ] Battery · PR · merge · report

## C9 — CoinGecko valuation
- [ ] `coingecko-core.ts` (pure) + `coingecko-client.ts` (server)
- [ ] Fill `usd_value_cents` (balances) + `usd_value_cents_at_time` (tx, historical)
- [ ] Cache to `crypto_price_snapshots`
- [ ] Battery · PR · merge · report

## C10 — Backfill orchestrator
- [ ] Chunked, resumable, idempotent; UI progress
- [ ] Battery · PR · merge · report

## C11 — Daily incremental sync
- [ ] Once/day per account; new activity only; status timestamps
- [ ] Battery · PR · merge · report

## C12 — LP & complex tx classification
- [ ] Pure classifiers (swap/lp_add/lp_remove/reward/fee) w/ fixtures
- [ ] Battery · PR · merge · report

## C13 — Cost-basis lots & disposals
- [ ] FIFO lot engine + realized gain/loss (pure, fully tested)
- [ ] Battery · PR · merge · report

## C14 — Tax reports & exports
- [ ] 8949/Schedule-D-style detail + CSV/PDF; disclaimer
- [ ] Battery · PR · merge · report

## C15 — Portfolio UX polish
- [ ] Holdings breakdown, drill-down, value-over-time, connect/disconnect
- [ ] Battery · PR · merge · report

## C16 — Alerts, health & exports
- [ ] Sync-health badges, failure alerts, full export
- [ ] Battery · PR · merge · report

_Last updated: 2026-08-10._
