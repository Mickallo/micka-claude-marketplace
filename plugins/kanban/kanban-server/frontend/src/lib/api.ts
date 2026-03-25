import type { Task, BoardResponse, PipelinesFile, AgentInfo } from "./types.js";

const BASE = "";

async function json<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, opts);
  return res.json();
}

export async function fetchBoard(pipeline?: string): Promise<BoardResponse> {
  const params = pipeline ? `?pipeline=${encodeURIComponent(pipeline)}` : "";
  return json(`/api/board${params}`);
}

export async function fetchTask(id: number): Promise<Task> {
  return json(`/api/task/${id}`);
}

export async function patchTask(id: number, data: Record<string, unknown>): Promise<{ success: boolean; error?: string; allowed?: string[] }> {
  return json(`/api/task/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function createTask(data: { title: string; priority?: string; description?: string; tags?: string[]; pipeline?: string }): Promise<{ success: boolean; id: number }> {
  return json("/api/task", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function deleteTask(id: number): Promise<void> {
  await fetch(`/api/task/${id}`, { method: "DELETE" });
}

export async function reorderTask(id: number, data: { status?: string; afterId?: number | null; beforeId?: number | null }): Promise<{ success: boolean; error?: string }> {
  return json(`/api/task/${id}/reorder`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function addBlock(taskId: number, block: { agent: string; agent_id?: string; content: string; decision_log: string; verdict: string }): Promise<void> {
  await fetch(`/api/task/${taskId}/block`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(block),
  });
}

export async function gateAction(taskId: number, action: "approve" | "refuse", comment?: string): Promise<{ success: boolean; status: string }> {
  return json(`/api/task/${taskId}/gate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, comment }),
  });
}

export async function addNote(taskId: number, text: string, author?: string): Promise<void> {
  await fetch(`/api/task/${taskId}/note`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, author }),
  });
}

export async function deleteNote(taskId: number, noteId: number): Promise<void> {
  await fetch(`/api/task/${taskId}/note/${noteId}`, { method: "DELETE" });
}

export async function addAttachment(taskId: number, filename: string, data: string): Promise<void> {
  await fetch(`/api/task/${taskId}/attachment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, data }),
  });
}

export async function deleteAttachment(taskId: number, storedName: string): Promise<void> {
  await fetch(`/api/task/${taskId}/attachment/${encodeURIComponent(storedName)}`, { method: "DELETE" });
}

export async function fetchPipelines(): Promise<PipelinesFile> {
  return json("/api/pipelines");
}

export async function savePipelines(data: PipelinesFile): Promise<void> {
  await fetch("/api/pipelines", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function fetchAgents(): Promise<AgentInfo[]> {
  return json("/api/agents");
}
