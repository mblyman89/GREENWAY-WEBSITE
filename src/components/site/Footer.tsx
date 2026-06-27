import Image from "next/image";
import Link from "next/link";
import { greenwayBusiness, requiredComplianceWarning } from "@/content/business";

const policyLinks = [
  { label: "Privacy Policy", href: "/privacy-policy" },
  { label: "Terms of Use", href: "/terms-of-use" },
  { label: "Consumer Health Data", href: "/consumer-health-data" },
];

const appPlaceholders = ["Apple", "Google"];
const socialLinks = [greenwayBusiness.social.instagram, greenwayBusiness.social.facebook];
const copyrightYear = new Date().getFullYear();

function CopyrightLine({ className = "" }: { className?: string }) {
  return (
    <p className={`text-[0.7rem] font-semibold leading-5 text-zinc-500 ${className}`}>
      <span className="block">&copy; {copyrightYear} LYMAN&rsquo;S MARIJUANA, Inc., dba Greenway Marijuana.</span>
      <span className="block">All rights reserved.</span>
    </p>
  );
}

function PolicyLinks({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "flex flex-wrap items-center justify-center gap-x-2 gap-y-1" : "mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-white/10 pt-5"}>
      {policyLinks.map((link, index) => (
        <span key={link.href} className="inline-flex items-center gap-2">
          <Link href={link.href} className={compact ? "text-[0.62rem] font-black uppercase tracking-[0.08em] text-zinc-400 transition hover:text-[var(--greenway)]" : "text-[0.68rem] font-black uppercase tracking-[0.16em] text-zinc-500 transition hover:text-[var(--greenway)] md:text-xs"}>
            {link.label}
          </Link>
          {compact && index < policyLinks.length - 1 ? <span className="text-[0.62rem] font-black text-zinc-600">|</span> : null}
        </span>
      ))}
    </div>
  );
}

