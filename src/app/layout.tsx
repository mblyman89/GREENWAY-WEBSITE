import type { Metadata } from "next";
import { AgeGate } from "@/components/age-gate/AgeGate";
import { CartProvider } from "@/components/cart/CartProvider";
import { ScrollToTopButton } from "@/components/site/ScrollToTopButton";
import { JsonLd } from "@/components/seo/JsonLd";
import { SITE_NAME, SITE_URL, DEFAULT_OG_IMAGE, organizationSchema, websiteSchema, storeSchema } from "@/lib/seo/seo";
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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <JsonLd data={[organizationSchema(), websiteSchema(), storeSchema()]} id="site" />
        <CartProvider>{children}</CartProvider>
        <ScrollToTopButton />
        <AgeGate />
      </body>
    </html>
  );
}
