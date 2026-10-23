/**
 * R74 S16 — structural check of a generated .xlsx, BEFORE anyone downloads it.
 *
 * Why: exceljs 4.4 silently wrote an EMPTY <conditionalFormatting/> on the count workbook's Scan
 * sheet (it has no "beginsWith" rule type). LibreOffice and the xlsx reader ignore that; Mac/Win
 * Excel do not — they open a "We found a problem with some content…" repair prompt and report
 * "Repaired Part: /xl/worksheets/sheet2.xml part with XML error". Nothing in our tests could see
 * it, because every reader we used was forgiving. This module is the strict reader.
 *
 * Pure: the caller unzips and hands over { partName: xmlText }. Returns a list of problems; an empty
 * list means "Excel's schema rules we know of are satisfied". The builder fails closed on any.
 *
 * Checked (each from ECMA-376 Part 1, §18.3.1.99 CT_Worksheet and §18.3.1.10/18.3.1.18):
 *   • every part is tag-balanced XML (no stray / unclosed element);
 *   • a worksheet's top-level children appear in schema order, and none repeats that may not;
 *   • every <conditionalFormatting> has a sqref and at least one <cfRule>;
 *   • every <cfRule> has a known type and a priority; formula-driven types carry a <formula>;
 *     "beginsWith"/"endsWith"/"containsText"/"notContainsText" carry text= and operator=;
 *     a dxfId points inside styles.xml <dxfs count>;
 *   • <dataValidations count> equals the number of <dataValidation> children, each with a sqref.
 */

/** CT_Worksheet sequence (ECMA-376 §18.3.1.99). Only conditionalFormatting / dataValidations… may
 *  legally appear once each here; conditionalFormatting is the one element allowed to repeat. */
export const WORKSHEET_CHILD_ORDER = [
  "sheetPr",
  "dimension",
  "sheetViews",
  "sheetFormatPr",
  "cols",
  "sheetData",
  "sheetCalcPr",
  "sheetProtection",
  "protectedRanges",
  "scenarios",
  "autoFilter",
  "sortState",
  "dataConsolidate",
  "customSheetViews",
  "mergeCells",
  "phoneticPr",
  "conditionalFormatting",
  "dataValidations",
  "hyperlinks",
  "printOptions",
  "pageMargins",
  "pageSetup",
  "headerFooter",
  "rowBreaks",
  "colBreaks",
  "customProperties",
  "cellWatches",
  "ignoredErrors",
  "smartTags",
  "drawing",
  "legacyDrawing",
  "legacyDrawingHF",
  "drawingHF",
  "picture",
  "oleObjects",
  "controls",
  "webPublishItems",
  "tableParts",
  "extLst",
] as const;

const REPEATABLE = new Set(["conditionalFormatting"]);

/** ST_CfType (§18.18.12). */
const CF_TYPES = new Set([
  "expression",
  "cellIs",
  "colorScale",
  "dataBar",
  "iconSet",
  "top10",
  "uniqueValues",
  "duplicateValues",
  "containsText",
  "notContainsText",
  "beginsWith",
  "endsWith",
  "containsBlanks",
  "notContainsBlanks",
  "containsErrors",
  "notContainsErrors",
  "timePeriod",
  "aboveAverage",
]);
/** Types Excel evaluates through a <formula> child — without one it rejects the part. */
const CF_NEEDS_FORMULA = new Set([
  "expression",
  "cellIs",
  "containsText",
  "notContainsText",
  "beginsWith",
  "endsWith",
  "containsBlanks",
  "notContainsBlanks",
  "containsErrors",
  "notContainsErrors",
  "timePeriod",
]);
const CF_NEEDS_TEXT = new Set(["containsText", "notContainsText", "beginsWith", "endsWith"]);

type Tag = { name: string; attrs: string; close: boolean; selfClose: boolean; depth: number; body: string };

function localName(qname: string): string {
  const i = qname.indexOf(":");
  return i >= 0 ? qname.slice(i + 1) : qname;
}

export function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(attrs);
  return m ? (m[2] ?? m[3] ?? "") : null;
}

/** Tokenise and balance-check. depth = depth of the element (root = 0). body = raw inner text for
 *  elements whose close tag directly follows text (used for <formula>). */
