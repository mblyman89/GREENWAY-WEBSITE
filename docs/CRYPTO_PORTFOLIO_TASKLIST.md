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
- [x] `xrpl-sync-core.ts` PURE sync brain + `__runXrplSyncCoreTests()`:
  - [x] `unsignMinor`/`unsignDecimal` (split SIGNED mapped amount → UNSIGNED magnitude + `direction`, exact BigInt/decimal, enforces XRPL 15-sig-digit ceiling)
  - [x] `buildBalanceUpserts` (MappedBalance → crypto_balances rows; USD left null — never guessed; untracked tokens skipped FK-safe but surfaced via `untrackedBalances`, never dropped)
  - [x] `buildTransactionUpserts` (MappedTransaction → crypto_transactions rows; unsigned amount + direction; fee once; **full source envelope preserved in `raw` jsonb** for audit; untracked-token note merged into `raw`)
  - [x] backfill state machine `initXrplBackfill`/`reduceXrplBackfill`/`shouldContinueBackfill` (opaque `marker` walk, oldest-first, page guard `MAX_XRPL_BACKFILL_PAGES`)
  - [x] `serializeMarker`/`deserializeMarker` (marker ⇄ text cursor), `buildSyncStateUpsert`, `XrplSyncCounts` + `summarizeXrplSync`
- [x] `crypto-store.ts` server-only writers (idempotent on verified unique indexes; graceful not-configured; chunked): `upsertCryptoBalances` (wallet_id,asset_id), `upsertCryptoTransactions` (wallet_id,tx_hash,event_index), `upsertCryptoSyncState` (wallet_id)
- [x] `xrpl-sync-server.ts` server-only orchestrator `syncXrplWallet(walletId)`: mark backfilling → balances (account_info + account_lines) → upsert; walk account_tx by marker → map (C4) → upsert per page → persist resume cursor after each page; final cursor null + backfill_complete on finish; never throws (records 'error' state + friendly message, resumes next run). Watch-only, no keys, USD never written.
- [x] wire `__runXrplSyncCoreTests` into run-pure-selftests + vitest mirror (13 tests incl signed→unsigned, idempotent-key, backfill pagination, raw-payload-retained, error-keeps-cursor proofs)
- [x] Battery green (self-tests; tsc; eslint 0/0; vitest 274f/3571t; pytest 450; next build) · PR · merge · report

## ARCHITECTURE NOTE (approved by Michael — supersedes the old Subsquid plan)
The EVM chains (Ethereum, Flare, Songbird) use the SAME in-app connect → backfill →
once-per-day-refresh pattern as the XRPL (C4/C5) and Plaid banking integrations — an
**in-app poller** that reads a free explorer/RPC API. There is NO standalone Subsquid
indexer or extra Postgres (that would not fit Vercel Hobby, and would add infra Michael
would have to run). This keeps everything watch-only, key-light, and inside the one app.

## C6 — EVM tax-truth mappers (pure) ✅
- [x] `evm-map-core.ts` PURE mappers + `__runEvmMapCoreTests()`, producing the SAME
      `MappedTransaction` shape the XRPL mappers emit (so C5's `buildTransactionUpserts`
      + crypto-store writers persist EVM legs for free):
  - [x] Verified constant `ERC20_TRANSFER_TOPIC0` = keccak256("Transfer(address,address,uint256)")
        `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef`
  - [x] `isErc20TransferLog` (topic0 match **AND exactly 3 topics**) vs `isErc721TransferLog`
        (same topic0 but **4 topics** — NFTs REJECTED so they are never mis-ingested as fungible)
  - [x] `topicToAddress` (32-byte left-padded indexed topic → last 20 bytes, lower-cased)
  - [x] `hexToDecimalString` (uint256 hex/decimal → EXACT BigInt decimal string; max-uint256 proven)
  - [x] `resolveEvmAssetByContract` chain-scoped, lower-cased (USDT-eth 6-dec resolves on
        ethereum only, NOT 18-dec, NOT on flare); untracked tokens KEPT (assetId null +
        contract recorded), never silently dropped
  - [x] `directionForParties` (from=out / to=in / both=self); on-chain unsigned uint256 →
        SIGNED emitted amount (negative = leaving the wallet)
  - [x] `mapNativeTransfer` (ETH/FLR/SGB, 18-dec, fee = gasUsed×effectiveGasPrice in native,
        attributed to the sender only) and `mapErc20TransferLog(s)` (fee attached at most ONCE
        across all legs of a tx)
- [x] Wired `__runEvmMapCoreTests` into run-pure-selftests + vitest mirror (18 tests)
- [x] Battery green (self-tests; tsc; eslint 0/0; vitest 275f/3589t; pytest 450; next build) · PR · merge · report

