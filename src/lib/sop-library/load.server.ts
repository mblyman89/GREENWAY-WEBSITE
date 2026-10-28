import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  SOP_CATALOG,
  metaForFile,
  sopCodeFromSlug,
  sopSlugFromFile,
  type SopCategoryId,
} from "./catalog-core";
import { blockText, parseBlocks, plainText, type Block } from "./markdown-core";

/**
 * Reads the SOP documents from `docs/sop/` (the single source of truth) and
 * parses them once per file version (mtime). The folder is shipped with the
 * server build via `outputFileTracingIncludes` in next.config.ts.
 */

export const SOP_DIR = join(process.cwd(), "docs", "sop");

export type SopSection = { id: string; level: 2 | 3; text: string };

export type SopDoc = {
  slug: string;
  code: string;
  file: string;
  title: string;
  shortTitle: string;
  category: SopCategoryId;
  audience: string[];
  summary: string;
  keywords: string[];
  version: string;
  status: string;
  verifiedAt: string;
  appliesTo: string;
  words: number;
  readMinutes: number;
  updatedAt: string;
  sections: SopSection[];
  blocks: Block[];
};

const cache = new Map<string, { mtimeMs: number; doc: SopDoc }>();

function headerValue(blocks: Block[], label: string): string {
  const table = blocks.find((b) => b.t === "table");
  if (!table || table.t !== "table") return "";
  for (const row of table.rows) {
    if (plainText(row[0] ?? []).trim().toLowerCase() === label.toLowerCase()) {
      return plainText(row[1] ?? []).trim();
    }
  }
  return "";
}

function parseDoc(file: string, src: string, mtimeMs: number): SopDoc | null {
  const slug = sopSlugFromFile(file);
  if (!slug) return null;
  const blocks = parseBlocks(src);
  const h1 = blocks.find((b) => b.t === "heading" && b.level === 1);
  const rawTitle = h1 && h1.t === "heading" ? h1.text : file;
  // "SOP-01 -- Register Operations: …" / "SOP-01 — …" -> "Register Operations: …"
  const title = rawTitle.replace(/^SOP-\d{2}[a-z]?\s*(?:--|—|–|-|:)\s*/i, "").trim();
  const meta = metaForFile(file);

  const versionRaw = headerValue(blocks, "Version");
  const vm = /^(\d+(?:\.\d+)*)\s*(?:\((.*)\))?/.exec(versionRaw);
  const version = vm?.[1] ?? "";
  const status = /draft/i.test(versionRaw) ? "Draft — pending owner approval" : versionRaw ? "Approved" : "";
  const verifiedRaw = headerValue(blocks, "Verified against");
  const verifiedAt = /main@([0-9a-f]{7,40})/i.exec(verifiedRaw)?.[1] ?? "";
  const appliesTo = headerValue(blocks, "Applies to");

  const sections: SopSection[] = [];
  let text = "";
  for (const b of blocks) {
    if (b.t === "heading" && (b.level === 2 || b.level === 3)) {
      sections.push({ id: b.id, level: b.level, text: b.text });
    }
    text += blockText(b) + "\n";
  }
  const words = (text.match(/\S+/g) ?? []).length;

  return {
    slug,
    code: sopCodeFromSlug(slug),
    file,
    title,
    shortTitle: meta?.shortTitle ?? title.split(":")[0],
    category: meta?.category ?? "other",
    audience: meta?.audience ?? [],
    summary: meta?.summary ?? "",
    keywords: meta?.keywords ?? [],
    version,
    status,
    verifiedAt,
    appliesTo,
    words,
    readMinutes: Math.max(1, Math.round(words / 230)),
    updatedAt: new Date(mtimeMs).toISOString(),
    sections,
    blocks,
  };
}

async function loadFile(file: string): Promise<SopDoc | null> {
  const full = join(SOP_DIR, file);
  try {
    const st = await stat(full);
    const hit = cache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs) return hit.doc;
    const src = await readFile(full, "utf8");
    const doc = parseDoc(file, src, st.mtimeMs);
    if (doc) cache.set(file, { mtimeMs: st.mtimeMs, doc });
    return doc;
  } catch {
    return null;
  }
}

/** Every SOP, in catalog order, then any uncatalogued SOP files by code. */
export async function listSops(): Promise<SopDoc[]> {
  let files: string[] = [];
  try {
    files = (await readdir(SOP_DIR)).filter((f) => sopSlugFromFile(f) !== null);
  } catch {
    return [];
  }
  const order = new Map(SOP_CATALOG.map((m, i) => [m.file, i]));
  files.sort((a, b) => {
    const ia = order.get(a) ?? 1000;
    const ib = order.get(b) ?? 1000;
    return ia !== ib ? ia - ib : a.localeCompare(b);
  });
  const docs = await Promise.all(files.map(loadFile));
  return docs.filter((d): d is SopDoc => d !== null);
}

export async function getSop(slug: string): Promise<SopDoc | null> {
  const all = await listSops();
  return all.find((d) => d.slug === slug.toLowerCase()) ?? null;
}

export type SearchHit = {
  slug: string;
  code: string;
  shortTitle: string;
  sectionId: string;
  sectionText: string;
  snippet: string;
};

/** Full-text search across every SOP; hits link to the nearest heading. */
export async function searchSops(query: string, limitPerSop = 4): Promise<{ total: number; hits: SearchHit[] }> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return { total: 0, hits: [] };
  const docs = await listSops();
  const hits: SearchHit[] = [];
  let total = 0;
  for (const d of docs) {
    let sectionId = "";
    let sectionText = d.shortTitle;
    let perSop = 0;
    const visit = (b: Block) => {
      if (b.t === "heading") {
        if (b.level >= 2) {
          sectionId = b.id;
          sectionText = b.text;
        }
      }
      const t = blockText(b);
      const at = t.toLowerCase().indexOf(q);
      if (at === -1) return;
      total++;
      if (perSop >= limitPerSop) return;
      perSop++;
      const from = Math.max(0, at - 70);
      const to = Math.min(t.length, at + q.length + 110);
      const snippet = (from > 0 ? "…" : "") + t.slice(from, to).replace(/\s+/g, " ").trim() + (to < t.length ? "…" : "");
      hits.push({ slug: d.slug, code: d.code, shortTitle: d.shortTitle, sectionId, sectionText, snippet });
    };
    for (const b of d.blocks) visit(b);
  }
  return { total, hits };
}
