import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { SITE_BG_LAYER_CLASS } from "@/lib/glow";
import { DBA_NAME, SITE_NAME, siteUrl } from "@/lib/site";
import { getMerchContent } from "@/lib/site-content";
import { headerCopy, footerCopy } from "@/lib/site-content-core";
import { JsonLd } from "@/components/JsonLd";
import { SiteAnalytics } from "@/components/SiteAnalytics";
import { seoSite } from "@/lib/seo";
import { organizationJsonLd, websiteJsonLd } from "@/lib/seo-core";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: `${SITE_NAME} | ${DBA_NAME}`, template: `%s | ${SITE_NAME}` },
  description: "Greenway apparel - tees, hoodies, sweatshirts, hats and beanies, printed to order and shipped from Greenway Glass & Goods.",
  openGraph: { siteName: SITE_NAME, type: "website", locale: "en_US", images: ["/categories/hoodies.webp"] },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = { themeColor: "#000000" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const c = await getMerchContent();
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <div className={SITE_BG_LAYER_CLASS} aria-hidden="true" />
        <JsonLd data={[organizationJsonLd(seoSite()), websiteJsonLd(seoSite())]} />
        <Header copy={headerCopy(c)} />
        {children}
        <Footer copy={footerCopy(c)} />
        <SiteAnalytics />
      </body>
    </html>
  );
}
