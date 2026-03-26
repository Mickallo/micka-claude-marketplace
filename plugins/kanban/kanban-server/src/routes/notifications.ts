import { Hono } from "hono";
import { getAllNotifications, markRead, markAllRead } from "../notifications.js";

const app = new Hono();

app.get("/api/notifications", (c) => {
  const notifications = getAllNotifications();
  return c.json(notifications);
});

app.post("/api/notifications/:id/read", (c) => {
  const id = parseInt(c.req.param("id"));
  markRead(id);
  return c.json({ success: true });
});

app.post("/api/notifications/read-all", (c) => {
  markAllRead();
  return c.json({ success: true });
});

export default app;
