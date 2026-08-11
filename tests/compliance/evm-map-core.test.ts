import { describe, it, expect } from "vitest";
import {
  __runEvmMapCoreTests,
  ERC20_TRANSFER_TOPIC0,
  ZERO_ADDRESS,
  EVM_NATIVE_DECIMALS,
  normAddr,
  sameAddr,
  topicToAddress,
  hexToDecimalString,
  negateMinor,
  isErc20TransferLog,
  isErc721TransferLog,
  nativeAssetIdForChain,
  resolveEvmAssetByContract,
  directionForParties,
  mapNativeTransfer,
  mapErc20TransferLog,
  mapErc20TransferLogs,
  type EvmLog,
  type EvmTxContext,
} from "@/lib/crypto/evm/evm-map-core";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const USDT = "0xdac17f958d2ee523a2206206994597c13d831ec7";

function addrTopic(addr: string): string {
  return "0x" + normAddr(addr).replace(/^0x/, "").padStart(64, "0");
}
function u256(dec: string): string {
  return "0x" + BigInt(dec).toString(16).padStart(64, "0");
}

describe("evm-map-core embedded self-tests", () => {
  it("passes the full in-module self-test battery", () => {
    expect(() => __runEvmMapCoreTests()).not.toThrow();
  });
});

describe("verified constants", () => {
  it("has the correct ERC-20 Transfer topic0", () => {
    expect(ERC20_TRANSFER_TOPIC0).toBe(
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    );
  });
  it("has the zero address and 18 native decimals", () => {
    expect(ZERO_ADDRESS).toBe("0x0000000000000000000000000000000000000000");
    expect(EVM_NATIVE_DECIMALS).toBe(18);
  });
});

describe("address helpers", () => {
  it("normalises and compares case-insensitively", () => {
    expect(normAddr("0xABC")).toBe("0xabc");
    expect(sameAddr("0xABCDEF", "0xabcdef")).toBe(true);
    expect(sameAddr(A, B)).toBe(false);
  });
  it("extracts a lower-cased address from a 32-byte topic", () => {
    expect(topicToAddress(addrTopic(A))).toBe(A);
    expect(
      topicToAddress(
        "0x000000000000000000000000DAC17F958D2EE523A2206206994597C13D831EC7",
      ),
    ).toBe(USDT);
  });
});

describe("exact uint256 parsing", () => {
  it("parses hex and decimal identically and exactly", () => {
    expect(hexToDecimalString("0x00")).toBe("0");
    expect(hexToDecimalString(u256("1000000"))).toBe("1000000");
    expect(hexToDecimalString("1000000")).toBe("1000000");
  });
  it("handles max uint256 without precision loss", () => {
    const MAX =
      "115792089237316195423570985008687907853269984665640564039457584007913129639935";
    expect(hexToDecimalString(u256(MAX))).toBe(MAX);
  });
  it("negates exactly", () => {
    expect(negateMinor("0")).toBe("0");
    expect(negateMinor("500")).toBe("-500");
  });
});

describe("ERC-20 vs ERC-721 discrimination", () => {
  const erc20: EvmLog = {
    address: USDT,
    topics: [ERC20_TRANSFER_TOPIC0, addrTopic(A), addrTopic(B)],
    data: u256("1000000"),
    logIndex: 5,
  };
  const erc721: EvmLog = {
    address: "0x1234567890123456789012345678901234567890",
    topics: [ERC20_TRANSFER_TOPIC0, addrTopic(A), addrTopic(B), u256("42")],
    data: "0x",
    logIndex: 6,
  };
  it("recognises a 3-topic ERC-20 Transfer", () => {
    expect(isErc20TransferLog(erc20)).toBe(true);
    expect(isErc721TransferLog(erc20)).toBe(false);
  });
  it("rejects a 4-topic ERC-721 Transfer as fungible", () => {
    expect(isErc20TransferLog(erc721)).toBe(false);
    expect(isErc721TransferLog(erc721)).toBe(true);
  });
  it("maps an NFT (ERC-721) log to null", () => {
    const ctx: EvmTxContext = {
      txHash: "0xtx",
      blockNumber: 100,
      blockTime: "2024-01-01T00:00:00Z",
      txFrom: A,
      feeWei: "21000",
    };
    expect(mapErc20TransferLog("ethereum", A, ctx, erc721, true)).toBeNull();
  });
});

