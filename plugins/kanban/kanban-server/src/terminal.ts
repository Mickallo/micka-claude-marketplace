import { WebSocketServer, WebSocket } from "ws";
import { spawn as cpSpawn, execSync } from "child_process";
import type { Server } from "http";
import type { ChildProcess } from "child_process";

// Try to import node-pty
let pty: typeof import("node-pty") | null = null;
try {
  // Use createRequire to load native module — ESM dynamic import breaks onData events with tsx
  const { createRequire } = await import("module");
  const require = createRequire(import.meta.url);
  pty = require("node-pty") as typeof import("node-pty");
  console.log("node-pty loaded via require()");
} catch (err) {
  console.warn("node-pty not available:", err);
  console.warn("Terminal will use child_process fallback");
}

// Resolve claude binary path
let claudePath = "claude";
try {
  claudePath = execSync("which claude", { encoding: "utf-8" }).trim();
} catch {
  const candidates = [
    `${process.env.HOME}/.claude/local/claude`,
    "/usr/local/bin/claude",
    `${process.env.HOME}/.local/bin/claude`,
  ];
  for (const c of candidates) {
    try { execSync(`test -x "${c}"`); claudePath = c; break; } catch {}
  }
}
console.log(`Terminal: claude at ${claudePath}`);

// ── Active terminal sessions ─────────────────────────────

interface TerminalSession {
  id: string;
  ws: Set<WebSocket>;
  ptyProcess?: ReturnType<typeof import("node-pty").spawn>;
  cpProcess?: ChildProcess;
  output: string;
  finished: boolean;
  exitCode: number | null;
  onFinish?: (output: string, exitCode: number) => void;
}

const sessions = new Map<string, TerminalSession>();
let sessionCounter = 0;

function generateTerminalId(): string {
  return `term_${Date.now()}_${++sessionCounter}`;
}

// ── Spawn a claude process (used by dispatch API) ────────

export interface SpawnResult {
  terminalId: string;
}

export function spawnAgent(opts: {
  args: string[];
  cwd?: string;
  onFinish: (output: string, exitCode: number) => void;
}): SpawnResult {
  const terminalId = generateTerminalId();
  const session: TerminalSession = {
    id: terminalId,
    ws: new Set(),
    output: "",
    finished: false,
    exitCode: null,
    onFinish: opts.onFinish,
  };
  sessions.set(terminalId, session);

  const cwd = opts.cwd || process.env.HOME || "/";
  // Filter out undefined values from env (node-pty requires string values)
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }

  if (pty) {
    try {
      console.log(`[pty] spawning: ${claudePath} ${opts.args.slice(0, 2).join(" ")}... cwd=${cwd}`);
      const proc = pty.spawn(claudePath, opts.args, {
        name: "xterm-256color",
        cols: 120,
        rows: 30,
        cwd,
        env,
      });
      console.log(`[pty] spawned PID=${proc.pid}`);
      session.ptyProcess = proc;

      proc.onData((data: string) => {
        session.output += data;
        console.log(`[pty ${terminalId}] data: ${data.length} bytes, total: ${session.output.length}, ws: ${session.ws.size}`);
        for (const ws of session.ws) {
          if (ws.readyState === WebSocket.OPEN) ws.send(data);
        }
      });

      proc.onExit(({ exitCode }) => {
        console.log(`[pty ${terminalId}] exit: code=${exitCode}, output=${session.output.length} bytes`);
        session.finished = true;
        session.exitCode = exitCode;
        for (const ws of session.ws) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send("\r\n\x1b[90m[Agent finished]\x1b[0m\r\n");
          }
        }
        session.onFinish?.(session.output, exitCode);
        // Keep session for 5min for late WebSocket connections
        setTimeout(() => sessions.delete(terminalId), 300000);
      });

      return { terminalId };
    } catch (err) {
      console.error(`node-pty spawn failed: ${err}, using child_process`);
    }
  }

  // Fallback: child_process (no live terminal, but output is captured)
  const proc = cpSpawn(claudePath, opts.args, {
    cwd,
    env: { ...env, TERM: "xterm-256color" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  session.cpProcess = proc;

  proc.stdout?.on("data", (d: Buffer) => {
    const str = d.toString();
    session.output += str;
    for (const ws of session.ws) {
      if (ws.readyState === WebSocket.OPEN) ws.send(str);
    }
  });
  proc.stderr?.on("data", (d: Buffer) => {
    const str = d.toString();
    session.output += str;
    for (const ws of session.ws) {
      if (ws.readyState === WebSocket.OPEN) ws.send(str);
    }
  });

  proc.on("error", (err) => {
    session.finished = true;
    session.exitCode = 1;
    session.onFinish?.(session.output + `\nError: ${err.message}`, 1);
  });

  proc.on("close", (code) => {
    session.finished = true;
    session.exitCode = code ?? 1;
    for (const ws of session.ws) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send("\r\n\x1b[90m[Agent finished]\x1b[0m\r\n");
      }
    }
    session.onFinish?.(session.output, code ?? 1);
    setTimeout(() => sessions.delete(terminalId), 300000);
  });

  return { terminalId };
}

