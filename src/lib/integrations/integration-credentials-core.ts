/**
 * src/lib/integrations/integration-credentials-core.ts
 *
 * PURE, dependency-free logic for the back-office integration credential store
 * (Slice 60). No server-only imports so it is unit-testable with tsx.
 *
 * Responsibilities:
 *   - Shape of the DB row (integration_credentials, migration 0053).
 *   - Merge DB-stored credentials OVER environment defaults (a non-empty DB
 *     value wins; otherwise fall back to the env value). This mirrors exactly
 *     the fields getLeaflyConfig()/getWeedmapsConfig() read.
 *   - Mask secret values for display (never leak a stored secret back to the UI).
 *   - Validate/normalize a form submission before it is written.
 *
 * SECURITY: masked display values (••••1234) are for humans only; they are never
 * treated as real credentials. An update that receives a masked value for a
 * secret field means "leave unchanged".
 */

export type IntegrationEnvironment = "sandbox" | "production";

/** One row of public.integration_credentials (migration 0053). All text. */
export type IntegrationCredentialsRow = {
  leafly_environment: string;
  leafly_menu_integration_key: string;
  leafly_client_id: string;
  leafly_client_secret: string;
  weedmaps_environment: string;
  weedmaps_menu_id: string;
  weedmaps_client_id: string;
  weedmaps_client_secret: string;
  weedmaps_access_token: string;
  weedmaps_token_url: string;
  weedmaps_scope: string;
};

/** Env fallback values (read from process.env by the caller). */
export type IntegrationEnv = {
  leaflyEnvironment?: string;
  leaflyMenuIntegrationKey?: string;
  leaflyClientId?: string;
  leaflyClientSecret?: string;
  weedmapsEnvironment?: string;
  weedmapsMenuId?: string;
  weedmapsClientId?: string;
  weedmapsClientSecret?: string;
  weedmapsAccessToken?: string;
  weedmapsTokenUrl?: string;
  weedmapsScope?: string;
};

/** Resolved Leafly credential overrides (DB wins over env). */
export type LeaflyOverrides = {
  environment: IntegrationEnvironment;
  menuIntegrationKey?: string;
  clientId?: string;
  clientSecret?: string;
};

/** Resolved WeedMaps credential overrides (DB wins over env). */
export type WeedmapsOverrides = {
  environment: IntegrationEnvironment;
  menuId?: string;
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  tokenUrl?: string;
  scope?: string;
};

/** Which service a stored value originated from — for the "source" hint. */
export type CredentialSource = "database" | "environment" | "unset";

