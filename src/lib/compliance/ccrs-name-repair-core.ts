/**
 * src/lib/compliance/ccrs-name-repair-core.ts — D252 S1 (pure).
 *
 * The examiner's exports (the 9/18 copy and the 11/13 + 11/17 delivery) were
 * written as UTF-8 and read back as Windows-1252, so every accented or
 * special character arrived garbled: "Pavé" became "PavÃ©", the no-break
 * space in "Diamond Dinger - Grand Salami" became "Â\u00a0", "Tiger's" with a
 * curly apostrophe became "Tigerâ€™s". The ledger stored those garbled names.
 *
 * CCRS itself holds the CLEAN name:
 *   - Production 2026-11-18, Strain file: "Blueberry Crème Brûlée" sent clean
 *     was refused "Duplicate Strain", so CCRS already holds it clean, while
 *     the 11/17 delivery lists it as "Blueberry CrÃ¨me BrÃ»lÃ©e".
 *   - Same night, Inventory file: the 7 Update rows that named the garbled
 *     Product name (and only those 7 of 3,065) were refused "Invalid
 *     Product"; CCRS joins Inventory.Product to Product.Name by exact text
 *     [G L0576] [G L0579].
 *
 * repairGarbledName undoes that one mistake and nothing else: it maps the text
 * back to Windows-1252 bytes and reads them as UTF-8. It returns the input
 * unchanged unless (a) it carries a garble marker (Ã, Â or â), (b) every
 * character maps to a Windows-1252 byte, and (c) the bytes are valid UTF-8.
 * A real "é" or "Ã" on its own fails (b) or (c) and is left alone.
 * Whether CCRS accepts the repaired Product names is U-84 (the first
 * production Inventory file that names one proves it).
 */
import type { LedgerEntry } from "./ccrs-ledger-core";

/** Windows-1252 0x80-0x9F: the code points that are not Latin-1. */
const CP1252_HIGH: ReadonlyMap<number, number> = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87],
  [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91],
  [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97], [0x02dc, 0x98],
  [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

const GARBLE_MARKER = /[\u00c3\u00c2\u00e2]/;

function toCp1252Bytes(s: string): Uint8Array | null {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) out.push(cp);
    else if (CP1252_HIGH.has(cp)) out.push(CP1252_HIGH.get(cp)!);
    // 0x81, 0x8D, 0x8F, 0x90, 0x9D are undefined in Windows-1252; a lenient
    // decoder passes them through as the same code point.
    else if (cp === 0x81 || cp === 0x8d || cp === 0x8f || cp === 0x90 || cp === 0x9d) out.push(cp);
    else return null;
  }
  return Uint8Array.from(out);
}

export function repairGarbledName(s: string): string {
  if (!s || !GARBLE_MARKER.test(s)) return s;
  const bytes = toCp1252Bytes(s);
  if (!bytes) return s;
  try {
    const fixed = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return fixed === s ? s : fixed;
  } catch {
    return s;
  }
}

/** True when repairGarbledName would change the text. */
export function isGarbledName(s: string): boolean {
  return repairGarbledName(s) !== s;
}

/**
 * D252 S1: the examiner's exports garbled every accented name (UTF-8 read as
 * Windows-1252), and the seed stored them that way, while CCRS holds the clean
 * text (production 2026-11-18: the 7 garbled Product names were refused
 * "Invalid Product"; the clean "Blueberry Crème Brûlée" was "Duplicate
 * Strain"). Product, Strain and Area names are repaired as they are loaded. A
 * Strain's id IS its name, so it is repaired too, unless the clean spelling is
 * already its own row (then the garbled row is left as it is).
 */
export function repairLedgerNames(rows: readonly LedgerEntry[]): LedgerEntry[] {
  const strainIds = new Set(rows.filter((r) => r.fileType === "Strain").map((r) => r.externalId));
  return rows.map((r) => {
    if (r.fileType !== "Product" && r.fileType !== "Strain" && r.fileType !== "Area") return r;
    const name = r.filedName == null ? null : repairGarbledName(r.filedName);
    let id = r.externalId;
    if (r.fileType === "Strain") {
      const fixed = repairGarbledName(id);
      if (fixed !== id && !strainIds.has(fixed)) id = fixed;
    }
    return name === r.filedName && id === r.externalId ? r : { ...r, externalId: id, filedName: name };
  });
}

