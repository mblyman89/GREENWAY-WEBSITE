/**
 * src/lib/leafly/runtime.ts
 *
 * Server-only glue that loads the back-office-entered Leafly credentials
 * (integration_credentials) and installs them into the config cache so the
 * synchronous config getters used across the Leafly client/push code see them.
 *
 * Call refreshLeaflyConfig() at the start of any public Leafly operation.
 */
import "server-only";

import { getLeaflyOverrides } from "@/lib/integrations/integration-credentials-store";
import { setLeaflyOverrideCache } from "./config";

/** Fetch DB-merged Leafly credentials and install them for this process. */
export async function refreshLeaflyConfig(): Promise<void> {
  try {
    const overrides = await getLeaflyOverrides();
    setLeaflyOverrideCache(overrides);
  } catch {
    // On any failure, fall back to raw environment variables.
    setLeaflyOverrideCache(null);
  }
}
