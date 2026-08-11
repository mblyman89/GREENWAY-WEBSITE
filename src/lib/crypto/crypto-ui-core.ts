/**
 * src/lib/crypto/crypto-ui-core.ts — Crypto Portfolio presentation brain (Slice C3, PURE).
 *
 * The data-in → view-out layer for the /admin/crypto page: tab resolution, the
 * add-wallet validation/normalization, address masking, chain labels, token-
 * amount + USD formatting, the portfolio summary math (per-chain + grand total),
 * and the honest security/health posture. NO React, NO network, NO DB — fully
 * unit-testable, mirroring the proven src/lib/plaid/plaid-ui-core.ts pattern.
 *
 * ── WHY THIS FILE IS DELIBERATELY CAREFUL (Michael's "keep me safe") ──────────
 * Crypto is a notorious tax headache precisely because totals get fabricated and
 * decimals get fumbled. Two enterprise rules are enforced here so the portfolio
 * screen can never lie to Michael or the IRS:
 *
 *   1. HONEST TOTALS. We ONLY sum USD value for balances that carry a real,
 *      priced `usdValueCents`. Balances we hold but haven't valued yet (no price
 *      snapshot) are counted SEPARATELY as "value pending" and are NEVER folded
 *      into the headline number with a guessed $0. The summary tells the truth:
 *      "$X valued · N holdings priced · M awaiting price".
 *
 *   2. EXACT AMOUNTS, NEVER FLOATS. Token quantities are formatted from the
 *      stored EXACT string (integer minor units for evm-minor via
 *      formatTokenAmount; the decimal string as-is for xrpl-issued). USD is
 *      integer cents formatted like the rest of the app. No token amount is ever
 *      round-tripped through a JS number here.
 *
 * Watch-only assurance: addresses are PUBLIC. This page connects an address to
 * WATCH; it can never move funds. The posture strip says so out loud.
 */
import {
  CHAIN_LABELS,
  CHAINS,
  isValidAddressForChain,
  isEvmAddress,
  type Chain,
} from "./crypto-core";
import { formatTokenAmount } from "./crypto-core";
import {
  buildBackfillProgress,
  type BackfillProgressView,
} from "./crypto-progress-core";

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

/** The crypto page's tabs. Portfolio opens first (the at-a-glance value view). */
export type CryptoTab = "portfolio" | "wallets" | "health";

/**
 * Resolve the ?tab= query param. Unknown/missing → portfolio. A couple of
 * friendly aliases so hand-typed links still land somewhere sensible.
 */
export function resolveCryptoTab(param: string | null | undefined): CryptoTab {
  const p = (param ?? "").trim().toLowerCase();
  if (p === "wallets" || p === "addresses") return "wallets";
  if (p === "health" || p === "status") return "health";
  return "portfolio";
}

/** Ordered tab list for rendering (kept here so the page never hard-codes it). */
export const CRYPTO_TABS: readonly CryptoTab[] = ["portfolio", "wallets", "health"] as const;

/** Plain-English label for a tab. */
export function cryptoTabLabel(tab: CryptoTab): string {
  if (tab === "wallets") return "Wallets";
  if (tab === "health") return "Health";
  return "Portfolio";
}

// ---------------------------------------------------------------------------
// USD + token formatting (mirror plaid-ui-core.formatCentsUsd for consistency)
// ---------------------------------------------------------------------------

/** Integer cents → "$1,234.56" (or "—" when unknown). Never touches floats. */
export function formatCentsUsd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  const neg = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const dollarsStr = dollars.toLocaleString("en-US");
  const centsStr = rem.toString().padStart(2, "0");
  return `${neg ? "-" : ""}$${dollarsStr}.${centsStr}`;
}

/**
 * Format a held quantity for display from the stored EXACT amount. `amountRaw`
 * (integer minor units) formats via decimals; `amountDecimal` (xrpl-issued) is
 * already a decimal string and is shown as-is. Returns "—" when neither is set.
 * NEVER parses a raw amount through a JS number.
 */
