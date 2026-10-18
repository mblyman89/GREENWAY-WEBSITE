import type { Metadata } from "next";
import { PageShell } from "@/components/ui";
import { PolicyContact } from "@/components/PolicyContact";

export const metadata: Metadata = { title: "Privacy Policy", alternates: { canonical: "/privacy" } };

export default function PrivacyPage() {
  return (
    <PageShell eyebrow="Policies" title="Privacy">
      <p>This policy explains what this website collects and why. It applies to greenwaymerch.com, run by Greenway Merchandising LLC (dba Greenway Glass & Goods).</p>
      <h2>What we collect</h2>
      <ul>
        <li><strong>Your order:</strong> name, email, phone number, shipping address and the items you buy. You enter these on Stripe&rsquo;s secure checkout page.</li>
        <li><strong>Payment:</strong> your card is processed by Stripe. We never see or store your full card number.</li>
        <li><strong>Your cart:</strong> kept in your own browser (local storage) until you check out. We don&rsquo;t use advertising or tracking cookies on this site.</li>
        <li><strong>Visit statistics:</strong> our host, Vercel, counts page views without cookies (which page, the referring site, device type and country). Visitors are not identified; Vercel discards its short-lived visitor hash after 24 hours.</li>
      </ul>
      <h2>Who we share it with</h2>
      <p>Only the companies needed to complete your order: Stripe (payments), Printful (printing and shipping), the shipping carrier, our email provider (order and shipping emails), and our website host. We do not sell your personal information.</p>
      <h2>How long we keep it</h2>
      <p>We keep order records as long as needed for the order, returns, and our tax and accounting obligations.</p>
      <h2>Your choices</h2>
      <p>You can ask us to see, correct or delete your personal information (subject to records we must keep by law) by contacting us below.</p>
      <h2>Contact</h2>
      <PolicyContact />
    </PageShell>
  );
}
