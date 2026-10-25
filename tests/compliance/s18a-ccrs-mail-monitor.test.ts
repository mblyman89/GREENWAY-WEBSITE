/**
 * S-18a (CCRS Bible v2 Part 09): the CCRS mailbox monitor.
 *
 * Owner request (2026-10-20): "a fetching service that monitors my
 * michael@greenwaymarijuana.com address for CCRS emails, specifically the
 * upload confirmations". Owner, same day: "Failed uploads have an attachment
 * with the failures identified if I remember correctly."
 *
 * Every fact below is read from evidence committed in the repo: the 45 real
 * PREprod confirmations (2026-09-17, 10-06, 10-07), the 15 real error CSVs
 * (14 from 2026-09-17, one from P20261005A), the examiner thread, and the
 * Part 02 verbatim FAQ. The real files are wrapped in Gmail API message
 * shapes (base64url bodies, attachmentId parts) exactly as messages.get
 * format=full returns them, so the code under test reads what Gmail sends.
 */
import { generateKeyPairSync, createVerify } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CCRS_SENDER,
  DEFAULT_CCRS_MAILBOX,
  GMAIL_READONLY_SCOPE,
  GOOGLE_TOKEN_URL,
  JWT_BEARER_GRANT,
  MAX_ATTACHMENT_BYTES,
  MAX_NEW_PER_TICK,
  MAX_CSV_PER_MESSAGE,
  __runCcrsMailCoreTests,
  applyTimeISO,
  attachmentPlan,
  authVerdict,
  buildCcrsQuery,
  classifyCcrsMail,
  errorFileType,
  errorsFromStored,
  heartbeatStale,
  idsToFetch,
  knownCcrsMessage,
  mailConfigFromEnv,
  normalizeGmailMessage,
  pickEchoFile,
  planSuccessEnv,
  readErrorAttachment,
  resolveEchoPick,
  senderAddress,
  shouldWriteHeartbeat,
  subjectEnv,
  toMailRow,
  wantAttachment,
  type EchoCandidate,
  type GmailMessage,
  type GmailPart,
  type MailHeartbeat,
  type NormalizedMail,
} from "@/lib/compliance/ccrs-mail-core";
import { CCRS_KNOWN_MESSAGES, rowIdColumn, type OurRow } from "@/lib/compliance/ccrs-outcome-core";
import { splitCsvLine, type CcrsRetailerFileType } from "@/lib/compliance/ccrs-batch-core";
import { CcrsMailPanel, type CcrsMailPanelRow } from "@/components/admin/compliance/CcrsMailPanel";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const EV = "docs/ccrs-bible/evidence";
const RUN = `${EV}/2026-09-17-preprod-run`;
const PART02 = read("docs/ccrs-bible/02-authoritative-spec.md");
const EXAM = read(`${EV}/2026-10-19-owner-request/owner-request-verbatim.txt`).split("\n");

function part02Line(heading: string, pin: string): string {
  const start = PART02.indexOf(heading);
  expect(start).toBeGreaterThan(-1);
  const rest = PART02.slice(start);
  const next = rest.indexOf("\n## ", 5);
  const section = next > 0 ? rest.slice(0, next) : rest;
  const line = section.split("\n").find((l) => l.startsWith(`${pin}|`));
  expect(line, `${heading} ${pin}`).toBeDefined();
  return line as string;
}

/* ------------------------------------------------------------------ *
 * Gmail-shaped fixtures built from the real evidence.
 * ------------------------------------------------------------------ */
const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const REAL_AUTH = "mx.google.com; dkim=pass header.i=@lcb.wa.gov; spf=pass smtp.mailfrom=info@lcb.wa.gov; dmarc=pass (p=NONE) header.from=lcb.wa.gov";

function gmail(opts: {
  id: string;
  from?: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: { filename: string; mimeType?: string; text: string; inline?: boolean }[];
  labelIds?: string[];
  auth?: string[];
  internalDate?: string;
}): { msg: GmailMessage; attachmentData: Record<string, string> } {
  const attachmentData: Record<string, string> = {};
  const parts: GmailPart[] = [];
  const alt: GmailPart[] = [];
  if (opts.text !== undefined) alt.push({ partId: "0.0", mimeType: "text/plain", filename: "", body: { size: opts.text.length, data: b64u(opts.text) } });
  if (opts.html !== undefined) alt.push({ partId: "0.1", mimeType: "text/html", filename: "", body: { size: opts.html.length, data: b64u(opts.html) } });
  parts.push({ partId: "0", mimeType: "multipart/alternative", filename: "", body: { size: 0 }, parts: alt });
  (opts.attachments ?? []).forEach((a, i) => {
    const attId = `ATT${opts.id}${i}`;
    if (a.inline) {
      parts.push({ partId: String(i + 1), mimeType: a.mimeType ?? "text/csv", filename: a.filename, body: { size: Buffer.byteLength(a.text), data: b64u(a.text) } });
    } else {
      attachmentData[attId] = b64u(a.text);
      parts.push({ partId: String(i + 1), mimeType: a.mimeType ?? "text/csv", filename: a.filename, body: { size: Buffer.byteLength(a.text), attachmentId: attId } });
    }
  });
  const headers = [
    { name: "From", value: opts.from ?? "info@lcb.wa.gov <info@lcb.wa.gov>" },
    { name: "To", value: "michael@greenwaymarijuana.com" },
    { name: "Subject", value: opts.subject },
    ...(opts.auth ?? [REAL_AUTH]).map((v) => ({ name: "Authentication-Results", value: v })),
  ];
  return {
    msg: {
      id: opts.id,
      threadId: `t${opts.id}`,
      labelIds: opts.labelIds ?? ["INBOX", "UNREAD"],
      internalDate: opts.internalDate ?? String(Date.UTC(2026, 10, 8, 19, 0, 0)),
      payload: { partId: "", mimeType: "multipart/mixed", filename: "", headers, body: { size: 0 }, parts },
    },
    attachmentData,
  };
}

/** Normalize as the tick does: plan, "download" (from the fixture), normalize. */
function asTick(g: ReturnType<typeof gmail>): NormalizedMail {
  const plan = attachmentPlan(g.msg);
  const csvs = plan.download.map((a) => ({
    filename: a.filename,
    text: Buffer.from(a.inlineData ?? g.attachmentData[a.attachmentId ?? ""] ?? "", "base64url").toString("utf8"),
  }));
  return normalizeGmailMessage(g.msg, csvs, plan.skipped);
}

const ERROR_FILES = [...readdirSync(path.join(ROOT, RUN, "errors")).sort().map((f) => `${RUN}/errors/${f}`), `${EV}/P20261005A/Product__20261006T113333390.csv`];

function rowsOf(type: CcrsRetailerFileType, csv: string): OurRow[] {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r\n|\n/).filter((l) => l !== "");
  const hdr = splitCsvLine(lines[3]);
  const at = hdr.indexOf(rowIdColumn(type));
  const op = hdr.indexOf("Operation");
  return lines.slice(4).map((l, i) => {
    const c = splitCsvLine(l);
    return { rowNo: i + 1, externalId: c[at], operation: op >= 0 ? c[op] : null };
  });
}

