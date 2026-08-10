/**
 * src/lib/plaid/plaid-credentials-core.ts — PURE credential-set logic.
 *
 * WHY THIS EXISTS
 * Michael has one Plaid Hobby account (10 free Items); his wife has her OWN
 * Plaid Hobby account (another 10). Their combined 10–20 accounts can't all fit
 * under a single Plaid client. So the app supports MULTIPLE "credential sets" —
 * each set is one {clientId, secret, env} triple owned by a person.
 *
 * LOAD-BEARING FACT (verified against the existing code + Plaid's model):
 * every Plaid API call ABOUT an Item (transactionsSync, accountsGet,
 * itemPublicTokenExchange, webhookVerificationKeyGet) must use the SAME
 * credentials the Item was linked under. So each stored Item remembers which
 * set created it (`credentialSet`), and the server builds a Plaid client PER
 * set. This module is the pure brain that:
 *   - resolves the configured sets from a plain env object (no process.env here),
 *   - normalizes/validates a set key,
 *   - gives each set an owner label for the UI + grouping,
 *   - lists the sets available in the Link picker,
 *   - chooses the right set for an Item (with a safe fallback).
 *
 * BACK-COMPAT: the "primary" set is the existing PLAID_CLIENT_ID / PLAID_SECRET
 * / PLAID_ENV — unchanged. The "secondary" set is new PLAID_*_2 vars. Existing
 * Items (which predate this slice) are treated as "primary".
 *
 * SECURITY: secrets live only in the env object the SERVER passes in; this pure
 * module never logs them and callers never send them to the browser.
 */

export type CredentialSetKey = "primary" | "secondary";

/** The ordered, fixed universe of set keys. Add "tertiary" here to grow later. */
export const CREDENTIAL_SET_KEYS: readonly CredentialSetKey[] = ["primary", "secondary"];

export type PlaidEnvName = "sandbox" | "production";

/** A fully-resolved, usable credential set (all three fields non-empty). */
export type CredentialSet = {
  key: CredentialSetKey;
  clientId: string;
  secret: string;
  env: PlaidEnvName;
  /** Owner display name for the UI + money grouping (e.g. "Michael", "Wife"). */
  owner: string;
  /** Whether this set has both credentials present (else it's not offered). */
  configured: boolean;
};

/** The subset of env vars this module reads (a plain object — easy to test). */
export type PlaidEnvInput = {
  PLAID_CLIENT_ID?: string | null;
  PLAID_SECRET?: string | null;
  PLAID_ENV?: string | null;
  PLAID_OWNER_NAME?: string | null;

  PLAID_CLIENT_ID_2?: string | null;
  PLAID_SECRET_2?: string | null;
  PLAID_ENV_2?: string | null;
  PLAID_OWNER_NAME_2?: string | null;
};

/** Default owner labels when the owner-name env var isn't set. */
const DEFAULT_OWNER_PRIMARY = "Primary";
const DEFAULT_OWNER_SECONDARY = "Secondary";

/**
 * Normalize PLAID_ENV. Unknown/missing → "sandbox" (safe: never a real bank).
 * "development" (Plaid's retired env) folds to sandbox too. Mirrors env.ts.
 */
export function resolvePlaidEnvName(raw: string | null | undefined): PlaidEnvName {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "production" ? "production" : "sandbox";
}

/** Base URL for a resolved env (matches PlaidEnvironments in the SDK). */
export function plaidBasePathFor(env: PlaidEnvName): string {
  return env === "production" ? "https://production.plaid.com" : "https://sandbox.plaid.com";
}

/** Trim an env value the same way env.ts does (guards against pasted whitespace). */
function t(v: string | null | undefined): string {
  return (v ?? "").trim();
}

/** Clean an owner label; blank → the given default. Capped so the UI stays tidy. */
function ownerLabel(raw: string | null | undefined, fallback: string): string {
  const v = (raw ?? "").replace(/\s+/g, " ").trim();
  return (v === "" ? fallback : v).slice(0, 40);
}

/**
 * Resolve BOTH credential sets from a plain env object. Always returns both keys
 * in fixed order; each carries `configured` = whether its two credentials are
 * present. Never throws. No process.env, no I/O.
 */
export function resolveCredentialSets(env: PlaidEnvInput): CredentialSet[] {
  const primary: CredentialSet = {
    key: "primary",
    clientId: t(env.PLAID_CLIENT_ID),
    secret: t(env.PLAID_SECRET),
    env: resolvePlaidEnvName(env.PLAID_ENV),
    owner: ownerLabel(env.PLAID_OWNER_NAME, DEFAULT_OWNER_PRIMARY),
    configured: Boolean(t(env.PLAID_CLIENT_ID) && t(env.PLAID_SECRET)),
  };
  const secondary: CredentialSet = {
    key: "secondary",
    clientId: t(env.PLAID_CLIENT_ID_2),
    secret: t(env.PLAID_SECRET_2),
    env: resolvePlaidEnvName(env.PLAID_ENV_2),
    owner: ownerLabel(env.PLAID_OWNER_NAME_2, DEFAULT_OWNER_SECONDARY),
    configured: Boolean(t(env.PLAID_CLIENT_ID_2) && t(env.PLAID_SECRET_2)),
  };
  return [primary, secondary];
}

