/*
 * Greenway CCRS Uploader - content.js (D253). Runs only on the two CCRS hosts.
 *
 * It does what the owner would do by hand on the page he is logged in to:
 * choose the file and press Upload. Concretely, a same-origin POST of the
 * page's own form fields (files, username, __RequestVerificationToken) to
 * /Home/Upload, with his session cookie (credentials: "same-origin"). It
 * never reads or types a sign-in secret, never follows a redirect (a redirect means
 * "not logged in" or "not the page we know", and the back office stops).
 */
(function () {
  "use strict";
  var L = globalThis.GWCCRS;
  if (!L || !L.envOfOrigin(location.origin)) return;

  async function freshFacts() {
    // A fresh copy of this same page: proves the session is alive now and
    // gives a current form token (the tab may have been open for hours).
    var r = await fetch(location.origin + location.pathname, { credentials: "same-origin", redirect: "manual", cache: "no-store" });
    if (r.type === "opaqueredirect" || r.status !== 200) return { loggedIn: false, username: null, token: null, uploadAction: null };
    return L.pageFacts(await r.text());
  }

  async function upload(msg) {
    if (!L.isCcrsFileName(msg.fileName)) return { status: -1, responseType: "error", text: "", networkError: "not a CCRS file name: " + String(msg.fileName).slice(0, 80), notSent: true };
    if (msg.expectedOrigin && msg.expectedOrigin !== location.origin) return { status: -1, responseType: "error", text: "", networkError: "wrong CCRS site for this run", notSent: true };
    var f;
    try {
      f = await freshFacts();
    } catch (e) {
      return { status: -1, responseType: "error", text: "", networkError: "could not read the CCRS page before sending (nothing sent): " + String(e && e.message ? e.message : e), notSent: true };
    }
    if (!f.loggedIn || !f.token || !f.username) {
      return { status: -1, responseType: "error", text: "", networkError: "the CCRS page is not logged in (nothing sent)", notSent: true };
    }
    var fd = new FormData();
    fd.append("files", new Blob([msg.csv], { type: "text/csv" }), msg.fileName);
    fd.append("username", f.username);
    fd.append("__RequestVerificationToken", f.token);
    try {
      var r = await fetch(location.origin + "/Home/Upload", { method: "POST", body: fd, credentials: "same-origin", redirect: "manual", cache: "no-store" });
      var text = r.type === "opaqueredirect" ? "" : L.visibleText(await r.text());
      return { status: r.status, responseType: r.type, text: text, networkError: null };
    } catch (e) {
      return { status: -1, responseType: "error", text: "", networkError: String(e && e.message ? e.message : e) };
    }
  }

  chrome.runtime.onMessage.addListener(function (msg, _sender, reply) {
    if (!msg || typeof msg !== "object") return false;
    if (msg.type === "gw-probe") {
      var f = L.pageFacts(document.documentElement ? document.documentElement.outerHTML : "");
      reply({ origin: location.origin, loggedIn: f.loggedIn, username: f.username });
      return false;
    }
    if (msg.type === "gw-upload") {
      upload(msg).then(reply, function (e) {
        reply({ status: -1, responseType: "error", text: "", networkError: String(e) });
      });
      return true; // async reply
    }
    return false;
  });
})();
