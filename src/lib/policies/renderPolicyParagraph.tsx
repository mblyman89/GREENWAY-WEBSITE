import type { ReactNode } from "react";
import Link from "next/link";

export type PolicyDocId = "privacy-policy" | "terms-of-use" | "consumer-health-data";

type LinkRule = {
  // The exact phrase to linkify (case-sensitive match against the source text).
  phrase: string;
  href: string;
  // When set, this rule is skipped on the page whose id matches (avoid self-links).
  skipOn?: PolicyDocId;
  external?: boolean;
};

// Order matters: longer / more specific phrases first so they win over shorter overlaps
// (e.g. "Consumer Health Data Privacy Policy" must be tried before "Privacy Policy").
const LINK_RULES: LinkRule[] = [
  { phrase: "Consumer Health Data Privacy Policy", href: "/consumer-health-data", skipOn: "consumer-health-data" },
  { phrase: "Consumer Health Data Policy", href: "/consumer-health-data", skipOn: "consumer-health-data" },
  { phrase: "Privacy Policy", href: "/privacy-policy", skipOn: "privacy-policy" },
  { phrase: "Terms of Use", href: "/terms-of-use", skipOn: "terms-of-use" },
  { phrase: "www.greenwaymarijuana.com/privacy-policy", href: "/privacy-policy", skipOn: "privacy-policy" },
  { phrase: "www.greenwaymarijuana.com/terms-of-use", href: "/terms-of-use", skipOn: "terms-of-use" },
  { phrase: "contact@greenwaymarijuana.com", href: "mailto:contact@greenwaymarijuana.com", external: true },
  { phrase: "www.atg.wa.gov/file-complaint", href: "https://www.atg.wa.gov/file-complaint", external: true },
];

const linkClass = "font-semibold text-[var(--greenway)] underline decoration-[var(--greenway)]/40 underline-offset-2 transition hover:text-[var(--orange)] hover:decoration-[var(--orange)]/60";

type Segment = { start: number; end: number; rule: LinkRule };

/**
 * Convert a plain policy paragraph into React nodes, turning known cross-references
 * (other policy docs, contact email, the WA AG complaint URL) into links.
 * Self-references (a phrase that points to the page you are already on) are left as plain text.
 */
export function renderPolicyParagraph(text: string, currentDoc: PolicyDocId, keyPrefix: string): ReactNode {
  const segments: Segment[] = [];

  for (const rule of LINK_RULES) {
    if (rule.skipOn === currentDoc) continue;
    let searchFrom = 0;
    while (true) {
      const idx = text.indexOf(rule.phrase, searchFrom);
      if (idx === -1) break;
      const start = idx;
      const end = idx + rule.phrase.length;
      // Skip if this span overlaps an already-claimed (longer/earlier) span.
      const overlaps = segments.some((s) => start < s.end && end > s.start);
      if (!overlaps) segments.push({ start, end, rule });
      searchFrom = end;
    }
  }

  if (segments.length === 0) return text;

  segments.sort((a, b) => a.start - b.start);

  const nodes: ReactNode[] = [];
  let cursor = 0;
  segments.forEach((seg, i) => {
    if (seg.start > cursor) nodes.push(text.slice(cursor, seg.start));
    const label = text.slice(seg.start, seg.end);
    if (seg.rule.external) {
      const isMail = seg.rule.href.startsWith("mailto:");
      nodes.push(
        <a
          key={`${keyPrefix}-l${i}`}
          href={seg.rule.href}
          className={linkClass}
          {...(isMail ? {} : { target: "_blank", rel: "noreferrer" })}
        >
          {label}
        </a>,
      );
    } else {
      nodes.push(
        <Link key={`${keyPrefix}-l${i}`} href={seg.rule.href} className={linkClass}>
          {label}
        </Link>,
      );
    }
    cursor = seg.end;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));

  return nodes;
}
