# Crypto Portfolio Integration — THE BIBLE

> **This is the master reference document for the crypto portfolio feature.**
> It is committed to git so it survives any sandbox reset. If you are picking
> this work up cold, **read this file first**, then `CRYPTO_PORTFOLIO_ROADMAP.md`,
> then `CRYPTO_PORTFOLIO_TASKLIST.md`.
>
> Standing rules apply to every line of this work: **NEVER GUESS · ONE FEATURE
> PER PR · MONEY IN INTEGER MINOR UNITS · GREP-VERIFY EDITS · FULL BATTERY
> BEFORE MERGE · REPORT IN PLAIN ENGLISH.**

---

## 0. Owner & context

- **Owner:** Michael, of **Greenway Marijuana** (WA I-502 retailer, Port Orchard).
- **App:** Supabase-backed Next.js POS / back-office (repo `mblyman89/GREENWAY-WEBSITE`, default branch `main`, Vercel Hobby).
- Michael is a coding novice; **all reports in plain English**.
- This feature lives in the **Banking area** of the back office, alongside the
  existing **Plaid** bank-feed integration.

---

## 1. The vision (Michael's own words, distilled)

> "My vision for the crypto integration feature is to be like the other banking
> integrations. It pulls in all historical data to back-fill, then fetches data
> once per day per account. I want transaction data, I want to be able to handle
> liquidity pool transactions and other types of regular blockchain-related
> activity I have done. I want to go big… so I am bulletproof from the IRS…
> enterprise grade… user friendly… super powerful."

Concretely, the feature must:

1. **Mirror the Plaid pattern.** Each tracked wallet behaves like a bank account:
   connect it once, back-fill full history, then a **once-per-day per-account**
   refresh. Same mental model, same page area, same look & feel.
2. **Full historical back-fill**, then **daily incremental** sync per account.
3. **Rich transaction data** — not just balances. Every transfer in/out, with
   timestamps, counterparties, token, amount, and USD value **at the time of the
   transaction** (critical for tax).
4. **Handle complex on-chain activity**, explicitly including **liquidity-pool
   (LP) transactions** (add/remove liquidity, swaps, LP token mint/burn) and
   other "regular blockchain activity" Michael has done.
5. **Be IRS-bulletproof** — a complete, immutable, auditable record with USD
   cost-basis and gain/loss support (see §4, the tax strategy).
6. **Enterprise-grade, user-friendly, super-powerful.**

### The "platter vs. commercial kitchen" framing (Michael's analogy)

