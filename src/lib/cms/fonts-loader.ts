/**
 * src/lib/cms/fonts-loader.ts
 *
 * Loads every font in the library via next/font/google (self-hosted, no layout
 * shift, no runtime external request) and binds each to the CSS variable named
 * in fonts.ts. The root layout spreads `fontVariablesClassName` onto <html> so
 * all variables are available; the chosen heading/body fonts then point
 * --font-heading / --font-body at the right variable.
 *
 * next/font requires these loader calls to be module-scope with literal args,
 * which is why the full set is declared here rather than generated dynamically.
 */
import {
  Inter,
  Poppins,
  Montserrat,
  Oswald,
  Bebas_Neue,
  Anton,
  Playfair_Display,
  Merriweather,
  Roboto_Slab,
  JetBrains_Mono,
  Great_Vibes,
  Dancing_Script,
  Pacifico,
  Archivo_Black,
  Alfa_Slab_One,
  Abril_Fatface,
  Bungee,
  Bangers,
  Righteous,
  Rubik_Mono_One,
  Shrikhand,
  Lobster,
  Satisfy,
  Caveat,
  Permanent_Marker,
} from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  variable: "--gw-font-inter",
  display: "swap",
});
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--gw-font-poppins",
  display: "swap",
});
const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--gw-font-montserrat",
  display: "swap",
});
const oswald = Oswald({
  subsets: ["latin"],
  variable: "--gw-font-oswald",
  display: "swap",
});
const bebas = Bebas_Neue({
  subsets: ["latin"],
  weight: "400",
  variable: "--gw-font-bebas",
  display: "swap",
});
const anton = Anton({
  subsets: ["latin"],
  weight: "400",
  variable: "--gw-font-anton",
  display: "swap",
});
const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--gw-font-playfair",
  display: "swap",
});
const merriweather = Merriweather({
  subsets: ["latin"],
  weight: ["300", "400", "700", "900"],
  variable: "--gw-font-merriweather",
  display: "swap",
});
const robotoSlab = Roboto_Slab({
  subsets: ["latin"],
  variable: "--gw-font-roboto-slab",
  display: "swap",
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--gw-font-jetbrains",
  display: "swap",
});
// Script / cursive faces (SLICE 123) — used for special banner flourishes such
// as the loyalty hero subtitle ("Earn Points With Every Purchase").
const greatVibes = Great_Vibes({
  subsets: ["latin"],
  weight: "400",
  variable: "--gw-font-great-vibes",
  display: "swap",
});
const dancingScript = Dancing_Script({
  subsets: ["latin"],
  variable: "--gw-font-dancing-script",
  display: "swap",
});
const pacifico = Pacifico({
  subsets: ["latin"],
  weight: "400",
  variable: "--gw-font-pacifico",
  display: "swap",
});

// R55-S4: display / script faces for Banner Studio. preload:false = the font
// file is NOT preloaded on every page; the browser downloads it only when a
// banner (or the site heading picker) actually uses it. @font-face stays
// self-hosted and display:swap, so there's no layout-blocking request.
const archivoBlack = Archivo_Black({
  subsets: ["latin"],
  weight: "400",
  variable: "--gw-font-archivo-black",
  display: "swap",
  preload: false,
});
const alfaSlabOne = Alfa_Slab_One({
  subsets: ["latin"],
  weight: "400",
  variable: "--gw-font-alfa-slab-one",
  display: "swap",
  preload: false,
});
const abrilFatface = Abril_Fatface({
  subsets: ["latin"],
  weight: "400",
  variable: "--gw-font-abril-fatface",
  display: "swap",
  preload: false,
});
const bungee = Bungee({
  subsets: ["latin"],
  weight: "400",
  variable: "--gw-font-bungee",
  display: "swap",
  preload: false,
});
const bangers = Bangers({
  subsets: ["latin"],
  weight: "400",
  variable: "--gw-font-bangers",
  display: "swap",
  preload: false,
});
const righteous = Righteous({
  subsets: ["latin"],
  weight: "400",
  variable: "--gw-font-righteous",
  display: "swap",
  preload: false,
});
const rubikMonoOne = Rubik_Mono_One({
  subsets: ["latin"],
  weight: "400",
  variable: "--gw-font-rubik-mono-one",
  display: "swap",
  preload: false,
});
const shrikhand = Shrikhand({
  subsets: ["latin"],
  weight: "400",
  variable: "--gw-font-shrikhand",
  display: "swap",
  preload: false,
});
const lobster = Lobster({
  subsets: ["latin"],
  weight: "400",
  variable: "--gw-font-lobster",
  display: "swap",
  preload: false,
});
const satisfy = Satisfy({
  subsets: ["latin"],
  weight: "400",
  variable: "--gw-font-satisfy",
  display: "swap",
  preload: false,
});
const caveat = Caveat({
  subsets: ["latin"],
  variable: "--gw-font-caveat",
  display: "swap",
  preload: false,
});
const permanentMarker = Permanent_Marker({
  subsets: ["latin"],
  weight: "400",
  variable: "--gw-font-permanent-marker",
  display: "swap",
  preload: false,
});

/**
 * A single className string declaring every font CSS variable. Spread onto the
 * <html> element so any chosen font can be referenced site-wide.
 */
export const fontVariablesClassName = [
  inter.variable,
  poppins.variable,
  montserrat.variable,
  oswald.variable,
  bebas.variable,
  anton.variable,
  playfair.variable,
  merriweather.variable,
  robotoSlab.variable,
  jetbrains.variable,
  greatVibes.variable,
  dancingScript.variable,
  pacifico.variable,
  archivoBlack.variable,
  alfaSlabOne.variable,
  abrilFatface.variable,
  bungee.variable,
  bangers.variable,
  righteous.variable,
  rubikMonoOne.variable,
  shrikhand.variable,
  lobster.variable,
  satisfy.variable,
  caveat.variable,
  permanentMarker.variable,
].join(" ");
