<script lang="ts">
  import { Sparkles, Plus, Layers, Bell, SlidersHorizontal, AlertCircle, Check } from "lucide-svelte";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";

  interface Notification {
    id: number;
    task_id: number;
    type: string;
    title: string;
    message: string;
    read: boolean;
    created_at: string;
  }

  let { pipelines, activePipeline, totalTickets = 0, processingCount = 0, notifications = [], onswitchpipeline, onadd, onsettings, onnotificationclick, onmarkallread }: {
    pipelines: string[];
    activePipeline: string;
    totalTickets?: number;
    processingCount?: number;
    notifications?: Notification[];
    onswitchpipeline: (p: string) => void;
    onadd: () => void;
    onsettings: () => void;
    onnotificationclick: (taskId: number, notifId: number) => void;
    onmarkallread: () => void;
  } = $props();

  import { onMount } from "svelte";

  let showDropdown = $state(false);
  let unreadCount = $derived(notifications.filter(n => !n.read).length);
  let dropdownRef: HTMLDivElement | undefined = $state();

  onMount(() => {
    function handleClickOutside(e: MouseEvent) {
      if (showDropdown && dropdownRef && !dropdownRef.contains(e.target as Node)) {
        showDropdown = false;
      }
    }
    document.addEventListener("click", handleClickOutside, true);
    return () => document.removeEventListener("click", handleClickOutside, true);
  });

  function handleNotifClick(e: MouseEvent, n: Notification) {
    e.stopPropagation();
    showDropdown = false;
    onnotificationclick(n.task_id, n.id);
  }

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }
</script>

<header class="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
  <div class="flex h-14 items-center justify-between px-6">
    <!-- Pipeline selector -->
    <div class="flex items-center gap-2">
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

    <!-- Center -->
    <div class="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
      <div class="flex items-center gap-2">
        {#if processingCount > 0}
          <div class="w-2 h-2 rounded-full bg-success animate-pulse"></div>
          <span>{processingCount} Processing</span>
        {:else}
          <div class="w-2 h-2 rounded-full bg-muted-foreground"></div>
          <span>Idle</span>
        {/if}
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
      <div class="relative" bind:this={dropdownRef}>
        <Button variant="outline" size="icon" class="relative" title="Notifications" onclick={() => (showDropdown = !showDropdown)}>
          <Bell class="h-4 w-4" />
          {#if unreadCount > 0}
            <span class="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center">
              <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75"></span>
              <Badge variant="destructive" class="h-5 w-5 rounded-full p-0 text-[10px] flex items-center justify-center">{unreadCount}</Badge>
            </span>
          {/if}
        </Button>

        {#if showDropdown}
          <div class="absolute right-0 top-full mt-2 w-80 z-[70] bg-card border rounded-lg shadow-xl overflow-hidden">
            <div class="px-3 py-2 border-b bg-secondary/50 flex items-center justify-between">
              <span class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notifications</span>
              {#if unreadCount > 0}
                <button class="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1" onclick={() => { onmarkallread(); }}>
                  <Check class="w-3 h-3" /> Mark all read
                </button>
              {/if}
            </div>
            {#if notifications.length === 0}
              <div class="px-3 py-6 text-center text-sm text-muted-foreground">No notifications</div>
            {:else}
              <div class="max-h-72 overflow-y-auto">
                {#each notifications as notif}
                  <button
                    class={`w-full text-left px-3 py-2.5 hover:bg-secondary/50 transition-colors border-b last:border-b-0 flex items-start gap-2.5 ${!notif.read ? 'bg-primary/5' : ''}`}
                    onclick={(e) => handleNotifClick(e, notif)}
                  >
                    <AlertCircle class="w-4 h-4 shrink-0 mt-0.5 {notif.read ? 'text-muted-foreground' : 'text-warning'}" />
                    <div class="min-w-0 flex-1">
                      <div class={`text-sm font-medium truncate ${!notif.read ? 'text-foreground' : 'text-muted-foreground'}`}>{notif.title}</div>
                      <div class="text-xs text-muted-foreground mt-0.5">{notif.message}</div>
                      <div class="text-[10px] text-muted-foreground/70 mt-1">{timeAgo(notif.created_at)}</div>
                    </div>
                    {#if !notif.read}
                      <div class="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5"></div>
                    {/if}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
</header>
