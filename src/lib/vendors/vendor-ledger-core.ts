/**
 * src/lib/vendors/vendor-ledger-core.ts   (D246)
 *
 * PURE. The "vendor ledger": who REALLY sent us each product, read from the
 * paperwork, not from the vendor cards.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY (owner, D246)
 *
 * "lets use the manifests/ invoices as authoritative sources to first link
 * vendors to products, and use that data first to fill out their profiles."
 *
 * Every transfer manifest / invoice we were ever sent is archived in
 * cultivera_mail_docs (migration 0293). A parsed document carries the
 * SENDER's WSLCB license number, the sender's name as printed, and the
 * barcode of every package on it. A package barcode is our inventory lot's
 * lot_code. So for every lot that appears on paperwork we know, from the
 * state's own traceability record, which license shipped it.
 *
 * Measured on the live DB (2026-11-16): 2,575 lots appear on a parsed
 * document; 594 of them (23%) sit on a vendor card whose license is not the
 * document's. 462 of those are the same business under a second license
 * (WA producers/processors often hold two licenses under ONE UBI, e.g. a
 * producer and a processor license), 105 carry a license no card knows, and
 * 8 are on a genuinely different business.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE MODEL (industry-correct for Washington)
 *
 *   license number  -> the location/privilege that shipped (on the manifest)
 *   UBI (first 9)   -> the legal business (WA Secretary of State / DOR); one
 *                      UBI can hold several licenses
 *   vendor card     -> our record of one business. Extra licenses live on
 *                      archived "license cards" merged into it (0350), which
 *                      intake already follows (vendor-survivor-core).
 *
 * So the authority order is: the document's license, then the UBI that
 * license belongs to, then our card. Names are only a hint (a manifest's
 * printed name is often the legal entity, not the brand people know).
 *
 * This module never writes. It classifies; the review page (admin/vendors/
 * ledger) shows the proposals; a person confirms each one.
 */

// ── Inputs ──────────────────────────────────────────────────────────────────
export type LedgerDoc = {
  id: string;
  license: string | null;
  label: string | null;
  /** ISO date or timestamp of the transfer / email. */
  date: string | null;
  barcodes: readonly string[];
};

export type LedgerVendor = {
  id: string;
  display_name: string;
  dba: string | null;
  legal_name: string | null;
  license_number: string | null;
  vendor_number: string | null;
  merged_into_id: string | null;
  status: string | null;
  has_logo: boolean;
  product_count: number | null;
  phone: string | null;
  email: string | null;
  website: string | null;
};

export type LedgerLot = {
  id: string;
  lot_code: string | null;
  vendor_id: string | null;
  brand_id: string | null;
  status: string | null;
  on_hand_qty: number | null;
  product_name: string | null;
};

export type LedgerBrand = { id: string; vendor_id: string | null; display_name: string };

// ── Keys ────────────────────────────────────────────────────────────────────
/** WA license compare key: digits only, leading zeros dropped. null when unusable. */
export function licenseKey(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const d = raw.replace(/\D+/g, "").replace(/^0+/, "");
  return d.length >= 4 ? d : null;
}

/** The business part of a WA UBI: the first 9 digits (the rest is a branch/location suffix). */
export function ubi9(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const d = raw.replace(/\D+/g, "");
  return d.length >= 9 ? d.slice(0, 9) : null;
}

