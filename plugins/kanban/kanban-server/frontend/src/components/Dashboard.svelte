<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import { Loader2 } from "lucide-svelte";
  import { Chart, registerables } from "chart.js";
  import { fetchDashboard } from "../lib/api";
  import type { DashboardData } from "../lib/types";
  import { cn } from "../lib/cn";
  import { formatDistanceToNow } from "../lib/time";
  import { getAgentColor } from "../lib/agents";

  Chart.register(...registerables);
  Chart.defaults.color = "oklch(0.65 0.02 260)";
  Chart.defaults.borderColor = "oklch(0.28 0.02 260)";

  let { pipelines, activePipeline }: { pipelines: string[]; activePipeline: string } = $props();

  let data: DashboardData | null = $state(null);
  let loading = $state(true);
  let selectedPipeline = $state("");
  let selectedDays = $state(0);

  let agentCanvas = $state<HTMLCanvasElement>(null!);
  let agentChart: Chart | null = null;
  let modelCanvas = $state<HTMLCanvasElement>(null!);
  let modelChart: Chart | null = null;
  let pipelineCanvas = $state<HTMLCanvasElement>(null!);
  let pipelineChart: Chart | null = null;
  let timelineCanvas = $state<HTMLCanvasElement>(null!);
  let timelineChart: Chart | null = null;

  function fmtCost(n: number): string { return "$" + n.toFixed(2); }
  function fmtTokens(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
    return String(n);
  }
  function fmtDuration(ms: number): string {
    if (ms >= 60000) return Math.floor(ms / 60000) + "m " + Math.round((ms % 60000) / 1000) + "s";
    return Math.round(ms / 1000) + "s";
  }

  let chartTrigger = $state(0);

  async function loadData() {
    loading = true;
    try {
      data = await fetchDashboard(selectedPipeline || undefined, selectedDays || undefined);
    } finally {
      loading = false;
      await tick();
      chartTrigger++;
    }
  }

  onMount(() => {
    loadData();
  });

  $effect(() => {
    // Track filter changes
    selectedPipeline;
    selectedDays;
    loadData();
  });

  // By Agent chart
  $effect(() => {
    chartTrigger; const d = data; if (!agentCanvas || !d) return;
    if (agentChart) agentChart.destroy();

    const agents = Object.entries(data.byAgent);
    agentChart = new Chart(agentCanvas, {
      type: "bar",
      data: {
        labels: agents.map(([name]) => name),
        datasets: [{
          label: "Cost",
          data: agents.map(([, v]) => v.cost),
          backgroundColor: agents.map(([name]) => getAgentColor(name)),
          borderWidth: 0,
          borderRadius: 3,
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "oklch(0.2 0.02 260)",
            titleColor: "oklch(0.9 0.01 260)",
            bodyColor: "oklch(0.8 0.01 260)",
            callbacks: { label: (ctx) => fmtCost(ctx.raw as number) },
          },
        },
        scales: {
          x: { grid: { color: "oklch(0.25 0.02 260)" }, ticks: { callback: (v) => fmtCost(v as number) } },
          y: { grid: { display: false } },
        },
      },
    });
  });

  // By Model chart
  $effect(() => {
    chartTrigger; const d = data; if (!modelCanvas || !d) return;
    if (modelChart) modelChart.destroy();

    const models = Object.entries(data.byModel);
    const modelColors = [
      "oklch(0.65 0.18 280)",
      "oklch(0.65 0.18 200)",
      "oklch(0.7 0.15 45)",
    ];

    modelChart = new Chart(modelCanvas, {
      type: "doughnut",
      data: {
        labels: models.map(([name]) => name.replace(/^claude-/, "")),
        datasets: [{
          data: models.map(([, v]) => v.tokens),
          backgroundColor: models.map((_, i) => modelColors[i % modelColors.length]),
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom",
            labels: { padding: 12, usePointStyle: true, pointStyle: "circle" },
          },
          tooltip: {
            backgroundColor: "oklch(0.2 0.02 260)",
            titleColor: "oklch(0.9 0.01 260)",
            bodyColor: "oklch(0.8 0.01 260)",
            callbacks: { label: (ctx) => `${ctx.label}: ${fmtTokens(ctx.raw as number)} tokens` },
          },
        },
      },
    });
  });

  // By Task chart
  $effect(() => {
    chartTrigger; const d = data; if (!pipelineCanvas || !d) return;
    if (pipelineChart) pipelineChart.destroy();

    const taskEntries = Object.entries(d.byTask).sort(([, a], [, b]) => b.cost - a.cost).slice(0, 10);

    pipelineChart = new Chart(pipelineCanvas, {
      type: "bar",
      data: {
        labels: taskEntries.map(([name]) => name),
        datasets: [{
          label: "Cost",
          data: taskEntries.map(([, v]) => v.cost),
          backgroundColor: "oklch(0.75 0.15 145)",
          borderWidth: 0,
          borderRadius: 3,
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "oklch(0.2 0.02 260)",
            titleColor: "oklch(0.9 0.01 260)",
            bodyColor: "oklch(0.8 0.01 260)",
            callbacks: { label: (ctx) => fmtCost(ctx.raw as number) },
          },
        },
        scales: {
          x: { grid: { color: "oklch(0.25 0.02 260)" }, ticks: { callback: (v) => fmtCost(v as number) } },
          y: { grid: { display: false } },
        },
      },
    });
  });

  // Timeline chart
  $effect(() => {
    chartTrigger; const d = data; if (!timelineCanvas || !d) return;
    if (timelineChart) timelineChart.destroy();

    const timeline = data.timeline;
    const lineColor = "oklch(0.65 0.18 200)";

    timelineChart = new Chart(timelineCanvas, {
      type: "line",
      data: {
        labels: timeline.map((t) => {
          const d = new Date(t.date);
          return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
        }),
        datasets: [{
          label: "Cost",
          data: timeline.map((t) => t.cost),
          borderColor: lineColor,
          backgroundColor: "oklch(0.65 0.18 200 / 0.15)",
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          pointBackgroundColor: lineColor,
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "oklch(0.2 0.02 260)",
            titleColor: "oklch(0.9 0.01 260)",
            bodyColor: "oklch(0.8 0.01 260)",
            callbacks: { label: (ctx) => fmtCost(ctx.raw as number) },
          },
        },
        scales: {
          x: { grid: { color: "oklch(0.25 0.02 260)" } },
          y: { grid: { color: "oklch(0.25 0.02 260)" }, ticks: { callback: (v) => fmtCost(v as number) } },
        },
      },
    });
  });

  onDestroy(() => {
    agentChart?.destroy();
    modelChart?.destroy();
    pipelineChart?.destroy();
    timelineChart?.destroy();
  });
