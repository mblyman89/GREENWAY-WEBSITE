/**
 * src/lib/inventory/testing-labs-core.ts  (R36 #4)
 *
 * PURE. Washington cannabis testing labs + the certificate hosts the COA
 * reader may fetch from.
 *
 * Owner (R36): "research online all of the different testing labs in
 * washington, so we can add them to the known list. I got an error telling me
 * that cultivera is not on the known list for lab testers so it didnt read the
 * coa ... add a button at the top of the inventory page that opens a simple
 * page listing the labs, and the ability to add one if needed."
 *
 * SOURCES (docs/research/wa-testing-labs.md; both files are in docs/research):
 *   - WSLCB Lab List 2026-08-04 (lab-list-2026-08-04.xlsx) - the 4 certified labs.
 *   - WSLCB Lab List 2021-08-02 (lab-list-2021.xlsx) - 7 more labs no longer on
 *     the list, so an older certificate still on a product is recognised.
 *   - WSDA Cannabis Lab Accreditation (agr.wa.gov/departments/cannabis).
 *
 * TWO DIFFERENT "KNOWN LISTS"
 *   1. Labs (who tested it) - information for staff.
 *   2. Certificate HOSTS (where the PDF / JSON is fetched from). This is the
 *      list the "not a known lab host" error comes from. It is a server-side
 *      request forgery guard (OWASP SSRF Prevention Cheat Sheet: allow-list
 *      the destination, refuse IP literals, refuse private addresses after
 *      DNS resolution). files.cultivera.com is the host behind the owner's
 *      error: 70 of 70 lab links in the owner's sample transfers live there
 *      (measured R36), and all 35 distinct certificates were fetched live.
 *
 * The built-in hosts are always allowed (no database needed). Hosts the owner
 * adds on /admin/inventory/labs are ADDED to them - never replace them - and
 * pass normalizeLabHost (no IPs, ports, credentials, wildcards, single-label
 * or internal names) plus, at fetch time, a DNS check that every address is
 * public (isPublicAddress).
 */

/** platform = not a lab (Cultivera re-hosts lab certificates); 0256 refuses a lab # on it. */
export type LabStatus = "active" | "historical" | "owner_added" | "platform";

export type TestingLab = {
  labNumber: number | null;
  name: string;
  address: string | null;
  city: string | null;
  zip: string | null;
  phone: string | null;
  status: LabStatus;
  certStart: string | null;
  certCurrent: string | null;
  certValidThrough: string | null;
  source: string;
  website: string | null;
  /** Hosts this lab's certificates are served from (0256 testing_labs.coa_hosts). */
  coaHosts: readonly string[];
};

/** Most hosts one row may carry (0256 testing_labs_hosts_chk). */
export const MAX_HOSTS_PER_LAB = 20;

const SRC_2026 = "WSLCB Lab List 2026-08-04 (lcb.wa.gov/records/frequently-requested-lists)";
const SRC_2021 = "WSLCB Lab List 2021-08-02 (historical; absent from the 2026 list)";

/**
 * Every row copied from the two LCB spreadsheets (values verbatim) with ONE
 * correction: the 2021 list spells lab #7's street "19834 Vicking Ave NW",
 * "Ste B"; the lab's own certificates (fixtures cv31-cv34) print "Viking", so
 * that spelling is used. The suite stays as the LCB lists it (Ste B) - the
 * certificates print "Ste A"; the regulator's list is the record kept here.
 */
