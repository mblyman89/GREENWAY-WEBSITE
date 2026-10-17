/** Owner-session check for /admin (server only; cookie set by app/admin/orders/actions.ts). */
import { cookies } from "next/headers";
import { adminCookieValue, secretMatches } from "./orders-core";

export const ADMIN_COOKIE = "gm_admin";
export const adminKey = () => (process.env.MERCH_ADMIN_KEY ?? "").trim();

export async function isAdmin(): Promise<boolean> {
  const key = adminKey();
  if (key.length < 16) return false;
  const jar = await cookies();
  return secretMatches(jar.get(ADMIN_COOKIE)?.value, adminCookieValue(key));
}