function MobileFooter() {
  return (
    <div className="mx-auto max-w-md border-t border-white/10 pt-9 text-center lg:hidden">
      <Link href="/#top" aria-label="Greenway Marijuana home" className="inline-flex justify-center transition duration-200 hover:opacity-85">
        <Image
          src={greenwayBusiness.assets.blackGoldLogo}
          alt="Greenway Marijuana Port Orchard WA established 2014"
          width={360}
          height={360}
          className="h-auto w-44 object-contain"
          sizes="176px"
        />
      </Link>

      <p className="mx-auto mt-5 max-w-xs text-[0.72rem] font-black uppercase leading-5 tracking-[0.2em] text-zinc-300">
        Port Orchard&apos;s local cannabis shop for adults 21+
      </p>

      <div className="mt-8 rounded-[1.6rem] border border-white/10 bg-white/[0.035] px-5 py-6 shadow-2xl shadow-black/30">
        <p className="text-[0.72rem] font-black uppercase tracking-[0.24em] text-[var(--gold)]">Greenway</p>
        <p className="mt-1 text-2xl font-black uppercase leading-none tracking-[0.04em] text-white">Port Orchard</p>
        <Link href="/locations" className="mx-auto mt-4 block max-w-[15rem] text-sm font-semibold leading-6 text-zinc-300 transition hover:text-[var(--greenway)]">
          {greenwayBusiness.address.full}
        </Link>
        <a href={`tel:${greenwayBusiness.phone.tel}`} className="mt-3 inline-flex rounded-full bg-[var(--greenway)] px-5 py-2 text-sm font-black text-black transition hover:bg-white">
          {greenwayBusiness.phone.display}
        </a>
      </div>

      <div className="mt-6 rounded-[1.6rem] border border-[var(--greenway)]/30 bg-[var(--greenway)] px-5 py-5 text-black">
        <p className="text-[0.7rem] font-black uppercase tracking-[0.22em]">Store Hours</p>
        <p className="mt-1 text-3xl font-black uppercase leading-none tracking-tight">8am-11pm</p>
        <p className="mt-2 text-xs font-black uppercase tracking-[0.14em] text-black/70">Open daily</p>
      </div>

      <div className="mt-7 rounded-[1.4rem] border border-white/10 bg-white/[0.03] p-4">
        <p className="text-[0.68rem] font-black uppercase tracking-[0.18em] text-zinc-500">App downloads coming soon</p>
        <div className="mt-3 flex justify-center gap-2">
          {appPlaceholders.map((label) => (
            <span key={label} className="inline-flex h-9 min-w-20 items-center justify-center rounded-full border border-white/10 bg-zinc-900 px-3 text-[0.68rem] font-black uppercase tracking-[0.12em] text-zinc-500" title="App link coming later">
              {label}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-[1.4rem] border border-white/10 bg-white/[0.03] p-4">
        <p className="text-[0.68rem] font-black uppercase tracking-[0.18em] text-zinc-500">Follow Greenway</p>
        <div className="mt-3 flex justify-center gap-2">
          {socialLinks.map((social) => (
            <a key={social.url} href={social.url} target="_blank" rel="noreferrer" className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-zinc-900 text-[0.68rem] font-black uppercase tracking-[0.08em] text-zinc-300 transition hover:border-[var(--greenway)] hover:text-[var(--greenway)]" aria-label={`Open Greenway on ${social.label}`}>
              {social.shortLabel}
            </a>
          ))}
        </div>
      </div>

      <div className="mt-7 rounded-[1.25rem] border border-[var(--gold)]/30 bg-[#090909] p-4">
        <p className="text-[0.62rem] font-black uppercase tracking-[0.2em] text-[var(--gold)]">Washington Cannabis Warning</p>
        <p className="mt-3 text-[0.72rem] font-semibold leading-5 text-zinc-300">{requiredComplianceWarning}</p>
      </div>

      <div className="mt-7">
        <PolicyLinks compact />
      </div>

      <CopyrightLine className="mt-4 text-center" />
    </div>
  );
}

function DesktopFooter() {
  return (
    <div className="mx-auto hidden max-w-7xl border-t border-white/10 pt-10 lg:block">
      <div className="grid gap-8 lg:grid-cols-[0.78fr_1.5fr_0.85fr] lg:items-start">
        <div className="flex flex-col items-start text-left">
          <Link href="/#top" aria-label="Greenway Marijuana home" className="inline-flex transition duration-200 hover:opacity-85">
            <Image
              src={greenwayBusiness.assets.blackGoldLogo}
              alt="Greenway Marijuana Port Orchard WA established 2014"
              width={360}
              height={360}
              className="h-auto w-48 object-contain"
              sizes="192px"
            />
          </Link>
          <p className="mt-4 text-xs font-black uppercase tracking-[0.22em] text-[var(--gold)]">Port Orchard, WA</p>
          <p className="mt-2 max-w-xs text-sm leading-6 text-zinc-400">{greenwayBusiness.address.full}</p>
          <CopyrightLine className="mt-5 max-w-xs" />
        </div>

        <div className="rounded-[1.5rem] border border-[var(--gold)]/35 bg-[#090909] p-6 shadow-2xl shadow-black/35">
          <p className="text-center text-xs font-black uppercase tracking-[0.22em] text-[var(--gold)]">Washington Cannabis Warning</p>
          <p className="mt-4 text-center text-[0.95rem] font-semibold leading-7 text-zinc-200">{requiredComplianceWarning}</p>
          <PolicyLinks />
        </div>

        <div className="flex flex-col items-end text-right">
          <p className="text-sm font-black uppercase tracking-[0.2em] text-[var(--greenway)]">Hours</p>
          <p className="mt-2 text-lg font-black text-white">{greenwayBusiness.hours.short}</p>
          <a href={`tel:${greenwayBusiness.phone.tel}`} className="mt-2 text-sm font-bold text-zinc-300 transition hover:text-[var(--greenway)]">
            {greenwayBusiness.phone.display}
          </a>

          <div className="mt-6 w-full max-w-xs rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-[0.68rem] font-black uppercase tracking-[0.18em] text-zinc-500">App downloads</p>
            <div className="mt-3 flex justify-end gap-2">
              {appPlaceholders.map((label) => (
                <span key={label} className="inline-flex h-9 min-w-20 items-center justify-center rounded-full border border-white/10 bg-zinc-900 px-3 text-[0.68rem] font-black uppercase tracking-[0.12em] text-zinc-500" title="App link coming later">
                  {label}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-4 w-full max-w-xs rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-[0.68rem] font-black uppercase tracking-[0.18em] text-zinc-500">Follow Greenway</p>
            <div className="mt-3 flex justify-end gap-2">
              {socialLinks.map((social) => (
                <a key={social.url} href={social.url} target="_blank" rel="noreferrer" className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-zinc-900 text-[0.68rem] font-black uppercase tracking-[0.08em] text-zinc-300 transition hover:border-[var(--greenway)] hover:text-[var(--greenway)]" aria-label={`Open Greenway on ${social.label}`}>
                  {social.shortLabel}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Footer() {
  return (
    <footer id="location" className="bg-black px-4 pb-8 pt-12 text-white md:px-8 md:pb-10 md:pt-14">
      <MobileFooter />
      <DesktopFooter />
    </footer>
  );
}
