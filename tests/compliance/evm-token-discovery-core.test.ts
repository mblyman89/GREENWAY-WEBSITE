/**
 * AREA 3 — Alt-coin discovery (Flare/Songbird), pure core.
 *
 * Locks down the truths Michael's portfolio depends on:
 *   • Every token an address holds is discovered from the explorer's tokenlist
 *     (his public address alone reveals them all — no coin list needed).
 *   • Decimals are NEVER guessed: list → getToken → on-chain eth_call, else the
 *     token is left "unverified" and produces NO balance.
 *   • Scam ERC-721/ERC-1155 airdrops are classified non-fungible and can never
 *     masquerade as a coin balance.
 *   • Deterministic, chain-scoped asset ids (no collisions across chains).
 *
 * Fixtures use REAL contracts/decimals/balances captured live from Michael's
 * wallet (0xB57Fb1217cc868D401426012157d6CFd311272e4) on 2026-08-12.
 */
import { describe, it, expect } from "vitest";
import {
  __runEvmTokenDiscoveryCoreTests,
  discoverFromTokenList,
  discoveredAssetId,
  classifyTokenKind,
  parseDecimalsString,
  parseDecimalsFromEthCall,
  normalizeBalanceRaw,
  applyResolvedDecimals,
  fungibleTokens,
  nonFungibleTokens,
  unverifiedErc20Tokens,
  tokensNeedingDecimals,
  tokenListRequest,
  getTokenRequest,
  decimalsEthCallRequest,
  buildDiscoveredAssetUpsert,
  buildDiscoveredAssetUpserts,
  buildDiscoveredBalanceUpsert,
  buildDiscoveredBalanceUpserts,
  supportsTokenListDiscovery,
  ERC20_DECIMALS_SELECTOR,
} from "@/lib/crypto/evm/evm-token-discovery-core";

