import Link from "next/link";
import { contact, COUNTRY, DBA_NAME, LEGAL_NAME, MAIN_SITE_URL } from "@/lib/site";

const POLICIES = [
  { href: "/shipping", label: "Shipping" },
  { href: "/returns", label: "Returns & Refunds" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/contact", label: "Contact" },
];

export function Footer() {
  const c = contact();
  const year = new Date().getFullYear();
  return (
    <footer className="mt-16 border-t border-white/10 bg-black/80 px-4 py-10 md:px-8">
      <div className="mx-auto grid max-w-[var(--shop-max)] gap-6 text-center">
        <p className="text-lg font-black uppercase text-white">Greenway <span className="text-[var(--greenway)]">Merch</span></p>
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          {POLICIES.map((p) => (
            <Link key={p.href} href={p.href} className="text-[0.68rem] font-black uppercase tracking-[0.16em] text-zinc-500 transition hover:text-[var(--greenway)] md:text-xs">{p.label}</Link>
          ))}
        </div>
        <div className="text-[0.75rem] leading-6 text-zinc-400">
          <p>Sold and shipped by {LEGAL_NAME} (dba {DBA_NAME}), {COUNTRY}.</p>
          {c.address ? <p>{c.address}</p> : null}
          {c.email || c.phone ? (
            <p>
              {c.email ? <a href={`mailto:${c.email}`} className="hover:text-[var(--greenway)]">{c.email}</a> : null}
              {c.email && c.phone ? " · " : null}
              {c.phone ? <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="hover:text-[var(--greenway)]">{c.phone}</a> : null}
            </p>
          ) : null}
          <p className="mt-2 text-zinc-500">Apparel and accessories only. This store does not sell cannabis or any cannabis product.</p>
        </div>
        <p className="text-[0.7rem] font-semibold leading-5 text-zinc-500">
          &copy; {year} {LEGAL_NAME}. All rights reserved. ·{" "}
          <a href={MAIN_SITE_URL} className="hover:text-[var(--greenway)]">greenwaymarijuana.com</a>
        </p>
      </div>
    </footer>
  );
}