## C6b — EVM fetch + store wiring (in-app poller)
- [x] DEEP-RESEARCH & document the exact FREE fetch API per chain (PR #885):
      Ethereum → Etherscan V2 unified multichain (free key, ~5 calls/sec);
      Flare → Flare's official Blockscout explorer (keyless);
      Songbird → Songbird's official Blockscout explorer (keyless).
      All three speak the same Etherscan-compatible API: account/balance,
      account/txlist, account/tokentx, proxy/eth_blockNumber. Verified LIVE.
- [x] `evm-client-core.ts` PURE fair-use policy (URL/query builders per chain,
      throttle 220ms spacing, retry/backoff 500ms→8s cap, retryable-status +
      rate-limit-message classification, block-range cursor model
      `nextStartBlock:lastConsumedBlock`, response interpretation, page-size
      clamping, block-number proxy parser) + `__runEvmClientCoreTests()`
- [x] `evm-sync-core.ts` PURE sync brain + `__runEvmSyncCoreTests()`:
  - [x] `mapEvmNativeBalance` / `mapEvmTokenBalance` (MappedBalance producers)
  - [x] `deriveTokenBalancesFromHistory` (sum in−out per ERC-20 contract from
        tokentx history → current net balances; zero-net skipped; negative floored at 0)
  - [x] `txListRowToNativeTransfer` (fee = gasUsed×gasPrice wei; timestamp→ISO)
  - [x] `tokenTxRowToEvmLog` (reconstructs 3-topic ERC-20 Transfer log shape from
        decoded tokentx rows, so the C6 mapper consumes them unchanged)
  - [x] block-range backfill state machine `initEvmBackfill`/`reduceEvmBackfill`/
        `shouldContinueEvmBackfill`/`currentWindowEnd`/`currentCursorString`
        (ascending 10000-block windows; FULL page → narrow by half down to 250
        blocks + re-request same start so NO data is skipped; at minimum window
        + still full → advance past consumed rows keeping tight window; empty
        window → advance + reset; done at tip or 50000-window guard)
  - [x] REUSES the chain-agnostic XRPL sync-core row builders + crypto-store
        writers (`buildBalanceUpserts`, `buildTransactionUpserts`,
        `buildSyncStateUpsert`, `untrackedBalances`) — EVM legs persist for free
  - [x] `EvmSyncCounts` + `addEvmWindowCounts` + `summarizeEvmSync`
- [x] `evm-client.ts` server-only shell: per-chain base URL (built-in defaults +
      optional env overrides `ETHERSCAN_API_URL`/`FLARE_EXPLORER_URL`/
      `SONGBIRD_EXPLORER_URL`), per-chain API key (only Ethereum reads
      `ETHERSCAN_API_KEY`; Flare/Songbird keyless), serialized queue + 220ms
      spacing, AbortController 20s timeout, retry/backoff; public methods
      `fetchNativeBalance`, `fetchTxList`, `fetchTokenTx`, `fetchTipBlockNumber`,
      `evmEndpointConfigured`, `evmExplorerBase`. Watch-only, no keys, no writes.
- [x] `evm-sync-server.ts` orchestrator `syncEvmWallet(walletId)`: mark
      backfilling → fetch tip (proxy eth_blockNumber) → sync balances (native +
      ERC-20 derived from full tokentx history) → walk txlist+tokentx by ascending
      block range → map via C6 + sync-core → upsert per window → persist cursor
      after every window → final null cursor + backfill_complete on finish; never
      throws (records 'error' state + friendly message, resumes next run). Returns
      `EvmWalletSyncResult`.
- [x] Wire `__runEvmClientCoreTests` + `__runEvmSyncCoreTests` into
      run-pure-selftests + vitest mirrors (51 tests across 2 files)
- [x] Battery · PR · merge · report

## C6c — Sync trigger ("Sync now" wiring — makes wallets actually pull data)
The sync orchestrators (syncXrplWallet C5, syncEvmWallet C6b) existed but were
NEVER called from anywhere — Michael could connect wallets but nothing pulled
data. This slice wires them in, mirroring Plaid's runPlaidSyncNowAction.
- [x] `src/lib/crypto/crypto-sync-orchestrator.ts` (server-only): runAllCryptoSync()
      — list active wallets → dispatch by chain (XRPL→syncXrplWallet,
      EVM→syncEvmWallet, Cosmos→friendly skip "coming in C8b") → aggregate
      per-wallet results into plain-English summary → never throws. Also
      syncOneCryptoWallet(walletId) for single-wallet sync.
- [x] `addWatchOnlyWallet` in crypto-store.ts upgraded to return `walletId`
      (backward-compatible: existing callers ignore the new field).
- [x] `runCryptoSyncNowAction` added to actions.ts (gate settings.manage →
      runAllCryptoSync → audit "crypto.sync.manual" → back to Health tab
      with msg/error). Mirrors Plaid's runPlaidSyncNowAction exactly.
- [x] "Sync now" button + "Pull latest activity" card wired into the Health tab
      of page.tsx (mirrors Plaid Health tab layout).
- [x] Updated buildSyncHealth "not synced yet" message + page header comments.
- [x] Wallet-connect message now guides to "Sync now" on the Health tab.
- [x] Battery green (self-tests, tsc, eslint 0/0, vitest 277f/3640t, pytest 450, next build) · PR · merge · report

## C7 — Flare (heaviest DeFi slice: LPs, rewards)
- [ ] Point the C6b poller at Flare; verify FLR native + tracked tokens; wire to store
- [ ] Battery · PR · merge · report

## C8 — Songbird
- [ ] Point the C6b poller at Songbird (SGB native) via its public RPC; wire to store
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

_Last updated: 2026-08-11 (C6b EVM fetch+store wiring built — client-core, sync-core, server-only client + orchestrator, vitest mirrors; battery pending)._
