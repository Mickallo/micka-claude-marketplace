import { spawn } from "child_process";

export interface ClaudeResult {
  sessionId: string | null;
  output: string;
  exitCode: number;
}

export async function spawnClaude(opts: {
  prompt: string;
  model?: string;
  allowedTools?: string[];
  cwd?: string;
  resume?: string;
}): Promise<ClaudeResult> {
  const args: string[] = [];

  if (opts.resume) {
    args.push("--resume", opts.resume);
    args.push("-p", opts.prompt);
  } else {
    args.push("-p", opts.prompt);
  }

  args.push("--output-format", "json");

  if (opts.model) {
    args.push("--model", opts.model);
  }

  if (opts.allowedTools && opts.allowedTools.length > 0) {
    args.push("--allowedTools", opts.allowedTools.join(","));
  }

  return new Promise((resolve, reject) => {
    const proc = spawn("claude", args, {
      cwd: opts.cwd || process.cwd(),
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });

    proc.on("close", (code) => {
      let sessionId: string | null = null;
      let output = stdout;

      // Try to parse JSON output from claude
      try {
        const json = JSON.parse(stdout);
        sessionId = json.session_id || json.sessionId || null;
        output = json.result || json.output || json.text || stdout;
      } catch {
        // Not JSON, use raw stdout
        // Try to extract session_id from stderr (claude sometimes prints it there)
        const sessionMatch = stderr.match(/session[_-]?id[:\s]+([a-zA-Z0-9_-]+)/i);
        if (sessionMatch) sessionId = sessionMatch[1];
      }

      resolve({
        sessionId,
        output,
        exitCode: code ?? 1,
      });
    });
  });
}
