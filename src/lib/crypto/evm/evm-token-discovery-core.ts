/**
 * evm-token-discovery-core.ts — PURE token-discovery logic for EVM chains
 * (Flare & Songbird Blockscout; also works for any Etherscan-compatible list).
 *
 * WHY THIS EXISTS (AREA 3)
 * ------------------------
 * Our sync only ever "recognised" a token if its contract was in the hardcoded
 * CRYPTO_ASSETS registry (resolveEvmAssetByContract). Every OTHER coin an
 * address holds resolved to assetId=null, so its balance was dropped
 * (buildBalanceUpsert returns null for null-asset balances). This module is the
 * first half of the fix: given the explorer's `tokenlist` payload for an
 * address, it DISCOVERS every token the address holds, classifies fungible
 * (ERC-20) vs non-fungible (ERC-721 / ERC-1155), and resolves each token's REAL
 * decimals from a first-party source — never a guess.
 *
 * DECIMALS PROVENANCE (never guess):
 *   1. the tokenlist row's own `decimals` (Blockscout decoded it from the token)
 *   2. else the `token&action=getToken` metadata endpoint
 *   3. else an on-chain `eth_call decimals()` (selector 0x313ce567) — ground truth
 *   4. else UNVERIFIED — we register the token but refuse to compute a balance.
 * We verified live (2026-08-12) that (1)/(2)/(3) agree for WFLR/WSGB(18),
 * FLRFROG(9), PONZU(8), FXRP(6).
 *
 * SCAM HYGIENE (verified live): Flare/Songbird wallets are flooded with hostile
 * airdropped ERC-721/ERC-1155 "SECURITY WARNING"/"Wallet Alert" tokens. Only
 * ERC-20 tokens are treated as fungible holdings here; NFTs are surfaced as a
 * separate, non-balance category so they can never masquerade as a coin balance.
 *
 * PURITY: no I/O, no `server-only`, no DB. The server wrapper does the fetching
 * and feeds raw payloads in here. ES2017-safe (no `0n`, no numeric separators).
 */

import type { Chain } from "../crypto-core";
import {
  buildEvmQuery,
  blockscoutJsonRpcUrl,
  resolveEvmExplorerBase,
  chainNeedsApiKey,
  etherscanChainId,
  isBlockscoutChain,
  type EvmExplorerRequest,
  type EvmJsonRpcRequest,
} from "./evm-client-core";

// ---------------------------------------------------------------------------
// The ERC-20 `decimals()` function selector (first 4 bytes of keccak256).
// keccak256("decimals()") = 0x313ce567... — this is the standard, stable
// selector every ERC-20 uses. Verified live against WFLR/FLRFROG/PONZU/FXRP.
// ---------------------------------------------------------------------------
export const ERC20_DECIMALS_SELECTOR = "0x313ce567";

/** Max decimals we will accept as sane (uint8 in the ERC-20 standard). */
export const MAX_TOKEN_DECIMALS = 255;

// ---------------------------------------------------------------------------
// Raw payload shapes (defensively typed — everything is optional/unknown).
// ---------------------------------------------------------------------------

/** One row from `account&action=tokenlist` (Blockscout / Etherscan-compatible). */
export type TokenListRow = {
  contractAddress?: string;
  name?: string;
  symbol?: string;
  /** decimals as a STRING; may be "" (blank) for NFTs or odd tokens. */
  decimals?: string;
  /** "ERC-20" | "ERC-721" | "ERC-1155" (Blockscout casing). */
  type?: string;
  /** current held balance in smallest unit (decimal string). */
  balance?: string;
  /** token id for NFTs (present on ERC-721/1155 rows). */
  id?: string;
};

/** The `token&action=getToken` metadata result. */
export type GetTokenResult = {
  contractAddress?: string;
  name?: string;
  symbol?: string;
  decimals?: string;
  type?: string;
  totalSupply?: string;
  cataloged?: boolean;
};

// ---------------------------------------------------------------------------
// Discovered-token model.
// ---------------------------------------------------------------------------

/** Fungibility class derived from the explorer's `type`. */
export type TokenKind = "erc20" | "erc721" | "erc1155" | "unknown";

/** How a token's decimals were established (provenance for auditability). */
export type DecimalsProvenance =
  | "tokenlist" // from the list row itself
  | "getToken" // from the getToken metadata endpoint
  | "eth_call" // read on-chain via decimals()
  | "unverified"; // could not establish — do NOT compute a balance

