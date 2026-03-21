import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import type { Plugin, ViteDevServer } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const KANBAN_DIR = path.resolve(os.homedir(), ".claude", "kanban");
const DB_PATH = path.join(KANBAN_DIR, "kanban.db");
const PIPELINES_PATH = path.join(KANBAN_DIR, "pipelines.json");
const IMAGES_DIR = path.join(KANBAN_DIR, "images");

// Ensure dirs exist
if (!fs.existsSync(KANBAN_DIR)) fs.mkdirSync(KANBAN_DIR, { recursive: true });
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

// ── Pipelines config ────────────────────────────────────

interface PipelineConfig {
  stages: string[];
}

interface PipelinesFile {
  pipelines: Record<string, PipelineConfig>;
  default: string;
  max_loops: number;
}

const DEFAULT_PIPELINES: PipelinesFile = {
  pipelines: {
    full: { stages: ["Resolver", "Planner", "Critic", "Builder", "Shield", "Inspector", "Ranger"] },
    quick: { stages: ["Resolver", "Builder", "Ranger"] },
  },
  default: "full",
  max_loops: 3,
};

let _pipelinesCache: { data: PipelinesFile; mtime: number } | null = null;

function loadPipelines(): PipelinesFile {
  if (!fs.existsSync(PIPELINES_PATH)) return DEFAULT_PIPELINES;
  try {
    const stat = fs.statSync(PIPELINES_PATH);
    if (_pipelinesCache && _pipelinesCache.mtime === stat.mtimeMs) return _pipelinesCache.data;
    const data = JSON.parse(fs.readFileSync(PIPELINES_PATH, "utf-8")) as PipelinesFile;
    if (!data.pipelines || Object.keys(data.pipelines).length === 0) return DEFAULT_PIPELINES;
    data.max_loops = data.max_loops ?? 3;
    data.default = data.default ?? Object.keys(data.pipelines)[0];
    _pipelinesCache = { data, mtime: stat.mtimeMs };
    return data;
  } catch {
    return DEFAULT_PIPELINES;
  }
}

function savePipelines(data: PipelinesFile): void {
  fs.writeFileSync(PIPELINES_PATH, JSON.stringify(data, null, 2) + "\n");
  _pipelinesCache = null;
}

function getPipeline(name?: string): PipelineConfig & { name: string } {
  const all = loadPipelines();
  const key = name || all.default;
  const pipeline = all.pipelines[key];
  if (pipeline) return { ...pipeline, name: key };
  // Fallback to default
  const defPipeline = all.pipelines[all.default];
  if (defPipeline) return { ...defPipeline, name: all.default };
  // Fallback to first
  const firstKey = Object.keys(all.pipelines)[0];
  return { ...all.pipelines[firstKey], name: firstKey };
}

function getColumns(pipeline: PipelineConfig): string[] {
  return ["todo", ...pipeline.stages, "done"];
}

function getTransitions(pipeline: PipelineConfig): Record<string, string[]> {
  const columns = getColumns(pipeline);
  const transitions: Record<string, string[]> = {};
  for (let i = 0; i < columns.length; i++) {
    const allowed: string[] = [];
    if (i < columns.length - 1) allowed.push(columns[i + 1]);
    if (i > 0) allowed.push(columns[i - 1]);
    transitions[columns[i]] = allowed;
  }
  transitions["done"] = [];
  return transitions;
}

// ── Agents discovery ────────────────────────────────────

interface AgentInfo {
  name: string;
  source: string;
  path: string;
  description?: string;
  model?: string;
  color?: string;
  tools?: string[];
  prompt?: string;
}

function getAgentDirs(): { dir: string; source: string }[] {
  const projectRoot = process.env.KANBAN_PROJECT_ROOT || process.cwd();
  return [
    { dir: path.resolve(__dirname, "..", "..", "agents"), source: "plugin" },
    { dir: path.resolve(os.homedir(), ".claude", "agents"), source: "user" },
    { dir: path.join(projectRoot, ".claude", "agents"), source: "project" },
  ];
}

function discoverAgents(): string[] {
  const agents = new Map<string, string>();
  for (const { dir, source } of getAgentDirs()) scanAgentsDir(dir, source, agents);
  return [...agents.keys()].sort();
}

