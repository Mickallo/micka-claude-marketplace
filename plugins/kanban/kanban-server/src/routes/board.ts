import { Hono } from "hono";
import { getDb } from "../db.js";
import { getPipeline, getColumns, loadPipelines } from "../pipelines.js";
import type { Task } from "../types.js";

const app = new Hono();

app.get("/api/board", (c) => {
  const pipelineName = c.req.query("pipeline") || undefined;
  const db = getDb();
  const pipeline = getPipeline(pipelineName);
  const columnOrder = getColumns(pipeline);

  const tasks = db
    .prepare("SELECT * FROM tasks WHERE pipeline = ? ORDER BY rank, id")
    .all(pipeline.name) as Task[];

  const columns: Record<string, Task[]> = {};
  for (const col of columnOrder) columns[col] = [];

  for (const t of tasks) {
    if (columns[t.status]) {
      columns[t.status].push(t);
    } else if (t.status.startsWith("awaiting:")) {
      const parentStage = t.status.slice("awaiting:".length);
      if (columns[parentStage]) {
        columns[parentStage].push(t);
      } else {
        columns["todo"].push(t);
      }
    } else {
      columns["todo"].push(t);
    }
  }

  const all = loadPipelines();
  return c.json({
    columns,
    column_order: columnOrder,
    pipeline: pipeline.name,
    pipelines: Object.keys(all.pipelines),
  });
});

export default app;
