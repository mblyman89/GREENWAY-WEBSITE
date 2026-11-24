import Image from "next/image";
// USAGE-8b: fixed size + no `sizes` = a 2-entry (1x/2x) srcSet, not 15 widths.
import { CHROME_IMAGE_PX } from "@/lib/site/chrome-image-core";
import Link from "@/components/site/IntentLink";
import { greenwayBusiness } from "@/content/business";
import { SiteText } from "@/components/site/SiteText";
import { ComplianceWarningText } from "@/components/site/ComplianceWarningText";
import { FooterLinkUnavailable } from "@/components/site/FooterLinkUnavailable";
import { unavailableMessageProp } from "@/lib/site/footer-glyph-core";
import { getContentForRender, getContentValues } from "@/lib/cms/render-content";
import { PhoneText } from "./PhoneText";

const policyLinks = [
  { label: "Privacy Policy", href: "/privacy-policy" },
  { label: "Terms of Use", href: "/terms-of-use" },
  { label: "Consumer Health Data", href: "/consumer-health-data" },
];

// The circular glyph styling shared by every app/social footer button, so the
// editable versions render pixel-identical to the previous hardcoded links.
// USAGE-9e: the glyph class is FooterLinkUnavailable's default (footer-glyph-core).

// The editable footer link/message blocks (Admin -> Website -> Header & Footer).
// Their seed defaults mirror the live URLs below, so the footer looks identical
// until a staff member edits a block. The two app-store links seed BLANK on
// purpose so they show the friendly "not connected yet" message for now.
const FOOTER_LINK_BLOCKS = [
  "footer.social.facebook.url",
  "footer.social.instagram.url",
  "footer.social.google.url",
  "footer.social.yelp.url",
  "footer.social.leafly.url",
  "footer.app.apple.url",
  "footer.app.google.url",
  "footer.link.unavailable.message",
  "header.phone.mode", // R64: same desktop phone setting as the top bar
] as const;

type FooterLinks = Record<string, string>;

// App store glyphs (steel-blue circular badges, matching brand reference).
// `blockKey` names the editable URL block that controls each button.
const appStores = [
  { key: "apple", label: "Apple App Store", src: greenwayBusiness.assets.appGlyphApple, blockKey: "footer.app.apple.url" },
  { key: "google", label: "Google Play", src: greenwayBusiness.assets.appGlyphGoogle, blockKey: "footer.app.google.url" },
];

// Social glyphs (steel-blue circular badges, matching brand reference).
// `blockKey` names the editable URL block; `fallback` is the live business.ts
// URL used if the block has not been seeded/edited.
const socialGlyphs = [
  { label: greenwayBusiness.social.facebook.label, blockKey: "footer.social.facebook.url", fallback: greenwayBusiness.social.facebook.url, src: greenwayBusiness.assets.socialGlyphFacebook },
  { label: greenwayBusiness.social.instagram.label, blockKey: "footer.social.instagram.url", fallback: greenwayBusiness.social.instagram.url, src: greenwayBusiness.assets.socialGlyphInstagram },
  { label: greenwayBusiness.social.google.label, blockKey: "footer.social.google.url", fallback: greenwayBusiness.social.google.url, src: greenwayBusiness.assets.socialGlyphGoogle },
  { label: greenwayBusiness.social.yelp.label, blockKey: "footer.social.yelp.url", fallback: greenwayBusiness.social.yelp.url, src: greenwayBusiness.assets.socialGlyphYelp },
  { label: greenwayBusiness.social.leafly.label, blockKey: "footer.social.leafly.url", fallback: greenwayBusiness.social.leafly.url, src: greenwayBusiness.assets.socialGlyphLeafly },
];

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

/**
 * Store hours graphic ("OPEN / 8am-11pm"). Shared by mobile + desktop.
 * The artwork is now transparent (no background box), so it blends with the
 * black footer and is free to scale up and fill its column. We let it grow to
 * the full width of its container rather than capping it with a small box, so
 * it fills the available space without forcing layout shifts on siblings.
 */
