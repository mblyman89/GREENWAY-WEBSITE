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
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), ".render");
const files = readdirSync(DIR).filter((f) => f.endsWith(".html")).sort();

/*
 * books-65: the pinned playwright package asks for a Chromium build number that
 * is not the one this sandbox has on disk, and `npx playwright install` is a
 * ~170MB download onto a volume that is 87% full. So: if the build playwright
 * wants is missing, USE THE ONE THAT IS THERE rather than failing.
 *
 * This is a fallback, not a default. When the expected build exists it is used
 * untouched, so nothing about how this script behaves on a normal machine
 * changes. And it is loud either way - a screenshot taken by a browser other
 * than the one the harness thinks it is using is exactly the kind of quiet
 * substitution that makes a photograph untrustworthy.
 */
function resolveExecutable() {
  const wanted = chromium.executablePath();
  if (existsSync(wanted)) return undefined; // let playwright do its normal thing
  const root = wanted.split("/chromium-")[0];
  if (!existsSync(root)) throw new Error(`no playwright browser cache at ${root}`);
  const alt = readdirSync(root)
    .filter((d) => d.startsWith("chromium-"))
    .map((d) => join(root, d, "chrome-linux64", "chrome"))
    .find((p) => existsSync(p));
  if (!alt) throw new Error(`playwright wants ${wanted}, and no other chromium build is present`);
  console.warn(`playwright wants ${wanted} (absent) -- falling back to ${alt}`);
  return alt;
}

const executablePath = resolveExecutable();
const browser = await chromium.launch(executablePath ? { executablePath } : {});
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
