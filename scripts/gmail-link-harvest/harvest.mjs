#!/usr/bin/env node
/**
 * scripts/gmail-link-harvest/harvest.mjs — Slice H11c
 *
 * LOCAL, OWNER-RUN Gmail harvester for Cultivera "WCIA Transfer Data Link"
 * URLs. Searches your Gmail for the vendor order emails, extracts every
 * transfer JSON link from the message bodies, de-duplicates them (collapsing
 * the doubled-prefix bug), and writes:
 *
 *   transfer-links.txt  — one URL per line → paste into the back office
 *                         "Batch import — paste many Transfer Data Links"
 *   transfer-links.csv  — date, from, subject, url (audit trail)
 *
 * SECURITY MODEL (why this is safe):
 *   • Runs ONLY on your machine. Your Google password is never typed here —
 *     you sign in in your own browser via Google's standard OAuth consent
 *     screen, and this script receives a token scoped to READ-ONLY Gmail
 *     access (gmail.readonly). It cannot send, delete, or modify anything.
 *   • Zero npm dependencies: only Node.js built-ins (node:http, node:crypto,
 *     global fetch). Nothing to install, no supply chain to trust.
 *   • The OAuth token is cached in token.json IN THIS FOLDER so re-runs skip
 *     the browser step. Delete token.json to revoke locally; revoke fully at
 *     https://myaccount.google.com/permissions.
 *   • This script never touches the store's database or website. Its only
 *     output is text files you review and paste yourself (drafts-only
 *     philosophy end-to-end).
 *
 * REQUIREMENTS: Node.js 18+ (`node --version`), a Google Cloud OAuth
 * "Desktop app" client saved as credentials.json in this folder.
 * See README.md next to this file for the full step-by-step setup.
 *
 * USAGE:
 *   node harvest.mjs                       # default: search "Transfer Data Link"
 *   node harvest.mjs --after 2024/01/01    # limit how far back to search
 *   node harvest.mjs --query 'from:cultivera.com "Transfer Data Link"'
 *   node harvest.mjs --all-json            # keep every .json link, not just Cultivera
 */

import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CREDENTIALS_PATH = join(HERE, "credentials.json");
const TOKEN_PATH = join(HERE, "token.json");
const OUT_TXT = join(HERE, "transfer-links.txt");
const OUT_CSV = join(HERE, "transfer-links.csv");

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

// ── CLI args ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { query: null, after: null, before: null, allJson: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--query") args.query = argv[++i] ?? null;
    else if (a === "--after") args.after = argv[++i] ?? null;
    else if (a === "--before") args.before = argv[++i] ?? null;
    else if (a === "--all-json") args.allJson = true;
    else if (a === "--self-test") args.selfTest = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage: node harvest.mjs [options]",
          "",
          "Options:",
          '  --query "<gmail search>"  Override the Gmail search (default: "Transfer Data Link")',
          "  --after YYYY/MM/DD        Only emails after this date",
          "  --before YYYY/MM/DD       Only emails before this date",
          "  --all-json                Keep every .json link found (default: Cultivera links only)",
          "  --self-test               Run the built-in extraction tests (no Gmail access)",
          "  --help                    Show this help",
        ].join("\n"),
      );
      process.exit(0);
    }
  }
  return args;
}

