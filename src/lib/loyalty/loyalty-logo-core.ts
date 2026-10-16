/**
 * R64 — the logo at the top of the Loyalty signup form, owner-editable.
 *
 * One "richjson" content block (JSON in the plain text column, so no
 * migration) holds the picture, its size, a show/hide switch and alt text.
 * Blank / bad JSON resolves to the shipped look (black-and-gold logo, w-40 →
 * md:w-56), so nothing changes until the owner publishes.
 */
export const LOYALTY_LOGO_BLOCK = "loyalty.form.logo";

export const LOYALTY_LOGO_DEFAULT_SRC = "/brand/greenway-black-gold-logo-transparent.png";
export const LOYALTY_LOGO_DEFAULT_ALT = "Greenway Marijuana black and gold logo";

export type LoyaltyLogoSize = "sm" | "md" | "lg" | "xl";
export type LoyaltyLogo = { show: boolean; src: string; alt: string; size: LoyaltyLogoSize };

export const LOYALTY_LOGO_SIZES: { value: LoyaltyLogoSize; label: string; className: string }[] = [
  { value: "sm", label: "Small", className: "w-28 sm:w-32 md:w-40" },
  { value: "md", label: "Normal (default)", className: "w-40 sm:w-48 md:w-56" },
  { value: "lg", label: "Large", className: "w-52 sm:w-60 md:w-72" },
  { value: "xl", label: "Extra large", className: "w-60 sm:w-72 md:w-96" },
];

export function defaultLoyaltyLogo(): LoyaltyLogo {
  return { show: true, src: LOYALTY_LOGO_DEFAULT_SRC, alt: LOYALTY_LOGO_DEFAULT_ALT, size: "md" };
}

export function resolveLoyaltyLogo(raw: string | null | undefined): LoyaltyLogo {
  const d = defaultLoyaltyLogo();
  if (!raw || !raw.trim()) return d;
  try {
    const j = JSON.parse(raw) as Partial<LoyaltyLogo>;
    const src = typeof j.src === "string" && j.src.trim() ? j.src.trim() : d.src;
    return {
      show: j.show !== false,
      src: /^(\/|https:\/\/)/.test(src) ? src : d.src,
      alt: typeof j.alt === "string" && j.alt.trim() ? j.alt.trim().slice(0, 200) : d.alt,
      size: LOYALTY_LOGO_SIZES.some((s) => s.value === j.size) ? (j.size as LoyaltyLogoSize) : d.size,
    };
  } catch {
    return d;
  }
}

export function serializeLoyaltyLogo(l: LoyaltyLogo): string {
  return JSON.stringify(l);
}

export function loyaltyLogoClass(size: LoyaltyLogoSize): string {
  return (LOYALTY_LOGO_SIZES.find((s) => s.value === size) ?? LOYALTY_LOGO_SIZES[1]).className;
}

export function __runLoyaltyLogoCoreTests(): { passed: number } {
  let passed = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error("loyalty-logo-core: " + m);
    passed += 1;
  };
  const d = resolveLoyaltyLogo("");
  ok(d.show && d.src === LOYALTY_LOGO_DEFAULT_SRC && d.size === "md", "blank → shipped look");
  ok(loyaltyLogoClass("md") === "w-40 sm:w-48 md:w-56", "md = shipped sizes");
  ok(resolveLoyaltyLogo("{bad").src === LOYALTY_LOGO_DEFAULT_SRC, "bad json → default");
  const r = resolveLoyaltyLogo(JSON.stringify({ show: false, src: "javascript:x", size: "huge" }));
  ok(!r.show && r.src === LOYALTY_LOGO_DEFAULT_SRC && r.size === "md", "unsafe src / size rejected");
  const g = resolveLoyaltyLogo(serializeLoyaltyLogo({ show: true, src: "https://x.test/a.png", alt: "A", size: "xl" }));
  ok(g.src === "https://x.test/a.png" && g.size === "xl" && g.alt === "A", "round trip");
  return { passed };
}