/** "Prime Choice Canna llc - 436793" -> "prime choice canna". Hint only. */
export function nameKey(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  return raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['\u2019\u2018]/g, "")
    .replace(/[-\u2013\u2014:|,(]\s*\d{5,}\)?\s*$/, " ")
    .replace(/\b(llc|l\.l\.c|inc|co|corp|corporation|company|ltd|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Follow merged_into_id to the live card (cycle-safe). */
export function survivorOf(id: string, byId: ReadonlyMap<string, LedgerVendor>): string {
  let cur = id;
  const seen = new Set<string>([cur]);
  for (let i = 0; i < 20; i += 1) {
    const next = byId.get(cur)?.merged_into_id;
    if (!next || seen.has(next) || !byId.has(next)) return cur;
    seen.add(next);
    cur = next;
  }
  return cur;
}

// ── The ledger ──────────────────────────────────────────────────────────────
export type LicenseEntry = {
  license: string;
  /** Printed sender names, most frequent first. */
  labels: { label: string; docs: number }[];
  docs: number;
  firstSeen: string | null;
  lastSeen: string | null;
  /** Every card (live or archived) carrying this license. */
  cardIds: string[];
  /** The live businesses those cards belong to. */
  survivorIds: string[];
  ubis: string[];
};

export type LotVerdictKind =
  | "ok" // the lot's business holds the document's license
  | "wrong_business" // a DIFFERENT live business holds the license
  | "split_business" // same UBI, but filed on a second live card (a merge job)
  | "unknown_license" // no card knows this license yet
  | "no_vendor" // the lot has no vendor; the license's holder is known
  | "conflict"; // the barcode is on paperwork from two licenses: hands off

export type LotVerdict = {
  lotId: string;
  lotCode: string;
  productName: string | null;
  live: boolean;
  kind: LotVerdictKind;
  license: string | null;
  docLabel: string | null;
  currentVendorId: string | null;
  /** The live business the paperwork says this lot belongs to (when one). */
  targetVendorId: string | null;
  /** unknown_license only: the doc's printed name matches the current card. */
  labelMatchesCurrent: boolean;
};

export type LedgerResult = {
  licenses: Map<string, LicenseEntry>;
  verdicts: LotVerdict[];
  counts: Record<LotVerdictKind, number> & { lotsOnPaperwork: number; liveOnPaperwork: number };
};

const isLive = (l: LedgerLot) => (l.status ?? "") === "active" && Number(l.on_hand_qty ?? 0) > 0;

function namesOf(v: LedgerVendor): string[] {
  return [v.display_name, v.dba, v.legal_name].map(nameKey).filter(Boolean);
}

export function buildVendorLedger(input: {
  docs: readonly LedgerDoc[];
  vendors: readonly LedgerVendor[];
  lots: readonly LedgerLot[];
}): LedgerResult {
  const byId = new Map(input.vendors.map((v) => [v.id, v]));

  // Names a live business answers to (its own + every archived card's).
  const survivorNames = new Map<string, Set<string>>();
  for (const v of input.vendors) {
    const s = survivorOf(v.id, byId);
    if (!survivorNames.has(s)) survivorNames.set(s, new Set());
    for (const n of namesOf(v)) survivorNames.get(s)!.add(n);
  }
  const survivorUbis = new Map<string, Set<string>>();
  for (const v of input.vendors) {
    const u = ubi9(v.vendor_number);
    if (!u) continue;
    const s = survivorOf(v.id, byId);
    if (!survivorUbis.has(s)) survivorUbis.set(s, new Set());
    survivorUbis.get(s)!.add(u);
  }

  // License -> cards.
  const cardsByLicense = new Map<string, string[]>();
  for (const v of input.vendors) {
    const k = licenseKey(v.license_number);
    if (!k) continue;
    if (!cardsByLicense.has(k)) cardsByLicense.set(k, []);
    cardsByLicense.get(k)!.push(v.id);
  }

  // Documents -> license entries and barcode -> licenses.
  const licenses = new Map<string, LicenseEntry>();
  const labelCounts = new Map<string, Map<string, number>>();
  const barcodeLicenses = new Map<string, Map<string, string | null>>(); // code -> license -> a label
  for (const d of input.docs) {
    const k = licenseKey(d.license);
    if (!k) continue;
    let e = licenses.get(k);
    if (!e) {
      const cardIds = cardsByLicense.get(k) ?? [];
      const survivors = [...new Set(cardIds.map((id) => survivorOf(id, byId)))];
      const ubis = [...new Set(cardIds.map((id) => ubi9(byId.get(id)?.vendor_number)).filter((u): u is string => !!u))];
      e = { license: k, labels: [], docs: 0, firstSeen: null, lastSeen: null, cardIds, survivorIds: survivors, ubis };
      licenses.set(k, e);
      labelCounts.set(k, new Map());
    }
    e.docs += 1;
    const date = (d.date ?? "").slice(0, 10) || null;
    if (date) {
      if (!e.firstSeen || date < e.firstSeen) e.firstSeen = date;
      if (!e.lastSeen || date > e.lastSeen) e.lastSeen = date;
    }
    const label = (d.label ?? "").replace(/\s+/g, " ").trim();
    if (label) {
      const m = labelCounts.get(k)!;
      m.set(label, (m.get(label) ?? 0) + 1);
    }
    for (const raw of d.barcodes) {
      const code = String(raw ?? "").trim();
      if (!code) continue;
      if (!barcodeLicenses.has(code)) barcodeLicenses.set(code, new Map());
      const m = barcodeLicenses.get(code)!;
      if (!m.has(k) || (!m.get(k) && label)) m.set(k, label || null);
    }
  }
  for (const [k, e] of licenses) {
    e.labels = [...(labelCounts.get(k) ?? new Map<string, number>()).entries()]
      .map(([label, docs]) => ({ label, docs }))
      .sort((a, b) => b.docs - a.docs || a.label.localeCompare(b.label));
  }

  const counts: LedgerResult["counts"] = {
    ok: 0,
    wrong_business: 0,
    split_business: 0,
    unknown_license: 0,
    no_vendor: 0,
    conflict: 0,
    lotsOnPaperwork: 0,
    liveOnPaperwork: 0,
  };
  const verdicts: LotVerdict[] = [];
  for (const lot of input.lots) {
    const code = (lot.lot_code ?? "").trim();
    if (!code) continue;
    const lic = barcodeLicenses.get(code);
    if (!lic || lic.size === 0) continue;
    counts.lotsOnPaperwork += 1;
    const live = isLive(lot);
    if (live) counts.liveOnPaperwork += 1;
    const cur = lot.vendor_id && byId.has(lot.vendor_id) ? survivorOf(lot.vendor_id, byId) : null;
    const base = {
      lotId: lot.id,
      lotCode: code,
      productName: lot.product_name,
      live,
      currentVendorId: cur,
    };
    if (lic.size > 1) {
      counts.conflict += 1;
      verdicts.push({ ...base, kind: "conflict", license: null, docLabel: null, targetVendorId: null, labelMatchesCurrent: false });
      continue;
    }
    const [[license, docLabel]] = [...lic.entries()];
    const holders = licenses.get(license)?.survivorIds ?? [];
    let kind: LotVerdictKind;
    let target: string | null = null;
    let labelMatchesCurrent = false;
    if (holders.length === 0) {
      kind = "unknown_license";
      const lk = nameKey(docLabel);
      labelMatchesCurrent = !!cur && !!lk && (survivorNames.get(cur)?.has(lk) ?? false);
      // Loose match: one name contains the other ("Prime Choice Canna" vs "PRIME CHOICE CANNA LLC").
      if (!labelMatchesCurrent && cur && lk.length >= 4) {
        for (const n of survivorNames.get(cur) ?? []) {
          if (n.length >= 4 && (n.includes(lk) || lk.includes(n))) {
            labelMatchesCurrent = true;
            break;
          }
        }
      }
      target = labelMatchesCurrent ? cur : null;
    } else if (cur && holders.includes(cur)) {
      kind = "ok";
      target = cur;
    } else if (!cur) {
      kind = holders.length === 1 ? "no_vendor" : "conflict";
      target = holders.length === 1 ? holders[0] : null;
    } else {
      const curUbis = survivorUbis.get(cur) ?? new Set<string>();
      const sameUbi = holders.some((h) => [...(survivorUbis.get(h) ?? [])].some((u) => curUbis.has(u)));
      if (sameUbi) {
        kind = "split_business";
        target = holders.length === 1 ? holders[0] : null;
      } else if (holders.length === 1) {
        kind = "wrong_business";
        target = holders[0];
      } else {
        kind = "conflict";
      }
    }
    counts[kind] += 1;
    verdicts.push({ ...base, kind, license, docLabel: docLabel ?? null, targetVendorId: target, labelMatchesCurrent });
  }
  return { licenses, verdicts, counts };
}

// ── Review groups ───────────────────────────────────────────────────────────
export type MoveGroup = {
  key: string;
  kind: "wrong_business" | "no_vendor";
  license: string;
  docLabel: string | null;
  fromVendorId: string | null;
  toVendorId: string;
  lotIds: string[];
  liveLots: number;
  sampleNames: string[];
};

/** Lots the paperwork says belong to a DIFFERENT business, grouped for one click each. */
export function moveGroups(verdicts: readonly LotVerdict[]): MoveGroup[] {
  const out = new Map<string, MoveGroup>();
  for (const v of verdicts) {
    if ((v.kind !== "wrong_business" && v.kind !== "no_vendor") || !v.targetVendorId || !v.license) continue;
    const key = `${v.kind}|${v.license}|${v.currentVendorId ?? ""}|${v.targetVendorId}`;
    let g = out.get(key);
    if (!g) {
      g = { key, kind: v.kind, license: v.license, docLabel: v.docLabel, fromVendorId: v.currentVendorId, toVendorId: v.targetVendorId, lotIds: [], liveLots: 0, sampleNames: [] };
      out.set(key, g);
    }
    g.lotIds.push(v.lotId);
    if (v.live) g.liveLots += 1;
    const n = (v.productName ?? "").trim();
    if (n && g.sampleNames.length < 3 && !g.sampleNames.includes(n)) g.sampleNames.push(n);
  }
  return [...out.values()].sort((a, b) => b.lotIds.length - a.lotIds.length || a.key.localeCompare(b.key));
}

export type UnknownLicenseGroup = {
  license: string;
  docLabel: string | null;
  docs: number;
  /** The single live card the lots sit on, when they all agree. */
  currentVendorId: string | null;
  labelMatchesCurrent: boolean;
  lotIds: string[];
  liveLots: number;
};

/** Licenses on our paperwork that no vendor card carries yet. */
export function unknownLicenseGroups(result: LedgerResult): UnknownLicenseGroup[] {
  const out = new Map<string, UnknownLicenseGroup & { vendors: Set<string | null>; allMatch: boolean }>();
  for (const v of result.verdicts) {
    if (v.kind !== "unknown_license" || !v.license) continue;
    let g = out.get(v.license);
    if (!g) {
      g = {
        license: v.license,
        docLabel: result.licenses.get(v.license)?.labels[0]?.label ?? v.docLabel,
        docs: result.licenses.get(v.license)?.docs ?? 0,
        currentVendorId: null,
        labelMatchesCurrent: false,
        lotIds: [],
        liveLots: 0,
        vendors: new Set(),
        allMatch: true,
      };
      out.set(v.license, g);
    }
    g.vendors.add(v.currentVendorId);
    g.allMatch = g.allMatch && v.labelMatchesCurrent;
    g.lotIds.push(v.lotId);
    if (v.live) g.liveLots += 1;
  }
  return [...out.values()]
    .map(({ vendors, allMatch, ...g }) => {
      const only = vendors.size === 1 ? [...vendors][0] : null;
      return { ...g, currentVendorId: only, labelMatchesCurrent: !!only && allMatch };
    })
    .sort((a, b) => b.lotIds.length - a.lotIds.length || a.license.localeCompare(b.license));
}

export type BusinessGroup = {
  /** "ubi:603358264" or "license:415930" */
  key: string;
  reason: "same_ubi" | "same_license";
  vendorIds: string[];
  /** The card we suggest keeping (logo > products > published > most complete). */
  suggestedSurvivorId: string;
  /** Lots on paperwork that are filed across these cards. */
  lotsOnPaperwork: number;
};

function keepScore(v: LedgerVendor): number {
  let s = 0;
  if (v.has_logo) s += 1000;
  s += Math.min(500, Math.max(0, Number(v.product_count ?? 0))) * 1;
  if (v.status === "published") s += 300;
  for (const f of [v.phone, v.email, v.website, v.legal_name, v.dba]) if ((f ?? "").trim()) s += 10;
  return s;
}

/**
 * Live cards that are one business: they share a UBI (first 9 digits), or the
 * same license sits on two live cards. These are merge jobs (the existing
 * merge tool keeps everything and archives the duplicate).
 */
export function businessGroups(vendors: readonly LedgerVendor[], result?: LedgerResult): BusinessGroup[] {
  const live = vendors.filter((v) => !v.merged_into_id);
  const groups: BusinessGroup[] = [];
  const seenPairs = new Set<string>();
  const push = (key: string, reason: BusinessGroup["reason"], ids: string[]) => {
    const uniq = [...new Set(ids)].sort();
    if (uniq.length < 2) return;
    const sig = uniq.join(",");
    if (seenPairs.has(sig)) return;
    seenPairs.add(sig);
    const cards = uniq.map((id) => live.find((v) => v.id === id)!).filter(Boolean);
    const survivor = [...cards].sort((a, b) => keepScore(b) - keepScore(a) || a.display_name.localeCompare(b.display_name))[0];
    const lotsOnPaperwork = result
      ? result.verdicts.filter((x) => (x.currentVendorId && uniq.includes(x.currentVendorId)) || (x.targetVendorId && uniq.includes(x.targetVendorId))).length
      : 0;
    groups.push({ key, reason, vendorIds: uniq, suggestedSurvivorId: survivor.id, lotsOnPaperwork });
  };
  const byUbi = new Map<string, string[]>();
  for (const v of live) {
    const u = ubi9(v.vendor_number);
    if (!u) continue;
    if (!byUbi.has(u)) byUbi.set(u, []);
    byUbi.get(u)!.push(v.id);
  }
  for (const [u, ids] of byUbi) push(`ubi:${u}`, "same_ubi", ids);
  const byLic = new Map<string, string[]>();
  for (const v of live) {
    const k = licenseKey(v.license_number);
    if (!k) continue;
    if (!byLic.has(k)) byLic.set(k, []);
    byLic.get(k)!.push(v.id);
  }
  for (const [k, ids] of byLic) push(`license:${k}`, "same_license", ids);
  return groups.sort((a, b) => b.lotsOnPaperwork - a.lotsOnPaperwork || b.vendorIds.length - a.vendorIds.length || a.key.localeCompare(b.key));
}

export type BrandFill = { vendorId: string; brandId: string; brandName: string; lotIds: string[]; liveLots: number };

/**
 * Lots with no brand whose (paperwork-confirmed) business has exactly ONE
 * brand on file. A proposal only: a distributor can carry other brands, so a
 * person confirms each vendor's batch.
 */
export function brandFills(input: { lots: readonly LedgerLot[]; brands: readonly LedgerBrand[]; vendors: readonly LedgerVendor[]; result: LedgerResult }): BrandFill[] {
  const byId = new Map(input.vendors.map((v) => [v.id, v]));
  const brandsBySurvivor = new Map<string, LedgerBrand[]>();
  for (const b of input.brands) {
    if (!b.vendor_id || !byId.has(b.vendor_id)) continue;
    const s = survivorOf(b.vendor_id, byId);
    if (!brandsBySurvivor.has(s)) brandsBySurvivor.set(s, []);
    brandsBySurvivor.get(s)!.push(b);
  }
  const okLots = new Set(input.result.verdicts.filter((v) => v.kind === "ok").map((v) => v.lotId));
  const out = new Map<string, BrandFill>();
  for (const l of input.lots) {
    if (l.brand_id || !l.vendor_id || !okLots.has(l.id) || !byId.has(l.vendor_id)) continue;
    const s = survivorOf(l.vendor_id, byId);
    const bs = brandsBySurvivor.get(s) ?? [];
    if (bs.length !== 1) continue;
    let f = out.get(s);
    if (!f) {
      f = { vendorId: s, brandId: bs[0].id, brandName: bs[0].display_name, lotIds: [], liveLots: 0 };
      out.set(s, f);
    }
    f.lotIds.push(l.id);
    if (isLive(l)) f.liveLots += 1;
  }
  return [...out.values()].sort((a, b) => b.lotIds.length - a.lotIds.length);
}

/**
 * What the paperwork says about ONE live business, for its vendor page:
 * every license its cards hold or its lots shipped under, how often, and
 * whether the card's own license was ever seen on a document.
 */
export type VendorPaperworkFacts = {
  licenses: { license: string; docs: number; lastSeen: string | null; onCard: boolean; labels: string[] }[];
  ubis: string[];
  cardLicenseSeenOnPaperwork: boolean | null;
  lots: Record<LotVerdictKind, number>;
};

export function vendorPaperworkFacts(vendorId: string, vendors: readonly LedgerVendor[], result: LedgerResult): VendorPaperworkFacts {
  const byId = new Map(vendors.map((v) => [v.id, v]));
  const survivor = byId.has(vendorId) ? survivorOf(vendorId, byId) : vendorId;
  const cards = vendors.filter((v) => survivorOf(v.id, byId) === survivor);
  const cardLics = new Set(cards.map((c) => licenseKey(c.license_number)).filter((k): k is string => !!k));
  const lics = new Set<string>(cardLics);
  const lots: Record<LotVerdictKind, number> = { ok: 0, wrong_business: 0, split_business: 0, unknown_license: 0, no_vendor: 0, conflict: 0 };
  for (const v of result.verdicts) {
    if (v.currentVendorId !== survivor && v.targetVendorId !== survivor) continue;
    if (v.currentVendorId === survivor) lots[v.kind] += 1;
    if (v.license && (v.currentVendorId === survivor || v.targetVendorId === survivor)) lics.add(v.license);
  }
  const rows = [...lics].map((k) => {
    const e = result.licenses.get(k);
    return { license: k, docs: e?.docs ?? 0, lastSeen: e?.lastSeen ?? null, onCard: cardLics.has(k), labels: (e?.labels ?? []).slice(0, 3).map((l) => l.label) };
  });
  rows.sort((a, b) => b.docs - a.docs || a.license.localeCompare(b.license));
  const own = licenseKey(byId.get(survivor)?.license_number);
  return {
    licenses: rows,
    ubis: [...new Set(cards.map((c) => ubi9(c.vendor_number)).filter((u): u is string => !!u))],
    cardLicenseSeenOnPaperwork: own ? (result.licenses.get(own)?.docs ?? 0) > 0 : null,
    lots,
  };
}

// ---------------------------------------------------------------------------
// self-tests (pure) — registered in scripts/compliance/run-pure-selftests.ts
// ---------------------------------------------------------------------------
export function __runVendorLedgerTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL vendor-ledger-core: " + msg);
    passed += 1;
  };
  const V = (p: Partial<LedgerVendor> & { id: string; display_name: string }): LedgerVendor => ({
    dba: null,
    legal_name: null,
    license_number: null,
    vendor_number: null,
    merged_into_id: null,
    status: "draft",
    has_logo: false,
    product_count: 0,
    phone: null,
    email: null,
    website: null,
    ...p,
  });
  const L = (id: string, code: string, vendor: string | null, live = true): LedgerLot => ({
    id,
    lot_code: code,
    vendor_id: vendor,
    brand_id: null,
    status: live ? "active" : "sold_out",
    on_hand_qty: live ? 3 : 0,
    product_name: `P ${id}`,
  });

  // Keys.
  ok(licenseKey("417-068") === "417068", "license digits");
  ok(licenseKey("078256") === "78256" && licenseKey("78256") === "78256", "leading zero tolerant");
  ok(licenseKey("12") === null && licenseKey(null) === null, "unusable license");
  ok(ubi9("6034832020010004") === "603483202" && ubi9("603483202") === "603483202", "ubi first 9");
  ok(ubi9("1234") === null, "short ubi null");
  ok(nameKey("Prime Choice Canna llc - 436793") === "prime choice canna", "name key strips llc + license");
  ok(nameKey("Harmony Farms \u2013 447685") === "harmony farms", "en dash license stripped");

  const vendors: LedgerVendor[] = [
    V({ id: "fire", display_name: "Fire Bros.", license_number: "425450", vendor_number: "603483202", has_logo: true, status: "published" }),
    V({ id: "fire2", display_name: "Fire Bros.", license_number: "436479", vendor_number: "6034832020010004", merged_into_id: "fire", status: "archived" }),
    V({ id: "buddies", display_name: "Buddies", license_number: "415930", vendor_number: "603358264", has_logo: true }),
    V({ id: "botan", display_name: "BOTANICAL ARTS", license_number: "431389", vendor_number: "603358264" }),
    V({ id: "home", display_name: "HOMETOWN HERBS", license_number: "999001", vendor_number: "111111111" }),
    V({ id: "peoples", display_name: "The Peoples Indoor Gardens", license_number: "416010", vendor_number: "222222222" }),
    V({ id: "prime", display_name: "PRIME CHOICE CANNA LLC", license_number: "432651", vendor_number: "604280782" }),
    V({ id: "twok", display_name: "2K Gardens" }),
  ];
  const docs: LedgerDoc[] = [
    { id: "d1", license: "436479", label: "FIRE BROS LLC", date: "2026-05-01", barcodes: ["A1", "A2"] },
    { id: "d2", license: "425450", label: "Fire Bros", date: "2026-06-01T10:00:00Z", barcodes: ["A3"] },
    { id: "d3", license: "431389", label: "BOTANICAL ARTS", date: "2026-04-01", barcodes: ["B1"] },
    { id: "d4", license: "416010", label: "SOUTH BAY MASTER GROWERS", date: "2026-03-01", barcodes: ["H1", "H2"] },
    { id: "d5", license: "436793", label: "Prime Choice Canna llc - 436793", date: "2026-02-01", barcodes: ["P1"] },
    { id: "d6", license: "436709", label: "2K Gardens", date: "2026-02-02", barcodes: ["K1"] },
    { id: "d7", license: "999001", label: "HOMETOWN", date: "2026-01-01", barcodes: ["X1"] },
    { id: "d8", license: "416010", label: "SOUTH BAY", date: "2026-01-05", barcodes: ["X1"] },
    { id: "d9", license: "416010", label: "", date: null, barcodes: ["N1"] },
    { id: "d10", license: null, label: "no license", date: null, barcodes: ["A1"] },
  ];
  const lots: LedgerLot[] = [
    L("l1", "A1", "fire"),
    L("l2", "A2", "fire2"), // on the archived license card -> survivor fire -> ok
    L("l3", "A3", "fire", false),
    L("l4", "B1", "buddies"), // same UBI, BOTANICAL ARTS live card holds license -> split
    L("l5", "H1", "home"), // wrong business
    L("l6", "H2", "home", false),
    L("l7", "P1", "prime"), // unknown license, label matches current
    L("l8", "K1", "twok"), // unknown license, label matches (no license on card)
    L("l9", "X1", "home"), // conflict
    L("l10", "N1", null), // no vendor
    L("l11", "ZZ", "home"), // not on paperwork
    { ...L("l12", "", "home") },
  ];
  const r = buildVendorLedger({ docs, vendors, lots });
  const k = (id: string) => r.verdicts.find((v) => v.lotId === id)?.kind;
  ok(k("l1") === "ok" && k("l2") === "ok" && k("l3") === "ok", "same business via archived license card is ok");
  ok(k("l4") === "split_business", "same UBI on a second live card is a split");
  ok(k("l5") === "wrong_business" && r.verdicts.find((v) => v.lotId === "l5")?.targetVendorId === "peoples", "wrong business -> license holder");
  ok(k("l7") === "unknown_license" && r.verdicts.find((v) => v.lotId === "l7")?.labelMatchesCurrent === true, "unknown license, label matches card");
  ok(k("l8") === "unknown_license" && r.verdicts.find((v) => v.lotId === "l8")?.targetVendorId === "twok", "2K Gardens matches");
  ok(k("l9") === "conflict", "two licenses on one barcode -> conflict");
  ok(k("l10") === "no_vendor" && r.verdicts.find((v) => v.lotId === "l10")?.targetVendorId === "peoples", "no vendor -> holder");
  ok(!r.verdicts.some((v) => v.lotId === "l11" || v.lotId === "l12"), "lots not on paperwork skipped");
  ok(r.counts.lotsOnPaperwork === 10 && r.counts.liveOnPaperwork === 8, `counts ${r.counts.lotsOnPaperwork}/${r.counts.liveOnPaperwork}`);
  const fireLic = r.licenses.get("436479")!;
  ok(fireLic.survivorIds.join() === "fire" && fireLic.ubis.join() === "603483202", "license entry -> survivor + ubi");
  const south = r.licenses.get("416010")!;
  ok(south.docs === 3 && south.labels[0].docs === 1 && south.firstSeen === "2026-01-05" && south.lastSeen === "2026-03-01", "license dates + labels");
  ok(!r.licenses.has(""), "no-license doc ignored");

  // Groups.
  const mg = moveGroups(r.verdicts);
  ok(mg.length === 2, `two move groups (${mg.length})`);
  const wrong = mg.find((g) => g.kind === "wrong_business")!;
  ok(wrong.lotIds.length === 2 && wrong.liveLots === 1 && wrong.fromVendorId === "home" && wrong.toVendorId === "peoples", "wrong-business group");
  const ug = unknownLicenseGroups(r);
  ok(ug.length === 2 && ug.every((g) => g.labelMatchesCurrent), "unknown license groups");
  ok(ug.find((g) => g.license === "436793")?.currentVendorId === "prime", "unknown -> current card");

  const bg = businessGroups(vendors, r);
  const ubiG = bg.find((g) => g.key === "ubi:603358264")!;
  ok(!!ubiG && ubiG.suggestedSurvivorId === "buddies", "same-UBI group keeps the card with a logo");
  ok(!bg.some((g) => g.vendorIds.includes("fire2")), "archived cards never in a merge group");
  const dupLic = businessGroups([V({ id: "a", display_name: "A", license_number: "123456" }), V({ id: "b", display_name: "B", license_number: "123-456", product_count: 4 })]);
  ok(dupLic.length === 1 && dupLic[0].reason === "same_license" && dupLic[0].suggestedSurvivorId === "b", "same license on two live cards");

  // Brand fills: only ok lots, only one-brand businesses.
  const bf = brandFills({
    lots,
    brands: [
      { id: "br1", vendor_id: "fire2", display_name: "Fire Bros" },
      { id: "br2", vendor_id: "home", display_name: "H1" },
      { id: "br3", vendor_id: "home", display_name: "H2" },
    ],
    vendors,
    result: r,
  });
  ok(bf.length === 1 && bf[0].vendorId === "fire" && bf[0].brandId === "br1" && bf[0].lotIds.length === 3, "brand fill via archived card brand");

  // Vendor facts.
  const ff = vendorPaperworkFacts("fire2", vendors, r);
  ok(ff.licenses.map((x) => x.license).sort().join() === "425450,436479", "facts: both licenses");
  ok(ff.licenses.every((x) => x.onCard) && ff.cardLicenseSeenOnPaperwork === true, "facts: on card + seen");
  ok(ff.lots.ok === 3, "facts: ok lots");
  const pf = vendorPaperworkFacts("peoples", vendors, r);
  ok(pf.licenses[0].license === "416010" && pf.lots.wrong_business === 0, "facts: target side lists license, not counted as its lots");
  const hf = vendorPaperworkFacts("home", vendors, r);
  ok(hf.lots.wrong_business === 2 && hf.licenses.some((x) => x.license === "416010" && !x.onCard), "facts: wrong lots on home, foreign license shown");
  ok(vendorPaperworkFacts("twok", vendors, r).cardLicenseSeenOnPaperwork === null, "facts: no card license -> null");

  // Survivor cycles are safe.
  const cyc = new Map<string, LedgerVendor>([
    ["a", V({ id: "a", display_name: "A", merged_into_id: "b" })],
    ["b", V({ id: "b", display_name: "B", merged_into_id: "a" })],
  ]);
  ok(["a", "b"].includes(survivorOf("a", cyc)), "cycle-safe");

  return { passed, failed: 0 };
}
