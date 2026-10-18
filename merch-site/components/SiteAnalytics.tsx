"use client";
/**
 * R73 S8 - Vercel Web Analytics for greenwaymerch.com (feeds Reports > Merch
 * traffic on the Greenway back office). Cookieless; Vercel identifies visitors
 * by a request hash discarded after 24 hours (vercel.com/docs/analytics/privacy-policy).
 *
 * beforeSend (vercel.com/docs/analytics/redacting-sensitive-data):
 *  - drops the query string, so the Stripe session_id on /checkout/success
 *    (and any cart/search params) is never sent;
 *  - does not count the staff-only /admin pages.
 * Nothing is recorded until Web Analytics is enabled on this Vercel project.
 */
import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";
import { redactAnalyticsUrl } from "@/lib/analytics-core";

function beforeSend(event: BeforeSendEvent): BeforeSendEvent | null {
  const url = redactAnalyticsUrl(event.url);
  return url ? { ...event, url } : null;
}

export function SiteAnalytics() {
  return <Analytics beforeSend={beforeSend} />;
}