export function formatHeldAmount(input: {
  amountRaw: string | null;
  amountDecimal: string | null;
  decimals: number | null;
}): string {
  const { amountRaw, amountDecimal, decimals } = input;
  if (amountDecimal !== null && amountDecimal !== "") return trimDecimalString(amountDecimal);
  if (amountRaw !== null && amountRaw !== "") {
    if (typeof decimals === "number" && Number.isInteger(decimals) && decimals >= 0 && decimals <= 36) {
      try {
        return formatTokenAmount(amountRaw, decimals);
      } catch {
        // Unexpected non-integer raw — fall through to the raw string so we
        // still SHOW something exact rather than crash or invent a number.
        return amountRaw;
      }
    }
    return amountRaw;
  }
  return "—";
}

/** Trim a decimal string's insignificant trailing zeros (keeps value identical). */
function trimDecimalString(s: string): string {
  const t = s.trim();
  if (!t.includes(".")) return t;
  const cleaned = t.replace(/0+$/, "").replace(/\.$/, "");
  return cleaned === "" || cleaned === "-" ? "0" : cleaned;
}

// ---------------------------------------------------------------------------
// Address masking + chain labels
// ---------------------------------------------------------------------------

/**
 * Shorten a public address for display: keep a head + tail with an ellipsis,
 * e.g. "0x1234…cdef", "rEXAMPLE…kLM4", "core1tse…hdttd". Public addresses are
 * not secret, but the short form keeps rows readable. Short inputs pass through.
 */
export function maskAddress(addr: string | null | undefined, head: number = 6, tail: number = 4): string {
  const s = (addr ?? "").trim();
  if (s === "") return "—";
  const h = Math.max(2, Math.trunc(head));
  const t = Math.max(2, Math.trunc(tail));
  if (s.length <= h + t + 1) return s;
  return `${s.slice(0, h)}…${s.slice(s.length - t)}`;
}

/** Human chain label ("Ethereum", "XRP Ledger", "Coreum", …). */
export function chainLabel(chain: Chain): string {
  return CHAIN_LABELS[chain];
}

/** Options for a chain <select> (value + label), in the app's canonical order. */
export function chainSelectOptions(): ReadonlyArray<{ value: Chain; label: string }> {
  return CHAINS.map((c) => ({ value: c, label: CHAIN_LABELS[c] }));
}

// ---------------------------------------------------------------------------
// Add-wallet validation + normalization
// ---------------------------------------------------------------------------

/** A wallet address type-guard used to validate a chain string from a form. */
export function isKnownChain(value: string | null | undefined): value is Chain {
  const v = (value ?? "").trim();
  return (CHAINS as readonly string[]).includes(v);
}

export type AddWalletInput = {
  chain: string | null | undefined;
  address: string | null | undefined;
  label?: string | null | undefined;
};

export type AddWalletParse =
  | {
      ok: true;
      chain: Chain;
      /** Address normalized for storage/dedup (see note on EVM lower-casing). */
      address: string;
      /** Trimmed optional label, or null. */
      label: string | null;
    }
  | { ok: false; error: string };

/** Max characters we accept for a wallet label (keeps the UI + DB tidy). */
export const WALLET_LABEL_MAX = 60;

/**
 * Validate + normalize an "Add wallet (watch-only)" submission WITHOUT touching
 * the DB. Enforces:
 *   - a known chain,
 *   - a non-empty address that PASSES the chain's shape check (crypto-core),
 *   - a normalized address for reliable de-duplication.
 *
 * EVM normalization note: EVM addresses are case-insensitive (the mixed case is
 * an optional EIP-55 checksum). We LOWER-CASE the stored address so the same
 * wallet entered with different casing de-dupes to one row — matching the DB's
 * `lower(address)` unique index. XRPL (base58) and Cosmos (bech32) addresses are
 * case-SENSITIVE, so those are preserved exactly as entered (only trimmed).
 *
 * Returns a plain-English error Michael can act on (never a stack trace).
 */
