import { describe, expect, it } from "vitest";
import { __runCartAdjustTests } from "@/lib/pos/cart-adjust-core";

describe("cart-adjust-core", () => {
  it("runs the embedded self-test battery", () => {
    expect(() => __runCartAdjustTests()).not.toThrow();
  });
});