/**
 * A token discovered for an address. `assetId` is the deterministic id we will
 * register in crypto_assets (chain-prefixed contract, collision-free). For
 * fungible ERC-20 tokens with resolved decimals, this becomes a real balance.
 */
export type DiscoveredToken = {
  /** Deterministic crypto_assets id, e.g. "flr:0x1d80…783d". */
  assetId: string;
  chain: Chain;
  /** Lower-cased contract address. */
  contract: string;
  kind: TokenKind;
  /** Display symbol (attacker-controllable — display only, never trusted math). */
  symbol: string;
  /** Display name (attacker-controllable — display only). */
  name: string;
  /** Resolved decimals, or null when unverified. */
  decimals: number | null;
  decimalsProvenance: DecimalsProvenance;
  /** Current held balance in smallest unit (decimal string), or null if absent. */
  balanceRaw: string | null;
  /** True only for ERC-20 with a verified numeric decimals — safe as a balance. */
  fungible: boolean;
};

// ---------------------------------------------------------------------------
// Address / string helpers (local — pure, no imports needed).
// ---------------------------------------------------------------------------

/** Lower-case + trim an address for stable matching / ids. */
export function normContract(addr: string): string {
  return (addr ?? "").trim().toLowerCase();
}

/** True for a plausible 0x… 20-byte hex address. */
export function isHexAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test((addr ?? "").trim());
}

/**
 * Deterministic, collision-free asset id for a discovered EVM token:
 *   "<chain-prefix>:<lower-contract>"  e.g. "flr:0x1d80…783d".
 * Chain-prefixed so the same contract on two chains never collides, and never
 * clashes with our short hand-seeded ids ("flr","wflr",…) which have no colon.
 */
export function discoveredAssetId(chain: Chain, contract: string): string {
  return `${chain}:${normContract(contract)}`;
}

// ---------------------------------------------------------------------------
// Kind classification.
// ---------------------------------------------------------------------------

/** Map an explorer `type` string to our TokenKind. Case/format tolerant. */
export function classifyTokenKind(type: string | undefined): TokenKind {
  const t = (type ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (t === "ERC20") return "erc20";
  if (t === "ERC721") return "erc721";
  if (t === "ERC1155") return "erc1155";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Decimals parsing (defensive; blanks/garbage → null, never a guessed default).
// ---------------------------------------------------------------------------

/**
 * Parse a decimals STRING into a sane integer, or null. Rejects blank,
 * non-numeric, negative, and out-of-range (>255) values. NEVER defaults to 18.
 */
export function parseDecimalsString(raw: string | undefined): number | null {
  const s = (raw ?? "").trim();
  if (s === "") return null;
  if (!/^\d+$/.test(s)) return null;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n) || n < 0 || n > MAX_TOKEN_DECIMALS) return null;
  return n;
}

/**
 * Decode an `eth_call decimals()` hex result (a 32-byte word) into an integer,
 * or null. Uses BigInt so huge/garbage words are rejected rather than misread.
 */
export function parseDecimalsFromEthCall(hexResult: string | undefined): number | null {
  const s = (hexResult ?? "").trim();
  if (!/^0x[0-9a-fA-F]+$/.test(s)) return null;
  let big: bigint;
  try {
    big = BigInt(s);
  } catch {
    return null;
  }
  if (big < BigInt(0) || big > BigInt(MAX_TOKEN_DECIMALS)) return null;
  return Number(big);
}

// ---------------------------------------------------------------------------
// Balance parsing (keep as decimal string; validate it's a non-negative int).
// ---------------------------------------------------------------------------

/** Validate + normalise a smallest-unit balance string, or null if unusable. */
export function normalizeBalanceRaw(raw: string | undefined): string | null {
  const s = (raw ?? "").trim();
  if (s === "") return null;
  if (!/^\d+$/.test(s)) return null;
  // strip leading zeros but keep a single "0"
  const stripped = s.replace(/^0+(?=\d)/, "");
  return stripped;
}

// ---------------------------------------------------------------------------
// Request builders (pure — the server wrapper fetches them).
// ---------------------------------------------------------------------------