describe("evm-token-discovery-core", () => {
  it("passes its embedded self-tests", () => {
    expect(() => __runEvmTokenDiscoveryCoreTests()).not.toThrow();
  });

  it("never guesses decimals (blank ERC-20 is not fungible until enriched)", () => {
    expect(parseDecimalsString("")).toBeNull();
    expect(parseDecimalsString("x")).toBeNull();
    expect(parseDecimalsString("256")).toBeNull();
    expect(parseDecimalsString("18")).toBe(18);
    expect(parseDecimalsString("6")).toBe(6);
    expect(parseDecimalsString("0")).toBe(0);
  });

  it("reads on-chain decimals() ground truth (verified against real coins)", () => {
    // WFLR=18, FLRFROG=9, PONZU=8, FXRP=6 (cross-checked live)
    expect(parseDecimalsFromEthCall("0x" + "0".repeat(62) + "12")).toBe(18);
    expect(parseDecimalsFromEthCall("0x" + "0".repeat(63) + "9")).toBe(9);
    expect(parseDecimalsFromEthCall("0x" + "0".repeat(63) + "8")).toBe(8);
    expect(parseDecimalsFromEthCall("0x" + "0".repeat(63) + "6")).toBe(6);
    expect(parseDecimalsFromEthCall("0x" + "f".repeat(64))).toBeNull();
  });

  it("classifies scam NFTs as non-fungible so they can't be a coin balance", () => {
    expect(classifyTokenKind("ERC-721")).toBe("erc721");
    expect(classifyTokenKind("ERC-1155")).toBe("erc1155");
    expect(classifyTokenKind("ERC-20")).toBe("erc20");
  });

  it("discovers Michael's real Flare holdings from the tokenlist payload", () => {
    // A trimmed slice of his ACTUAL live tokenlist (real contracts/decimals).
    const body = {
      status: "1",
      result: [
        { balance: "10622489755199979940973", contractAddress: "0x12e605bc104e93b45e1ad99f9e555f659051c2bb", decimals: "18", name: "Staked FLR", symbol: "sFLR", type: "ERC-20" },
        { balance: "91140000000000", contractAddress: "0x19cf770bbb7b71977b860e7fd8d32fa2513a743c", decimals: "9", name: "FlareFrog", symbol: "FLRFROG", type: "ERC-20" },
        { balance: "11616811730", contractAddress: "0xad552a648c74d49e10027ab8a618a3ad4901c5be", decimals: "6", name: "FXRP", symbol: "FXRP", type: "ERC-20" },
        { balance: "1399384270919395", contractAddress: "0xe08e179c2918369a39689512f2d1bf07b82e0ff6", decimals: "8", name: "Ponzu Sauce", symbol: "PONZU", type: "ERC-20" },
        { balance: "1", contractAddress: "0x0b9527a04af14fb2fc9772487ded5ee8d53ff38e", decimals: "", name: "ATTENTION SECURITY WARNING", symbol: "WARNING", type: "ERC-1155" },
        { balance: "1", contractAddress: "0x05850558c51b8fbd914a802d6881f420295226ac", decimals: "", name: "! IMPORTANT ALERT", symbol: "! IMPORTANT ALERT", type: "ERC-721" },
      ],
    };
    const tokens = discoverFromTokenList("flare", body);
    expect(tokens.length).toBe(6);

    const fung = fungibleTokens(tokens);
    expect(fung.map((t) => t.symbol).sort()).toEqual(["FLRFROG", "FXRP", "PONZU", "sFLR"]);
    // decimals preserved exactly (mix of 18/9/6/8 — proves no default-to-18)
    expect(fung.find((t) => t.symbol === "sFLR")!.decimals).toBe(18);
    expect(fung.find((t) => t.symbol === "FLRFROG")!.decimals).toBe(9);
    expect(fung.find((t) => t.symbol === "FXRP")!.decimals).toBe(6);
    expect(fung.find((t) => t.symbol === "PONZU")!.decimals).toBe(8);

    // scam NFTs are separated, never fungible
    expect(nonFungibleTokens(tokens).length).toBe(2);
    expect(nonFungibleTokens(tokens).every((t) => t.fungible === false)).toBe(true);

    // deterministic ids scoped to chain
    expect(fung.find((t) => t.symbol === "FXRP")!.assetId).toBe("flare:0xad552a648c74d49e10027ab8a618a3ad4901c5be");
  });

  it("enriches a blank-decimals ERC-20 only from a first-party source", () => {
    const body = { result: [{ contractAddress: "0xdeadbeef00000000000000000000000000000001", decimals: "", symbol: "MYS", name: "Mystery", type: "ERC-20", balance: "5" }] };
    const [mys] = discoverFromTokenList("flare", body);
    expect(mys.fungible).toBe(false);
    expect(tokensNeedingDecimals([mys]).length).toBe(1);
    expect(unverifiedErc20Tokens([mys]).length).toBe(1);

    // eth_call wins over getToken; both present -> ground truth used
    const byCall = applyResolvedDecimals(mys, { ethCallHex: "0x" + "0".repeat(63) + "6", getToken: { decimals: "8" } });
    expect(byCall.decimals).toBe(6);
    expect(byCall.decimalsProvenance).toBe("eth_call");
    expect(byCall.fungible).toBe(true);

    // no trustworthy source -> stays unverified, no balance
    const none = applyResolvedDecimals(mys, { ethCallHex: "bad", getToken: { decimals: "" } });
    expect(none.decimals).toBeNull();
    expect(none.fungible).toBe(false);
  });

  it("dedupes a contract appearing twice and normalises balances", () => {
    const body = { result: [
      { contractAddress: "0xAAA0000000000000000000000000000000000001", decimals: "18", symbol: "A", type: "ERC-20", balance: "000100" },
      { contractAddress: "0xaaa0000000000000000000000000000000000001", decimals: "18", symbol: "A", type: "ERC-20", balance: "999" },
    ] };
    const tokens = discoverFromTokenList("flare", body);
    expect(tokens.length).toBe(1);
    expect(tokens[0].balanceRaw).toBe("100");
    expect(normalizeBalanceRaw("000123")).toBe("123");
    expect(normalizeBalanceRaw("")).toBeNull();
  });

  it("builds correct discovery request URLs", () => {
    const list = tokenListRequest("flare", "0xB57Fb1217cc868D401426012157d6CFd311272e4", null);
    expect(list.url).toContain("action=tokenlist");
    expect(list.url).toContain("module=account");

    const get = getTokenRequest("songbird", "0x02f0826ef6aD107Cfc861152B32B52fD11BaB9ED", null);
    expect(get.url).toContain("module=token");
    expect(get.url).toContain("action=getToken");

    const call = decimalsEthCallRequest("flare", "0x1d80c49bbbcd1c0911346656b529df9e5c2f783d");
    expect(call).not.toBeNull();
    expect(call!.url.endsWith("/eth-rpc")).toBe(true);
    expect(call!.body).toContain(ERC20_DECIMALS_SELECTOR);
    // Ethereum is not a Blockscout chain -> no eth-rpc discovery call
    expect(decimalsEthCallRequest("ethereum", "0x1d80c49bbbcd1c0911346656b529df9e5c2f783d")).toBeNull();
  });

  it("registers only verified fungible ERC-20s as assets (never NFT/unverified)", () => {
    const body = { result: [
      { balance: "91140000000000", contractAddress: "0x19cf770bbb7b71977b860e7fd8d32fa2513a743c", decimals: "9", name: "FlareFrog", symbol: "FLRFROG", type: "ERC-20" },
      { balance: "1", contractAddress: "0x0b9527a04af14fb2fc9772487ded5ee8d53ff38e", decimals: "", name: "ATTENTION SECURITY WARNING", symbol: "WARNING", type: "ERC-1155" },
      { balance: "5", contractAddress: "0xdeadbeef00000000000000000000000000000001", decimals: "", name: "Mystery", symbol: "MYS", type: "ERC-20" },
    ] };
    const tokens = discoverFromTokenList("flare", body);
    const rows = buildDiscoveredAssetUpserts(tokens);
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe("flare:0x19cf770bbb7b71977b860e7fd8d32fa2513a743c");
    expect(rows[0].decimals).toBe(9);
    expect(rows[0].decimals_source).toBe("verified");
    expect(rows[0].amount_model).toBe("evm-minor");
    expect(rows[0].native).toBe(false);
    expect(rows[0].active).toBe(true);

    const nft = tokens.find((t) => t.kind === "erc1155")!;
    expect(buildDiscoveredAssetUpsert(nft)).toBeNull();
    const mys = tokens.find((t) => t.symbol === "MYS")!;
    expect(buildDiscoveredAssetUpsert(mys)).toBeNull();
  });

  it("persists a live balance only for verified fungible tokens, USD never guessed", () => {
    const body = { result: [
      { balance: "11075251583124990077101711", contractAddress: "0x1d80c49bbbcd1c0911346656b529df9e5c2f783d", decimals: "18", name: "Wrapped Flare", symbol: "WFLR", type: "ERC-20" },
      { balance: "1", contractAddress: "0x05850558c51b8fbd914a802d6881f420295226ac", decimals: "", name: "! IMPORTANT ALERT", symbol: "ALERT", type: "ERC-721" },
    ] };
    const tokens = discoverFromTokenList("flare", body);
    const rows = buildDiscoveredBalanceUpserts("wallet-x", tokens, "2026-08-12T00:00:00Z");
    expect(rows.length).toBe(1);
    expect(rows[0].asset_id).toBe("flare:0x1d80c49bbbcd1c0911346656b529df9e5c2f783d");
    expect(rows[0].amount_raw).toBe("11075251583124990077101711");
    expect(rows[0].decimals_at_read).toBe(18);
    expect(rows[0].usd_value_cents).toBeNull();
    expect(rows[0].amount_decimal).toBeNull();

    const nft = tokens.find((t) => t.kind === "erc721")!;
    expect(buildDiscoveredBalanceUpsert("wallet-x", nft, "t")).toBeNull();
  });

  it("gives a stable, collision-free asset id per chain", () => {
    expect(discoveredAssetId("flare", "0xABC0000000000000000000000000000000000001")).toBe("flare:0xabc0000000000000000000000000000000000001");
    expect(discoveredAssetId("songbird", "0xABC0000000000000000000000000000000000001")).toBe("songbird:0xabc0000000000000000000000000000000000001");
    expect(discoveredAssetId("flare", "0xabc0000000000000000000000000000000000001")).not.toBe(discoveredAssetId("songbird", "0xabc0000000000000000000000000000000000001"));
  });

  it("knows tokenlist discovery is Blockscout-only (the USDT fix routing)", () => {
    // Flare/Songbird (Blockscout) expose account&action=tokenlist → true.
    expect(supportsTokenListDiscovery("flare")).toBe(true);
    expect(supportsTokenListDiscovery("songbird")).toBe(true);
    // Ethereum (Etherscan) has NO tokenlist action → false, so the server must
    // derive ERC-20 balances (e.g. USDT-on-ETH) from tokentx history instead.
    expect(supportsTokenListDiscovery("ethereum")).toBe(false);
  });
});
