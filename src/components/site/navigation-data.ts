export type NavigationChild = {
  label: string;
  href: string;
  helper: string;
};

export type NavigationItem = {
  label: string;
  href: string;
  helper: string;
  children?: NavigationChild[];
};

export const primaryNavigationItems: NavigationItem[] = [
  {
    label: "Home",
    href: "/#top",
    helper: "Return to the Greenway homepage and 21+ preview entry point.",
  },
  {
    label: "Shop",
    href: "/menu",
    helper: "Browse the POS menu experience built for future Leafly category and filter accuracy.",
    children: [
      { label: "Full menu", href: "/menu", helper: "View the full menu with categories, filters, sorting, and product cards." },
      { label: "Flower", href: "/menu?category=flower", helper: "Premium and regular usable marijuana flower." },
      { label: "Popcorn Bud", href: "/menu?category=popcorn-bud", helper: "Popcorn bud, small bud, and budget flower options." },
      { label: "Infused Flower", href: "/menu?category=infused-flower", helper: "Moon rocks, caviar, and other infused flower products." },
      { label: "Preroll", href: "/menu?category=preroll", helper: "Single non-infused prerolls." },
      { label: "Blunt", href: "/menu?category=blunt", helper: "Classic blunt rows, kept separate from standard prerolls." },
      { label: "Preroll Pack", href: "/menu?category=preroll-pack", helper: "Non-infused multi-pack prerolls." },
      { label: "Infused Preroll", href: "/menu?category=infused-preroll", helper: "Single infused prerolls." },
      { label: "Infused Blunt", href: "/menu?category=infused-blunt", helper: "Infused blunt rows for elevated sessions." },
      { label: "Infused Preroll Pack", href: "/menu?category=infused-preroll-pack", helper: "Multi-pack infused prerolls and infused blunts." },
      { label: "Cartridge", href: "/menu?category=cartridge", helper: "Cartridge categories, including live resin carts." },
      { label: "Disposable Cartridge", href: "/menu?category=disposable-cartridge", helper: "All-in-one disposable vape options." },
      { label: "Concentrate", href: "/menu?category=concentrate", helper: "Rosin, resin, badder, hash, RSO, and more." },
      { label: "RSO", href: "/menu?category=rso", helper: "Full-spectrum RSO rows." },
      { label: "Edible (Solid)", href: "/menu?category=edible-solid", helper: "Gummies, chocolates, chews, mints, and candies." },
      { label: "Edible (Liquid)", href: "/menu?category=edible-liquid", helper: "Beverages, shots, sodas, and liquid edibles." },
      { label: "Tincture", href: "/menu?category=tincture", helper: "Dropper tinctures for precise dosing." },
      { label: "Topical", href: "/menu?category=topical", helper: "Balms, lotions, salves, and transdermals." },
      { label: "Accessories", href: "/menu?category=accessories", helper: "Glass, rolling gear, batteries, dab tools, and lighters." },
      { label: "Greenway Merch", href: "/menu?category=merch", helper: "Official Greenway apparel and gear — tees, hoodies, hats, and more." },
    ],
  },
  {
    label: "Specials",
    href: "/specials",
    helper: "Preview promotional layouts before verified rules are published.",
    children: [
      { label: "Current specials", href: "/specials", helper: "See placeholder promotion cards and compliance notes." },
      { label: "Price Match", href: "/price-match", helper: "Review the future local competitor price match policy preview." },
    ],
  },
  {
    label: "About",
    href: "/about",
    helper: "Review Greenway’s source-aligned build philosophy and preview positioning.",
  },
  {
    label: "Location",
    href: "/locations",
    helper: "See Greenway’s Port Orchard address, hours, phone, map, and visit details.",
  },
  {
    label: "Loyalty",
    href: "/loyalty",
    helper: "Join the future Greenway loyalty list and submit signup details for staff review.",
  },
  {
    label: "Blog",
    href: "/blog",
    helper: "Preview the future Greenway education hub.",
  },
  {
    label: "FAQ",
    href: "/faq",
    helper: "Read ordering, compliance, and visit-planning answers.",
  },
  {
    label: "Vendors",
    href: "/vendor-delivery",
    helper: "Meet the licensed Washington cannabis brands on our shelves and learn how to become a vendor partner.",
  },
];
