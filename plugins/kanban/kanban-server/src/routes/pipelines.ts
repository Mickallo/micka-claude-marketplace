import { Hono } from "hono";
import type { PipelinesFile } from "../types.js";
import { loadPipelines, savePipelines } from "../pipelines.js";
import { discoverAgentsDetailed, getAgentDetail } from "../agents.js";

const app = new Hono();

app.get("/api/pipelines", (c) => {
  return c.json(loadPipelines());
});

app.put("/api/pipelines", async (c) => {
  const body = await c.req.json();
  if (!body.pipelines || typeof body.pipelines !== "object") {
    return c.json({ error: "pipelines object required" }, 400);
  }
  const data: PipelinesFile = {
    pipelines: body.pipelines,
    default: body.default || Object.keys(body.pipelines)[0],
    max_loops: body.max_loops ?? 3,
  };
  savePipelines(data);
  return c.json({ success: true });
});

app.get("/api/agents", (c) => {
  return c.json(discoverAgentsDetailed());
});

app.get("/api/agents/:name", (c) => {
  const info = getAgentDetail(c.req.param("name"));
  if (!info) return c.json({ error: "Agent not found" }, 404);
  return c.json(info);
});

export default app;
