import { Hono } from "hono";
import { getDb } from "../db.js";
import type { Task, Block } from "../types.js";

const app = new Hono();

app.get("/api/dashboard", (c) => {
  const db = getDb();
  const pipeline = c.req.query("pipeline") || "";
  const days = parseInt(c.req.query("days") || "0");

  let tasks: Task[];
  if (pipeline) {
    tasks = db.prepare("SELECT * FROM tasks WHERE pipeline = ?").all(pipeline) as Task[];
  } else {
    tasks = db.prepare("SELECT * FROM tasks").all() as Task[];
  }

  let totalCost = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalDuration = 0;
  let blockCount = 0;
  let tasksDone = 0;

  const byAgent: Record<string, { cost: number; tokens: number; count: number }> = {};
  const byModel: Record<string, { cost: number; tokens: number; count: number }> = {};
  const byPipeline: Record<string, { cost: number; tokens: number; count: number }> = {};
  const byDay: Record<string, { cost: number; tokens: number; count: number }> = {};
  const recentRuns: { taskId: number; taskTitle: string; agent: string; model: string; verdict: string; input_tokens: number; output_tokens: number; cost_usd: number; duration_ms: number; timestamp: string }[] = [];

  const cutoff = days > 0 ? new Date(Date.now() - days * 86400000).toISOString() : "";

  for (const task of tasks) {
    if (task.status === "done") tasksDone++;
    const blocks: Block[] = task.blocks ? JSON.parse(task.blocks) : [];

    for (const b of blocks) {
      if (b.verdict === "running" || b.verdict === "info") continue;
      if (!b.model && !b.input_tokens) continue;
      if (cutoff && b.timestamp < cutoff) continue;

      const cost = b.cost_usd || 0;
      const inTok = b.input_tokens || 0;
      const outTok = b.output_tokens || 0;
      const dur = b.duration_ms || 0;
      const tokens = inTok + outTok;

      totalCost += cost;
      totalInputTokens += inTok;
      totalOutputTokens += outTok;
      totalDuration += dur;
      blockCount++;

      if (!byAgent[b.agent]) byAgent[b.agent] = { cost: 0, tokens: 0, count: 0 };
      byAgent[b.agent].cost += cost;
      byAgent[b.agent].tokens += tokens;
      byAgent[b.agent].count++;

      const model = b.model || "unknown";
      if (!byModel[model]) byModel[model] = { cost: 0, tokens: 0, count: 0 };
      byModel[model].cost += cost;
      byModel[model].tokens += tokens;
      byModel[model].count++;

      if (!byPipeline[task.pipeline]) byPipeline[task.pipeline] = { cost: 0, tokens: 0, count: 0 };
      byPipeline[task.pipeline].cost += cost;
      byPipeline[task.pipeline].tokens += tokens;
      byPipeline[task.pipeline].count++;

      const day = b.timestamp.slice(0, 10);
      if (!byDay[day]) byDay[day] = { cost: 0, tokens: 0, count: 0 };
      byDay[day].cost += cost;
      byDay[day].tokens += tokens;
      byDay[day].count++;

      recentRuns.push({
        taskId: task.id,
        taskTitle: task.title,
        agent: b.agent,
        model: b.model || "unknown",
        verdict: b.verdict,
        input_tokens: inTok,
        output_tokens: outTok,
        cost_usd: cost,
        duration_ms: dur,
        timestamp: b.timestamp,
      });
    }
  }

  recentRuns.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  recentRuns.splice(50);

  const timeline = Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({ date, ...data }));

  return c.json({
    totalCost,
    totalTokens: totalInputTokens + totalOutputTokens,
    totalInputTokens,
    totalOutputTokens,
    tasksDone,
    tasksTotal: tasks.length,
    avgDuration: blockCount > 0 ? Math.round(totalDuration / blockCount) : 0,
    blockCount,
    byAgent,
    byModel,
    byPipeline,
    timeline,
    recentRuns,
  });
});

export default app;
