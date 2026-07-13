/**
 * public/push-sw.js  (Task W)
 *
 * Minimal service worker for compliance push notifications. Registered from
 * the Compliance Command Center's notification settings panel. It only
 * handles Web Push display + click — no caching, no fetch interception.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Greenway compliance reminder", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Greenway compliance reminder";
  const options = {
    body: data.body || "",
    tag: data.tag || "ccrs-reminder",
    data: { url: data.url || "/admin/compliance/ccrs" },
    icon: "/brand/greenway-black-gold-logo.png",
    badge: "/brand/greenway-black-gold-logo.png",
    // Deadline reminders should stay visible until acknowledged.
    requireInteraction: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/admin/compliance/ccrs";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes("/admin") && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
