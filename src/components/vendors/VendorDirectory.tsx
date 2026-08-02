"use client";

import Image from "next/image";
import { useState } from "react";
import { SectionBanner, type SectionBannerData } from "@/components/home/SectionBanner";
import { glowCardStyle, GLOW_TONES } from "@/lib/ui/glow-card-core";
import { greenwayBusiness } from "@/content/business";
import type { VendorDirectoryEntry } from "@/lib/menu/vendor-directory-core";
import {
  VENDOR_CONTACT_CHANNELS,
  VENDOR_OUTREACH_SUBJECT,
  vendorMailtoHref,
  type VendorContactChannel,
} from "@/lib/vendors/vendor-relations-core";

// SLICE 48 (owner Q3): the static vendors.json snapshot is retired. Vendors
// now arrive as a prop, derived from the LIVE published menu by the server
// page (src/app/vendor-delivery/page.tsx via buildVendorDirectory), so the
// directory always reflects what is actually on the shelves.
type Vendor = VendorDirectoryEntry;

// SLICE 114: the cards now match the PRODUCT card treatment — a dark #101010
// tile with a glowing side-lit border (ported from ProductCardVisual.tsx's
// cardStyle + glow strips), NOT a colored background. Vendors have no strain
// type, so we cycle a small tasteful set of ON-BRAND glow tones (Greenway
// green, gold→orange, amber→lime) to keep the grid lively while every card
// reads as one cohesive family with the rest of the site.
//
// SLICE 117: the GlowTone type + on-brand GLOW_TONES palette + glowCardStyle
// now live in the shared src/lib/ui/glow-card-core.ts so the product, vendor,
// and specials cards share ONE recipe and can never drift apart. Imported at
// the top of this file; the output is byte-identical to before.

// SLICE 97: cards prefer the REAL logo + description saved in the back office
// (vendors table via enrichVendorDirectory); these placeholders remain the
// honest fallback for vendors without an uploaded logo or written copy.
const PLACEHOLDER_LOGO = "/vendors/vendor-logo-placeholder.png";
const PLACEHOLDER_DESCRIPTION =
  "A trusted Greenway Marijuana partner growing and crafting premium cannabis for the Port Orchard community. Their mission: deliver consistent, lab-tested, top-shelf product our budtenders are proud to recommend.";

// Per request: the email body must be BLANK so it opens an empty draft.
const EMAIL_BODY = "";

// The vendor name lives in a slim bar at the top of the card, so the total
// character count drives how small we go to keep it on ONE line on the narrow
// mobile tile. Short names keep the default size.
function nameSizeClass(name: string): string {
  const total = name.trim().length;
  if (total >= 34) return "text-[0.5rem] md:text-[0.7rem]";
  if (total >= 28) return "text-[0.56rem] md:text-[0.8rem]";
  if (total >= 22) return "text-[0.64rem] md:text-[0.9rem]";
  if (total >= 16) return "text-[0.72rem] md:text-base";
  return "text-[0.82rem] md:text-lg";
}