/** Build the `account&action=tokenlist` request for an address. */
export function tokenListRequest(
  chain: Chain,
  address: string,
  apiKey: string | null,
): EvmExplorerRequest {
  return buildEvmQuery(chain, "tokenlist", address, apiKey, {});
}

/**
 * Build the `token&action=getToken` request for a contract. Uses module=token
 * (NOT account), so we build the query directly rather than via buildEvmQuery.
 */
export function getTokenRequest(
  chain: Chain,
  contract: string,
  apiKey: string | null,
): EvmExplorerRequest {
  const base = resolveEvmExplorerBase(chain);
  const params = new URLSearchParams();
  params.set("module", "token");
  params.set("action", "getToken");
  params.set("contractaddress", contract);
  if (chain === "ethereum") {
    const cid = etherscanChainId(chain);
    if (cid !== null) params.set("chainid", String(cid));
  }
  if (chainNeedsApiKey(chain) && apiKey && apiKey.trim().length > 0) {
    params.set("apikey", apiKey.trim());
  }
  return { url: `${base}?${params.toString()}` };
}

/**
 * Build an on-chain `eth_call decimals()` JSON-RPC POST for a Blockscout chain.
 * Returns null for non-Blockscout chains (Ethereum would use a different path).
 */
export function decimalsEthCallRequest(
  chain: Chain,
  contract: string,
): EvmJsonRpcRequest | null {
  if (!isBlockscoutChain(chain)) return null;
  const url = blockscoutJsonRpcUrl(chain);
  if (url === null) return null;
  const body = JSON.stringify({
    jsonrpc: "2.0",
    method: "eth_call",
    params: [{ to: contract, data: ERC20_DECIMALS_SELECTOR }, "latest"],
    id: 1,
  });
  return { url, body };
}

// ---------------------------------------------------------------------------
// Payload parsing.
// ---------------------------------------------------------------------------

/** Narrow an unknown tokenlist response body to a TokenListRow[] (else []). */
export function asTokenListRows(body: unknown): TokenListRow[] {
  if (!body || typeof body !== "object") return [];
  const obj = body as { result?: unknown };
  if (!Array.isArray(obj.result)) return [];
  return obj.result as TokenListRow[];
}

/** Narrow an unknown getToken response body to a GetTokenResult (else null). */
export function asGetTokenResult(body: unknown): GetTokenResult | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as { result?: unknown };
  if (!obj.result || typeof obj.result !== "object") return null;
  return obj.result as GetTokenResult;
}

/** Read the hex string out of an eth_call JSON-RPC body (else null). */
export function ethCallResultHex(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as { result?: unknown; error?: unknown };
  if (obj.error !== undefined && obj.error !== null) return null;
  return typeof obj.result === "string" ? obj.result : null;
}

// ---------------------------------------------------------------------------
// Discovery — step 1: map a tokenlist payload into DiscoveredToken[] using ONLY
// the list's own data (list-decimals). Tokens whose decimals are blank keep
// decimals=null / provenance "unverified" until the server enriches them.
// ---------------------------------------------------------------------------

/**
 * Turn a raw tokenlist payload into DiscoveredToken[]. Invalid rows (no/short
 * contract) are dropped. ERC-20 with a good list-decimals is fungible with
 * provenance "tokenlist"; everything else is decimals=null/"unverified" (the
 * server may then try getToken / eth_call for ERC-20s to promote them).
 */
export function discoverFromTokenList(
  chain: Chain,
  body: unknown,
): DiscoveredToken[] {
  const rows = asTokenListRows(body);
  const out: DiscoveredToken[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const contract = normContract(row.contractAddress ?? "");
    if (!isHexAddress(contract)) continue;
    if (seen.has(contract)) continue; // one row per contract
    seen.add(contract);

    const kind = classifyTokenKind(row.type);
    const listDec = parseDecimalsString(row.decimals);
    const isErc20 = kind === "erc20";
    const hasDec = listDec !== null;

    out.push({
      assetId: discoveredAssetId(chain, contract),
      chain,
      contract,
      kind,
      symbol: (row.symbol ?? "").trim(),
      name: (row.name ?? "").trim(),
      decimals: isErc20 && hasDec ? listDec : null,
      decimalsProvenance: isErc20 && hasDec ? "tokenlist" : "unverified",
      balanceRaw: normalizeBalanceRaw(row.balance),
      fungible: isErc20 && hasDec,
    });
  }
  return out;
}