export const WA_TESTING_LABS: readonly TestingLab[] = [
  { labNumber: 3, name: "Confidence Analytics", address: "14797 NE 95th St", city: "Redmond", zip: "98052", phone: "206-743-8843", status: "active", certStart: "June 18, 2014", certCurrent: "July 23, 2026", certValidThrough: "July 2027", source: SRC_2026, website: "https://conflabs.com", coaHosts: ["certs.conflabs.com"] },
  { labNumber: 9, name: "Integrity Labs, LLC", address: "2747 Pacific Ave SE Ste B21", city: "Olympia", zip: "98501", phone: "360-951-3220", status: "active", certStart: "Aug 19, 2014", certCurrent: "Oct 29, 2025", certValidThrough: "Oct 2026", source: SRC_2026, website: null, coaHosts: [] },
  { labNumber: 12, name: "Green Grower Labs", address: "124 E. Rowan Ave Ste B", city: "Spokane", zip: "99207", phone: "509-981-2266", status: "active", certStart: "Sept 23, 2014", certCurrent: "Nov 21, 2025", certValidThrough: "Nov 2026", source: SRC_2026, website: null, coaHosts: ["gglabs-j.github.io"] },
  { labNumber: 18, name: "Medicine Creek Analytics", address: "3700 Pacific Hwy E Ste 400", city: "Fife", zip: "98424", phone: "253-382-6900", status: "active", certStart: "May 25, 2016", certCurrent: "July 21, 2026", certValidThrough: "July 2027", source: SRC_2026, website: "https://medicinecreekanalytics.com", coaHosts: [] },
  { labNumber: 4, name: "Analytical 360, LLC", address: "31 N 1st Avenue", city: "Yakima", zip: "98902", phone: "509-571-1102", status: "historical", certStart: "2014-05-27", certCurrent: null, certValidThrough: null, source: SRC_2021, website: null, coaHosts: [] },
  { labNumber: 6, name: "True Northwest, Inc.", address: "4139 Libby Rd. NE", city: "Olympia", zip: "98506", phone: "360-352-8688", status: "historical", certStart: "2014-07-10", certCurrent: null, certValidThrough: null, source: SRC_2021, website: null, coaHosts: [] },
  { labNumber: 7, name: "Testing Technologies, Inc.", address: "19834 Viking Ave NW Ste B", city: "Poulsbo", zip: "98370", phone: "360-340-1251", status: "historical", certStart: "2016-10-26", certCurrent: null, certValidThrough: null, source: SRC_2021, website: null, coaHosts: [] },
  { labNumber: 8, name: "G.O.A.T. Labs", address: "5501 NE 109th Ct Ste N", city: "Vancouver", zip: "98662", phone: "360-513-9377", status: "historical", certStart: "2014-07-23", certCurrent: null, certValidThrough: null, source: SRC_2021, website: null, coaHosts: [] },
  { labNumber: 21, name: "Treeline Analytics, LLC", address: "5373 Guide Meridian Ste F-201", city: "Bellingham", zip: "98226", phone: "360-306-3601", status: "historical", certStart: "2018-08-17", certCurrent: null, certValidThrough: null, source: SRC_2021, website: null, coaHosts: [] },
  { labNumber: 22, name: "Capitol Analysis", address: "3011 Pacific Ave SE", city: "Olympia", zip: "98501", phone: "360-918-8795", status: "historical", certStart: "2016-11-09", certCurrent: null, certValidThrough: null, source: SRC_2021, website: null, coaHosts: [] },
  { labNumber: 25, name: "Pacific Botanicals Laboratory", address: "3927 Aurora Ave N", city: "Seattle", zip: "98103", phone: "206-566-3526", status: "historical", certStart: "2020-03-23", certCurrent: null, certValidThrough: null, source: SRC_2021, website: null, coaHosts: [] },
];

/**
 * Cultivera is NOT a lab: it is the vendors' seed-to-sale platform, and it
 * re-hosts the lab's own certificate PDF on files.cultivera.com (R36: 70 of 70
 * lab links in the owner's sample transfers). Listed so the page can show
 * where that host comes from. 0256 seeds the same row.
 */
export const CULTIVERA_PLATFORM: TestingLab = {
  labNumber: null,
  name: "Cultivera (vendor platform, not a lab)",
  address: null,
  city: null,
  zip: null,
  phone: null,
  status: "platform",
  certStart: null,
  certCurrent: null,
  certValidThrough: null,
  source: "R36: 70 of 70 lab links in the owner's sample transfers are on files.cultivera.com (35 certificates read live)",
  website: "https://cultivera.com",
  coaHosts: ["files.cultivera.com"],
};

/** Exactly the rows 0256 seeds (a test pins the migration to this). */
export const SEEDED_LAB_ROWS: readonly TestingLab[] = [...WA_TESTING_LABS, CULTIVERA_PLATFORM];

export type LabHost = {
  host: string;
  /** WSLCB lab # this host serves certificates for (null = a platform, not a lab). */
  labNumber: number | null;
  label: string;
  evidence: string;
  builtIn: boolean;
};

