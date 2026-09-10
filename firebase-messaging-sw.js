// firebase-messaging-sw.js — Karya App v5 (data-only payload, per-user actions)
// Modern notification UI, icon-only actions, dismiss = auto-snooze 1hr (unacknowledged)

importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey:            "AIzaSyBgnUI_Fv9VLXvNAWdR_KxidZPajfd7s4E",
  authDomain:        "karya-7.firebaseapp.com",
  projectId:         "karya-7",
  storageBucket:     "karya-7.firebasestorage.app",
  messagingSenderId: "187526342338",
  appId:             "1:187526342338:web:f300bbca2c6a6103cc3d5b"
});

const messaging = firebase.messaging();
const NOTIF_ACTION_URL = "https://us-central1-karya-7.cloudfunctions.net/notifAction";

// userName now comes from the notification's own data (the server stamps it
// per-recipient when sending), so snooze/dismiss from the tray can be applied
// to the right person's personal reminder instead of the shared due date.
function postAction(taskId, action, userName) {
  return fetch(NOTIF_ACTION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId, action, userName: userName || "" })
  }).catch(()=>{});
}

// ── BACKGROUND MESSAGE — modern notification design ──────────────
// Server now sends DATA-ONLY payloads (no `notification` block) so that this
// handler is the ONLY thing that displays a notification. Previously the
// payload carried a notification block too, which FCM auto-rendered on top of
// this one — producing two identical notifications per device every morning.
messaging.onBackgroundMessage(function(payload) {
  const data = payload.data || {};
  const taskId = data.taskId || "";
  const title  = data.title || "\u23F0 Karya Reminder";
  const body   = data.body  || "Task due";

  // Digest messages have no taskId — they get a single "open" action and a
  // stable tag so a re-send replaces rather than stacks.
  const actions = taskId ? [
    { action: "open", title: "\uD83D\uDCC2 Open" },
    { action: "done", title: "\u2705 Done" }
  ] : [
    { action: "open", title: "\uD83D\uDCC2 Open Karya" }
  ];

  const url = taskId
    ? self.registration.scope + "?remind=" + taskId
    : self.registration.scope + "?plan=1";

  self.registration.showNotification(title, {
    body:    body,
    icon:    "./karya-icon-192.png",
    badge:   "./karya-badge-96.png",
    tag:     "karya-" + (taskId || "digest"),
    renotify: true,
    requireInteraction: true,
    vibrate: [300, 100, 300, 100, 300],
    silent:  false,
    data:    { taskId, url, userName: data.userName || "" },
    actions: actions
  });
});

// ── NOTIFICATION CLICK (action buttons + body tap) ───────────────
self.addEventListener("notificationclick", function(event) {
  const taskId = event.notification.data?.taskId || "";
  const userName = event.notification.data?.userName || "";
  const action = event.action;
  event.notification.close();

  if (taskId && action === "done") {
    event.waitUntil(postAction(taskId, action, userName));
    return; // handled server-side — marks task complete, no need to open the app
  }

  // Body tap or explicit "open" action -> focus/open app, highlight the task.
  // Digest notifications carry no taskId; they open straight into Plan My Day.
  const url = event.notification.data?.url || self.registration.scope;

  // IMPORTANT: run SEQUENTIALLY, not in parallel.
  // Clearing the tray must fully complete BEFORE the app opens — otherwise
  // Android kills the service worker as soon as the window launches and the
  // remaining notifications are never closed.
  event.waitUntil(
    (async function() {
      // 1. Clear every Karya notification from the tray FIRST and await it
      try {
        const notifications = await self.registration.getNotifications();
        for (const n of notifications) { n.close(); }
      } catch (e) { /* non-fatal */ }

      // 2. Tell the server this task was opened (fire and forget is fine here)
      const ackPromise = taskId
        ? postAction(taskId, "open", userName)
        : Promise.resolve();

      // 3. Now focus or open the app
      try {
        const clientList = await clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const client of clientList) {
          if (client.url.includes("parimalthaker.github.io/karya")) {
            client.postMessage(taskId
              ? { type: "SHOW_REMINDER", taskId: taskId }
              : { type: "SHOW_PLAN" });
            await client.focus();
            await ackPromise;
            return;
          }
        }
        if (clients.openWindow) {
          await clients.openWindow(url);
        }
      } catch (e) { /* non-fatal */ }

      await ackPromise;
    })()
  );
});

// ── NOTIFICATION DISMISSED (swiped away) ──────────────────────────
// Auto-snooze 1 hour server-side; stays UNACKNOWLEDGED so the app shows
// the in-app popup + chime exactly once when next opened normally.
self.addEventListener("notificationclose", function(event) {
  const taskId = event.notification.data?.taskId || "";
  const userName = event.notification.data?.userName || "";
  if (!taskId) return; // digest dismissals need no server action
  event.waitUntil(postAction(taskId, "dismiss", userName));
});

self.addEventListener("install",  e => { self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(clients.claim()); });
