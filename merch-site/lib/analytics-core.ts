/**
 * R73 S8 - what greenwaymerch.com sends to Vercel Web Analytics (PURE).
 * Returns the URL without query string or hash, or null to not send at all
 * (staff /admin pages, unparseable URLs).
 */
export function redactAnalyticsUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.pathname === "/admin" || u.pathname.startsWith("/admin/")) return null;
  return `${u.origin}${u.pathname}`;
}

export function __runAnalyticsTests(): { passed: number; failed: number; failures: string[] } {
  let passed = 0;
  const failures: string[] = [];
  const ok = (c: boolean, m: string) => { if (c) passed += 1; else failures.push(m); };
  ok(redactAnalyticsUrl("https://greenwaymerch.com/checkout/success?session_id=cs_live_x") === "https://greenwaymerch.com/checkout/success", "session id stripped");
  ok(redactAnalyticsUrl("https://greenwaymerch.com/hoodies/logo#top") === "https://greenwaymerch.com/hoodies/logo", "hash stripped");
  ok(redactAnalyticsUrl("https://greenwaymerch.com/admin/orders") === null && redactAnalyticsUrl("https://greenwaymerch.com/admin") === null, "admin not counted");
  ok(redactAnalyticsUrl("https://greenwaymerch.com/administer") !== null, "only the /admin segment");
  ok(redactAnalyticsUrl("not a url") === null, "bad url not sent");
  return { passed, failed: failures.length, failures };
}
