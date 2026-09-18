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

  // Leafly ORDER API (Slice L-5 / migration 0225) --------------------------
  //
  // The Order API needs two credentials the Menu API does not, and they are NOT
  // interchangeable with the menu key. Per Leafly's Order API specification:
  // "The OAuth2 credentials and HMAC key are unique to each integrator, while
  // there is a unique `orderIntegrationKey` for each retailer managed through
  // your integration."
  //
  // So leafly_hmac_key is issued to the INTEGRATOR (verifies that an inbound
  // webhook really came from Leafly) while leafly_order_integration_key
  // identifies THIS RETAILER. Storing them as separate columns rather than
  // reusing leafly_menu_integration_key matters: pasting the menu key into the
  // order slot would produce webhook signature failures that look exactly like
  // a network problem.
  leafly_hmac_key: string;
  leafly_order_integration_key: string;
  weedmaps_environment: string;
  weedmaps_menu_id: string;
  weedmaps_client_id: string;
  weedmaps_client_secret: string;
  weedmaps_access_token: string;
  weedmaps_token_url: string;
  weedmaps_scope: string;

  // Black Forest Labs FLUX 2 image API (Slice A / migration 0055) -----------
  flux_api_key: string;
  flux_endpoint: string;
  flux_base_url: string;
};

/** Env fallback values (read from process.env by the caller). */
export type IntegrationEnv = {
  leaflyEnvironment?: string;
  leaflyMenuIntegrationKey?: string;
  leaflyClientId?: string;
  leaflyClientSecret?: string;
  // Order API (Slice L-5). Separate from the menu key on purpose: see the note
  // on IntegrationCredentialsRow above. LEAFLY_HMAC_KEY authenticates inbound
  // webhooks; LEAFLY_ORDER_INTEGRATION_KEY identifies this retailer in the
  // Order API's own URL path.
  leaflyHmacKey?: string;
  leaflyOrderIntegrationKey?: string;
  weedmapsEnvironment?: string;
  weedmapsMenuId?: string;
  weedmapsClientId?: string;
  weedmapsClientSecret?: string;
  weedmapsAccessToken?: string;
  weedmapsTokenUrl?: string;
  weedmapsScope?: string;
  fluxApiKey?: string;
  fluxEndpoint?: string;
  fluxBaseUrl?: string;
};

