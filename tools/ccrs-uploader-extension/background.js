/*
 * Greenway CCRS Uploader - background.js (D253 service worker).
 *
 * Every 30 seconds (chrome.alarms): look at the open CCRS tabs (is the page
 * logged in, as whom), check in with the Greenway back office, and do what it
 * says. The back office decides everything (one file at a time, Group 1 ->
 * 2 -> 3, waits for CCRS's emails); this worker only carries the file from
 * the back office to the CCRS tab and CCRS's answer page back.
 *
 * Never retried here: if the tab does not answer or the report cannot be
 * delivered, the back office marks the file "unknown" and stops the run.
 */
importScripts("lib.js");
var L = globalThis.GWCCRS;
var VERSION = chrome.runtime.getManifest().version;
var ALARM = "gw-ccrs-tick";

chrome.runtime.onInstalled.addListener(function () { schedule(); });
chrome.runtime.onStartup.addListener(function () { schedule(); });
chrome.alarms.onAlarm.addListener(function (a) { if (a.name === ALARM) tick(); });
chrome.runtime.onMessage.addListener(function (msg, _s, reply) {
  if (msg && msg.type === "gw-tick-now") {
    tick().then(function () { reply({ ok: true }); });
    return true;
  }
  return false;
});

function schedule() {
  chrome.alarms.create(ALARM, { periodInMinutes: 0.5, delayInMinutes: 0.1 });
}

async function config() {
  var c = await chrome.storage.local.get(["origin", "key"]);
  return c.origin && c.key ? { origin: c.origin, key: c.key } : null;
}

async function status(text, tone) {
  await chrome.storage.local.set({ lastStatus: { text: String(text).slice(0, 500), tone: tone || "info", at: new Date().toISOString() } });
  var badge = tone === "upload" ? "UP" : tone === "error" ? "!" : tone === "wait" ? "\u2026" : "";
  chrome.action.setBadgeText({ text: badge });
  chrome.action.setBadgeBackgroundColor({ color: tone === "error" ? "#b91c1c" : tone === "upload" ? "#0369a1" : "#4b5563" });
}

async function api(cfg, path, init) {
  var r = await fetch(cfg.origin + path, Object.assign({ cache: "no-store", credentials: "omit", redirect: "error" }, init || {}, {
    headers: Object.assign({ Authorization: "Bearer " + cfg.key }, (init && init.headers) || {}),
  }));
  return r;
}

async function ccrsTabs() {
  var tabs = await chrome.tabs.query({ url: [L.ORIGINS.prod + "/*", L.ORIGINS.preprod + "/*"] });
  var out = [];
  for (var t of tabs) {
    var facts = await probe(t.id);
    if (facts) out.push({ tabId: t.id, origin: facts.origin, loggedIn: facts.loggedIn, username: facts.username });
  }
  return out;
}

async function probe(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "gw-probe" });
  } catch {
    // A tab opened before the extension was installed has no content script yet.
    try {
      await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ["lib.js", "content.js"] });
      return await chrome.tabs.sendMessage(tabId, { type: "gw-probe" });
    } catch {
      return null;
    }
  }
}

var busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    var cfg = await config();
    if (!cfg) return status("Not paired. Open the options and paste the pairing code from the CCRS hub.", "error");
    var tabs = await ccrsTabs();
    var r = await api(cfg, "/api/ccrs-uploader/next", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: VERSION, tabs: tabs.map(function (t) { return { origin: t.origin, loggedIn: t.loggedIn, username: t.username }; }) }),
    });
    if (r.status === 401) return status("This browser is not paired (or was revoked). Pair it again in the CCRS hub.", "error");
    var d = await r.json().catch(function () { return { action: "wait", text: "The back office answered HTTP " + r.status }; });
    if (d.action !== "upload") return status(d.text || d.action, d.action === "wait" ? "wait" : "info");
    await status(d.text, "upload");
    await doUpload(cfg, d, tabs);
  } catch (e) {
    await status("Could not reach the back office: " + String(e && e.message ? e.message : e), "error");
  } finally {
    busy = false;
  }
}

async function report(cfg, runFileId, rep) {
  var r = await api(cfg, "/api/ccrs-uploader/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runFileId: runFileId, report: rep }),
  });
  return r.json().catch(function () { return { ok: false, text: "report answered HTTP " + r.status }; });
}

async function doUpload(cfg, d, tabs) {
  var tab = tabs.find(function (t) { return L.envOfOrigin(t.origin) === d.env && t.loggedIn; });
  if (!tab) {
    // The back office saw a logged-in tab a moment ago; nothing was sent.
    var a = await report(cfg, d.runFileId, { status: -1, responseType: "error", text: "", networkError: "the CCRS tab closed before the file was sent (nothing sent)", notSent: true });
    return status(a.text || "The CCRS tab closed.", "error");
  }
  var f = await api(cfg, "/api/ccrs-uploader/file?id=" + encodeURIComponent(d.runFileId), { method: "GET" });
  if (f.status !== 200) {
    var b = await report(cfg, d.runFileId, { status: -1, responseType: "error", text: "", networkError: "could not fetch the file from the back office (HTTP " + f.status + "; nothing sent)", notSent: true });
    return status(b.text, "error");
  }
  var name = f.headers.get("X-Ccrs-File-Name") || "";
  var csv = await f.text();
  if (name !== d.fileName || !L.isCcrsFileName(name)) {
    var c = await report(cfg, d.runFileId, { status: -1, responseType: "error", text: "", networkError: "file name mismatch (nothing sent)", notSent: true });
    return status(c.text, "error");
  }
  var rep;
  try {
    rep = await chrome.tabs.sendMessage(tab.tabId, { type: "gw-upload", fileName: name, csv: csv, expectedOrigin: L.ORIGINS[d.env] });
  } catch (e) {
    rep = { status: -1, responseType: "error", text: "", networkError: "the CCRS tab did not answer: " + String(e && e.message ? e.message : e) };
  }
  var ans = await report(cfg, d.runFileId, rep || { status: -1, responseType: "error", text: "", networkError: "no answer from the CCRS tab" });
  await status(ans.text || (ans.ok ? "Sent." : "Stopped."), ans.ok ? "info" : "error");
}