/** Look up one set by key from a resolved list (null if the key is unknown). */
export function getCredentialSet(
  sets: CredentialSet[],
  key: CredentialSetKey,
): CredentialSet | null {
  return sets.find((s) => s.key === key) ?? null;
}

/**
 * Normalize a (possibly stray/legacy) set key to a valid one. Anything unknown,
 * blank, or the legacy null/"" (items linked before this slice) → "primary",
 * because those items were created with the original PLAID_* credentials.
 */
export function normalizeSetKey(raw: string | null | undefined): CredentialSetKey {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "secondary" ? "secondary" : "primary";
}

/** True when the given set key resolves to a fully-configured set. */
export function isSetConfigured(sets: CredentialSet[], key: CredentialSetKey): boolean {
  const s = getCredentialSet(sets, key);
  return Boolean(s && s.configured);
}

/** The owner label for a set key (falls back to a sensible default). */
export function ownerLabelForSet(sets: CredentialSet[], key: CredentialSetKey): string {
  const s = getCredentialSet(sets, key);
  if (s) return s.owner;
  return key === "secondary" ? DEFAULT_OWNER_SECONDARY : DEFAULT_OWNER_PRIMARY;
}

export type LinkSetOption = {
  key: CredentialSetKey;
  owner: string;
  env: PlaidEnvName;
};

/**
 * The sets to OFFER in the "Connect a bank" picker: only configured ones, in
 * fixed order. When only "primary" is configured the picker can hide itself
 * (one option) — the UI decides. Secrets are NOT included (owner + env only).
 */
export function linkSetOptions(sets: CredentialSet[]): LinkSetOption[] {
  return sets
    .filter((s) => s.configured)
    .map((s) => ({ key: s.key, owner: s.owner, env: s.env }));
}

/** True when at least one set is configured (the app can talk to Plaid at all). */
export function anySetConfigured(sets: CredentialSet[]): boolean {
  return sets.some((s) => s.configured);
}

/** True when two or more sets are configured (so the picker is worth showing). */
export function multipleSetsConfigured(sets: CredentialSet[]): boolean {
  return sets.filter((s) => s.configured).length >= 2;
}

/**
 * Choose the set an Item's API calls must use. Prefer the item's stored key when
 * it's configured. If the stored set isn't configured (e.g. a key got removed),
 * fall back to primary when configured, else the first configured set, else null
 * (nothing configured → caller degrades gracefully). Never throws.
 */
export function chooseSetForItem(
  sets: CredentialSet[],
  storedKey: string | null | undefined,
): CredentialSet | null {
  const want = normalizeSetKey(storedKey);
  const wanted = getCredentialSet(sets, want);
  if (wanted && wanted.configured) return wanted;
  const primary = getCredentialSet(sets, "primary");
  if (primary && primary.configured) return primary;
  return sets.find((s) => s.configured) ?? null;
}

/**
 * Pick the set to use when creating a NEW link, given the owner's requested key.
 * Returns the requested set when configured, else null (the UI shouldn't have
 * offered an unconfigured set, but we guard anyway). Never throws.
 */
export function chooseSetForLink(
  sets: CredentialSet[],
  requestedKey: string | null | undefined,
): CredentialSet | null {
  const want = normalizeSetKey(requestedKey);
  const s = getCredentialSet(sets, want);
  return s && s.configured ? s : null;
}

// ---------------------------------------------------------------------------
// Self-tests (harness parity with the other Plaid cores).
// ---------------------------------------------------------------------------