/**
 * Which ERC-20 tokens still need decimals resolved (blank list-decimals). The
 * server fetches getToken / eth_call ONLY for these — keeping network calls
 * minimal. NFTs are never enriched (they're not fungible balances).
 */
export function tokensNeedingDecimals(tokens: DiscoveredToken[]): DiscoveredToken[] {
  return tokens.filter((t) => t.kind === "erc20" && t.decimals === null);
}

/**
 * Promote a token's decimals from a getToken result (provenance "getToken") or
 * an eth_call hex (provenance "eth_call"). Returns a NEW token (pure). Prefers
 * the on-chain eth_call value when both are supplied (it's the ground truth). If
 * neither yields a sane value, the token stays unverified (never guessed).
 */
export function applyResolvedDecimals(
  token: DiscoveredToken,
  opts: { getToken?: GetTokenResult | null; ethCallHex?: string | null },
): DiscoveredToken {
  if (token.kind !== "erc20") return token;
  if (token.decimals !== null) return token; // already resolved from the list

  const chainDec = parseDecimalsFromEthCall(opts.ethCallHex ?? undefined);
  if (chainDec !== null) {
    return { ...token, decimals: chainDec, decimalsProvenance: "eth_call", fungible: true };
  }
  const metaDec = parseDecimalsString(opts.getToken?.decimals);
  if (metaDec !== null) {
    return { ...token, decimals: metaDec, decimalsProvenance: "getToken", fungible: true };
  }
  return token; // stays unverified — the server must NOT compute a balance for it
}

// ---------------------------------------------------------------------------
// Selection helpers for the server.
// ---------------------------------------------------------------------------

/** The fungible, decimals-verified ERC-20 tokens (safe to register + balance). */
export function fungibleTokens(tokens: DiscoveredToken[]): DiscoveredToken[] {
  return tokens.filter((t) => t.fungible && t.decimals !== null);
}

/** The non-fungible tokens (ERC-721 / ERC-1155) — surfaced, never a balance. */
export function nonFungibleTokens(tokens: DiscoveredToken[]): DiscoveredToken[] {
  return tokens.filter((t) => t.kind === "erc721" || t.kind === "erc1155");
}

/** ERC-20s we could NOT verify decimals for (registered inactive, no balance). */
export function unverifiedErc20Tokens(tokens: DiscoveredToken[]): DiscoveredToken[] {
  return tokens.filter((t) => t.kind === "erc20" && t.decimals === null);
}

// ---------------------------------------------------------------------------
// Persistence row builders (pure). PR B feeds these into crypto-store.
// ---------------------------------------------------------------------------

/**
 * A crypto_assets upsert row for a discovered token. Only ever built for a
 * fungible, decimals-VERIFIED ERC-20 (caller filters via fungibleTokens); the
 * builder returns null for anything else so an unverified/NFT token can never
 * be registered as a spendable asset.
 *
 * `decimals_source` is always 'verified' — every path that sets fungible=true
 * came from a first-party decimals read (list/getToken/eth_call), never a guess.
 * `amount_model` is 'evm-minor' (integer smallest-unit + decimals), matching
 * how the seed models FLR/WFLR/etc.
 */
export type DiscoveredAssetUpsertRow = {
  id: string;
  symbol: string;
  name: string;
  chain: Chain;
  amount_model: "evm-minor";
  decimals: number;
  decimals_source: "verified";
  native: false;
  contract: string;
  issuer: null;
  currency_code: null;
  denom: null;
  migrates_to_asset_id: null;
  active: true;
};

/** Cap a display string so a hostile token name/symbol can't bloat a row. */
function clampDisplay(s: string, max: number): string {
  const t = (s ?? "").trim();
  return t.length > max ? t.slice(0, max) : t;
}

/**
 * Build a crypto_assets upsert row from a discovered token, or null if the
 * token isn't a fungible, decimals-verified ERC-20. Symbol/name are display-
 * clamped (attacker-controllable); they never affect math. Falls back to a
 * short contract-derived symbol/name when the token supplied none.
 */
