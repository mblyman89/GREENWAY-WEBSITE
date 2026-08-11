/**
 * crypto-holdings-table-core — PURE view-model builder for the Portfolio page's
 * per-wallet, expandable holdings table (AREA 4).
 *
 * Given the wallets, their current balances, and the asset registry, this turns
 * raw records into a plain, display-ready shape the UI can render without any
 * further logic: one entry per wallet, each with its visible tokens (native
 * pinned first, then alt coins) and its HIDDEN tokens kept separately so Michael
 * can review/unhide them. Scam tokens he hides are NEVER dropped — they move to
 * the hidden list, still fully in the database, one click from coming back.
 *
 * HONESTY RULES (never guess):
 *   - Amounts are formatted from the EXACT stored integer minor units; never a
 *     JS float. If we can't format, we show the raw string, not an invented one.
 *   - USD value is shown ONLY when priced (integer cents). Unpriced => null =>
 *     the UI shows "value pending", never $0.
 *   - Price / %-of-portfolio / 24h / cost basis / gain-loss all require pricing
 *     (roadmap R3); this core exposes them as nulls so the table layout is ready
 *     but nothing is fabricated.
 *
 * This module is PURE (no "server-only", no I/O) so it runs under the pure
 * self-test harness and vitest. Persistence of the hidden flag lives elsewhere.
 */
import type { Chain } from "./crypto-core";
import type {
  CryptoAssetRecord,
  CryptoWalletRecord,
  CryptoBalanceRecord,
} from "./crypto-store-core";
import { formatHeldAmount, formatCentsUsd, maskAddress, chainLabel } from "./crypto-ui-core";

// ---------------------------------------------------------------------------
// Explorer token links (LIVE-verified Blockscout web pages, HTTP 200)
// ---------------------------------------------------------------------------

/** Web UI (not /api) base for each Blockscout chain's token page. */
const EXPLORER_WEB_BASE: Partial<Record<Chain, string>> = {
  flare: "https://flare-explorer.flare.network",
  songbird: "https://songbird-explorer.flare.network",
};

/**
 * Public block-explorer URL for a token's page, or null when we don't have a
 * verified explorer for that chain or the contract is missing/malformed.
 * Never guesses a host; only the two chains proven live are wired.
 */
