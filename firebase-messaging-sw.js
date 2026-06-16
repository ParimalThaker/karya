// ================================================================
// firebase-messaging-sw.js
// Karya App — Geetanjali
// Service Worker for FCM background push notifications
// Place this file in the ROOT of your GitHub Pages repository
// alongside karya.html and manifest.json
// ================================================================

importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

// ▼▼▼ PASTE YOUR FIREBASE CONFIG HERE (same as in karya.html) ▼▼▼
firebase.initializeApp({
  apiKey:            "PASTE_YOUR_API_KEY",
  authDomain:        "PASTE_YOUR_AUTH_DOMAIN",
  projectId:         "PASTE_YOUR_PROJECT_ID",
  storageBucket:     "PASTE_YOUR_STORAGE_BUCKET",
  messagingSenderId: "PASTE_YOUR_SENDER_ID",
  appId:             "PASTE_YOUR_APP_ID"
});
// ▲▲▲ END CONFIG ▲▲▲

const messaging = firebase.messaging();

// ── BACKGROUND MESSAGE HANDLER ───────────────────────────────────
// Fires when app is minimized, screen is off, or browser tab not focused
messaging.onBackgroundMessage(function(payload) {
  console.log("[SW] Background message received:", payload);

  const data         = payload.data         || {};
  const notification = payload.notification || {};

  const title   = notification.title || data.title || "⏰ Karya Reminder";
  const body    = notification.body  || data.body  || "You have a task due";
  const taskId  = data.taskId || "";

  self.registration.showNotification(title, {
    body:               body,
    icon:               "/karya-icon-192.png",
    badge:              "/karya-badge-96.png",
    tag:                "karya-" + taskId,        // Replaces previous, no stacking
    renotify:           true,                      // Re-rings even if same tag
    requireInteraction: true,                      // Stays until user taps — PERSISTENT
    vibrate:            [300, 100, 300, 100, 300], // Three pulses
    data:               { taskId, url: self.location.origin + "/karya.html" },
    actions: [
      { action: "open",    title: "Open Karya" },
      { action: "snooze",  title: "Snooze 1hr"  },
      { action: "dismiss", title: "Dismiss"      }
    ]
  });
});

// ── NOTIFICATION CLICK HANDLER ───────────────────────────────────
self.addEventListener("notificationclick", function(event) {
  event.notification.close();

  if (event.action === "dismiss") return;

  const taskId  = event.notification.data?.taskId || "";
  const baseUrl = event.notification.data?.url || "/karya.html";
  const url     = taskId ? baseUrl + "?task=" + taskId : baseUrl;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true })
      .then(function(clientList) {
        // Focus existing Karya tab if open
        for (const client of clientList) {
          if (client.url.includes("karya") && "focus" in client) {
            return client.focus();
          }
        }
        // Otherwise open new tab
        if (clients.openWindow) return clients.openWindow(url);
      })
  );
});

// ── INSTALL + ACTIVATE (keeps SW fresh) ──────────────────────────
self.addEventListener("install",  e => { console.log("[SW] Installed");  self.skipWaiting(); });
self.addEventListener("activate", e => { console.log("[SW] Activated");  e.waitUntil(clients.claim()); });