export function buildDiscoveredAssetUpsert(
  token: DiscoveredToken,
): DiscoveredAssetUpsertRow | null {
  if (!token.fungible || token.decimals === null || token.kind !== "erc20") {
    return null;
  }
  const shortContract = token.contract.slice(0, 10);
  const symbol = clampDisplay(token.symbol, 32) || shortContract;
  const name = clampDisplay(token.name, 128) || `Token ${shortContract}`;
  return {
    id: token.assetId,
    symbol,
    name,
    chain: token.chain,
    amount_model: "evm-minor",
    decimals: token.decimals,
    decimals_source: "verified",
    native: false,
    contract: token.contract,
    issuer: null,
    currency_code: null,
    denom: null,
    migrates_to_asset_id: null,
    active: true,
  };
}

/** Build crypto_assets upsert rows for every fungible verified token. */
export function buildDiscoveredAssetUpserts(
  tokens: DiscoveredToken[],
): DiscoveredAssetUpsertRow[] {
  const out: DiscoveredAssetUpsertRow[] = [];
  for (const t of tokens) {
    const row = buildDiscoveredAssetUpsert(t);
    if (row) out.push(row);
  }
  return out;
}

/** A crypto_balances upsert row (mirrors xrpl-sync-core's BalanceUpsertRow). */
export type DiscoveredBalanceUpsertRow = {
  wallet_id: string;
  asset_id: string;
  amount_raw: string | null;
  amount_decimal: null;
  decimals_at_read: number;
  usd_value_cents: null;
  balances_updated_at: string;
};

/**
 * Build a crypto_balances upsert row from a discovered token's CURRENT balance
 * (the tokenlist gives the live balance directly — no history summation). Only
 * for fungible verified ERC-20 with a usable balance; null otherwise (so a
 * scam NFT or an unverified token never produces a balance row). USD is left
 * null — never guessed (priced in a later slice).
 */
export function buildDiscoveredBalanceUpsert(
  walletId: string,
  token: DiscoveredToken,
  readAt: string,
): DiscoveredBalanceUpsertRow | null {
  if (!token.fungible || token.decimals === null || token.kind !== "erc20") {
    return null;
  }
  if (token.balanceRaw === null) return null;
  return {
    wallet_id: walletId,
    asset_id: token.assetId,
    amount_raw: token.balanceRaw,
    amount_decimal: null,
    decimals_at_read: token.decimals,
    usd_value_cents: null,
    balances_updated_at: readAt,
  };
}

/** Build crypto_balances upsert rows for every fungible verified token held. */
export function buildDiscoveredBalanceUpserts(
  walletId: string,
  tokens: DiscoveredToken[],
  readAt: string,
): DiscoveredBalanceUpsertRow[] {
  const out: DiscoveredBalanceUpsertRow[] = [];
  for (const t of tokens) {
    const row = buildDiscoveredBalanceUpsert(walletId, t, readAt);
    if (row) out.push(row);
  }
  return out;
}

// ===========================================================================
// SELF-TESTS (pure). Run by scripts/compliance/run-pure-selftests.ts.
// ===========================================================================

