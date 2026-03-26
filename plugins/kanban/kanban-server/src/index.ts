// Prevent uncaught errors from crashing the server
process.on("uncaughtException", (err) => console.error("Uncaught:", err.message));
process.on("unhandledRejection", (err) => console.error("Unhandled:", err));

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import fs from "fs";
import path from "path";

import pipelinesRoutes from "./routes/pipelines.js";
import boardRoutes from "./routes/board.js";
import taskRoutes from "./routes/tasks.js";
import eventsRoutes from "./routes/events.js";
import { setupTerminalWS } from "./terminal.js";
import { getDb } from "./db.js";
import type { Task, Block } from "./types.js";

// Clean up orphaned "running" blocks from previous crashes
function cleanupRunningBlocks() {
  const db = getDb();
  const tasks = db.prepare("SELECT id, blocks FROM tasks").all() as Task[];
  let cleaned = 0;
  for (const task of tasks) {
    const blocks: Block[] = task.blocks ? JSON.parse(task.blocks) : [];
    let changed = false;
    for (const block of blocks) {
      if (block.verdict === "running") {
        block.verdict = "nok";
        block.content = block.content || `${block.agent} was interrupted`;
        block.decision_log = "Process was interrupted (server restart or crash)";
        changed = true;
        cleaned++;
      }
    }
    if (changed) {
      db.prepare("UPDATE tasks SET blocks = ? WHERE id = ?").run(JSON.stringify(blocks), task.id);
    }
  }
  if (cleaned > 0) console.log(`Cleaned ${cleaned} orphaned running block(s)`);
}

cleanupRunningBlocks();

const app = new Hono();

// API routes
app.route("/", pipelinesRoutes);
app.route("/", boardRoutes);
app.route("/", taskRoutes);
app.route("/", eventsRoutes);

// Serve static files from Svelte frontend build
const staticRoot = path.resolve(import.meta.dirname, "..", "dist");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

app.get("/*", (c, next) => {
  // Don't intercept API routes
  if (c.req.path.startsWith("/api/")) return next();

  const reqPath = c.req.path === "/" ? "/index.html" : c.req.path;
  let filePath = path.join(staticRoot, reqPath);

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(staticRoot, "index.html");
  }

  if (!filePath.startsWith(staticRoot)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const data = fs.readFileSync(filePath);

  return new Response(data, {
    headers: { "Content-Type": contentType },
  });
});

const port = parseInt(process.env.PORT || "5173");

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Kanban server running on http://localhost:${info.port}`);
});

// Attach WebSocket terminal handler
const httpServer = server as unknown as import("http").Server;
httpServer.on("upgrade", (req) => {
  console.log(`[upgrade] ${req.url}`);
});
setupTerminalWS(httpServer);
