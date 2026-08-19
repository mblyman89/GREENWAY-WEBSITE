/**
 * scripts/compliance/shoot-audit-hub.mjs   (slice books-12)
 *
 * Photograph the rendered harness pages so the agent can LOOK at them.
 *
 * Tailwind is pulled from the CDN by the harness HTML, so each page gets a
 * settling wait before the shutter -- a screenshot taken before the stylesheet
 * lands photographs unstyled HTML and would "prove" the design is broken when
 * it is fine.
 */
import { chromium } from "playwright";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), ".render");
const files = readdirSync(DIR).filter((f) => f.endsWith(".html")).sort();

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 1000 },
  deviceScaleFactor: 1,
});

for (const f of files) {
  await page.goto(`file://${join(DIR, f)}`, { waitUntil: "networkidle" });
  // Tailwind CDN compiles in the page; give it a beat to apply.
  await page.waitForTimeout(1400);
  const out = join(DIR, f.replace(/\.html$/, ".png"));
  await page.screenshot({ path: out, fullPage: true });
  console.log("shot", out);
}

await browser.close();
