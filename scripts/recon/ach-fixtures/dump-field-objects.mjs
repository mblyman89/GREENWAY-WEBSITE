import { getDocumentProxy } from "unpdf";
import { readFileSync, writeFileSync } from "node:fs";
const [src, dst] = process.argv.slice(2);
const pdf = await getDocumentProxy(new Uint8Array(readFileSync(src)));
const o = await pdf.getFieldObjects();
const out = {};
for (const [k, arr] of Object.entries(o || {})) out[k] = arr.map((w) => ({ type: w.type, value: w.value ?? null, ...(w.exportValues ? { exportValues: w.exportValues } : {}) }));
writeFileSync(dst, JSON.stringify(out, null, 0));
console.log(dst, Object.keys(out).length);