/* ------------------------------------------------------------------ */
describe("S-18a grounding: what CCRS sends, and to whom (committed evidence)", () => {
  it("[EXAM L0098] confirmations AND errors go to the email that submitted the file", () => {
    expect(EXAM[97]).toContain("it is the email that submits the file will get confirmation and error messages");
  });
  it("[FAQ L0102] error emails may land in spam, so the search includes Spam", () => {
    const l = part02Line("## 2. CCRS FAQ", "L0102");
    expect(l).toContain("check any spam filters that might initially block these error emails or look in junk folder");
  });
  it("[EXAM L0532] header/operation errors are whole-file, row errors are per row", () => {
    expect(EXAM[531]).toContain("Header and operation errors are full file, individual row errors are specific to that row");
  });
  it("every real confirmation is from info@lcb.wa.gov with the PRE subject (45 notices, 3 runs)", () => {
    const f917 = read(`${RUN}/success-emails-2026-09-17.txt`);
    const f1006 = read(`${EV}/P20261006A/success-emails-2026-10-06.txt`);
    const f1007 = read(`${EV}/P20261007A/success-emails-2026-10-07.txt`);
    const n = (t: string) => (t.match(/you submitted has been processed/g) ?? []).length;
    expect([n(f917), n(f1006), n(f1007)]).toEqual([10, 28, 7]);
    expect(f917).toContain("PRE: CCRS Processing Successful");
    expect(f917).toContain("info@lcb.wa.gov <info@lcb.wa.gov>");
    expect(f1007.split("\n")[0]).toBe("PRE: CCRS Processing Successful");
    expect(f1007).toContain("From: info@lcb.wa.gov");
    for (const l of f1006.split("\n").filter(Boolean)) expect(l.startsWith("info@lcb.wa.gov ")).toBe(true);
  });
  it("every real error answer is a CSV with an ErrorMessage column (15 files), never body text", () => {
    expect(ERROR_FILES).toHaveLength(15);
    for (const f of ERROR_FILES) {
      expect(f.endsWith(".csv")).toBe(true);
      expect(read(f).split(/\r\n/)[0].split(",")).toContain("ErrorMessage");
    }
  });
});

describe("configuration: two auth modes, nothing half-set, nothing guessed", () => {
  const PEM = "-----BEGIN PRIVATE KEY-----\\nAAA\\n-----END PRIVATE KEY-----\\n";
  it("defaults to the owner's mailbox and refuses to run unset", () => {
    const c = mailConfigFromEnv({});
    expect(c.configured).toBe(false);
    expect(c.mailbox).toBe("michael@greenwaymarijuana.com");
    expect(DEFAULT_CCRS_MAILBOX).toBe("michael@greenwaymarijuana.com");
  });
  it("service account: Vercel's escaped \\n is turned back into newlines", () => {
    const c = mailConfigFromEnv({ GMAIL_SA_CLIENT_EMAIL: "mon@gw.iam.gserviceaccount.com", GMAIL_SA_PRIVATE_KEY: PEM });
    expect(c.configured && c.mode).toBe("service-account");
    if (c.configured) expect(c.serviceAccount!.privateKey.split("\n")).toHaveLength(4);
  });
  it("a non-PEM key, half a mode, both modes, or a bad lookback are refused with the reason", () => {
    const k = mailConfigFromEnv({ GMAIL_SA_CLIENT_EMAIL: "a@b.iam.gserviceaccount.com", GMAIL_SA_PRIVATE_KEY: "xyz" });
    expect(!k.configured && k.problem).toMatch(/PEM/);
    const h = mailConfigFromEnv({ GMAIL_SA_CLIENT_EMAIL: "a@b.iam.gserviceaccount.com" });
    expect(!h.configured && h.missing).toEqual(["GMAIL_SA_PRIVATE_KEY"]);
    const o = mailConfigFromEnv({ GMAIL_OAUTH_CLIENT_ID: "x", GMAIL_OAUTH_CLIENT_SECRET: "y" });
    expect(!o.configured && o.missing).toEqual(["GMAIL_OAUTH_REFRESH_TOKEN"]);
    const b = mailConfigFromEnv({ GMAIL_SA_CLIENT_EMAIL: "a", GMAIL_OAUTH_CLIENT_ID: "x" });
    expect(!b.configured && b.problem).toMatch(/Both/);
    for (const lb of ["0", "721", "1.5", "abc"]) {
      const l = mailConfigFromEnv({ CCRS_MAIL_LOOKBACK_HOURS: lb, GMAIL_OAUTH_CLIENT_ID: "x", GMAIL_OAUTH_CLIENT_SECRET: "y", GMAIL_OAUTH_REFRESH_TOKEN: "z" });
      expect(l.configured, lb).toBe(false);
    }
    const ok = mailConfigFromEnv({ CCRS_MAIL_LOOKBACK_HOURS: "720", GMAIL_OAUTH_CLIENT_ID: "x", GMAIL_OAUTH_CLIENT_SECRET: "y", GMAIL_OAUTH_REFRESH_TOKEN: "z" });
    expect(ok.configured && ok.lookbackHours).toBe(720);
    expect(mailConfigFromEnv({ CCRS_MAILBOX_ADDRESS: "not an address" }).configured).toBe(false);
  });
});

describe("the Gmail search", () => {
  it("only CCRS's sender, with an epoch-SECONDS after: (date strings would be midnight PST)", () => {
    const now = Date.UTC(2026, 10, 8, 20, 0, 0);
    const q = buildCcrsQuery(now, 72);
    expect(q).toBe(`from:${CCRS_SENDER} after:${(now - 72 * 3_600_000) / 1000}`);
    expect(q).not.toMatch(/\d{4}\/\d{2}\/\d{2}/);
    expect(CCRS_SENDER).toBe("info@lcb.wa.gov");
  });
  it("fetches the OLDEST unseen first, capped per tick, so nothing starves", () => {
    const listed = Array.from({ length: 30 }, (_, i) => `id${String(30 - i).padStart(3, "0")}`); // newest first
    const known = new Set(["id030", "id001"]);
    const r = idsToFetch(listed, known);
    expect(r.fetch).toHaveLength(MAX_NEW_PER_TICK);
    expect(r.fetch[0]).toBe("id002");
    expect(r.fetch).not.toContain("id001");
    expect(r.deferred).toBe(28 - MAX_NEW_PER_TICK);
    expect(idsToFetch(["a", "a", "b"], new Set()).fetch).toEqual(["b", "a"]);
  });
});

