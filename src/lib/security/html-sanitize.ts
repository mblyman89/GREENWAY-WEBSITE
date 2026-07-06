/**
 * src/lib/security/html-sanitize.ts
 *
 * PURE allowlist HTML sanitizer for STAFF-AUTHORED rich content blocks
 * (GAP LOW / S-19: `SiteText` rendered staff HTML via dangerouslySetInnerHTML
 * with no sanitation). No dependencies, no DOM — a small tag/attribute
 * allowlist tokenizer, so it is safe in server components and testable in the
 * vitest harness.
 *
 * Threat model: content editors are trusted STAFF, but a pasted snippet (from
 * a website builder, an email, an AI draft) can smuggle <script>, event
 * handlers, or javascript: URLs. We strip anything not on the allowlist
 * rather than trying to "fix" it.
 *
 * Allowed: basic formatting + links. Everything else is dropped (tags
 * removed, their TEXT kept — except script/style/iframe-like containers whose
 * inner content is dropped entirely).
 */

const ALLOWED_TAGS = new Set([
  "a",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "p",
  "br",
  "ul",
  "ol",
  "li",
  "span",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "hr",
  "small",
  "sub",
  "sup",
]);

/** Tags whose inner content must be dropped entirely (not just the tags). */
const DROP_CONTENT_TAGS = new Set(["script", "style", "iframe", "object", "embed", "noscript"]);

/** Attributes allowed per tag ("*" = any allowed tag). */
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  "*": new Set(["class"]),
  a: new Set(["href", "title", "target", "rel", "class"]),
};

/** Only http(s), mailto, tel, and relative URLs may appear in href. */
function isSafeUrl(raw: string): boolean {
  const v = raw.trim().toLowerCase().replace(/[\s\u0000-\u001f]/g, "");
  if (v.startsWith("javascript:") || v.startsWith("data:") || v.startsWith("vbscript:")) {
    return false;
  }
  return true;
}

function sanitizeAttrs(tag: string, attrString: string): string {
  const allowed = ALLOWED_ATTRS[tag] ?? ALLOWED_ATTRS["*"];
  let out = "";
  // key="value" | key='value' | key=value | bare key
  const attrRe = /([a-zA-Z][a-zA-Z0-9-]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|[^\s>]+))?/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(attrString)) !== null) {
    const name = m[1].toLowerCase();
    if (name.startsWith("on")) continue; // event handlers never allowed
    if (!allowed.has(name)) continue;
    const rawVal = m[3] ?? m[4] ?? (m[2] && !m[2].startsWith('"') && !m[2].startsWith("'") ? m[2] : "");
    if (name === "href" && !isSafeUrl(rawVal)) continue;
    const escaped = rawVal.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    out += ` ${name}="${escaped}"`;
  }
  // External links get a safe rel.
  if (tag === "a" && / target="_blank"/.test(out) && !/ rel=/.test(out)) {
    out += ' rel="noopener noreferrer"';
  }
  return out;
}

/**
 * Sanitize staff-authored HTML to the formatting allowlist. Idempotent:
 * sanitize(sanitize(x)) === sanitize(x).
 */
export function sanitizeStaffHtml(html: string): string {
  if (!html) return "";
  let out = "";
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, lt);
    // Comments: drop entirely.
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    const gt = html.indexOf(">", lt + 1);
    if (gt === -1) {
      // Trailing unclosed "<" — escape it as text.
      out += "&lt;" + html.slice(lt + 1);
      break;
    }
    const rawTag = html.slice(lt + 1, gt);
    const isClosing = rawTag.startsWith("/");
    const nameMatch = /^\/?\s*([a-zA-Z][a-zA-Z0-9]*)/.exec(rawTag);
    if (!nameMatch) {
      // Not a real tag ("<3" etc.) — escape the bracket, keep the text.
      out += "&lt;" + html.slice(lt + 1, gt + 1);
      i = gt + 1;
      continue;
    }
    const tag = nameMatch[1].toLowerCase();

    if (DROP_CONTENT_TAGS.has(tag)) {
      if (!isClosing) {
        // Skip everything through the matching close tag (or to the end).
        const closeRe = new RegExp(`</\\s*${tag}\\s*>`, "i");
        closeRe.lastIndex = gt + 1;
        const rest = html.slice(gt + 1);
        const closeMatch = closeRe.exec(rest);
        i = closeMatch ? gt + 1 + closeMatch.index + closeMatch[0].length : n;
      } else {
        i = gt + 1;
      }
      continue;
    }

    if (!ALLOWED_TAGS.has(tag)) {
      // Drop the tag itself, keep flowing (its text content stays).
      i = gt + 1;
      continue;
    }

    if (isClosing) {
      out += `</${tag}>`;
    } else {
      const selfClosing = rawTag.endsWith("/") || tag === "br" || tag === "hr";
      const attrPart = rawTag.slice(nameMatch[0].length).replace(/\/\s*$/, "");
      out += `<${tag}${sanitizeAttrs(tag, attrPart)}${selfClosing ? " /" : ""}>`;
    }
    i = gt + 1;
  }
  return out;
}

/** Strip ALL tags and normalize whitespace — for text-content comparisons. */
export function htmlToText(html: string): string {
  return sanitizeStaffHtml(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}
