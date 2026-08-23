/**
 * scripts/fetch-wa-authority-text.ts
 *
 * MIRROR THE WASHINGTON STATUTES SO RULE 35 CAN REACH THEM.
 *
 * The federal sibling of this script, `fetch-federal-authority-text.ts`, has
 * existed since books-19. Washington had no equivalent: the sixteen RCW and WAC
 * files already in `docs/authorities/state-wa/` were placed there by hand, one
 * slice at a time. That worked until it did not. books-45 needed three more
 * statutes and found nine quotes failing rule 24/35 with "the mapping is wrong
 * or the source was never fetched" - and there was no repeatable way to fetch.
 *
 * Hand-mirroring has a second cost that matters more than the effort: a file
 * placed by hand carries no record of WHERE it came from or WHEN, so nobody can
 * re-derive it or tell whether the legislature has amended it since. This
 * script writes that provenance into the file, in the exact five-line header
 * shape the existing sixteen already use, so the new files are indistinguishable
 * from the old ones and `verify-verbatim-quotes.ts` needs no special case.
 *
 * WHY MIRRORING IS LAWFUL HERE. These are edicts of government. Washington's
 * statutes are enacted law, and the Supreme Court held in Georgia v.
 * Public.Resource.Org, 590 U.S. 255 (2020) that works produced by legislators
 * in the course of their duties are not copyrightable. The same reasoning the
 * federal script records for the U.S. Code applies to the RCW.
 *
 * WHY THE OUTPUT IS COMMITTED RATHER THAN FETCHED AT VERIFY TIME. Identical to
 * the federal script's reasoning, and it is worth restating because it is the
 * whole point: a verifier that needs the network is a verifier that goes green
 * when the network is down. Standing rule 39 - a check that cannot fail is not
 * a check - and its corollary, a check that cannot RUN is worse, because it
 * fails open. The text lands on disk, gets committed, and is read offline.
 *
 * Run:  npx tsx scripts/fetch-wa-authority-text.ts
 *
 * Adding a statute is one line in TARGETS. The filename is DERIVED from the
 * cite by the same rule the verifier's router uses - chapter letter included -
 * so a target added here is automatically found there. See the long note on the
 * RCW branch in `verify-verbatim-quotes.ts` for why that letter is load-bearing.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The statutes to mirror, by RCW cite exactly as it appears in a citation
 * MINUS the subsection pinpoints. One mirrored file holds a whole section, so
 * "RCW 50A.10.030(7)(c)" and "RCW 50A.10.030(4)" both resolve to one target.
 */
const TARGETS: readonly string[] = [
  // books-45. The unemployment-tax no-deduction rule and its rounding
  // sentence. Quoted twice in the penalties teaching, and both quotes were
  // unverifiable until this slice: RCW 50.24.010 makes it UNLAWFUL for an
  // employer to deduct unemployment tax from a worker's pay. That is a rule
  // Greenway must never get wrong by accident, so its text is now on disk.
  "50.24.010",

  // books-45. The Employment Administration Fund surcharge - the separate
  // account-a and account-b deposits, plus 50.24.014(2)(a)'s own restatement
  // of the no-deduction rule. Three quotes, previously unverifiable.
  "50.24.014",

  // books-45. Paid Family and Medical Leave premiums. Four quotes, and these
  // were the ones being routed to a file for a DIFFERENT STATUTE entirely
  // because the router truncated "50A" to "50". This section carries the wage
  // cap, the small-employer exemption, the once-a-year size test, and - most
  // importantly for Greenway - subsection (7)(b), which makes the employer the
  // AGENT of its employees for the withheld premium and puts that money in
  // trust. Money held in trust is not the company's money.
  "50A.10.030",
];

/**
 * Route a bare RCW section number to its mirror filename.
 *
 * DELIBERATELY THE SAME RULE AS THE VERIFIER'S ROUTER, letter and all. If these
 * two ever disagree, this script writes files the verifier cannot find, which
 * is precisely the failure books-45 was opened to repair. A test asserts every
 * target here lands on a path the verifier actually asks for.
 */
export function waMirrorFilename(section: string): string {
  if (!/^\d+[A-Z]?(?:\.\d+)+$/.test(section)) {
    throw new Error(
      `REFUSING TO MIRROR "${section}": that is not a well-formed RCW section ` +
        `number. Expected digits, an optional CHAPTER LETTER, then dot-separated ` +
        `parts - for example 50.24.010 or 50A.10.030. Guessing a filename here ` +
        `would put the text somewhere the verifier never looks.`,
    );
  }
  return `rcw-${section}.txt`;
}

/** The official source URL for a section. Recorded in the file it produces. */
export function waSourceUrl(section: string): string {
  return `https://app.leg.wa.gov/RCW/default.aspx?cite=${section}`;
}

/**
 * Pull the statute text out of a leg.wa.gov section page.
 *
 * The page wraps the enacted text in `<div id='contentWrapper'>`, one `<div>`
 * per subsection, and puts the section number and caption in the `<h2>` above
 * it. Everything else on the page is site chrome - navigation, the search box,
 * the footer's copyright notice, which applies to the WEBSITE and not to the
 * statute.
 *
 * THIS FUNCTION IS EXPORTED AND PURE so it can be tested against a fixture
 * rather than against the live internet. A parser that can only be exercised by
 * hitting a government website is a parser that is never exercised.
 */
