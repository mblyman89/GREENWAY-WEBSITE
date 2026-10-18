import type { Metadata } from "next";
import { PageShell } from "@/components/ui";
import { PolicyContact } from "@/components/PolicyContact";

export const metadata: Metadata = { title: "Contact", alternates: { canonical: "/contact" } };

export default function ContactPage() {
  return (
    <PageShell eyebrow="Help" title="Contact us">
      <p>Questions about an order, sizing, or a problem with your item? Reach out and include your order number (it starts with &ldquo;gm-&rdquo; and is on your receipt email).</p>
      <PolicyContact />
    </PageShell>
  );
}
