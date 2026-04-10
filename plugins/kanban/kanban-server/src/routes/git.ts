import { Hono } from "hono";
import { execSync } from "child_process";
import type { Task, Block } from "../types.js";
import { getDb } from "../db.js";

const app = new Hono();

function git(cmd: string, cwd: string): string {
  try {
    return execSync(`git ${cmd}`, { cwd, encoding: "utf-8", timeout: 10000 }).trim();
  } catch {
    return "";
  }
}

function extractRepoPath(task: Task): string | null {
  const blocks: Block[] = task.blocks ? JSON.parse(task.blocks) : [];
  const resolver = blocks.find((b) => b.agent === "Resolver" && b.verdict === "ok");
  if (!resolver) return null;
  const m = resolver.content.match(/Repository:\s*`([^`]+)`/);
  return m ? m[1] : null;
}

// GET /api/task/:id/git
app.get("/api/task/:id/git", (c) => {
  const id = parseInt(c.req.param("id"));
  const db = getDb();
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined;
  if (!task) return c.json({ error: "Not found" }, 404);

  const repoPath = extractRepoPath(task);
  if (!repoPath) return c.json({ error: "No repo found" }, 404);

  const branch = git("rev-parse --abbrev-ref HEAD", repoPath);
  if (!branch) return c.json({ error: "Not a git repo" }, 500);

  // Find merge base with main/master
  const mainBranch = git("rev-parse --verify main", repoPath) ? "main" : "master";
  const mergeBase = git(`merge-base ${mainBranch} HEAD`, repoPath);

  // Commits since merge base
  const commitLog = git(
    mergeBase
      ? `log ${mergeBase}..HEAD --format=%H%n%h%n%s%n%aI%n%an --reverse`
      : "log -20 --format=%H%n%h%n%s%n%aI%n%an --reverse",
    repoPath
  );
  const commits: { hash: string; short: string; message: string; date: string; author: string }[] = [];
  if (commitLog) {
    const lines = commitLog.split("\n");
    for (let i = 0; i + 4 < lines.length; i += 5) {
      commits.push({
        hash: lines[i],
        short: lines[i + 1],
        message: lines[i + 2],
        date: lines[i + 3],
        author: lines[i + 4],
      });
    }
  }

  // Full diff against merge base (or last 20 commits)
  const diff = git(
    mergeBase ? `diff ${mergeBase}..HEAD` : "diff HEAD~20..HEAD",
    repoPath
  );

  return c.json({ branch, commits, diff });
});

// GET /api/task/:id/git/commit/:hash
app.get("/api/task/:id/git/commit/:hash", (c) => {
  const id = parseInt(c.req.param("id"));
  const hash = c.req.param("hash");
  const db = getDb();
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined;
  if (!task) return c.json({ error: "Not found" }, 404);

  const repoPath = extractRepoPath(task);
  if (!repoPath) return c.json({ error: "No repo found" }, 404);

  const diff = git(`diff ${hash}~1..${hash}`, repoPath);
  return c.json({ diff });
});

export default app;
