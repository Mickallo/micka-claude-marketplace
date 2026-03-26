<script lang="ts">
  import { Sparkles, Plus, Layers, Bell, SlidersHorizontal } from "lucide-svelte";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";

  let { pipelines, activePipeline, totalTickets = 0, processingCount = 0, onswitchpipeline, onadd, onsettings }: {
    pipelines: string[];
    activePipeline: string;
    totalTickets?: number;
    processingCount?: number;
    onswitchpipeline: (p: string) => void;
    onadd: () => void;
    onsettings: () => void;
  } = $props();
</script>

<header class="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
  <div class="flex h-14 items-center justify-between px-6">
    <!-- Logo -->
    <div class="flex items-center gap-3">
      <div class="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground">
        <Sparkles class="h-4 w-4" />
      </div>
      <div class="flex items-center gap-2">
        <span class="font-semibold text-lg">AI Pipeline</span>
        {#if pipelines.length > 1}
          <select
            class="text-xs text-muted-foreground px-2 py-0.5 rounded-full bg-muted border-none cursor-pointer focus:outline-none"
            value={activePipeline}
            onchange={(e) => onswitchpipeline((e.target as HTMLSelectElement).value)}
          >
            {#each pipelines as p}<option value={p}>{p}</option>{/each}
          </select>
        {:else}
          <Badge variant="secondary">{activePipeline}</Badge>
        {/if}
      </div>
    </div>

    <!-- Center -->
    <div class="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
      <div class="flex items-center gap-2">
        <div class="w-2 h-2 rounded-full bg-success animate-pulse"></div>
        <span>{processingCount || pipelines.length || 4} Agents Active</span>
      </div>
      <div class="flex items-center gap-2">
        <Layers class="w-4 h-4" />
        <span>{totalTickets} Tickets in Pipeline</span>
      </div>
    </div>

    <!-- Right -->
    <div class="flex items-center gap-2">
      <Button size="sm" class="gap-2" onclick={onadd}>
        <Plus class="h-4 w-4" />
        <span class="hidden sm:inline">New Ticket</span>
      </Button>
      <Button variant="outline" size="icon" class="relative" title="Notifications">
        <Bell class="h-4 w-4" />
        <span class="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center">
          <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75"></span>
          <Badge variant="destructive" class="h-5 w-5 rounded-full p-0 text-[10px] flex items-center justify-center">1</Badge>
        </span>
      </Button>
      <Button variant="outline" size="icon" onclick={onsettings} title="Settings">
        <SlidersHorizontal class="h-4 w-4" />
      </Button>
    </div>
  </div>
</header>
