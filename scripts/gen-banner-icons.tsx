/**
 * R55-S3 — generate src/lib/cms/banner-icons-data.ts from @phosphor-icons/react
 * (MIT). Only the curated icons and 3 weights are extracted, as plain SVG
 * element data, so the public site never ships the icon library itself.
 *
 *   npx tsx scripts/gen-banner-icons.tsx
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ReactElement, ReactNode } from "react";

// R58-S4: ~250 icons in categories (cannabis, smoke, products, deals…), searchable by keywords.
const ICONS: [string, string, string, string, string][] = [
  // [Phosphor name, our id, friendly label, category, extra search words]
  // Cannabis & nature
  ["Leaf", "leaf", "Leaf", "Cannabis & nature", "weed cannabis bud"],
  ["Plant", "plant", "Plant", "Cannabis & nature", "sprout grow"],
  ["PottedPlant", "potted-plant", "Potted plant", "Cannabis & nature", "grow clone"],
  ["Flower", "flower", "Flower", "Cannabis & nature", "bud"],
  ["FlowerLotus", "lotus", "Lotus", "Cannabis & nature", "zen calm"],
  ["FlowerTulip", "tulip", "Tulip", "Cannabis & nature", "spring"],
  ["Tree", "tree", "Tree", "Cannabis & nature", ""],
  ["TreeEvergreen", "evergreen", "Pine tree", "Cannabis & nature", "pnw forest"],
  ["TreePalm", "palm", "Palm tree", "Cannabis & nature", "tropical"],
  ["Clover", "clover", "Clover", "Cannabis & nature", "lucky"],
  ["Cactus", "cactus", "Cactus", "Cannabis & nature", "desert"],
  ["Grains", "grains", "Grains", "Cannabis & nature", "hemp wheat"],
  ["Feather", "feather", "Feather", "Cannabis & nature", "light"],
  ["Mountains", "mountains", "Mountains", "Cannabis & nature", "pnw outdoors"],
  ["Waves", "waves", "Waves", "Cannabis & nature", "water"],
  ["Campfire", "campfire", "Campfire", "Cannabis & nature", "camping"],
  ["Tent", "tent", "Tent", "Cannabis & nature", "camping"],
  ["Butterfly", "butterfly", "Butterfly", "Cannabis & nature", ""],
  ["Bird", "bird", "Bird", "Cannabis & nature", ""],
  ["Bug", "bug", "Bug", "Cannabis & nature", ""],
  // Smoke & vibes
  ["Cigarette", "joint", "Joint / pre-roll", "Smoke & vibes", "smoke blunt preroll cigarette"],
  ["Pipe", "pipe", "Pipe", "Smoke & vibes", "smoke bowl"],
  ["Fire", "fire", "Fire / hot", "Smoke & vibes", "flame lit"],
  ["FireSimple", "fire-simple", "Flame", "Smoke & vibes", "lit hot"],
  ["Flame", "flame", "Flame 2", "Smoke & vibes", "lit hot"],
  ["Wind", "wind", "Wind / smoke", "Smoke & vibes", "smoke puff air"],
  ["Cloud", "cloud", "Cloud", "Smoke & vibes", "smoke"],
  ["CloudFog", "fog", "Fog", "Smoke & vibes", "smoke haze"],
  ["Tornado", "tornado", "Swirl / tornado", "Smoke & vibes", "smoke"],
  ["Spiral", "spiral", "Spiral", "Smoke & vibes", "trippy psychedelic"],
  ["Infinity", "infinity", "Infinity", "Smoke & vibes", ""],
  ["Peace", "peace", "Peace sign", "Smoke & vibes", "420 hippie"],
  ["YinYang", "yin-yang", "Yin yang", "Smoke & vibes", "balance"],
  ["Eye", "eye", "Eye", "Smoke & vibes", "trippy"],
  ["Eyes", "eyes", "Eyes", "Smoke & vibes", "look"],
  ["Alien", "alien", "Alien", "Smoke & vibes", "space"],
  ["Ghost", "ghost", "Ghost", "Smoke & vibes", "halloween"],
  ["Skull", "skull", "Skull", "Smoke & vibes", "halloween"],
  ["Brain", "brain", "Brain", "Smoke & vibes", "mind"],
  ["Sunglasses", "sunglasses", "Sunglasses", "Smoke & vibes", "cool chill"],
  ["MaskHappy", "mask", "Mask", "Smoke & vibes", "party"],
  ["RainbowCloud", "rainbow-cloud", "Rainbow cloud", "Smoke & vibes", "psychedelic"],
  ["Rainbow", "rainbow", "Rainbow", "Smoke & vibes", "pride"],
  ["Atom", "atom", "Atom", "Smoke & vibes", "science"],
  ["Planet", "planet", "Planet", "Smoke & vibes", "space"],
  ["RocketLaunch", "rocket", "Rocket", "Smoke & vibes", "high launch"],
  ["ShootingStar", "shooting-star", "Shooting star", "Smoke & vibes", ""],
  // Products
  ["Cookie", "cookie", "Cookie / edible", "Products", "edible gummy"],
  ["Cake", "cake", "Cake", "Products", "edible birthday"],
  ["IceCream", "ice-cream", "Ice cream", "Products", "sunday"],
  ["Popcorn", "popcorn", "Popcorn", "Products", "snack munchies"],
  ["Pizza", "pizza", "Pizza", "Products", "munchies"],
  ["Hamburger", "hamburger", "Burger", "Products", "munchies"],
  ["Coffee", "coffee", "Coffee", "Products", "drink"],
  ["CoffeeBean", "coffee-bean", "Coffee bean", "Products", ""],
  ["TeaBag", "tea", "Tea", "Products", "drink"],
  ["BeerBottle", "beer", "Bottle", "Products", "drink"],
  ["Martini", "martini", "Cocktail", "Products", "drink"],
  ["Champagne", "champagne", "Champagne", "Products", "celebrate"],
  ["Wine", "wine", "Wine", "Products", "drink"],
  ["Cherries", "cherries", "Cherries", "Products", "fruit flavor"],
  ["Orange", "orange", "Orange", "Products", "citrus flavor"],
  ["OrangeSlice", "orange-slice", "Citrus slice", "Products", "flavor terpene"],
  ["Avocado", "avocado", "Avocado", "Products", ""],
  ["Pepper", "pepper", "Pepper", "Products", "spicy"],
  ["Drop", "drop", "Drop", "Products", "oil tincture"],
  ["DropHalf", "drop-half", "Half drop", "Products", "oil tincture"],
  ["Flask", "flask", "Flask", "Products", "lab tested concentrate"],
  ["TestTube", "test-tube", "Test tube", "Products", "lab tested"],
  ["Jar", "jar", "Jar", "Products", "flower concentrate"],
  ["JarLabel", "jar-label", "Labelled jar", "Products", "flower"],
  ["Pill", "pill", "Capsule", "Products", "medical"],
  ["Syringe", "syringe", "Syringe", "Products", "rso"],
  ["FirstAid", "first-aid", "First aid", "Products", "medical"],
  ["Heartbeat", "heartbeat", "Heartbeat", "Products", "medical health"],
  ["Thermometer", "thermometer", "Thermometer", "Products", ""],
  ["Scales", "scales", "Scales", "Products", "weight gram ounce"],
  ["Gauge", "gauge", "Gauge", "Products", "potency"],
  ["Lightbulb", "lightbulb", "Light bulb", "Products", "idea"],
  ["Package", "package", "Package", "Products", "box"],
  ["TShirt", "t-shirt", "T-shirt", "Products", "merch"],
  ["Hoodie", "hoodie", "Hoodie", "Products", "merch"],
  // Deals & money
  ["Tag", "tag", "Price tag", "Deals & money", "sale deal"],
  ["TagSimple", "tag-simple", "Tag 2", "Deals & money", "sale"],
  ["Percent", "percent", "Percent", "Deals & money", "sale off"],
  ["SealPercent", "seal-percent", "Discount seal", "Deals & money", "sale off"],
  ["Seal", "seal", "Seal", "Deals & money", "badge"],
  ["SealCheck", "seal-check", "Verified seal", "Deals & money", "approved"],
  ["CurrencyDollar", "dollar", "Dollar", "Deals & money", "money price"],
  ["Money", "money", "Cash", "Deals & money", "money"],
  ["MoneyWavy", "money-wavy", "Cash 2", "Deals & money", "money"],
  ["Coins", "coins", "Coins", "Deals & money", "money"],
  ["HandCoins", "hand-coins", "Hand + coins", "Deals & money", "savings"],
  ["Wallet", "wallet", "Wallet", "Deals & money", "money"],
  ["CreditCard", "credit-card", "Card", "Deals & money", "pay debit"],
  ["Receipt", "receipt", "Receipt", "Deals & money", ""],
  ["Barcode", "barcode", "Barcode", "Deals & money", ""],
  ["QrCode", "qr-code", "QR code", "Deals & money", "scan"],
  ["Gift", "gift", "Gift", "Deals & money", "present"],
  ["Ticket", "ticket", "Ticket", "Deals & money", "coupon"],
  ["Sticker", "sticker", "Sticker", "Deals & money", ""],
  ["ShoppingCart", "cart", "Cart", "Deals & money", "shop"],
  ["ShoppingBag", "bag", "Shopping bag", "Deals & money", "shop"],
  ["ShoppingBagOpen", "bag-open", "Open bag", "Deals & money", "shop"],
  ["Basket", "basket", "Basket", "Deals & money", "shop"],
  ["Handbag", "handbag", "Handbag", "Deals & money", "shop"],
  ["Storefront", "storefront", "Storefront", "Deals & money", "shop store"],
  // Celebrate & rating
  ["Star", "star", "Star", "Celebrate & rating", "rating"],
  ["StarFour", "star-four", "4-point star", "Celebrate & rating", "sparkle"],
  ["StarHalf", "star-half", "Half star", "Celebrate & rating", "rating"],
  ["Sparkle", "sparkle", "Sparkle", "Celebrate & rating", "new shine"],
  ["MagicWand", "magic", "Magic wand", "Celebrate & rating", "sparkle"],
  ["Heart", "heart", "Heart", "Celebrate & rating", "love"],
  ["HeartStraight", "heart-straight", "Heart 2", "Celebrate & rating", "love"],
  ["Crown", "crown", "Crown", "Celebrate & rating", "top king"],
  ["CrownSimple", "crown-simple", "Crown 2", "Celebrate & rating", "top"],
  ["Medal", "medal", "Medal", "Celebrate & rating", "award"],
  ["Trophy", "trophy", "Trophy", "Celebrate & rating", "award winner"],
  ["Confetti", "confetti", "Confetti", "Celebrate & rating", "party"],
  ["Balloon", "balloon", "Balloon", "Celebrate & rating", "party birthday"],
  ["DiscoBall", "disco", "Disco ball", "Celebrate & rating", "party"],
  ["Smiley", "smiley", "Smiley", "Celebrate & rating", "happy"],
  ["SmileyWink", "smiley-wink", "Wink", "Celebrate & rating", "happy"],
  ["SmileySticker", "smiley-sticker", "Smiley sticker", "Celebrate & rating", ""],
  ["SmileyMelting", "smiley-melting", "Melting smiley", "Celebrate & rating", "high"],
  ["ThumbsUp", "thumbs-up", "Thumbs up", "Celebrate & rating", "like"],
  ["HandsClapping", "clap", "Clapping", "Celebrate & rating", "applause"],
  ["HandPeace", "hand-peace", "Peace hand", "Celebrate & rating", "420"],
  ["HandHeart", "hand-heart", "Hand + heart", "Celebrate & rating", "care"],
  ["HandWaving", "wave", "Waving hand", "Celebrate & rating", "hello"],
  ["Handshake", "handshake", "Handshake", "Celebrate & rating", "deal"],
  ["Diamond", "gem", "Diamond", "Celebrate & rating", "premium"],
  ["Lightning", "lightning", "Lightning", "Celebrate & rating", "fast flash"],
  ["Megaphone", "megaphone", "Megaphone", "Celebrate & rating", "announce"],
  ["Bell", "bell", "Bell", "Celebrate & rating", "alert"],
  ["BellRinging", "bell-ringing", "Ringing bell", "Celebrate & rating", "alert"],
  ["Flag", "flag", "Flag", "Celebrate & rating", ""],
  ["FlagBanner", "flag-banner", "Banner flag", "Celebrate & rating", ""],
  ["Shield", "shield", "Shield", "Celebrate & rating", "safe"],
  ["ShieldCheck", "shield-check", "Shield check", "Celebrate & rating", "safe tested"],
  ["Key", "key", "Key", "Celebrate & rating", "vip"],
  ["LockKey", "lock", "Lock", "Celebrate & rating", "members"],
  // Time & weather
  ["Clock", "clock", "Clock", "Time & weather", "time"],
  ["ClockCountdown", "countdown", "Countdown", "Time & weather", "timer"],
  ["Timer", "timer", "Timer", "Time & weather", "countdown"],
  ["Hourglass", "hourglass", "Hourglass", "Time & weather", "countdown"],
  ["HourglassMedium", "hourglass-mid", "Hourglass 2", "Time & weather", "countdown"],
  ["Alarm", "alarm", "Alarm", "Time & weather", "countdown"],
  ["CalendarBlank", "calendar", "Calendar", "Time & weather", "date"],
  ["CalendarCheck", "calendar-check", "Calendar check", "Time & weather", "date"],
  ["CalendarStar", "calendar-star", "Calendar star", "Time & weather", "event"],
  ["CalendarHeart", "calendar-heart", "Calendar heart", "Time & weather", "event"],
  ["Sun", "sun", "Sun", "Time & weather", "summer"],
  ["SunHorizon", "sunrise", "Sunrise", "Time & weather", "morning"],
  ["Moon", "moon", "Moon", "Time & weather", "night"],
  ["MoonStars", "moon-stars", "Moon + stars", "Time & weather", "night"],
  ["CloudSun", "cloud-sun", "Sun + cloud", "Time & weather", ""],
  ["CloudRain", "rain", "Rain", "Time & weather", "pnw"],
  ["CloudLightning", "storm", "Storm", "Time & weather", ""],
  ["Snowflake", "snowflake", "Snowflake", "Time & weather", "winter"],
  ["ThermometerHot", "hot", "Hot", "Time & weather", "summer"],
  ["ThermometerCold", "cold", "Cold", "Time & weather", "winter"],
  // Places & delivery
  ["MapPin", "map-pin", "Map pin", "Places & delivery", "location"],
  ["MapPinArea", "map-pin-area", "Map area", "Places & delivery", "location"],
  ["MapTrifold", "map", "Map", "Places & delivery", "location"],
  ["Compass", "compass", "Compass", "Places & delivery", "direction"],
  ["NavigationArrow", "navigation", "Navigation", "Places & delivery", "direction"],
  ["House", "house", "House", "Places & delivery", "home"],
  ["Buildings", "buildings", "Buildings", "Places & delivery", "city"],
  ["Door", "door", "Door", "Places & delivery", "open"],
  ["DoorOpen", "door-open", "Open door", "Places & delivery", "open"],
  ["Truck", "truck", "Delivery truck", "Places & delivery", "delivery"],
  ["Van", "van", "Van", "Places & delivery", "delivery"],
  ["Car", "car", "Car / pickup", "Places & delivery", "pickup curbside"],
  ["Moped", "moped", "Moped", "Places & delivery", "delivery"],
  ["Bicycle", "bicycle", "Bicycle", "Places & delivery", ""],
  ["Phone", "phone", "Phone", "Places & delivery", "call"],
  ["PhoneCall", "phone-call", "Phone call", "Places & delivery", "call"],
  ["ChatCircleDots", "chat", "Chat", "Places & delivery", "message"],
  ["ChatTeardropText", "chat-text", "Message", "Places & delivery", "sms text"],
  ["Envelope", "envelope", "Envelope", "Places & delivery", "email"],
  ["Globe", "globe", "Globe", "Places & delivery", "web"],
  // Music & fun
  ["MusicNotes", "music", "Music", "Music & fun", "song"],
  ["MusicNote", "music-note", "Music note", "Music & fun", "song"],
  ["Headphones", "headphones", "Headphones", "Music & fun", "music"],
  ["VinylRecord", "vinyl", "Record", "Music & fun", "music"],
  ["Guitar", "guitar", "Guitar", "Music & fun", "music"],
  ["Microphone", "microphone", "Microphone", "Music & fun", "live"],
  ["SpeakerHigh", "speaker", "Speaker", "Music & fun", "sound"],
  ["GameController", "game", "Game controller", "Music & fun", "gaming"],
  ["DiceFive", "dice", "Dice", "Music & fun", "game luck"],
  ["PuzzlePiece", "puzzle", "Puzzle", "Music & fun", ""],
  ["Palette", "palette", "Palette", "Music & fun", "art"],
  ["PaintBrush", "paint", "Paint brush", "Music & fun", "art"],
  ["Camera", "camera", "Camera", "Music & fun", "photo"],
  ["FilmStrip", "film", "Film", "Music & fun", "movie"],
  ["Television", "tv", "TV", "Music & fun", "watch"],
  ["Basketball", "basketball", "Basketball", "Music & fun", "sports"],
  ["PawPrint", "paw", "Paw print", "Music & fun", "pet dog"],
  ["Dog", "dog", "Dog", "Music & fun", "pet"],
  ["Cat", "cat", "Cat", "Music & fun", "pet"],
  ["Fish", "fish", "Fish", "Music & fun", ""],
  // Arrows & signs
  ["ArrowRight", "arrow-right", "Arrow right", "Arrows & signs", ""],
  ["ArrowUpRight", "arrow-up-right", "Arrow up-right", "Arrows & signs", ""],
  ["ArrowLeft", "arrow-left", "Arrow left", "Arrows & signs", ""],
  ["ArrowDown", "arrow-down", "Arrow down", "Arrows & signs", ""],
  ["ArrowUp", "arrow-up", "Arrow up", "Arrows & signs", ""],
  ["ArrowFatRight", "arrow-fat", "Fat arrow", "Arrows & signs", "point"],
  ["ArrowCircleRight", "arrow-circle", "Circle arrow", "Arrows & signs", ""],
  ["ArrowBendDownRight", "arrow-bend", "Bent arrow", "Arrows & signs", "point"],
  ["ArrowArcRight", "arrow-arc", "Curved arrow", "Arrows & signs", "point"],
  ["CaretDoubleRight", "chevrons", "Chevrons", "Arrows & signs", "more"],
  ["HandPointing", "hand-point", "Pointing hand", "Arrows & signs", "click"],
  ["HandTap", "tap", "Tap", "Arrows & signs", "click"],
  ["Check", "check", "Check mark", "Arrows & signs", "yes"],
  ["CheckCircle", "check-circle", "Check circle", "Arrows & signs", "yes"],
  ["CheckFat", "check-fat", "Bold check", "Arrows & signs", "yes"],
  ["Plus", "plus", "Plus", "Arrows & signs", "add"],
  ["PlusCircle", "plus-circle", "Plus circle", "Arrows & signs", "add"],
  ["X", "x", "X / close", "Arrows & signs", "no"],
  ["Info", "info", "Info", "Arrows & signs", ""],
  ["Question", "question", "Question", "Arrows & signs", "help"],
  ["Warning", "warning", "Warning", "Arrows & signs", "caution"],
  ["WarningCircle", "warning-circle", "Warning circle", "Arrows & signs", "caution"],
  ["Prohibit", "prohibit", "Prohibited", "Arrows & signs", "no 21"],
  ["CigaretteSlash", "no-smoking", "No smoking", "Arrows & signs", "rules"],
  ["Wheelchair", "accessible", "Accessible", "Arrows & signs", "ada"],
  ["Recycle", "recycle", "Recycle", "Arrows & signs", "eco"],
  ["Circle", "circle-icon", "Circle", "Arrows & signs", "dot"],
  ["Hexagon", "hexagon-icon", "Hexagon", "Arrows & signs", ""],
  ["Triangle", "triangle-icon", "Triangle", "Arrows & signs", ""],
  ["Cube", "cube", "Cube", "Arrows & signs", ""],
  // Social
  ["InstagramLogo", "instagram", "Instagram", "Social", "social"],
  ["FacebookLogo", "facebook", "Facebook", "Social", "social"],
  ["TiktokLogo", "tiktok", "TikTok", "Social", "social"],
  ["XLogo", "x-logo", "X (Twitter)", "Social", "social"],
  ["YoutubeLogo", "youtube", "YouTube", "Social", "social video"],
  ["SnapchatLogo", "snapchat", "Snapchat", "Social", "social"],
  ["SpotifyLogo", "spotify", "Spotify", "Social", "music playlist"],
  ["DiscordLogo", "discord", "Discord", "Social", "social"],
  ["GoogleLogo", "google", "Google", "Social", "review"],
  ["AppleLogo", "apple", "Apple", "Social", "app"],
];
const WEIGHTS = ["regular", "bold", "fill"] as const;

type Node = [string, Record<string, string | number>];

function walk(n: ReactNode, out: Node[]) {
  if (n === null || n === undefined || typeof n === "boolean") return;
  if (Array.isArray(n)) {
    for (const c of n) walk(c, out);
    return;
  }
  const el = n as ReactElement<{ children?: ReactNode } & Record<string, unknown>>;
  if (typeof el.type === "string") {
    const attrs: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(el.props)) {
      if (k === "children") continue;
      if (typeof v === "string" || typeof v === "number") attrs[k] = v;
    }
    out.push([el.type, attrs]);
    if (el.props.children) walk(el.props.children, out);
    return;
  }
  walk(el.props?.children, out);
}

async function main() {
  const data: Record<string, Record<string, string[]>> = {};
  const kept: (typeof ICONS)[number][] = [];
  for (const entry of ICONS) {
    const [name, id] = entry;
    const mod = (await import(pathToFileURL(path.resolve(__dirname, `../node_modules/@phosphor-icons/react/dist/defs/${name}.es.js`)).href)) as { default: Map<string, ReactNode> };
    const weights = mod.default;
    data[id] = {};
    for (const w of WEIGHTS) {
      const nodes: Node[] = [];
      walk(weights.get(w), nodes);
      if (!nodes.length) throw new Error(`${name}: no ${w} weight`);
      // Every curated icon is plain <path d> (checked here so a future icon can't sneak in other markup).
      for (const [tag, attrs] of nodes) {
        if (tag !== "path" || Object.keys(attrs).join() !== "d") throw new Error(`${name}/${w}: unexpected <${tag}> ${Object.keys(attrs)}`);
      }
      // R58: multi-path icons are joined into ONE path (each sub-path starts with M), so the
      // single-path banner element / button icon model keeps working.
      data[id][w] = [nodes.map(([, a]) => String(a.d)).join(" ")];
    }
    // Banner elements cap icon paths at ICON_PATH_MAX (4000) — drop icons that don't fit.
    if (Object.values(data[id]).some((p) => p[0].length > 4000)) {
      console.warn("skip (too detailed):", name);
      delete data[id];
      continue;
    }
    kept.push(entry);
  }
  const header = `/**
 * GENERATED by scripts/gen-banner-icons.tsx — do not edit by hand.
 * Icon artwork: Phosphor Icons (https://phosphoricons.com), MIT License,
 * Copyright (c) 2023 Phosphor Icons. viewBox 0 0 256 256, currentColor.
 * Admin-only: the Studio copies the chosen icon's paths INTO the banner design,
 * so the public site never loads this file or the icon library.
 */
`;
  const body = `export const BANNER_ICON_WEIGHTS = ${JSON.stringify(WEIGHTS)} as const;
export type BannerIconWeight = (typeof BANNER_ICON_WEIGHTS)[number];
export const BANNER_ICON_LIST: { id: string; label: string; cat: string; k?: string }[] = ${JSON.stringify(kept.map(([, id, label, cat, k]) => (k ? { id, label, cat, k } : { id, label, cat })))};
export const BANNER_ICON_CATS: string[] = ${JSON.stringify([...new Set(kept.map((e) => e[3]))])};
/** id → weight → SVG path "d" strings (viewBox 0 0 256 256). */
export const BANNER_ICON_DATA: Record<string, Record<BannerIconWeight, string[]>> = ${JSON.stringify(data)};
`;
  const out = path.resolve(__dirname, "../src/lib/cms/banner-icons-data.ts");
  writeFileSync(out, header + body);
  console.log("wrote", out, (header + body).length, "bytes");
}
main();