export function explorerTokenUrl(chain: Chain, contract: string | null): string | null {
  const base = EXPLORER_WEB_BASE[chain];
  if (!base) return null;
  const c = (contract ?? "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(c)) return null;
  return `${base}/token/${c}`;
}

/** Public block-explorer URL for a wallet address, or null when unsupported. */
export function explorerAddressUrl(chain: Chain, address: string | null): string | null {
  const base = EXPLORER_WEB_BASE[chain];
  if (!base) return null;
  const a = (address ?? "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(a)) return null;
  return `${base}/address/${a}`;
}

// ---------------------------------------------------------------------------
// View-model types (plain data the UI renders directly)
// ---------------------------------------------------------------------------

/** One token row inside a wallet's holdings table. */
export type HoldingRow = {
  balanceId: string;
  assetId: string;
  symbol: string;
  name: string;
  chain: Chain;
  native: boolean;
  /** Exact quantity, display-formatted from stored minor units (never a float). */
  amountText: string;
  /** USD when priced (integer cents), else null => UI shows "value pending". */
  usdValueCents: number | null;
  valueText: string | null;
  /** Token contract (null for a native coin). */
  contract: string | null;
  contractShort: string | null;
  explorerUrl: string | null;
  decimals: number | null;
  /** True when decimals came from a verified first-party source. */
  verified: boolean;
  hidden: boolean;
};

/** One wallet's card in the Portfolio holdings list. */
export type WalletHoldings = {
  walletId: string;
  chain: Chain;
  chainText: string;
  address: string;
  addressShort: string;
  addressExplorerUrl: string | null;
  displayName: string;
  /** Tokens shown in the table (native first, then alt coins), hidden excluded. */
  visible: HoldingRow[];
  /** Hidden (scam) tokens — kept for provability, shown only in the reviewer. */
  hidden: HoldingRow[];
  visibleCount: number;
  hiddenCount: number;
};

export type HoldingsTable = {
  wallets: WalletHoldings[];
  /** Total number of hidden tokens across all wallets (for the reviewer badge). */
  hiddenTotal: number;
};

export type BuildHoldingsInput = {
  wallets: CryptoWalletRecord[];
  balances: CryptoBalanceRecord[];
  /** Asset registry indexed by asset id. */
  assetById: Map<string, CryptoAssetRecord>;
};

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/** True when a stored balance is a real, non-zero holding. */
export function isHeldBalance(b: CryptoBalanceRecord): boolean {
  const hasRaw = b.amountRaw !== null && b.amountRaw !== "" && b.amountRaw !== "0";
  const hasDec =
    b.amountDecimal !== null && b.amountDecimal !== "" && Number(b.amountDecimal) !== 0;
  return hasRaw || hasDec;
}

/** Build one display row from a balance + its asset (asset may be missing). */
export function buildHoldingRow(
  b: CryptoBalanceRecord,
  asset: CryptoAssetRecord | undefined,
): HoldingRow {
  const decimals = asset?.decimals ?? b.decimalsAtRead ?? null;
  const chain: Chain = asset?.chain ?? "ethereum";
  const contract = asset?.contract ?? null;
  const native = asset?.native ?? false;
  const amountText = formatHeldAmount({
    amountRaw: b.amountRaw,
    amountDecimal: b.amountDecimal,
    decimals,
  });
  const usdValueCents = b.usdValueCents;
  return {
    balanceId: b.id,
    assetId: b.assetId,
    symbol: asset?.symbol ?? b.assetId,
    name: asset?.name ?? b.assetId,
    chain,
    native,
    amountText,
    usdValueCents,
    valueText: usdValueCents !== null ? formatCentsUsd(usdValueCents) : null,
    contract,
    contractShort: contract ? maskAddress(contract, 6, 4) : null,
    explorerUrl: native ? null : explorerTokenUrl(chain, contract),
    decimals,
    verified: asset?.decimalsSource === "verified",
    hidden: asset?.hidden === true,
  };
}

/**
 * Sort visible token rows: native coin pinned first, then by USD value desc
 * (priced ahead of unpriced), then by symbol as a stable tiebreaker. Until
 * pricing lands (R3) most rows have null value, so symbol order dominates —
 * deterministic and honest, never a fabricated ranking.
 */
function compareRows(a: HoldingRow, b: HoldingRow): number {
  if (a.native !== b.native) return a.native ? -1 : 1;
  const av = a.usdValueCents;
  const bv = b.usdValueCents;
  if (av !== null && bv !== null && av !== bv) return bv - av;
  if (av !== null && bv === null) return -1;
  if (av === null && bv !== null) return 1;
  return a.symbol.localeCompare(b.symbol);
}

/**
 * Build the full holdings table view-model. Wallets keep their input order.
 * Only wallets with at least one held (or hidden-but-held) token appear.
 */
export function buildHoldingsTable(input: BuildHoldingsInput): HoldingsTable {
  const { wallets, balances, assetById } = input;

  // Group held balances by wallet.
  const byWallet = new Map<string, CryptoBalanceRecord[]>();
  for (const b of balances) {
    if (!isHeldBalance(b)) continue;
    const list = byWallet.get(b.walletId) ?? [];
    list.push(b);
    byWallet.set(b.walletId, list);
  }

  const out: WalletHoldings[] = [];
  let hiddenTotal = 0;

  for (const w of wallets) {
    const held = byWallet.get(w.id) ?? [];
    if (held.length === 0) continue;

    const visible: HoldingRow[] = [];
    const hidden: HoldingRow[] = [];
    for (const b of held) {
      const row = buildHoldingRow(b, assetById.get(b.assetId));
      if (row.hidden) hidden.push(row);
      else visible.push(row);
    }
    if (visible.length === 0 && hidden.length === 0) continue;

    visible.sort(compareRows);
    hidden.sort(compareRows);
    hiddenTotal += hidden.length;

    const label = (w.label ?? "").trim();
    const chainText = chainLabel(w.chain);
    out.push({
      walletId: w.id,
      chain: w.chain,
      chainText,
      address: w.address,
      addressShort: maskAddress(w.address, 6, 4),
      addressExplorerUrl: explorerAddressUrl(w.chain, w.address),
      displayName: label !== "" ? label : chainText,
      visible,
      hidden,
      visibleCount: visible.length,
      hiddenCount: hidden.length,
    });
  }

  return { wallets: out, hiddenTotal };
}

// ---------------------------------------------------------------------------
// Pure self-tests
// ---------------------------------------------------------------------------

function makeAsset(over: Partial<CryptoAssetRecord>): CryptoAssetRecord {
  return {
    id: "flare:0x0000000000000000000000000000000000000001",
    symbol: "TKN",
    name: "Token",
    chain: "flare",
    amountModel: "evm-minor",
    decimals: 18,
    decimalsSource: "verified",
    native: false,
    contract: "0x0000000000000000000000000000000000000001",
    issuer: null,
    currencyCode: null,
    denom: null,
    migratesToAssetId: null,
    active: true,
    hidden: false,
    ...over,
  };
}

function makeBal(over: Partial<CryptoBalanceRecord>): CryptoBalanceRecord {
  return {
    id: "b1",
    walletId: "w1",
    assetId: "flare:0x0000000000000000000000000000000000000001",
    amountRaw: "1000000000000000000",
    amountDecimal: null,
    decimalsAtRead: 18,
    usdValueCents: null,
    balancesUpdatedAt: null,
    ...over,
  };
}

const WALLET: CryptoWalletRecord = {
  id: "w1",
  chain: "flare",
  address: "0xB57Fb1217cc868D401426012157d6CFd311272e4",
  label: "Main",
  active: true,
};

export function __runCryptoHoldingsTableCoreTests(): void {
  const fail: string[] = [];
  const check = (name: string, cond: boolean): void => {
    if (!cond) fail.push(name);
  };

  // --- explorerTokenUrl ---
  check(
    "explorer flare token",
    explorerTokenUrl("flare", "0x12E605bc104e93B45e1aD99F9e555f659051c2BB") ===
      "https://flare-explorer.flare.network/token/0x12e605bc104e93b45e1ad99f9e555f659051c2bb",
  );
  check(
    "explorer songbird token",
    explorerTokenUrl("songbird", "0x02f0826ef6aD107Cfc861152B32B52fD11BaB9ED") ===
      "https://songbird-explorer.flare.network/token/0x02f0826ef6ad107cfc861152b32b52fd11bab9ed",
  );
  check("explorer ethereum null (unsupported)", explorerTokenUrl("ethereum", "0x" + "1".repeat(40)) === null);
  check("explorer xrpl null", explorerTokenUrl("xrpl", "0x" + "1".repeat(40)) === null);
  check("explorer bad contract null", explorerTokenUrl("flare", "0x123") === null);
  check("explorer null contract null", explorerTokenUrl("flare", null) === null);
  check(
    "explorer address flare",
    explorerAddressUrl("flare", "0xB57Fb1217cc868D401426012157d6CFd311272e4") ===
      "https://flare-explorer.flare.network/address/0xb57fb1217cc868d401426012157d6cfd311272e4",
  );

  // --- isHeldBalance ---
  check("held raw yes", isHeldBalance(makeBal({ amountRaw: "5" })));
  check("held raw zero no", !isHeldBalance(makeBal({ amountRaw: "0" })));
  check("held raw blank no", !isHeldBalance(makeBal({ amountRaw: "" })));
  check("held raw null no", !isHeldBalance(makeBal({ amountRaw: null })));
  check(
    "held decimal yes",
    isHeldBalance(makeBal({ amountRaw: null, amountDecimal: "1.5" })),
  );
  check(
    "held decimal zero no",
    !isHeldBalance(makeBal({ amountRaw: null, amountDecimal: "0" })),
  );

  // --- buildHoldingRow: native coin, no explorer, no contract ---
  const nativeRow = buildHoldingRow(
    makeBal({ assetId: "FLR", amountRaw: "2500000000000000000" }),
    makeAsset({ id: "FLR", symbol: "FLR", name: "Flare", native: true, contract: null }),
  );
  check("native amount exact", nativeRow.amountText === "2.5");
  check("native no explorer", nativeRow.explorerUrl === null);
  check("native no contract short", nativeRow.contractShort === null);
  check("native verified", nativeRow.verified === true);
  check("native value pending", nativeRow.valueText === null);

  // --- buildHoldingRow: alt coin with explorer + contract + real decimals (FLRFROG=9) ---
  const altRow = buildHoldingRow(
    makeBal({
      assetId: "flare:0x1d80c49bbbcd1c0911346656b529df9e5c2f783d",
      amountRaw: "123000000000",
    }),
    makeAsset({
      id: "flare:0x1d80c49bbbcd1c0911346656b529df9e5c2f783d",
      symbol: "FLRFROG",
      name: "Flare Frog",
      decimals: 9,
      contract: "0x1D80c49BBBCD1c0911346656B529DF9E5c2F783d",
    }),
  );
  check("alt amount uses decimals 9", altRow.amountText === "123");
  check("alt has explorer", altRow.explorerUrl === "https://flare-explorer.flare.network/token/0x1d80c49bbbcd1c0911346656b529df9e5c2f783d");
  check("alt contract short", altRow.contractShort === "0x1D80…783d");

  // --- buildHoldingRow: priced value formats to USD ---
  const pricedRow = buildHoldingRow(makeBal({ usdValueCents: 12345 }), makeAsset({}));
  check("priced value text", pricedRow.valueText === "$123.45");

  // --- buildHoldingRow: unverified decimals flagged ---
  const unver = buildHoldingRow(makeBal({}), makeAsset({ decimalsSource: "denom-convention" }));
  check("unverified flagged", unver.verified === false);

  // --- buildHoldingsTable: hidden split + native-first sort ---
  const table = buildHoldingsTable({
    wallets: [WALLET],
    balances: [
      makeBal({ id: "b-native", assetId: "FLR", amountRaw: "1000000000000000000" }),
      makeBal({ id: "b-aaa", assetId: "flare:0x0000000000000000000000000000000000000001", amountRaw: "5" }),
      makeBal({ id: "b-scam", assetId: "flare:scam", amountRaw: "999" }),
      makeBal({ id: "b-empty", assetId: "flare:empty", amountRaw: "0" }),
    ],
    assetById: new Map([
      ["FLR", makeAsset({ id: "FLR", symbol: "FLR", name: "Flare", native: true, contract: null })],
      [
        "flare:0x0000000000000000000000000000000000000001",
        makeAsset({ id: "flare:0x0000000000000000000000000000000000000001", symbol: "AAA" }),
      ],
      ["flare:scam", makeAsset({ id: "flare:scam", symbol: "SCAM", hidden: true })],
      ["flare:empty", makeAsset({ id: "flare:empty", symbol: "EMP" })],
    ]),
  });
  check("table one wallet", table.wallets.length === 1);
  const wh = table.wallets[0];
  check("wallet visible count 2 (native + AAA, zero excluded)", wh.visibleCount === 2);
  check("wallet native pinned first", wh.visible[0].symbol === "FLR");
  check("wallet hidden count 1", wh.hiddenCount === 1);
  check("wallet hidden is scam", wh.hidden[0].symbol === "SCAM");
  check("table hiddenTotal 1", table.hiddenTotal === 1);
  check("wallet address short", wh.addressShort === "0xB57F…72e4");
  check("wallet display name label", wh.displayName === "Main");
  check("wallet address explorer", wh.addressExplorerUrl === "https://flare-explorer.flare.network/address/0xb57fb1217cc868d401426012157d6cfd311272e4");

  // --- empty wallets excluded ---
  const emptyTable = buildHoldingsTable({
    wallets: [WALLET],
    balances: [makeBal({ id: "b0", assetId: "flare:empty", amountRaw: "0" })],
    assetById: new Map([["flare:empty", makeAsset({ id: "flare:empty" })]]),
  });
  check("empty wallet excluded", emptyTable.wallets.length === 0);

  if (fail.length > 0) {
    throw new Error("crypto-holdings-table-core self-tests FAILED: " + fail.join(", "));
  }
  console.log("crypto-holdings-table-core self-tests: all passed");
}
