"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { greenwayBusiness } from "@/content/business";

type SiteMenuItem = {
  label: string;
  href: string;
  isActive?: boolean;
};

const shopCategoryItems: SiteMenuItem[] = [
  { label: "Flower", href: "/menu?category=flower" },
  { label: "Popcorn Bud", href: "/menu?category=popcorn-bud" },
  { label: "Infused Flower", href: "/menu?category=infused-flower" },
  { label: "Preroll", href: "/menu?category=preroll" },
  { label: "Blunt", href: "/menu?category=blunt" },
  { label: "Preroll Pack", href: "/menu?category=preroll-pack" },
  { label: "Infused Preroll", href: "/menu?category=infused-preroll" },
  { label: "Infused Blunt", href: "/menu?category=infused-blunt" },
  { label: "Infused Preroll Pack", href: "/menu?category=infused-preroll-pack" },
  { label: "Cartridge", href: "/menu?category=cartridge" },
  { label: "Disposable Cartridge", href: "/menu?category=disposable-cartridge" },
  { label: "Concentrate", href: "/menu?category=concentrate" },
  { label: "RSO", href: "/menu?category=rso" },
  { label: "Edible (Solid)", href: "/menu?category=edible-solid" },
  { label: "Edible (Liquid)", href: "/menu?category=edible-liquid" },
  { label: "Tincture", href: "/menu?category=tincture" },
  { label: "Topical", href: "/menu?category=topical" },
  { label: "Accessories", href: "/menu?category=accessories" },
];

const primaryMenuItems: SiteMenuItem[] = [
  { label: "Home", href: "/#top", isActive: true },
  { label: "About", href: "/about" },
  { label: "Shop", href: "/menu" },
  { label: "Specials", href: "/specials" },
  { label: "Location", href: "/locations" },
  { label: "Loyalty", href: "/loyalty" },
  { label: "Blog", href: "/blog" },
  { label: "FAQs", href: "/faq" },
  { label: "Price Match", href: "/price-match" },
  { label: "Vendors & Partners", href: "/vendor-delivery" },
];

const socialLinks = [
  greenwayBusiness.social.facebook,
  greenwayBusiness.social.instagram,
  greenwayBusiness.social.yelp,
  greenwayBusiness.social.google,
  greenwayBusiness.social.leafly,
];

function DesktopSectionTitle({ children }: { children: string }) {
  return (
    <h3 className="mb-3 inline-block border-b border-[var(--orange)]/80 pb-1 text-sm font-black uppercase tracking-[0.22em] text-[var(--orange)]">
      {children}
    </h3>
  );
}

function MobileChevron({ isOpen }: { isOpen: boolean }) {
  return (
    <span className={`text-2xl leading-none text-zinc-500 transition-transform ${isOpen ? "-rotate-90 text-[var(--orange)]" : ""}`} aria-hidden="true">
      ›
    </span>
  );
}

