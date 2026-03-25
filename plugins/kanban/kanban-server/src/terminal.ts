import { WebSocketServer, WebSocket } from "ws";
import { spawn as cpSpawn, execSync } from "child_process";
import type { Server } from "http";
import type { ChildProcess } from "child_process";

// Try to import node-pty, fallback to child_process if not available
let pty: typeof import("node-pty") | null = null;
try {
  pty = await import("node-pty");
} catch {
  console.warn("node-pty not available, terminal will use child_process fallback");
}

// Resolve claude binary path once at startup
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
    try {
      execSync(`test -x "${c}"`, { encoding: "utf-8" });
      claudePath = c;
      break;
    } catch { /* next */ }
  }
}
console.log(`Terminal: claude binary at ${claudePath}`);

interface TerminalSession {
  ws: WebSocket;
  ptyProcess: ReturnType<typeof import("node-pty").spawn> | null;
  cpProcess: ChildProcess | null;
}

const sessions = new Map<string, TerminalSession>();

function cleanupSession(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) return;
  try { session.ptyProcess?.kill(); } catch { /* ok */ }
  try { session.cpProcess?.kill(); } catch { /* ok */ }
  sessions.delete(sessionId);
}

function spawnWithPty(sessionId: string, ws: WebSocket): boolean {
  if (!pty) return false;

  try {
    const proc = pty.spawn(claudePath, ["--resume", sessionId], {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd: process.env.HOME || "/",
      env: { ...process.env } as Record<string, string>,
    });

    sessions.set(sessionId, { ws, ptyProcess: proc, cpProcess: null });

    proc.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    proc.onExit(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send("\r\n\x1b[90m[Session ended]\x1b[0m\r\n");
        ws.close();
      }
      sessions.delete(sessionId);
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

    ws.on("close", () => cleanupSession(sessionId));
    return true;
  } catch (err) {
    console.error(`node-pty spawn failed: ${err}, falling back to child_process`);
    return false;
  }
}

function spawnWithChildProcess(sessionId: string, ws: WebSocket) {
  const proc = cpSpawn(claudePath, ["--resume", sessionId], {
    cwd: process.env.HOME || "/",
    env: { ...process.env, TERM: "xterm-256color" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  sessions.set(sessionId, { ws, ptyProcess: null, cpProcess: proc });

  proc.stdout?.on("data", (data: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data.toString());
  });
  proc.stderr?.on("data", (data: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data.toString());
  });

  proc.on("error", (err) => {
    console.error(`child_process spawn failed: ${err.message}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(`\r\n\x1b[31m[Error: ${err.message}]\x1b[0m\r\n`);
      ws.close();
    }
    sessions.delete(sessionId);
  });

  proc.on("close", () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send("\r\n\x1b[90m[Session ended]\x1b[0m\r\n");
      ws.close();
    }
    sessions.delete(sessionId);
  });

  ws.on("message", (data: Buffer | string) => {
    proc.stdin?.write(data.toString());
  });

  ws.on("close", () => cleanupSession(sessionId));
}

export function setupTerminalWS(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname !== "/api/terminal/ws") return;

    const sessionId = url.searchParams.get("session");
    if (!sessionId) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, sessionId);
    });
  });

  wss.on("connection", (ws: WebSocket, _req: unknown, sessionId: string) => {
    console.log(`Terminal WS connected: session=${sessionId}`);

    if (!spawnWithPty(sessionId, ws)) {
      spawnWithChildProcess(sessionId, ws);
    }
  });

  return wss;
}