describe("asset resolution + chain scoping", () => {
  it("resolves native ids per chain", () => {
    expect(nativeAssetIdForChain("ethereum")).toBe("eth");
    expect(nativeAssetIdForChain("flare")).toBe("flr");
    expect(nativeAssetIdForChain("songbird")).toBe("sgb");
    expect(nativeAssetIdForChain("xrpl")).toBeNull();
  });
  it("resolves USDT on ethereum only", () => {
    expect(resolveEvmAssetByContract("ethereum", USDT)).toEqual({
      assetId: "usdt-eth",
      decimals: 6,
    });
    expect(resolveEvmAssetByContract("flare", USDT)).toBeNull();
  });
});

describe("direction", () => {
  it("derives in / out / self", () => {
    expect(directionForParties(A, A, B)).toBe("out");
    expect(directionForParties(A, B, A)).toBe("in");
    expect(directionForParties(A, A, A)).toBe("self");
  });
});

describe("ERC-20 mapping", () => {
  const ctx: EvmTxContext = {
    txHash: "0xtx",
    blockNumber: 100,
    blockTime: "2024-01-01T00:00:00Z",
    txFrom: A,
    feeWei: "21000",
  };
  it("maps a tracked OUT transfer: signed, 6-dec, fee once", () => {
    const log: EvmLog = {
      address: USDT,
      topics: [ERC20_TRANSFER_TOPIC0, addrTopic(A), addrTopic(B)],
      data: u256("1000000"),
      logIndex: 5,
    };
    const m = mapErc20TransferLog("ethereum", A, ctx, log, true);
    expect(m).not.toBeNull();
    expect(m!.assetId).toBe("usdt-eth");
    expect(m!.decimalsAtEvent).toBe(6);
    expect(m!.direction).toBe("out");
    expect(m!.amountRaw).toBe("-1000000");
    expect(m!.feeRaw).toBe("21000");
    expect(m!.feeAssetId).toBe("eth");
    expect(m!.eventIndex).toBe(5);
  });
  it("keeps an untracked token with contract recorded", () => {
    const UNK = "0x9999999999999999999999999999999999999999";
    const log: EvmLog = {
      address: UNK,
      topics: [ERC20_TRANSFER_TOPIC0, addrTopic(A), addrTopic(B)],
      data: u256("777"),
      logIndex: 8,
    };
    const m = mapErc20TransferLog("ethereum", A, ctx, log, false);
    expect(m).not.toBeNull();
    expect(m!.assetId).toBeNull();
    expect(m!.currency).toBe(UNK);
    expect(m!.issuer).toBe(UNK);
    expect(m!.decimalsAtEvent).toBeNull();
  });
  it("attaches the native fee at most once across legs", () => {
    const logs: EvmLog[] = [
      {
        address: USDT,
        topics: [ERC20_TRANSFER_TOPIC0, addrTopic(A), addrTopic(B)],
        data: u256("100"),
        logIndex: 0,
      },
      {
        address: USDT,
        topics: [ERC20_TRANSFER_TOPIC0, addrTopic(A), addrTopic(B)],
        data: u256("200"),
        logIndex: 1,
      },
    ];
    const mapped = mapErc20TransferLogs("ethereum", A, ctx, logs);
    expect(mapped.length).toBe(2);
    expect(mapped.filter((m) => m.feeRaw != null).length).toBe(1);
  });
});

describe("native transfer mapping", () => {
  it("maps OUT signed with fee, IN positive without fee", () => {
    const out = mapNativeTransfer("ethereum", A, {
      txHash: "0xn1",
      from: A,
      to: B,
      valueWei: "1000000000000000000",
      blockNumber: 200,
      blockTime: "2024-02-02T00:00:00Z",
      feeWei: "21000000000000",
    });
    expect(out!.amountRaw).toBe("-1000000000000000000");
    expect(out!.feeRaw).toBe("21000000000000");
    expect(out!.decimalsAtEvent).toBe(18);

    const inb = mapNativeTransfer("flare", A, {
      txHash: "0xn2",
      from: B,
      to: A,
      valueWei: "5000000000000000000",
      blockNumber: 201,
      blockTime: "2024-02-03T00:00:00Z",
      feeWei: "12345",
    });
    expect(inb!.assetId).toBe("flr");
    expect(inb!.amountRaw).toBe("5000000000000000000");
    expect(inb!.feeRaw).toBeNull();
  });
});
