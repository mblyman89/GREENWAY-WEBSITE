import "server-only";
/**
 * OI-ACC S6 - the "sell Other Inventory online" toggle (site_settings key
 * `online_other_inventory_enabled`, default OFF) and the checkout-side read
 * of nc rows. Fail-closed: a read error means OFF / refused.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { ncIdFromKey } from "@/lib/noncannabis/pos-catalog-core";
import { readNcTypes } from "@/lib/noncannabis/types-store";
import { NC_SHOP_COLUMNS } from "@/lib/noncannabis/shop-cards-core";
import {
  ONLINE_NC_SETTING_KEY,
  ONLINE_NC_OFF_MESSAGE,
  onlineNcEnabledFrom,
  priceNcOnlineLine,
  type NcOnlinePriced,
  type NcOnlineRow,
} from "@/lib/noncannabis/online-core";

export async function readOnlineNcEnabled(): Promise<boolean> {
  if (!isSupabaseServiceConfigured) return false;
  try {
    const { data, error } = await createSupabaseAdminClient()
      .from("site_settings")
      .select("value_json")
      .eq("key", ONLINE_NC_SETTING_KEY)
      .maybeSingle();
    if (error) {
      console.error("[online-nc] toggle read failed:", error.code, error.message);
      return false;
    }
    return onlineNcEnabledFrom((data as { value_json?: unknown } | null)?.value_json);
  } catch {
    return false;
  }
}

export async function saveOnlineNcEnabled(enabled: boolean, actorId: string | null): Promise<{ error?: string }> {
  try {
    const { error } = await createSupabaseAdminClient().from("site_settings").upsert(
      {
        key: ONLINE_NC_SETTING_KEY,
        label: "Shop: customers may add Other Inventory (accessories) to online orders (OI-ACC S6)",
        value_json: { enabled } as unknown as Record<string, unknown>,
        updated_by: actorId,
      },
      { onConflict: "key" },
    );
    if (error) return { error: `${error.code ?? ""} ${error.message}`.trim() };
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Price the `nc-` lines of an online order. Refuses all when the toggle is OFF. */
export async function priceNcOnlineLines(
  lines: readonly { key: string; quantity: number }[],
): Promise<{ ok: true; lines: NcOnlinePriced[] } | { ok: false; problems: string[] }> {
  if (lines.length === 0) return { ok: true, lines: [] };
  if (!(await readOnlineNcEnabled())) return { ok: false, problems: [ONLINE_NC_OFF_MESSAGE] };
  const ids = lines.map((l) => ncIdFromKey(l.key)).filter((x): x is string => Boolean(x));
  if (ids.length !== lines.length) return { ok: false, problems: ["An accessory in your cart is no longer available."] };
  const [types, read] = await Promise.all([
    readNcTypes(),
    createSupabaseAdminClient().from("noncannabis_products").select(NC_SHOP_COLUMNS).in("id", ids),
  ]);
  if (read.error) {
    console.error("[online-nc] catalog read failed:", read.error.code, read.error.message);
    return { ok: false, problems: ["Accessories could not be checked right now. Please try again."] };
  }
  const byId = new Map(((read.data ?? []) as NcOnlineRow[]).map((r) => [r.id, r]));
  const merch = new Set(types.rows.filter((t) => t.menu_group === "merch").map((t) => t.value));
  // The same item twice in one cart is checked against its combined quantity.
  const totals = new Map<string, number>();
  for (const l of lines) totals.set(l.key, (totals.get(l.key) ?? 0) + Math.round(Number(l.quantity) || 0));
  const out: NcOnlinePriced[] = [];
  const problems: string[] = [];
  for (const l of lines) {
    const row = byId.get(ncIdFromKey(l.key)!);
    const whole = priceNcOnlineLine(l.key, totals.get(l.key) ?? 0, row, row ? merch.has(row.type) : false);
    if (!whole.ok) {
      if (!problems.includes(whole.problem)) problems.push(whole.problem);
      continue;
    }
    out.push({ ...whole.line, quantity: Math.round(Number(l.quantity)) });
  }
  return problems.length ? { ok: false, problems } : { ok: true, lines: out };
}
