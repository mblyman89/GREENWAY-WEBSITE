/*
 * Greenway CCRS Uploader - lib.js (D253). Plain string helpers, no DOM, so the
 * back office's tests run them in Node (tests/compliance/d253-auto-uploader).
 * Loaded before content.js on the two CCRS pages, and by background.js.
 *
 * What CCRS's upload page looks like (observed on PREprod 2026-11-18):
 *   <form ... action="/Auth/Logout">                  (only when logged in)
 *   <form enctype="multipart/form-data" method="post" action="/Home/Upload">
 *     <input type="file" name="files" id="fileClick" multiple accept=".csv">
 *     <input name="username" id="Email" readonly value="michael@...">
 *     <input type="hidden" name="__RequestVerificationToken" value="...">
 */
(function (root) {
  "use strict";

  var ORIGINS = {
    prod: "https://cannabisreporting.lcb.wa.gov",
    preprod: "https://precannabisreporting.lcb.wa.gov",
  };
  var PAIRING_PREFIX = "GWCCRS1";
  var FILE_NAME_RE = /^(Strain|Area|Product|Inventory|InventoryAdjustment|InventoryTransfer|Sale)_\d+_\d{14}\.csv$/;

  function envOfOrigin(origin) {
    var o = String(origin || "").trim().replace(/\/+$/, "").toLowerCase();
    if (o === ORIGINS.prod) return "prod";
    if (o === ORIGINS.preprod) return "preprod";
    return null;
  }

  function decode(s) {
    return String(s)
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&#x27;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); })
      .replace(/&amp;/g, "&");
  }

  /** attributes of one tag: { name: value } (lower-case names). */
  function attrs(tag) {
    var out = {};
    var re = /([^\s=<>\/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    var body = tag.replace(/^<\s*\w+/, "").replace(/\/?>$/, "");
    var m;
    while ((m = re.exec(body))) {
      out[m[1].toLowerCase()] = decode(m[2] != null ? m[2] : m[3] != null ? m[3] : m[4] != null ? m[4] : "");
    }
    return out;
  }

  /**
   * What an upload page's HTML says: logged in, as whom, the form's token.
   * loggedIn needs BOTH the logout form and the upload form.
   */
  function pageFacts(html) {
    var h = String(html || "");
    var forms = (h.match(/<form\b[^>]*>/gi) || []).map(attrs);
    var hasLogout = forms.some(function (f) { return /\/Auth\/Logout$/i.test(f.action || ""); });
    var upload = forms.find(function (f) { return /\/Home\/Upload$/i.test(f.action || ""); }) || null;
    var inputs = (h.match(/<input\b[^>]*>/gi) || []).map(attrs);
    var email = inputs.find(function (i) { return i.id === "Email" || i.name === "username"; });
    var tok = inputs.find(function (i) { return i.name === "__RequestVerificationToken"; });
    var file = inputs.find(function (i) { return i.type === "file" && i.name === "files"; });
    var username = email && email.value ? email.value.trim() : null;
    return {
      loggedIn: Boolean(hasLogout && upload && file),
      username: username,
      token: tok && tok.value ? tok.value : null,
      uploadAction: upload ? upload.action : null,
    };
  }

  /** The visible text of an answer page (scripts, styles and tags removed). */
  function visibleText(html) {
    return decode(
      String(html || "")
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 20000);
  }

  /** "GWCCRS1.<https origin>.<key>" -> { origin, key } or null (same rule as the back office). */
  function parsePairingCode(code) {
    var c = String(code || "").trim();
    if (c.indexOf(PAIRING_PREFIX + ".") !== 0) return null;
    var rest = c.slice(PAIRING_PREFIX.length + 1);
    var cut = rest.lastIndexOf(".");
    if (cut < 0) return null;
    var origin = rest.slice(0, cut);
    var key = rest.slice(cut + 1);
    if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(origin) || !/^[A-Za-z0-9_-]{43,128}$/.test(key)) return null;
    return { origin: origin.toLowerCase(), key: key };
  }

  /** Only a CCRS file name of the license goes into the form (defence in depth). */
  function isCcrsFileName(name) {
    return FILE_NAME_RE.test(String(name || ""));
  }

  /**
   * D254: is a keep-alive read of the CCRS page due? `lastIso` = the last one
   * (null = never). The interval comes from the back office and is clamped
   * to 2..30 minutes; anything unreadable means "not due" (never a flood).
   */
  function keepAliveDue(lastIso, nowMs, seconds) {
    var s = Number(seconds);
    if (!isFinite(s) || s <= 0) return false;
    var every = Math.min(30 * 60, Math.max(2 * 60, s)) * 1000;
    if (lastIso == null) return true;
    var last = Date.parse(String(lastIso));
    if (!isFinite(last)) return true;
    if (last > nowMs + 60 * 1000) return true; // a clock set back: start over
    return nowMs - last >= every;
  }

  /** "3 min ago" for the status line. */
  function agoText(lastIso, nowMs) {
    var last = Date.parse(String(lastIso));
    if (!isFinite(last)) return "";
    var m = Math.max(0, Math.round((nowMs - last) / 60000));
    return m === 0 ? "just now" : m + " min ago";
  }

  var api = {
    ORIGINS: ORIGINS,
    keepAliveDue: keepAliveDue,
    agoText: agoText,
    envOfOrigin: envOfOrigin,
    pageFacts: pageFacts,
    visibleText: visibleText,
    parsePairingCode: parsePairingCode,
    isCcrsFileName: isCcrsFileName,
    attrs: attrs,
  };
  root.GWCCRS = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
