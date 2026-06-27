import Script from "next/script";

/**
 * Privacy-conscious analytics loader.
 *
 * Renders Google Analytics 4 (GA4) ONLY when `NEXT_PUBLIC_GA_ID` is set at
 * build time. When the env var is absent (local dev / previews without a
 * measurement ID) this component renders nothing, so there is zero overhead
 * and no tracking. Scripts load with `afterInteractive` so they never block
 * first paint or the age-gate.
 *
 * To enable: set NEXT_PUBLIC_GA_ID=G-XXXXXXXXXX in the Vercel project env.
 */
export function Analytics() {
  const gaId = process.env.NEXT_PUBLIC_GA_ID;
  if (!gaId) return null;

  return (
    <>
      <Script
        id="ga4-src"
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${gaId}', { anonymize_ip: true });
        `}
      </Script>
    </>
  );
}
