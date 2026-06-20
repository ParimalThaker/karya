// functions/index.js — Karya App v3
// Fixed: removed invalid bodyLocKey field that was breaking Android delivery

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
const db = getFirestore();

exports.sendKaryaReminders = onSchedule({
  schedule: "every 1 minutes",
  timeZone: "Asia/Kolkata",
  memory: "256MiB",
}, async (event) => {

  const now   = new Date();
  const tasks = await db.collection("karya_tasks").get();

  console.log(`[Karya] Checking ${tasks.size} tasks at ${now.toISOString()}`);

  for (const taskDoc of tasks.docs) {
    const task = taskDoc.data();

    if (task.status === "completed" || task.isFuture || !task.dueDate) continue;
    if (!task.reminder || task.reminder === "") continue;

    const dueTime = task.dueTime || "23:59";
    const due = new Date(task.dueDate + "T" + dueTime);

    let remindAt;
    if (task.reminder === "ontime") remindAt = due;
    else remindAt = new Date(due.getTime() - parseInt(task.reminder) * 60000);

    const diff = remindAt.getTime() - now.getTime();
    if (diff < 0 || diff > 60000) continue;

    if (task.notifiedAt) {
      const last = task.notifiedAt.toDate ? task.notifiedAt.toDate() : new Date(task.notifiedAt);
      if (Math.abs(last.getTime() - remindAt.getTime()) < 90000) continue;
    }

    const assignees = Array.isArray(task.assignedTo)
      ? task.assignedTo : [task.assignedTo || "Everyone"];

    const tokensSnap = await db.collection("karya_fcm_tokens").get();
    const tokens = [];
    tokensSnap.forEach(d => {
      const td = d.data();
      if (!td.token) return;
      const match = assignees.includes("Everyone") || assignees.includes(td.userName);
      if (match) tokens.push({ token: td.token, docId: d.id });
    });

    if (!tokens.length) {
      console.log(`[Karya] No tokens found for task "${task.title}" assignees: ${assignees.join(",")}`);
      continue;
    }

    console.log(`[Karya] Sending "${task.title}" to ${tokens.length} token(s)`);

    // FIXED: removed bodyLocKey (was an invalid field causing silent failures)
    const message = {
      notification: {
        title: "Karya \u2014 Do Now",
        body: task.title
      },
      data: {
        taskId: taskDoc.id,
        title: task.title
      },
      tokens: tokens.map(t => t.token),
      android: {
        priority: "high",
        notification: {
          channelId: "karya_reminders",
          priority: "max",
          defaultSound: true,
          defaultVibrateTimings: true,
          visibility: "PUBLIC",
          sticky: true,
          color: "#E8720C"
        }
      },
      webpush: {
        headers: { Urgency: "high" },
        notification: {
          requireInteraction: true,
          renotify: true,
          vibrate: [300, 100, 300, 100, 300],
          icon: "https://parimalthaker.github.io/karya/karya-icon-192.png",
          badge: "https://parimalthaker.github.io/karya/karya-badge-96.png",
          tag: "karya-" + taskDoc.id,
          actions: [
            { action: "open",    title: "Open Task" },
            { action: "snooze",  title: "Snooze 1hr" },
            { action: "dismiss", title: "Dismiss" }
          ]
        },
        fcmOptions: { link: "https://parimalthaker.github.io/karya/?remind=" + taskDoc.id }
      }
    };

    try {
      const resp = await getMessaging().sendEachForMulticast(message);
      console.log(`[Karya] Result for "${task.title}": ${resp.successCount} sent, ${resp.failureCount} failed`);

      resp.responses.forEach((r, i) => {
        if (!r.success) {
          console.error(`[Karya] Failed for token ${tokens[i].docId}:`, r.error?.code, r.error?.message);
          const code = r.error?.code || "";
          if (code.includes("invalid") || code.includes("not-registered") || code.includes("unregistered")) {
            db.collection("karya_fcm_tokens").doc(tokens[i].docId).delete();
          }
        } else {
          console.log(`[Karya] Successfully delivered to ${tokens[i].docId}`);
        }
      });

      await taskDoc.ref.update({ notifiedAt: FieldValue.serverTimestamp() });
    } catch(e) {
      console.error(`[Karya] FCM send error for "${task.title}":`, e.message);
    }
  }
  console.log("[Karya] Check complete");
});
