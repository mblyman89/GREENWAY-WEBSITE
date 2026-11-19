/* Greenway CCRS Uploader - popup (D253): the last thing the back office said. */
(function () {
  "use strict";
  var s = document.getElementById("s");
  function show() {
    chrome.storage.local.get(["origin", "lastStatus"], function (c) {
      if (!c.origin) { s.textContent = "Not paired. Open Options."; return; }
      s.textContent = c.lastStatus ? c.lastStatus.text : "Waiting for the first check-in.";
    });
  }
  document.getElementById("now").addEventListener("click", function () {
    s.textContent = "Checking in\u2026";
    chrome.runtime.sendMessage({ type: "gw-tick-now" }, show);
  });
  document.getElementById("opt").addEventListener("click", function () { chrome.runtime.openOptionsPage(); });
  show();
})();
