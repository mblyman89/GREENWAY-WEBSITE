const contactEmail = "contact@greenwaymarijuana.com";

export const greenwayBusiness = {
  name: "Greenway Marijuana",
  legacyName: "Green Way Marijuana",
  website: "https://www.greenwaymarijuana.com",
  address: {
    line1: "4851 Geiger Rd SE",
    city: "Port Orchard",
    state: "WA",
    postalCode: "98367",
    country: "US",
    full: "4851 Geiger Rd SE, Port Orchard, WA 98367",
    mapQuery: "4851 Geiger Rd SE, Port Orchard, WA 98367",
    directionsUrl: "https://www.google.com/maps/search/?api=1&query=4851%20Geiger%20Rd%20SE%2C%20Port%20Orchard%2C%20WA%2098367",
  },
  phone: {
    display: "360-BUY-WEED",
    numeric: "360-443-6988",
    formatted: "(360) 443-6988",
    tel: "+13604436988",
  },
  email: contactEmail,
  emailHref: `mailto:${contactEmail}`,
  hours: {
    short: "Mon-Sun 8am-11pm",
    display: "Open daily, 8:00 am to 11:00 pm",
    dailyShort: "8am-11pm",
    weekly: [
      { day: "Monday", value: "8:00 am to 11:00 pm" },
      { day: "Tuesday", value: "8:00 am to 11:00 pm" },
      { day: "Wednesday", value: "8:00 am to 11:00 pm" },
      { day: "Thursday", value: "8:00 am to 11:00 pm" },
      { day: "Friday", value: "8:00 am to 11:00 pm" },
      { day: "Saturday", value: "8:00 am to 11:00 pm" },
      { day: "Sunday", value: "8:00 am to 11:00 pm" },
    ],
  },
  assets: {
    wordmark: "/brand/greenway-marijuana-wordmark-transparent.png",
    blackGoldLogo: "/brand/greenway-black-gold-logo.png",
    blackGoldLogoTransparent: "/brand/greenway-black-gold-logo-transparent.png",
    storefront: "/brand/greenway-front-of-store.webp",
    loyaltyHero: "/brand/greenway-loyalty-points-hero-desktop.png",
    loyaltyHeroMobile: "/brand/greenway-loyalty-points-hero-mobile.png",
    storeHoursImage: "/brand/store-hours-open.png",
    appDownloadWordmark: "/app-download/app-download-wordmark.png",
    appGlyphApple: "/app-download/glyph-apple.png",
    appGlyphGoogle: "/app-download/glyph-google.png",
    socialGlyphInstagram: "/social/glyph-instagram.png",
    socialGlyphFacebook: "/social/glyph-facebook.png",
  },
  social: {
    facebook: {
      label: "Facebook",
      shortLabel: "FB",
      url: "https://www.facebook.com/greenway.greenway.5817?mibextid=wwXIfr&rdid=DduvyRreh4Goqmp4&share_url=https%3A%2F%2Fwww.facebook.com%2Fshare%2F17c7PxQyXY%2F%3Fmibextid%3DwwXIfr#",
    },
    instagram: {
      label: "Instagram",
      shortLabel: "IG",
      url: "https://www.instagram.com/greenwaymj_",
    },
    yelp: {
      label: "Yelp",
      shortLabel: "Yelp",
      url: "https://www.yelp.com/biz/greenway-marijuana-port-orchard-2?osq=greenway+marijuana",
    },
    google: {
      label: "Google",
      shortLabel: "Google",
      url: "https://www.google.com/maps/place/Greenway+Marijuana/@47.5046241,-122.6410196,17z/data=!3m1!4b1!4m6!3m5!1s0x549049c49eee5f27:0xa5bc6e45aaad6ff!8m2!3d47.5046205!4d-122.6384447!16s%2Fg%2F11b6xmnx2s?entry=ttu&g_ep=EgoyMDI2MDYxNi4wIKXMDSoASAFQAw%3D%3D",
    },
    leafly: {
      label: "Leafly",
      shortLabel: "Leafly",
      url: "https://www.leafly.com/dispensary-info/greenway-marijuana",
    },
  },
} as const;

export const requiredComplianceWarning =
  "WARNING - This product has intoxicating effects and may be habit forming. Smoking is hazardous to your health. There may be health risks associated with consumption of this product. Should not be used by women that are pregnant or breast feeding. Marijuana can impair concentration, coordination, and judgment. Do not operate a vehicle or machinery while under the influence of this drug. For use only by adults twenty-one and older. Keep out of the reach of children.";
