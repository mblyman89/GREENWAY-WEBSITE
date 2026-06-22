import type { Metadata } from "next";
import { AgeGate } from "@/components/age-gate/AgeGate";
import { CartProvider } from "@/components/cart/CartProvider";
import { ScrollToTopButton } from "@/components/site/ScrollToTopButton";
import "./globals.css";

export const metadata: Metadata = {
  title: "Greenway Marijuana | Port Orchard Cannabis Dispensary",
  description:
    "Greenway Marijuana is a Washington State cannabis dispensary in Port Orchard. Browse inventory, deals, and online ordering information.",
  metadataBase: new URL("https://www.greenwaymarijuana.com"),
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <CartProvider>{children}</CartProvider>
        <ScrollToTopButton />
        <AgeGate />
      </body>
    </html>
  );
}
