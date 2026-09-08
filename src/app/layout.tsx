import type { Metadata } from "next";
import { draftMode } from "next/headers";
import { Analytics } from "@/components/analytics/Analytics";
// Slice C — Vercel Speed Insights. Reports real-visitor Core Web Vitals (LCP,
// CLS, INP, TTFB) to the Vercel dashboard so menu performance can be measured
// with field data instead of guessed at. Renders `null`, injects one small
// deferred script, and is inert outside Vercel.
import { SpeedInsights } from "@vercel/speed-insights/next";
import { PreviewEditOverlay } from "@/components/site/PreviewEditOverlay";
import { AgeGate } from "@/components/age-gate/AgeGate";
import { ageGateBootstrapScript } from "@/lib/age-gate/age-gate-core";
import { CartProvider } from "@/components/cart/CartProvider";
import { PublishedRulesProvider } from "@/components/promotions/PublishedRulesProvider";
import { loadPublishedRuleSnapshots } from "@/lib/promotions/discount-engine";
import { ScrollToTopButton } from "@/components/site/ScrollToTopButton";
import { JsonLd } from "@/components/seo/JsonLd";
import { SITE_NAME, SITE_URL, DEFAULT_OG_IMAGE, organizationSchema, websiteSchema, storeSchema } from "@/lib/seo/seo";
import { getContentValues } from "@/lib/cms/render-content";
import { fontVariablesClassName } from "@/lib/cms/fonts-loader";
import {
  fontStack,
  DEFAULT_HEADING_FONT_ID,
  DEFAULT_BODY_FONT_ID,
} from "@/lib/cms/fonts";
import "./globals.css";

const ogImageUrl = `${SITE_URL}${DEFAULT_OG_IMAGE}`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Greenway Marijuana | Port Orchard Cannabis Dispensary",
    template: "%s | Greenway Marijuana",
  },
  description:
    "Greenway Marijuana is a Washington State cannabis dispensary in Port Orchard. Browse the live menu, daily deals, loyalty rewards, and buy-online-pickup-in-store ordering information.",
  applicationName: SITE_NAME,
  keywords: [
    "Greenway Marijuana",
    "Port Orchard dispensary",
    "Port Orchard cannabis",
    "Washington marijuana dispensary",
    "cannabis deals Port Orchard",
    "buy weed online Port Orchard",
    "recreational marijuana WA",
  ],
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: "shopping",
  alternates: { canonical: SITE_URL },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 },
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    locale: "en_US",
    title: "Greenway Marijuana | Port Orchard Cannabis Dispensary",
    description:
      "Browse Greenway Marijuana's live menu, daily deals, and loyalty rewards. Recreational cannabis in Port Orchard, WA — open daily 8am-11pm.",
    images: [{ url: ogImageUrl, alt: SITE_NAME }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Greenway Marijuana | Port Orchard Cannabis Dispensary",
    description: "Recreational cannabis dispensary in Port Orchard, WA. Live menu, daily deals, loyalty rewards.",
    images: [ogImageUrl],
  },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // When a staff member is previewing drafts (Draft Mode on), mount the
  // click-to-edit overlay + preview banner over the public site.
  let isPreview = false;
  try {
    isPreview = (await draftMode()).isEnabled;
  } catch {
    isPreview = false;
  }

  // Site-wide typography: staff pick heading + body fonts from the curated
  // library in Admin → Site Content. Resolve them (draft-aware) to CSS font
  // stacks and bind them to --font-heading / --font-body for globals.css.
  const fonts = await getContentValues([
    "site.font.heading",
    "site.font.body",
  ]);

  // PROMOTIONS HARMONY (Task T / PR 1): serialise the back office's PUBLISHED
  // promotion rules once per render so every client surface (smart cart,
  // product cards, menu deal filter) prices with the SAME rules the register
  // uses. Seed fallback keeps behaviour identical when the DB is empty.
  const publishedRules = await loadPublishedRuleSnapshots();
  const headingStack = fontStack(
    fonts["site.font.heading"],
    DEFAULT_HEADING_FONT_ID,
  );
  const bodyStack = fontStack(fonts["site.font.body"], DEFAULT_BODY_FONT_ID);

  return (
    <html
      lang="en"
      className={fontVariablesClassName}
      style={
        {
          "--font-heading": headingStack,
          "--font-body": bodyStack,
        } as React.CSSProperties
      }
    >
      <head>
        {/* SLICE I — pre-paint age-gate bootstrap.
         *
         * MUST stay synchronous and MUST stay in <head>. The age gate is now
         * rendered in the server HTML so it paints at first paint instead of
         * after hydration (measured: it was the LCP element at t=4804ms and was
         * absent from the served HTML entirely). This script reads the visitor's
         * stored confirmation and stamps <html data-age-confirmed="true"> before
         * the browser computes that first paint, so the CSS rule in globals.css
         * hides the modal in the same style pass — returning customers see no
         * flash. Adding `defer`/`async`, or moving this into a component that
         * renders in <body>, would reintroduce the flash. Fail-closed: any
         * failure leaves the attribute unset and the gate visible. */}
        <script dangerouslySetInnerHTML={{ __html: ageGateBootstrapScript() }} />
      </head>
      <body>
        <JsonLd data={[organizationSchema(), websiteSchema(), storeSchema()]} id="site" />
        <PublishedRulesProvider snapshots={publishedRules}>
          <CartProvider>{children}</CartProvider>
        </PublishedRulesProvider>
        <ScrollToTopButton />
        <AgeGate />
        <Analytics />
        <SpeedInsights />
        {isPreview && <PreviewEditOverlay />}
      </body>
    </html>
  );
}