export function scanTags(xml: string): { tags: Tag[]; problem: string | null } {
  const tags: Tag[] = [];
  const stack: string[] = [];
  const re = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  // Strip prolog, comments, CDATA (none of ours use them, but never mis-read one as a tag).
  const src = xml.replace(/<\?[\s\S]*?\?>/g, (m) => " ".repeat(m.length)).replace(/<!--[\s\S]*?-->/g, (m) => " ".repeat(m.length));
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const between = src.slice(last, m.index);
    if (between.includes("<")) return { tags, problem: `stray "<" near offset ${last + between.indexOf("<")}` };
    last = re.lastIndex;
    const [, slash, qname, attrs, self] = m;
    const name = localName(qname);
    if (slash) {
      if (self) return { tags, problem: `malformed close tag </${qname}/>` };
      const open = stack.pop();
      if (open !== qname) return { tags, problem: `</${qname}> closes <${open ?? "nothing"}>` };
      tags.push({ name, attrs: "", close: true, selfClose: false, depth: stack.length, body: between });
    } else {
      tags.push({ name, attrs, close: false, selfClose: !!self, depth: stack.length, body: "" });
      if (!self) stack.push(qname);
    }
  }
  if (src.slice(last).includes("<")) return { tags, problem: `stray "<" near offset ${last + src.slice(last).indexOf("<")}` };
  if (stack.length) return { tags, problem: `<${stack[stack.length - 1]}> is never closed` };
  if (!tags.length) return { tags, problem: "no root element" };
  return { tags, problem: null };
}

function dxfCount(styles: string | undefined): number {
  if (!styles) return 0;
  const m = /<dxfs\b([^>]*)>/.exec(styles);
  if (!m) return 0;
  const c = attr(m[1], "count");
  return c !== null && /^\d+$/.test(c) ? Number(c) : 0;
}

/** Problems in one worksheet part. */
export function worksheetProblems(part: string, xml: string, dxfs: number): string[] {
  // sheetData is huge (thousands of rows) and has no schema-order hazards of its own beyond balance.
  const { tags, problem } = scanTags(xml);
  if (problem) return [`${part}: not well-formed XML (${problem})`];
  const out: string[] = [];
  const root = tags[0];
  if (root.name !== "worksheet") return [`${part}: root is <${root.name}>, not <worksheet>`];

  // ---- order of top-level children ----
  const seen: string[] = [];
  let lastIdx = -1;
  for (const t of tags) {
    if (t.close || t.depth !== 1) continue;
    const idx = (WORKSHEET_CHILD_ORDER as readonly string[]).indexOf(t.name);
    if (idx < 0) {
      out.push(`${part}: unknown worksheet element <${t.name}>`);
      continue;
    }
    if (idx < lastIdx) out.push(`${part}: <${t.name}> is out of schema order (after <${WORKSHEET_CHILD_ORDER[lastIdx]}>)`);
    if (idx === lastIdx && !REPEATABLE.has(t.name)) out.push(`${part}: <${t.name}> appears more than once`);
    lastIdx = Math.max(lastIdx, idx);
    seen.push(t.name);
  }
  if (!seen.includes("sheetData")) out.push(`${part}: missing <sheetData>`);

  // ---- conditional formatting ----
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    if (t.close || t.name !== "conditionalFormatting" || t.depth !== 1) continue;
    if (!attr(t.attrs, "sqref")) out.push(`${part}: <conditionalFormatting> has no sqref`);
    if (t.selfClose) {
      out.push(`${part}: <conditionalFormatting> is empty (no <cfRule>) — Excel rejects this`);
      continue;
    }
    let rules = 0;
    for (let j = i + 1; j < tags.length && !(tags[j].close && tags[j].depth === 1); j++) {
      const r = tags[j];
      if (r.close || r.name !== "cfRule" || r.depth !== 2) continue;
      rules++;
      const type = attr(r.attrs, "type");
      if (!type || !CF_TYPES.has(type)) out.push(`${part}: <cfRule> has unknown type "${type ?? ""}"`);
      const pr = attr(r.attrs, "priority");
      if (!pr || !/^[1-9]\d*$/.test(pr)) out.push(`${part}: <cfRule type="${type}"> has no valid priority`);
      const dxf = attr(r.attrs, "dxfId");
      if (dxf !== null && (!/^\d+$/.test(dxf) || Number(dxf) >= dxfs)) {
        out.push(`${part}: <cfRule type="${type}"> dxfId ${dxf} is outside styles.xml <dxfs count="${dxfs}">`);
      }
      // formula children (depth 3) until this cfRule closes
      let formulas = 0;
      let emptyFormula = false;
      if (!r.selfClose) {
        for (let k = j + 1; k < tags.length && !(tags[k].close && tags[k].name === "cfRule"); k++) {
          if (tags[k].close && tags[k].name === "formula") {
            formulas++;
            if (!tags[k].body.trim()) emptyFormula = true;
          }
        }
      }
      if (type && CF_NEEDS_FORMULA.has(type) && formulas === 0) out.push(`${part}: <cfRule type="${type}"> has no <formula>`);
      if (emptyFormula) out.push(`${part}: <cfRule type="${type}"> has an empty <formula>`);
      if (type && CF_NEEDS_TEXT.has(type)) {
        if (attr(r.attrs, "text") === null) out.push(`${part}: <cfRule type="${type}"> has no text=`);
        if (attr(r.attrs, "operator") === null) out.push(`${part}: <cfRule type="${type}"> has no operator=`);
      }
    }
    if (rules === 0) out.push(`${part}: <conditionalFormatting> is empty (no <cfRule>) — Excel rejects this`);
  }

  // ---- data validations ----
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    if (t.close || t.name !== "dataValidations" || t.depth !== 1) continue;
    let n = 0;
    for (let j = i + 1; j < tags.length && !(tags[j].close && tags[j].depth === 1); j++) {
      const d = tags[j];
      if (d.close || d.name !== "dataValidation" || d.depth !== 2) continue;
      n++;
      if (!attr(d.attrs, "sqref")) out.push(`${part}: <dataValidation> has no sqref`);
    }
    const c = attr(t.attrs, "count");
    if (c !== null && Number(c) !== n) out.push(`${part}: <dataValidations count="${c}"> but ${n} <dataValidation>`);
    if (n === 0) out.push(`${part}: <dataValidations> is empty`);
  }
  return out;
}

