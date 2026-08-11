import { describe, it, expect } from "vitest";
import {
  __runEvmClientCoreTests,
  ETHERSCAN_V2_BASE,
  FLARE_EXPLORER_BASE,
  SONGBIRD_EXPLORER_BASE,
  EVM_MIN_REQUEST_SPACING_MS,
  EVM_MAX_RETRIES,
  EVM_DEFAULT_PAGE_SIZE,
  EVM_MAX_PAGE_SIZE,
  EVM_START_BLOCK,
  resolveEvmExplorerBase,
  chainNeedsApiKey,
  etherscanChainId,
  clampPageSize,
  balanceRequest,
  txlistRequest,
  tokentxRequest,
  blockNumberRequest,
  parseBlockNumberResult,
  interpretExplorerBody,
  isRetryableHttpStatus,
  serializeEvmCursor,
  deserializeEvmCursor,
  initEvmCursor,
  nextRequestDelayMs,
  backoffDelayMs,
  shouldRetry,
  asTxListRows,
  asTokenTxRows,
  maxBlockFromTxList,
  maxBlockFromTokenTx,
  maxBlockAcrossRows,
  type EvmTxListRow,
  type EvmTokenTxRow,
} from "@/lib/crypto/evm/evm-client-core";

describe("evm-client-core embedded self-test", () => {
  it("passes every URL/query/cursor/throttle assertion", () => {
    expect(() => __runEvmClientCoreTests()).not.toThrow();
  });
});

describe("verified explorer endpoints (deep-researched 2026-08-11)", () => {
  it("uses Etherscan V2 unified multichain for Ethereum", () => {
    expect(ETHERSCAN_V2_BASE).toBe("https://api.etherscan.io/v2/api");
  });
  it("uses Flare's official Blockscout explorer (keyless)", () => {
    expect(FLARE_EXPLORER_BASE).toBe("https://flare-explorer.flare.network/api");
  });
  it("uses Songbird's official Blockscout explorer (keyless)", () => {
    expect(SONGBIRD_EXPLORER_BASE).toBe("https://songbird-explorer.flare.network/api");
  });
  it("starts backfill from genesis block 0", () => {
    expect(EVM_START_BLOCK).toBe(0);
  });
});

describe("chain policy: which chains need an API key", () => {
  it("Ethereum needs a key; Flare and Songbird do not", () => {
    expect(chainNeedsApiKey("ethereum")).toBe(true);
    expect(chainNeedsApiKey("flare")).toBe(false);
    expect(chainNeedsApiKey("songbird")).toBe(false);
  });
  it("maps chains to Etherscan V2 chainids (1/14/19)", () => {
    expect(etherscanChainId("ethereum")).toBe(1);
    expect(etherscanChainId("flare")).toBe(14);
    expect(etherscanChainId("songbird")).toBe(19);
    expect(etherscanChainId("xrpl")).toBeNull();
  });
  it("rejects non-EVM chains for the explorer base", () => {
    expect(() => resolveEvmExplorerBase("xrpl" as never)).toThrow();
  });
  it("strips trailing slashes from a valid override", () => {
    expect(resolveEvmExplorerBase("flare", "https://example.com/api/")).toBe(
      "https://example.com/api",
    );
  });
});

describe("query building (Etherscan-compatible shape)", () => {
  it("builds a balance request with module=account&action=balance", () => {
    const req = balanceRequest("flare", "0xAbC", null);
    expect(req.url).toContain("module=account");
    expect(req.url).toContain("action=balance");
    expect(req.url).toContain("address=0xAbC");
    expect(req.url).toContain("tag=latest");
    expect(req.url).not.toContain("apikey=");
  });
  it("adds chainid=1 and apikey for Ethereum", () => {
    const req = txlistRequest("ethereum", "0xAbC", "MYKEY", {
      startBlock: 0,
      endBlock: 100,
    });
    expect(req.url).toContain("chainid=1");
    expect(req.url).toContain("apikey=MYKEY");
    expect(req.url).toContain("action=txlist");
    expect(req.url).toContain("startblock=0");
    expect(req.url).toContain("endblock=100");
    expect(req.url).toContain("sort=asc");
  });
  it("builds a tokentx request with the right action", () => {
    const req = tokentxRequest("songbird", "0xAbC", null, {
      startBlock: 50,
      endBlock: 500,
      page: 3,
      offset: 100,
      sort: "desc",
    });
    expect(req.url).toContain("action=tokentx");
    expect(req.url).toContain("startblock=50");
    expect(req.url).toContain("page=3");
    expect(req.url).toContain("offset=100");
    expect(req.url).toContain("sort=desc");
    expect(req.url).not.toContain("chainid=");
  });
  it("builds a proxy eth_blockNumber request for the tip", () => {
    const req = blockNumberRequest("ethereum", "K");
    expect(req.url).toContain("module=proxy");
    expect(req.url).toContain("action=eth_blockNumber");
    expect(req.url).toContain("chainid=1");
  });
});