/** Resolved Leafly credential overrides (DB wins over env). */
export type LeaflyOverrides = {
  environment: IntegrationEnvironment;
  menuIntegrationKey?: string;
  clientId?: string;
  clientSecret?: string;
  /** Order API: verifies the X-Leafly-Signature on inbound webhooks. */
  hmacKey?: string;
  /** Order API: identifies THIS retailer in webhook bodies and API paths. */
  orderIntegrationKey?: string;
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

/** Resolved FLUX 2 credential overrides (DB wins over env). */
export type FluxOverrides = {
  apiKey?: string;
  endpoint: string;
  baseUrl?: string;
};

/** Which service a stored value originated from — for the "source" hint. */
export type CredentialSource = "database" | "environment" | "unset";

export const EMPTY_CREDENTIALS_ROW: IntegrationCredentialsRow = {
  leafly_environment: "sandbox",
  leafly_menu_integration_key: "",
  leafly_client_id: "",
  leafly_client_secret: "",
  leafly_hmac_key: "",
  leafly_order_integration_key: "",
  weedmaps_environment: "sandbox",
  weedmaps_menu_id: "",
  weedmaps_client_id: "",
  weedmaps_client_secret: "",
  weedmaps_access_token: "",
  weedmaps_token_url: "",
  weedmaps_scope: "",
  flux_api_key: "",
  flux_endpoint: "flux-2-max",
  flux_base_url: "",
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
    hmacKey: pick(row.leafly_hmac_key, env.leaflyHmacKey),
    orderIntegrationKey: pick(
      row.leafly_order_integration_key,
      env.leaflyOrderIntegrationKey,
    ),
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

export function resolveFluxOverrides(
  row: IntegrationCredentialsRow,
  env: IntegrationEnv,
): FluxOverrides {
  return {
    apiKey: pick(row.flux_api_key, env.fluxApiKey),
    endpoint: pick(row.flux_endpoint, env.fluxEndpoint) ?? "flux-2-max",
    baseUrl: pick(row.flux_base_url, env.fluxBaseUrl),
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
    hmacKey: string; // masked (Order API webhook secret)
    /**
     * Shown in the CLEAR, deliberately. It is an identifier, not a secret, and
     * the owner has to be able to read it back to check it against the value
     * Leafly sent him. Masking an identifier only makes it impossible to spot
     * the transposed character that is causing every webhook to be rejected.
     */
    orderIntegrationKey: string;
    sources: {
      menuIntegrationKey: CredentialSource;
      clientId: CredentialSource;
      clientSecret: CredentialSource;
      hmacKey: CredentialSource;
      orderIntegrationKey: CredentialSource;
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
  flux: {
    apiKey: string; // masked
    endpoint: string; // clear
    baseUrl: string; // clear
    sources: {
      apiKey: CredentialSource;
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
      hmacKey: maskSecret(leafly.hmacKey ?? ""),
      orderIntegrationKey: leafly.orderIntegrationKey ?? "",
      sources: {
        menuIntegrationKey: credentialSource(
          row.leafly_menu_integration_key,
          env.leaflyMenuIntegrationKey,
        ),
        clientId: credentialSource(row.leafly_client_id, env.leaflyClientId),
        clientSecret: credentialSource(row.leafly_client_secret, env.leaflyClientSecret),
        hmacKey: credentialSource(row.leafly_hmac_key, env.leaflyHmacKey),
        orderIntegrationKey: credentialSource(
          row.leafly_order_integration_key,
          env.leaflyOrderIntegrationKey,
        ),
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
    flux: {
      apiKey: maskSecret(pick(row.flux_api_key, env.fluxApiKey) ?? ""),
      endpoint: resolveFluxOverrides(row, env).endpoint,
      baseUrl: pick(row.flux_base_url, env.fluxBaseUrl) ?? "",
      sources: {
        apiKey: credentialSource(row.flux_api_key, env.fluxApiKey),
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
  leaflyHmacKey?: string;
  leaflyOrderIntegrationKey?: string;
  weedmapsEnvironment?: string;
  weedmapsMenuId?: string;
  weedmapsClientId?: string;
  weedmapsClientSecret?: string;
  weedmapsAccessToken?: string;
  weedmapsTokenUrl?: string;
  weedmapsScope?: string;
  fluxApiKey?: string;
  fluxEndpoint?: string;
  fluxBaseUrl?: string;
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
    // The HMAC key folds as a SECRET (a masked resubmission means "unchanged"),
    // the order integration key as a PLAIN identifier. Getting this backwards
    // would let the literal string "••••abcd" be saved as a real credential.
    leafly_hmac_key: foldSecret(form.leaflyHmacKey, current.leafly_hmac_key),
    leafly_order_integration_key: foldPlain(
      form.leaflyOrderIntegrationKey,
      current.leafly_order_integration_key,
    ),
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
    flux_api_key: foldSecret(form.fluxApiKey, current.flux_api_key),
    flux_endpoint: foldPlain(form.fluxEndpoint, current.flux_endpoint) || "flux-2-max",
    flux_base_url: foldPlain(form.fluxBaseUrl, current.flux_base_url),
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

  // FLUX 2 (Slice A)
  const fluxRow: IntegrationCredentialsRow = {
    ...EMPTY_CREDENTIALS_ROW,
    flux_api_key: "bfl-abcdef",
    flux_endpoint: "flux-2-pro",
  };
  const fx = resolveFluxOverrides(fluxRow, {});
  ok(fx.apiKey === "bfl-abcdef", "flux api key db wins");
  ok(fx.endpoint === "flux-2-pro", "flux endpoint db wins");
  ok(resolveFluxOverrides(EMPTY_CREDENTIALS_ROW, {}).endpoint === "flux-2-max", "flux endpoint default");
  ok(resolveFluxOverrides(EMPTY_CREDENTIALS_ROW, { fluxApiKey: "envk" }).apiKey === "envk", "flux key env fallback");
  const fView = buildCredentialsView(fluxRow, {});
  ok(fView.flux.apiKey === "••••cdef", "flux key masked in view");
  ok(fView.flux.sources.apiKey === "database", "flux key source db");
  const fUpd = applyCredentialsUpdate(fluxRow, { fluxApiKey: "••••cdef", fluxEndpoint: "flux-2-max" });
  ok(fUpd.flux_api_key === "bfl-abcdef", "flux masked key preserved");
  ok(fUpd.flux_endpoint === "flux-2-max", "flux endpoint updated");
  ok(applyCredentialsUpdate(fluxRow, { fluxEndpoint: "" }).flux_endpoint === "flux-2-max", "flux endpoint empty -> default");

  // =========================================================================
  // SLICE L-5 -- Leafly ORDER API credentials
  //
  // Two new fields that behave DIFFERENTLY from each other on purpose. The HMAC
  // key is a secret (masked, folds as a secret); the orderIntegrationKey is an
  // identifier (shown clear, folds as plain text). Every assertion below exists
  // because getting one of them backwards is silent: a masked identifier saved
  // as a literal "••••abcd" authenticates nothing and reports no error.
  // =========================================================================

  const orderRow: IntegrationCredentialsRow = {
    ...EMPTY_CREDENTIALS_ROW,
    leafly_hmac_key: "hmac-supersecret-9911",
    leafly_order_integration_key: "greenway-port-orchard-01",
  };

  // Resolve: DB wins, env falls back -- same contract as every sibling field.
  const lo = resolveLeaflyOverrides(orderRow, {});
  ok(lo.hmacKey === "hmac-supersecret-9911", "L5: hmac key resolves from db");
  ok(lo.orderIntegrationKey === "greenway-port-orchard-01", "L5: order key resolves from db");
  const loEnv = resolveLeaflyOverrides(EMPTY_CREDENTIALS_ROW, {
    leaflyHmacKey: "env-hmac",
    leaflyOrderIntegrationKey: "env-order-key",
  });
  ok(loEnv.hmacKey === "env-hmac", "L5: hmac key falls back to env");
  ok(loEnv.orderIntegrationKey === "env-order-key", "L5: order key falls back to env");
  ok(
    resolveLeaflyOverrides(EMPTY_CREDENTIALS_ROW, {}).hmacKey === undefined,
    "L5: absent hmac key is undefined, NOT an empty string -- an empty string is a " +
      "value that could be mistaken for a configured key and used to verify a signature",
  );

  // The order key must NOT leak the menu key, and vice versa. These are
  // different credentials from Leafly and confusing them produces signature
  // failures that look like a network fault.
  const mixed = resolveLeaflyOverrides(
    { ...EMPTY_CREDENTIALS_ROW, leafly_menu_integration_key: "MENU-KEY" },
    {},
  );
  ok(mixed.orderIntegrationKey === undefined, "L5: menu key does not populate the order key");
  ok(mixed.hmacKey === undefined, "L5: menu key does not populate the hmac key");

  // View: hmac MASKED, order key CLEAR.
  const oView = buildCredentialsView(orderRow, {});
  ok(oView.leafly.hmacKey === "••••9911", "L5: hmac key masked in the view");
  ok(
    !oView.leafly.hmacKey.includes("supersecret"),
    "L5: the hmac secret never appears in the view",
  );
  ok(
    oView.leafly.orderIntegrationKey === "greenway-port-orchard-01",
    "L5: order key shown in the clear so the owner can check it against Leafly's email",
  );
  ok(oView.leafly.sources.hmacKey === "database", "L5: hmac source db");
  ok(oView.leafly.sources.orderIntegrationKey === "database", "L5: order key source db");
  ok(
    buildCredentialsView(EMPTY_CREDENTIALS_ROW, {}).leafly.sources.hmacKey === "unset",
    "L5: hmac source unset when nowhere configured",
  );

  // Update folding: the asymmetry that matters.
  const oUpd = applyCredentialsUpdate(orderRow, {
    leaflyHmacKey: "••••9911", // user did not retype the secret
    leaflyOrderIntegrationKey: "  greenway-port-orchard-02  ",
  });
  ok(oUpd.leafly_hmac_key === "hmac-supersecret-9911", "L5: masked hmac resubmission preserved");
  ok(
    oUpd.leafly_order_integration_key === "greenway-port-orchard-02",
    "L5: order key updated and trimmed",
  );
  ok(
    applyCredentialsUpdate(orderRow, { leaflyHmacKey: "rotated-key" }).leafly_hmac_key ===
      "rotated-key",
    "L5: a genuinely new hmac key replaces the old one (key rotation must work)",
  );
  ok(
    applyCredentialsUpdate(orderRow, { leaflyHmacKey: "" }).leafly_hmac_key === "",
    "L5: empty clears the hmac key",
  );
  ok(
    applyCredentialsUpdate(orderRow, {}).leafly_hmac_key === "hmac-supersecret-9911",
    "L5: absent hmac field leaves the stored key untouched",
  );
  // Saving the Leafly section must not disturb the OTHER services' secrets.
  const untouched = applyCredentialsUpdate(
    { ...orderRow, weedmaps_access_token: "wm-token", flux_api_key: "flux-key" },
    { leaflyHmacKey: "rotated" },
  );
  ok(untouched.weedmaps_access_token === "wm-token", "L5: weedmaps token untouched");
  ok(untouched.flux_api_key === "flux-key", "L5: flux key untouched");

  return { passed };
}