export function extractRcwText(html: string, section: string): string {
  const start = html.indexOf("id='contentWrapper'");
  if (start === -1) {
    throw new Error(
      `REFUSING TO WRITE A MIRROR FOR RCW ${section}: the page has no ` +
        `contentWrapper element, so the statute text could not be located. The ` +
        `site layout has probably changed. Fix this parser - do NOT write a ` +
        `partial file, because a truncated statute that LOOKS mirrored is worse ` +
        `than no mirror at all: every quote in the missing part would then fail ` +
        `verification and look like a bad quote rather than a bad fetch.`,
    );
  }

  // The caption lives in the last <h2> before the body.
  const head = html.slice(0, start);
  const h2s = [...head.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)];
  const caption = h2s.length > 0 ? stripTags(h2s[h2s.length - 1][1]) : "";

  const body = html.slice(start);
  const end = findWrapperEnd(body);
  const inner = body.slice(0, end);

  // Each subsection is its own div. Convert block boundaries to newlines BEFORE
  // stripping tags, or the subsections run together into one unreadable line -
  // and a quote spanning that seam would then never match.
  const withBreaks = inner
    .replace(/<\/div>/g, "\n")
    .replace(/<\/p>/g, "\n")
    .replace(/<br\s*\/?>/g, "\n");

  const text = stripTags(withBreaks)
    .split("\n")
    .map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter((l) => l.length > 0)
    .join("\n\n");

  if (text.length < 200) {
    throw new Error(
      `REFUSING TO WRITE A MIRROR FOR RCW ${section}: only ${text.length} ` +
        `characters of statute text were extracted, which is too short to be a ` +
        `real section. Rather than commit a stub that would silently fail every ` +
        `quote, this stops.`,
    );
  }

  return caption.length > 0 ? `RCW ${section}\n\n${caption}\n\n${text}` : `RCW ${section}\n\n${text}`;
}

/**
 * Walk nested divs to find where the content wrapper actually closes.
 *
 * `body` begins INSIDE the wrapper's opening tag (the caller slices at the
 * `id='contentWrapper'` attribute, not at the `<div` that precedes it), so the
 * wrapper itself is already open and depth starts at 1.
 *
 * THIS OFF-BY-ONE WAS A REAL BUG, caught by the length guard below rather than
 * by review. Every RCW section page opens its wrapper with two EMPTY sibling
 * divs - `<div></div><div></div>` - before the statute. Starting the walk at
 * depth 0 meant the first `</div>`, which closes the first empty sibling, drove
 * depth to -1... and the original `depth === 0` test fired on the SECOND one,
 * ending the slice before a single word of statute. RCW 50.24.010 extracted 41
 * characters and the script refused to write it.
 *
 * Worth recording why that refusal mattered: had this been written without the
 * 200-character floor, it would have produced three real-looking mirror files
 * containing nothing but the caption. The verifier would then have reported
 * nine BAD QUOTES - as if Michael's statutory text were wrong - when the fault
 * was entirely in this parser. A wrong answer wearing the costume of a right
 * one. Standing rule 12: never silently plug a hole.
 */
function findWrapperEnd(body: string): number {
  const tag = /<div\b|<\/div>/g;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(body)) !== null) {
    if (m[0] === "</div>") {
      depth--;
      if (depth === 0) return m.index;
    } else {
      depth++;
    }
  }
  return body.length;
}

/** Remove markup and decode the handful of entities the RCW pages actually use. */
function stripTags(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "\u2019")
    .replace(/&lsquo;/g, "\u2018")
    .replace(/&ldquo;/g, "\u201c")
    .replace(/&rdquo;/g, "\u201d")
    .replace(/&mdash;/g, "\u2014")
    .replace(/&ndash;/g, "\u2013");
}

/**
 * The five-line provenance header the existing sixteen mirrors already carry.
 * Kept byte-identical in shape so old and new files are indistinguishable.
 */
export function mirrorHeader(section: string, retrieved: string): string {
  return [
    `SOURCE TEXT - RCW ${section}`,
    `Retrieved ${retrieved} from ${waSourceUrl(section)}`,
    `Washington State law. Edicts of government are not copyrightable; see`,
    `Georgia v. Public.Resource.Org, 590 U.S. 255 (2020).`,
    `==============================================================================`,
    ``,
  ].join("\n");
}

async function main(): Promise<void> {
  const dir = join(process.cwd(), "docs", "authorities", "state-wa");
  mkdirSync(dir, { recursive: true });
  const retrieved = new Date().toISOString().slice(0, 10);

  for (const section of TARGETS) {
    const url = waSourceUrl(section);
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
    if (!res.ok) {
      throw new Error(`RCW ${section}: HTTP ${res.status} from ${url}. Not writing a partial mirror.`);
    }
    const body = extractRcwText(await res.text(), section);
    const file = join(dir, waMirrorFilename(section));
    writeFileSync(file, mirrorHeader(section, retrieved) + body + "\n", "utf8");
    console.log(`wrote ${waMirrorFilename(section)}  (${body.length} chars of statute text)`);
  }
}

if (process.argv[1] && process.argv[1].endsWith("fetch-wa-authority-text.ts")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
