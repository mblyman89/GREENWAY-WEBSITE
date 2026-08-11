# Crypto Portfolio Integration — TASK LIST

> Companion to `CRYPTO_PORTFOLIO_BIBLE.md` and `CRYPTO_PORTFOLIO_ROADMAP.md`.
> Check items off as they land. One slice = one PR. Never guess.

Legend: `[ ]` todo · `[x]` done · `[~]` in progress

---

## C0 — Docs + pure primitives ← **SLICE ONE ✅ DONE (PR #875, merged 84458dbf)**
- [x] Commit `docs/CRYPTO_PORTFOLIO_BIBLE.md`
- [x] Commit `docs/CRYPTO_PORTFOLIO_ROADMAP.md`
- [x] Commit `docs/CRYPTO_PORTFOLIO_TASKLIST.md`
- [x] Create `src/lib/crypto/crypto-core.ts` (pure):
  - [x] `Chain` type + `CHAIN_LABELS`, `isEvmChain`, verified EVM chain IDs (1/14/19)
  - [x] `CryptoAsset` registry (ETH 18, USDT 6, FLR 18, SGB 18, XRP 6, SOLO xrpl-15-sig-digit) w/ verified decimals + two amount models
  - [x] `TxDirection`, `TxType` (incl. `lp_add`/`lp_remove`), `isDisposalType`
  - [x] `normalizeMinorUnits`, `formatTokenAmount` (string-safe, no float drift)
  - [x] `normalizeXrplIssuedAmount` (15-sig-digit decimal-string guard)
  - [x] `usdValueCents` (deterministic integer cents, round-half-up)
  - [x] address shape validators (`0x…` EVM, `r…` XRPL) + `isValidAddressForChain`
  - [x] `__runCryptoCoreTests()`
- [x] Wire self-test into `scripts/compliance/run-pure-selftests.ts`
- [x] Vitest mirror `tests/compliance/crypto-core.test.ts`
- [x] FULL BATTERY green; config restored identical
- [x] PR opened (#875), `compliance` green, squash-merged, main synced
- [x] Reported to Michael via `ask`

## C1 — `crypto_*` schema foundation ← **SLICE TWO ✅ DONE (PR #877, merged ccb3061b)**
- [x] Update `crypto-core.ts`: add `coreum` (Cosmos) chain, `isCosmosChain`, `COSMOS_ADDRESS_PREFIX`, `COSMOS_CHAIN_ID`, Cosmos bech32 validator, `decimalsSource` + `migratesToAssetId` fields
- [x] Add TX (Coreum, `ucoreum`, 6 dec VERIFIED via BitGo), SARA (Pulsara), link SOLO→TX (keep-history)
- [x] Fix self-tests (5 chains, 8 assets, Cosmos addresses) + vitest mirror
- [x] Migration `0160_crypto_foundation.sql`: crypto_assets, crypto_wallets, crypto_balances, crypto_transactions, crypto_asset_migrations, crypto_sync_state, crypto_price_snapshots (+ indexes + trigger + RLS staff-only)
- [x] Seed `crypto_assets` (8 assets, verified decimals) + record CORE→TX / SOLO→TX migrations
- [x] Ships working pre-migration (store guards added in C2)
- [x] Update Bible + Roadmap (Coreum/TX facts §2.3/§2.4, Cosmos connector slices C8b/C8c)
- [x] Battery green · config restored identical
- [x] PR (#877) · `compliance` green · squash-merged · main synced · reported to Michael

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