export function parseAddWallet(input: AddWalletInput): AddWalletParse {
  const chainRaw = (input.chain ?? "").trim();
  if (chainRaw === "") return { ok: false, error: "Pick a blockchain for this wallet." };
  if (!isKnownChain(chainRaw)) {
    return { ok: false, error: `"${chainRaw}" isn't a supported blockchain.` };
  }
  const chain = chainRaw as Chain;

  const address = (input.address ?? "").trim();
  if (address === "") return { ok: false, error: "Enter the wallet's public address." };

  if (!isValidAddressForChain(chain, address)) {
    return { ok: false, error: addressHint(chain) };
  }

  // Normalize for storage/dedup: lower-case EVM (case-insensitive), preserve
  // case for XRPL/Cosmos (case-sensitive).
  const normalizedAddress = isEvmAddress(address) ? address.toLowerCase() : address;

  const labelTrimmed = (input.label ?? "").trim();
  const label = labelTrimmed === "" ? null : labelTrimmed.slice(0, WALLET_LABEL_MAX);

  return { ok: true, chain, address: normalizedAddress, label };
}

/** Plain-English "that address doesn't look right for <chain>" guidance. */
export function addressHint(chain: Chain): string {
  if (chain === "xrpl") {
    return "That doesn't look like an XRP Ledger address. XRP addresses start with 'r' (e.g. rEXAMPLE…). Paste your public XRPL address.";
  }
  if (chain === "coreum") {
    return "That doesn't look like a Coreum address. Coreum addresses start with 'core1…'. Paste your public Coreum (core1…) address.";
  }
  // EVM chains.
  return `That doesn't look like a ${CHAIN_LABELS[chain]} address. ${CHAIN_LABELS[chain]} addresses start with '0x' followed by 40 hex characters. Paste your public 0x… address.`;
}

// ---------------------------------------------------------------------------
// Wallet row view
// ---------------------------------------------------------------------------

export type WalletRowInput = {
  id: string;
  chain: Chain;
  address: string;
  label: string | null;
  active: boolean;
};

export type WalletRowView = {
  id: string;
  chain: Chain;
  chainText: string;
  /** Label if set, else the chain name (so a row always reads clearly). */
  displayName: string;
  addressShort: string;
  addressFull: string;
  active: boolean;
};

/** Build a display row for one watch-only wallet. */
export function buildWalletRow(w: WalletRowInput): WalletRowView {
  const chainText = CHAIN_LABELS[w.chain];
  const label = (w.label ?? "").trim();
  return {
    id: w.id,
    chain: w.chain,
    chainText,
    displayName: label !== "" ? label : chainText,
    addressShort: maskAddress(w.address),
    addressFull: w.address,
    active: w.active,
  };
}

// ---------------------------------------------------------------------------
// Portfolio summary (HONEST totals — the tax-safety centerpiece)
// ---------------------------------------------------------------------------

/** One balance row's inputs the summary needs (already read from the store). */
export type SummaryBalanceInput = {
  chain: Chain;
  /** Priced USD value in integer cents, or null when not yet valued. */
  usdValueCents: number | null;
  /** True when the wallet holds a non-zero amount of this asset. */
  hasAmount: boolean;
};

export type ChainSummary = {
  chain: Chain;
  chainText: string;
  /** Sum of PRICED cents on this chain (unpriced excluded). */
  valuedCents: number;
  valuedText: string;
  /** How many holdings are priced vs. awaiting a price on this chain. */
  pricedCount: number;
  pendingCount: number;
};

