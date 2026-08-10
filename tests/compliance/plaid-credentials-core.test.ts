/**
 * tests/compliance/plaid-credentials-core.test.ts
 *
 * Vitest mirror of the PURE credential-set core (2nd-Plaid-API slice): resolving
 * one/both credential sets from a plain env object, owner labels, the Link
 * picker options (no secrets), set-key normalization, and choosing the right set
 * for an Item or a new Link. No process.env, no I/O here.
 */
import { describe, expect, it } from "vitest";
import {
  resolvePlaidEnvName,
  plaidBasePathFor,
  resolveCredentialSets,
  getCredentialSet,
  normalizeSetKey,
  isSetConfigured,
  ownerLabelForSet,
  linkSetOptions,
  anySetConfigured,
  multipleSetsConfigured,
  chooseSetForItem,
  chooseSetForLink,
  __runPlaidCredentialsCoreTests,
} from "@/lib/plaid/plaid-credentials-core";

describe("plaid-credentials-core harness parity", () => {
  it("runs the embedded self-tests without throwing", () => {
    expect(() => __runPlaidCredentialsCoreTests()).not.toThrow();
  });
});

describe("env name + base path", () => {
  it("folds unknown/retired envs to sandbox and keeps production", () => {
    expect(resolvePlaidEnvName("production")).toBe("production");
    expect(resolvePlaidEnvName("PRODUCTION")).toBe("production");
    expect(resolvePlaidEnvName("sandbox")).toBe("sandbox");
    expect(resolvePlaidEnvName("development")).toBe("sandbox");
    expect(resolvePlaidEnvName(undefined)).toBe("sandbox");
    expect(plaidBasePathFor("production")).toBe("https://production.plaid.com");
    expect(plaidBasePathFor("sandbox")).toBe("https://sandbox.plaid.com");
  });
});

describe("resolveCredentialSets", () => {
  it("always returns both sets in fixed order, unconfigured when empty", () => {
    const sets = resolveCredentialSets({});
    expect(sets.map((s) => s.key)).toEqual(["primary", "secondary"]);
    expect(sets.every((s) => !s.configured)).toBe(true);
    expect(sets.map((s) => s.owner)).toEqual(["Primary", "Secondary"]);
    expect(anySetConfigured(sets)).toBe(false);
  });

  it("trims credentials/owner and resolves env for a configured primary", () => {
    const sets = resolveCredentialSets({
      PLAID_CLIENT_ID: "  cid_1 ",
      PLAID_SECRET: " secret_1\n",
      PLAID_ENV: "production",
      PLAID_OWNER_NAME: "  Michael  ",
    });
    expect(sets[0].configured).toBe(true);
    expect(sets[1].configured).toBe(false);
    expect(sets[0].clientId).toBe("cid_1");
    expect(sets[0].secret).toBe("secret_1");
    expect(sets[0].env).toBe("production");
    expect(sets[0].owner).toBe("Michael");
    expect(anySetConfigured(sets)).toBe(true);
    expect(multipleSetsConfigured(sets)).toBe(false);
  });

  it("configures both sets from the _2 vars", () => {
    const sets = resolveCredentialSets({
      PLAID_CLIENT_ID: "cidM",
      PLAID_SECRET: "secM",
      PLAID_ENV: "production",
      PLAID_OWNER_NAME: "Michael",
      PLAID_CLIENT_ID_2: "cidW",
      PLAID_SECRET_2: "secW",
      PLAID_ENV_2: "production",
      PLAID_OWNER_NAME_2: "Wife",
    });
    expect(sets.every((s) => s.configured)).toBe(true);
    expect(multipleSetsConfigured(sets)).toBe(true);
    expect(getCredentialSet(sets, "secondary")!.clientId).toBe("cidW");
    expect(ownerLabelForSet(sets, "primary")).toBe("Michael");
    expect(ownerLabelForSet(sets, "secondary")).toBe("Wife");
  });
});

describe("linkSetOptions (picker)", () => {
  it("offers only configured sets and never leaks secrets", () => {
    const one = resolveCredentialSets({
      PLAID_CLIENT_ID: "c",
      PLAID_SECRET: "s",
      PLAID_OWNER_NAME: "Michael",
    });
    const opts = linkSetOptions(one);
    expect(opts).toHaveLength(1);
    expect(opts[0].key).toBe("primary");
    expect(opts[0].owner).toBe("Michael");
    expect(Object.prototype.hasOwnProperty.call(opts[0], "secret")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(opts[0], "clientId")).toBe(false);
  });

  it("offers only the secondary set when primary is missing", () => {
    const secOnly = resolveCredentialSets({ PLAID_CLIENT_ID_2: "c", PLAID_SECRET_2: "s" });
    const opts = linkSetOptions(secOnly);
    expect(opts).toHaveLength(1);
    expect(opts[0].key).toBe("secondary");
  });
});

describe("normalizeSetKey", () => {
  it("keeps valid keys and maps everything else to primary", () => {
    expect(normalizeSetKey("secondary")).toBe("secondary");
    expect(normalizeSetKey("SECONDARY")).toBe("secondary");
    expect(normalizeSetKey("primary")).toBe("primary");
    expect(normalizeSetKey(null)).toBe("primary"); // legacy item
    expect(normalizeSetKey("")).toBe("primary");
    expect(normalizeSetKey("nonsense")).toBe("primary");
  });
});

describe("choosing sets", () => {
  const both = resolveCredentialSets({
    PLAID_CLIENT_ID: "cidM",
    PLAID_SECRET: "secM",
    PLAID_CLIENT_ID_2: "cidW",
    PLAID_SECRET_2: "secW",
  });
  const primaryOnly = resolveCredentialSets({ PLAID_CLIENT_ID: "c", PLAID_SECRET: "s" });
  const secondaryOnly = resolveCredentialSets({ PLAID_CLIENT_ID_2: "c", PLAID_SECRET_2: "s" });
  const none = resolveCredentialSets({});

  it("isSetConfigured reflects presence", () => {
    expect(isSetConfigured(both, "secondary")).toBe(true);
    expect(isSetConfigured(primaryOnly, "secondary")).toBe(false);
  });

  it("chooseSetForItem prefers the stored set with safe fallbacks", () => {
    expect(chooseSetForItem(both, "secondary")!.key).toBe("secondary");
    expect(chooseSetForItem(both, null)!.key).toBe("primary"); // legacy
    expect(chooseSetForItem(primaryOnly, "secondary")!.key).toBe("primary"); // unconfigured → primary
    expect(chooseSetForItem(secondaryOnly, "secondary")!.key).toBe("secondary");
    expect(chooseSetForItem(secondaryOnly, "primary")!.key).toBe("secondary"); // first configured
    expect(chooseSetForItem(none, "primary")).toBeNull();
  });

  it("chooseSetForLink only allows configured requested sets", () => {
    expect(chooseSetForLink(both, "secondary")!.key).toBe("secondary");
    expect(chooseSetForLink(both, "primary")!.key).toBe("primary");
    expect(chooseSetForLink(primaryOnly, "secondary")).toBeNull();
    expect(chooseSetForLink(primaryOnly, null)!.key).toBe("primary");
  });
});
