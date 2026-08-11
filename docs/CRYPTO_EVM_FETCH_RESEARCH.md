# EVM fetch-layer research (C6b) — verified first-party, 2026-08-11

> Purpose: nail down the EXACT, FREE way our in-app poller reads Ethereum, Flare,
> and Songbird activity for a watch-only wallet, so C6b (`evm-client-core.ts` +
> `evm-client.ts` + `evm-sync-server.ts`) can be built without guessing. Every
> fact below was verified against a first-party source or a live request on
> 2026-08-11.

## Decision (approved by Michael): in-app poller, no Subsquid
The EVM chains use the SAME pattern as XRPL (C4/C5) and Plaid: connect a public
address → full historical backfill → once-per-day incremental refresh, all inside
the Next.js app. No standalone Subsquid indexer, no extra Postgres (that would not
fit Vercel Hobby and would be infra Michael must run).

## One API shape for all three chains
All three chains are read through an **Etherscan-compatible REST API** exposing the
same `account` actions. This lets ONE client abstraction serve every chain by
swapping the base URL (and, for Ethereum only, adding a free API key + `chainid`).

| Action | Returns | We use it for |
|---|---|---|
| `?module=account&action=balance&address=…` | native balance (wei) | current native (ETH/FLR/SGB) balance |
| `?module=account&action=txlist&address=…&startblock=&endblock=&sort=asc` | native-coin (value) transactions, paged | native transfers + the fee fields (`gasUsed`, `gasPrice`) |
| `?module=account&action=tokentx&address=…&startblock=&endblock=&sort=asc` | ERC-20 Transfer events touching the address, paged | ERC-20 legs (USDT, Flare tokens, etc.) |

`tokentx` returns fully-decoded rows with exactly the fields our `evm-map-core`
mappers consume: `value`, `from`, `to`, `contractAddress`, `tokenDecimal`,
`tokenSymbol`, `blockNumber`, `timeStamp`, `hash`, `gasUsed`, `gasPrice`. (Verified
live against the Flare explorer on 2026-08-11.)

Pagination is `page`/`offset` **or** block-range windows (`startblock`/`endblock`).
For an auditable, resumable backfill we walk by **ascending block range** and store
the last-seen block as the resume cursor (mirroring the XRPL marker cursor). This is
idempotent because our natural key is `(wallet_id, tx_hash, event_index)`.

## Per-chain verified endpoints

### Ethereum (chainId 1, native ETH 18 dec)
- **API:** Etherscan API **V2**, unified multichain:
  `https://api.etherscan.io/v2/api?chainid=1&module=account&action=…`
- **Key:** a FREE Etherscan API key is required. Free tier ≈ **5 calls/sec, 100,000
  calls/day** — ample for a once-per-day per-wallet sync. Stored as an env var
  (`ETHERSCAN_API_KEY`); watch-only, read-only.
- Etherscan V2 covers 64 chains under one key (verified via
  `https://api.etherscan.io/v2/chainlist`), but **does NOT include Flare(14) or
  Songbird(19)** — those use their own explorers below.
- USDT-on-Ethereum ERC-20: `0xdac17f958d2ee523a2206206994597c13d831ec7`, **6 decimals**.

### Flare (chainId 14, native FLR 18 dec)
- **API:** Flare's official Blockscout explorer, Etherscan-compatible, **NO key**:
  `https://flare-explorer.flare.network/api?module=account&action=…`
- **Public JSON-RPC (fallback / balances):** `https://flare-api.flare.network/ext/C/rpc`
- Verified live 2026-08-11: `eth_block_number` and `account/tokentx` both return
  correct, fully-decoded data.
- Flare is Michael's PRIMARY DeFi venue → C7 adds LP/swap/reward classification on
  top of these same transfer feeds (raw preserved in `crypto_transactions.raw`).

### Songbird (chainId 19, native SGB 18 dec)
- **API:** Songbird's official Blockscout explorer, Etherscan-compatible, **NO key**:
  `https://songbird-explorer.flare.network/api?module=account&action=…`
- **Public JSON-RPC (fallback / balances):** `https://songbird-api.flare.network/ext/C/rpc`
- Verified live 2026-08-11: `eth_block_number` returns correctly.

## Fee facts (all three chains)
- Fee = `gasUsed × effectiveGasPrice` (wei), paid by the tx SENDER in the native
  coin, attributed exactly once. Flare/Songbird burn fees (Type0: `gasUsed*gasPrice`;
  Type2/EIP-1559: `(baseFee+priorityFee)*gas`) — the numeric fee is still
  `gasUsed × gasPrice` from the `txlist`/receipt fields.

## What C6b will build (mirrors XRPL C4/C5)
1. `evm-client-core.ts` — PURE: URL/query builders for `balance`/`txlist`/`tokentx`
   per chain, a fair-use throttle+backoff policy, response-row typing, and a
   block-range cursor model. Self-tested; no network.
2. `evm-client.ts` — server-only shell: performs the fetch with a timeout, reads
   the base URL per chain + optional `ETHERSCAN_API_KEY` from env, no other keys.
3. `evm-sync-server.ts` — orchestrator `syncEvmWallet(walletId)` mirroring
   `syncXrplWallet`: mark backfilling → native balance → walk `txlist` + `tokentx`
   by ascending block range → map via `evm-map-core` → upsert per page via the C5
   crypto-store writers → persist resume cursor after every page → daily
   incremental thereafter. Never throws; records an `error` state and resumes.

_Last updated: 2026-08-11 (C6b fetch-layer research; verified live)._