describe("every REAL confirmation, delivered as Gmail delivers it", () => {
  const f917 = read(`${RUN}/success-emails-2026-09-17.txt`);
  // The 09-17 file is a browser PRINT of the inbox: it carries print-only lines
  // (the "https://mail.google.com/..." footer and the "9/17/26, 1:34 PM  Greenway
  // Mail - ..." page header) that break one notice across a page. Gmail's API
  // never delivers those, so they are removed before the notice is wrapped.
  const unprint = (b: string) =>
    b.split("\n").filter((l) => !/^https:\/\/mail\.google\.com\//.test(l) && !/^\f?\d{1,2}\/\d{1,2}\/\d{2}, \d{1,2}:\d{2} [AP]M\s+Greenway Mail/.test(l)).join("\n");
  const notices917 = f917.split(/\n(?=\s*info@lcb\.wa\.gov <info@lcb\.wa\.gov>)/).filter((b) => b.includes("you submitted has been processed")).map(unprint);
  const f1006 = read(`${EV}/P20261006A/success-emails-2026-10-06.txt`).split("\n").filter(Boolean);
  const f1007 = read(`${EV}/P20261007A/success-emails-2026-10-07.txt`).split(/\n(?=\[)/).filter((b) => b.includes("you submitted has been processed"));

  it("splits into one email per notice (10 + 28 + 7)", () => {
    expect([notices917.length, f1006.length, f1007.length]).toEqual([10, 28, 7]);
  });

  it("each is a PREprod confirmation (verified), naming exactly one file", () => {
    const bodies = [...notices917, ...f1006.map((l) => l.split(" | ")[1]), ...f1007];
    let named = 0;
    const unnamed: string[] = [];
    bodies.forEach((body, i) => {
      const m = asTick(gmail({ id: `s${i}`, subject: "PRE: CCRS Processing Successful", text: body }));
      const a = classifyCcrsMail(m);
      if (a.kind === "success") {
        expect(a.env).toBe("preprod");
        expect(a.envVerified).toBe(true);
        expect(a.successes).toHaveLength(1);
        expect(a.successes[0].submittedAt).not.toBeNull();
        expect(a.needsHuman).toEqual([]);
        named += 1;
      } else unnamed.push(body.trim().slice(0, 80));
    });
    // 44 of 45: the 10-07 "_1" re-upload (Inventory_413541_20261006222852_1_...) is
    // not a name this system emits; it is NOT force-fitted, it goes to a human.
    expect(named).toBe(44);
    expect(unnamed).toHaveLength(1);
    expect(unnamed[0]).toContain("Inventory_413541_20261006222852_1_");
  });

  it("at most MAX_CSV_PER_MESSAGE CSVs are downloaded per email; the rest are named for a human (quota)", () => {
    const many = Array.from({ length: MAX_CSV_PER_MESSAGE + 2 }, (_, i) => ({ filename: `Strain_2026110${i}T000000000.csv`, text: "LicenseNumber,Strain,ErrorMessage\n" }));
    const plan = attachmentPlan(gmail({ id: "many", subject: "x", text: "", attachments: many }).msg);
    expect(plan.download).toHaveLength(MAX_CSV_PER_MESSAGE);
    expect(plan.skipped).toEqual(many.slice(MAX_CSV_PER_MESSAGE).map((a) => a.filename));
    // Worst tick stays under Google's 6,000 units/min/user: list 5x5, get(full) 60, attachments.get 20.
    expect(5 * 5 + MAX_NEW_PER_TICK * 60 + MAX_NEW_PER_TICK * MAX_CSV_PER_MESSAGE * 20).toBeLessThan(6000);
  });
  it("subjectEnv: only the observed PREprod success subject is verified; error subjects never are (U-65, U-66)", () => {
    expect(subjectEnv("PRE: CCRS Processing Successful", "success")).toEqual({ env: "preprod", verified: true });
    expect(subjectEnv("CCRS Processing Successful", "success")).toEqual({ env: "prod", verified: false });
    expect(subjectEnv("Re: CCRS Processing Successful", "success")).toEqual({ env: null, verified: false });
    expect(subjectEnv("PRE: CCRS Processing Error", "error")).toEqual({ env: "preprod", verified: false });
    expect(subjectEnv("CCRS Processing Error", "error")).toEqual({ env: null, verified: false });
  });
  it("the _1 renamed copy is 'unknown' with the reason, not a success for the wrong file", () => {
    const body = f1007.find((b) => b.includes("_1_2026107T116153"))!;
    const a = classifyCcrsMail(asTick(gmail({ id: "s_1", subject: "PRE: CCRS Processing Successful", text: body })));
    expect(a.kind).toBe("unknown");
    expect(a.needsHuman.join(" ")).toMatch(/not in the shape this system emits/);
  });

  it("HTML-only body reads the same as text", () => {
    const html = `<div><p>PRE</p><p>The file Strain_413541_20261006222847_2026107T103687.csv you submitted has been processed.&nbsp; Date Submitted: 10/7/2026 10:35:10 AM</p></div>`;
    const a = classifyCcrsMail(asTick(gmail({ id: "h1", subject: "PRE: CCRS Processing Successful", html })));
    expect(a.kind).toBe("success");
    expect(a.successes[0]).toEqual({ fileName: "Strain_413541_20261006222847.csv", submittedAt: "2026-10-07T17:35:10.000Z" });
  });

  it("production: a subject without PRE is reported prod but NOT verified (U-65), and flagged", () => {
    const body = "The file Sale_413541_20261107230000_20261108T93012.csv you submitted has been processed. Date Submitted: 11/8/2026 9:30:00 AM";
    const a = classifyCcrsMail(asTick(gmail({ id: "p1", subject: "CCRS Processing Successful", text: body })));
    expect(a.kind).toBe("success");
    expect(a.env).toBe("prod");
    expect(a.envVerified).toBe(false);
    expect(a.needsHuman.join(" ")).toMatch(/U-65/);
  });

  it("an unfamiliar subject decides nothing: env null, owner chooses", () => {
    const body = "The file Sale_413541_20261107230000_20261108T93012.csv you submitted has been processed.";
    const a = classifyCcrsMail(asTick(gmail({ id: "p2", subject: "CCRS: File processed", text: body })));
    expect(a.kind).toBe("success");
    expect(a.env).toBeNull();
    expect(a.needsHuman.join(" ")).toMatch(/choose PREprod or production/);
  });
});

describe("every REAL error CSV, attached as Gmail attaches it", () => {
  it.each(ERROR_FILES.map((f) => [path.basename(f), f]))("%s -> kind error, right file type, its message", (_name, f) => {
    const csv = read(f);
    const name = path.basename(f);
    const m = asTick(gmail({ id: `e${name.length}${csv.length}`, subject: "PRE: CCRS Processing Error", text: "See attached.", attachments: [{ filename: name, text: csv }] }));
    const a = classifyCcrsMail(m);
    expect(a.kind).toBe("error");
    expect(a.errors).toHaveLength(1);
    const want = name.match(/^(InventoryAdjustment|Inventory|Product|Strain|Area|Sale)_/)![1];
    expect(a.errors[0].fileType).toBe(want);
    expect(a.errors[0].typeProblem).toBeNull();
    // every message read is a known CCRS message, verbatim (the comma-split P20261005A rows included)
    for (const msg of a.errors[0].messages) expect(CCRS_KNOWN_MESSAGES.map((k) => k.text)).toContain(msg);
    expect(a.errors[0].dataLines).toBe(csv.split(/\r\n/).filter(Boolean).length - 1);
  });

  it("the error SUBJECT never decides the env (U-66): only a PRE prefix is a hint", () => {
    const csv = read(ERROR_FILES[0]);
    for (const [subj, env] of [["Anything at all", null], ["PRE: something", "preprod"]] as const) {
      const a = classifyCcrsMail(asTick(gmail({ id: `x${subj.length}`, subject: subj, attachments: [{ filename: path.basename(ERROR_FILES[0]), text: csv }] })));
      expect(a.kind).toBe("error");
      expect(a.env).toBe(env);
      expect(a.envVerified).toBe(false);
    }
  });

  it("whatever MIME type CCRS uses, a .csv attachment is read (inline data too)", () => {
    const csv = read(ERROR_FILES[1]);
    for (const mt of ["text/csv", "application/octet-stream", "application/vnd.ms-excel", "text/plain", "application/x-unknown"]) {
      const a = classifyCcrsMail(asTick(gmail({ id: `mt${mt.length}`, subject: "x", attachments: [{ filename: path.basename(ERROR_FILES[1]), mimeType: mt, text: csv, inline: mt === "text/plain" }] })));
      expect(a.kind, mt).toBe("error");
    }
  });

  it("a non-CSV or oversized attachment is named, never silently dropped", () => {
    expect(wantAttachment({ filename: "Errors.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 10, attachmentId: "a", inlineData: null })).toBe(false);
    expect(wantAttachment({ filename: "Area__x.csv", mimeType: "text/csv", size: MAX_ATTACHMENT_BYTES + 1, attachmentId: "a", inlineData: null })).toBe(false);
    const a = classifyCcrsMail(asTick(gmail({ id: "xl", subject: "x", attachments: [{ filename: "Errors.xlsx", mimeType: "application/vnd.ms-excel.sheet", text: "PK" }] })));
    expect(a.kind).toBe("unknown");
    expect(a.needsHuman.join(" ")).toMatch(/not downloaded.*Errors\.xlsx/);
  });

  it("several error CSVs in one email are each read", () => {
    const atts = ERROR_FILES.slice(0, 3).map((f) => ({ filename: path.basename(f), text: read(f) }));
    const a = classifyCcrsMail(asTick(gmail({ id: "multi", subject: "x", attachments: atts })));
    expect(a.kind).toBe("error");
    expect(a.errors.map((e) => e.fileType)).toEqual(["Area", "Area", "InventoryAdjustment"]);
  });

  it("a name/header disagreement is flagged, not trusted", () => {
    const csv = read(`${RUN}/errors/Strain_20260917T125413969.csv`);
    const a = classifyCcrsMail(asTick(gmail({ id: "mis", subject: "x", attachments: [{ filename: "Inventory__20260917T1.csv", text: csv }] })));
    expect(a.errors[0].fileType).toBeNull();
    expect(a.needsHuman.join(" ")).toMatch(/name says Inventory but the header lacks/);
  });

  it("a CSV without ErrorMessage is not an error file", () => {
    expect(readErrorAttachment("Area__x.csv", "LicenseNumber,Area\r\n413541,X\r\n")).toBeNull();
    const a = classifyCcrsMail(asTick(gmail({ id: "noerr", subject: "x", attachments: [{ filename: "Area__x.csv", text: "LicenseNumber,Area\r\n" }] })));
    expect(a.kind).toBe("unknown");
    expect(a.otherAttachments).toEqual(["Area__x.csv"]);
  });

  it("the Strain error file uses ONE underscore and still types as Strain; longest type name wins", () => {
    expect(errorFileType("Strain_20260917T125413969.csv", ["LicenseNumber", "Strain", "ErrorMessage"]).type).toBe("Strain");
    expect(errorFileType("InventoryAdjustment__1.csv", ["LicenseNumber", "ExternalIdentifier", "ErrorMessage"]).type).toBe("InventoryAdjustment");
    expect(errorFileType("Bogus__1.csv", ["ErrorMessage"]).type).toBeNull();
  });

  it("knownCcrsMessage reads the comma-split P20261005A rows by their known text", () => {
    const lines = read(`${EV}/P20261005A/Product__20261006T113333390.csv`).split(/\r\n/).filter(Boolean).slice(1);
    expect(lines).toHaveLength(3);
    for (const l of lines) expect(knownCcrsMessage(l)).toBe("Operation is invalid must be Insert, Update or Delete");
    expect(knownCcrsMessage("nothing here")).toBeNull();
    // Cell count EQUAL to the header by accident (the comma inside the message
    // plays the missing trailing cell): the ErrorMessage cell holds only
    // "Operation is invalid must be Insert". The known full text must win.
    const e = readErrorAttachment("Strain_20261108T093000001.csv", "LicenseNumber,Strain,ErrorMessage\r\n413541,Operation is invalid must be Insert, Update or Delete\r\n")!;
    expect(e.messages).toEqual(["Operation is invalid must be Insert, Update or Delete"]);
  });
});

describe("sender and authenticity", () => {
  it("only info@lcb.wa.gov is CCRS; look-alikes are not-ccrs", () => {
    for (const f of ["LCB <info@lcb.wa.gov.evil.com>", "info@lcb-wa.gov", "\"info@lcb.wa.gov\" <phish@evil.com>", null]) {
      const a = classifyCcrsMail(asTick(gmail({ id: `f${String(f).length}`, from: f ?? "", subject: "PRE: CCRS Processing Successful", text: "The file Strain_413541_20261006222847_2026107T103687.csv you submitted has been processed." })));
      expect(a.kind, String(f)).toBe("not-ccrs");
    }
    expect(senderAddress("info@lcb.wa.gov <INFO@LCB.WA.GOV>")).toBe("info@lcb.wa.gov");
  });
  it("Authentication-Results: aligned pass, not aligned, DMARC fail, absent", () => {
    expect(authVerdict([REAL_AUTH])).toBe("aligned-pass");
    expect(authVerdict(["mx.google.com; dkim=pass header.i=@amazonses.com; spf=pass smtp.mailfrom=bounce@amazonses.com"])).toBe("not-aligned");
    expect(authVerdict(["mx.google.com; dkim=pass header.i=@lcb.wa.gov.evil.com"])).toBe("not-aligned");
    expect(authVerdict(["mx.google.com; spf=pass smtp.mailfrom=bounce@mail.lcb.wa.gov"])).toBe("aligned-pass");
    expect(authVerdict(["mx.google.com; dmarc=fail (p=NONE) header.from=lcb.wa.gov"])).toBe("dmarc-fail");
    expect(authVerdict([])).toBe("absent");
  });
  it("DMARC fail and Spam are shown as reasons to look, never silently applied or blocked", () => {
    const a = classifyCcrsMail(
      asTick(gmail({ id: "sp", subject: "PRE: CCRS Processing Successful", labelIds: ["SPAM"], auth: ["mx.google.com; dmarc=fail header.from=lcb.wa.gov"], text: "The file Strain_413541_20261006222847_2026107T103687.csv you submitted has been processed." })),
    );
    expect(a.kind).toBe("success");
    expect(a.inSpam).toBe(true);
    expect(a.auth).toBe("dmarc-fail");
    expect(a.needsHuman.join(" ")).toMatch(/Spam.*FAQ L0102/);
    expect(a.needsHuman.join(" ")).toMatch(/DMARC FAIL/);
  });
});

describe("which uploaded file an error answers: proven row by row", () => {
  const sent = read(`${EV}/P20261005A/SENT_Product_413541_20261005182936.csv`);
  const echo = read(`${EV}/P20261005A/Product__20261006T113333390.csv`);
  const att = readErrorAttachment("Product__20261006T113333390.csv", echo)!;
  const real: EchoCandidate = { fileId: "f-real", fileName: "Product_413541_20261005182936.csv", env: "preprod", fileType: "Product", state: "uploaded", rows: rowsOf("Product", sent) };
  const other: EchoCandidate = { fileId: "f-other", fileName: "Product_413541_20261006124018.csv", env: "preprod", fileType: "Product", state: "uploaded", rows: [{ rowNo: 1, externalId: "GWP-OTHER", operation: "Insert" }] };

  it("the real P20261005A echo picks the file we sent, rows 1, 4, 7", () => {
    const p = pickEchoFile(att, [other, real], null);
    expect(p.kind).toBe("unique");
    if (p.kind === "unique") {
      expect(p.fileId).toBe("f-real");
      expect(p.verdict.rejected.map((r) => r.row_no)).toEqual([1, 4, 7]);
    }
  });
  it("a file not waiting, of another type, or another env is never a candidate", () => {
    expect(pickEchoFile(att, [{ ...real, state: "succeeded" }], null).kind).toBe("none");
    expect(pickEchoFile(att, [{ ...real, fileType: "Inventory" }], null).kind).toBe("none");
    expect(pickEchoFile(att, [real], "prod").kind).toBe("none");
  });
  it("two files that both fit -> ambiguous; the owner's choice must be one that fits", () => {
    const twin = { ...real, fileId: "f-twin", fileName: "Product_413541_20261005190000.csv" };
    expect(pickEchoFile(att, [real, twin], null).kind).toBe("ambiguous");
    const chosen = resolveEchoPick(att, [real, twin], "f-twin");
    expect(chosen.kind === "unique" && chosen.fileId).toBe("f-twin");
    expect(resolveEchoPick(att, [real, twin, other], "f-other").kind).toBe("none");
    // with a unique proof, a different choice is refused
    expect(resolveEchoPick(att, [real, other], "f-other").kind).toBe("none");
    expect(resolveEchoPick(att, [real, other], "f-real").kind).toBe("unique");
  });
  it("stored CSVs rebuild the same attachments", () => {
    const back = errorsFromStored([{ filename: "Product__20261006T113333390.csv", text: echo }, { filename: "notes.csv", text: "a,b\r\n" }]);
    expect(back).toHaveLength(1);
    expect(back[0].messages).toEqual(att.messages);
  });
});

describe("applying: env and time rules", () => {
  it("a verified subject decides the env; a contradicting choice is refused", () => {
    expect(planSuccessEnv({ kind: "success", env: "preprod", envVerified: true }, null, false)).toEqual({ ok: true, env: "preprod" });
    expect(planSuccessEnv({ kind: "success", env: "preprod", envVerified: true }, "prod", true).ok).toBe(false);
  });
  it("an unverified prod subject needs the owner's tick (U-65)", () => {
    expect(planSuccessEnv({ kind: "success", env: "prod", envVerified: false }, null, false).ok).toBe(false);
    expect(planSuccessEnv({ kind: "success", env: "prod", envVerified: false }, null, true)).toEqual({ ok: true, env: "prod" });
    expect(planSuccessEnv({ kind: "success", env: "prod", envVerified: false }, "preprod", true).ok).toBe(false);
  });
  it("no env: the owner must choose AND tick", () => {
    expect(planSuccessEnv({ kind: "success", env: null, envVerified: false }, null, true).ok).toBe(false);
    expect(planSuccessEnv({ kind: "success", env: null, envVerified: false }, "prod", false).ok).toBe(false);
    expect(planSuccessEnv({ kind: "success", env: null, envVerified: false }, "prod", true)).toEqual({ ok: true, env: "prod" });
    expect(planSuccessEnv({ kind: "error", env: "preprod", envVerified: true }, null, true).ok).toBe(false);
  });
  it("the recorded time: CCRS's time, never before our upload, never in the future", () => {
    const now = Date.parse("2026-11-08T20:00:00Z");
    expect(applyTimeISO("2026-11-08T17:00:00Z", "2026-11-08T17:01:00Z", now)).toBe("2026-11-08T17:01:00.000Z");
    expect(applyTimeISO("2026-11-08T17:00:00Z", "2026-11-08T16:00:00Z", now)).toBe("2026-11-08T17:00:00.000Z");
    expect(applyTimeISO("2026-11-08T17:00:00Z", "2026-11-09T00:00:00Z", now)).toBe("2026-11-08T20:00:00.000Z");
    expect(applyTimeISO("2026-11-08T17:00:00Z", null, now)).toBe("2026-11-08T20:00:00.000Z");
    expect(applyTimeISO(null, "2026-11-08T17:01:00Z", now)).toBeNull();
  });
});

describe("what is stored", () => {
  it("toMailRow keeps CSVs whole, strips them from the analysis, caps body and subject", () => {
    const csv = read(ERROR_FILES[0]);
    const m = asTick(gmail({ id: "st1", subject: "S".repeat(900), text: "x".repeat(30_000), attachments: [{ filename: path.basename(ERROR_FILES[0]), text: csv }] }));
    const row = toMailRow("michael@greenwaymarijuana.com", m, classifyCcrsMail(m));
    expect(row.csvs[0].text).toBe(csv);
    expect(JSON.stringify(row.analysis)).not.toContain("413541,Sales Floor");
    expect(row.body_text.length).toBe(20_000);
    expect(row.subject.length).toBe(500);
    expect(row.received_at).toBe("2026-11-08T19:00:00.000Z");
    expect(row.kind).toBe("error");
  });
  it("internalDate (epoch ms) is the received time; a message without an id is refused", () => {
    expect(() => normalizeGmailMessage({ payload: {} }, [], [])).toThrow(/no id/);
    expect(normalizeGmailMessage({ id: "z", internalDate: "garbage" }, [], []).receivedAt).toBeNull();
  });
});

describe("heartbeat (AGENTS rule 12: a quiet tick writes nothing)", () => {
  const hb: MailHeartbeat = { lastRunAt: "2026-11-08T12:00:00.000Z", lastOkAt: "2026-11-08T12:00:00.000Z", ok: true, error: null, mode: "service-account", newMessages: 0 };
  const t = (min: number) => Date.parse("2026-11-08T12:00:00Z") + min * 60_000;
  it("writes first time, on change, on new mail, and every 30 minutes; not otherwise", () => {
    expect(shouldWriteHeartbeat(null, hb, t(0))).toBe(true);
    expect(shouldWriteHeartbeat(hb, { ...hb, lastRunAt: "x" }, t(25))).toBe(false);
    expect(shouldWriteHeartbeat(hb, hb, t(30))).toBe(true);
    expect(shouldWriteHeartbeat(hb, { ...hb, newMessages: 1 }, t(5))).toBe(true);
    expect(shouldWriteHeartbeat(hb, { ...hb, ok: false, error: "x" }, t(5))).toBe(true);
    expect(shouldWriteHeartbeat({ ...hb, ok: false, error: "x" }, { ...hb, ok: false, error: "x" }, t(5))).toBe(false);
  });
  it("stale after 45 minutes without a check", () => {
    expect(heartbeatStale(hb, t(45))).toBe(false);
    expect(heartbeatStale(hb, t(46))).toBe(true);
    expect(heartbeatStale(null, t(0))).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * The fetch client against a mocked Google (real RSA signature).
 * ------------------------------------------------------------------ */
describe("ccrs-mail-fetch against a mocked Google", () => {
  afterEach(() => vi.unstubAllGlobals());
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  it("service account: an RS256 JWT for the mailbox, gmail.readonly, 1 hour, verifiable with the public key", async () => {
    const { getGmailAccessToken } = await import("@/lib/compliance/ccrs-mail-fetch");
    let posted = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(GOOGLE_TOKEN_URL);
      posted = String(init.body);
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3599 }), { status: 200 });
    }));
    const cfg = mailConfigFromEnv({ GMAIL_SA_CLIENT_EMAIL: "mon@gw.iam.gserviceaccount.com", GMAIL_SA_PRIVATE_KEY: pem.replace(/\n/g, "\\n") });
    if (!cfg.configured) throw new Error("cfg");
    const tok = await getGmailAccessToken(cfg, 1_800_000_000_000);
    expect(tok).toBe("tok");
    const form = new URLSearchParams(posted);
    expect(form.get("grant_type")).toBe(JWT_BEARER_GRANT);
    const [h, c, s] = form.get("assertion")!.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(c, "base64url").toString());
    expect(claims).toEqual({ iss: "mon@gw.iam.gserviceaccount.com", sub: "michael@greenwaymarijuana.com", scope: GMAIL_READONLY_SCOPE, aud: GOOGLE_TOKEN_URL, iat: 1_800_000_000, exp: 1_800_003_600 });
    const v = createVerify("RSA-SHA256");
    v.update(`${h}.${c}`);
    expect(v.verify(publicKey, Buffer.from(s, "base64url"))).toBe(true);
  });

  it("a refused grant surfaces Google's error with the setup hint", async () => {
    const { getGmailAccessToken } = await import("@/lib/compliance/ccrs-mail-fetch");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "unauthorized_client", error_description: "Client is unauthorized" }), { status: 401 })));
    const cfg = mailConfigFromEnv({ GMAIL_SA_CLIENT_EMAIL: "mon@gw.iam.gserviceaccount.com", GMAIL_SA_PRIVATE_KEY: pem });
    if (!cfg.configured) throw new Error("cfg");
    await expect(getGmailAccessToken(cfg)).rejects.toThrow(/unauthorized_client.*domain-wide delegation/);
  });

  it("OAuth refresh-token mode posts the refresh grant", async () => {
    const { getGmailAccessToken } = await import("@/lib/compliance/ccrs-mail-fetch");
    let posted = "";
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      posted = String(init.body);
      return new Response(JSON.stringify({ access_token: "t2", expires_in: 3599 }), { status: 200 });
    }));
    const cfg = mailConfigFromEnv({ GMAIL_OAUTH_CLIENT_ID: "cid", GMAIL_OAUTH_CLIENT_SECRET: "sec", GMAIL_OAUTH_REFRESH_TOKEN: "rt" });
    if (!cfg.configured) throw new Error("cfg");
    expect(await getGmailAccessToken(cfg)).toBe("t2");
    expect(Object.fromEntries(new URLSearchParams(posted))).toEqual({ grant_type: "refresh_token", client_id: "cid", client_secret: "sec", refresh_token: "rt" });
  });

  it("messages.list: q, includeSpamTrash, paging; attachments.get decodes base64url", async () => {
    const { listMessageIds, getAttachmentText, getMessage } = await import("@/lib/compliance/ccrs-mail-fetch");
    const urls: string[] = [];
    const csv = read(ERROR_FILES[0]);
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      urls.push(url);
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
      const u = new URL(url);
      if (u.pathname.endsWith("/messages") && !u.searchParams.get("pageToken")) return new Response(JSON.stringify({ messages: [{ id: "m2" }, { id: "m1" }], nextPageToken: "P2" }));
      if (u.pathname.endsWith("/messages")) return new Response(JSON.stringify({ messages: [{ id: "m0" }] }));
      if (u.pathname.includes("/attachments/")) return new Response(JSON.stringify({ size: csv.length, data: b64u(csv) }));
      if (u.pathname.endsWith("/messages/m1")) return new Response(JSON.stringify({ id: "m1" }));
      return new Response("{}", { status: 404 });
    }));
    const r = await listMessageIds("tok", "michael@greenwaymarijuana.com", "from:info@lcb.wa.gov after:1");
    expect(r).toEqual({ ids: ["m2", "m1", "m0"], truncated: false });
    const first = new URL(urls[0]);
    expect(first.pathname).toBe("/gmail/v1/users/michael%40greenwaymarijuana.com/messages");
    expect(first.searchParams.get("q")).toBe("from:info@lcb.wa.gov after:1");
    expect(first.searchParams.get("includeSpamTrash")).toBe("true");
    expect(new URL(urls[1]).searchParams.get("pageToken")).toBe("P2");
    expect(await getAttachmentText("tok", "michael@greenwaymarijuana.com", "m1", { filename: "a.csv", mimeType: "text/csv", size: 1, attachmentId: "A1", inlineData: null })).toBe(csv);
    expect((await getMessage("tok", "michael@greenwaymarijuana.com", "m1")).id).toBe("m1");
    expect(urls[urls.length - 1]).toContain("format=full");
    await expect(getMessage("tok", "michael@greenwaymarijuana.com", "nope")).rejects.toThrow(/HTTP 404/);
  });
});

