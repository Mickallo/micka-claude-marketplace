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

// Migrate: merge description and notes into blocks for existing tasks
function migrateDescriptionAndNotes() {
  const db = getDb();
  const tasks = db.prepare("SELECT id, description, notes, blocks, created_at FROM tasks").all() as (Task & { created_at: string })[];
  let migrated = 0;
  for (const task of tasks) {
    const blocks: Block[] = task.blocks ? JSON.parse(task.blocks) : [];
    const notes = task.notes ? JSON.parse(task.notes) : [];
    let changed = false;

    // Check if description is already in blocks (first user block)
    const hasDescBlock = blocks.some(b => b.agent === "user" && b.verdict === "info" && blocks.indexOf(b) === 0);

    // Add description as first block if not already there
    if (task.description && !hasDescBlock) {
      blocks.unshift({
        agent: "user",
        agent_id: null,
        content: task.description,
        decision_log: "",
        verdict: "info",
        timestamp: task.created_at || new Date().toISOString(),
      });
      changed = true;
    }

    // Add notes that aren't already in blocks
    for (const note of notes) {
      const alreadyMigrated = blocks.some(b =>
        b.agent === (note.author || "user") &&
        b.verdict === "info" &&
        b.content === note.text
      );
      if (!alreadyMigrated) {
        blocks.push({
          agent: note.author || "user",
          agent_id: null,
          content: note.text || "",
          decision_log: "",
          verdict: "info",
          timestamp: note.timestamp || new Date().toISOString(),
        });
        changed = true;
      }
    }

    if (changed) {
      db.prepare("UPDATE tasks SET blocks = ? WHERE id = ?").run(JSON.stringify(blocks), task.id);
      migrated++;
    }
  }
  if (migrated > 0) console.log(`Migrated description/notes to blocks for ${migrated} task(s)`);
}

migrateDescriptionAndNotes();

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
