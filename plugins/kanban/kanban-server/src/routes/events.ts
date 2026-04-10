import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { eventBus, type TaskEvent } from "../events.js";

const app = new Hono();

app.get("/api/events", (c) => {
  return streamSSE(c, async (stream) => {
    const handler = (event: TaskEvent) => {
      stream.writeSSE({
        event: event.type,
        data: JSON.stringify({ taskId: event.taskId, ...event.data }),
      });
    };

    eventBus.on("task", handler);

    // Keep alive
    const keepAlive = setInterval(() => {
      stream.writeSSE({ event: "ping", data: "" });
    }, 30000);

    stream.onAbort(() => {
      eventBus.off("task", handler);
      clearInterval(keepAlive);
    });

    // Block until client disconnects
    await new Promise(() => {});
  });
});

export default app;
