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

> **⚠️ ARCHITECTURE UPDATE (2026-08-11, approved by Michael) — read this first.**
> The EVM delivery mechanism below has changed. We are **NOT** running a standalone
> Subsquid indexer + Postgres. Instead the EVM chains use an **in-app poller** that
> reads a FREE explorer/RPC API, mirroring the XRPL (C4/C5) and Plaid banking
> integrations (connect → full backfill → once-per-day refresh), all inside the one
> Next.js app — because a separate Subsquid service does not fit Vercel Hobby and
> would be infra Michael must run. **The chain FACTS in the tables below (chainIds,
> decimals, RPC endpoints, contract addresses) remain fully valid and are exactly
> what the in-app poller uses.** Only the "how we fetch/host" line changed: wherever
> a row says "Subsquid", read it as "fetched by our in-app poller via the free
> explorer/RPC for that chain". See ROADMAP Phase 4 (C6/C6b/C7/C8) for the plan.

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

### 2.3 Cosmos chains — Coreum & Pulsara (added 2026-08-10, per Michael)

Michael also holds assets on **Coreum** and **Pulsara**. These are a THIRD
technology family (neither EVM nor XRPL):

- **Coreum** — a Cosmos SDK Layer-1 (chain-id `coreum-mainnet-1`, verified via
  Polkachu). Read with the standard **Cosmos REST/LCD + RPC** API — e.g. balances
  via `/cosmos/bank/v1beta1/balances/{address}`, transactions via Tendermint
  `tx_search`. Public free endpoints exist (Polkachu: `coreum-api.polkachu.com`,
  `coreum-rpc.polkachu.com`; comparenodes lists more). NO Subsquid EVM archive
  and NO XRP Cluster — a Cosmos connector is its own connector.
- **Pulsara** — a decentralized DeFi ecosystem **built ON Coreum** (token
  issuance, governance, **liquidity pools**, trading; governance token `SARA`).
  Because it lives on Coreum, Pulsara activity (incl. LP add/remove/swap) is read
  through the **same Coreum Cosmos endpoints** — it is not a separate chain. This
  is a primary source of Michael's liquidity-pool transactions (ties to C12).
- **Amounts (Cosmos model):** balances/amounts are integer strings in the token's
  smallest unit (`amount` + `denom`), and the human decimals come from the chain's
  `bank` denom **metadata** (`/cosmos/bank/v1beta1/denoms_metadata`, the `exponent`
  of the display unit). **Coreum native (TX, formerly CORE): base denom `ucoreum`
  (microcoreum), 1 Coreum = 1,000,000 ucoreum → 6 decimals — VERIFIED via BitGo
  Coreum docs.** For issued tokens like SARA (Pulsara) we READ the exponent from
  live denom-metadata during the connector slice and store `decimals` as DATA per
  asset — we do NOT hardcode a guessed decimal count. Coreum address prefix =
  `core1…` (bech32), also verified via BitGo. This is the same
  integer-minor-unit + decimals model as EVM (`amountModel: "evm-minor"` fits),
  so crypto-core already handles it; only the source/format of reads differs.

### 2.4 ⚠️ LIVE EVENT: Coreum + Sologenic → "TX" merger/migration (verified 2026-08-10)

Confirmed via TX Labs' official GlobeNewswire release (2026-02-17), CoinMarketCal,
CoinCarp and multiple exchanges (Bitrue, Coins.ph):

- Following an on-chain Coreum governance vote (**87.22% yes**), **Coreum
  (COREUM/CORE) and Sologenic (SOLO) are BOTH migrating/converting into a single
  new unified token "TX"**. TX platform go-live early **March 2026**; a TX Token
  Generation Event is dated **06 March 2026**.
- **Why this matters for TAXES (bulletproof concern):** a token merger/conversion
  is a real event that affects **cost basis** and may be a taxable disposal. Our
  ledger must be able to represent a migration/redenomination event (old SOLO and
  old CORE lots → new TX lots) WITHOUT losing original cost basis or history.