export function __runEvmTokenDiscoveryCoreTests(): void {
  const fail: string[] = [];
  const check = (name: string, cond: boolean): void => {
    if (!cond) fail.push(name);
  };

  // --- normContract / isHexAddress ---
  check("normContract lowercases", normContract("0xABCdef0000000000000000000000000000000001") === "0xabcdef0000000000000000000000000000000001");
  check("isHexAddress true", isHexAddress("0x1d80c49bbbcd1c0911346656b529df9e5c2f783d"));
  check("isHexAddress false short", !isHexAddress("0x123"));
  check("isHexAddress false empty", !isHexAddress(""));

  // --- discoveredAssetId ---
  check("assetId chain-prefixed", discoveredAssetId("flare", "0x1D80c49BBBCD1c0911346656B529DF9E5c2F783d") === "flare:0x1d80c49bbbcd1c0911346656b529df9e5c2f783d");
  check("assetId differs per chain", discoveredAssetId("flare", "0xabc0000000000000000000000000000000000001") !== discoveredAssetId("songbird", "0xabc0000000000000000000000000000000000001"));

  // --- classifyTokenKind ---
  check("kind erc20", classifyTokenKind("ERC-20") === "erc20");
  check("kind erc721", classifyTokenKind("ERC-721") === "erc721");
  check("kind erc1155", classifyTokenKind("ERC-1155") === "erc1155");
  check("kind erc20 lower", classifyTokenKind("erc20") === "erc20");
  check("kind unknown blank", classifyTokenKind("") === "unknown");
  check("kind unknown junk", classifyTokenKind("weird") === "unknown");

  // --- parseDecimalsString (NEVER defaults to 18) ---
  check("dec 18", parseDecimalsString("18") === 18);
  check("dec 6", parseDecimalsString("6") === 6);
  check("dec 0", parseDecimalsString("0") === 0);
  check("dec blank null", parseDecimalsString("") === null);
  check("dec nonnum null", parseDecimalsString("x") === null);
  check("dec negative null", parseDecimalsString("-1") === null);
  check("dec too big null", parseDecimalsString("256") === null);
  check("dec 255 ok", parseDecimalsString("255") === 255);

  // --- parseDecimalsFromEthCall ---
  check("ethcall 18", parseDecimalsFromEthCall("0x0000000000000000000000000000000000000000000000000000000000000012") === 18);
  check("ethcall 9", parseDecimalsFromEthCall("0x0000000000000000000000000000000000000000000000000000000000000009") === 9);
  check("ethcall 6", parseDecimalsFromEthCall("0x0000000000000000000000000000000000000000000000000000000000000006") === 6);
  check("ethcall 0", parseDecimalsFromEthCall("0x0000000000000000000000000000000000000000000000000000000000000000") === 0);
  check("ethcall bad null", parseDecimalsFromEthCall("nope") === null);
  check("ethcall empty null", parseDecimalsFromEthCall("") === null);
  check("ethcall huge null", parseDecimalsFromEthCall("0x" + "f".repeat(64)) === null);

  // --- normalizeBalanceRaw ---
  check("bal keep", normalizeBalanceRaw("1000000") === "1000000");
  check("bal strip zeros", normalizeBalanceRaw("000123") === "123");
  check("bal zero", normalizeBalanceRaw("0") === "0");
  check("bal blank null", normalizeBalanceRaw("") === null);
  check("bal nonnum null", normalizeBalanceRaw("1.5") === null);

  // --- request builders ---
  const listReq = tokenListRequest("flare", "0xB57Fb1217cc868D401426012157d6CFd311272e4", null);
  check("tokenlist url module account", listReq.url.includes("module=account"));
  check("tokenlist url action tokenlist", listReq.url.includes("action=tokenlist"));
  check("tokenlist url base flare", listReq.url.startsWith("https://flare-explorer.flare.network/api"));

  const getReq = getTokenRequest("songbird", "0x02f0826ef6aD107Cfc861152B32B52fD11BaB9ED", null);
  check("getToken url module token", getReq.url.includes("module=token"));
  check("getToken url action getToken", getReq.url.includes("action=getToken"));
  check("getToken url has contractaddress", getReq.url.includes("contractaddress=0x02f0826ef6aD107Cfc861152B32B52fD11BaB9ED"));
  check("getToken url base songbird", getReq.url.startsWith("https://songbird-explorer.flare.network/api"));

  const callReq = decimalsEthCallRequest("flare", "0x1d80c49bbbcd1c0911346656b529df9e5c2f783d");
  check("ethcall req not null", callReq !== null);
  check("ethcall req url eth-rpc", (callReq?.url ?? "").endsWith("/eth-rpc"));
  check("ethcall req body has selector", (callReq?.body ?? "").includes(ERC20_DECIMALS_SELECTOR));
  check("ethcall req body has method", (callReq?.body ?? "").includes("eth_call"));
  check("ethcall req null for ethereum", decimalsEthCallRequest("ethereum", "0x1d80c49bbbcd1c0911346656b529df9e5c2f783d") === null);

  // --- payload parsing ---
  const listBody = {
    status: "1",
    result: [
      { balance: "11075251583124990077101711", contractAddress: "0x1d80c49bbbcd1c0911346656b529df9e5c2f783d", decimals: "18", name: "Wrapped Flare", symbol: "WFLR", type: "ERC-20" },
      { balance: "91140000000000", contractAddress: "0x19cf770bbb7b71977b860e7fd8d32fa2513a743c", decimals: "9", name: "FlareFrog", symbol: "FLRFROG", type: "ERC-20" },
      { balance: "1", contractAddress: "0x0b9527a04af14fb2fc9772487ded5ee8d53ff38e", decimals: "", name: "ATTENTION SECURITY WARNING", symbol: "WARNING", type: "ERC-1155" },
      { balance: "1", contractAddress: "0x05850558c51b8fbd914a802d6881f420295226ac", decimals: "", name: "! IMPORTANT ALERT", symbol: "! IMPORTANT ALERT", type: "ERC-721" },
      // an ERC-20 with BLANK decimals — must NOT be fungible until enriched
      { balance: "5", contractAddress: "0xdeadbeef00000000000000000000000000000001", decimals: "", name: "Mystery", symbol: "MYS", type: "ERC-20" },
    ],
  };
  const rows = asTokenListRows(listBody);
  check("asTokenListRows count", rows.length === 5);
  check("asTokenListRows bad body []", asTokenListRows(null).length === 0);
  check("asTokenListRows non-array []", asTokenListRows({ result: "x" }).length === 0);

  const discovered = discoverFromTokenList("flare", listBody);
  check("discover count", discovered.length === 5);
  const wflr = discovered.find((t) => t.symbol === "WFLR");
  check("discover WFLR fungible", wflr!.fungible === true);
  check("discover WFLR decimals 18", wflr!.decimals === 18);
  check("discover WFLR provenance tokenlist", wflr!.decimalsProvenance === "tokenlist");
  check("discover WFLR balance", wflr!.balanceRaw === "11075251583124990077101711");
  check("discover WFLR assetId", wflr!.assetId === "flare:0x1d80c49bbbcd1c0911346656b529df9e5c2f783d");
  const frog = discovered.find((t) => t.symbol === "FLRFROG");
  check("discover FLRFROG decimals 9", frog!.decimals === 9);
  const warn = discovered.find((t) => t.kind === "erc1155");
  check("discover scam nft not fungible", warn!.fungible === false);
  check("discover scam nft decimals null", warn!.decimals === null);
  const alert = discovered.find((t) => t.kind === "erc721");
  check("discover scam 721 not fungible", alert!.fungible === false);
  const mys = discovered.find((t) => t.symbol === "MYS");
  check("discover blank-dec erc20 not fungible yet", mys!.fungible === false);
  check("discover blank-dec erc20 unverified", mys!.decimalsProvenance === "unverified");

  // --- dedupe: same contract twice -> one row ---
  const dupBody = { result: [
    { contractAddress: "0xAAA0000000000000000000000000000000000001", decimals: "18", symbol: "A", type: "ERC-20", balance: "1" },
    { contractAddress: "0xaaa0000000000000000000000000000000000001", decimals: "18", symbol: "A", type: "ERC-20", balance: "2" },
  ] };
  check("discover dedupes contract", discoverFromTokenList("flare", dupBody).length === 1);

  // --- selection helpers ---
  check("fungibleTokens count", fungibleTokens(discovered).length === 2); // WFLR + FLRFROG
  check("nonFungibleTokens count", nonFungibleTokens(discovered).length === 2); // 721 + 1155
  check("unverifiedErc20 count", unverifiedErc20Tokens(discovered).length === 1); // MYS
  check("tokensNeedingDecimals count", tokensNeedingDecimals(discovered).length === 1); // MYS

  // --- applyResolvedDecimals: eth_call wins, then getToken, else unverified ---
  const promotedByCall = applyResolvedDecimals(mys!, { ethCallHex: "0x0000000000000000000000000000000000000000000000000000000000000006", getToken: { decimals: "8" } });
  check("promote prefers eth_call", promotedByCall.decimals === 6 && promotedByCall.decimalsProvenance === "eth_call" && promotedByCall.fungible === true);
  const promotedByMeta = applyResolvedDecimals(mys!, { ethCallHex: null, getToken: { decimals: "8" } });
  check("promote falls to getToken", promotedByMeta.decimals === 8 && promotedByMeta.decimalsProvenance === "getToken");
  const stillUnverified = applyResolvedDecimals(mys!, { ethCallHex: "bad", getToken: { decimals: "" } });
  check("promote stays unverified when no source", stillUnverified.decimals === null && stillUnverified.decimalsProvenance === "unverified" && stillUnverified.fungible === false);
  const untouchedNft = applyResolvedDecimals(warn!, { ethCallHex: "0x…12" });
  check("promote leaves nft alone", untouchedNft.decimals === null && untouchedNft.kind === "erc1155");
  check("promote leaves already-resolved alone", applyResolvedDecimals(wflr!, { ethCallHex: "0x06" }).decimals === 18);

  // --- getToken / eth_call body parsers ---
  check("asGetTokenResult ok", asGetTokenResult({ result: { decimals: "18", symbol: "WFLR" } })?.decimals === "18");
  check("asGetTokenResult bad null", asGetTokenResult({ result: "x" }) === null);
  check("ethCallResultHex ok", ethCallResultHex({ result: "0x12" }) === "0x12");
  check("ethCallResultHex error null", ethCallResultHex({ error: "execution reverted" }) === null);
  check("ethCallResultHex missing null", ethCallResultHex({}) === null);

  // --- persistence row builders ---
  const assetRow = buildDiscoveredAssetUpsert(frog!);
  check("asset row id", assetRow!.id === "flare:0x19cf770bbb7b71977b860e7fd8d32fa2513a743c");
  check("asset row symbol", assetRow!.symbol === "FLRFROG");
  check("asset row decimals 9", assetRow!.decimals === 9);
  check("asset row decimals_source verified", assetRow!.decimals_source === "verified");
  check("asset row amount_model evm-minor", assetRow!.amount_model === "evm-minor");
  check("asset row not native", assetRow!.native === false);
  check("asset row active", assetRow!.active === true);
  check("asset row contract", assetRow!.contract === "0x19cf770bbb7b71977b860e7fd8d32fa2513a743c");
  check("asset row NULL for scam nft", buildDiscoveredAssetUpsert(warn!) === null);
  check("asset row NULL for unverified erc20", buildDiscoveredAssetUpsert(mys!) === null);

  // fallback symbol/name when token supplied none
  const noNameTok = discoverFromTokenList("flare", { result: [{ contractAddress: "0xabc0000000000000000000000000000000000009", decimals: "18", type: "ERC-20", balance: "1", symbol: "", name: "" }] })[0];
  const noNameRow = buildDiscoveredAssetUpsert(noNameTok);
  check("asset row fallback symbol", noNameRow!.symbol === "0xabc00000");
  check("asset row fallback name", noNameRow!.name === "Token 0xabc00000");

  // display clamp on hostile long name
  const longTok = discoverFromTokenList("flare", { result: [{ contractAddress: "0xabc000000000000000000000000000000000000a", decimals: "18", type: "ERC-20", balance: "1", symbol: "S".repeat(80), name: "N".repeat(400) }] })[0];
  const longRow = buildDiscoveredAssetUpsert(longTok);
  check("asset row symbol clamped 32", longRow!.symbol.length === 32);
  check("asset row name clamped 128", longRow!.name.length === 128);

  const assetRows = buildDiscoveredAssetUpserts(discovered);
  check("asset rows only fungible", assetRows.length === 2); // WFLR + FLRFROG

  // --- balance row builders ---
  const balRow = buildDiscoveredBalanceUpsert("wallet-1", wflr!, "2026-08-12T00:00:00Z");
  check("bal row asset_id", balRow!.asset_id === "flare:0x1d80c49bbbcd1c0911346656b529df9e5c2f783d");
  check("bal row amount_raw", balRow!.amount_raw === "11075251583124990077101711");
  check("bal row decimals_at_read", balRow!.decimals_at_read === 18);
  check("bal row usd null", balRow!.usd_value_cents === null);
  check("bal row amount_decimal null", balRow!.amount_decimal === null);
  check("bal row wallet", balRow!.wallet_id === "wallet-1");
  check("bal row NULL for scam nft", buildDiscoveredBalanceUpsert("wallet-1", warn!, "t") === null);
  check("bal row NULL for unverified", buildDiscoveredBalanceUpsert("wallet-1", mys!, "t") === null);
  const balRows = buildDiscoveredBalanceUpserts("wallet-1", discovered, "2026-08-12T00:00:00Z");
  check("bal rows only fungible with balance", balRows.length === 2); // WFLR + FLRFROG

  // a fungible token with NO balance yields no balance row (but still an asset)
  const noBalTok: DiscoveredToken = { ...wflr!, balanceRaw: null };
  check("bal row NULL when no balance", buildDiscoveredBalanceUpsert("wallet-1", noBalTok, "t") === null);
  check("asset row still built when no balance", buildDiscoveredAssetUpsert(noBalTok) !== null);

  if (fail.length > 0) {
    throw new Error("evm-token-discovery-core self-tests FAILED: " + fail.join(", "));
  }
  console.log("evm-token-discovery-core self-tests: all passed");
}
