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
].join(" ");
