<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import { WebglAddon } from "@xterm/addon-webgl";
  import "@xterm/xterm/css/xterm.css";

  let { id }: { id: string | null } = $props();

  let terminalEl: HTMLDivElement;
  let terminal: Terminal | null = null;
  let fitAddon: FitAddon | null = null;
  let ws: WebSocket | null = null;
  let connectedId: string | null = null;

  function getTheme() {
    const isDark = document.documentElement.getAttribute("data-theme") !== "light";
    return isDark ? {
      background: "#1a1a2e",
      foreground: "#e8e8f0",
      cursor: "#e8e8f0",
      selectionBackground: "rgba(100,180,255,0.3)",
    } : {
      background: "#f5f5f7",
      foreground: "#1d1d1f",
      cursor: "#1d1d1f",
      selectionBackground: "rgba(0,122,255,0.2)",
    };
  }

  function connect(termId: string) {
    if (connectedId === termId && ws?.readyState === WebSocket.OPEN) return;
    disconnect();
    connectedId = termId;

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
      try { terminal.loadAddon(new WebglAddon()); } catch {}
      fitAddon.fit();
    } else {
      terminal.clear();
    }

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${protocol}//${location.host}/api/terminal/ws?id=${encodeURIComponent(termId)}`);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      if (fitAddon && terminal) {
        const dims = fitAddon.proposeDimensions();
        if (dims) ws!.send(`\x1b[resize:${dims.cols},${dims.rows}`);
      }
    };
    ws.onmessage = (e) => {
      terminal!.write(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data));
    };
    ws.onclose = () => {};
    ws.onerror = () => {
      terminal!.writeln("\r\n\x1b[31m[Connection error]\x1b[0m");
    };
    terminal.onData((data: string) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(data);
    });
  }

  function disconnect() {
    ws?.close();
    ws = null;
    connectedId = null;
  }

  function handleResize() {
    if (fitAddon && terminal) {
      fitAddon.fit();
      if (ws?.readyState === WebSocket.OPEN) {
        const dims = fitAddon.proposeDimensions();
        if (dims) ws.send(`\x1b[resize:${dims.cols},${dims.rows}`);
      }
    }
  }

  $effect(() => {
    if (id && terminalEl) {
      connect(id);
    } else {
      disconnect();
    }
  });

  onMount(() => {
    window.addEventListener("resize", handleResize);
    const observer = new ResizeObserver(handleResize);
    if (terminalEl) observer.observe(terminalEl);
    return () => { window.removeEventListener("resize", handleResize); observer.disconnect(); };
  });

  onDestroy(() => { disconnect(); terminal?.dispose(); terminal = null; });
</script>

<div class="terminal-container" bind:this={terminalEl}></div>

<style>
  .terminal-container {
    width: 100%;
    height: 100%;
    min-height: 200px;
    border-radius: 8px;
    overflow: hidden;
  }
  .terminal-container :global(.xterm) {
    padding: 8px;
  }
</style>
