import { Hono } from "hono";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { spawnAgent } from "../terminal.js";
import { getDb, renumberRanks, IMAGES_DIR } from "../db.js";
import { getPipeline, getColumns, getTransitions, loadPipelines } from "../pipelines.js";
import { eventBus } from "../events.js";
import type { Task, Block } from "../types.js";
import gitRoutes from "./git.js";

const app = new Hono();

// ── Create task ──────────────────────────────────────────

app.post("/api/task", async (c) => {
  const body = await c.req.json();
  const db = getDb();
  const title = body.title || "Untitled";
  const priority = body.priority || "medium";
  const pipelineName = body.pipeline || loadPipelines().default;
  const description = body.description || null;
  const tags =
    body.tags !== undefined
      ? typeof body.tags === "string"
        ? body.tags
        : JSON.stringify(body.tags)
      : null;

  const maxRankRow = db
    .prepare("SELECT MAX(rank) as maxRank FROM tasks WHERE status = 'todo' AND pipeline = ?")
    .get(pipelineName) as { maxRank: number | null } | undefined;
  const rank = (maxRankRow?.maxRank ?? 0) + 1000;

  // Build initial blocks: description becomes first user block
  const initialBlocks: Block[] = [];
  if (description) {
    initialBlocks.push({
      agent: "user",
      agent_id: null,
      content: description,
      decision_log: "",
      verdict: "info",
      timestamp: new Date().toISOString(),
    });
  }

  const result = db
    .prepare(
      `INSERT INTO tasks (title, priority, pipeline, description, tags, rank, blocks)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(title, priority, pipelineName, description, tags, rank, JSON.stringify(initialBlocks));

  const id = result.lastInsertRowid as number;
  eventBus.taskUpdated(id);
  return c.json({ success: true, id });
});

// ── Get task ─────────────────────────────────────────────

app.get("/api/task/:id", (c) => {
  const id = parseInt(c.req.param("id"));
  const db = getDb();
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined;
  if (!task) return c.json({ error: "Not found" }, 404);
  return c.json(task);
});

// ── Update task ──────────────────────────────────────────

app.patch("/api/task/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  const body = await c.req.json();
  const db = getDb();

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
        return c.json(
          { error: `Invalid transition: ${task.status} -> ${body.status}`, allowed },
          400
        );
      }
    }
  }

  const sets: string[] = [];
  const values: unknown[] = [];

  if (body.status !== undefined) {
    const oldStatus = (
      db.prepare("SELECT status, pipeline FROM tasks WHERE id = ?").get(id) as {
        status: string;
        pipeline: string;
      } | undefined
    );
    sets.push("status = ?");
    values.push(body.status);
    if (oldStatus) {
      const pipeline = getPipeline(oldStatus.pipeline);
      const cols = getColumns(pipeline);
      if (body.status === cols[1]) {
        sets.push("started_at = COALESCE(started_at, datetime('now'))");
      } else if (body.status === "done") {
        sets.push("completed_at = datetime('now')");
      } else if (body.status === "todo") {
        sets.push("started_at = NULL");
        sets.push("completed_at = NULL");
      }
      if (oldStatus.status !== body.status) {
        setTimeout(() => eventBus.taskMoved(id, oldStatus.status, body.status), 0);
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
    eventBus.taskUpdated(id);
  }

  return c.json({ success: true });
});

// ── Delete task ──────────────────────────────────────────

app.delete("/api/task/:id", (c) => {
  const id = parseInt(c.req.param("id"));
  const db = getDb();
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
  eventBus.taskUpdated(id);
  return c.json({ success: true });
});

// ── Reorder ──────────────────────────────────────────────

app.patch("/api/task/:id/reorder", async (c) => {
  const id = parseInt(c.req.param("id"));
  const body = await c.req.json();
  const db = getDb();

  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined;
  if (!task) return c.json({ error: "Not found" }, 404);

  const targetStatus = body.status || task.status;

  if (targetStatus !== task.status) {
    const pipeline = getPipeline(task.pipeline);
    const transitions = getTransitions(pipeline);
    const allowed = transitions[task.status];
    if (allowed && !allowed.includes(targetStatus)) {
      return c.json(
        { error: `Invalid transition: ${task.status} -> ${targetStatus}`, allowed },
        400
      );
    }

    const sets: string[] = ["status = ?"];
    const vals: unknown[] = [targetStatus];
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
    eventBus.taskMoved(id, task.status, targetStatus);
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
  eventBus.taskUpdated(id);
  return c.json({ success: true, rank: newRank });
});

// ── Blocks ───────────────────────────────────────────────

app.post("/api/task/:id/block", async (c) => {
  const id = parseInt(c.req.param("id"));
  const body = await c.req.json();
  const db = getDb();

  const task = db.prepare("SELECT blocks FROM tasks WHERE id = ?").get(id) as { blocks: string | null } | undefined;
  if (!task) return c.json({ error: "Not found" }, 404);

  const blocks: Block[] = task.blocks ? JSON.parse(task.blocks) : [];
  const newBlock: Block = {
    agent: body.agent || "unknown",
    agent_id: body.agent_id || null,
    content: body.content || "",
    decision_log: body.decision_log || "",
    verdict: body.verdict === "nok" ? "nok" : body.verdict === "relay" ? "relay" : body.verdict === "running" ? "running" : "ok",
    timestamp: new Date().toISOString(),
  };
  blocks.push(newBlock);

  db.prepare("UPDATE tasks SET blocks = ? WHERE id = ?").run(JSON.stringify(blocks), id);

  // Optional: force move to a specific status (bypass transition validation)
  if (body.force_status) {
    db.prepare("UPDATE tasks SET status = ? WHERE id = ?").run(body.force_status, id);
    eventBus.taskMoved(id, "manual", body.force_status);
  }

  eventBus.blockAdded(id, newBlock.agent, newBlock.verdict);
  return c.json({ success: true, block: newBlock, index: blocks.length - 1 });
});

// Update the last block (used by runner when agent finishes)
app.patch("/api/task/:id/block", async (c) => {
  const id = parseInt(c.req.param("id"));
  const body = await c.req.json();
  const db = getDb();

  const task = db.prepare("SELECT blocks FROM tasks WHERE id = ?").get(id) as { blocks: string | null } | undefined;
  if (!task) return c.json({ error: "Not found" }, 404);

  const blocks: Block[] = task.blocks ? JSON.parse(task.blocks) : [];
  if (blocks.length === 0) return c.json({ error: "No blocks to update" }, 400);

  const last = blocks[blocks.length - 1];
  if (body.agent_id !== undefined) last.agent_id = body.agent_id;
  if (body.content !== undefined) last.content = body.content;
  if (body.decision_log !== undefined) last.decision_log = body.decision_log;
  if (body.verdict !== undefined) last.verdict = body.verdict;

  db.prepare("UPDATE tasks SET blocks = ? WHERE id = ?").run(JSON.stringify(blocks), id);
  eventBus.blockAdded(id, last.agent, last.verdict);
  return c.json({ success: true, block: last });
});

// ── Gates ────────────────────────────────────────────────

app.post("/api/task/:id/gate", async (c) => {
  const id = parseInt(c.req.param("id"));
  const body = await c.req.json();
  const db = getDb();

  const task = db
    .prepare("SELECT status, pipeline, blocks, loop_count FROM tasks WHERE id = ?")
    .get(id) as { status: string; pipeline: string; blocks: string | null; loop_count: number } | undefined;
  if (!task) return c.json({ error: "Not found" }, 404);

  const pipeline = getPipeline(task.pipeline);
  const columns = getColumns(pipeline);
  const all = loadPipelines();

  // Determine if task is in a gate or blocked state
  const isAwaiting = task.status.startsWith("awaiting:");
  const isBlocked = task.loop_count >= all.max_loops;
  if (!isAwaiting && !isBlocked) {
    return c.json({ error: "Task is not awaiting validation or blocked" }, 400);
  }

  const currentStage = isAwaiting ? task.status.slice("awaiting:".length) : task.status;
  const stageIdx = columns.indexOf(currentStage);

  const blocks: Block[] = task.blocks ? JSON.parse(task.blocks) : [];

  if (body.action === "approve") {
    const nextStage = columns[stageIdx + 1] || "done";

    // Add user ok block
    blocks.push({
      agent: "user",
      agent_id: null,
      content: body.comment || "",
      decision_log: "",
      verdict: "ok",
      timestamp: new Date().toISOString(),
    });

    const sets = ["status = ?", "loop_count = 0", "blocks = ?"];
    const vals: unknown[] = [nextStage, JSON.stringify(blocks)];
    if (nextStage === "done") sets.push("completed_at = datetime('now')");
    vals.push(id);
    db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
    eventBus.taskMoved(id, task.status, nextStage);
    return c.json({ success: true, status: nextStage });
  }

  if (body.action === "refuse") {
    const comment = body.comment || "";
    if (!comment.trim()) {
      return c.json({ error: "A comment is required when refusing" }, 400);
    }

    // Add user nok block
    blocks.push({
      agent: "user",
      agent_id: null,
      content: comment,
      decision_log: "",
      verdict: "nok",
      timestamp: new Date().toISOString(),
    });

    // Stay on same stage, reset loop_count
    db.prepare("UPDATE tasks SET status = ?, blocks = ?, loop_count = 0 WHERE id = ?")
      .run(currentStage, JSON.stringify(blocks), id);
    if (task.status !== currentStage) {
      eventBus.taskMoved(id, task.status, currentStage);
    }
    eventBus.taskUpdated(id);
    return c.json({ success: true, status: currentStage });
  }

  return c.json({ error: "action must be 'approve' or 'refuse'" }, 400);
});

// ── Attachments ──────────────────────────────────────────

app.post("/api/task/:id/attachment", async (c) => {
  const id = parseInt(c.req.param("id"));
  const body = await c.req.json();
  const db = getDb();

  const task = db
    .prepare("SELECT attachments FROM tasks WHERE id = ?")
    .get(id) as { attachments: string | null } | undefined;
  if (!task) return c.json({ error: "Not found" }, 404);

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
  eventBus.taskUpdated(id);
  return c.json({ success: true, attachment: attachments[attachments.length - 1] });
});

app.delete("/api/task/:id/attachment/:storedName", (c) => {
  const id = parseInt(c.req.param("id"));
  const storedName = c.req.param("storedName");
  const db = getDb();

  const task = db.prepare("SELECT attachments FROM tasks WHERE id = ?").get(id) as { attachments: string | null } | undefined;
  if (!task) return c.json({ error: "Not found" }, 404);

  const attachments = task.attachments ? JSON.parse(task.attachments) : [];
  const idx = attachments.findIndex((a: { storedName: string }) => a.storedName === storedName);
  if (idx >= 0) {
    const removed = attachments.splice(idx, 1)[0];
    try { fs.unlinkSync(path.join(IMAGES_DIR, removed.storedName)); } catch { /* ok */ }
    db.prepare("UPDATE tasks SET attachments = ? WHERE id = ?").run(JSON.stringify(attachments), id);
  }

  eventBus.taskUpdated(id);
  return c.json({ success: true });
});

// ── Uploads (serve images) ───────────────────────────────

app.get("/api/uploads/:filename", (c) => {
  const filename = c.req.param("filename").replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = path.resolve(IMAGES_DIR, filename);

  if (!filePath.startsWith(IMAGES_DIR)) return c.json({ error: "Forbidden" }, 403);
  if (!fs.existsSync(filePath)) return c.json({ error: "Not found" }, 404);

  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  };
  const contentType = mimeTypes[ext] || "application/octet-stream";
  const data = fs.readFileSync(filePath);

  return new Response(data, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400",
    },
  });
});

// ── Dispatch agent (spawn claude with live terminal) ─────

app.post("/api/task/:id/dispatch", async (c) => {
  const id = parseInt(c.req.param("id"));
  const body = await c.req.json();
  const db = getDb();

  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined;
  if (!task) return c.json({ error: "Not found" }, 404);

  const prompt = body.prompt as string;
  const agent = body.agent as string;
  const resume = body.resume as string | undefined;

  if (!prompt || !agent) return c.json({ error: "prompt and agent required" }, 400);

  // Use --agent to leverage the agent's prompt, model, and tools from agents/*.md
  // -p sends the task context as the initial message
  const args: string[] = [];
  if (resume) {
    args.push("--resume", resume, "-p", prompt);
  } else {
    args.push("--agent", `kanban:${agent}`, "-p", prompt);
  }
  args.push("--output-format", "json");

  const { terminalId } = spawnAgent({
    args,
    interactive: false,  // child_process for clean JSON output
    onFinish: (output, exitCode) => {
      // Strip ANSI escape codes and control chars
      const clean = output
        .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
        .replace(/\x1b\][^\x07]*\x07/g, "")
        .replace(/\x1b[><=][^\n]*/g, "")
        .replace(/\x1b\[\?[0-9;]*[a-zA-Z]/g, "")
        .replace(/\r/g, "")
        .trim();

      // Try to extract JSON from output (--output-format json wraps in {"type":"result",...})
      let sessionId: string | null = null;
      let parsedText = clean;
      let model: string | undefined;
      let inputTokens: number | undefined;
      let outputTokens: number | undefined;
      let costUsd: number | undefined;
      let durationMs: number | undefined;
      const jsonMatch = clean.match(/\{["\s]*type["\s]*:["\s]*result[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const json = JSON.parse(jsonMatch[0]);
          sessionId = json.session_id || null;
          parsedText = json.result || json.text || clean;
          // Extract model and usage
          if (json.modelUsage) {
            const modelName = Object.keys(json.modelUsage)[0];
            if (modelName) {
              model = modelName;
              const mu = json.modelUsage[modelName];
              inputTokens = (mu.inputTokens || 0) + (mu.cacheReadInputTokens || 0) + (mu.cacheCreationInputTokens || 0);
              outputTokens = mu.outputTokens || 0;
              costUsd = mu.costUSD;
            }
          }
          if (json.duration_ms) durationMs = json.duration_ms;
          if (json.total_cost_usd && !costUsd) costUsd = json.total_cost_usd;
        } catch {
          // JSON parse failed — try line by line
          for (const line of clean.split("\n")) {
            const trimmed = line.trim();
            if (trimmed.startsWith("{") && trimmed.includes("session_id")) {
              try {
                const json = JSON.parse(trimmed);
                sessionId = json.session_id || null;
                parsedText = json.result || json.text || clean;
              } catch {}
            }
          }
        }
      }

      // Parse verdict
      const verdictMatch = parsedText.match(/## Verdict\s*\n\s*(ok|nok|relay)/i);
      const lines = parsedText.trim().split("\n").filter((l: string) => l.trim());
      const lastLine = lines[lines.length - 1]?.trim().toLowerCase();
      const verdict = verdictMatch ? verdictMatch[1] as "ok" | "nok" | "relay" :
        (lastLine === "ok" || lastLine === "nok" || lastLine === "relay") ? lastLine as "ok" | "nok" | "relay" :
        exitCode === 0 ? "ok" : "nok";

      // Parse content/decision_log
      const contentMatch = parsedText.match(/## Content\s*\n([\s\S]*?)(?=\n## Decision Log|\n## Verdict|$)/);
      const decisionMatch = parsedText.match(/## Decision Log\s*\n([\s\S]*?)(?=\n## Verdict|$)/);
      const content = contentMatch ? contentMatch[1].trim() : parsedText.slice(0, 5000);
      const decisionLog = decisionMatch ? decisionMatch[1].trim() : "";

      // Update the running block with session_id for resume
      const taskNow = db.prepare("SELECT blocks FROM tasks WHERE id = ?").get(id) as { blocks: string | null } | undefined;
      if (taskNow) {
        const blocks: Block[] = taskNow.blocks ? JSON.parse(taskNow.blocks) : [];
        const lastBlock = blocks[blocks.length - 1];
        if (lastBlock && lastBlock.verdict === "running") {
          lastBlock.content = content;
          lastBlock.decision_log = decisionLog;
          lastBlock.verdict = verdict;
          lastBlock.agent_id = sessionId; // Real session_id for resume
          if (model) lastBlock.model = model;
          if (inputTokens !== undefined) lastBlock.input_tokens = inputTokens;
          if (outputTokens !== undefined) lastBlock.output_tokens = outputTokens;
          if (costUsd !== undefined) lastBlock.cost_usd = costUsd;
          if (durationMs !== undefined) lastBlock.duration_ms = durationMs;
          db.prepare("UPDATE tasks SET blocks = ? WHERE id = ?").run(JSON.stringify(blocks), id);
          eventBus.blockAdded(id, lastBlock.agent, lastBlock.verdict);
        }
      }
    },
  });

  // Write the running block with terminalId
  const blocks: Block[] = task.blocks ? JSON.parse(task.blocks) : [];
  blocks.push({
    agent,
    agent_id: terminalId,  // Use terminalId so frontend can connect
    content: `Running ${agent}...`,
    decision_log: "",
    verdict: "running",
    timestamp: new Date().toISOString(),
  });
  db.prepare("UPDATE tasks SET blocks = ? WHERE id = ?").run(JSON.stringify(blocks), id);
  eventBus.blockAdded(id, agent, "running");

  return c.json({ success: true, terminalId });
});

// ── Run pipeline ─────────────────────────────────────────

const runnerScript = path.resolve(import.meta.dirname, "..", "runner.ts");
const runningTasks = new Map<number, ReturnType<typeof spawn>>();

app.post("/api/task/:id/run", (c) => {
  const id = parseInt(c.req.param("id"));

  if (runningTasks.has(id)) {
    return c.json({ error: "Pipeline already running for this task" }, 400);
  }

  const proc = spawn("npx", ["tsx", runnerScript, "run", String(id), "--auto"], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  runningTasks.set(id, proc);

  proc.stdout?.on("data", (d: Buffer) => console.log(`[runner #${id}] ${d.toString().trim()}`));
  proc.stderr?.on("data", (d: Buffer) => console.error(`[runner #${id}] ${d.toString().trim()}`));

  proc.on("close", () => {
    runningTasks.delete(id);
    console.log(`[runner #${id}] finished`);
  });

  return c.json({ success: true, pid: proc.pid });
});

app.post("/api/task/:id/stop", (c) => {
  const id = parseInt(c.req.param("id"));
  const proc = runningTasks.get(id);
  if (!proc) return c.json({ error: "No running pipeline for this task" }, 404);

  proc.kill("SIGTERM");
  runningTasks.delete(id);
  return c.json({ success: true });
});

app.route("", gitRoutes);

export default app;