- **Covalent / GoldRush / Bithomp** = a *platter of food*: hosted APIs that hand
  you a finished plate (an address's balances/tx) but cost money at scale and you
  don't own the kitchen.
- **Subsquid + XRP Cluster** = a *commercial kitchen*: free, powerful raw
  infrastructure where **we build the finished product and own the data**. More
  setup, more power, no per-call fees, full control. **This is the chosen path.**

---

## 2. The verified stack (never guess — all confirmed against first-party sources, 2026-08-10)

| Layer | Tool | Covers | Cost | Verified source |
|---|---|---|---|---|
| **EVM chains** | **Subsquid (SQD)** | Ethereum, Flare (ready datasets); Songbird (via EVM-RPC mode); USDT-on-ETH | **Free** (data free; self-host free; Cloud free playground) | docs.sqd.ai network registry + Quickstart + Pricing |
| **XRP Ledger** | **XRP Cluster** (`xrplcluster.com`) | XRP, Sologenic (SOLO), USDT-on-XRPL | **Free** (fair-use: 5 conns / ~1000 msg/min) | xrpl.org Public Servers list (InFTF, full-history, CORS) |
| **USD prices** | **CoinGecko** (free Demo tier) | FLR, SGB, ETH, XRP, SOLO, USDT — current + historical | **Free tier** | coingecko.com asset pages |

**Michael's confirmed detail:** **USDT is on Ethereum** → tracked via Subsquid
as an ERC-20, *not* via XRP Cluster.

### 2.1 Verified chain facts

| Asset | Chain / type | Key facts (verified) |
|---|---|---|
| **Ethereum (ETH)** | EVM, chainId 1 | Subsquid `ethereum-mainnet`, support tier 1 (top). Native ETH 18 decimals. |
| **USDT** | ERC-20 on Ethereum | Contract `0xdAC17F958D2ee523a2206206994597C13D831ec7`, **6 decimals** (NOT 18 — verify at build). Comes through the ETH squid. |
| **Flare (FLR)** | EVM, chainId 14 | Subsquid `flare-mainnet`. Native FLR 18 decimals. Public RPC `https://flare-api.flare.network/ext/C/rpc`. Flare↔Subsquid official partnership (Oct 2023). |
| **Songbird (SGB)** | EVM, chainId 19 | **No Subsquid dataset** → index via EVM-RPC mode against `https://songbird-api.flare.network/ext/C/rpc`. Native SGB 18 decimals. |
| **XRP** | XRPL (non-EVM) | Native via `account_info`. 6 decimals ("drops": 1 XRP = 1,000,000 drops). |
| **Sologenic (SOLO)** | Issued token on XRPL | Issuer `rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz`. Read via `account_lines` (trust-line balance). **Same integration as XRP.** |

> **Decimals are load-bearing.** Every chain has its own smallest unit. We store
> raw integer minor units per token AND a normalized USD-cents value. Confirm each
> token's decimals from an authoritative source at build time — never assume.

### 2.2 What each tool does and does NOT give us

- **Subsquid** gives raw, decoded on-chain data (transactions, token transfers,
  event logs) which we index into **our own Postgres** and query via GraphQL.
  It does **NOT** give fiat/USD prices or ready "portfolio" summaries — we derive
  balances from transfers and add USD from CoinGecko.
- **XRP Cluster** answers standard XRPL API methods (`account_info`,
  `account_lines`, `account_tx`, `gateway_balances`, `account_nfts`). It does
  **NOT** give USD prices.
- **CoinGecko** gives USD prices (current + historical by date) — the piece that
  makes cost-basis and gain/loss possible.

---

## 3. Architecture (how it fits, read-only, mirroring Plaid)

### 3.1 The Plaid model we are mirroring (verified in `src/lib/plaid/store.ts`)

- `PlaidAccountRecord`: `{ id, accountId, itemId, name, officialName, customName,
  mask, type, subtype, role, currentBalanceCents, availableBalanceCents,
  isoCurrencyCode, balancesUpdatedAt, active }`.
- `AccountRole = "main" | "atm" | "credit"`.
- `PlaidTransactionRecord`: `{ transactionId, accountId, amountCents, date,
  authorizedDate, name, merchantName, categoryPrimary, categoryDetailed, pending,
  pendingTransactionId, paymentChannel }`.
- **Sign convention:** POSITIVE `amount_cents` = money OUT; NEGATIVE = money IN.
- Migrations: `create table if not exists`, unique indexes for idempotent upserts,
  `public.set_updated_at()` trigger, RLS staff-only (`public.is_staff()`),
  ships working pre-migration (store treats missing table as "not configured").
- Secrets encrypted at rest via `src/lib/security/at-rest-crypto.ts`
  (`encryptSecret`, `encv1:` prefix); never logged, never sent to browser.
- Banking page: `src/app/admin/settings/banking/{page.tsx,actions.ts,vault-actions.ts}`.

### 3.2 The crypto model (proposed — mirrors Plaid, adds crypto-specific fields)

Think of it as a parallel set of tables, deliberately named `crypto_*`:

- **`crypto_wallets`** — one row per tracked address (the "account").
  - `address` (public, plaintext — NOT a secret), `chain` (enum:
    `ethereum|flare|songbird|xrpl`), `custom_name`, `active`, timestamps.
  - **No private keys. Ever.** Watch-only. (See §5.)
- **`crypto_assets`** — the tokens we know how to value (ETH, USDT, FLR, SGB, XRP,
  SOLO): symbol, name, chain, contract/issuer, **decimals**, coingecko_id.
- **`crypto_balances`** — per wallet × asset: `raw_amount` (numeric/bigint minor
  units), `usd_value_cents`, `balances_updated_at`.
- **`crypto_transactions`** — one row per on-chain event affecting a wallet:
  `tx_hash`, `chain`, `wallet_id`, `timestamp`, `direction` (in/out/self),
  `asset`, `raw_amount`, `usd_value_cents_at_time`, `counterparty`, `tx_type`
  (transfer | swap | lp_add | lp_remove | fee | reward | other), `raw jsonb`
  (full payload, future-proofing — never guess later).
- **`crypto_sync_state`** — per wallet: `last_full_backfill_at`,
  `last_daily_sync_at`, `cursor`/`last_ledger`/`last_block`, `status`.
- **`crypto_price_snapshots`** (optional) — cached CoinGecko prices by
  (asset, date) so historical valuation is reproducible and audit-stable.

> Exact column names/types are finalized per-slice in the migration, mirroring the
> Plaid migration style. This is the shape, not the final DDL.

### 3.3 Money representation (STANDING RULE)

- **Never floats.** Store token amounts as **integer minor units** (raw on-chain
  units) — but note some balances exceed JS safe-integer range, so use Postgres
  `numeric`/`bigint` and handle as **string** in TS where needed (document per
  slice; the Plaid `amount_cents` note already flags string coercion).
- Store **USD value in integer cents**.
- Keep the **raw payload** in `jsonb` so we can re-derive anything later.

### 3.4 The two-phase sync (Michael's explicit requirement)

1. **Full historical back-fill** on connect (all transactions from genesis of the
   wallet's activity). Long-running, chunked, resumable via cursor.
2. **Daily incremental** — once per day per account, pull only new activity since
   the last cursor/ledger/block. Mirrors Plaid's `/transactions/sync` cadence.

---

## 4. IRS / tax strategy — "bulletproof" (the reason we go big)

The whole point of the commercial-kitchen approach is a **complete, immutable,
auditable USD record**. Design principles:

1. **Every taxable event captured.** For crypto, taxable events include: selling
   to fiat, crypto-to-crypto swaps, spending crypto, receiving rewards/airdrops,
   and LP add/remove (often disposals). We must capture **all transaction types**,
   not just simple transfers — hence explicit `tx_type` handling incl. LP.
2. **USD value at the time of each event.** For every transaction we record
   `usd_value_cents_at_time` using CoinGecko's historical price for that date.
   This is the foundation of **cost basis** and **gain/loss**.
3. **Cost-basis lots & disposals.** Later slices compute per-lot acquisition cost
   and realized gain/loss on disposals (support FIFO first; keep the door open for
   other methods). Every number traceable to a source transaction.
4. **Immutability & audit trail.** Store raw payloads; never mutate historical
   rows; snapshot prices so a report run today reproduces tomorrow.
5. **Separation from I-502 operating cash.** Crypto is an **investment portfolio**,
   kept structurally and visually distinct from regulated-business operating funds
   so it never muddies I-502 bookkeeping.
6. **Exportable records.** Produce clean exports (CSV/PDF) suitable for a CPA and
   for IRS forms (e.g., the gain/loss detail behind Form 8949 / Schedule D).

> **We are not giving tax advice.** We are building a faithful, auditable data
> record and reports that Michael's CPA/tax professional can rely on. This
> distinction is stated in the UI and docs.

---

## 5. Security model (non-negotiable)

- **Watch-only / read-only, always.** We track **public wallet addresses only**.
- **We NEVER store, request, or handle a private key or seed phrase.** The app can
  *see* the money; it can never *move* it. This is the crypto equivalent of Plaid
  being read-only on the bank.
- **No signing surface.** No transaction origination, no custody.
- Any API keys/endpoints (CoinGecko key, Subsquid Cloud creds if used) live
  **server-side**, encrypted at rest where secret, never shipped to the browser —
  reuse `src/lib/security/at-rest-crypto.ts`.
- Public addresses are **not** secrets and are stored in plaintext (queryable).
- RLS staff-only on all `crypto_*` tables (`public.is_staff()`), matching Plaid.

---

## 6. Conventions & standing rules (quick reference)

- **NEVER GUESS.** Verify every fact (chain IDs, decimals, endpoints, method
  names) against first-party docs before coding. Keep the `raw jsonb`.
- **ONE FEATURE PER PR.** Each slice is a single, self-contained PR.
- **MONEY IN INTEGER MINOR UNITS** (token raw units + USD cents). No floats.
- **PURE CORES FIRST.** Business logic goes in pure, testable core modules
  (mirror `vendor-reconcile-core.ts`, `payroll-core.ts`) with `__run…Tests()`
  self-tests wired into `scripts/compliance/run-pure-selftests.ts`, plus a vitest
  mirror in `tests/compliance/`.
- **GREP-VERIFY EDITS.** After every edit, grep to confirm.
- **FULL BATTERY before merge** (exact order):
  1. `npx tsx scripts/compliance/run-pure-selftests.ts` → exit 0 + final line
     `ALL PURE SELF-TESTS PASSED`.
  2. `npx tsc --noEmit` → clean.
  3. `npx eslint <touched files>` → **0 errors AND 0 warnings**.
  4. `npx vitest run` → baseline green (record new baseline count each slice).
  5. `cd crawler && python3 -m pytest -q` → all pass.
  6. `next build` (OOM workaround: inject `typescript.ignoreBuildErrors` +
     `eslint.ignoreDuringBuilds` into `next.config.ts`, build with
     `NODE_OPTIONS=--max-old-space-size=3072`, then RESTORE config identical —
     grep-verify + `diff` clean).
- **AGENT owns git ops:** branch, push via
  `https://x-access-token:$GITHUB_TOKEN@github.com/mblyman89/GREENWAY-WEBSITE.git`,
  `gh pr create`, `gh pr checks <N> --watch`, `gh pr merge <N> --squash
  --delete-branch`, then sync main.
- **Required check name:** `compliance`.
- **SHIPS WORKING PRE-MIGRATION.** Store layer treats a missing table as "not
  configured / no data yet" so nothing breaks before the migration runs.
- **DOCS LIVE IN GIT** (this folder) so a sandbox reset never loses the bible.

---

## 7. Glossary (plain English for Michael)

- **Squid** — a small Subsquid program that pulls and stores blockchain data.
- **Portal / data lake** — Subsquid's free source of fast blockchain data.
- **EVM** — the "Ethereum-style" family (Ethereum, Flare, Songbird use it).
- **XRPL** — the XRP Ledger (a different, non-EVM system; XRP + Sologenic live here).
- **Trust line** — how XRPL holds non-XRP tokens (SOLO, USDT-on-XRPL show up here).
- **Minor units / decimals** — the smallest whole-number unit of a coin (like cents
  for dollars). We store these as integers so math is exact.
- **LP (liquidity pool) transaction** — adding/removing funds to a trading pool, or
  swapping through one; often a taxable event.
- **Cost basis** — what you paid (in USD) for what you hold; needed for taxes.
- **Watch-only** — we can see a wallet but can never move its funds.

---

## 8. Source-of-truth links (verified 2026-08-10)

- Subsquid docs: https://docs.sqd.ai/ · network registry `cdn.subsquid.io/archives/evm.json`
- Subsquid Quickstart: https://docs.sqd.ai/en/sdk/squid-sdk/evm/quickstart
- Subsquid EVM-RPC source (for Songbird): https://docs.sqd.ai/en/sdk/squid-sdk/evm/reference/evm-rpc-stream
- Subsquid pricing: https://docs.sqd.ai/en/cloud/pricing/overview
- Flare×Subsquid announcement: https://flare.network/news/flare-integrates-with-subsquid-for-broader-open-source-access-to-blockchain-data
- XRPL Public Servers (XRP Cluster): https://xrpl.org/docs/tutorials/public-servers
- XRP Cluster service: https://xrplcluster.com
- XRPL API methods: https://xrpl.org (account_info / account_lines / account_tx)
- CoinGecko API: https://www.coingecko.com/en/api
- Flare dev hub: https://dev.flare.network

_Last updated: 2026-08-10._
