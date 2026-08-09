/**
 * tests/compliance/atm-ui-core.test.ts  (SLICE A-2a)
 *
 * Vitest mirror for the ATM back-office presentation core (/admin/atm). Pins
 * the tab allow-list, the plain-English connection status line (with masked
 * values only), the HONEST security-posture readout, and the no-secret-leak
 * invariant. No I/O — pure UI logic.
 */
import { describe, expect, it } from "vitest";
import {
  resolveAtmTab,
  atmConnectionStatusLine,
  atmSecurityPosture,
  passwordHint,
  __runAtmUiCoreTests,
} from "@/lib/atm/atm-ui-core";

describe("resolveAtmTab (allow-list; unknown → health)", () => {
  it("defaults to health", () => {
    expect(resolveAtmTab(undefined)).toBe("health");
    expect(resolveAtmTab("")).toBe("health");
    expect(resolveAtmTab("nonsense")).toBe("health");
  });
  it("passes through known tabs (case-insensitive)", () => {
    expect(resolveAtmTab("health")).toBe("health");
    expect(resolveAtmTab("transactions")).toBe("transactions");
    expect(resolveAtmTab("TRANSACTIONS")).toBe("transactions");
    expect(resolveAtmTab("loads")).toBe("loads");
  });
  it("accepts friendly aliases", () => {
    expect(resolveAtmTab("settlements")).toBe("transactions");
    expect(resolveAtmTab("fees")).toBe("transactions");
    expect(resolveAtmTab("cash-loads")).toBe("loads");
    expect(resolveAtmTab("cash")).toBe("loads");
  });
});

describe("atmConnectionStatusLine", () => {
  it("ok → green Connected with terminal + last sync", () => {
    const v = atmConnectionStatusLine({
      status: "ok",
      terminalId: "HG26499",
      lastSyncAt: "2026-01-05T14:00:00Z",
    });
    expect(v.tone).toBe("green");
    expect(v.label).toBe("Connected");
    expect(v.detail).toContain("HG26499");
    expect(v.detail).toContain("last sync");
  });

  it("error → orange with last error", () => {
    const v = atmConnectionStatusLine({ status: "error", lastError: "401 Unauthorized" });
    expect(v.tone).toBe("orange");
    expect(v.label).toBe("Needs attention");
    expect(v.detail).toContain("401 Unauthorized");
  });

  it("unconfigured (no creds) points at the portal", () => {
    const v = atmConnectionStatusLine({ status: "unconfigured", hasCredentials: false });
    expect(v.tone).toBe("neutral");
    expect(v.label).toBe("Not connected");
    expect(v.detail.toLowerCase()).toContain("paireports.com");
  });

  it("unconfigured (creds saved) nudges Test connection", () => {
    const v = atmConnectionStatusLine({ status: "unconfigured", hasCredentials: true });
    expect(v.detail.toLowerCase()).toContain("test connection");
  });

  it("normalizes unknown status to unconfigured", () => {
    expect(atmConnectionStatusLine({ status: "weird" }).status).toBe("unconfigured");
  });

  it("truncates a very long error", () => {
    const v = atmConnectionStatusLine({ status: "error", lastError: "x".repeat(500) });
    expect(v.detail.length).toBeLessThan(500);
    expect(v.detail).toContain("…");
  });
});

describe("atmSecurityPosture (honest readout)", () => {
  it("reports encryption OK when the key is set", () => {
    const p = atmSecurityPosture({ encryptionOn: true });
    expect(p).toHaveLength(4);
    expect(p.find((x) => x.key === "encryption")!.ok).toBe(true);
  });
  it("reports encryption NOT ok (and names the env var) when the key is missing", () => {
    const p = atmSecurityPosture({ encryptionOn: false });
    const enc = p.find((x) => x.key === "encryption")!;
    expect(enc.ok).toBe(false);
    expect(enc.note).toContain("DATA_ENCRYPTION_KEY");
  });
  it("always ships RLS/masking/audit as ok (migration guarantees them)", () => {
    const p = atmSecurityPosture({ encryptionOn: false });
    expect(p.find((x) => x.key === "rls")!.ok).toBe(true);
    expect(p.find((x) => x.key === "masking")!.ok).toBe(true);
    expect(p.find((x) => x.key === "audit")!.ok).toBe(true);
  });
});

describe("passwordHint", () => {
  it("has-password hint says leave blank to keep", () => {
    expect(passwordHint(true).toLowerCase()).toContain("leave blank");
  });
  it("no-password hint says none saved", () => {
    expect(passwordHint(false).toLowerCase()).toContain("no password");
  });
});

describe("no-secret-leak invariant", () => {
  it("no output string exposes a password value", () => {
    const sweep = JSON.stringify([
      atmConnectionStatusLine({ status: "ok", terminalId: "HG26499", lastSyncAt: "2026-01-05T14:00:00Z" }),
      atmSecurityPosture({ encryptionOn: true }),
      passwordHint(true),
    ]);
    expect(sweep.toLowerCase()).not.toContain("password:");
  });
});

describe("self-test harness parity", () => {
  it("__runAtmUiCoreTests passes (same assertions as the pure runner)", () => {
    expect(() => __runAtmUiCoreTests()).not.toThrow();
  });
});
