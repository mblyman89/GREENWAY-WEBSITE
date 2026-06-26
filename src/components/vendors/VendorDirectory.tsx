"use client";

import Image from "next/image";
import { useState } from "react";
import { SectionBanner } from "@/components/home/SectionBanner";
import { greenwayBusiness } from "@/content/business";
import vendorsData from "@/data/vendors.json";

type Vendor = {
  name: string;
  slug: string;
  productCount: number;
};

const vendors = vendorsData as Vendor[];

// Accent palette cycles across the vendor tiles for a lively, on-brand grid
// (mirrors the home "Shop by Brand" treatment).
const ACCENTS = [
  "from-[var(--greenway)] to-emerald-700",
  "from-[var(--gold)] to-[var(--orange)]",
  "from-[var(--orange)] to-rose-700",
  "from-emerald-400 to-[var(--greenway-dark)]",
  "from-amber-400 to-[var(--orange)]",
  "from-lime-400 to-emerald-700",
];

// Placeholder logo + description used for every vendor until real assets and
// copy are supplied. The seamless expand overlays the description directly over
// the card's art (no separate boxes).
const PLACEHOLDER_LOGO = "/vendors/vendor-logo-placeholder.png";
const PLACEHOLDER_DESCRIPTION =
  "A trusted Greenway Marijuana partner growing and crafting premium cannabis for the Port Orchard community. Their mission: deliver consistent, lab-tested, top-shelf product our budtenders are proud to recommend.";

const EMAIL_SUBJECT = "Vendor partnership inquiry — Greenway Marijuana";
const EMAIL_BODY =
  "Hi Greenway team,%0D%0A%0D%0AWe'd love to introduce our products and explore working together. We can send samples and schedule a vendor day at your convenience.%0D%0A%0D%0AThank you!";

