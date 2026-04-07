import { Hono } from "hono";
import { execSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { spawnAgent } from "../terminal.js";

const app = new Hono();

interface ReviewRequest {
  owner: string;
  repo: string;
  number: number;
}

interface InlineComment {
  path: string;
  line: number;
  body: string;
}

interface ReviewResult {
  status: "ok" | "error";
  score?: number;
  verdict?: "approve" | "comment";
  body?: string;
  comments?: InlineComment[];
  error?: string;
}

function buildInspectorPrompt(
  owner: string, repo: string, number: number,
  pr: { title: string; body: string; headRefName: string; baseRefName: string },
  diff: string
): string {
  const truncatedDiff = diff.length > 100000
    ? diff.slice(0, 100000) + "\n\n... [diff truncated at 100k chars]"
    : diff;

  return `You are reviewing Pull Request #${number}: ${pr.title}
Repository: ${owner}/${repo}
Branch: ${pr.headRefName} → ${pr.baseRefName}

## PR Description

${pr.body || "(no description)"}

## Diff

\`\`\`diff
${truncatedDiff}
\`\`\`

Review this PR using your standard 8-dimension scoring rubric.

For inline comments on specific code issues, reference files as \`path/to/file.ts:42\` (the exact path from the diff headers, without leading a/ or b/).

Output your standard scoring table format with ## Content, ## Decision Log, and ## Verdict sections.`;
}

function dispatchInspector(
  cwd: string, owner: string, repo: string, number: number,
  pr: { title: string; body: string; headRefName: string; baseRefName: string },
  diff: string
): Promise<ReviewResult> {
  return new Promise((resolve) => {
    const prompt = buildInspectorPrompt(owner, repo, number, pr, diff);

    const args = [
      "--agent", "kanban:Inspector",
      "-p", prompt,
      "--output-format", "json",
    ];

    spawnAgent({
      args,
      cwd,
      interactive: false,
      onFinish: (output, exitCode) => {
        const clean = output
          .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
          .replace(/\x1b\][^\x07]*\x07/g, "")
          .replace(/\x1b[><=][^\n]*/g, "")
          .replace(/\x1b\[\?[0-9;]*[a-zA-Z]/g, "")
          .replace(/\r/g, "")
          .trim();

        let parsedText = clean;
        const jsonMatch = clean.match(/\{["\s]*type["\s]*:["\s]*result[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const json = JSON.parse(jsonMatch[0]);
            parsedText = json.result || json.text || clean;
          } catch {}
        }

        const avgMatch = parsedText.match(/\*\*Average\*\*\s*\|\s*(\d+(?:\.\d+)?)\s*\/\s*5/);
        const score = avgMatch ? parseFloat(avgMatch[1]) : undefined;

        const contentMatch = parsedText.match(/## Content\s*\n([\s\S]*?)(?=\n## Decision Log|\n## Verdict|$)/);
        const body = contentMatch ? contentMatch[1].trim() : parsedText.slice(0, 5000);

        const comments = parseInlineComments(parsedText);

        const verdict: "approve" | "comment" = score !== undefined && score >= 4.0 ? "approve" : "comment";

        resolve({ status: "ok", score, verdict, body, comments });
      },
    });
  });
}

function parseInlineComments(text: string): InlineComment[] {
  const comments: InlineComment[] = [];
  const pattern = /\*\*`([^`]+):(\d+)`\*\*\s*(?:—|-)?\s*([\s\S]*?)(?=\n\*\*`|\n###|\n## |$)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const filePath = match[1];
    const line = parseInt(match[2]);
    let body = match[3].trim();
    body = body.replace(/^>\s*/gm, "").trim();
    if (body) {
      comments.push({ path: filePath, line, body });
    }
  }
  return comments;
}

function postReviewToGitHub(
  owner: string, repo: string, number: number, result: ReviewResult
): void {
  if (result.status === "error") return;

  const event = result.verdict === "approve" ? "APPROVE" : "COMMENT";

  const payload: Record<string, unknown> = {
    event,
    body: result.body || "Review complete.",
  };

  if (result.comments && result.comments.length > 0) {
    payload.comments = result.comments.map((c) => ({
      path: c.path,
      line: c.line,
      side: "RIGHT",
      body: c.body,
    }));
  }

  execSync(
    `gh api repos/${owner}/${repo}/pulls/${number}/reviews --input -`,
    {
      encoding: "utf-8",
      timeout: 30000,
      input: JSON.stringify(payload),
    }
  );
}

app.post("/api/github/review", async (c) => {
  const body = await c.req.json() as ReviewRequest;
  const { owner, repo, number } = body;

  if (!owner || !repo || !number) {
    return c.json({ status: "error", error: "owner, repo, and number required" } as ReviewResult, 400);
  }

  try {
    const prJson = execSync(
      `gh pr view ${number} --repo ${owner}/${repo} --json title,body,headRefName,baseRefName,files,url`,
      { encoding: "utf-8", timeout: 30000 }
    );
    const pr = JSON.parse(prJson);

    const diff = execSync(
      `gh pr diff ${number} --repo ${owner}/${repo}`,
      { encoding: "utf-8", timeout: 30000 }
    );

    const tmpDir = mkdtempSync(path.join(tmpdir(), "pr-review-"));
    try {
      execSync(`gh repo clone ${owner}/${repo} ${tmpDir} -- --depth=50 --branch ${pr.headRefName}`, {
        encoding: "utf-8",
        timeout: 120000,
      });

      const result = await dispatchInspector(tmpDir, owner, repo, number, pr, diff);

      postReviewToGitHub(owner, repo, number, result);

      return c.json(result);
    } finally {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not logged") || msg.includes("401") || msg.includes("authentication")) {
      return c.json({ status: "error", error: "gh CLI not authenticated" } as ReviewResult, 401);
    }
    console.error("[github-review] Error:", msg);
    return c.json({ status: "error", error: msg } as ReviewResult, 500);
  }
});

export default app;