// ── OAuth (Desktop-app loopback + PKCE, no dependencies) ────────────────────
function loadCredentials() {
  if (!existsSync(CREDENTIALS_PATH)) {
    console.error(
      [
        "✗ credentials.json not found next to harvest.mjs.",
        "  Follow README.md: create a Google Cloud OAuth 'Desktop app' client and",
        `  download its JSON to: ${CREDENTIALS_PATH}`,
      ].join("\n"),
    );
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf8"));
  // Google downloads Desktop clients under the "installed" key.
  const c = raw.installed ?? raw.web ?? raw;
  if (!c.client_id || !c.client_secret) {
    console.error("✗ credentials.json is missing client_id/client_secret — re-download it.");
    process.exit(1);
  }
  return { clientId: c.client_id, clientSecret: c.client_secret };
}

function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Exchange or refresh tokens with Google's token endpoint. */
async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Token request failed (${res.status}): ${data.error ?? ""} ${data.error_description ?? ""}`);
  }
  return data;
}

/** Full browser sign-in: loopback redirect + PKCE. Returns token data. */
async function browserSignIn(creds) {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));

  // Loopback server on an OS-assigned free port (Google allows any port for
  // Desktop-app loopback redirects). redirectUri is captured once listening.
  let redirectUri = "";
  const code = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const gotState = url.searchParams.get("state");
      const gotCode = url.searchParams.get("code");
      const gotErr = url.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        gotCode && gotState === state
          ? "<h2>Signed in. You can close this tab and return to the terminal.</h2>"
          : `<h2>Sign-in failed${gotErr ? `: ${gotErr}` : ""}. Return to the terminal.</h2>`,
      );
      server.close();
      if (gotCode && gotState === state) resolve(gotCode);
      else reject(new Error(gotErr ?? "OAuth state mismatch — try again."));
    });
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      redirectUri = `http://127.0.0.1:${port}/callback`;
      const authUrl =
        `${AUTH_URL}?` +
        new URLSearchParams({
          client_id: creds.clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: SCOPE,
          access_type: "offline",
          prompt: "consent",
          code_challenge: challenge,
          code_challenge_method: "S256",
          state,
        }).toString();
      console.log("\n① Open this URL in your browser and sign in with the Gmail account");
      console.log("   that receives the Cultivera order emails:\n");
      console.log(`   ${authUrl}\n`);
      console.log("   (Waiting for you to finish signing in…)\n");
    });
    server.on("error", reject);
  });

  const token = await tokenRequest({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  return token;
}

/** Get a working access token: cached → refreshed → full browser sign-in. */
async function getAccessToken(creds) {
  if (existsSync(TOKEN_PATH)) {
    try {
      const saved = JSON.parse(readFileSync(TOKEN_PATH, "utf8"));
      if (saved.refresh_token) {
        const refreshed = await tokenRequest({
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
          grant_type: "refresh_token",
          refresh_token: saved.refresh_token,
        });
        return refreshed.access_token;
      }
    } catch {
      console.log("· Cached token didn't work — starting a fresh sign-in.");
    }
  }
  const token = await browserSignIn(creds);
  writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2));
  console.log(`② Signed in. Read-only token cached at ${TOKEN_PATH} (delete it to sign out).\n`);
  return token.access_token;
}

