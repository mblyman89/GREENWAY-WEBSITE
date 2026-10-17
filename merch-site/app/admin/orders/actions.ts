"use server";
/**
 * Owner order-desk server actions. The key is typed into a form (never put in
 * a URL, so it can't leak into browser history, Vercel logs or Referer
 * headers). A match sets an httpOnly, Secure, SameSite=Strict cookie holding a
 * sha256 of the key - never the key itself. Rotating MERCH_ADMIN_KEY logs
 * every session out.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { alertOwner, printful } from "@/lib/fulfillment";
import { ADMIN_COOKIE as COOKIE, adminKey, isAdmin } from "@/lib/admin";
import { adminCookieValue, ADMIN_STATUS_FILTERS, secretMatches } from "@/lib/orders-core";

export async function login(form: FormData): Promise<void> {
  const key = adminKey();
  const given = String(form.get("key") ?? "");
  if (!secretMatches(given, key)) {
    // Slow down guessing a little; the key itself should be 32+ random chars.
    await new Promise((r) => setTimeout(r, 800));
    redirect("/admin/orders?e=1");
  }
  const jar = await cookies();
  jar.set(COOKIE, adminCookieValue(key), { httpOnly: true, secure: true, sameSite: "strict", path: "/admin", maxAge: 60 * 60 * 12 });
  redirect("/admin/orders");
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  jar.delete({ name: COOKIE, path: "/admin" });
  redirect("/admin/orders");
}

/** Confirm a DRAFT -> Printful starts production and charges the LLC's card. */
export async function confirmOrder(form: FormData): Promise<void> {
  if (!(await isAdmin())) redirect("/admin/orders");
  const id = Number(form.get("id"));
  const ref = String(form.get("ref") ?? "").slice(0, 32);
  const status = String(form.get("status") ?? "draft");
  const back = `/admin/orders?status=${(ADMIN_STATUS_FILTERS as readonly string[]).includes(status) ? status : "draft"}`;
  if (!Number.isInteger(id) || id <= 0) redirect(`${back}&msg=bad-id`);
  const res = await printful<{ status?: string }>(`/orders/${id}/confirm`, { method: "POST" });
  if (!res.ok) {
    await alertOwner(`Confirm failed for ${ref || `#${id}`}`, [`Printful said: ${res.error ?? res.status}`]);
    redirect(`${back}&msg=${encodeURIComponent(`Confirm failed: ${res.error ?? res.status}`.slice(0, 160))}`);
  }
  redirect(`${back}&msg=${encodeURIComponent(`Confirmed ${ref || `#${id}`} - now ${res.result?.status ?? "pending"}.`)}`);
}