async function HoursImage() {
  // Resolve the editable store-hours image from the controlled content block
  // (draft-aware via getContentForRender). Falls back to the bundled asset so
  // the footer always renders even before the block has been seeded/edited.
  const resolved = await getContentForRender("footer.hours.image");
  const src =
    resolved && resolved.trim().length > 0
      ? resolved.trim()
      : greenwayBusiness.assets.storeHoursImage;
  return (
    <div className="flex w-full justify-center lg:justify-end">
      <Image
        src={src}
        alt="Greenway Marijuana store hours: open daily 8am to 11pm"
        width={580}
        height={360}
        className="h-auto w-full max-w-[20rem] object-contain lg:max-w-none"
        sizes="(min-width: 1024px) 20rem, 18rem"
        priority={false}
      />
    </div>
  );
}

/**
 * App-download block: the "App / DOWNLOAD" wordmark to the LEFT of two
 * steel-blue circular store glyphs (Apple + Google Play). Identical markup on
 * mobile and desktop. Centered on mobile, right-aligned on desktop (USAGE-10b).
 */
function AppDownload({ links }: { links: FooterLinks }) {
  const unavailable = links["footer.link.unavailable.message"] ?? "";
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3 lg:justify-end">
      <Image
        src={greenwayBusiness.assets.appDownloadWordmark}
        alt="App download"
        width={CHROME_IMAGE_PX.appWordmark.width}
        height={CHROME_IMAGE_PX.appWordmark.height}
        className="h-14 w-auto object-contain"
      />
      <div className="flex items-center gap-3">
        {appStores.map((store) => (
          <FooterLinkUnavailable
            key={store.key}
            href={links[store.blockKey] ?? ""}
            label={store.label}
            src={store.src}
            unavailableMessage={unavailableMessageProp(unavailable)}
            newTab
          />
        ))}
      </div>
    </div>
  );
}