export function __runCcrsNameRepairCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`[ccrs-name-repair-core] FAIL: ${m}`);
    }
  };
  // The 7 production names CCRS refused "Invalid Product" on 2026-11-18.
  ok(repairGarbledName("Fire Bros. - Pav\u00c3\u00a9 - 14g") === "Fire Bros. - Pav\u00e9 - 14g", "é");
  ok(repairGarbledName("Diamond Dinger -\u00c2\u00a0Grand Salami (S)") === "Diamond Dinger -\u00a0Grand Salami (S)", "no-break space");
  ok(repairGarbledName("Reserve PH\u00c3\u00b6 - 01g - Blue Lime Pie Badder") === "Reserve PH\u00f6 - 01g - Blue Lime Pie Badder", "ö");
  ok(repairGarbledName("Hightide: Live Rosin (73-159\u00c2\u00b5m) - Twin Peaks") === "Hightide: Live Rosin (73-159\u00b5m) - Twin Peaks", "µ");
  ok(
    repairGarbledName("Sitka Classic Special Press Hashish (H): Blueberry Cr\u00c3\u00a8me Br\u00c3\u00bbl\u00c3\u00a9e") ===
      "Sitka Classic Special Press Hashish (H): Blueberry Cr\u00e8me Br\u00fbl\u00e9e",
    "three accents",
  );
  // Windows-1252-only characters (curly apostrophe: e2 80 99).
  ok(repairGarbledName("Top shelf Cartridge Tiger\u00e2\u20ac\u2122s Blood") === "Top shelf Cartridge Tiger\u2019s Blood", "curly apostrophe");
  // Left alone.
  ok(repairGarbledName("Blue Dream - 3.5g") === "Blue Dream - 3.5g", "ASCII unchanged");
  ok(repairGarbledName("Blueberry Cr\u00e8me Br\u00fbl\u00e9e") === "Blueberry Cr\u00e8me Br\u00fbl\u00e9e", "clean accents unchanged");
  ok(repairGarbledName("\u00c3 la carte") === "\u00c3 la carte", "a lone Ã is not a garble (invalid UTF-8)");
  ok(repairGarbledName("Caf\u00e9 \u00e2 \u4e2d") === "Caf\u00e9 \u00e2 \u4e2d", "a character outside Windows-1252 leaves it alone");
  ok(repairGarbledName("") === "", "empty");
  ok(isGarbledName("Pav\u00c3\u00a9") && !isGarbledName("Pav\u00e9"), "isGarbledName");
  // Idempotent.
  const once = repairGarbledName("Pav\u00c3\u00a9");
  ok(repairGarbledName(once) === once, "repairing twice changes nothing");
  // repairLedgerNames: Product/Strain/Area names; a Strain's id is its name.
  const rows = repairLedgerNames([
    { fileType: "Product", externalId: "C1-110211000111497", filedName: "Fire Bros. - Pav\u00c3\u00a9 - 14g", state: "seed" },
    { fileType: "Strain", externalId: "Blueberry Cr\u00c3\u00a8me Br\u00c3\u00bbl\u00c3\u00a9e", filedName: "Blueberry Cr\u00c3\u00a8me Br\u00c3\u00bbl\u00c3\u00a9e", state: "seed" },
    { fileType: "Strain", externalId: "Pav\u00c3\u00a9", filedName: "Pav\u00c3\u00a9", state: "seed" },
    { fileType: "Strain", externalId: "Pav\u00e9", filedName: "Pav\u00e9", state: "filed" },
    { fileType: "Inventory", externalId: "X\u00c3\u00a9", filedName: null, state: "seed" },
  ]);
  ok(rows[0].filedName === "Fire Bros. - Pav\u00e9 - 14g" && rows[0].externalId === "C1-110211000111497", "product name repaired, id kept");
  ok(rows[1].externalId === "Blueberry Cr\u00e8me Br\u00fbl\u00e9e" && rows[1].filedName === rows[1].externalId, "strain id + name repaired");
  ok(rows[2].externalId === "Pav\u00c3\u00a9", "a strain whose clean spelling is its own row keeps its id");
  ok(rows[4].externalId === "X\u00c3\u00a9", "Inventory rows are never touched");
  return { passed, failed };
}