export type PortfolioSummary = {
  /** Grand total of PRICED value across all chains, integer cents. */
  totalValuedCents: number;
  totalValuedText: string;
  /** Count of holdings that carry a real price (folded into the total). */
  pricedCount: number;
  /** Count of held holdings NOT yet valued (shown separately, never guessed). */
  pendingCount: number;
  /** Distinct chains that have at least one holding. */
  chainsWithHoldings: number;
  /** Per-chain breakdown, only for chains that hold something, canonical order. */
  perChain: ChainSummary[];
  /** True when nothing is held at all (drives the empty state). */
  isEmpty: boolean;
  /**
   * One honest headline line, e.g.
   * "$12,500.00 valued · 4 holdings priced · 2 awaiting price".
   */
  headline: string;
};

/**
 * Compute the portfolio summary from balance rows. HONEST BY CONSTRUCTION:
 *   - only balances with a finite `usdValueCents` add to any total,
 *   - held-but-unpriced balances increment `pendingCount` (never a $0 guess),
 *   - a balance must have `hasAmount` to count as a holding at all (a zero
 *     balance row from a prior sync doesn't inflate counts).
 */
export function computePortfolioSummary(balances: readonly SummaryBalanceInput[]): PortfolioSummary {
  const byChain = new Map<Chain, ChainSummary>();
  let totalValuedCents = 0;
  let pricedCount = 0;
  let pendingCount = 0;

  const ensure = (chain: Chain): ChainSummary => {
    let c = byChain.get(chain);
    if (!c) {
      c = {
        chain,
        chainText: CHAIN_LABELS[chain],
        valuedCents: 0,
        valuedText: formatCentsUsd(0),
        pricedCount: 0,
        pendingCount: 0,
      };
      byChain.set(chain, c);
    }
    return c;
  };

  for (const b of balances) {
    if (!b.hasAmount) continue; // not a real holding
    const c = ensure(b.chain);
    const priced = typeof b.usdValueCents === "number" && Number.isFinite(b.usdValueCents);
    if (priced) {
      const cents = Math.trunc(b.usdValueCents as number);
      c.valuedCents += cents;
      c.pricedCount += 1;
      totalValuedCents += cents;
      pricedCount += 1;
    } else {
      c.pendingCount += 1;
      pendingCount += 1;
    }
  }

  // Canonical chain order for a stable UI.
  const perChain: ChainSummary[] = [];
  for (const chain of CHAINS) {
    const c = byChain.get(chain);
    if (c) {
      c.valuedText = formatCentsUsd(c.valuedCents);
      perChain.push(c);
    }
  }

  const chainsWithHoldings = perChain.length;
  const isEmpty = chainsWithHoldings === 0;

  const headline = buildHeadline(totalValuedCents, pricedCount, pendingCount, isEmpty);

  return {
    totalValuedCents,
    totalValuedText: formatCentsUsd(totalValuedCents),
    pricedCount,
    pendingCount,
    chainsWithHoldings,
    perChain,
    isEmpty,
    headline,
  };
}

