import { getDb } from "./db.js";
import { eventBus } from "./events.js";

export interface Notification {
  id: number;
  task_id: number;
  type: string;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
}

export function createNotification(taskId: number, type: string, title: string, message: string): Notification {
  const db = getDb();
  const result = db
    .prepare("INSERT INTO notifications (task_id, type, title, message) VALUES (?, ?, ?, ?)")
    .run(taskId, type, title, message);

  const id = result.lastInsertRowid as number;
  const notif = db.prepare("SELECT * FROM notifications WHERE id = ?").get(id) as Notification;

  eventBus.notificationCreated({ id, taskId, type, title, message });

  return notif;
}

export function getUnreadNotifications(): Notification[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM notifications WHERE read = 0 ORDER BY created_at DESC LIMIT 50")
    .all() as Notification[];
}

export function getAllNotifications(limit = 50): Notification[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?")
    .all(limit) as Notification[];
}

export function markRead(id: number) {
  const db = getDb();
  db.prepare("UPDATE notifications SET read = 1 WHERE id = ?").run(id);
}

export function markAllRead() {
  const db = getDb();
  db.prepare("UPDATE notifications SET read = 1 WHERE read = 0").run();
}

// Hook: listen to taskMoved events and create notifications for awaiting states
eventBus.on("task", (event) => {
  if (event.type !== "task:moved") return;
  const to = event.data?.to as string | undefined;
  if (!to || !to.startsWith("awaiting:")) return;

  const stage = to.slice("awaiting:".length);
  const db = getDb();
  const task = db.prepare("SELECT title FROM tasks WHERE id = ?").get(event.taskId) as { title: string } | undefined;
  if (!task) return;

  createNotification(
    event.taskId,
    "gate_awaiting",
    `#${event.taskId} awaiting validation`,
    `"${task.title}" — stage ${stage} needs your approval`,
  );
});
