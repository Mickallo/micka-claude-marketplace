// Dynamic agent colors — generated from agent name hash
// Uses oklch for consistent perceived brightness

const PALETTE = [
  "oklch(0.65 0.18 200)",  // teal
  "oklch(0.65 0.18 280)",  // purple
  "oklch(0.70 0.15 45)",   // amber
  "oklch(0.75 0.15 145)",  // green
  "oklch(0.60 0.20 25)",   // coral
  "oklch(0.65 0.18 330)",  // pink
  "oklch(0.70 0.15 90)",   // lime
  "oklch(0.60 0.18 240)",  // blue
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

const cache = new Map<string, string>();

export function getAgentColor(name: string): string {
  if (name === "todo" || name === "done") return "";
  if (cache.has(name)) return cache.get(name)!;
  const color = PALETTE[hashString(name) % PALETTE.length];
  cache.set(name, color);
  return color;
}

// CSS variable style for inline use
export function agentStyle(name: string): string {
  const color = getAgentColor(name);
  if (!color) return "";
  return `--agent-color: ${color}`;
}