function buildHeadline(totalCents: number, priced: number, pending: number, isEmpty: boolean): string {
  if (isEmpty) return "No holdings yet — connect a wallet to watch.";
  const parts = [`${formatCentsUsd(totalCents)} valued`];
  parts.push(`${priced} holding${priced === 1 ? "" : "s"} priced`);
  if (pending > 0) parts.push(`${pending} awaiting price`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Security / health posture (honest, computed — never asserted)
// ---------------------------------------------------------------------------

export type PostureItem = {
  label: string;
  ok: boolean;
  detail: string;
};

/**
 * The posture strip for the crypto page. Every item is computed from real state
 * and tells the truth (mirrors the Plaid/Banking posture strips). The
 * watch-only item is ALWAYS ok:true — it's a structural guarantee of this
 * feature (we only ever store public addresses; there are no keys to move funds).
 */
export function cryptoPosture(input: {
  dbReady: boolean;
  walletCount: number;
  pricingConfigured: boolean;
}): PostureItem[] {
  const items: PostureItem[] = [];

  items.push({
    label: "Watch-only",
    ok: true,
    detail:
      "This feature stores only PUBLIC wallet addresses. It can read balances and history but can never move, spend, or withdraw funds — there are no private keys here.",
  });

  items.push({
    label: input.dbReady ? "Database connected" : "Database not connected",
    ok: input.dbReady,
    detail: input.dbReady
      ? "Wallets, balances, and transaction history can be saved."
      : "Add the Supabase service credentials in Vercel so wallets and history can be saved. Until then the page renders but stores nothing.",
  });

  items.push({
    label: input.pricingConfigured ? "USD pricing ready" : "USD pricing pending",
    ok: input.pricingConfigured,
    detail: input.pricingConfigured
      ? "Holdings can be valued in USD for the portfolio total and tax reports."
      : "USD valuation arrives in a later step (CoinGecko). Until then, holdings show quantities and are marked \"value pending\" — never a guessed dollar figure.",
  });

  return items;
}

// ---------------------------------------------------------------------------
// Sync-state → plain-English health line
// ---------------------------------------------------------------------------

export type SyncHealthInput = {
  backfillComplete: boolean;
  status: "idle" | "backfilling" | "syncing" | "error";
  lastSyncedAt: string | null;
  errorMessage: string | null;
} | null;

export type SyncHealthView = {
  tone: "neutral" | "green" | "orange" | "red";
  label: string;
  message: string;
};

/**
 * Turn a wallet's sync-state row into a friendly chip + message. Null (no state
 * yet) reads as "not synced yet", which is the truth before the first backfill.
 */
export function buildSyncHealth(state: SyncHealthInput): SyncHealthView {
  if (!state) {
    return {
      tone: "neutral",
      label: "Not synced yet",
      message: "No history pulled yet. Use “Sync now” on the Health tab to start the full historical backfill.",
    };
  }
  if (state.status === "error") {
    return {
      tone: "red",
      label: "Needs attention",
      message: state.errorMessage?.trim()
        ? state.errorMessage.trim()
        : "The last sync hit a problem. It will retry automatically.",
    };
  }
  if (state.status === "backfilling") {
    return {
      tone: "orange",
      label: "Backfilling history",
      message: "Pulling the full transaction history for the first time — this can take a little while.",
    };
  }
  if (state.status === "syncing") {
    return {
      tone: "orange",
      label: "Syncing",
      message: "Fetching the latest activity now.",
    };
  }
  // idle
  const synced = state.lastSyncedAt?.trim();
  if (state.backfillComplete) {
    return {
      tone: "green",
      label: "Up to date",
      message: synced
        ? `Full history captured. Last refreshed ${formatWhen(synced)}.`
        : "Full history captured.",
    };
  }
  return {
    tone: "neutral",
    label: "Ready",
    message: synced ? `Last refreshed ${formatWhen(synced)}.` : "Ready to pull history on the next sync.",
  };
}

/** Best-effort friendly timestamp; falls back to the raw ISO if unparseable. */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

// ---------------------------------------------------------------------------
// Backfill progress — bridge the stored sync-state to the pure progress model.
// ---------------------------------------------------------------------------

/** The subset of a sync-state record the progress view needs (plus the chain). */
export type WalletProgressStateInput = {
  backfillCursor: string | null;
  prevBackfillCursor: string | null;
  backfillTarget: string | null;
  transactionsTotal: number | null;
  backfillComplete: boolean;
  status: "idle" | "backfilling" | "syncing" | "error";
  lastSyncedAt: string | null;
} | null;

/**
 * Build the render-ready backfill progress view for one wallet. Null state (no
 * sync yet) reads as "Not started". Delegates the honest per-chain reasoning to
 * crypto-progress-core (EVM real %, opaque-cursor chains phase + how-far-back +
 * tx count, plus stuck-loop detection).
 */
export function buildWalletProgress(
  chain: Chain,
  state: WalletProgressStateInput,
): BackfillProgressView {
  return buildBackfillProgress({
    chain,
    cursor: state?.backfillCursor ?? null,
    prevCursor: state?.prevBackfillCursor ?? null,
    targetCursor: state?.backfillTarget ?? null,
    transactionsTotal: state?.transactionsTotal ?? null,
    backfillComplete: state?.backfillComplete ?? false,
    status: state?.status ?? "idle",
    lastSyncedAt: state?.lastSyncedAt ?? null,
  });
}

// ---------------------------------------------------------------------------
// Pure self-test — wired into scripts/compliance/run-pure-selftests.ts + vitest.
// ---------------------------------------------------------------------------

export function __runCryptoUiCoreTests(): void {
  let failures = 0;
  const check = (label: string, cond: boolean): void => {
    if (!cond) {
      failures += 1;
      console.error(`[crypto-ui-core self-test] FAIL: ${label}`);
    }
  };

  // --- tab resolution.
  check("tab default portfolio", resolveCryptoTab(undefined) === "portfolio");
  check("tab wallets", resolveCryptoTab("wallets") === "wallets");
  check("tab addresses alias", resolveCryptoTab("addresses") === "wallets");
  check("tab health", resolveCryptoTab("HEALTH") === "health");
  check("tab unknown → portfolio", resolveCryptoTab("nonsense") === "portfolio");
  check("tab label", cryptoTabLabel("wallets") === "Wallets");

  // --- USD formatting (integer cents, never floats).
  check("usd zero", formatCentsUsd(0) === "$0.00");
  check("usd 1234.56", formatCentsUsd(123456) === "$1,234.56");
  check("usd million", formatCentsUsd(100000000) === "$1,000,000.00");
  check("usd negative", formatCentsUsd(-500) === "-$5.00");
  check("usd null dash", formatCentsUsd(null) === "—");

  // --- token amount formatting from EXACT stored values.
  check(
    "held 1.5 ETH from wei",
    formatHeldAmount({ amountRaw: "1500000000000000000", amountDecimal: null, decimals: 18 }) === "1.5",
  );
  check(
    "held USDT 6dp",
    formatHeldAmount({ amountRaw: "1234560000", amountDecimal: null, decimals: 6 }) === "1234.56",
  );
  check(
    "held xrpl-issued decimal string as-is",
    formatHeldAmount({ amountRaw: null, amountDecimal: "153.750", decimals: null }) === "153.75",
  );
  check(
    "held huge raw with no decimals shows exact",
    formatHeldAmount({ amountRaw: "123456789012345678901234567890", amountDecimal: null, decimals: null }) ===
      "123456789012345678901234567890",
  );
  check("held none → dash", formatHeldAmount({ amountRaw: null, amountDecimal: null, decimals: 18 }) === "—");

  // --- address masking.
  check("mask evm", maskAddress("0x1234567890abcdef1234567890abcdef12345678") === "0x1234…5678");
  check("mask short passthrough", maskAddress("0x1234") === "0x1234");
  check("mask empty dash", maskAddress("") === "—");
  check(
    "mask coreum",
    maskAddress("core1tsev3vtllcvg49d06pxrj8ywsj0hzq576hdttd") === "core1t…dttd",
  );

  // --- add-wallet validation + normalization.
  const evmParse = parseAddWallet({
    chain: "ethereum",
    address: "0xAbC1230000000000000000000000000000000000",
    label: "  Main ETH  ",
  });
  check("evm parse ok", evmParse.ok === true);
  check("evm lower-cased for dedup", evmParse.ok && evmParse.address === "0xabc1230000000000000000000000000000000000");
  check("evm label trimmed", evmParse.ok && evmParse.label === "Main ETH");

  const xrplParse = parseAddWallet({ chain: "xrpl", address: "rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz", label: "" });
  check("xrpl parse ok", xrplParse.ok === true);
  check("xrpl case preserved", xrplParse.ok && xrplParse.address === "rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz");
  check("xrpl empty label → null", xrplParse.ok && xrplParse.label === null);

  const coreParse = parseAddWallet({ chain: "coreum", address: "core1tsev3vtllcvg49d06pxrj8ywsj0hzq576hdttd" });
  check("coreum parse ok", coreParse.ok === true);
  check("coreum case preserved", coreParse.ok && coreParse.address === "core1tsev3vtllcvg49d06pxrj8ywsj0hzq576hdttd");

  check("missing chain rejected", parseAddWallet({ chain: "", address: "0x0" }).ok === false);
  check("unknown chain rejected", parseAddWallet({ chain: "bitcoin", address: "0x0" }).ok === false);
  check("empty address rejected", parseAddWallet({ chain: "ethereum", address: "" }).ok === false);
  check(
    "wrong-shape address rejected",
    parseAddWallet({ chain: "ethereum", address: "core1tsev3vtllcvg49d06pxrj8ywsj0hzq576hdttd" }).ok === false,
  );
  check(
    "xrpl addr on evm chain rejected",
    parseAddWallet({ chain: "ethereum", address: "rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz" }).ok === false,
  );
  // Label capped at max length.
  const longLabel = "x".repeat(200);
  const cappedParse = parseAddWallet({ chain: "ethereum", address: "0x" + "a".repeat(40), label: longLabel });
  check("label capped at max", cappedParse.ok === true && (cappedParse.ok ? cappedParse.label!.length : 0) === WALLET_LABEL_MAX);

  // --- isKnownChain guard.
  check("known chain flare", isKnownChain("flare") === true);
  check("unknown chain solana", isKnownChain("solana") === false);

  // --- wallet row view.
  const row = buildWalletRow({
    id: "w-1",
    chain: "coreum",
    address: "core1tsev3vtllcvg49d06pxrj8ywsj0hzq576hdttd",
    label: null,
    active: true,
  });
  check("row displayName falls back to chain", row.displayName === "Coreum");
  check("row addressShort masked", row.addressShort === "core1t…dttd");
  check("row addressFull preserved", row.addressFull === "core1tsev3vtllcvg49d06pxrj8ywsj0hzq576hdttd");

  const rowLabeled = buildWalletRow({
    id: "w-2",
    chain: "flare",
    address: "0x1234567890abcdef1234567890abcdef12345678",
    label: "DeFi wallet",
    active: true,
  });
  check("row label wins", rowLabeled.displayName === "DeFi wallet");
  check("row chainText", rowLabeled.chainText === "Flare");

  // --- portfolio summary: HONEST totals.
  const summary = computePortfolioSummary([
    { chain: "ethereum", usdValueCents: 250000, hasAmount: true }, // $2,500 priced
    { chain: "ethereum", usdValueCents: 100, hasAmount: true }, // $1 priced (USDT)
    { chain: "flare", usdValueCents: null, hasAmount: true }, // held, unpriced
    { chain: "coreum", usdValueCents: null, hasAmount: true }, // held, unpriced
    { chain: "xrpl", usdValueCents: 0, hasAmount: false }, // zero balance — ignored
  ]);
  check("summary total only priced", summary.totalValuedCents === 250100);
  check("summary total text", summary.totalValuedText === "$2,501.00");
  check("summary priced count", summary.pricedCount === 2);
  check("summary pending count", summary.pendingCount === 2);
  check("summary chains with holdings", summary.chainsWithHoldings === 3); // eth, flare, coreum
  check("summary not empty", summary.isEmpty === false);
  check("summary headline honest", summary.headline === "$2,501.00 valued · 2 holdings priced · 2 awaiting price");
  // Per-chain in canonical order (ethereum before flare before coreum).
  check("summary perChain order", summary.perChain.map((c) => c.chain).join(",") === "ethereum,flare,coreum");
  const eth = summary.perChain.find((c) => c.chain === "ethereum");
  check("summary eth valued", !!eth && eth.valuedCents === 250100 && eth.pricedCount === 2 && eth.pendingCount === 0);
  const flare = summary.perChain.find((c) => c.chain === "flare");
  check("summary flare pending only", !!flare && flare.valuedCents === 0 && flare.pricedCount === 0 && flare.pendingCount === 1);

  // Empty portfolio.
  const empty = computePortfolioSummary([]);
  check("empty summary isEmpty", empty.isEmpty === true);
  check("empty summary total 0", empty.totalValuedCents === 0);
  check("empty summary headline", empty.headline === "No holdings yet — connect a wallet to watch.");

  // A guessed $0 must NEVER be folded in: an unpriced holding stays pending.
  const onlyPending = computePortfolioSummary([{ chain: "flare", usdValueCents: null, hasAmount: true }]);
  check("only-pending total stays 0", onlyPending.totalValuedCents === 0);
  check("only-pending pendingCount 1", onlyPending.pendingCount === 1);
  check("only-pending pricedCount 0", onlyPending.pricedCount === 0);

  // --- posture: watch-only always ok; db/pricing reflect input.
  const posture = cryptoPosture({ dbReady: false, walletCount: 0, pricingConfigured: false });
  const watchOnly = posture.find((p) => p.label === "Watch-only");
  check("posture watch-only ok", !!watchOnly && watchOnly.ok === true);
  const db = posture.find((p) => p.label.startsWith("Database"));
  check("posture db reflects false", !!db && db.ok === false);
  const postureReady = cryptoPosture({ dbReady: true, walletCount: 2, pricingConfigured: true });
  check("posture db ok when ready", !!postureReady.find((p) => p.label === "Database connected" && p.ok));
  check("posture pricing ok when ready", !!postureReady.find((p) => p.label === "USD pricing ready" && p.ok));

  // --- sync health.
  check("sync null → not synced", buildSyncHealth(null).label === "Not synced yet");
  check(
    "sync error → red",
    buildSyncHealth({ backfillComplete: false, status: "error", lastSyncedAt: null, errorMessage: "boom" }).tone === "red",
  );
  check(
    "sync backfilling → orange",
    buildSyncHealth({ backfillComplete: false, status: "backfilling", lastSyncedAt: null, errorMessage: null }).tone === "orange",
  );
  check(
    "sync idle+complete → green up to date",
    buildSyncHealth({ backfillComplete: true, status: "idle", lastSyncedAt: "2026-03-01T00:00:00Z", errorMessage: null }).label === "Up to date",
  );

  // --- no secrets/full addresses leak through view outputs unintentionally:
  // masked short forms must NOT equal the full address for a long address.
  check(
    "masked != full for long addr",
    maskAddress("0x1234567890abcdef1234567890abcdef12345678") !== "0x1234567890abcdef1234567890abcdef12345678",
  );

  // --- backfill progress bridge (delegates to crypto-progress-core).
  check("progress null → not started", buildWalletProgress("flare", null).label === "Not started");
  const prog = buildWalletProgress("flare", {
    backfillCursor: "100:99",
    prevBackfillCursor: "50:49",
    backfillTarget: "200",
    transactionsTotal: 7,
    backfillComplete: false,
    status: "backfilling",
    lastSyncedAt: "2026-08-11T00:00:00Z",
  });
  check("progress evm percent 50", prog.percent === 50 && prog.hasPercent === true);
  check("progress evm reached block", prog.reachedText === "block 100");
  const progXrpl = buildWalletProgress("xrpl", {
    backfillCursor: '{"ledger":106228618,"seq":0}',
    prevBackfillCursor: null,
    backfillTarget: null,
    transactionsTotal: 3,
    backfillComplete: false,
    status: "backfilling",
    lastSyncedAt: null,
  });
  check("progress xrpl no percent", progXrpl.hasPercent === false);
  check("progress xrpl reached ledger", progXrpl.reachedText === "ledger 106,228,618");

  if (failures > 0) {
    throw new Error(`crypto-ui-core self-test failed: ${failures} check(s) failed`);
  }
}
