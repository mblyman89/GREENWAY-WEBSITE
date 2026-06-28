import Image from "next/image";
import Link from "next/link";
import { greenwayBusiness } from "@/content/business";
import { SiteText } from "@/components/site/SiteText";

const policyLinks = [
  { label: "Privacy Policy", href: "/privacy-policy" },
  { label: "Terms of Use", href: "/terms-of-use" },
  { label: "Consumer Health Data", href: "/consumer-health-data" },
];

// App store glyphs (steel-blue circular badges, matching brand reference).
const appStores = [
  { key: "apple", label: "Apple App Store", src: greenwayBusiness.assets.appGlyphApple, href: "#" },
  { key: "google", label: "Google Play", src: greenwayBusiness.assets.appGlyphGoogle, href: "#" },
];

// Social glyphs (steel-blue circular badges, matching brand reference).
const socialGlyphs = [
  { ...greenwayBusiness.social.facebook, src: greenwayBusiness.assets.socialGlyphFacebook },
  { ...greenwayBusiness.social.instagram, src: greenwayBusiness.assets.socialGlyphInstagram },
  { ...greenwayBusiness.social.google, src: greenwayBusiness.assets.socialGlyphGoogle },
  { ...greenwayBusiness.social.yelp, src: greenwayBusiness.assets.socialGlyphYelp },
  { ...greenwayBusiness.social.leafly, src: greenwayBusiness.assets.socialGlyphLeafly },
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
 * Store hours graphic ("OPEN / 8am-11:45pm"). Shared by mobile + desktop.
 * The artwork is now transparent (no background box), so it blends with the
 * black footer and is free to scale up and fill its column. We let it grow to
 * the full width of its container rather than capping it with a small box, so
 * it fills the available space without forcing layout shifts on siblings.
 */
function HoursImage({ align = "center" }: { align?: "center" | "end" }) {
  return (
    <div className={`flex w-full ${align === "end" ? "justify-end" : "justify-center"}`}>
      <Image
        src={greenwayBusiness.assets.storeHoursImage}
        alt="Greenway Marijuana store hours: open daily 8am to 11:45pm"
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
 * mobile and desktop. `align` controls horizontal placement of the whole row.
 */
function AppDownload({ align = "center" }: { align?: "center" | "end" }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-5 gap-y-3 ${align === "end" ? "justify-end" : "justify-center"}`}>
      <Image
        src={greenwayBusiness.assets.appDownloadWordmark}
        alt="App download"
        width={420}
        height={420}
        className="h-14 w-auto object-contain"
        sizes="140px"
      />
      <div className="flex items-center gap-3">
        {appStores.map((store) => (
          <a
            key={store.key}
            href={store.href}
            aria-label={`${store.label} — app coming soon`}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full transition duration-200 hover:scale-105 hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--greenway)]"
          >
            <Image src={store.src} alt={store.label} width={88} height={88} className="h-11 w-11 object-contain" sizes="44px" />
          </a>
        ))}
      </div>
    </div>
  );
}

/** Follow-Greenway block: steel-blue circular social glyphs. Identical on mobile + desktop. */
function FollowGreenway() {
  // Title and glyph row are always centered (per request). With five glyphs we
  // let the row wrap and center so it never overflows its column.
  return (
    <div className="flex w-full flex-col items-center gap-3 text-center">
      <p className="text-[0.68rem] font-black uppercase tracking-[0.18em] text-zinc-400">Follow Greenway</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {socialGlyphs.map((social) => (
          <a
            key={social.url}
            href={social.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open Greenway on ${social.label}`}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full transition duration-200 hover:scale-105 hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--greenway)]"
          >
            <Image src={social.src} alt={social.label} width={88} height={88} className="h-11 w-11 object-contain" sizes="44px" />
          </a>
        ))}
      </div>
    </div>
  );
}

async function MobileFooter() {
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

      {/* Store hours graphic (replaces the former green hours box). */}
      <div className="mt-7">
        <HoursImage align="center" />
      </div>

      {/* App download: wordmark left of the two circular store glyphs. */}
      <div className="mt-7 rounded-[1.4rem] border border-white/10 bg-white/[0.03] px-4 py-5">
        <AppDownload align="center" />
      </div>

      {/* Follow Greenway: circular social glyphs. */}
      <div className="mt-4 rounded-[1.4rem] border border-white/10 bg-white/[0.03] px-4 py-5">
        <FollowGreenway />
      </div>

      <div className="mt-7 rounded-[1.25rem] border border-[var(--gold)]/30 bg-[#090909] p-4">
        <p className="text-[0.62rem] font-black uppercase tracking-[0.2em] text-[var(--gold)]">Washington Cannabis Warning</p>
        <SiteText
          blockKey="footer.compliance.warning"
          as="p"
          className="mt-3 text-[0.72rem] font-semibold leading-5 text-zinc-300"
        />
      </div>

      <div className="mt-7">
        <PolicyLinks compact />
      </div>

      <CopyrightLine className="mt-4 text-center" />
    </div>
  );
}

async function DesktopFooter() {
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
          <SiteText
            blockKey="footer.compliance.warning"
            as="p"
            className="mt-4 text-center text-[0.95rem] font-semibold leading-7 text-zinc-200"
          />
          <PolicyLinks />
        </div>

        <div className="flex flex-col items-end gap-6 text-right">
          {/* Store hours graphic (replaces the former Hours / phone text block). */}
          <HoursImage align="end" />

          {/* App download — identical to mobile, in the desktop spot. */}
          <div className="w-full max-w-xs rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-5">
            <AppDownload align="end" />
          </div>

          {/* Follow Greenway — identical to mobile, in the desktop spot. */}
          <div className="w-full max-w-xs rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-5">
            <FollowGreenway />
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
