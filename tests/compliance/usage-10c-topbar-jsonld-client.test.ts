import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("USAGE-10c — top bar and site JSON-LD render from client components", () => {
  it("the site JSON-LD is built in a client component from the hours input", () => {
    const ld = read("src/components/seo/SiteJsonLd.tsx");
    expect(ld.startsWith('"use client"')).toBe(true);
    expect(ld).toContain("organizationSchema(), websiteSchema(), storeSchema(hours, today)");
    const layout = read("src/app/(site)/layout.tsx");
    expect(layout).toContain("<SiteJsonLd hours={storeHours} today={storeToday} />");
    expect(layout).not.toContain("organizationSchema()");
  });
  it("the top bar markup is a client view; the server half keeps the draft-aware reads", () => {
    const view = read("src/components/site/SecondaryBarView.tsx");
    expect(view.startsWith('"use client"')).toBe(true);
    expect(view).toContain("tel:${greenwayBusiness.phone.tel}");
    const bar = read("src/components/site/SecondaryBar.tsx");
    expect(bar).not.toContain('"use client"');
    expect(bar).toContain("getContentValues");
    expect(bar).toContain("<SecondaryBarView");
  });
});
