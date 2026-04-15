import fs from "fs";
import os from "os";
import path from "path";
import type { AgentInfo } from "./types.js";

interface AgentDir {
  dir: string;
  source: string;
  prefix?: string;
}

function getAgentDirs(): AgentDir[] {
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
  for (const { dir, source, prefix } of getAgentDirs()) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".md")) continue;
      const baseName = file.replace(/\.md$/, "");
      const name = `${prefix ?? ""}${baseName}`;
      const filePath = path.join(dir, file);
      agents.set(name, parseAgentFrontmatter(name, filePath, source));
    }
  }
  return [...agents.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function getAgentDetail(name: string): AgentInfo | null {
  for (const { dir, source, prefix } of [...getAgentDirs()].reverse()) {
    const baseName = prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name;
    if (prefix && !name.startsWith(prefix)) continue;
    const filePath = path.join(dir, `${baseName}.md`);
    if (fs.existsSync(filePath)) return parseAgentFrontmatter(name, filePath, source);
  }
  return null;
}
