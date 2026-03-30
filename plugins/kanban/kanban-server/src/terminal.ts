import { WebSocketServer, WebSocket } from "ws";
import { spawn as cpSpawn } from "child_process";
import type { Server } from "http";
import path from "path";

// Load node-pty via require (ESM dynamic import breaks onData with tsx)
let pty: typeof import("node-pty") | null = null;
try {
  const { createRequire } = await import("module");
  const require = createRequire(import.meta.url);
  pty = require("node-pty") as typeof import("node-pty");
  console.log("node-pty loaded");
} catch (err) {
  console.warn("node-pty not available:", err);
}

// Resolve claude path
import { execSync } from "child_process";
let claudePath = "claude";
try { claudePath = execSync("which claude", { encoding: "utf-8" }).trim(); } catch {}
console.log(`Terminal: claude at ${claudePath}`);

// ── Sessions ─────────────────────────────────────────────

interface TerminalSession {
  id: string;
  clients: Set<WebSocket>;
  ptyProcess: ReturnType<typeof import("node-pty").spawn> | null;
  output: string;
  finished: boolean;
  onFinish?: (output: string, exitCode: number) => void;
}

const sessions = new Map<string, TerminalSession>();
let counter = 0;

function genId(): string {
  return `term_${Date.now()}_${++counter}`;
}

// ── Spawn (unified for dispatch AND resume) ──────────────

export interface SpawnResult {
  terminalId: string;
}

export function spawnTerminal(opts: {
  args: string[];
  cwd?: string;
  interactive?: boolean;  // true = PTY (for resume), false = child_process (for dispatch)
  onFinish?: (output: string, exitCode: number) => void;
}): SpawnResult {
  const terminalId = genId();
  const cwd = opts.cwd || process.env.KANBAN_PROJECT_ROOT;
  if (!cwd) {
    const session: TerminalSession = { id: terminalId, clients: new Set(), ptyProcess: null, output: "[Error: KANBAN_PROJECT_ROOT not set]\r\n", finished: true };
    sessions.set(terminalId, session);
    opts.onFinish?.("[Error: KANBAN_PROJECT_ROOT not set]", 1);
    return { terminalId };
  }

  const session: TerminalSession = {
    id: terminalId,
    clients: new Set(),
    ptyProcess: null,
    output: "",
    finished: false,
    onFinish: opts.onFinish,
  };
  sessions.set(terminalId, session);

  // Non-interactive mode: use child_process for clean JSON output
  if (!opts.interactive) {
    const proc = cpSpawn(claudePath, opts.args, {
      cwd,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    console.log(`[term ${terminalId}] spawned (child_process) PID=${proc.pid}`);

    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("error", (err) => {
      session.finished = true;
      session.output = `Error: ${err.message}`;
      opts.onFinish?.(`Error: ${err.message}`, 1);
    });
    proc.on("close", (code) => {
      console.log(`[term ${terminalId}] exit code=${code} stdout=${stdout.length} bytes`);
      session.finished = true;
      session.output = stdout;
      opts.onFinish?.(stdout, code ?? 1);
    });

    return { terminalId };
  }

  // Interactive mode: use PTY
  if (!pty) {
    console.error("node-pty not available, cannot spawn interactive terminal");
    session.finished = true;
    session.output = "[Error: node-pty not available]\r\n";
    opts.onFinish?.("[Error: node-pty not available]", 1);
    return { terminalId };
  }

  // Filter env for PTY
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }

  const proc = pty.spawn(claudePath, opts.args, {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd,
    env,
  });
  session.ptyProcess = proc;
  console.log(`[term ${terminalId}] spawned PID=${proc.pid} args=${opts.args.slice(0, 2).join(" ")}...`);

  proc.onData((data: string) => {
    session.output += data;
    for (const ws of session.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  });

  proc.onExit(({ exitCode }) => {
    console.log(`[term ${terminalId}] exit code=${exitCode} output=${session.output.length} bytes`);
    session.finished = true;
    for (const ws of session.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send("\r\n\x1b[90m[Session ended]\x1b[0m\r\n");
      }
    }
    session.onFinish?.(session.output, exitCode);
    // Keep for 5 min for late connections
    setTimeout(() => sessions.delete(terminalId), 300000);
  });

  return { terminalId };
}

// Convenience: spawn for dispatch (agent run)
export function spawnAgent(opts: {
  args: string[];
  cwd?: string;
  interactive?: boolean;
  onFinish: (output: string, exitCode: number) => void;
}): SpawnResult {
  return spawnTerminal(opts);
}

// ── WebSocket server ─────────────────────────────────────

export function setupTerminalWS(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      if (url.pathname !== "/api/terminal/ws") return;

      const terminalId = url.searchParams.get("id");
      if (!terminalId) { socket.destroy(); return; }

      wss.handleUpgrade(req, socket, head, (ws) => {
        const session = sessions.get(terminalId);

        if (!session) {
          // No live session — resume past claude session
          console.log(`[ws] no live session ${terminalId}, spawning resume`);
          const resumeArgs = ["--resume", terminalId];
          const { terminalId: newId } = spawnTerminal({
            args: resumeArgs,
            interactive: true,  // PTY for interactive resume
          });
          const newSession = sessions.get(newId);
          if (newSession) {
            newSession.clients.add(ws);
            // Send buffered output (e.g. if session finished before client connected)
            if (newSession.output) ws.send(newSession.output);
            if (newSession.finished) {
              ws.send("\r\n\x1b[90m[Session already ended]\x1b[0m\r\n");
            }
            ws.on("message", (data: Buffer | string) => {
              const msg = data.toString();
              if (newSession.ptyProcess && !newSession.finished) {
                try {
                  if (msg.startsWith("\x1b[resize:")) {
                    const match = msg.match(/\x1b\[resize:(\d+),(\d+)/);
                    if (match) newSession.ptyProcess.resize(parseInt(match[1]), parseInt(match[2]));
                    return;
                  }
                  newSession.ptyProcess.write(msg);
                } catch {}
              }
            });
            ws.on("close", () => newSession.clients.delete(ws));
          } else {
            ws.send("\r\n\x1b[31m[Failed to start session]\x1b[0m\r\n");
            ws.close();
          }
          return;
        }

        // Live session found
        console.log(`[ws] connecting to ${terminalId}, output=${session.output.length} bytes, finished=${session.finished}`);
        session.clients.add(ws);

        // Send buffered output
        if (session.output) ws.send(session.output);
        if (session.finished) {
          ws.send("\r\n\x1b[90m[Session already ended]\x1b[0m\r\n");
        }

        // Pipe input to PTY
        ws.on("message", (data: Buffer | string) => {
          const msg = data.toString();
          if (session.ptyProcess && !session.finished) {
            try {
              if (msg.startsWith("\x1b[resize:")) {
                const match = msg.match(/\x1b\[resize:(\d+),(\d+)/);
                if (match) session.ptyProcess.resize(parseInt(match[1]), parseInt(match[2]));
                return;
              }
              session.ptyProcess.write(msg);
            } catch {}
          }
        });

        ws.on("close", () => session.clients.delete(ws));
      });
    } catch (err) {
      console.error("WS upgrade error:", err);
      socket.destroy();
    }
  });

  return wss;
}
