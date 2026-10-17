import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { SITE_BG_LAYER_CLASS } from "@/lib/glow";
import { DBA_NAME, SITE_NAME, siteUrl } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: `${SITE_NAME} | ${DBA_NAME}`, template: `%s | ${SITE_NAME}` },
  description: "Greenway apparel - tees, hoodies, sweatshirts, hats and beanies, printed to order and shipped from Greenway Glass & Goods.",
  openGraph: { siteName: SITE_NAME, type: "website" },
};

export const viewport: Viewport = { themeColor: "#000000" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <div className={SITE_BG_LAYER_CLASS} aria-hidden="true" />
        <Header />
        {children}
        <Footer />
      </body>
    </html>
  );
}