// ── Resume a past claude session (for finished blocks) ───

function spawnResume(sessionId: string, ws: WebSocket) {
  const cwd = process.env.HOME || "/";

  if (pty) {
    try {
      const proc = pty.spawn(claudePath, ["--resume", sessionId], {
        name: "xterm-256color",
        cols: 120,
        rows: 30,
        cwd,
        env: { ...process.env } as Record<string, string>,
      });

      proc.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      });
      proc.onExit(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send("\r\n\x1b[90m[Session ended]\x1b[0m\r\n");
          ws.close();
        }
      });
      ws.on("message", (data: Buffer | string) => {
        const msg = data.toString();
        if (msg.startsWith("\x1b[resize:")) {
          const match = msg.match(/\x1b\[resize:(\d+),(\d+)/);
          if (match) proc.resize(parseInt(match[1]), parseInt(match[2]));
          return;
        }
        proc.write(msg);
      });
      ws.on("close", () => { try { proc.kill(); } catch {} });
      return;
    } catch (err) {
      console.error(`node-pty resume failed: ${err}`);
    }
  }

  // Fallback
  const proc = cpSpawn(claudePath, ["--resume", sessionId], {
    cwd,
    env: { ...process.env, TERM: "xterm-256color" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  proc.stdout?.on("data", (d: Buffer) => { if (ws.readyState === WebSocket.OPEN) ws.send(d.toString()); });
  proc.stderr?.on("data", (d: Buffer) => { if (ws.readyState === WebSocket.OPEN) ws.send(d.toString()); });
  proc.on("close", () => {
    if (ws.readyState === WebSocket.OPEN) { ws.send("\r\n\x1b[90m[Session ended]\x1b[0m\r\n"); ws.close(); }
  });
  ws.on("message", (d: Buffer | string) => { proc.stdin?.write(d.toString()); });
  ws.on("close", () => { try { proc.kill(); } catch {} });
}

// ── WebSocket server ─────────────────────────────────────

export function setupTerminalWS(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      if (url.pathname !== "/api/terminal/ws") return;

      const sessionParam = url.searchParams.get("session");
      const terminalParam = url.searchParams.get("terminal");

      if (!sessionParam && !terminalParam) { socket.destroy(); return; }

      wss.handleUpgrade(req, socket, head, (ws) => {
        if (terminalParam) {
          // Connect to a live agent terminal
          console.log(`Terminal WS: connecting to live terminal ${terminalParam}, exists=${sessions.has(terminalParam)}`);
          const session = sessions.get(terminalParam);
          if (session) {
            console.log(`Terminal WS: session found, output length=${session.output.length}, finished=${session.finished}, ws count=${session.ws.size}`);
            session.ws.add(ws);
            // Send buffered output
            if (session.output) ws.send(session.output);
            if (session.finished) {
              ws.send("\r\n\x1b[90m[Agent already finished]\x1b[0m\r\n");
            }
            ws.on("message", (data: Buffer | string) => {
              const msg = data.toString();
              if (session.ptyProcess) {
                if (msg.startsWith("\x1b[resize:")) {
                  const match = msg.match(/\x1b\[resize:(\d+),(\d+)/);
                  if (match) session.ptyProcess.resize(parseInt(match[1]), parseInt(match[2]));
                  return;
                }
                session.ptyProcess.write(msg);
              } else if (session.cpProcess) {
                session.cpProcess.stdin?.write(msg);
              }
            });
            ws.on("close", () => { session.ws.delete(ws); });
          } else {
            ws.send("\r\n\x1b[31m[Terminal session not found]\x1b[0m\r\n");
            ws.close();
          }
        } else if (sessionParam) {
          // Resume a past claude session
          console.log(`Terminal WS: resume session=${sessionParam}`);
          spawnResume(sessionParam, ws);
        }
      });
    } catch (err) {
      console.error("WS upgrade error:", err);
      socket.destroy();
    }
  });

  return wss;
}
