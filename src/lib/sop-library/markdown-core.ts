/**
 * src/lib/sop-library/markdown-core.ts — SOP Library (owner request after SOP-08)
 *
 * A small, dependency-free Markdown parser for the SOP documents in
 * `docs/sop/*.md`. It turns text into a plain data tree (blocks + inline
 * tokens). The React renderer (`SopMarkdown.tsx`) turns that tree into
 * elements, so no HTML string is ever injected into the page
 * (no dangerouslySetInnerHTML): anything that looks like HTML in an SOP —
 * for example the placeholders `<name>` or `<date>` — is shown as text.
 *
 * Supported (everything the SOPs use, checked against all nine files):
 *   ATX headings (# … ######), paragraphs, ordered and unordered lists with
 *   nesting and multi-paragraph items, GitHub tables (with alignment),
 *   blockquotes (nested, containing lists), fenced code blocks, horizontal
 *   rules; inline `code`, **bold**, *italic*, [links](…) and backslash escapes.
 *
 * Pure module: no Node or React imports, so it is unit-testable anywhere.
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] };

export type Align = "left" | "center" | "right" | null;

export type Block =
  | { t: "heading"; level: number; id: string; text: string; c: Inline[] }
  | { t: "paragraph"; c: Inline[] }
  | { t: "list"; ordered: boolean; start: number; items: Block[][] }
  | { t: "table"; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { t: "quote"; c: Block[] }
  | { t: "code"; lang: string; v: string }
  | { t: "hr" };

// ---------------------------------------------------------------------------
// Slugs — the same rule the SOP program's anchor checker uses (GitHub style),
// so every in-document link like [§4.2](#42-where-everything-lives) resolves.
// ---------------------------------------------------------------------------

/** Heading text → anchor id: lower-case, drop punctuation, spaces → "-". */
export function slugify(text: string): string {
  return plainText(parseInline(text))
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\- ]/gu, "")
    .replace(/ /g, "-");
}

/** Make ids unique within one document the way GitHub does (-1, -2 …). */
export function makeSlugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text: string) => {
    const base = slugify(text) || "section";
    const n = seen.get(base);
    if (n === undefined) {
      seen.set(base, 0);
      return base;
    }
    seen.set(base, n + 1);
    return `${base}-${n + 1}`;
  };
}

// ---------------------------------------------------------------------------
// Inline parsing
// ---------------------------------------------------------------------------

const ESCAPABLE = "\\`*_{}[]()#+-.!|<>~";

/** Parse one line (or a joined paragraph) of inline Markdown. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", v: buf });
    buf = "";
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    // Backslash escape.
    if (ch === "\\" && i + 1 < src.length && ESCAPABLE.includes(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }

    // Code span: a run of N backticks closes with the same run.
    if (ch === "`") {
      let n = 1;
      while (src[i + n] === "`") n++;
      const fence = "`".repeat(n);
      const end = src.indexOf(fence, i + n);
      if (end !== -1) {
        flush();
        let v = src.slice(i + n, end);
        if (v.length > 1 && v.startsWith(" ") && v.endsWith(" ")) v = v.slice(1, -1);
        out.push({ t: "code", v });
        i = end + n;
        continue;
      }
      buf += fence;
      i += n;
      continue;
    }

    // Strong: **…**
    if (ch === "*" && src[i + 1] === "*") {
      const end = findClosing(src, i + 2, "**");
      if (end !== -1 && end > i + 2) {
        flush();
        out.push({ t: "strong", c: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

    // Emphasis: *…* (never _…_: SOPs quote identifiers like staff_id).
    if (ch === "*" && src[i + 1] !== "*" && src[i + 1] !== " " && src[i + 1] !== undefined) {
      const end = findClosing(src, i + 1, "*");
      if (end !== -1 && src[end - 1] !== " ") {
        flush();
        out.push({ t: "em", c: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }

    // Link: [text](href)
    if (ch === "[") {
      const close = findBracketClose(src, i);
      if (close !== -1 && src[close + 1] === "(") {
        const parenEnd = src.indexOf(")", close + 2);
        if (parenEnd !== -1) {
          const href = src.slice(close + 2, parenEnd).trim().split(/\s+/)[0] ?? "";
          flush();
          out.push({ t: "link", href, c: parseInline(src.slice(i + 1, close)) });
          i = parenEnd + 1;
          continue;
        }
      }
    }

    buf += ch;
    i++;
  }
  flush();
  return out;
}

/** Find `marker` from `from`, skipping code spans and escapes. -1 if none. */
function findClosing(src: string, from: number, marker: string): number {
  let i = from;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "`") {
      let n = 1;
      while (src[i + n] === "`") n++;
      const end = src.indexOf("`".repeat(n), i + n);
      if (end === -1) return -1;
      i = end + n;
      continue;
    }
    if (marker === "*") {
      // a single * must not be half of a **
      if (src.startsWith("**", i)) {
        const inner = findClosing(src, i + 2, "**");
        if (inner === -1) return -1;
        i = inner + 2;
        continue;
      }
      if (ch === "*") return i;
    } else if (src.startsWith(marker, i)) {
      return i;
    }
    i++;
  }
  return -1;
}