// ── Gmail API helpers ───────────────────────────────────────────────────────
async function gmailGet(path, accessToken) {
  const res = await fetch(`${GMAIL}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 429) {
    // Basic quota backoff, then one retry.
    await new Promise((r) => setTimeout(r, 2000));
    return gmailGet(path, accessToken);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail API ${res.status} on ${path}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

/** List ALL message ids matching the query (handles pagination). */
async function listMessageIds(query, accessToken) {
  const ids = [];
  let pageToken = null;
  do {
    const qs = new URLSearchParams({ q: query, maxResults: "100" });
    if (pageToken) qs.set("pageToken", pageToken);
    const data = await gmailGet(`/messages?${qs.toString()}`, accessToken);
    for (const m of data.messages ?? []) ids.push(m.id);
    pageToken = data.nextPageToken ?? null;
    process.stdout.write(`\r· Found ${ids.length} matching email(s)…`);
  } while (pageToken);
  process.stdout.write("\n");
  return ids;
}

/** Base64url-decode a Gmail body chunk. */
function decodeBody(data) {
  if (!data) return "";
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

/** Recursively collect every text/plain + text/html body in a message payload. */
function collectBodies(part, out) {
  if (!part) return;
  const mime = (part.mimeType ?? "").toLowerCase();
  if ((mime.startsWith("text/plain") || mime.startsWith("text/html")) && part.body?.data) {
    out.push(decodeBody(part.body.data));
  }
  for (const child of part.parts ?? []) collectBodies(child, out);
}

function header(payload, name) {
  const h = (payload?.headers ?? []).find(
    (x) => (x.name ?? "").toLowerCase() === name.toLowerCase(),
  );
  return h?.value ?? "";
}

// ── Link extraction ─────────────────────────────────────────────────────────
/** Collapse the Cultivera doubled-prefix bug (https://host/https://real/...). */
function collapseDoubledUrl(raw) {
  const s = raw.trim();
  const doubled = s.match(/^(https?:\/\/[^/]+\/)(https?:\/\/.+)$/i);
  return doubled ? doubled[2] : s;
}

/**
 * Pull candidate transfer links out of an email body. HTML entities like
 * &amp; are unescaped first; URLs end at whitespace/quotes/angle brackets.
 */
function extractJsonLinks(body, allJson) {
  const text = body
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
  const matches = text.match(/https?:\/\/[^\s"'<>()]+\.json\b/gi) ?? [];
  const links = [];
  for (const m of matches) {
    const collapsed = collapseDoubledUrl(m);
    if (!allJson && !/cultivera/i.test(collapsed)) continue;
    links.push(collapsed);
  }
  return links;
}

/** CSV-escape one field. */
function csv(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ── Self-test (pure — no Gmail access, no credentials needed) ───────────────
function selfTest() {
  let passed = 0;
  let failed = 0;
  const ok = (cond, msg) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL: ${msg}`);
    }
  };

  const real =
    "https://files.cultivera.com/435553542D5753353031/Interop/25/10/QZ60727TG6AE020G/Cultivera_ORD-20636_413541.json";

  // Doubled-prefix collapse (real bug from the order emails).
  ok(collapseDoubledUrl(`https://files.cultivera.com/${real}`) === real, "doubled prefix collapses");
  ok(collapseDoubledUrl(real) === real, "normal URL untouched");

  // Extraction from an HTML body with entities, keeping Cultivera links only.
  const html = `<a href="${real}">WCIA Transfer Data Link</a> <a href="https://other.example/x.json?a=1&amp;b=2">x</a>`;
  const cultiveraOnly = extractJsonLinks(html, false);
  ok(cultiveraOnly.length === 1 && cultiveraOnly[0] === real, "cultivera-only extraction");
  const all = extractJsonLinks(html, true);
  ok(all.length === 2, "--all-json keeps both");
  // Matches end at .json — real Cultivera transfer links carry no query
  // string (verified against a real order email), so trailing params drop.
  ok(all[1] === "https://other.example/x.json", ".json boundary respected");

  // Non-link bodies extract nothing.
  ok(extractJsonLinks("no links here", true).length === 0, "plain text yields nothing");

  // CSV escaping.
  ok(csv('a "b", c') === '"a ""b"", c"', "csv escapes quotes+commas");
  ok(csv("plain") === "plain", "csv passthrough");

  console.log(`Self-test: ${passed} passed, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  if (args.selfTest) selfTest();
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < 18) {
    console.error(`✗ Node ${process.versions.node} is too old — this script needs Node 18+.`);
    process.exit(1);
  }

  // Default search: the exact phrase every Cultivera order email contains
  // (verified against a real order email). Sender-agnostic on purpose — it
  // still matches if Cultivera changes their from-address.
  let query = args.query ?? '"Transfer Data Link"';
  if (args.after) query += ` after:${args.after}`;
  if (args.before) query += ` before:${args.before}`;

  console.log("Gmail Transfer-Link Harvester (read-only)");
  console.log(`· Search: ${query}\n`);

  const creds = loadCredentials();
  const accessToken = await getAccessToken(creds);

  const ids = await listMessageIds(query, accessToken);
  if (ids.length === 0) {
    console.log("No matching emails found. Try --query or widen --after/--before.");
    return;
  }

  const rows = []; // { date, from, subject, url }
  const seen = new Set();
  let processed = 0;
  for (const id of ids) {
    const msg = await gmailGet(`/messages/${id}?format=full`, accessToken);
    const bodies = [];
    collectBodies(msg.payload, bodies);
    const subject = header(msg.payload, "Subject");
    const from = header(msg.payload, "From");
    const date = header(msg.payload, "Date");
    for (const body of bodies) {
      for (const url of extractJsonLinks(body, args.allJson)) {
        if (seen.has(url)) continue;
        seen.add(url);
        rows.push({ date, from, subject, url });
      }
    }
    processed += 1;
    process.stdout.write(`\r· Read ${processed}/${ids.length} email(s), ${rows.length} unique link(s)…`);
  }
  process.stdout.write("\n\n");

  if (rows.length === 0) {
    console.log(
      "Matched emails but found no .json links. Re-run with --all-json to keep every JSON link, or check one email manually.",
    );
    return;
  }

  writeFileSync(OUT_TXT, rows.map((r) => r.url).join("\n") + "\n");
  writeFileSync(
    OUT_CSV,
    "date,from,subject,url\n" +
      rows.map((r) => [csv(r.date), csv(r.from), csv(r.subject), csv(r.url)].join(",")).join("\n") +
      "\n",
  );

  console.log(`✓ ${rows.length} unique transfer link(s) harvested from ${ids.length} email(s).`);
  console.log(`  → ${OUT_TXT}`);
  console.log(`  → ${OUT_CSV} (audit: date/from/subject per link)`);
  console.log("\nNext: open the back office → Inventory → Receiving →");
  console.log('"Batch import — paste many Transfer Data Links", paste the contents of');
  console.log("transfer-links.txt, and click Fetch & stage. Then review the staged drafts");
  console.log('and click "Promote all manifests to KB drafts".');
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
