import fs from "fs";
import os from "os";
import path from "path";
import type { AgentInfo } from "./types.js";

function getAgentDirs(): { dir: string; source: string }[] {
  const pluginAgents = path.resolve(import.meta.dirname, "..", "..", "agents");
  const projectRoot = process.env.KANBAN_PROJECT_ROOT || process.cwd();
  return [
    { dir: pluginAgents, source: "plugin" },
    { dir: path.resolve(os.homedir(), ".claude", "agents"), source: "user" },
    { dir: path.join(projectRoot, ".claude", "agents"), source: "project" },
  ];
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

  const toolsMatch = fm.match(/^tools:\s*\n((?:\s+-\s+.+\n?)*)/m);
  if (toolsMatch) {
    info.tools = toolsMatch[1]
      .split("\n")
      .map((l) => l.replace(/^\s+-\s+/, "").trim())
      .filter(Boolean);
  }

  const bodyStart = content.indexOf("---", 3);
  if (bodyStart !== -1) {
    const body = content.slice(bodyStart + 3).trim();
    if (body) info.prompt = body;
  }

  return info;
}

export function discoverAgentsDetailed(): AgentInfo[] {
  const agents = new Map<string, AgentInfo>();
  for (const { dir, source } of getAgentDirs()) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".md")) continue;
      const name = file.replace(/\.md$/, "");
      const filePath = path.join(dir, file);
      agents.set(name, parseAgentFrontmatter(name, filePath, source));
    }
  }
  return [...agents.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function getAgentDetail(name: string): AgentInfo | null {
  for (const { dir, source } of [...getAgentDirs()].reverse()) {
    const filePath = path.join(dir, `${name}.md`);
    if (fs.existsSync(filePath)) return parseAgentFrontmatter(name, filePath, source);
  }
  return null;
}
