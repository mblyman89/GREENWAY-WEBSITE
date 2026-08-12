import { describe, it, expect } from "vitest";
import {
  __runStellarMapCoreTests,
  decimalToStroops,
  mapStellarBalance,
  mapStellarBalances,
  mapStellarPayment,
  isDustLeg,
  classifyStellarLeg,
  resolveStellarAssetId,
  type HorizonPaymentRecord,
} from "@/lib/crypto/stellar/stellar-map-core";

const WALLET = "GA5G6NOV57S267XTVZFZYAED2JKPYEBL7X73XZ62B2KIMU237NBGHPMT";
const OTHER = "GDDESEZ2IJUUVGWTCEXJ6QKP6FCO6VMGDD6LMDPIGOSNLAM6XZEZMPRR";

describe("stellar-map-core embedded self-test", () => {
  it("passes every mapping + conversion assertion", () => {
    expect(() => __runStellarMapCoreTests()).not.toThrow();
  });
});

describe("stellar-map-core exact decimal -> stroop conversion (money safety)", () => {
  it("converts decimals to integer stroops with no float error", () => {
    expect(decimalToStroops("279.6501307")).toBe("2796501307");
    expect(decimalToStroops("13926")).toBe("139260000000"); // Michael's final 2018 buy
    expect(decimalToStroops("0.0000001")).toBe("1"); // one stroop (dust)
    expect(decimalToStroops("-50000")).toBe("-500000000000"); // the 2021 sell
    expect(decimalToStroops("0")).toBe("0");
  });

  it("rejects malformed or over-precise amounts loudly (never silently truncates)", () => {
    expect(() => decimalToStroops("1.12345678")).toThrow(); // 8 decimals — impossible for XLM
    expect(() => decimalToStroops("abc")).toThrow();
    expect(() => decimalToStroops("1e7")).toThrow();
  });
});

describe("stellar-map-core balance mapping", () => {
  it("maps native XLM to 7-dec stroops and keeps issued tokens as untracked", () => {
    const native = mapStellarBalance({ balance: "279.6501307", asset_type: "native" });
    expect(native.assetId).toBe("xlm");
    expect(native.amountRaw).toBe("2796501307");
    expect(native.decimalsAtRead).toBe(7);

    const issued = mapStellarBalance({
      balance: "10.0",
      asset_type: "credit_alphanum4",
      asset_code: "USDC",
      asset_issuer: OTHER,
    });
    expect(issued.assetId).toBeNull();
    expect(issued.currency).toBe("USDC");

    // zero balances are dropped (not a holding)
    expect(mapStellarBalances([{ balance: "0.0000000", asset_type: "native" }])).toHaveLength(0);
  });
});

describe("stellar-map-core payment leg direction + dust flagging", () => {
  it("flags a 1-stroop inbound payment as dust (economically zero)", () => {
    const rec: HorizonPaymentRecord = {
      id: "247572957302546493",
      type: "payment",
      transaction_hash: "HASH",
      transaction_successful: true,
      created_at: "2025-06-21T01:52:05Z",
      from: OTHER,
      to: WALLET,
      asset_type: "native",
      amount: "0.0000001",
    };
    const legs = mapStellarPayment(WALLET, rec);
    expect(legs).toHaveLength(1);
    expect(legs[0].direction).toBe("in");
    expect(legs[0].amountRaw).toBe("1");
    expect(legs[0].dust).toBe(true);
    expect(isDustLeg("xlm", "1", "in")).toBe(true);
    expect(isDustLeg("xlm", "1", "out")).toBe(false); // only inbound dust
  });

  it("signs an outbound real payment negative, direction out", () => {
    const rec: HorizonPaymentRecord = {
      id: "900000000000000001",
      type: "payment",
      transaction_hash: "OUT",
      from: WALLET,
      to: OTHER,
      asset_type: "native",
      amount: "50000",
    };
    const legs = mapStellarPayment(WALLET, rec);
    expect(legs[0].direction).toBe("out");
    expect(legs[0].amountRaw).toBe("-500000000000");
    expect(legs[0].dust).not.toBe(true);
  });

  it("treats create_account funding the wallet as an inbound buy", () => {
    const rec: HorizonPaymentRecord = {
      id: "123456789012345678",
      type: "create_account",
      transaction_hash: "CREATE",
      funder: OTHER,
      account: WALLET,
      starting_balance: "1000.0000000",
    };
    const legs = mapStellarPayment(WALLET, rec);
    expect(legs[0].direction).toBe("in");
    expect(legs[0].amountRaw).toBe("10000000000");
    expect(legs[0].counterparty).toBe(OTHER);
  });

  it("ignores a record that does not involve the wallet", () => {
    const rec: HorizonPaymentRecord = { id: "1", type: "payment", from: OTHER, to: OTHER, asset_type: "native", amount: "1" };
    expect(mapStellarPayment(WALLET, rec)).toHaveLength(0);
  });

  it("classifies payment/create as transfer and account_merge as other", () => {
    expect(classifyStellarLeg("payment")).toBe("transfer");
    expect(classifyStellarLeg("create_account")).toBe("transfer");
    expect(classifyStellarLeg("account_merge")).toBe("other");
    expect(resolveStellarAssetId("native")).toBe("xlm");
    expect(resolveStellarAssetId("credit_alphanum4")).toBeNull();
  });
});
