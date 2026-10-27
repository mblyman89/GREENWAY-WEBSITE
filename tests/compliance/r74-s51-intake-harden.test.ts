import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { __runIntakeHardenTests, readTransferBody } from "@/lib/inbound-email/intake-harden-core";
import { extractAllTransferLinksFromBody } from "@/lib/inbound-email/resend-receiving-core";

describe("R74 S51 intake auto-fetch hardening", () => {
  it("self-tests pass and are pinned in the runner", () => {
    expect(__runIntakeHardenTests()).toEqual({ passed: 22, failed: 0 });
    const runner = readFileSync("scripts/compliance/run-pure-selftests.ts", "utf8");
    expect(runner).toContain('assertRan("intake-harden-core", __runIntakeHardenTests(), 22)');
  });

  it("rebuilds the owner's wrapped GrowFlow token link", () => {
    const text = [
      "WCIA Transfer Data Link (JSON):",
      "https://go.growflow.com/wa/wcia/transfer?token=EAAAAA8xM1c%",
      "2Fk0HqoZTljijaQITCjchpL1%2B93BBYk1yxkFrI6igvOsNNGswxTOu",
      "dP7dblpXkNwpsSu1hue25Igtx%2FhMMj1aGcI3654GLbU%2FGRdnV",
      "",
    ].join("\n");
    const links = extractAllTransferLinksFromBody("", text);
    expect(links[0]).toBe(
      "https://go.growflow.com/wa/wcia/transfer?token=EAAAAA8xM1c%2Fk0HqoZTljijaQITCjchpL1%2B93BBYk1yxkFrI6igvOsNNGswxTOudP7dblpXkNwpsSu1hue25Igtx%2FhMMj1aGcI3654GLbU%2FGRdnV",
    );
  });

  it("names GrowFlow's 200-OK refusals", () => {
    expect(readTransferBody("Link has expired").kind).toBe("expired");
  });
});