export function __runPlaidCredentialsCoreTests(): void {
  const failures: string[] = [];
  const ok = (cond: boolean, msg: string) => {
    if (!cond) failures.push(msg);
  };

  // resolvePlaidEnvName -----------------------------------------------------
  ok(resolvePlaidEnvName("production") === "production", "production stays");
  ok(resolvePlaidEnvName("PRODUCTION") === "production", "case-insensitive production");
  ok(resolvePlaidEnvName("sandbox") === "sandbox", "sandbox stays");
  ok(resolvePlaidEnvName("development") === "sandbox", "retired development → sandbox");
  ok(resolvePlaidEnvName(undefined) === "sandbox", "missing → sandbox");
  ok(plaidBasePathFor("production") === "https://production.plaid.com", "prod base path");
  ok(plaidBasePathFor("sandbox") === "https://sandbox.plaid.com", "sandbox base path");

  // resolveCredentialSets: nothing configured -------------------------------
  const none = resolveCredentialSets({});
  ok(none.length === 2, "always returns both sets");
  ok(none[0].key === "primary" && none[1].key === "secondary", "fixed order");
  ok(!none[0].configured && !none[1].configured, "nothing configured");
  ok(none[0].owner === "Primary" && none[1].owner === "Secondary", "default owner labels");
  ok(anySetConfigured(none) === false, "anySetConfigured false when empty");

  // primary only, with trimming + owner name + prod env ---------------------
  const one = resolveCredentialSets({
    PLAID_CLIENT_ID: "  cid_1 ",
    PLAID_SECRET: " secret_1\n",
    PLAID_ENV: "production",
    PLAID_OWNER_NAME: "  Michael  ",
  });
  ok(one[0].configured && !one[1].configured, "primary configured only");
  ok(one[0].clientId === "cid_1" && one[0].secret === "secret_1", "credentials trimmed");
  ok(one[0].env === "production", "primary env production");
  ok(one[0].owner === "Michael", "owner name trimmed/collapsed");
  ok(anySetConfigured(one) === true, "any configured true");
  ok(multipleSetsConfigured(one) === false, "not multiple with one set");
  ok(linkSetOptions(one).length === 1, "one link option");
  ok(linkSetOptions(one)[0].owner === "Michael" && linkSetOptions(one)[0].key === "primary", "option carries owner+key");
  // secrets must NOT leak into link options
  ok(!Object.prototype.hasOwnProperty.call(linkSetOptions(one)[0], "secret"), "link option has no secret");

  // both configured ---------------------------------------------------------
  const both = resolveCredentialSets({
    PLAID_CLIENT_ID: "cidM",
    PLAID_SECRET: "secM",
    PLAID_ENV: "production",
    PLAID_OWNER_NAME: "Michael",
    PLAID_CLIENT_ID_2: "cidW",
    PLAID_SECRET_2: "secW",
    PLAID_ENV_2: "production",
    PLAID_OWNER_NAME_2: "Wife",
  });
  ok(both[0].configured && both[1].configured, "both configured");
  ok(multipleSetsConfigured(both) === true, "multiple true");
  ok(linkSetOptions(both).length === 2, "two link options");
  ok(ownerLabelForSet(both, "secondary") === "Wife", "secondary owner label");
  ok(ownerLabelForSet(both, "primary") === "Michael", "primary owner label");
  ok(getCredentialSet(both, "secondary")!.clientId === "cidW", "secondary creds resolved");

  // secondary configured but primary missing (edge) -------------------------
  const secOnly = resolveCredentialSets({ PLAID_CLIENT_ID_2: "c", PLAID_SECRET_2: "s" });
  ok(!secOnly[0].configured && secOnly[1].configured, "secondary-only configured");
  ok(linkSetOptions(secOnly).length === 1 && linkSetOptions(secOnly)[0].key === "secondary", "only secondary offered");

  // normalizeSetKey ---------------------------------------------------------
  ok(normalizeSetKey("secondary") === "secondary", "secondary passes");
  ok(normalizeSetKey("SECONDARY") === "secondary", "case-insensitive secondary");
  ok(normalizeSetKey("primary") === "primary", "primary passes");
  ok(normalizeSetKey(null) === "primary", "null (legacy item) → primary");
  ok(normalizeSetKey("") === "primary", "blank → primary");
  ok(normalizeSetKey("nonsense") === "primary", "unknown → primary");

  // isSetConfigured ---------------------------------------------------------
  ok(isSetConfigured(both, "secondary") === true, "isSetConfigured secondary (both)");
  ok(isSetConfigured(one, "secondary") === false, "isSetConfigured secondary false when unset");

  // chooseSetForItem --------------------------------------------------------
  ok(chooseSetForItem(both, "secondary")!.key === "secondary", "item uses its own set");
  ok(chooseSetForItem(both, null)!.key === "primary", "legacy item → primary");
  // stored secondary but secondary not configured → fall back to primary
  ok(chooseSetForItem(one, "secondary")!.key === "primary", "unconfigured stored set falls back to primary");
  // stored secondary, primary NOT configured, secondary IS → use secondary
  ok(chooseSetForItem(secOnly, "secondary")!.key === "secondary", "falls to a configured set");
  // stored primary but only secondary configured → first configured (secondary)
  ok(chooseSetForItem(secOnly, "primary")!.key === "secondary", "primary unconfigured → first configured");
  ok(chooseSetForItem(none, "primary") === null, "nothing configured → null");

  // chooseSetForLink --------------------------------------------------------
  ok(chooseSetForLink(both, "secondary")!.key === "secondary", "link uses requested set");
  ok(chooseSetForLink(both, "primary")!.key === "primary", "link primary");
  ok(chooseSetForLink(one, "secondary") === null, "link rejects unconfigured requested set");
  ok(chooseSetForLink(one, null)!.key === "primary", "link null → primary when configured");

  if (failures.length > 0) {
    throw new Error("plaid-credentials-core self-tests FAILED:\n" + failures.map((f) => "  - " + f).join("\n"));
  }
  console.log("plaid-credentials-core: all self-tests passed");
}