/** Follow-Greenway block: steel-blue circular social glyphs. Identical on mobile + desktop. */
function FollowGreenway({ links }: { links: FooterLinks }) {
  // Title and glyph row are always centered (per request). With five glyphs we
  // let the row wrap and center so it never overflows its column.
  const unavailable = links["footer.link.unavailable.message"] ?? "";
  return (
    <div className="flex w-full flex-col items-center gap-3 text-center">
      <p className="text-[0.68rem] font-black uppercase tracking-[0.18em] text-zinc-400">Follow Greenway</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {socialGlyphs.map((social) => {
          // Prefer the editable block value; fall back to the live business.ts
          // URL so seeding produces no visible change. If a staff member clears
          // a social URL, the friendly "not connected yet" message shows.
          const resolved = links[social.blockKey];
          const href = resolved && resolved.trim().length > 0 ? resolved : social.fallback;
          return (
            <FooterLinkUnavailable
              key={social.blockKey}
              href={href}
              label={social.label}
              src={social.src}
              unavailableMessage={unavailableMessageProp(unavailable)}
              newTab
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * USAGE-10b: one footer tree. It used to render a full mobile copy and a full
 * desktop copy (one hidden per breakpoint), so the hours graphic, app
 * download and Follow Greenway rows shipped twice on every page. Those now
 * render once (stacked on mobile, the right-hand column on desktop); only the
 * parts whose layout genuinely differs stay breakpoint-gated.
 */
export async function Footer() {
  // Resolve the editable footer link/message blocks once (draft-aware). Seed
  // defaults mirror the live URLs, so this changes nothing until a block is
  // edited. Blank app-store links trigger the friendly "not connected" message.
  const links = await getContentValues([...FOOTER_LINK_BLOCKS]);
  return (
    <footer id="location" className="bg-black px-4 pb-8 pt-12 text-white md:px-8 md:pb-10 md:pt-14">
      <div className="mx-auto max-w-md border-t border-white/10 pt-9 text-center lg:max-w-7xl lg:pt-10 lg:text-left">
        {/* Mobile top: logo, tagline, address card. */}
        <div className="lg:hidden">
          <Link href="/#top" aria-label="Greenway Marijuana home" className="inline-flex justify-center transition duration-200 hover:opacity-85">
            <Image
              src={greenwayBusiness.assets.blackGoldLogo}
              alt="Greenway Marijuana Port Orchard WA established 2014"
              width={CHROME_IMAGE_PX.logoMobile.width}
              height={CHROME_IMAGE_PX.logoMobile.height}
              className="h-auto w-44 object-contain"
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
              <PhoneText text={greenwayBusiness.phone.display} mode={links["header.phone.mode"]} modeKey="header.phone.mode" />
            </a>
          </div>
        </div>

        <div className="lg:grid lg:grid-cols-[0.78fr_1.5fr_0.85fr] lg:items-start lg:gap-8">
          {/* Desktop left column. */}
          <div className="hidden flex-col items-start text-left lg:flex">
            <Link href="/#top" aria-label="Greenway Marijuana home" className="inline-flex transition duration-200 hover:opacity-85">
              <Image
                src={greenwayBusiness.assets.blackGoldLogo}
                alt="Greenway Marijuana Port Orchard WA established 2014"
                width={CHROME_IMAGE_PX.logoDesktop.width}
                height={CHROME_IMAGE_PX.logoDesktop.height}
                className="h-auto w-48 object-contain"
              />
            </Link>
            <p className="mt-4 text-xs font-black uppercase tracking-[0.22em] text-[var(--gold)]">Port Orchard, WA</p>
            <p className="mt-2 max-w-xs text-sm leading-6 text-zinc-400">{greenwayBusiness.address.full}</p>
            <CopyrightLine className="mt-5 max-w-xs" />
          </div>

          {/* Desktop centre: warning + policy links. */}
          <div className="hidden rounded-[1.5rem] border border-[var(--gold)]/35 bg-[#090909] p-6 shadow-2xl shadow-black/35 lg:block">
            <p className="text-center text-xs font-black uppercase tracking-[0.22em] text-[var(--gold)]">Washington Cannabis Warning</p>
            <ComplianceWarningText className="mt-4 text-center text-[0.95rem] font-semibold leading-7 text-zinc-200" />
            <PolicyLinks />
          </div>

          {/* Shared (rendered once): hours, app download, Follow Greenway. */}
          <div className="mt-7 flex flex-col items-center lg:mt-0 lg:items-end lg:gap-6 lg:text-right">
            <div className="w-full">
              {/* Store hours graphic + editable plain-text hours (business.hours.display). */}
              <HoursImage />
              <SiteText
                blockKey="business.hours.display"
                as="p"
                className="mt-2 text-center text-xs font-black uppercase tracking-[0.18em] text-[var(--greenway)] lg:mt-6 lg:text-right"
              />
            </div>

            <div className="mt-7 w-full rounded-[1.4rem] border border-white/10 bg-white/[0.03] px-4 py-5 lg:mt-0 lg:max-w-xs lg:rounded-2xl">
              <AppDownload links={links} />
            </div>

            <div className="mt-4 w-full rounded-[1.4rem] border border-white/10 bg-white/[0.03] px-4 py-5 lg:mt-0 lg:max-w-xs lg:rounded-2xl">
              <FollowGreenway links={links} />
            </div>
          </div>
        </div>

        {/* Mobile bottom: warning, policy links, copyright. */}
        <div className="lg:hidden">
          <div className="mt-7 rounded-[1.25rem] border border-[var(--gold)]/30 bg-[#090909] p-4">
            <p className="text-[0.62rem] font-black uppercase tracking-[0.2em] text-[var(--gold)]">Washington Cannabis Warning</p>
            <ComplianceWarningText className="mt-3 text-[0.72rem] font-semibold leading-5 text-zinc-300" />
          </div>

          <div className="mt-7">
            <PolicyLinks compact />
          </div>

          <CopyrightLine className="mt-4 text-center" />
        </div>
      </div>
    </footer>
  );
}