/* ------------------------------------------------------------------ *
 * Migration 0282, cron, wiring, panel.
 * ------------------------------------------------------------------ */
describe("migration 0282", () => {
  const MIG = read("supabase/migrations/0282_ccrs_mail_messages.sql");
  const RB = read("supabase/rollbacks/0282_ccrs_mail_messages.rollback.sql");
  const PGC = read("scripts/recon/ccrs-mail-0282-pg-check.sql");
  it("one row per (mailbox, Gmail id): the insert is the claim", () => {
    expect(MIG).toMatch(/constraint ccrs_mail_messages_gmail_once unique \(mailbox, gmail_id\)/);
  });
  it("vocabularies match the TS types exactly", () => {
    expect(MIG).toContain("check (kind in ('success', 'error', 'unknown', 'not-ccrs'))");
    expect(MIG).toContain("check (env is null or env in ('preprod', 'prod'))");
    expect(MIG).toContain("check (auth in ('aligned-pass', 'not-aligned', 'dmarc-fail', 'absent'))");
    expect(MIG).toContain("check (state in ('new', 'applied', 'dismissed'))");
  });
  it("received fields immutable, handled once, never deleted; guard not security definer", () => {
    expect(MIG).toMatch(/CCRS_MAIL_IMMUTABLE/);
    expect(MIG).toMatch(/CCRS_MAIL_HANDLED/);
    expect(MIG).toMatch(/tg_op = 'DELETE'[\s\S]*CCRS_MAIL_KEPT/);
    expect(MIG).toMatch(/before update or delete on public\.ccrs_mail_messages/);
    expect(MIG).not.toMatch(/security definer/i);
    expect(MIG).toMatch(/set search_path = public, pg_temp/);
  });
  it("RLS on: staff read, admin write", () => {
    expect(MIG).toMatch(/enable row level security/);
    expect(MIG).toMatch(/for select using \(public\.is_staff\(\)\)/);
    expect(MIG).toMatch(/for all using \(public\.is_admin\(\)\) with check \(public\.is_admin\(\)\)/);
  });
  it("rollback drops only 0282's objects; the pg-check runs after every CI apply", async () => {
    expect(RB).toMatch(/drop table if exists public\.ccrs_mail_messages/);
    expect(RB).not.toMatch(/drop table if exists public\.ccrs_files\b/);
    expect(PGC).toContain("CCRS 0282 CHECK PASSED");
    const { POST_APPLY_CHECKS } = await import("../../scripts/compliance/verify-migrations-execute");
    expect(POST_APPLY_CHECKS).toContainEqual({ file: "scripts/recon/ccrs-mail-0282-pg-check.sql", mustPrint: "CCRS 0282 CHECK PASSED" });
  });
  it("the store's columns exist in the migration", () => {
    const store = read("src/lib/compliance/ccrs-mail-store.ts");
    const cols = /const COLS =\s*"([^"]+)"/.exec(store)![1].split(",").map((c) => c.trim());
    for (const c of cols) expect(MIG, c).toMatch(new RegExp(`\\n  ${c}\\s`));
  });
});