function discoverAgentsDetailed(): AgentInfo[] {
  const agents = new Map<string, AgentInfo>();
  for (const { dir, source } of getAgentDirs()) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".md")) continue;
      const name = file.replace(/\.md$/, "");
      const filePath = path.join(dir, file);
      const info = parseAgentFrontmatter(name, filePath, source);
      agents.set(name, info);
    }
  }
  return [...agents.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function getAgentDetail(name: string): AgentInfo | null {
  for (const { dir, source } of [...getAgentDirs()].reverse()) {
    const filePath = path.join(dir, `${name}.md`);
    if (fs.existsSync(filePath)) return parseAgentFrontmatter(name, filePath, source);
  }
  return null;
}

function parseAgentFrontmatter(name: string, filePath: string, source: string): AgentInfo {
  const content = fs.readFileSync(filePath, "utf-8");
  const info: AgentInfo = { name, source, path: filePath };

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return info;

  const fm = fmMatch[1];
  const getField = (key: string): string | undefined => {
    const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : undefined;
  };
  const getMultilineField = (key: string): string | undefined => {
    const m = fm.match(new RegExp(`^${key}:\\s*>\\s*\\n((?:\\s+.+\\n?)*)`, "m"));
    return m ? m[1].replace(/\n\s*/g, " ").trim() : getField(key);
  };

  info.description = getMultilineField("description");
  info.model = getField("model");
  info.color = getField("color");

  // Parse tools list
  const toolsMatch = fm.match(/^tools:\s*\n((?:\s+-\s+.+\n?)*)/m);
  if (toolsMatch) {
    info.tools = toolsMatch[1].split("\n")
      .map(l => l.replace(/^\s+-\s+/, "").trim())
      .filter(Boolean);
  }

  // Extract prompt body (everything after frontmatter)
  const bodyStart = content.indexOf("---", 3);
  if (bodyStart !== -1) {
    const body = content.slice(bodyStart + 3).trim();
    if (body) info.prompt = body;
  }

  return info;
}

function scanAgentsDir(dir: string, _source: string, agents: Map<string, string>) {
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith(".md")) {
      agents.set(file.replace(/\.md$/, ""), _source);
    }
  }
}