function VendorCard({ vendor, index }: { vendor: Vendor; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const tone = GLOW_TONES[index % GLOW_TONES.length];
  // SLICE 97: real back-office logo/description when present, placeholder otherwise.
  const logoSrc = vendor.logoUrl || PLACEHOLDER_LOGO;
  const description = vendor.description || PLACEHOLDER_DESCRIPTION;

  return (
    <button
      type="button"
      onClick={() => setExpanded((value) => !value)}
      aria-expanded={expanded}
      aria-label={`${vendor.name} — ${vendor.productCount} ${vendor.productCount === 1 ? "product" : "products"}`}
      className="group relative isolate flex aspect-[4/5] w-full flex-col overflow-hidden rounded-2xl border text-left transition duration-300 hover:-translate-y-0.5 hover:border-white/70 hover:shadow-[0_18px_44px_rgba(0,0,0,0.55)]"
      style={glowCardStyle(tone)}
    >
      {/* Product-card glow strips: left / right verticals + a soft bottom line. */}
      <span
        className="pointer-events-none absolute -left-px top-10 h-[42%] w-px opacity-90 blur-[1px]"
        style={{ background: tone.glowLeft }}
        aria-hidden="true"
      />
      <span
        className="pointer-events-none absolute -right-px top-[31%] h-[46%] w-px opacity-90 blur-[1px]"
        style={{ background: tone.glowRight }}
        aria-hidden="true"
      />
      <span
        className="pointer-events-none absolute inset-x-7 -bottom-px h-px opacity-70 blur-[1px]"
        style={{ background: tone.glowRight }}
        aria-hidden="true"
      />

      {/* Slim name bar at the very TOP — one line, scaled to fit. */}
      <div className="relative z-10 border-b border-white/10 px-3 py-2 md:px-4 md:py-2.5">
        <p
          className={`w-full truncate text-center font-black uppercase leading-none tracking-tight text-white drop-shadow ${nameSizeClass(vendor.name)}`}
        >
          {vendor.name}
        </p>
      </div>

      {/* Logo fills nearly the entire card. object-contain keeps brand marks
          crisp and un-cropped; a subtle floor shadow grounds them. */}
      <div className="relative z-0 flex flex-1 items-center justify-center p-3 md:p-4">
        <span className="relative h-full w-full">
          <Image
            src={logoSrc}
            alt={`${vendor.name} logo`}
            fill
            sizes="(max-width: 768px) 45vw, 22vw"
            className="object-contain drop-shadow-[0_6px_14px_rgba(0,0,0,0.45)]"
          />
        </span>
      </div>

      {/* Product-count footer (fades out when the description overlay opens). */}
      <div
        className={`relative z-10 px-3 pb-2.5 text-center transition-opacity duration-300 md:px-4 md:pb-3 ${
          expanded ? "opacity-0" : "opacity-100"
        }`}
      >
        <p className="text-[0.56rem] font-black uppercase tracking-[0.18em] text-white/70 md:text-[0.62rem]">
          {vendor.productCount} {vendor.productCount === 1 ? "product" : "products"}
        </p>
      </div>

      {/* Expanded description overlay — a clean scrim over the whole tile with
          the name at top and the blurb below, so nothing overlaps the logo. */}
      <div
        className={`absolute inset-0 z-20 flex flex-col justify-center gap-2 px-4 py-4 text-center transition-opacity duration-300 md:px-5 ${
          expanded ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <div className="absolute inset-0 bg-black/78 backdrop-blur-[1px]" aria-hidden="true" />
        <p className="relative text-[0.68rem] font-black uppercase leading-tight tracking-tight text-white drop-shadow md:text-sm">
          {vendor.name}
        </p>
        <p className="relative text-[0.66rem] font-medium leading-snug text-white/90 drop-shadow md:text-xs">
          {description}
        </p>
        <p className="relative pt-1 text-[0.5rem] font-black uppercase tracking-[0.2em] text-white/50 md:text-[0.56rem]">
          Tap to close
        </p>
      </div>
    </button>
  );
}

type VendorContent = {
  heading?: string;
  /** SLICE 99: the outreach paragraph is editable in the back office too. */
  body?: string;
  editable?: boolean;
  /** Builder-managed banners (from page_sections). When present they drive the
   * two hero banners; otherwise the hardcoded defaults below are used. */
  grow?: SectionBannerData;
  brands?: SectionBannerData;
  /** Any additional banner sections staff added in the Pages builder, rendered
   * below the vendor directory. */
  extraSections?: SectionBannerData[];
  /** SLICE 114: the five contact-channel cards, already resolved with any
   * editable overrides overlaid on the byte-identical defaults. */
  channels?: VendorContactChannel[];
  /** SLICE 114: editable subject line for the "Email Our Buying Team" button. */
  outreachSubject?: string;
};

export function VendorDirectory({ content, vendors = [] }: { content?: VendorContent; vendors?: Vendor[] } = {}) {
  // SLICE 114: channels + outreach subject are editable; fall back to the
  // byte-identical defaults so the live look never changes until published.
  const channels = content?.channels ?? VENDOR_CONTACT_CHANNELS;
  const outreachSubject = content?.outreachSubject || VENDOR_OUTREACH_SUBJECT;

  return (
    <div className="bg-black px-4 py-6 text-white md:px-8 md:py-8">
      <div className="mx-auto max-w-[88rem] space-y-6 md:space-y-8">
        {/* Hero banner 1 — wide + short, premium art, professional copy.
            Driven by the Pages builder (vendors.grow) when present, else the
            faithful hardcoded defaults so the live look never changes. */}
        <SectionBanner
          imageSrc={content?.grow?.image || "/vendors/vendor-hero.png"}
          imageAlt={
            content?.grow?.imageAlt ||
            "Premium cannabis products against a Pacific Northwest forest backdrop"
          }
          eyebrow={content?.grow?.eyebrow || "Vendors & Partners"}
          title={content?.grow?.title || "Grow With Greenway"}
          titleClassName="text-[var(--orange)]"
          subtitle={
            content?.grow?.subtitle ||
            "We partner with licensed Washington producers and processors who share our commitment to quality, consistency, and craft."
          }
          buttons={content?.grow?.buttons}
          priority
        />

        {/* Outreach statement + email button. */}
        <section className="rounded-2xl border border-white/10 bg-[var(--charcoal)] px-5 py-6 shadow-xl shadow-black/30 md:px-9 md:py-8">
          <div className="mx-auto max-w-3xl text-center lg:max-w-6xl">
            <h2
              className="text-xl font-black uppercase tracking-tight text-white md:text-2xl"
              {...(content?.editable
                ? { "data-gw-block": "vendors.outreach.heading", "data-gw-editable": "true" }
                : {})}
            >
              {content?.heading || "Let's Work Together"}
            </h2>
            {/* SLICE 99: paragraph is editable copy now (vendors.outreach.body),
                seeded with the exact previous wording so the live look holds. */}
            <p
              className="mt-3 text-sm leading-relaxed text-zinc-300 md:text-base"
              {...(content?.editable
                ? { "data-gw-block": "vendors.outreach.body", "data-gw-editable": "true" }
                : {})}
            >
              {content?.body ||
                "Greenway Marijuana is an independent, locally owned cannabis shop in Port Orchard, Washington, proudly serving the Kitsap Peninsula. We're always looking to connect with licensed I-502 producers and processors who make exceptional product. If you'd like to send samples, schedule a vendor day, or explore getting your line on our shelves, reach out — our buying team would love to hear from you."}
            </p>
            <a
              href={`${greenwayBusiness.emailHref}?subject=${encodeURIComponent(outreachSubject)}${
                EMAIL_BODY ? `&body=${EMAIL_BODY}` : ""
              }`}
              className="mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[var(--orange)] to-[var(--gold)] px-7 py-3 text-sm font-black uppercase tracking-wide text-black shadow-lg shadow-black/40 transition hover:brightness-110 md:text-base"
            >
              <EmailIcon />
              Email Our Buying Team
            </a>
            <p className="mt-3 text-xs font-semibold text-zinc-500">
              {greenwayBusiness.email}
            </p>

            {/* SLICE 99: dedicated vendor-relations channels. Samples, promos,
                and vendor days go to the vendor_intake@ mailbox Michael reads;
                menus go to vendor_menu@ (auto-parsed into the back office);
                manifests go to vendor_intake@ (auto-staged into receiving).
                All buttons open a BLANK-body draft with a prefilled subject.
                SLICE 114: title/blurb/email/subject are each editable — the
                `channels` prop is already resolved with any overrides. */}
            <div className="mt-8 grid grid-cols-1 gap-3 text-left sm:grid-cols-2 lg:grid-cols-5">
              {channels.map((channel) => (
                <a
                  key={channel.key}
                  href={vendorMailtoHref(channel.email, channel.subject)}
                  className="group flex flex-col rounded-xl border border-white/10 bg-black/40 p-4 transition hover:-translate-y-0.5 hover:border-[var(--greenway)]/60"
                >
                  <span className="text-[0.72rem] font-black uppercase tracking-wide text-[var(--greenway)]">
                    {channel.title}
                  </span>
                  <span className="mt-1.5 flex-1 text-[0.7rem] leading-relaxed text-zinc-400">
                    {channel.blurb}
                  </span>
                  <span className="mt-3 break-all text-[0.66rem] font-bold text-zinc-300 group-hover:text-white">
                    {channel.email}
                  </span>
                </a>
              ))}
            </div>
          </div>
        </section>

        {/* Hero banner 2 — same size, introduces the vendor directory below.
            Driven by the Pages builder (vendors.brands) when present. */}
        <SectionBanner
          imageSrc={content?.brands?.image || "/vendors/vendor-section-banner.png"}
          imageAlt={content?.brands?.imageAlt || "A grid of partner cannabis brand emblems"}
          eyebrow={content?.brands?.eyebrow || "Our Partners"}
          title={content?.brands?.title || "Brands We Carry"}
          subtitle={
            content?.brands?.subtitle ||
            "The producers and processors stocking Greenway shelves today."
          }
          buttons={content?.brands?.buttons}
        />

        {/* Vendor directory — product-card-style glow tiles, logo forward, tap
            to reveal the blurb. SLICE 48: derived live from the published menu,
            so an empty menu shows a friendly note instead of a bare grid. */}
        {vendors.length > 0 ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4 xl:grid-cols-5">
              {vendors.map((vendor, index) => (
                <VendorCard key={vendor.slug} vendor={vendor} index={index} />
              ))}
            </div>

            {/* SLICE 97: only claim placeholders when some card actually
                falls back (no uploaded logo or written copy yet). */}
            {vendors.some((v) => !v.logoUrl || !v.description) ? (
              <p className="pt-2 text-center text-xs font-semibold text-zinc-500">
                Some logos and partner descriptions are placeholders pending final vendor assets.
              </p>
            ) : null}
          </>
        ) : (
          <p className="rounded-2xl border border-white/10 bg-zinc-950/60 p-8 text-center text-sm font-semibold text-zinc-400">
            Our partner directory is being refreshed — check back soon to meet the
            Washington producers and processors stocking our shelves.
          </p>
        )}

        {/* Extra banners staff added in the Pages builder render here. */}
        {(content?.extraSections ?? []).map((s) => (
          <SectionBanner
            key={s.key}
            imageSrc={s.image}
            imageAlt={s.imageAlt}
            eyebrow={s.eyebrow}
            title={s.title}
            subtitle={s.subtitle}
            buttons={s.buttons}
          />
        ))}
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