export const EMPTY_CREDENTIALS_ROW: IntegrationCredentialsRow = {
  leafly_environment: "sandbox",
  leafly_menu_integration_key: "",
  leafly_client_id: "",
  leafly_client_secret: "",
  weedmaps_environment: "sandbox",
  weedmaps_menu_id: "",
  weedmaps_client_id: "",
  weedmaps_client_secret: "",
  weedmaps_access_token: "",
  weedmaps_token_url: "",
  weedmaps_scope: "",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clean(v: string | null | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}

/** DB value wins when non-empty; otherwise env; otherwise undefined. */
function pick(dbValue: string, envValue: string | undefined): string | undefined {
  const db = clean(dbValue);
  if (db) return db;
  const env = clean(envValue);
  return env || undefined;
}

function normEnvironment(
  dbValue: string,
  envValue: string | undefined,
): IntegrationEnvironment {
  const resolved = clean(dbValue) || clean(envValue);
  return resolved === "production" ? "production" : "sandbox";
}

/** Where a resolved value comes from (for a small UI badge). */
export function credentialSource(dbValue: string, envValue: string | undefined): CredentialSource {
  if (clean(dbValue)) return "database";
  if (clean(envValue)) return "environment";
  return "unset";
}

// ---------------------------------------------------------------------------
// Merge: DB over env
// ---------------------------------------------------------------------------

export function resolveLeaflyOverrides(
  row: IntegrationCredentialsRow,
  env: IntegrationEnv,
): LeaflyOverrides {
  return {
    environment: normEnvironment(row.leafly_environment, env.leaflyEnvironment),
    menuIntegrationKey: pick(row.leafly_menu_integration_key, env.leaflyMenuIntegrationKey),
    clientId: pick(row.leafly_client_id, env.leaflyClientId),
    clientSecret: pick(row.leafly_client_secret, env.leaflyClientSecret),
  };
}

export function resolveWeedmapsOverrides(
  row: IntegrationCredentialsRow,
  env: IntegrationEnv,
): WeedmapsOverrides {
  return {
    environment: normEnvironment(row.weedmaps_environment, env.weedmapsEnvironment),
    menuId: pick(row.weedmaps_menu_id, env.weedmapsMenuId),
    clientId: pick(row.weedmaps_client_id, env.weedmapsClientId),
    clientSecret: pick(row.weedmaps_client_secret, env.weedmapsClientSecret),
    accessToken: pick(row.weedmaps_access_token, env.weedmapsAccessToken),
    tokenUrl: pick(row.weedmaps_token_url, env.weedmapsTokenUrl),
    scope: pick(row.weedmaps_scope, env.weedmapsScope),
  };
}

// ---------------------------------------------------------------------------
// Masking (for display)
// ---------------------------------------------------------------------------

/**
 * Mask a secret for display: show only the last 4 chars, prefixed by dots.
 * Empty stays empty. Short values (<=4) are fully masked.
 */
export function maskSecret(value: string): string {
  const v = clean(value);
  if (!v) return "";
  if (v.length <= 4) return "••••";
  return `••••${v.slice(-4)}`;
}

/** True when a submitted value is (only) a mask, i.e. "leave unchanged". */
export function isMaskedValue(value: string): boolean {
  const v = clean(value);
  return v.length > 0 && /^•+/.test(v);
}

/** A view-model for the editor: non-secrets in the clear, secrets masked. */
export type CredentialsView = {
  leafly: {
    environment: IntegrationEnvironment;
    menuIntegrationKey: string; // masked
    clientId: string; // clear (id, not secret)
    clientSecret: string; // masked
    sources: {
      menuIntegrationKey: CredentialSource;
      clientId: CredentialSource;
      clientSecret: CredentialSource;
    };
  };
  weedmaps: {
    environment: IntegrationEnvironment;
    menuId: string; // clear
    clientId: string; // clear
    clientSecret: string; // masked
    accessToken: string; // masked
    tokenUrl: string; // clear
    scope: string; // clear
    sources: {
      menuId: CredentialSource;
      clientId: CredentialSource;
      clientSecret: CredentialSource;
      accessToken: CredentialSource;
    };
  };
};

export function buildCredentialsView(
  row: IntegrationCredentialsRow,
  env: IntegrationEnv,
): CredentialsView {
  const leafly = resolveLeaflyOverrides(row, env);
  const wm = resolveWeedmapsOverrides(row, env);
  return {
    leafly: {
      environment: leafly.environment,
      menuIntegrationKey: maskSecret(leafly.menuIntegrationKey ?? ""),
      clientId: leafly.clientId ?? "",
      clientSecret: maskSecret(leafly.clientSecret ?? ""),
      sources: {
        menuIntegrationKey: credentialSource(
          row.leafly_menu_integration_key,
          env.leaflyMenuIntegrationKey,
        ),
        clientId: credentialSource(row.leafly_client_id, env.leaflyClientId),
        clientSecret: credentialSource(row.leafly_client_secret, env.leaflyClientSecret),
      },
    },
    weedmaps: {
      environment: wm.environment,
      menuId: wm.menuId ?? "",
      clientId: wm.clientId ?? "",
      clientSecret: maskSecret(wm.clientSecret ?? ""),
      accessToken: maskSecret(wm.accessToken ?? ""),
      tokenUrl: wm.tokenUrl ?? "",
      scope: wm.scope ?? "",
      sources: {
        menuId: credentialSource(row.weedmaps_menu_id, env.weedmapsMenuId),
        clientId: credentialSource(row.weedmaps_client_id, env.weedmapsClientId),
        clientSecret: credentialSource(row.weedmaps_client_secret, env.weedmapsClientSecret),
        accessToken: credentialSource(row.weedmaps_access_token, env.weedmapsAccessToken),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Update: fold a form submission into the existing row
// ---------------------------------------------------------------------------

/** Raw form fields (all optional strings; missing/masked = unchanged). */
export type CredentialsFormInput = {
  leaflyEnvironment?: string;
  leaflyMenuIntegrationKey?: string;
  leaflyClientId?: string;
  leaflyClientSecret?: string;
  weedmapsEnvironment?: string;
  weedmapsMenuId?: string;
  weedmapsClientId?: string;
  weedmapsClientSecret?: string;
  weedmapsAccessToken?: string;
  weedmapsTokenUrl?: string;
  weedmapsScope?: string;
};

function normEnvInput(value: string | undefined, current: string): string {
  const v = clean(value);
  if (v === "production") return "production";
  if (v === "sandbox") return "sandbox";
  // Unknown/empty submission → keep current (normalized).
  return current === "production" ? "production" : "sandbox";
}

/**
 * A SECRET field update: a masked submission means "leave unchanged"; an empty
 * submission means "clear it"; anything else replaces the stored value.
 */
function foldSecret(submitted: string | undefined, current: string): string {
  if (submitted === undefined) return current; // field not present at all
  if (isMaskedValue(submitted)) return current; // user did not retype the secret
  return clean(submitted);
}

/** A NON-secret field update: undefined = unchanged; else trimmed value. */
function foldPlain(submitted: string | undefined, current: string): string {
  if (submitted === undefined) return current;
  return clean(submitted);
}

/**
 * Produce the next DB row from the current row + a form submission.
 * Only fields present in the form are considered; secrets shown masked are
 * preserved unless the user typed a new value.
 */
export function applyCredentialsUpdate(
  current: IntegrationCredentialsRow,
  form: CredentialsFormInput,
): IntegrationCredentialsRow {
  return {
    leafly_environment: normEnvInput(form.leaflyEnvironment, current.leafly_environment),
    leafly_menu_integration_key: foldSecret(
      form.leaflyMenuIntegrationKey,
      current.leafly_menu_integration_key,
    ),
    leafly_client_id: foldPlain(form.leaflyClientId, current.leafly_client_id),
    leafly_client_secret: foldSecret(form.leaflyClientSecret, current.leafly_client_secret),
    weedmaps_environment: normEnvInput(form.weedmapsEnvironment, current.weedmaps_environment),
    weedmaps_menu_id: foldPlain(form.weedmapsMenuId, current.weedmaps_menu_id),
    weedmaps_client_id: foldPlain(form.weedmapsClientId, current.weedmaps_client_id),
    weedmaps_client_secret: foldSecret(
      form.weedmapsClientSecret,
      current.weedmaps_client_secret,
    ),
    weedmaps_access_token: foldSecret(
      form.weedmapsAccessToken,
      current.weedmaps_access_token,
    ),
    weedmaps_token_url: foldPlain(form.weedmapsTokenUrl, current.weedmaps_token_url),
    weedmaps_scope: foldPlain(form.weedmapsScope, current.weedmaps_scope),
  };
}

// ---------------------------------------------------------------------------
// Tests (run via a throwaway tsx harness; see Slice 60 verification)
// ---------------------------------------------------------------------------

export function __runIntegrationCredentialsTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
    passed += 1;
  };

  // maskSecret
  ok(maskSecret("") === "", "mask empty");
  ok(maskSecret("ab") === "••••", "mask short");
  ok(maskSecret("abcd") === "••••", "mask 4");
  ok(maskSecret("abcdef") === "••••cdef", "mask long shows last4");
  ok(maskSecret("  spaced1234  ") === "••••1234", "mask trims first");

  // isMaskedValue
  ok(isMaskedValue("••••1234"), "detect mask");
  ok(!isMaskedValue("realsecret"), "plain not mask");
  ok(!isMaskedValue(""), "empty not mask");

  // credentialSource
  ok(credentialSource("dbval", "envval") === "database", "db wins source");
  ok(credentialSource("", "envval") === "environment", "env source");
  ok(credentialSource("", "") === "unset", "unset source");
  ok(credentialSource("  ", undefined) === "unset", "blank db + no env = unset");

  // resolve: DB over env
  const row: IntegrationCredentialsRow = {
    ...EMPTY_CREDENTIALS_ROW,
    leafly_environment: "production",
    leafly_client_id: "dbclient",
    leafly_client_secret: "",
    weedmaps_menu_id: "menu-99",
  };
  const env: IntegrationEnv = {
    leaflyClientId: "envclient",
    leaflyClientSecret: "envsecret",
    leaflyMenuIntegrationKey: "envkey",
    weedmapsMenuId: "env-menu",
    weedmapsScope: "a b c",
  };
  const leafly = resolveLeaflyOverrides(row, env);
  ok(leafly.environment === "production", "leafly env db production");
  ok(leafly.clientId === "dbclient", "leafly clientId db wins");
  ok(leafly.clientSecret === "envsecret", "leafly secret falls back to env");
  ok(leafly.menuIntegrationKey === "envkey", "leafly key from env");

  const wm = resolveWeedmapsOverrides(row, env);
  ok(wm.environment === "sandbox", "wm env default sandbox");
  ok(wm.menuId === "menu-99", "wm menu db wins over env");
  ok(wm.scope === "a b c", "wm scope from env");
  ok(wm.tokenUrl === undefined, "wm tokenUrl unset -> undefined (use verified default)");

  // view masking
  const view = buildCredentialsView(row, env);
  ok(view.leafly.clientId === "dbclient", "view clientId clear");
  ok(view.leafly.clientSecret === "••••cret", "view secret masked (envsecret->cret)");
  ok(view.leafly.sources.clientId === "database", "view source db");
  ok(view.leafly.sources.clientSecret === "environment", "view secret source env");
  ok(view.weedmaps.menuId === "menu-99", "view wm menu clear");

  // applyCredentialsUpdate
  const cur: IntegrationCredentialsRow = {
    ...EMPTY_CREDENTIALS_ROW,
    leafly_client_secret: "oldsecret",
    weedmaps_access_token: "oldtoken",
  };
  // masked submission => unchanged
  const r1 = applyCredentialsUpdate(cur, {
    leaflyClientSecret: "••••cret",
    weedmapsAccessToken: "••••oken",
  });
  ok(r1.leafly_client_secret === "oldsecret", "masked secret preserved");
  ok(r1.weedmaps_access_token === "oldtoken", "masked token preserved");
  // new value => replaced
  const r2 = applyCredentialsUpdate(cur, { leaflyClientSecret: "brandnew" });
  ok(r2.leafly_client_secret === "brandnew", "new secret replaces");
  // empty string => cleared
  const r3 = applyCredentialsUpdate(cur, { leaflyClientSecret: "" });
  ok(r3.leafly_client_secret === "", "empty clears secret");
  // undefined => unchanged
  const r4 = applyCredentialsUpdate(cur, {});
  ok(r4.leafly_client_secret === "oldsecret", "absent field unchanged");
  // environment normalization
  const r5 = applyCredentialsUpdate(cur, {
    leaflyEnvironment: "production",
    weedmapsEnvironment: "garbage",
  });
  ok(r5.leafly_environment === "production", "env set production");
  ok(r5.weedmaps_environment === "sandbox", "bad env -> keep current(sandbox)");
  // plain field trims
  const r6 = applyCredentialsUpdate(cur, { weedmapsMenuId: "  m-1  " });
  ok(r6.weedmaps_menu_id === "m-1", "plain field trimmed");

  return { passed };
}