// ── Database (single DB) ────────────────────────────────

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = DELETE");

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'todo',
      priority TEXT NOT NULL DEFAULT 'medium',
      pipeline TEXT NOT NULL DEFAULT 'full',
      description TEXT,
      blocks TEXT DEFAULT '[]',
      loop_count INTEGER NOT NULL DEFAULT 0,
      tags TEXT,
      attachments TEXT,
      notes TEXT,
      rank INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT
    );
  `);

  // Migration: add pipeline column if missing
  try { db.exec(`ALTER TABLE tasks ADD COLUMN pipeline TEXT NOT NULL DEFAULT 'full'`); } catch { /* exists */ }
  try { db.exec(`ALTER TABLE tasks ADD COLUMN blocks TEXT DEFAULT '[]'`); } catch { /* exists */ }
  try { db.exec(`ALTER TABLE tasks ADD COLUMN loop_count INTEGER NOT NULL DEFAULT 0`); } catch { /* exists */ }

  _db = db;
  return db;
}

function renumberRanks(db: Database.Database, status: string) {
  const rows = db
    .prepare("SELECT id FROM tasks WHERE status = ? ORDER BY rank, id")
    .all(status) as { id: number }[];
  const stmt = db.prepare("UPDATE tasks SET rank = ? WHERE id = ?");
  for (let i = 0; i < rows.length; i++) {
    stmt.run((i + 1) * 1000, rows[i].id);
  }
}

// ── Types ───────────────────────────────────────────────

interface Block {
  agent: string;
  content: string;
  decision_log: string;
  verdict: "ok" | "nok";
  timestamp: string;
}

interface Task {
  id: number;
  title: string;
  status: string;
  priority: string;
  pipeline: string;
  rank: number;
  description: string | null;
  blocks: string;
  loop_count: number;
  tags: string | null;
  attachments: string | null;
  notes: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

// ── Plugin ──────────────────────────────────────────────

export function kanbanApiPlugin(): Plugin {
  return {
    name: "kanban-api",
    configureServer(server: ViteDevServer) {
      function parseBody(req: any): Promise<any> {
        return new Promise((resolve) => {
          let body = "";
          req.on("data", (chunk: string) => (body += chunk));
          req.on("end", () => {
            try { resolve(JSON.parse(body)); } catch { resolve({}); }
          });
        });
      }

      server.middlewares.use(async (req, res, next) => {
        const reqUrl = new URL(req.url || "/", "http://localhost");
        const pathname = reqUrl.pathname;

        // ── Pipelines ───────────────────────────────

        // GET /api/pipelines
        if (pathname === "/api/pipelines" && req.method === "GET") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(loadPipelines()));
          return;
        }

        // PUT /api/pipelines
        if (pathname === "/api/pipelines" && req.method === "PUT") {
          const body = await parseBody(req);
          if (!body.pipelines || typeof body.pipelines !== "object") {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "pipelines object required" }));
            return;
          }
          const data: PipelinesFile = {
            pipelines: body.pipelines,
            default: body.default || Object.keys(body.pipelines)[0],
            max_loops: body.max_loops ?? 3,
          };
          savePipelines(data);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: true }));
          return;
        }

        // GET /api/agents (names only)
        if (pathname === "/api/agents" && req.method === "GET") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(discoverAgentsDetailed()));
          return;
        }

        // GET /api/agents/:name (single agent detail)
        const agentMatch = pathname.match(/^\/api\/agents\/([^/]+)$/);
        if (agentMatch && req.method === "GET") {
          const info = getAgentDetail(decodeURIComponent(agentMatch[1]));
          if (!info) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: "Agent not found" }));
            return;
          }
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(info));
          return;
        }

        // ── Board ───────────────────────────────────

        // GET /api/board?pipeline=xxx
        if (pathname === "/api/board") {
          const pipelineName = reqUrl.searchParams.get("pipeline") || undefined;
          const db = getDb();
          const pipeline = getPipeline(pipelineName);
          const columnOrder = getColumns(pipeline);

          // Load tasks for this pipeline
          const tasks = db
            .prepare("SELECT * FROM tasks WHERE pipeline = ? ORDER BY rank, id")
            .all(pipeline.name) as Task[];

          const columns: Record<string, Task[]> = {};
          for (const col of columnOrder) columns[col] = [];
          for (const t of tasks) {
            if (columns[t.status]) {
              columns[t.status].push(t);
            } else {
              columns["todo"].push(t);
            }
          }

          const all = loadPipelines();
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({
            columns,
            column_order: columnOrder,
            pipeline: pipeline.name,
            pipelines: Object.keys(all.pipelines),
          }));
          return;
        }

        // ── Task CRUD ───────────────────────────────

        const taskMatch = pathname.match(/^\/api\/task\/(\d+)$/);
        if (taskMatch) {
          const id = parseInt(taskMatch[1]);
          const db = getDb();

          // GET /api/task/:id
          if (req.method === "GET") {
            const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined;
            if (!task) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: "Not found" }));
              return;
            }
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(task));
            return;
          }

          // PATCH /api/task/:id
          if (req.method === "PATCH") {
            const body = await parseBody(req);

            // Status transition validation
            if (body.status !== undefined) {
              const task = db
                .prepare("SELECT status, pipeline FROM tasks WHERE id = ?")
                .get(id) as { status: string; pipeline: string } | undefined;
              if (task) {
                const pipeline = getPipeline(task.pipeline);
                const transitions = getTransitions(pipeline);
                const allowed = transitions[task.status];
                if (allowed && !allowed.includes(body.status)) {
                  res.statusCode = 400;
                  res.end(JSON.stringify({
                    error: `Invalid transition: ${task.status} -> ${body.status}`,
                    allowed,
                  }));
                  return;
                }
              }
            }

            const sets: string[] = [];
            const values: any[] = [];

            if (body.status !== undefined) {
              sets.push("status = ?");
              values.push(body.status);
              // Determine first stage for started_at
              const task = db.prepare("SELECT pipeline FROM tasks WHERE id = ?").get(id) as { pipeline: string } | undefined;
              if (task) {
                const pipeline = getPipeline(task.pipeline);
                const cols = getColumns(pipeline);
                if (body.status === cols[1]) {
                  sets.push("started_at = COALESCE(started_at, datetime('now'))");
                } else if (body.status === "done") {
                  sets.push("completed_at = datetime('now')");
                } else if (body.status === "todo") {
                  sets.push("started_at = NULL");
                  sets.push("completed_at = NULL");
                }
              }
            }
            if (body.title !== undefined) { sets.push("title = ?"); values.push(body.title); }
            if (body.priority !== undefined) { sets.push("priority = ?"); values.push(body.priority); }
            if (body.pipeline !== undefined) { sets.push("pipeline = ?"); values.push(body.pipeline); }
            if (body.description !== undefined) { sets.push("description = ?"); values.push(body.description); }
            if (body.tags !== undefined) {
              sets.push("tags = ?");
              values.push(typeof body.tags === "string" ? body.tags : JSON.stringify(body.tags));
            }
            if (body.loop_count !== undefined) { sets.push("loop_count = ?"); values.push(body.loop_count); }
            if (body.rank !== undefined) { sets.push("rank = ?"); values.push(body.rank); }

            if (sets.length > 0) {
              values.push(id);
              db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...values);
            }

            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ success: true }));
            return;
          }

          // DELETE /api/task/:id
          if (req.method === "DELETE") {
            const task = db
              .prepare("SELECT attachments FROM tasks WHERE id = ?")
              .get(id) as { attachments: string | null } | undefined;
            if (task?.attachments) {
              try {
                for (const a of JSON.parse(task.attachments)) {
                  try { fs.unlinkSync(path.join(IMAGES_DIR, a.storedName)); } catch { /* ok */ }
                }
              } catch { /* ok */ }
            }
            db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ success: true }));
            return;
          }
        }

        // PATCH /api/task/:id/reorder
        const reorderMatch = pathname.match(/^\/api\/task\/(\d+)\/reorder$/);
        if (reorderMatch && req.method === "PATCH") {
          const id = parseInt(reorderMatch[1]);
          const body = await parseBody(req);
          const db = getDb();

          const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined;
          if (!task) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: "Not found" }));
            return;
          }

          const targetStatus = body.status || task.status;

          if (targetStatus !== task.status) {
            const pipeline = getPipeline(task.pipeline);
            const transitions = getTransitions(pipeline);
            const allowed = transitions[task.status];
            if (allowed && !allowed.includes(targetStatus)) {
              res.statusCode = 400;
              res.end(JSON.stringify({
                error: `Invalid transition: ${task.status} -> ${targetStatus}`,
                allowed,
              }));
              return;
            }

            const sets: string[] = ["status = ?"];
            const vals: any[] = [targetStatus];
            const cols = getColumns(pipeline);
            if (targetStatus === cols[1]) {
              sets.push("started_at = COALESCE(started_at, datetime('now'))");
            } else if (targetStatus === "done") {
              sets.push("completed_at = datetime('now')");
            } else if (targetStatus === "todo") {
              sets.push("started_at = NULL");
              sets.push("completed_at = NULL");
            }
            vals.push(id);
            db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
          }

          let newRank: number;
          const afterId = body.afterId as number | null;
          const beforeId = body.beforeId as number | null;

          if (afterId && beforeId) {
            const above = db.prepare("SELECT rank FROM tasks WHERE id = ?").get(afterId) as { rank: number } | undefined;
            const below = db.prepare("SELECT rank FROM tasks WHERE id = ?").get(beforeId) as { rank: number } | undefined;
            if (above && below) {
              newRank = Math.floor((above.rank + below.rank) / 2);
              if (newRank === above.rank) {
                renumberRanks(db, targetStatus);
                const a2 = db.prepare("SELECT rank FROM tasks WHERE id = ?").get(afterId) as { rank: number };
                const b2 = db.prepare("SELECT rank FROM tasks WHERE id = ?").get(beforeId) as { rank: number };
                newRank = Math.floor((a2.rank + b2.rank) / 2);
              }
            } else {
              newRank = 1000;
            }
          } else if (afterId) {
            const above = db.prepare("SELECT rank FROM tasks WHERE id = ?").get(afterId) as { rank: number } | undefined;
            newRank = above ? above.rank + 1000 : 1000;
          } else if (beforeId) {
            const below = db.prepare("SELECT rank FROM tasks WHERE id = ?").get(beforeId) as { rank: number } | undefined;
            if (below) {
              newRank = Math.floor(below.rank / 2);
              if (newRank === 0) {
                renumberRanks(db, targetStatus);
                const b2 = db.prepare("SELECT rank FROM tasks WHERE id = ?").get(beforeId) as { rank: number };
                newRank = Math.floor(b2.rank / 2);
              }
            } else {
              newRank = 1000;
            }
          } else {
            newRank = 1000;
          }

          db.prepare("UPDATE tasks SET rank = ? WHERE id = ?").run(newRank, id);

          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: true, rank: newRank }));
          return;
        }

        // POST /api/task
        if (pathname === "/api/task" && req.method === "POST") {
          const body = await parseBody(req);
          const db = getDb();
          const title = body.title || "Untitled";
          const priority = body.priority || "medium";
          const pipelineName = body.pipeline || loadPipelines().default;
          const description = body.description || null;
          const tags = body.tags !== undefined
            ? typeof body.tags === "string" ? body.tags : JSON.stringify(body.tags)
            : null;

          const maxRankRow = db
            .prepare("SELECT MAX(rank) as maxRank FROM tasks WHERE status = 'todo' AND pipeline = ?")
            .get(pipelineName) as { maxRank: number | null } | undefined;
          const rank = (maxRankRow?.maxRank ?? 0) + 1000;

          const result = db
            .prepare(
              `INSERT INTO tasks (title, priority, pipeline, description, tags, rank)
               VALUES (?, ?, ?, ?, ?, ?)`
            )
            .run(title, priority, pipelineName, description, tags, rank);

          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: true, id: result.lastInsertRowid }));
          return;
        }

        // ── Blocks ──────────────────────────────────

        const blockMatch = pathname.match(/^\/api\/task\/(\d+)\/block$/);
        if (blockMatch && req.method === "POST") {
          const id = parseInt(blockMatch[1]);
          const body = await parseBody(req);
          const db = getDb();

          const task = db.prepare("SELECT blocks FROM tasks WHERE id = ?").get(id) as { blocks: string | null } | undefined;
          if (!task) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: "Not found" }));
            return;
          }

          const blocks: Block[] = task.blocks ? JSON.parse(task.blocks) : [];
          const newBlock: Block = {
            agent: body.agent || "unknown",
            content: body.content || "",
            decision_log: body.decision_log || "",
            verdict: body.verdict === "nok" ? "nok" : "ok",
            timestamp: new Date().toISOString(),
          };
          blocks.push(newBlock);

          db.prepare("UPDATE tasks SET blocks = ? WHERE id = ?").run(JSON.stringify(blocks), id);

          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: true, block: newBlock }));
          return;
        }

        // ── Notes ───────────────────────────────────

        const noteMatch = pathname.match(/^\/api\/task\/(\d+)\/note$/);
        if (noteMatch && req.method === "POST") {
          const id = parseInt(noteMatch[1]);
          const body = await parseBody(req);
          const db = getDb();

          const task = db
            .prepare("SELECT notes, loop_count FROM tasks WHERE id = ?")
            .get(id) as { notes: string | null; loop_count: number } | undefined;
          if (!task) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: "Not found" }));
            return;
          }

          const notes = task.notes ? JSON.parse(task.notes) : [];
          const note = {
            id: Date.now(),
            text: body.text || "",
            author: body.author || "user",
            timestamp: new Date().toISOString(),
          };
          notes.push(note);

          const all = loadPipelines();
          const isBlocked = task.loop_count >= all.max_loops;
          const resetLoopCount = isBlocked && (body.author === "user" || !body.author);

          if (resetLoopCount) {
            db.prepare("UPDATE tasks SET notes = ?, loop_count = 0 WHERE id = ?").run(JSON.stringify(notes), id);
          } else {
            db.prepare("UPDATE tasks SET notes = ? WHERE id = ?").run(JSON.stringify(notes), id);
          }

          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: true, note, loop_count_reset: resetLoopCount }));
          return;
        }

        const noteDeleteMatch = pathname.match(/^\/api\/task\/(\d+)\/note\/(\d+)$/);
        if (noteDeleteMatch && req.method === "DELETE") {
          const id = parseInt(noteDeleteMatch[1]);
          const noteId = parseInt(noteDeleteMatch[2]);
          const db = getDb();

          const task = db.prepare("SELECT notes FROM tasks WHERE id = ?").get(id) as { notes: string | null } | undefined;
          if (!task) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: "Not found" }));
            return;
          }

          const notes = task.notes ? JSON.parse(task.notes) : [];
          const filtered = notes.filter((n: any) => n.id !== noteId);
          db.prepare("UPDATE tasks SET notes = ? WHERE id = ?").run(JSON.stringify(filtered), id);

          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: true }));
          return;
        }

        // ── Attachments ─────────────────────────────

        const attachmentMatch = pathname.match(/^\/api\/task\/(\d+)\/attachment$/);
        if (attachmentMatch && req.method === "POST") {
          const id = parseInt(attachmentMatch[1]);

          const chunks: Buffer[] = [];
          req.on("data", (chunk: Buffer) => chunks.push(chunk));
          await new Promise<void>((resolve) => req.on("end", resolve));
          let body: any;
          try {
            body = JSON.parse(Buffer.concat(chunks).toString());
          } catch {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "Invalid JSON" }));
            return;
          }

          const db = getDb();
          const task = db
            .prepare("SELECT attachments FROM tasks WHERE id = ?")
            .get(id) as { attachments: string | null } | undefined;
          if (!task) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: "Not found" }));
            return;
          }

          const filename = (body.filename || "image.png").replace(/[^a-zA-Z0-9._-]/g, "_");
          const ext = path.extname(filename) || ".png";
          const safeName = `${id}_${Date.now()}${ext}`;
          const filePath = path.resolve(IMAGES_DIR, safeName);

          const base64Data = body.data.replace(/^data:[^;]+;base64,/, "");
          fs.writeFileSync(filePath, Buffer.from(base64Data, "base64"));

          const attachments = task.attachments ? JSON.parse(task.attachments) : [];
          attachments.push({
            filename: body.filename || "image.png",
            storedName: safeName,
            url: `/api/uploads/${safeName}`,
            size: fs.statSync(filePath).size,
            uploaded_at: new Date().toISOString(),
          });

          db.prepare("UPDATE tasks SET attachments = ? WHERE id = ?").run(JSON.stringify(attachments), id);

          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: true, attachment: attachments[attachments.length - 1] }));
          return;
        }

        const attachmentDeleteMatch = pathname.match(/^\/api\/task\/(\d+)\/attachment\/([^/]+)$/);
        if (attachmentDeleteMatch && req.method === "DELETE") {
          const id = parseInt(attachmentDeleteMatch[1]);
          const storedName = decodeURIComponent(attachmentDeleteMatch[2]);
          const db = getDb();

          const task = db.prepare("SELECT attachments FROM tasks WHERE id = ?").get(id) as { attachments: string | null } | undefined;
          if (!task) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: "Not found" }));
            return;
          }

          const attachments = task.attachments ? JSON.parse(task.attachments) : [];
          const idx = attachments.findIndex((a: any) => a.storedName === storedName);
          if (idx >= 0) {
            const removed = attachments.splice(idx, 1)[0];
            try { fs.unlinkSync(path.join(IMAGES_DIR, removed.storedName)); } catch { /* ok */ }
            db.prepare("UPDATE tasks SET attachments = ? WHERE id = ?").run(JSON.stringify(attachments), id);
          }

          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ success: true }));
          return;
        }

        // GET /api/uploads/:filename
        const uploadsMatch = pathname.match(/^\/api\/uploads\/([^/]+)$/);
        if (uploadsMatch && req.method === "GET") {
          const filename = decodeURIComponent(uploadsMatch[1]);
          const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
          const filePath = path.resolve(IMAGES_DIR, safeName);

          if (!filePath.startsWith(IMAGES_DIR)) {
            res.statusCode = 403;
            res.end(JSON.stringify({ error: "Forbidden" }));
            return;
          }
          if (!fs.existsSync(filePath)) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: "Not found" }));
            return;
          }

          const ext = path.extname(safeName).toLowerCase();
          const mimeTypes: Record<string, string> = {
            ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
          };
          res.setHeader("Content-Type", mimeTypes[ext] || "application/octet-stream");
          res.setHeader("Cache-Control", "public, max-age=86400");
          res.end(fs.readFileSync(filePath));
          return;
        }

        next();
      });
    },
  };
}
