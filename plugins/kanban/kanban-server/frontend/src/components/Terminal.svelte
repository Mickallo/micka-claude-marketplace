<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import { WebglAddon } from "@xterm/addon-webgl";
  import "@xterm/xterm/css/xterm.css";

  let { sessionId, terminalId }: { sessionId?: string | null; terminalId?: string | null } = $props();

  let activeId = $derived(terminalId || sessionId);

  let terminalEl: HTMLDivElement;
  let terminal: Terminal | null = null;
  let fitAddon: FitAddon | null = null;
  let ws: WebSocket | null = null;
  let currentSessionId: string | null = null;

  function getTheme() {
    const isDark = document.documentElement.getAttribute("data-theme") !== "light";
    return isDark ? {
      background: "#1c1c1e",
      foreground: "#f5f5f7",
      cursor: "#f5f5f7",
      selectionBackground: "rgba(10,132,255,0.3)",
      black: "#1c1c1e",
      red: "#ff453a",
      green: "#30d158",
      yellow: "#ffd60a",
      blue: "#0a84ff",
      magenta: "#bf5af2",
      cyan: "#64d2ff",
      white: "#f5f5f7",
    } : {
      background: "#f5f5f7",
      foreground: "#1d1d1f",
      cursor: "#1d1d1f",
      selectionBackground: "rgba(0,122,255,0.2)",
      black: "#1d1d1f",
      red: "#ff3b30",
      green: "#28cd41",
      yellow: "#ffcc00",
      blue: "#007aff",
      magenta: "#af52de",
      cyan: "#32ade6",
      white: "#f5f5f7",
    };
  }

  function connect(sid: string) {
    if (currentSessionId === sid && ws?.readyState === WebSocket.OPEN) return;
    disconnect();

    currentSessionId = sid;

    if (!terminal) {
      terminal = new Terminal({
        theme: getTheme(),
        fontFamily: '"SF Mono", ui-monospace, "Cascadia Code", monospace',
        fontSize: 13,
        lineHeight: 1.4,
        cursorBlink: true,
        scrollback: 5000,
      });

      fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);

      terminal.open(terminalEl);

      try {
        const webglAddon = new WebglAddon();
        terminal.loadAddon(webglAddon);
      } catch {
        // WebGL not available, canvas fallback is fine
      }

      fitAddon.fit();
    } else {
      terminal.clear();
    }

    const isLive = sid.startsWith("term_");
    terminal.writeln(`\x1b[90m${isLive ? "Connecting to live terminal" : "Resuming session"} ${sid}...\x1b[0m\r\n`);

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const param = isLive ? `terminal=${encodeURIComponent(sid)}` : `session=${encodeURIComponent(sid)}`;
    ws = new WebSocket(`${protocol}//${location.host}/api/terminal/ws?${param}`);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      terminal!.writeln(`\x1b[32mConnected.\x1b[0m\r\n`);
      // Send initial size
      if (fitAddon && terminal) {
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          ws!.send(`\x1b[resize:${dims.cols},${dims.rows}`);
        }
      }
    };

    ws.onmessage = (event) => {
      const data = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data);
      terminal!.write(data);
    };

    ws.onclose = () => {
      terminal!.writeln(`\r\n\x1b[90m[Connection closed]\x1b[0m`);
    };

    ws.onerror = () => {
      terminal!.writeln(`\r\n\x1b[31m[Connection error]\x1b[0m`);
    };

    terminal.onData((data: string) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
  }

  function disconnect() {
    ws?.close();
    ws = null;
    currentSessionId = null;
  }

  function handleResize() {
    if (fitAddon && terminal) {
      fitAddon.fit();
      if (ws?.readyState === WebSocket.OPEN) {
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          ws.send(`\x1b[resize:${dims.cols},${dims.rows}`);
        }
      }
    }
  }

  $effect(() => {
    if (activeId) {
      if (terminalEl) connect(activeId);
    } else {
      disconnect();
      if (terminal) {
        terminal.clear();
        terminal.writeln("\x1b[90mSelect a block to open terminal\x1b[0m");
      }
    }
  });

  onMount(() => {
    window.addEventListener("resize", handleResize);
    const observer = new ResizeObserver(handleResize);
    if (terminalEl) observer.observe(terminalEl);
    return () => {
      window.removeEventListener("resize", handleResize);
      observer.disconnect();
    };
  });

  onDestroy(() => {
    disconnect();
    terminal?.dispose();
    terminal = null;
  });
</script>

<div class="terminal-container" bind:this={terminalEl}></div>

<style>
  .terminal-container {
    flex: 1;
    min-height: 200px;
    border-radius: 8px;
    overflow: hidden;
    background: var(--bg);
  }
  .terminal-container :global(.xterm) {
    padding: 8px;
  }
</style>
