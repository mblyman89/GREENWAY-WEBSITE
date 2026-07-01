/**
 * src/lib/integrations/integration-credentials-store.ts
 *
 * Server-side store for the back-office-editable integration credentials
 * (Slice 60). Reads/writes the singleton public.integration_credentials row
 * (migration 0053) and exposes the ENV fallback so the pure core can merge
 * DB-over-env.
 *
 * Access is gated by the calling server action (settings.manage) and, for
 * reads of the raw secrets, by RLS (admin-only). This module uses the admin
 * client for the singleton row the same way printer-store / accounting store do.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  EMPTY_CREDENTIALS_ROW,
  applyCredentialsUpdate,
  buildCredentialsView,
  resolveLeaflyOverrides,
  resolveWeedmapsOverrides,
  resolveFluxOverrides,
  type CredentialsFormInput,
  type CredentialsView,
  type FluxOverrides,
  type IntegrationCredentialsRow,
  type IntegrationEnv,
  type LeaflyOverrides,
  type WeedmapsOverrides,
} from "./integration-credentials-core";

const TABLE = "integration_credentials";

/** Read the raw env fallback (server-only). */
export function readIntegrationEnv(): IntegrationEnv {
  return {
    leaflyEnvironment: process.env.LEAFLY_ENVIRONMENT,
    leaflyMenuIntegrationKey: process.env.LEAFLY_MENU_INTEGRATION_KEY,
    leaflyClientId: process.env.LEAFLY_CLIENT_ID,
    leaflyClientSecret: process.env.LEAFLY_CLIENT_SECRET,
    weedmapsEnvironment: process.env.WEEDMAPS_ENVIRONMENT,
    weedmapsMenuId: process.env.WEEDMAPS_MENU_ID || process.env.WEEDMAPS_WM_ID,
    weedmapsClientId: process.env.WEEDMAPS_CLIENT_ID,
    weedmapsClientSecret: process.env.WEEDMAPS_CLIENT_SECRET,
    weedmapsAccessToken: process.env.WEEDMAPS_ACCESS_TOKEN,
    weedmapsTokenUrl: process.env.WEEDMAPS_TOKEN_URL,
    weedmapsScope: process.env.WEEDMAPS_SCOPE,
    fluxApiKey: process.env.BFL_API_KEY || process.env.FLUX_API_KEY,
    fluxEndpoint: process.env.FLUX_ENDPOINT,
    fluxBaseUrl: process.env.FLUX_BASE_URL || process.env.BFL_BASE_URL,
  };
}

/** Coerce a possibly-partial DB row into a complete IntegrationCredentialsRow. */
function coerceRow(data: Record<string, unknown> | null): IntegrationCredentialsRow {
  if (!data) return { ...EMPTY_CREDENTIALS_ROW };
  const s = (k: string): string => {
    const v = data[k];
    return typeof v === "string" ? v : "";
  };
  return {
    leafly_environment: s("leafly_environment") || "sandbox",
    leafly_menu_integration_key: s("leafly_menu_integration_key"),
    leafly_client_id: s("leafly_client_id"),
    leafly_client_secret: s("leafly_client_secret"),
    weedmaps_environment: s("weedmaps_environment") || "sandbox",
    weedmaps_menu_id: s("weedmaps_menu_id"),
    weedmaps_client_id: s("weedmaps_client_id"),
    weedmaps_client_secret: s("weedmaps_client_secret"),
    weedmaps_access_token: s("weedmaps_access_token"),
    weedmaps_token_url: s("weedmaps_token_url"),
    weedmaps_scope: s("weedmaps_scope"),
    flux_api_key: s("flux_api_key"),
    flux_endpoint: s("flux_endpoint") || "flux-2-max",
    flux_base_url: s("flux_base_url"),
  };
}

/**
 * Read the raw singleton credentials row. Returns the empty row when the table
 * has no row or Supabase is not configured (so callers still get env fallback).
 */
export async function getIntegrationCredentialsRow(): Promise<IntegrationCredentialsRow> {
  if (!isSupabaseServiceConfigured) return { ...EMPTY_CREDENTIALS_ROW };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from(TABLE).select("*").eq("id", true).maybeSingle();
  if (error || !data) return { ...EMPTY_CREDENTIALS_ROW };
  return coerceRow(data as Record<string, unknown>);
}

/** Masked, display-safe view of the current credentials (DB merged over env). */
export async function getIntegrationCredentialsView(): Promise<CredentialsView> {
  const row = await getIntegrationCredentialsRow();
  return buildCredentialsView(row, readIntegrationEnv());
}

/** Resolved Leafly overrides (DB over env) for the config loader. */
export async function getLeaflyOverrides(): Promise<LeaflyOverrides> {
  const row = await getIntegrationCredentialsRow();
  return resolveLeaflyOverrides(row, readIntegrationEnv());
}

/** Resolved WeedMaps overrides (DB over env) for the config loader. */
export async function getWeedmapsOverrides(): Promise<WeedmapsOverrides> {
  const row = await getIntegrationCredentialsRow();
  return resolveWeedmapsOverrides(row, readIntegrationEnv());
}

/** Resolved FLUX 2 credentials (DB over env) for the image pipeline. */
export async function getFluxOverrides(): Promise<FluxOverrides> {
  const row = await getIntegrationCredentialsRow();
  return resolveFluxOverrides(row, readIntegrationEnv());
}

export type UpdateCredentialsResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Fold a form submission into the stored row and upsert it. Masked secret
 * fields are preserved; empty fields clear; new values replace.
 */
export async function updateIntegrationCredentials(
  form: CredentialsFormInput,
): Promise<UpdateCredentialsResult> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase is not configured on the server." };
  }
  const current = await getIntegrationCredentialsRow();
  const next = applyCredentialsUpdate(current, form);
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from(TABLE)
    .upsert({ id: true, ...next }, { onConflict: "id" });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