</script>

<div class="p-6 space-y-4">
  <!-- Filter bar -->
  <div class="flex items-center gap-3 flex-wrap">
    <select
      class="text-sm px-3 py-1.5 rounded-md bg-secondary border border-border text-foreground"
      bind:value={selectedPipeline}
    >
      <option value="">All Pipelines</option>
      {#each pipelines as p}
        <option value={p}>{p}</option>
      {/each}
    </select>

    <div class="flex items-center gap-1">
      {#each [{ label: "7d", value: 7 }, { label: "30d", value: 30 }, { label: "All", value: 0 }] as btn}
        <button
          class={cn(
            "text-sm px-3 py-1.5 rounded-md border transition-colors",
            selectedDays === btn.value
              ? "bg-primary/10 text-primary border-primary/30"
              : "border-border text-muted-foreground hover:bg-secondary"
          )}
          onclick={() => (selectedDays = btn.value)}
        >
          {btn.label}
        </button>
      {/each}
    </div>
  </div>

  {#if loading}
    <div class="flex items-center justify-center py-24">
      <Loader2 class="w-8 h-8 animate-spin text-muted-foreground" />
    </div>
  {:else if data}
    <!-- KPI cards -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div class="bg-card border border-border rounded-lg p-4">
        <div class="text-2xl font-semibold font-mono">{fmtCost(data.totalCost)}</div>
        <div class="text-xs text-muted-foreground uppercase tracking-wider mt-1">Total Cost</div>
      </div>
      <div class="bg-card border border-border rounded-lg p-4">
        <div class="text-2xl font-semibold font-mono">{fmtTokens(data.totalTokens)}</div>
        <div class="text-xs text-muted-foreground uppercase tracking-wider mt-1">Tokens</div>
      </div>
      <div class="bg-card border border-border rounded-lg p-4">
        <div class="text-2xl font-semibold font-mono">{data.tasksDone}/{data.tasksTotal}</div>
        <div class="text-xs text-muted-foreground uppercase tracking-wider mt-1">Tasks</div>
      </div>
      <div class="bg-card border border-border rounded-lg p-4">
        <div class="text-2xl font-semibold font-mono">{fmtDuration(data.avgDuration)}</div>
        <div class="text-xs text-muted-foreground uppercase tracking-wider mt-1">Avg Duration</div>
      </div>
    </div>

    <!-- Charts 2x2 -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <!-- By Agent -->
      <div class="bg-card border border-border rounded-lg p-4">
        <div class="text-sm font-medium text-foreground mb-3">By Agent</div>
        <div class="h-64">
          <canvas bind:this={agentCanvas}></canvas>
        </div>
      </div>

      <!-- By Model -->
      <div class="bg-card border border-border rounded-lg p-4">
        <div class="text-sm font-medium text-foreground mb-3">By Model</div>
        <div class="h-64">
          <canvas bind:this={modelCanvas}></canvas>
        </div>
      </div>

      <!-- By Task -->
      <div class="bg-card border border-border rounded-lg p-4">
        <div class="text-sm font-medium text-foreground mb-3">By Task (top 10)</div>
        <div class="h-64">
          <canvas bind:this={pipelineCanvas}></canvas>
        </div>
      </div>

      <!-- Timeline -->
      <div class="bg-card border border-border rounded-lg p-4">
        <div class="text-sm font-medium text-foreground mb-3">Timeline</div>
        <div class="h-64">
          <canvas bind:this={timelineCanvas}></canvas>
        </div>
      </div>
    </div>

    <!-- Recent Runs table -->
    <div class="bg-card border border-border rounded-lg">
      <div class="p-4 border-b border-border">
        <div class="text-sm font-medium text-foreground">Recent Runs</div>
      </div>
      <div class="max-h-96 overflow-y-auto">
        <table class="w-full text-sm">
          <thead class="sticky top-0 bg-card">
            <tr class="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wider">
              <th class="px-4 py-2">Task</th>
              <th class="px-4 py-2">Agent</th>
              <th class="px-4 py-2">Model</th>
              <th class="px-4 py-2">Verdict</th>
              <th class="px-4 py-2 text-right">Tokens</th>
              <th class="px-4 py-2 text-right">Cost</th>
              <th class="px-4 py-2 text-right">Duration</th>
              <th class="px-4 py-2 text-right">Time</th>
            </tr>
          </thead>
          <tbody>
            {#each data.recentRuns as run}
              <tr class="border-b border-border hover:bg-secondary/50 transition-colors">
                <td class="px-4 py-2 text-foreground">
                  <span class="text-muted-foreground">#{run.taskId}</span> {run.taskTitle}
                </td>
                <td class="px-4 py-2">
                  <span class="inline-flex items-center gap-1.5">
                    <span class="w-2 h-2 rounded-full shrink-0" style="background: {getAgentColor(run.agent)}"></span>
                    {run.agent}
                  </span>
                </td>
                <td class="px-4 py-2 text-muted-foreground">{run.model.replace(/^claude-/, "")}</td>
                <td class="px-4 py-2">
                  <span class={cn(
                    "px-2 py-0.5 rounded-full text-xs font-medium",
                    run.verdict === "ok" ? "bg-success/20 text-success" : "bg-destructive/20 text-destructive"
                  )}>
                    {run.verdict}
                  </span>
                </td>
                <td class="px-4 py-2 text-right text-muted-foreground font-mono text-xs">
                  {fmtTokens(run.input_tokens)}+{fmtTokens(run.output_tokens)}
                </td>
                <td class="px-4 py-2 text-right font-mono text-xs">{fmtCost(run.cost_usd)}</td>
                <td class="px-4 py-2 text-right text-muted-foreground font-mono text-xs">{fmtDuration(run.duration_ms)}</td>
                <td class="px-4 py-2 text-right text-muted-foreground text-xs">{formatDistanceToNow(run.timestamp)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}
</div>