export function MobileNavigation() {
  const [isOpen, setIsOpen] = useState(false);
  const [isShopOpen, setIsShopOpen] = useState(false);
  const [isAppOpen, setIsAppOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  function closeDrawer() {
    setIsOpen(false);
    setIsShopOpen(false);
    setIsAppOpen(false);
  }

  const overlay = isOpen ? (
    <div className="fixed left-0 top-0 z-[9999] h-[100dvh] min-h-screen w-screen overflow-hidden text-white" aria-hidden={false}>
      <button
        type="button"
        className="absolute inset-0 h-full w-full bg-black/60 backdrop-blur-[2px] md:bg-transparent md:backdrop-blur-none"
        onClick={closeDrawer}
        aria-label="Close site navigation overlay"
      />

      <aside
        className="absolute inset-0 flex h-[100dvh] min-h-screen w-screen flex-col bg-[#111]/98 text-white shadow-2xl md:hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Site navigation"
      >
        <div className="flex shrink-0 items-center justify-between px-7 pb-4 pt-8">
          <h2 className="text-4xl font-black uppercase tracking-tight text-white">Menu</h2>
          <button
            type="button"
            onClick={closeDrawer}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-black text-2xl font-light leading-none text-white transition hover:bg-[var(--orange)] hover:text-black"
            aria-label="Close site navigation menu"
          >
            ×
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-7 pb-10 pt-2" aria-label="Site navigation links">
          {primaryMenuItems.map((item) => {
            if (item.label === "Shop") {
              return (
                <div key={item.label} className="border-b border-white/[0.06]">
                  <div className="flex items-center justify-between">
                    <Link
                      href={item.href}
                      onClick={closeDrawer}
                      className="flex-1 py-3.5 text-[1.38rem] font-semibold tracking-tight text-zinc-100 transition hover:text-[var(--orange)]"
                    >
                      {item.label}
                    </Link>
                    <button
                      type="button"
                      onClick={() => setIsShopOpen((current) => !current)}
                      className="flex h-12 w-12 items-center justify-end transition hover:text-[var(--orange)]"
                      aria-label={isShopOpen ? "Collapse shop categories" : "Expand shop categories"}
                      aria-expanded={isShopOpen}
                    >
                      <MobileChevron isOpen={isShopOpen} />
                    </button>
                  </div>

                  {isShopOpen ? (
                    <div className="grid gap-2 pb-4 pl-4">
                      {shopCategoryItems.map((category) => (
                        <Link
                          key={category.href}
                          href={category.href}
                          onClick={closeDrawer}
                          className="text-base font-semibold text-zinc-300 transition hover:text-[var(--orange)]"
                        >
                          {category.label}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            }

            return (
              <Link
                key={item.label}
                href={item.href}
                onClick={closeDrawer}
                className={`flex items-center justify-between border-b border-white/[0.06] py-3.5 text-[1.38rem] font-semibold tracking-tight transition hover:text-[var(--orange)] ${
                  item.isActive ? "text-[var(--orange)]" : "text-zinc-100"
                }`}
              >
                <span>{item.label}</span>
              </Link>
            );
          })}

          <div className="border-b border-white/[0.06]">
            <div className="flex items-center justify-between">
              <button
                type="button"
                className="flex-1 py-3.5 text-left text-[1.38rem] font-semibold tracking-tight text-zinc-100"
                aria-label="App download section in development"
              >
                App Download
              </button>
              <button
                type="button"
                onClick={() => setIsAppOpen((current) => !current)}
                className="flex h-12 w-12 items-center justify-end transition hover:text-[var(--orange)]"
                aria-label={isAppOpen ? "Collapse app download options" : "Expand app download options"}
                aria-expanded={isAppOpen}
              >
                <MobileChevron isOpen={isAppOpen} />
              </button>
            </div>

            {isAppOpen ? (
              <div className="grid gap-2 pb-4 pl-4">
                <button type="button" className="w-fit text-left text-base font-semibold text-zinc-300 transition hover:text-[var(--orange)]">
                  App Store
                </button>
                <button type="button" className="w-fit text-left text-base font-semibold text-zinc-300 transition hover:text-[var(--orange)]">
                  Google Play
                </button>
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-zinc-500">* In development</p>
              </div>
            ) : null}
          </div>
        </nav>
      </aside>

      <aside
        className="absolute right-4 top-4 hidden max-h-[calc(100dvh-2rem)] w-[min(760px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[1.35rem] border-2 border-white/60 bg-[#101010]/70 px-7 pb-6 pt-6 text-white shadow-2xl shadow-black/60 md:flex"
        role="dialog"
        aria-modal="true"
        aria-label="Site navigation"
      >
        <div className="mb-6 flex shrink-0 items-start justify-between gap-6">
          <h2 className="text-4xl font-black uppercase tracking-tight text-white">Menu</h2>
          <button
            type="button"
            onClick={closeDrawer}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/55 text-2xl font-light leading-none text-white transition hover:bg-[var(--orange)] hover:text-black"
            aria-label="Close site navigation menu"
          >
            ×
          </button>
        </div>

        <div className="grid grid-cols-[1.05fr_1fr_1fr] gap-x-9 gap-y-6" aria-label="Site navigation links">
          <nav className="grid content-start gap-6">
            <section>
              <DesktopSectionTitle>Specials</DesktopSectionTitle>
              <div className="grid gap-1.5">
                <Link href="/specials" onClick={closeDrawer} className="text-[0.98rem] font-semibold leading-6 text-white/92 transition hover:text-[var(--orange)]">
                  Current Specials
                </Link>
              </div>
            </section>

            <section>
              <DesktopSectionTitle>Shop by Category</DesktopSectionTitle>
              <div className="grid gap-1.5">
                {shopCategoryItems.map((item) => (
                  <Link key={item.href} href={item.href} onClick={closeDrawer} className="text-[0.98rem] font-semibold leading-6 text-white/92 transition hover:text-[var(--orange)]">
                    {item.label}
                  </Link>
                ))}
              </div>
            </section>
          </nav>

          <nav className="grid content-start gap-6">
            <section>
              <DesktopSectionTitle>Location</DesktopSectionTitle>
              <div className="grid gap-1.5">
                <Link href="/locations" onClick={closeDrawer} className="text-[0.98rem] font-semibold leading-6 text-white/92 transition hover:text-[var(--orange)]">
                  Port Orchard
                </Link>
              </div>
            </section>

            <section>
              <DesktopSectionTitle>Loyalty</DesktopSectionTitle>
              <div className="grid gap-1.5">
                <Link href="/loyalty" onClick={closeDrawer} className="text-[0.98rem] font-semibold leading-6 text-white/92 transition hover:text-[var(--orange)]">
                  Sign up!
                </Link>
              </div>
            </section>

            <section>
              <DesktopSectionTitle>Social Media</DesktopSectionTitle>
              <div className="grid gap-1.5">
                {socialLinks.map((social) => (
                  <a key={social.url} href={social.url} target="_blank" rel="noreferrer" onClick={closeDrawer} className="text-[0.98rem] font-semibold leading-6 text-white/92 transition hover:text-[var(--orange)]">
                    {social.label}
                  </a>
                ))}
              </div>
            </section>
          </nav>

          <div className="grid content-start gap-6">
            <nav className="grid content-start gap-6">
              <section>
                <DesktopSectionTitle>More</DesktopSectionTitle>
                <div className="grid gap-1.5">
                  {[
                    { label: "About", href: "/about" },
                    { label: "Blog", href: "/blog" },
                    { label: "FAQs", href: "/faq" },
                    { label: "Price Match", href: "/price-match" },
                    { label: "Privacy Policy", href: "/privacy-policy" },
                    { label: "Terms of Use", href: "/terms-of-use" },
                  ].map((item) => (
                    <Link key={item.href} href={item.href} onClick={closeDrawer} className="text-[0.98rem] font-semibold leading-6 text-white/92 transition hover:text-[var(--orange)]">
                      {item.label}
                    </Link>
                  ))}
                </div>
              </section>

              <section>
                <DesktopSectionTitle>Vendors</DesktopSectionTitle>
                <div className="grid gap-1.5">
                  <Link href="/vendor-delivery" onClick={closeDrawer} className="text-[0.98rem] font-semibold leading-6 text-white/92 transition hover:text-[var(--orange)]">
                    Vendors &amp; Partners
                  </Link>
                </div>
              </section>
            </nav>

            <section className="-ml-[5.75rem] w-[17rem] text-center">
              <Image
                src="/app-download/app-download-transparent.png"
                alt="App download"
                width={220}
                height={195}
                className="mx-auto h-auto w-32"
              />
              <div className="mt-3 flex items-center justify-center gap-2.5">
                <button
                  type="button"
                  className="relative h-9 w-[7.8rem] overflow-hidden rounded-lg transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--orange)]/15"
                  aria-label="App Store download in development"
                >
                  <Image src="/app-download/apple-app-store-badge.png" alt="Available on the App Store" fill sizes="125px" className="object-contain" />
                </button>
                <button
                  type="button"
                  className="relative h-9 w-[7.8rem] overflow-hidden rounded-lg transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--orange)]/15"
                  aria-label="Google Play download in development"
                >
                  <Image src="/app-download/google-play-badge-solid.png" alt="Get it on Google Play" fill sizes="125px" className="object-contain" />
                </button>
              </div>
              <p className="mt-2 text-center text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-zinc-500">In Development</p>
            </section>
          </div>
        </div>
      </aside>
    </div>
  ) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] text-white transition hover:border-[var(--greenway)] hover:text-[var(--greenway)] sm:h-10 sm:w-10"
        aria-label="Open site navigation menu"
        aria-expanded={isOpen}
      >
        <span className="flex flex-col gap-1" aria-hidden="true">
          <span className="block h-0.5 w-4 rounded-full bg-current" />
          <span className="block h-0.5 w-4 rounded-full bg-current" />
          <span className="block h-0.5 w-4 rounded-full bg-current" />
        </span>
      </button>
      {overlay ? createPortal(overlay, document.body) : null}
    </>
  );
}