describe("block-number response parsing", () => {
  it("decodes a hex block number to decimal", () => {
    const r = parseBlockNumberResult({ result: "0x10c868" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result).toBe(0x10c868);
  });
  it("treats a missing result as retryable", () => {
    const r = parseBlockNumberResult({ result: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryable).toBe(true);
  });
  it("treats a rate-limit message as retryable", () => {
    const r = parseBlockNumberResult({ result: "", message: "Max rate limit reached" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryable).toBe(true);
  });
});

describe("explorer response interpretation", () => {
  it("status 1 = ok with data", () => {
    const r = interpretExplorerBody({ status: "1", message: "OK", result: [{ hash: "0x1" }] });
    expect(r.ok).toBe(true);
  });
  it("status 0 + No transactions = empty page (ok, [])", () => {
    const r = interpretExplorerBody({ status: "0", message: "No transactions found", result: [] });
    expect(r.ok).toBe(true);
  });
  it("rate-limit message = retryable error", () => {
    const r = interpretExplorerBody({ status: "0", message: "Max rate limit reached", result: "..." });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryable).toBe(true);
  });
  it("empty body = retryable", () => {
    const r = interpretExplorerBody(null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryable).toBe(true);
  });
});

describe("block-range cursor model (resumable backfill)", () => {
  it("initialises at genesis (block 0, lastConsumed -1)", () => {
    const c = initEvmCursor(null);
    expect(c.nextStartBlock).toBe(0);
    expect(c.lastConsumedBlock).toBe(-1);
  });
  it("round-trips a cursor through text storage as nextStart:lastConsumed", () => {
    const ser = serializeEvmCursor({ nextStartBlock: 500, lastConsumedBlock: 499 });
    expect(ser).toBe("500:499");
    const deser = deserializeEvmCursor(ser);
    expect(deser).toEqual({ nextStartBlock: 500, lastConsumedBlock: 499 });
  });
  it("rejects garbage cursor strings", () => {
    expect(deserializeEvmCursor("garbage")).toBeNull();
    expect(deserializeEvmCursor(null)).toBeNull();
  });
  it("resumes from a saved cursor", () => {
    expect(initEvmCursor("1234:1233").nextStartBlock).toBe(1234);
  });
});

describe("throttle + backoff policy (fair use)", () => {
  it("spaces requests by the minimum interval", () => {
    expect(EVM_MIN_REQUEST_SPACING_MS).toBe(220);
    expect(nextRequestDelayMs(null, 1000)).toBe(0);
    expect(nextRequestDelayMs(1000, 1100, 220)).toBe(120);
    expect(nextRequestDelayMs(1000, 2000, 220)).toBe(0);
  });
  it("uses exponential backoff capped at 8s", () => {
    expect(backoffDelayMs(0, 500, 8000)).toBe(500);
    expect(backoffDelayMs(2, 500, 8000)).toBe(2000);
    expect(backoffDelayMs(10, 500, 8000)).toBe(8000);
  });
  it("retries retryable failures up to the limit", () => {
    expect(shouldRetry(1, true, EVM_MAX_RETRIES)).toBe(true);
    expect(shouldRetry(EVM_MAX_RETRIES, true, EVM_MAX_RETRIES)).toBe(false);
    expect(shouldRetry(0, false, EVM_MAX_RETRIES)).toBe(false);
  });
  it("treats 429 and 5xx as retryable HTTP statuses", () => {
    expect(isRetryableHttpStatus(429)).toBe(true);
    expect(isRetryableHttpStatus(503)).toBe(true);
    expect(isRetryableHttpStatus(404)).toBe(false);
  });
});

describe("page-size clamping", () => {
  it("clamps into the safe range", () => {
    expect(clampPageSize(undefined)).toBe(EVM_DEFAULT_PAGE_SIZE);
    expect(clampPageSize(0)).toBe(1);
    expect(clampPageSize(EVM_MAX_PAGE_SIZE + 100)).toBe(EVM_MAX_PAGE_SIZE);
    expect(clampPageSize(500)).toBe(500);
  });
});

describe("row coercion + max-block helpers", () => {
  const txRows: EvmTxListRow[] = [
    { hash: "0xa", from: "0x1", to: "0x2", value: "100", blockNumber: "10", timeStamp: "1", gasUsed: "21000", gasPrice: "1", isError: "0", transactionIndex: "0" },
    { hash: "0xb", from: "0x2", to: "0x1", value: "200", blockNumber: "25", timeStamp: "2", gasUsed: "21000", gasPrice: "1", isError: "0", transactionIndex: "1" },
  ];
  const tokRows: EvmTokenTxRow[] = [
    { hash: "0xc", from: "0x1", to: "0x3", value: "50", contractAddress: "0x", tokenDecimal: "6", tokenSymbol: "USDT", blockNumber: "40", timeStamp: "3", gasUsed: "50000", gasPrice: "1" },
  ];
  it("coerces valid arrays and rejects bad input", () => {
    expect(asTxListRows(txRows)).toHaveLength(2);
    expect(asTxListRows("nope")).toHaveLength(0);
    expect(asTokenTxRows(tokRows)).toHaveLength(1);
  });
  it("finds the highest block across both row sets", () => {
    expect(maxBlockFromTxList(txRows)).toBe(25);
    expect(maxBlockFromTokenTx(tokRows)).toBe(40);
    expect(maxBlockAcrossRows(txRows, tokRows)).toBe(40);
    expect(maxBlockAcrossRows([], [])).toBe(0);
  });
});