function VendorCard({ vendor, index }: { vendor: Vendor; index: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <button
      type="button"
      onClick={() => setExpanded((value) => !value)}
      aria-expanded={expanded}
      className="group relative isolate flex aspect-[5/3] w-full flex-col justify-end overflow-hidden rounded-2xl border border-white/10 bg-[var(--charcoal)] text-left shadow-lg shadow-black/30 transition hover:-translate-y-0.5 hover:border-white/25"
    >
      {/* Accent gradient base. */}
      <div
        className={`absolute inset-0 bg-gradient-to-br ${ACCENTS[index % ACCENTS.length]} opacity-80 transition group-hover:opacity-95`}
        aria-hidden="true"
      />
      {/* Soft radial highlight + bottom darkening for legibility. */}
      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.28),transparent_55%),linear-gradient(180deg,rgba(0,0,0,0.1)_0%,rgba(0,0,0,0.72)_100%)]"
        aria-hidden="true"
      />

      {/* Collapsed state: logo + name only, centered at the top. */}
      <div
        className={`absolute inset-x-0 top-0 flex flex-col items-center gap-2 px-4 pt-4 transition-opacity duration-300 ${
          expanded ? "opacity-0" : "opacity-100"
        }`}
      >
        <span className="relative h-12 w-12 overflow-hidden rounded-full ring-2 ring-white/40 md:h-14 md:w-14">
          <Image
            src={PLACEHOLDER_LOGO}
            alt={`${vendor.name} logo`}
            fill
            sizes="56px"
            className="object-cover"
          />
        </span>
        <p className="text-center text-sm font-black uppercase leading-tight tracking-tight text-white drop-shadow md:text-base">
          {vendor.name}
        </p>
      </div>

      {/* Collapsed footer: product count + tap hint. */}
      <div
        className={`relative px-4 pb-3 transition-opacity duration-300 ${
          expanded ? "opacity-0" : "opacity-100"
        }`}
      >
        <p className="text-[0.58rem] font-black uppercase tracking-[0.18em] text-white/80 md:text-[0.62rem]">
          {vendor.productCount} {vendor.productCount === 1 ? "product" : "products"} · tap to learn more
        </p>
      </div>

      {/* Expanded overlay: description text shares the same space as the art —
          seamless, no separate box. */}
      <div
        className={`absolute inset-0 flex flex-col justify-center gap-2 px-4 py-4 transition-opacity duration-300 md:px-5 ${
          expanded ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <div className="absolute inset-0 bg-black/55" aria-hidden="true" />
        <div className="relative flex items-center gap-2.5">
          <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full ring-2 ring-white/50">
            <Image
              src={PLACEHOLDER_LOGO}
              alt=""
              fill
              sizes="36px"
              className="object-cover"
            />
          </span>
          <p className="text-sm font-black uppercase leading-tight tracking-tight text-white drop-shadow md:text-base">
            {vendor.name}
          </p>
        </div>
        <p className="relative text-[0.72rem] font-medium leading-snug text-white/95 drop-shadow md:text-xs">
          {PLACEHOLDER_DESCRIPTION}
        </p>
        <p className="relative text-[0.56rem] font-black uppercase tracking-[0.18em] text-white/70">
          Tap to close
        </p>
      </div>
    </button>
  );
}

export function VendorDirectory() {
  return (
    <div className="bg-black px-4 py-6 text-white md:px-8 md:py-8">
      <div className="mx-auto max-w-[88rem] space-y-6 md:space-y-8">
        {/* Hero banner 1 — wide + short, premium art, professional copy. */}
        <SectionBanner
          imageSrc="/vendors/vendor-hero.png"
          imageAlt="Premium cannabis products against a Pacific Northwest forest backdrop"
          eyebrow="Vendors & Partners"
          title="Grow With Greenway"
          subtitle="We partner with licensed Washington producers and processors who share our commitment to quality, consistency, and craft."
          priority
        />

        {/* Outreach statement + email button. */}
        <section className="rounded-2xl border border-white/10 bg-[var(--charcoal)] px-5 py-6 shadow-xl shadow-black/30 md:px-9 md:py-8">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-xl font-black uppercase tracking-tight text-white md:text-2xl">
              Let&apos;s Work Together
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-300 md:text-base">
              Greenway Marijuana is an independent, locally owned cannabis shop in Port Orchard, Washington,
              proudly serving the Kitsap Peninsula. We&apos;re always looking to connect with licensed I-502
              producers and processors who make exceptional product. If you&apos;d like to send samples,
              schedule a vendor day, or explore getting your line on our shelves, reach out — our buying
              team would love to hear from you.
            </p>
            <a
              href={`${greenwayBusiness.emailHref}?subject=${encodeURIComponent(
                EMAIL_SUBJECT,
              )}&body=${EMAIL_BODY}`}
              className="mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[var(--orange)] to-[var(--gold)] px-7 py-3 text-sm font-black uppercase tracking-wide text-black shadow-lg shadow-black/40 transition hover:brightness-110 md:text-base"
            >
              <EmailIcon />
              Email Our Buying Team
            </a>
            <p className="mt-3 text-xs font-semibold text-zinc-500">
              {greenwayBusiness.email}
            </p>
          </div>
        </section>

        {/* Hero banner 2 — same size, introduces the vendor directory below. */}
        <SectionBanner
          imageSrc="/vendors/vendor-section-banner.png"
          imageAlt="A grid of partner cannabis brand emblems"
          eyebrow="Our Partners"
          title="Brands We Carry"
          subtitle="The producers and processors stocking Greenway shelves today. Tap any partner to learn more about who they are and what they grow."
        />

        {/* Vendor directory — HomeBrands-style cards, logo + name, tap to expand. */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4">
          {vendors.map((vendor, index) => (
            <VendorCard key={vendor.slug} vendor={vendor} index={index} />
          ))}
        </div>

        <p className="pt-2 text-center text-xs font-semibold text-zinc-500">
          Logos and partner descriptions shown are placeholders pending final vendor assets.
        </p>
      </div>
    </div>
  );
}

function EmailIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}
