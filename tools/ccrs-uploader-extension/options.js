/* Greenway CCRS Uploader - options page (D253). Stores { origin, key } in chrome.storage.local. */
(function () {
  "use strict";
  var L = globalThis.GWCCRS;
  var $ = function (id) { return document.getElementById(id); };
  async function show() {
    var c = await chrome.storage.local.get(["origin", "lastStatus"]);
    $("paired").textContent = c.origin ? "Paired with " + c.origin : "Not paired yet.";
    $("status").textContent = c.lastStatus ? "Last: " + c.lastStatus.text + " (" + new Date(c.lastStatus.at).toLocaleString() + ")" : "";
  }
  $("save").addEventListener("click", async function () {
    var p = L.parsePairingCode($("code").value);
    if (!p) { $("paired").textContent = "That is not a pairing code from the CCRS hub."; return; }
    var known = ["https://www.greenwaymarijuana.com", "https://greenwaymarijuana.com"];
    if (known.indexOf(p.origin) < 0) {
      // A preview / staging back office: ask Chrome for that one site only.
      var granted = await chrome.permissions.request({ origins: [p.origin + "/*"] });
      if (!granted) { $("paired").textContent = "Chrome did not allow " + p.origin + "."; return; }
    }
    await chrome.storage.local.set({ origin: p.origin, key: p.key });
    $("code").value = "";
    chrome.runtime.sendMessage({ type: "gw-tick-now" });
    show();
  });
  $("forget").addEventListener("click", async function () {
    await chrome.storage.local.remove(["origin", "key"]);
    show();
  });
  $("now").addEventListener("click", function () {
    chrome.runtime.sendMessage({ type: "gw-tick-now" }, function () { show(); });
  });
  show();
})();
