export function priorityClass(p: string): string {
  return p === "high" || p === "medium" || p === "low" ? p : "";
}

export function isOlderThan3Days(d: string): boolean {
  return d ? Date.now() - new Date(d).getTime() > 3 * 86400000 : false;
}

export function parseTags(tags: string | null): string[] {
  if (!tags || tags === "null") return [];
  try { const p = JSON.parse(tags); return Array.isArray(p) ? p : []; } catch { return []; }
}

export function parseJsonArray<T = unknown>(raw: string | null): T[] {
  if (!raw || raw === "null") return [];
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
}

export function timeAgo(dateStr: string): string {
  const days = Math.floor((Date.now() - new Date(dateStr + "Z").getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return dateStr.slice(0, 10);
}
