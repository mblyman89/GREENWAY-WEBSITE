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

## C2 — Crypto store (read-only) ← **SLICE THREE ✅ DONE (PR #879, merged b6b8f3d2)**
- [x] `src/lib/crypto/crypto-store.ts` readers w/ "not configured" resilience
      (server-only) + `crypto-store-core.ts` pure shape layer (types, row
      mappers, coercion helpers, self-test) so amounts stay EXACT strings
- [x] Readers: listCryptoAssets / listCryptoWallets / getCryptoWallet /
      listCryptoBalances / listCryptoTransactions / listCryptoAssetMigrations /
      getCryptoSyncState / listCryptoPriceSnapshots
- [x] `__runCryptoStoreCoreTests()` wired into pure self-tests + vitest mirror
- [x] Recorded Flare-is-primary-DeFi intel in Bible §2.5 + Roadmap C7/C12
- [x] Battery · PR · merge · report

## C3 — Crypto Portfolio page (shell) ← **SLICE FOUR ✅ DONE (PR #TBD)**
- [x] Dedicated page `src/app/admin/crypto/page.tsx` (3 tabs: Portfolio / Wallets / Health) — mirrors `/admin/plaid` precedent (its OWN page, NOT the banking vault)
- [x] `src/lib/crypto/crypto-ui-core.ts` pure presentation brain: HONEST portfolio totals (only sums priced holdings; held-but-unpriced counted separately, NEVER guessed as $0), exact token-amount formatting (never floats), address masking, add-wallet validation, watch-only posture, sync-health, `__runCryptoUiCoreTests()`
- [x] "Add wallet (watch-only)" server action `src/app/admin/crypto/actions.ts` (gate `settings.manage`, `parseAddWallet` validation, `addWatchOnlyWallet`, audit trail)
- [x] `addWatchOnlyWallet()` write added to `crypto-store.ts` (find-then-insert-or-update; respects the functional `(chain, lower(address))` unique index)
- [x] Nav entry "Crypto Portfolio" → `/admin/crypto` in `admin-nav-data.ts`
- [x] Vitest mirror `tests/compliance/crypto-ui-core.test.ts` + wired into `run-pure-selftests.ts`
- [x] Battery green (self-tests, tsc, eslint 0/0, vitest 272f/3545t, pytest 450, next build) · PR · merge · report

## C4 — XRPL client + mappers
- [x] `xrpl-client-core.ts` pure fair-use policy (throttle 250ms spacing, retry/backoff 500ms→8s cap, retryable-status/error classification, request builders api_version 2) + `__runXrplClientCoreTests()`
- [x] `xrpl-client.ts` server-only shell (single serialized queue, AbortController timeout, marker pagination merge for account_lines, one-page account_tx, endpoint from optional `XRPL_RPC_URL`, defaults to xrplcluster.com — no keys)
- [x] `xrpl-map-core.ts` pure tax-truth mappers + `__runXrplMapCoreTests()`:
  - [x] `rippleTimeToIso` (Ripple epoch = Unix + 946684800s)
  - [x] `decodeCurrencyCode` (3-char as-is / 40-hex ASCII decode / hex passthrough) + `resolveXrplIssuedAssetId` (decoded symbol + exact issuer match, e.g. SOLO)
  - [x] `parseXrplAmount`, `mapAccountInfoBalance`, `mapTrustLineBalance(s)` (drops native XRP + issued tokens, non-zero only)
  - [x] `computeAccountDeltas` reads **AffectedNodes metadata** (AccountRoot XRP final−prev; RippleState low/high-perspective sign-flip; ignores other accounts) — this is the audit-grade source of truth, NOT the tx `Amount` field
  - [x] exact integer/decimal math via BigInt scaling (no floats)
  - [x] `classifyXrplTx` conservative tax taxonomy (sender-fee-only → `fee`; Payment multi-asset → `swap`, single → `transfer`; Offer* → `swap`; TrustSet/AccountSet → `fee`/`other`)
  - [x] `mapAccountTx` v1+v2 API support, one leg per moved asset, fee attached once to sender XRP leg, **partial-payment proof** (uses metadata delivered delta, not `Amount`)
- [x] Battery green (self-tests, tsc, eslint 0/0, vitest 273f/3558t, pytest 450, next build) · PR · merge · report

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
