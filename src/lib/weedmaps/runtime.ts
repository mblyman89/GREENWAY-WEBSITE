/**
 * src/lib/weedmaps/runtime.ts
 *
 * Server-only glue that loads the back-office-entered WeedMaps credentials
 * (integration_credentials) and installs them into the config cache so the
 * synchronous config getters used across the WeedMaps client/push code see them.
 *
 * Call refreshWeedmapsConfig() at the start of any public WeedMaps operation.
 */
import "server-only";

import { getWeedmapsOverrides } from "@/lib/integrations/integration-credentials-store";
import { setWeedmapsOverrideCache } from "./config";

/** Fetch DB-merged WeedMaps credentials and install them for this process. */
export async function refreshWeedmapsConfig(): Promise<void> {
  try {
    const overrides = await getWeedmapsOverrides();
    setWeedmapsOverrideCache(overrides);
  } catch {
    // On any failure, fall back to raw environment variables.
    setWeedmapsOverrideCache(null);
  }
}