describe("cron route and schedule (AGENTS rule 12)", () => {
  const ROUTE = read("src/app/api/cron/ccrs-mail/route.ts");
  const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
  it("runs every 5 minutes at :04, off every other 5-minute cron", () => {
    const c = vercel.crons.find((x) => x.path === "/api/cron/ccrs-mail");
    expect(c?.schedule).toBe("4-59/5 * * * *");
    const schedules = vercel.crons.map((x) => x.schedule);
    expect(new Set(schedules).size).toBe(schedules.length);
  });
  it("fail-closed auth copied from cutover-watch; GET and POST; 500 only for a configured failure", () => {
    expect(ROUTE).toMatch(/shouldRefuseWhenSecretMissing\(secret\)/);
    expect(ROUTE).toMatch(/header === `Bearer \$\{secret\}`/);
    expect(ROUTE).toMatch(/export async function GET/);
    expect(ROUTE).toMatch(/export async function POST/);
    expect(ROUTE).toMatch(/result\.ok \|\| !result\.configured \? 200 : 500/);
  });
  it("the store claims by insert and writes the heartbeat only when shouldWriteHeartbeat says so", () => {
    const store = read("src/lib/compliance/ccrs-mail-store.ts");
    expect(store).toMatch(/onConflict: "mailbox,gmail_id", ignoreDuplicates: true/);
    expect(store).toMatch(/if \(shouldWriteHeartbeat\(prev, next, nowMs\)\) await writeHeartbeat/);
    expect(store).not.toMatch(/recordOutcome|ccrs_record_outcome/);
  });
});

