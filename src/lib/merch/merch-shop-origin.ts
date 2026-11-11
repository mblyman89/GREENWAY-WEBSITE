/**
 * The shop's origin for back-office -> greenwaymerch.com calls (MERCH_SHOP_URL,
 * https only; default https://greenwaymerch.com). Its own module so the
 * health, webhook and payments servers can share it without importing each
 * other (D232 M-7).
 */
export const MERCH_SHOP_DEFAULT = "https://greenwaymerch.com";

export function merchShopOrigin(): string {
  const v = (process.env.MERCH_SHOP_URL ?? "").trim().replace(/\/+$/, "");
  return /^https:\/\//i.test(v) ? v : MERCH_SHOP_DEFAULT;
}