/** Hosts verified by fetching real certificates (R26/R28/R36). Always allowed. */
export const BUILT_IN_COA_HOSTS: readonly LabHost[] = [
  { host: "certs.conflabs.com", labNumber: 3, label: "Confidence Analytics certificates", evidence: "16 owner-transfer COA links fetched and read (R26/R28).", builtIn: true },
  { host: "gglabs-j.github.io", labNumber: 12, label: "Green Grower Labs certificates", evidence: "Owner-transfer COA links fetched and read (R28).", builtIn: true },
  { host: "files.cultivera.com", labNumber: null, label: "Cultivera (vendor seed-to-sale platform) re-hosted lab certificates", evidence: "70 of 70 lab links in the owner's sample transfers; 35 distinct certificates (31 Confidence Analytics, 4 Testing Technologies) fetched live and read (R36).", builtIn: true },
];

/** Which certificate layouts the PDF reader knows (coa-pdf-text-core detectCoaTemplate). */
export const READABLE_LAYOUTS: Readonly<Record<number, string>> = {
  3: "Template 8.0 and Template 6.0 / 7.0",
  7: "One-page results table",
  12: "Yes (potency numbers come from the lab JSON)",
};

export type HostCheck = { ok: true; host: string } | { ok: false; reason: string };

const INTERNAL_SUFFIXES = [".local", ".localhost", ".internal", ".intranet", ".lan", ".home", ".corp", ".arpa", ".test", ".invalid", ".example"];

/**
 * Normalise what the owner typed ("files.cultivera.com", or a whole
 * certificate link) to a bare hostname - or refuse it with a reason.
 */
export function normalizeLabHost(raw: string | null | undefined): HostCheck {
  let s = String(raw ?? "").trim();
  if (!s) return { ok: false, reason: "Enter a host name, e.g. files.cultivera.com, or paste a certificate link." };
  if (s.length > 2048) return { ok: false, reason: "That is too long to be a host name." };
  if (/[*]/.test(s)) return { ok: false, reason: "Wildcards are not allowed - add each exact host." };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    let u: URL;
    try {
      u = new URL(s);
    } catch {
      return { ok: false, reason: "That link could not be read." };
    }
    if (u.protocol !== "https:") return { ok: false, reason: `Only https certificate links are read (that one is ${u.protocol.replace(":", "")}).` };
    if (u.username || u.password) return { ok: false, reason: "Links with a user name or password are not allowed." };
    if (u.port && u.port !== "443") return { ok: false, reason: `Port ${u.port} is not allowed - certificates are read on the normal https port only.` };
    s = u.hostname;
  } else if (/[/?#@:\s\\]/.test(s)) {
    return { ok: false, reason: "Enter only the host name (no slashes, ports, spaces or @), or paste the whole https link." };
  }
  const host = s.toLowerCase().replace(/\.$/, "");
  if (host.length > 253) return { ok: false, reason: "That host name is longer than DNS allows (253)." };
  if (/^\[.*\]$/.test(host) || host.includes(":")) return { ok: false, reason: "IP addresses are not allowed - only named hosts." };
  if (/^\d+(\.\d+){0,3}$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return { ok: false, reason: "IP addresses are not allowed - only named hosts." };
  const labels = host.split(".");
  if (labels.length < 2) return { ok: false, reason: "A host needs a domain, e.g. certs.example-lab.com." };
  for (const l of labels) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l)) return { ok: false, reason: `"${l}" is not a valid part of a host name.` };
  }
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(labels[labels.length - 1])) return { ok: false, reason: "The host must end in a real top-level domain (.com, .org, .io ...)." };
  if (host === "localhost" || INTERNAL_SUFFIXES.some((x) => host.endsWith(x))) return { ok: false, reason: "Internal or reserved names are not allowed." };
  return { ok: true, host };
}

/**
 * True only for a PUBLIC unicast address. Refused: loopback, private
 * (RFC 1918), link-local (incl. the 169.254.169.254 cloud metadata address),
 * CGNAT, multicast, reserved, unspecified, IPv6 ULA / link-local, and
 * IPv4-mapped IPv6 forms of all of those.
 */