describe("drafts-only (standing rule 3): only the owner's Apply writes the ledger", () => {
  const ACT = read("src/app/admin/compliance/ccrs/mail-actions.ts");
  it("every action is settings.manage; every ledger write is audited", () => {
    const fns = ACT.split(/export async function /).slice(1);
    expect(fns.map((f) => f.split("(")[0])).toEqual([
      "pollCcrsMailNowAction",
      "applyCcrsSuccessMailAction",
      "applyCcrsErrorMailAction",
      // R74 S47: a body-only "has not been processed" email -> error-fatal (audited).
      "applyCcrsNotProcessedMailAction",
      "dismissCcrsMailAction",
    ]);
    for (const f of fns) expect(f).toMatch(/requirePermission\("settings\.manage"\)/);
    expect((ACT.match(/recordOutcome\(/g) ?? []).length).toBe(3);
    expect(ACT).toMatch(/action: "ccrs\.file\.error-fatal"/);
    expect((ACT.match(/action: "ccrs\.file\.success"/g) ?? []).length).toBe(1);
    expect(ACT).toMatch(/action: `ccrs\.file\.\$\{pick\.verdict\.outcome\}`/);
    expect(ACT).toMatch(/action: "ccrs\.mail\.dismissed"/);
  });
  it("names are re-read from the stored body; error files are re-proven, all-or-nothing", () => {
    expect(ACT).toMatch(/parseSuccessEmails\(mail\.body_text\)/);
    expect(ACT).toMatch(/errorsFromStored\(mail\.csvs/);
    expect(ACT).toMatch(/if \(bad\.length\) \{[\s\S]*Nothing recorded/);
  });
  it("set aside needs a reason of at least 5 characters, checked before anything is written", () => {
    const d = ACT.split("export async function dismissCcrsMailAction")[1];
    expect(d).toMatch(/if \(reason\.length < 5\) backMail\(weekKey, errQ\(/);
    expect(d.indexOf("reason.length < 5")).toBeLessThan(d.indexOf("markCcrsMailHandled("));
  });
  it("markCcrsMailHandled updates only a row still 'new' (a double click is a no-op)", async () => {
    const { markCcrsMailHandled } = await import("@/lib/compliance/ccrs-mail-store");
    const calls: [string, unknown[]][] = [];
    const chain: Record<string, (...a: unknown[]) => unknown> = {};
    for (const m of ["from", "update", "eq", "neq", "is", "in", "match", "filter"]) chain[m] = (...a: unknown[]) => (calls.push([m, a]), chain);
    chain.select = (...a: unknown[]) => (calls.push(["select", a]), Promise.resolve({ data: [], error: null }));
    const changed = await markCcrsMailHandled(chain as never, "id-1", "dismissed", "p-1", "not ours");
    expect(changed).toBe(false);
    const filters = calls.filter(([m]) => !["from", "update", "select"].includes(m));
    expect(filters).toEqual([["eq", ["id", "id-1"]], ["eq", ["state", "new"]]]);
  });
  it("the pinned S-12c paste actions are untouched (they live in actions.ts, not here)", () => {
    expect(read("src/app/admin/compliance/ccrs/actions.ts")).not.toMatch(/ccrs-mail/);
  });
});

describe("the hub panel", () => {
  const base = {
    available: true,
    loadError: null,
    heartbeat: { lastRunAt: "2026-11-08T19:59:00.000Z", lastOkAt: "2026-11-08T19:59:00.000Z", ok: true, error: null, mode: "service-account" as const, newMessages: 0 },
    uploadedFiles: [],
    canEdit: true,
    weekKey: "2026-11-01",
    nowISO: "2026-11-08T20:00:00.000Z",
    actions: { poll: async () => {}, applySuccess: async () => {}, applyError: async () => {}, dismiss: async () => {} },
  };
  const setup = { configured: true as const, mode: "service-account", mailbox: "michael@greenwaymarijuana.com" };
  const row = (over: Partial<CcrsMailPanelRow>): CcrsMailPanelRow => ({
    id: "11111111-1111-1111-1111-111111111111",
    gmail_id: "g1",
    received_at: "2026-11-08T19:00:00.000Z",
    subject: "PRE: CCRS Processing Successful",
    kind: "success",
    env: "preprod",
    env_verified: true,
    auth: "aligned-pass",
    in_spam: false,
    analysis: { successes: [{ fileName: "Strain_413541_20261107230000.csv", submittedAt: "2026-11-08T18:59:00.000Z" }], needsHuman: [] },
    state: "new",
    handled_note: null,
    ...over,
  });
  const html = (p: Partial<Parameters<typeof CcrsMailPanel>[0]>) => renderToStaticMarkup(createElement(CcrsMailPanel, { ...base, setup, rows: [], ...p }));

  it("not set up: says so, names what is missing, offers no mailbox button", () => {
    const h = html({ setup: { configured: false, mailbox: "michael@greenwaymarijuana.com", missing: ["GMAIL_SA_CLIENT_EMAIL", "GMAIL_SA_PRIVATE_KEY"], problem: null } });
    expect(h).toContain('data-testid="ccrs-mail-not-setup"');
    expect(h).toContain("GMAIL_SA_CLIENT_EMAIL");
    expect(h).not.toContain("Check the mailbox now");
  });
  it("stale or failing: a red warning to check Gmail by hand", () => {
    expect(html({ heartbeat: { ...base.heartbeat, lastRunAt: "2026-11-08T19:00:00.000Z" } })).toContain('data-testid="ccrs-mail-unhealthy"');
    expect(html({ heartbeat: { ...base.heartbeat, ok: false, error: "invalid_grant" } })).toContain("invalid_grant");
  });
  it("a verified confirmation: one Apply, no env picker, no tick box", () => {
    const h = html({ rows: [row({})] });
    expect(h).toContain("Apply confirmation");
    expect(h).toContain("Strain_413541_20261107230000.csv");
    expect(h).not.toContain('name="env"');
    expect(h).not.toContain("confirm_checked");
  });
  it("an unverified production confirmation asks for the tick; no env asks for the choice too", () => {
    const p = html({ rows: [row({ env: "prod", env_verified: false, subject: "CCRS Processing Successful" })] });
    expect(p).toContain("production (not yet verified)");
    expect(p).toContain("confirm_checked");
    expect(p).not.toContain('name="env"');
    const n = html({ rows: [row({ env: null, env_verified: false })] });
    expect(n).toContain('name="env"');
  });
  it("an error email lists each file and message; the file picker appears only when more than one fits", () => {
    const err = row({ kind: "error", subject: "x", analysis: { errors: [{ filename: "Product__1.csv", fileType: "Product", typeProblem: null, dataLines: 3, messages: ["Operation is invalid must be Insert, Update or Delete"] }], needsHuman: [] } });
    const one = html({ rows: [err], uploadedFiles: [{ id: "a", fileName: "Product_413541_1.csv", fileType: "Product", env: "preprod" }] });
    expect(one).toContain("Apply error file");
    expect(one).toContain("Operation is invalid must be Insert, Update or Delete");
    expect(one).not.toContain('name="file_0"');
    const two = html({ rows: [err], uploadedFiles: [{ id: "a", fileName: "Product_413541_1.csv", fileType: "Product", env: "preprod" }, { id: "b", fileName: "Product_413541_2.csv", fileType: "Product", env: "preprod" }] });
    expect(two).toContain('name="file_0"');
  });
  it("every reason to look is listed on the item", () => {
    const h = html({ rows: [row({ analysis: { successes: [], needsHuman: ["Gmail put this in Spam. Mark it", "second reason here"] }, kind: "unknown" })] });
    expect(h).toContain('data-testid="ccrs-mail-needs-human"');
    expect(h).toContain("Gmail put this in Spam. Mark it");
    expect(h).toContain("second reason here");
  });
  it("read-only staff see the mail but no buttons; DMARC fail is shown in red", () => {
    const h = html({ canEdit: false, rows: [row({ auth: "dmarc-fail" })] });
    expect(h).not.toContain("Apply confirmation");
    expect(h).not.toContain("Set aside");
    expect(h).toContain("DMARC FAIL");
  });
  it("the page mounts the panel with the mail actions", () => {
    const page = read("src/app/admin/compliance/ccrs/page.tsx");
    expect(page).toMatch(/<CcrsMailPanel/);
    expect(page).toMatch(/applySuccess: applyCcrsSuccessMailAction/);
    expect(page).toMatch(/applyError: applyCcrsErrorMailAction/);
  });
});

describe("environment documentation", () => {
  it(".env.example documents every variable mailConfigFromEnv reads", () => {
    const ex = read(".env.example");
    for (const v of ["CCRS_MAILBOX_ADDRESS", "CCRS_MAIL_LOOKBACK_HOURS", "GMAIL_SA_CLIENT_EMAIL", "GMAIL_SA_PRIVATE_KEY", "GMAIL_OAUTH_CLIENT_ID", "GMAIL_OAUTH_CLIENT_SECRET", "GMAIL_OAUTH_REFRESH_TOKEN", "GMAIL_WIF_SERVICE_ACCOUNT_EMAIL", "GMAIL_WIF_PROJECT_NUMBER", "GMAIL_WIF_POOL_ID", "GMAIL_WIF_PROVIDER_ID"]) {
      expect(ex, v).toMatch(new RegExp(`^${v}=`, "m"));
    }
  });
});

describe("pure self-test", () => {
  it("__runCcrsMailCoreTests passes", () => {
    const r = __runCcrsMailCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(30);
  });
});
