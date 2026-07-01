/**
 * src/lib/reports/zip.ts  (Slice 54)
 *
 * A tiny, dependency-free ZIP writer using the STORE (no compression) method.
 * Sufficient for bundling a handful of small CSV text files (e.g. a CCRS batch)
 * without adding a third-party dependency. Produces a standards-compliant ZIP
 * (local file headers + central directory + EOCD) that opens in Windows
 * Explorer, macOS, and 7-Zip.
 *
 * Pure (no I/O); returns a Buffer.
 */
import { Buffer } from "node:buffer";

type Entry = { name: string; data: Buffer; crc: number; offset: number };

/** Standard CRC-32 (IEEE 802.3), table-driven. */
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** DOS date/time from a JS Date (used in ZIP headers). */
function dosDateTime(d: Date): { time: number; date: number } {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((Math.floor(d.getSeconds() / 2)) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

export function buildZip(files: { name: string; content: string }[], now: Date = new Date()): Buffer {
  const { time, date } = dosDateTime(now);
  const localParts: Buffer[] = [];
  const entries: Entry[] = [];
  let offset = 0;

  for (const f of files) {
    const data = Buffer.from(f.content, "utf8");
    const nameBuf = Buffer.from(f.name, "utf8");
    const crc = crc32(data);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); // local file header signature
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0, 6); // flags
    header.writeUInt16LE(0, 8); // method: 0 = store
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18); // compressed size
    header.writeUInt32LE(data.length, 22); // uncompressed size
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28); // extra length

    localParts.push(header, nameBuf, data);
    entries.push({ name: f.name, data, crc, offset });
    offset += header.length + nameBuf.length + data.length;
  }

  const centralParts: Buffer[] = [];
  let centralSize = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); // central dir signature
    c.writeUInt16LE(20, 4); // version made by
    c.writeUInt16LE(20, 6); // version needed
    c.writeUInt16LE(0, 8); // flags
    c.writeUInt16LE(0, 10); // method
    c.writeUInt16LE(time, 12);
    c.writeUInt16LE(date, 14);
    c.writeUInt32LE(e.crc, 16);
    c.writeUInt32LE(e.data.length, 20);
    c.writeUInt32LE(e.data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt16LE(0, 30); // extra len
    c.writeUInt16LE(0, 32); // comment len
    c.writeUInt16LE(0, 34); // disk number
    c.writeUInt16LE(0, 36); // internal attrs
    c.writeUInt32LE(0, 38); // external attrs
    c.writeUInt32LE(e.offset, 42); // local header offset
    centralParts.push(c, nameBuf);
    centralSize += c.length + nameBuf.length;
  }

  const centralOffset = offset;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20); // comment len

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

// ---------------------------------------------------------------------------
// Self-test (tsx). Verifies CRC-32 and ZIP structure signatures.
// ---------------------------------------------------------------------------
export function __runZipTests(): void {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
  };
  // Known CRC-32 of "123456789" is 0xCBF43926.
  assert(crc32(Buffer.from("123456789")) === 0xcbf43926, "crc32 vector");

  const zip = buildZip([
    { name: "a.csv", content: "x,y\n1,2\n" },
    { name: "b.csv", content: "hello" },
  ]);
  assert(zip.readUInt32LE(0) === 0x04034b50, "local header sig");
  // EOCD signature is at the end.
  assert(zip.readUInt32LE(zip.length - 22) === 0x06054b50, "eocd sig");
  // Two entries recorded in EOCD.
  assert(zip.readUInt16LE(zip.length - 22 + 10) === 2, "entry count");
  console.log("zip: all tests passed");
}