export function isPublicAddress(ip: string): boolean {
  const a = String(ip ?? "").trim().toLowerCase();
  const v4 = a.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const o = v4.slice(1).map(Number);
    if (o.some((x) => x > 255)) return false;
    const [x, y] = o;
    if (x === 0 || x === 10 || x === 127) return false;
    if (x === 100 && y >= 64 && y <= 127) return false;
    if (x === 169 && y === 254) return false;
    if (x === 172 && y >= 16 && y <= 31) return false;
    if (x === 192 && y === 168) return false;
    if (x === 192 && y === 0 && (o[2] === 0 || o[2] === 2)) return false;
    if (x === 198 && (y === 18 || y === 19)) return false;
    if (x === 198 && y === 51 && o[2] === 100) return false;
    if (x === 203 && y === 0 && o[2] === 113) return false;
    if (x >= 224) return false;
    return true;
  }
  if (!a.includes(":")) return false;
  const mapped = a.match(/^(?:0{0,4}:){0,5}:?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/) ?? a.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPublicAddress(mapped[1]);
  if (a === "::" || a === "::1") return false;
  const first = a.split(":")[0];
  const h = first === "" ? 0 : parseInt(first, 16);
  if (Number.isNaN(h)) return false;
  if ((h & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((h & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((h & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  if (h === 0x2001 && a.split(":")[1] === "db8") return false; // documentation
  if (h === 0 || h === 0x64) return false; // ::/8 reserved, 64:ff9b NAT64 maps to v4 we cannot judge
  return true;
}

export type LabForm = {
  name: string;
  labNumber: string;
  city: string;
  phone: string;
  website: string;
  notes: string;
};

export type LabInput = {
  name: string;
  labNumber: number | null;
  city: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
};

const clean = (s: string | null | undefined, max: number) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

/** Validate the "Add a lab" form. Mirrors the 0256 check constraints. */
export function validateLabForm(f: LabForm, existing: readonly { name: string; labNumber: number | null }[]): { ok: true; lab: LabInput } | { ok: false; error: string } {
  const name = clean(f.name, 200);
  if (!name || name.length < 2) return { ok: false, error: "Enter the lab's name." };
  let labNumber: number | null = null;
  const n = String(f.labNumber ?? "").trim().replace(/^#/, "");
  if (n) {
    if (!/^\d{1,4}$/.test(n) || Number(n) < 1) return { ok: false, error: "The lab # is the whole number on the WSLCB / WSDA list (e.g. 18)." };
    labNumber = Number(n);
  }
  const key = name.toLowerCase();
  if (existing.some((e) => e.name.trim().toLowerCase() === key)) return { ok: false, error: `${name} is already on the list.` };
  if (labNumber !== null && existing.some((e) => e.labNumber === labNumber)) return { ok: false, error: `Lab #${labNumber} is already on the list.` };
  let website = clean(f.website, 300);
  if (website) {
    // A link with its own scheme keeps it (so "ftp://..." or "javascript:..."
    // is REFUSED below, never turned into "https://ftp//..."); a bare
    // "example.com" becomes https://example.com. The page renders this as a
    // link, so only http(s) may ever be saved.
    if (!/^[a-z][a-z0-9+.-]*:/i.test(website) || /^[^:/]+\.[^:/]+:\d+(?:[/?#]|$)/.test(website)) website = `https://${website}`;
    let u: URL;
    try {
      u = new URL(website);
    } catch {
      return { ok: false, error: "The website does not look like a link." };
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: "The website must be an http or https link." };
    if (u.username || u.password) return { ok: false, error: "The website link cannot contain a user name or password." };
    website = u.toString();
  }
  const phone = clean(f.phone, 40);
  if (phone && !/^[0-9()+\-. x]{7,40}$/i.test(phone)) return { ok: false, error: "The phone number can contain only digits, spaces and ( ) - + ." };
  return { ok: true, lab: { name, labNumber, city: clean(f.city, 100), phone, website, notes: clean(f.notes, 1000) } };
}

/**
 * The full allow-list: built-in hosts first, then every valid host on any
 * lab row (testing_labs.coa_hosts), lower-cased and de-duplicated. A host
 * that fails normalizeLabHost (should be impossible past the 0256 check) is
 * dropped, never trusted.
 */
export function mergeHosts(rows: readonly { coaHosts: readonly string[] | null | undefined }[]): string[] {
  const out = BUILT_IN_COA_HOSTS.map((h) => h.host);
  for (const r of rows) {
    for (const raw of r.coaHosts ?? []) {
      const n = normalizeLabHost(raw);
      if (n.ok && !out.includes(n.host)) out.push(n.host);
    }
  }
  return out;
}

/** True when the host is one of the always-allowed built-ins. */
export function isBuiltInHost(host: string): boolean {
  return BUILT_IN_COA_HOSTS.some((h) => h.host === host);
}

/**
 * Add one host (or a pasted certificate link) to a lab's coa_hosts. Refuses
 * an invalid host, one already on this lab, one already a built-in, and a
 * row that is full. Returns the new array (the store writes it).
 */
export function addHostToLab(current: readonly string[], raw: string): { ok: true; host: string; hosts: string[] } | { ok: false; error: string } {
  const n = normalizeLabHost(raw);
  if (!n.ok) return { ok: false, error: n.reason };
  if (isBuiltInHost(n.host)) return { ok: false, error: `${n.host} is already built in - certificates from it are always read.` };
  if (current.includes(n.host)) return { ok: false, error: `${n.host} is already on this lab.` };
  if (current.length >= MAX_HOSTS_PER_LAB) return { ok: false, error: `A lab can have at most ${MAX_HOSTS_PER_LAB} hosts.` };
  return { ok: true, host: n.host, hosts: [...current, n.host] };
}

/** Remove one host from a lab's coa_hosts (an error if it is not there). */
export function removeHostFromLab(current: readonly string[], host: string): { ok: true; hosts: string[] } | { ok: false; error: string } {
  const h = String(host ?? "").trim().toLowerCase();
  if (!current.includes(h)) return { ok: false, error: `${h || "That host"} is not on this lab.` };
  return { ok: true, hosts: current.filter((x) => x !== h) };
}

// ---------------------------------------------------------------------------
// Self-tests (house pattern)
// ---------------------------------------------------------------------------
export function __runTestingLabsCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL testing-labs-core: " + msg);
    }
  };
  // seed
  ok(WA_TESTING_LABS.length === 11, "11 labs (4 active + 7 historical)");
  ok(WA_TESTING_LABS.filter((l) => l.status === "active").map((l) => l.labNumber).join(",") === "3,9,12,18", "active = #3 #9 #12 #18 (2026 list)");
  ok(WA_TESTING_LABS.filter((l) => l.status === "historical").map((l) => l.labNumber).join(",") === "4,6,7,8,21,22,25", "historical = #4 #6 #7 #8 #21 #22 #25");
  ok(new Set(WA_TESTING_LABS.map((l) => l.labNumber)).size === 11, "lab numbers unique");
  ok(WA_TESTING_LABS.every((l) => /^\d{3}-\d{3}-\d{4}$/.test(l.phone ?? "") && /^\d{5}$/.test(l.zip ?? "")), "every phone / zip in the LCB form");
  ok(BUILT_IN_COA_HOSTS.map((h) => h.host).includes("files.cultivera.com"), "files.cultivera.com is built in (the owner's error)");
  ok(BUILT_IN_COA_HOSTS.every((h) => normalizeLabHost(h.host).ok), "every built-in host passes its own validator");
  // normalizeLabHost - accepted
  const n = (s: string) => normalizeLabHost(s);
  const host = (s: string) => {
    const r = n(s);
    return r.ok ? r.host : null;
  };
  ok(host("files.cultivera.com") === "files.cultivera.com", "bare host");
  ok(host("  CERTS.ConfLabs.COM. ") === "certs.conflabs.com", "trim + lower + trailing dot");
  ok(host("https://files.cultivera.com/435553542D5753353031/Coas/x.pdf") === "files.cultivera.com", "a whole link -> its host");
  ok(host("https://certs.conflabs.com:443/full/x.pdf") === "certs.conflabs.com", "explicit 443 ok");
  ok(host("xn--bcher-kva.example-lab.xn--p1ai") === "xn--bcher-kva.example-lab.xn--p1ai", "punycode labels + IDN tld ok");
  // refused
  for (const [bad, why] of [
    ["", "empty"],
    ["http://files.cultivera.com/x", "http"],
    ["ftp://files.cultivera.com/x", "ftp"],
    ["https://user:pw@files.cultivera.com/x", "credentials"],
    ["https://files.cultivera.com:8443/x", "port"],
    ["*.cultivera.com", "wildcard"],
    ["files.cultivera.com/x", "path without scheme"],
    ["files.cultivera.com:443", "port without scheme"],
    ["127.0.0.1", "ipv4"],
    ["https://169.254.169.254/latest", "metadata ip"],
    ["https://[::1]/x", "ipv6 literal"],
    ["0x7f000001", "hex ip"],
    ["2130706433", "decimal ip"],
    ["localhost", "localhost"],
    ["lab", "single label"],
    ["printer.local", ".local"],
    ["db.internal", ".internal"],
    ["x.example", ".example"],
    ["-bad.com", "label starts with hyphen"],
    ["bad-.com", "label ends with hyphen"],
    ["a..com", "empty label"],
    ["lab.c0m", "numeric tld"],
    ["lab .com", "space"],
    ["user@lab.com", "@"],
    ["a".repeat(64) + ".com", "label > 63"],
  ] as const) {
    ok(!n(bad).ok, `refused: ${why}`);
  }
  ok(n("http://x.com").ok === false && (n("http://x.com") as { reason: string }).reason.includes("https"), "http reason names https");
  // the REASON is the owner's guidance, so it must name the real problem
  const why = (s: string) => {
    const r = n(s);
    return r.ok ? "" : r.reason;
  };
  for (const ip of ["127.0.0.1", "10.0.0.1", "2130706433", "0x7f000001", "https://169.254.169.254/latest", "8.8.8.8"]) ok(why(ip).startsWith("IP addresses are not allowed"), `IP reason for ${ip}`);
  ok(why("*.cultivera.com").startsWith("Wildcards are not allowed") && why("https://*.cultivera.com/x").startsWith("Wildcards"), "wildcard reason");
  ok(why("lab").startsWith("A host needs a domain") && why("printer.local").startsWith("Internal or reserved") && why("lab.c0m").startsWith("The host must end"), "domain / internal / tld reasons");
  // isPublicAddress
  for (const ip of ["8.8.8.8", "140.82.112.3", "52.84.150.39", "2606:4700::6810:84e5", "2a00:1450:4001:82a::200e"]) ok(isPublicAddress(ip), `public ${ip}`);
  for (const ip of [
    "10.0.0.1", "127.0.0.1", "0.0.0.0", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1", "100.127.255.255",
    "224.0.0.1", "255.255.255.255", "192.0.2.1", "198.18.0.1", "198.51.100.7", "203.0.113.9", "192.0.0.8",
    "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.1.2.3", "2001:db8::1", "64:ff9b::1.2.3.4",
    "999.1.1.1", "not-an-ip", "",
  ]) ok(!isPublicAddress(ip), `not public ${ip || "(empty)"}`);
  ok(isPublicAddress("172.32.0.1") && isPublicAddress("172.15.255.255") && isPublicAddress("100.128.0.1") && isPublicAddress("::ffff:8.8.8.8"), "range edges just outside are public");
  // validateLabForm
  const base: LabForm = { name: "New Lab NW", labNumber: "", city: "", phone: "", website: "", notes: "" };
  const v = validateLabForm(base, WA_TESTING_LABS);
  ok(v.ok && v.lab.labNumber === null && v.lab.city === null, "minimal lab ok");
  ok(!validateLabForm({ ...base, name: " " }, []).ok, "name required");
  ok(!validateLabForm({ ...base, name: "confidence analytics" }, WA_TESTING_LABS).ok, "duplicate name (case-insensitive) refused");
  ok(!validateLabForm({ ...base, labNumber: "18" }, WA_TESTING_LABS).ok, "duplicate lab # refused");
  const v2 = validateLabForm({ ...base, labNumber: "#31", website: "newlab.com", phone: "(360) 555-0100" }, WA_TESTING_LABS);
  ok(v2.ok && v2.lab.labNumber === 31 && v2.lab.website === "https://newlab.com/" && v2.lab.phone === "(360) 555-0100", "lab #, website, phone normalised");
  ok(!validateLabForm({ ...base, labNumber: "3a" }, []).ok && !validateLabForm({ ...base, labNumber: "0" }, []).ok, "bad lab # refused");
  ok(!validateLabForm({ ...base, phone: "call me" }, []).ok, "bad phone refused");
  ok(!validateLabForm({ ...base, website: "javascript:alert(1)" }, []).ok, "javascript: website refused");
  const web = (w: string) => {
    const r = validateLabForm({ ...base, website: w }, []);
    return r.ok ? r.lab.website : `ERR ${r.error}`;
  };
  ok(web("ftp://files.lab.com") === "ERR The website must be an http or https link.", "ftp: refused (never rewritten to https://ftp//)");
  ok(web("data:text/html,hi").startsWith("ERR") && web("mailto:a@b.com").startsWith("ERR"), "data: / mailto: refused");
  ok(web("https://u:p@lab.com").startsWith("ERR The website link cannot contain"), "credentials in the website refused");
  ok(web("lab.com:8443/x") === "https://lab.com:8443/x" && web("Example.com") === "https://example.com/" && web("http://lab.com") === "http://lab.com/", "bare host / host:port / http kept as links");
  ok(web("not a link") === "ERR The website does not look like a link.", "unreadable website refused");
  // seed rows
  ok(SEEDED_LAB_ROWS.length === 12 && SEEDED_LAB_ROWS[11] === CULTIVERA_PLATFORM, "seeded = 11 labs + the Cultivera platform row");
  ok(CULTIVERA_PLATFORM.status === "platform" && CULTIVERA_PLATFORM.labNumber === null && CULTIVERA_PLATFORM.coaHosts.join() === "files.cultivera.com", "Cultivera row: platform, no lab #, files.cultivera.com");
  ok(WA_TESTING_LABS.filter((l) => l.coaHosts.length > 0).map((l) => `${l.labNumber}:${l.coaHosts.join("|")}`).join(",") === "3:certs.conflabs.com,12:gglabs-j.github.io", "only #3 and #12 carry a host");
  ok(SEEDED_LAB_ROWS.flatMap((l) => l.coaHosts).sort().join() === BUILT_IN_COA_HOSTS.map((h) => h.host).sort().join(), "seeded hosts == built-in hosts");
  // mergeHosts
  const m = mergeHosts([{ coaHosts: ["Certs.Newlab.com", "files.cultivera.com"] }, { coaHosts: null }, { coaHosts: ["127.0.0.1", "certs.newlab.com", "two.newlab.com"] }]);
  ok(m.join(",") === "certs.conflabs.com,gglabs-j.github.io,files.cultivera.com,certs.newlab.com,two.newlab.com", "merge: built-ins first, owner added, dupes/invalid dropped");
  ok(mergeHosts([]).length === 3, "no rows -> the 3 built-ins");
  ok(mergeHosts(SEEDED_LAB_ROWS).length === 3, "seed rows add nothing beyond the built-ins");
  // addHostToLab / removeHostFromLab
  const a1 = addHostToLab([], "https://certs.newlab.com/coa/1.pdf");
  ok(a1.ok && a1.host === "certs.newlab.com" && a1.hosts.join() === "certs.newlab.com", "add from a pasted link");
  ok(!addHostToLab(["certs.newlab.com"], "CERTS.newlab.com").ok, "add refuses a host already on the lab");
  const a2 = addHostToLab([], "files.cultivera.com");
  ok(!a2.ok && a2.error.includes("built in"), "add refuses a built-in host");
  ok(!addHostToLab([], "10.0.0.1").ok, "add refuses an IP");
  const full = Array.from({ length: MAX_HOSTS_PER_LAB }, (_, i) => `h${i}.lab.com`);
  ok(!addHostToLab(full, "x.lab.com").ok && addHostToLab(full.slice(1), "x.lab.com").ok, "add refuses the 21st host, allows the 20th");
  const r1 = removeHostFromLab(["a.lab.com", "b.lab.com"], " A.lab.com ");
  ok(r1.ok && r1.hosts.join() === "b.lab.com", "remove a host (trim + lower)");
  ok(!removeHostFromLab(["a.lab.com"], "c.lab.com").ok, "remove refuses a host not on the lab");
  ok(isBuiltInHost("files.cultivera.com") && !isBuiltInHost("files.cultivera.org"), "isBuiltInHost");
  return { passed, failed };
}
