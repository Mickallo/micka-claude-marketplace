type SSEHandler = (data: { taskId: number; [key: string]: unknown }) => void;

let eventSource: EventSource | null = null;
const handlers = new Map<string, Set<SSEHandler>>();

export function connectSSE() {
  if (eventSource) return;
  eventSource = new EventSource("/api/events");

  for (const eventType of ["task:updated", "task:moved", "task:block", "notification:new"]) {
    eventSource.addEventListener(eventType, (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        const fns = handlers.get(eventType);
        if (fns) fns.forEach((fn) => fn(data));
        // Also fire a generic "any" event
        const anyFns = handlers.get("*");
        if (anyFns) anyFns.forEach((fn) => fn({ ...data, _event: eventType }));
      } catch { /* ignore parse errors */ }
    });
  }

  eventSource.onerror = () => {
    eventSource?.close();
    eventSource = null;
    // Reconnect after 3s
    setTimeout(connectSSE, 3000);
  };
}

export function onSSE(event: string, handler: SSEHandler) {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event)!.add(handler);
  return () => { handlers.get(event)?.delete(handler); };
}

export function disconnectSSE() {
  eventSource?.close();
  eventSource = null;
}