/** Every problem in a whole package. parts: { "xl/worksheets/sheet1.xml": xml, … } (no leading "/"). */
export function xlsxStructureProblems(parts: Record<string, string>): string[] {
  const out: string[] = [];
  const names = Object.keys(parts);
  if (!names.includes("xl/workbook.xml")) out.push("xl/workbook.xml is missing");
  if (!names.includes("[Content_Types].xml")) out.push("[Content_Types].xml is missing");
  const dxfs = dxfCount(parts["xl/styles.xml"]);
  for (const name of names.sort()) {
    if (!/\.(xml|rels)$/.test(name)) continue;
    if (/^xl\/worksheets\/[^/]+\.xml$/.test(name)) {
      out.push(...worksheetProblems(name, parts[name], dxfs));
    } else {
      const { problem } = scanTags(parts[name]);
      if (problem) out.push(`${name}: not well-formed XML (${problem})`);
    }
  }
  return out;
}

export function __runXlsxStructureCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, name: string, detail = "") => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`  \u2717 xlsx-structure-core: ${name} ${detail}`);
    }
  };
  const eq = (a: unknown, b: unknown, label: string) => ok(JSON.stringify(a) === JSON.stringify(b), label, `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
  const has = (list: string[], needle: string, label: string) => ok(list.some((p) => p.includes(needle)), label, `no "${needle}" in ${JSON.stringify(list)}`);
  const ws = (inner: string) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="x" xmlns:x14ac="y">${inner}</worksheet>`;
  const base = (mid: string) => ws(`<dimension ref="A1"/><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData><sheetProtection sheet="1"/>${mid}<pageMargins left="0.7"/>`);
  const goodCf = `<conditionalFormatting sqref="B2:B9"><cfRule type="expression" dxfId="0" priority="1"><formula>LEFT(B2,16)=&quot;NOT IN CULTIVERA&quot;</formula></cfRule></conditionalFormatting>`;

  // 1. clean sheet
  eq(worksheetProblems("s", base(goodCf), 1), [], "clean");
  // 2. THE bug: exceljs's empty element
  has(worksheetProblems("s", base(`<conditionalFormatting sqref="B2:B9"/>`), 1), "is empty (no <cfRule>)", "self-closed cf");
  // 3. open/close but no rule
  has(worksheetProblems("s", base(`<conditionalFormatting sqref="B2:B9"></conditionalFormatting>`), 1), "is empty (no <cfRule>)", "empty cf");
  // 4. order: cf before sheetProtection
  has(
    worksheetProblems("s", ws(`<sheetData/>${goodCf}<sheetProtection sheet="1"/>`), 1),
    "<sheetProtection> is out of schema order",
    "order",
  );
  // 5. repeat of a non-repeatable element
  has(worksheetProblems("s", ws(`<sheetData/><sheetData/>`), 0), "<sheetData> appears more than once", "repeat");
  // 6. cf may repeat
  eq(worksheetProblems("s", base(goodCf + goodCf), 1), [], "cf repeat ok");
  // 7. formula type without formula
  has(worksheetProblems("s", base(`<conditionalFormatting sqref="B2"><cfRule type="expression" priority="1"/></conditionalFormatting>`), 0), "has no <formula>", "no formula");
  // 8. empty formula
  has(
    worksheetProblems("s", base(`<conditionalFormatting sqref="B2"><cfRule type="expression" priority="1"><formula> </formula></cfRule></conditionalFormatting>`), 0),
    "empty <formula>",
    "empty formula",
  );
  // 9. beginsWith needs text + operator
  const bw = worksheetProblems("s", base(`<conditionalFormatting sqref="B2"><cfRule type="beginsWith" priority="1"><formula>1</formula></cfRule></conditionalFormatting>`), 0);
  has(bw, "has no text=", "bw text");
  has(bw, "has no operator=", "bw operator");
  // 10. a correct beginsWith is fine
  eq(
    worksheetProblems(
      "s",
      base(`<conditionalFormatting sqref="B2"><cfRule type="beginsWith" operator="beginsWith" text="X" priority="1"><formula>LEFT(B2,1)="X"</formula></cfRule></conditionalFormatting>`),
      0,
    ),
    [],
    "bw ok",
  );
  // 11. unknown type / missing priority
  has(worksheetProblems("s", base(`<conditionalFormatting sqref="B2"><cfRule type="startsWith" priority="1"/></conditionalFormatting>`), 0), 'unknown type "startsWith"', "type");
  has(worksheetProblems("s", base(`<conditionalFormatting sqref="B2"><cfRule type="expression"><formula>1</formula></cfRule></conditionalFormatting>`), 0), "no valid priority", "priority");
  // 12. dxfId outside dxfs
  has(worksheetProblems("s", base(goodCf), 0), "dxfId 0 is outside", "dxf");
  // 13. sqref missing
  has(worksheetProblems("s", base(`<conditionalFormatting><cfRule type="expression" priority="1"><formula>1</formula></cfRule></conditionalFormatting>`), 0), "has no sqref", "sqref");
  // 14. data validations count mismatch / ok
  const dv = (count: string) => `<dataValidations count="${count}"><dataValidation type="whole" sqref="B2:B9"><formula1>0</formula1></dataValidation></dataValidations>`;
  eq(worksheetProblems("s", base(dv("1")), 0), [], "dv ok");
  has(worksheetProblems("s", base(dv("2")), 0), 'count="2"> but 1', "dv count");
  // 15. not well-formed
  has(worksheetProblems("s", ws(`<sheetData><row></sheetData>`), 0), "not well-formed", "balance");
  has(worksheetProblems("s", `<worksheet><sheetData/>`, 0), "never closed", "unclosed");
  has(worksheetProblems("s", ws(`<sheetData><row r="1"></c></sheetData>`), 0), "</c> closes <row>", "mismatched close");
  // 16. unknown element / wrong root / missing sheetData
  has(worksheetProblems("s", ws(`<sheetData/><bogus/>`), 0), "unknown worksheet element <bogus>", "unknown");
  has(worksheetProblems("s", `<chartsheet/>`, 0), "not <worksheet>", "root");
  has(worksheetProblems("s", ws(`<dimension ref="A1"/>`), 0), "missing <sheetData>", "no sheetData");
  // 17. package level: styles dxfs count feeds the check; missing workbook flagged; bad non-sheet part flagged
  const pkg = {
    "[Content_Types].xml": "<Types/>",
    "xl/workbook.xml": "<workbook><sheets/></workbook>",
    "xl/styles.xml": `<styleSheet><dxfs count="1"><dxf/></dxfs></styleSheet>`,
    "xl/worksheets/sheet1.xml": base(goodCf),
  };
  eq(xlsxStructureProblems(pkg), [], "pkg ok");
  has(xlsxStructureProblems({ ...pkg, "xl/styles.xml": "<styleSheet/>" }), "dxfId 0 is outside", "pkg dxf");
  has(xlsxStructureProblems({ "[Content_Types].xml": "<Types/>" }), "xl/workbook.xml is missing", "pkg wb");
  has(xlsxStructureProblems({ ...pkg, "xl/sharedStrings.xml": "<sst><si></sst>" }), "xl/sharedStrings.xml: not well-formed", "pkg part");
  // 18. attr reader: quotes, absent, prefix-safe
  eq(attr(` type="expression" priority='2'`, "priority"), "2", "attr single");
  eq(attr(` xtype="a"`, "type"), null, "attr prefix");
  return { passed, failed };
}
