import fs from "fs";
import path from "path";
import type { PipelineConfig, PipelinesFile } from "./types.js";
import { KANBAN_DIR_PATH } from "./db.js";

const PIPELINES_PATH = path.join(KANBAN_DIR_PATH, "pipelines.json");

const DEFAULT_PIPELINES: PipelinesFile = {
  pipelines: {
    full: {
      stages: ["Resolver", "Planner", "Critic", "Builder", "Inspector", "Ranger"],
      gates: [],
    },
    quick: { stages: ["Resolver", "Builder", "Ranger"] },
  },
  default: "full",
  max_loops: 3,
};

let _cache: { data: PipelinesFile; mtime: number } | null = null;

export function loadPipelines(): PipelinesFile {
  if (!fs.existsSync(PIPELINES_PATH)) return DEFAULT_PIPELINES;
  try {
    const stat = fs.statSync(PIPELINES_PATH);
    if (_cache && _cache.mtime === stat.mtimeMs) return _cache.data;
    const data = JSON.parse(fs.readFileSync(PIPELINES_PATH, "utf-8")) as PipelinesFile;
    if (!data.pipelines || Object.keys(data.pipelines).length === 0) return DEFAULT_PIPELINES;
    data.max_loops = data.max_loops ?? 3;
    data.default = data.default ?? Object.keys(data.pipelines)[0];
    _cache = { data, mtime: stat.mtimeMs };
    return data;
  } catch {
    return DEFAULT_PIPELINES;
  }
}

export function savePipelines(data: PipelinesFile): void {
  fs.writeFileSync(PIPELINES_PATH, JSON.stringify(data, null, 2) + "\n");
  _cache = null;
}

export function getPipeline(name?: string): PipelineConfig & { name: string } {
  const all = loadPipelines();
  const key = name || all.default;
  const pipeline = all.pipelines[key];
  if (pipeline) return { ...pipeline, name: key };
  const defPipeline = all.pipelines[all.default];
  if (defPipeline) return { ...defPipeline, name: all.default };
  const firstKey = Object.keys(all.pipelines)[0];
  return { ...all.pipelines[firstKey], name: firstKey };
}

export function getColumns(pipeline: PipelineConfig): string[] {
  return ["todo", ...pipeline.stages, "done"];
}

export function getTransitions(pipeline: PipelineConfig): Record<string, string[]> {
  const columns = getColumns(pipeline);
  const transitions: Record<string, string[]> = {};
  for (let i = 0; i < columns.length; i++) {
    const allowed: string[] = [];
    if (i < columns.length - 1) allowed.push(columns[i + 1]);
    if (i > 0) allowed.push(columns[i - 1]);
    const gates = pipeline.gates || [];
    if (gates.includes(columns[i])) {
      allowed.push(`awaiting:${columns[i]}`);
    }
    transitions[columns[i]] = allowed;
  }
  transitions["done"] = [];
  const gates = pipeline.gates || [];
  for (const gate of gates) {
    const idx = columns.indexOf(gate);
    if (idx === -1) continue;
    const allowed: string[] = [gate];
    if (idx < columns.length - 1) allowed.push(columns[idx + 1]);
    transitions[`awaiting:${gate}`] = allowed;
  }
  return transitions;
}