function findBracketClose(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Flatten inline tokens to plain text (for search, ids, titles). */
export function plainText(nodes: Inline[]): string {
  let s = "";
  for (const n of nodes) {
    if (n.t === "text" || n.t === "code") s += n.v;
    else s += plainText(n.c);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Block parsing
// ---------------------------------------------------------------------------

const RE_HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RE_FENCE = /^(\s*)(`{3,}|~{3,})\s*([\w-]*)\s*$/;
const RE_HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const RE_LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const RE_QUOTE = /^\s{0,3}>\s?(.*)$/;
const RE_TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function indentOf(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === " ") n++;
    else if (ch === "\t") n += 4;
    else break;
  }
  return n;
}

function stripIndent(line: string, n: number): string {
  let i = 0;
  let removed = 0;
  while (i < line.length && removed < n && (line[i] === " " || line[i] === "\t")) {
    removed += line[i] === "\t" ? 4 : 1;
    i++;
  }
  return line.slice(i);
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

function startsBlock(line: string): boolean {
  return (
    RE_HEADING.test(line) ||
    RE_FENCE.test(line) ||
    RE_HR.test(line) ||
    RE_LIST.test(line) ||
    RE_QUOTE.test(line) ||
    /^\s*\|/.test(line)
  );
}

/** Split a table row on unescaped pipes outside code spans. */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  let inCode = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "\\|";
      i++;
      continue;
    }
    if (ch === "`") {
      let n = 1;
      while (s[i + n] === "`") n++;
      if (inCode === 0) inCode = n;
      else if (inCode === n) inCode = 0;
      cur += "`".repeat(n);
      i += n - 1;
      continue;
    }
    if (ch === "|" && inCode === 0) {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function parseAlign(sep: string): Align[] {
  return splitRow(sep).map((c) => {
    const l = c.startsWith(":");
    const r = c.endsWith(":");
    return l && r ? "center" : r ? "right" : l ? "left" : null;
  });
}

/**
 * Parse a Markdown document (or a nested fragment) into blocks.
 * `slug` is shared across nested calls so heading ids stay unique.
 */
export function parseBlocks(src: string, slug: (t: string) => string = makeSlugger()): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) {
      i++;
      continue;
    }

    // Fenced code block.
    const fence = RE_FENCE.exec(line);
    if (fence) {
      const [, ind, marks, lang] = fence;
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const l = lines[i];
        const close = RE_FENCE.exec(l);
        if (close && close[2][0] === marks[0] && close[2].length >= marks.length && !close[3]) {
          i++;
          break;
        }
        body.push(stripIndent(l, ind.length));
        i++;
      }
      blocks.push({ t: "code", lang: lang ?? "", v: body.join("\n") });
      continue;
    }

    // Heading.
    const h = RE_HEADING.exec(line);
    if (h) {
      const text = h[2];
      const c = parseInline(text);
      blocks.push({ t: "heading", level: h[1].length, id: slug(text), text: plainText(c), c });
      i++;
      continue;
    }

    // Horizontal rule (checked before lists: "---" is not a list).
    if (RE_HR.test(line)) {
      blocks.push({ t: "hr" });
      i++;
      continue;
    }

    // Table: a header row followed by a separator row.
    if (/^\s*\|/.test(line) && i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1])) {
      const head = splitRow(line).map(parseInline);
      const align = parseAlign(lines[i + 1]);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const cells = splitRow(lines[i]).map(parseInline);
        while (cells.length < head.length) cells.push([]);
        rows.push(cells.slice(0, Math.max(head.length, 1)));
        i++;
      }
      blocks.push({ t: "table", align, head, rows });
      continue;
    }

    // Blockquote (recursive).
    if (RE_QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length) {
        const q = RE_QUOTE.exec(lines[i]);
        if (q) {
          inner.push(q[1]);
          i++;
        } else if (!isBlank(lines[i]) && inner.length && !isBlank(inner[inner.length - 1]) && !startsBlock(lines[i])) {
          inner.push(lines[i]); // lazy continuation
          i++;
        } else break;
      }
      blocks.push({ t: "quote", c: parseBlocks(inner.join("\n"), slug) });
      continue;
    }

    // List.
    const lm = RE_LIST.exec(line);
    if (lm) {
      const baseIndent = indentOf(line);
      const ordered = /\d/.test(lm[2]);
      const start = ordered ? parseInt(lm[2], 10) : 1;
      const items: Block[][] = [];
      while (i < lines.length) {
        const m = RE_LIST.exec(lines[i]);
        if (!m || indentOf(lines[i]) !== baseIndent || /\d/.test(m[2]) !== ordered) break;
        const contentIndent = baseIndent + m[2].length + 1;
        const itemLines: string[] = [m[3]];
        i++;
        while (i < lines.length) {
          const l = lines[i];
          if (isBlank(l)) {
            // A blank line continues the item only if the next non-blank line is indented into it.
            let j = i + 1;
            while (j < lines.length && isBlank(lines[j])) j++;
            if (j < lines.length && indentOf(lines[j]) > baseIndent) {
              for (let k = i; k < j; k++) itemLines.push("");
              i = j;
              continue;
            }
            break;
          }
          const ind = indentOf(l);
          const sibling = RE_LIST.test(l) && ind <= baseIndent;
          if (sibling) break;
          if (ind > baseIndent) {
            itemLines.push(stripIndent(l, Math.min(ind, contentIndent)));
            i++;
            continue;
          }
          // Lazy paragraph continuation (unindented text right after item text).
          if (!startsBlock(l) && itemLines.length && !isBlank(itemLines[itemLines.length - 1])) {
            itemLines.push(l.trim());
            i++;
            continue;
          }
          break;
        }
        items.push(parseBlocks(itemLines.join("\n"), slug));
      }
      blocks.push({ t: "list", ordered, start, items });
      continue;
    }

    // Paragraph: consecutive lines until a blank line or another block.
    const para: string[] = [line.trim()];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i])) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push({ t: "paragraph", c: parseInline(para.join(" ")) });
  }
  return blocks;
}

/** Plain text of a whole block subtree (for search and read-time). */
export function blockText(b: Block): string {
  switch (b.t) {
    case "heading":
      return b.text;
    case "paragraph":
      return plainText(b.c);
    case "list":
      return b.items.map((it) => it.map(blockText).join("\n")).join("\n");
    case "table":
      return [b.head, ...b.rows].map((r) => r.map(plainText).join(" · ")).join("\n");
    case "quote":
      return b.c.map(blockText).join("\n");
    case "code":
      return b.v;
    case "hr":
      return "";
  }
}