- **Impact on our registry:** the `solo` asset already in `crypto-core` is one leg
  of this. We must NOT silently rewrite it; we track SOLO as-held, track CORE as-
  held, and add TX + a migration/mapping concept so history stays intact and
  auditable. Exact conversion ratio + mechanics = OPEN QUESTION for Michael /
  to verify from tx.org FAQ before we encode any ratio (never guess a ratio).

### 2.5 ⭐ Flare is Michael's PRIMARY DeFi venue (added 2026-08-10, per Michael)

Michael told us directly: *"I almost exclusively use Flare for all things DeFi.
My other assets are just sitting in my wallet."* This single fact reshapes where
the hardest, most tax-critical engineering effort goes:

- **Flare (chain-id 14, EVM) is the ONE chain where real DeFi activity happens**:
  liquidity-pool adds/removes, swaps, LP-token mint/burn, staking/reward claims,
  wrapping (WFLR), and delegation. This is exactly the activity the IRS cares
  about most, because each swap/LP-remove/reward can be a **taxable disposal or
  income event** with its own cost basis.
- **His other holdings (ETH, USDT-on-ETH, XRP, SOLO, Coreum/TX, Pulsara/SARA)
  mostly just SIT in the wallet.** They still need complete, auditable
  transfer/balance history (we never cut corners), but they are lower-complexity:
  mostly plain transfers, plus the one Pulsara LP case on Coreum and the CORE/SOLO
  →TX migration. So the effort budget is deliberately weighted toward Flare.
- **Engineering consequences (front-loaded so nothing is a surprise later):**
  - **C7 (Flare connector) is the heaviest EVM slice, not a copy of C6.** Beyond
    native FLR + ERC-20 transfers, it must capture the *contract-interaction*
    surface: DEX router swaps, LP pair mint/burn (Uniswap-V2-style
    `Mint`/`Burn`/`Swap` events), reward/claim events, and WFLR deposit/withdraw.
    Raw logs are preserved in `crypto_transactions.raw` so classification (C12)
    can be re-derived if we learn more — never guess a type at ingest.
  - **C12 (LP & complex-activity classification) is the tax-make-or-break slice**,
    and Flare is its primary target. `tx_type` (transfer/swap/lp_add/lp_remove/
    reward/fee/other) must be assigned by a PURE, fixture-tested classifier from
    the decoded event shape — not by heuristics-that-drift. Every Flare LP/DeFi
    event must land as an explicit, auditable `tx_type` with the source log kept.
  - **C13 (cost-basis) must treat LP add/remove correctly**: adding liquidity is
    typically a disposal of the deposited tokens into an LP position; removing
    liquidity re-acquires tokens at a new basis; swaps are dispositions. Getting
    the Flare LP lifecycle right is the core of "IRS-bulletproof" for Michael.
- **We will give Flare "heavy, expert" treatment when C7/C12 arrive** — Michael
  explicitly asked for this. Until then: the schema (0160) and read layer (C2)
  are already built to hold rich DeFi rows (`tx_type` enum incl. lp_add/lp_remove,
  `raw jsonb`, per-event fee, direction, counterparty), so no rework is needed —
  only careful population when the Flare connector lands. **DeFi mechanics on
  Flare (exact DEX/router/pool contracts Michael uses) are an OPEN ITEM to
  confirm from his wallet history before we hard-code any protocol addresses —
  never guess a contract.**

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

---

## 9. Build log (what has actually shipped)

- **C0 — Docs + pure primitives** — DONE. `crypto-core.ts` (chains, assets,
  address validation, exact amount formatting) + these docs.
- **C1 — `crypto_*` schema foundation** — DONE (PR #877, merged ccb3061b).
  Migration only; app ships working pre-migration (store guards added in C2).
- **C2 — Crypto store (read-only) + "not configured" safety** — DONE
  (PR #879, merged b6b8f3d2; docs PR #880 merged 6b689485). Typed readers over
  every `crypto_*` table; return empty/null when tables are missing.
- **C3 — Crypto Portfolio page (shell)** — DONE. Its OWN page `/admin/crypto`
  (Portfolio / Wallets / Health tabs), mirroring the `/admin/plaid` precedent
  rather than the Banking vault. Pure presentation brain `crypto-ui-core.ts`
  delivers **HONEST portfolio totals** (only priced holdings sum; held-but-unpriced
  are shown separately, never guessed as $0), **exact token amounts** (never
  floats), watch-only assurance, and sync-health read-outs. "Add wallet
  (watch-only)" server action (gate `settings.manage` → validate → store → audit)
  backed by `addWatchOnlyWallet()` in the store (respects the functional
  `(chain, lower(address))` unique index). Nav entry added. Full battery green.
- **C4 — XRPL client + pure tax-truth mappers** — DONE. Read-only XRP Ledger
  connector against `xrplcluster.com` (HTTPS JSON-RPC, api_version 2, no keys).
  Three files under `src/lib/crypto/xrpl/`:
  - `xrpl-client-core.ts` — PURE fair-use policy (250ms request spacing;
    retry/backoff 500ms→8s cap; retryable HTTP-status + RPC-error classification;
    request builders for `account_info`/`account_lines`/`account_tx`) with
    `__runXrplClientCoreTests()`.
  - `xrpl-client.ts` — server-only shell (single serialized request queue so we
    never burst the public cluster; AbortController timeout; follows `marker`
    pagination merging every trust line; one-page `account_tx`). Endpoint is
    overridable via optional `XRPL_RPC_URL`, else defaults to the cluster.
  - `xrpl-map-core.ts` — the **tax-truth engine**. Instead of trusting the tx
    `Amount` field, it reads the ledger **AffectedNodes metadata** to compute the
    exact balance change to the tracked account (AccountRoot XRP delta = final −
    previous; RippleState token delta with correct low/high-account perspective
    sign-flip; other accounts' nodes ignored). Consequences: **partial payments
    record the delivered amount, not the requested amount**; the network fee is
    already netted into the sender's XRP delta and is attributed exactly once.
    All math is exact integer/BigInt-scaled decimal (never floats). Also: Ripple
    epoch → ISO time (Unix + 946684800s), currency-code decode (3-char + 40-hex
    ASCII), issuer-exact asset resolution (so SOLO only matches its real issuer),
    a conservative tax taxonomy (sender-fee-only→`fee`; multi-asset Payment→`swap`,
    single→`transfer`; Offer*→`swap`; TrustSet/AccountSet→`fee`/`other`), and both
    v1 + v2 API response shapes. `__runXrplMapCoreTests()` runs real-shaped
    fixtures incl. a partial-payment proof and a failed-TrustSet fee-only proof.
  Vitest mirror `tests/compliance/xrpl-map-core.test.ts` (13 tests, incl. the
  partial-payment and fee-attribution proofs). Both self-tests wired into
  `run-pure-selftests.ts`. Full battery green (self-tests; tsc; eslint 0/0;
  vitest 273 files / 3558 tests; pytest 450; next build).

- **C5 — XRPL balances + backfill wiring (read → store)** — DONE. Turns the C4
  reader into real database population. Three parts:
  - `src/lib/crypto/xrpl/xrpl-sync-core.ts` (PURE brain): the row-builders and
    the backfill state machine. Its most important job is **splitting C4's
    SIGNED mapped amounts into an UNSIGNED magnitude plus a `direction`** (the DB
    stores magnitude + in/out/self), done with exact BigInt/decimal helpers that
    also enforce XRPL's real 15-significant-digit ceiling — never a float.
    Transaction rows carry the idempotent natural key `(wallet_id, tx_hash,
    event_index)` and stash the **entire untouched source envelope in the `raw`
    jsonb column** so the ledger truth is provable in an audit without re-fetching.
    A held token we don't yet model is **never dropped** — it's kept with a
    currency/issuer note. The state machine walks `account_tx` by opaque `marker`
    oldest-first with a hard page guard.
  - `src/lib/crypto/crypto-store.ts` (server-only) gains three idempotent writers
    — `upsertCryptoBalances`, `upsertCryptoTransactions`, `upsertCryptoSyncState`
    — each targeting the UNIQUE index proven in migration 0160
    (wallet+asset / wallet+hash+event / wallet), chunked, and graceful when the
    DB isn't configured (a no-op success, never a crash). USD value is never
    written here; pricing is a later slice and we never guess a dollar amount.
  - `src/lib/crypto/xrpl/xrpl-sync-server.ts` (server-only) orchestrator
    `syncXrplWallet(walletId)`: mark backfilling → fetch balances (`account_info`
    + `account_lines`) → upsert → walk `account_tx` by marker, mapping and
    upserting each page, **persisting the resume cursor after every page** so a
    crash or rate-limit picks up exactly where it left off. It never throws to
    the UI: any failure records an `error` sync-state with a friendly message and
    returns, keeping the resume cursor. Watch-only, public address only, no keys.
  Vitest mirror `tests/compliance/xrpl-sync-core.test.ts` (13 tests, incl.
  signed→unsigned, idempotent-key, backfill-pagination, raw-payload-retained,
  and error-keeps-cursor proofs). Self-test wired into `run-pure-selftests.ts`.
  Full battery green (self-tests; tsc; eslint 0/0; vitest 274 files / 3571 tests;
  pytest 450; next build).

- **C6 (EVM tax-truth mappers, pure) — shipped.**
  `src/lib/crypto/evm/evm-map-core.ts` turns raw EVM chain data (native ETH/FLR/SGB
  transfers + ERC-20 Transfer logs) into the SAME `MappedTransaction` shape the
  XRPL mappers emit, so C5's `buildTransactionUpserts` + crypto-store writers
  persist EVM legs with ZERO extra code. Everything is grounded in first-party
  facts (EIP-20/EIP-721, Yellow Paper), never guessed:
  - The ERC-20 Transfer topic0 is the verified constant
    `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef`. A
    genuine ERC-20 Transfer log has **exactly 3 topics** (`[topic0, from, to]`)
    with the `value` in `data`; an ERC-721 (NFT) transfer shares that same topic0
    but has **4 topics** (the tokenId is indexed) — so 4-topic logs are REJECTED
    and NFTs can never be mis-ingested as fungible token moves.
  - On-chain amounts are unsigned uint256; we parse them with BigInt to an EXACT
    decimal string (max-uint256 proven) — no floats ever — and emit a SIGNED
    amount (negative = leaving the wallet) after deriving direction (from=out,
    to=in, both=self).
  - Contract resolution is chain-scoped and lower-cased, so USDT-on-Ethereum
    (6 decimals, NOT 18) resolves on Ethereum only. An untracked token is KEPT
    (assetId null, contract recorded as a currency/issuer note) — never dropped.
  - The network fee (`gasUsed × effectiveGasPrice`, in the chain's native coin)
    is charged to the transaction sender only and attributed exactly once across
    all legs of a transaction.
  Vitest mirror `tests/compliance/evm-map-core.test.ts` (18 tests). Self-test
  wired into `run-pure-selftests.ts`. Full battery green (self-tests; tsc;
  eslint 0/0; vitest 275 files / 3589 tests; pytest 450; next build).
  **Architecture note:** the EVM fetch layer is an in-app poller over a free
  explorer/RPC (NOT Subsquid) — see the §2 banner and ROADMAP Phase 4.

- **C6b (EVM fetch + store wiring, in-app poller) — built (battery + PR pending).**
  Mirrors the XRPL C4/C5 connect→backfill→daily-refresh pattern, turning the C6
  mappers into real network reads + database writes for Ethereum, Flare, and
  Songbird. All three chains speak the same Etherscan-compatible REST API
  (deep-researched + verified LIVE, PR #885):
  - **Ethereum** → Etherscan V2 unified multichain (`api.etherscan.io/v2/api`).
    Requires a FREE API key (`ETHERSCAN_API_KEY` env var). Free tier ≈ 5
    calls/sec, 100k calls/day.
  - **Flare** → Flare's official Blockscout explorer
    (`flare-explorer.flare.network/api`). NO key required.
  - **Songbird** → Songbird's official Blockscout explorer
    (`songbird-explorer.flare.network/api`). NO key required.
  Actions used: `account/balance` (native coin balance in wei), `account/txlist`
  (native transfers + gas/fee fields), `account/tokentx` (decoded ERC-20 Transfer
  events), `proxy/eth_blockNumber` (chain tip to bound the backfill).
  - **`evm-client-core.ts`** (pure): per-chain URL/query builders, 220ms throttle
    spacing, retry/backoff (500ms→8s cap), rate-limit + retryable-HTTP
    classification, block-range cursor (`nextStartBlock:lastConsumedBlock`),
    response interpretation, page-size clamping, block-number proxy parser.
  - **`evm-sync-core.ts`** (pure): native + ERC-20 balance mapping,
    `deriveTokenBalancesFromHistory` (sums in−out per contract from the full
    tokentx history → current net balances), row→mapper-input converters
    (reconstructs the 3-topic ERC-20 Transfer log shape from decoded tokentx rows
    so the C6 mapper consumes them unchanged), and the block-range backfill state
    machine: ascending 10000-block windows; a FULL page narrows the window by
    half (down to 250 blocks) and re-requests the SAME start block so NO data is
    ever skipped; at the minimum window + still full, it advances past consumed
    rows keeping the tight window; empty windows advance + reset; a 50000-window
    guard prevents a runaway endpoint from spinning forever. **Reuses the
    chain-agnostic XRPL sync-core row builders + crypto-store writers**
    (`buildBalanceUpserts`, `buildTransactionUpserts`, `buildSyncStateUpsert`,
    `untrackedBalances`) — EVM legs persist with ZERO duplicated persistence code.
  - **`evm-client.ts`** (server-only): per-chain base URL (built-in defaults +
    optional env overrides `ETHERSCAN_API_URL`/`FLARE_EXPLORER_URL`/
    `SONGBIRD_EXPLORER_URL`), per-chain API key (only Ethereum reads
    `ETHERSCAN_API_KEY`; Flare/Songbird keyless), serialized queue + 220ms
    spacing, AbortController 20s timeout, retry/backoff. Watch-only — no keys,
    no signing, no writes to the chain.
  - **`evm-sync-server.ts`** (server-only orchestrator `syncEvmWallet(walletId)`):
    mark backfilling → fetch tip (proxy eth_blockNumber) → sync balances (native
    + ERC-20 derived from full tokentx history) → walk txlist+tokentx by ascending
    block range → map via C6 + sync-core → upsert per window → persist the
    resume cursor after EVERY window (crash-safe) → final null cursor +
    backfill_complete on finish; never throws (records an 'error' sync-state +
    friendly message, resumes from the saved cursor next run). Returns an
    `EvmWalletSyncResult`.
  - Vitest mirrors `tests/compliance/evm-client-core.test.ts` (31 tests) +
    `evm-sync-core.test.ts` (20 tests); both self-tests wired into
    `run-pure-selftests.ts`.

  **Vercel env vars (for Michael):** `ETHERSCAN_API_KEY` (free key from
  etherscan.io — Ethereum only). Flare and Songbird need NO env vars (their
  Blockscout explorer APIs are keyless). Optional overrides:
  `ETHERSCAN_API_URL`, `FLARE_EXPLORER_URL`, `SONGBIRD_EXPLORER_URL` (each has a
  safe built-in default, so they are rarely needed).

_Last updated: 2026-08-11 (C6b EVM fetch+store wiring built — client-core, sync-core, server-only client + orchestrator, vitest mirrors; battery + PR pending)._
