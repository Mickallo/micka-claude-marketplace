export interface Block {
  agent: string;
  agent_id: string | null;
  content: string;
  decision_log: string;
  verdict: "ok" | "nok" | "relay" | "running" | "info";
  timestamp: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  duration_ms?: number;
}

export interface Task {
  id: number;
  title: string;
  status: string;
  priority: string;
  pipeline: string;
  rank: number;
  description: string | null;
  blocks: string;
  loop_count: number;
  tags: string | null;
  attachments: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface Attachment {
  filename: string;
  storedName: string;
  url: string;
  size: number;
  uploaded_at: string;
}

export interface PipelinesFile {
  pipelines: Record<string, { stages: string[]; gates?: string[] }>;
  default: string;
  max_loops: number;
}

export interface BoardResponse {
  columns: Record<string, Task[]>;
  column_order: string[];
  pipeline: string;
  pipelines: string[];
}

export interface AgentInfo {
  name: string;
  source: string;
  description?: string;
  model?: string;
  color?: string;
  tools?: string[];
  prompt?: string;
}

export interface DashboardData {
  totalCost: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  tasksDone: number;
  tasksTotal: number;
  avgDuration: number;
  blockCount: number;
  byAgent: Record<string, { cost: number; tokens: number; count: number }>;
  byModel: Record<string, { cost: number; tokens: number; count: number }>;
  byPipeline: Record<string, { cost: number; tokens: number; count: number }>;
  byTask: Record<string, { cost: number; tokens: number; count: number }>;
  timeline: { date: string; cost: number; tokens: number; count: number }[];
  recentRuns: {
    taskId: number;
    taskTitle: string;
    agent: string;
    model: string;
    verdict: string;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
    duration_ms: number;
    timestamp: string;
  }[];
}

export interface GitCommit {
  hash: string;
  short: string;
  message: string;
  date: string;
  author: string;
}

export interface GitInfo {
  branch: string;
  commits: GitCommit[];
  diff: string;
}
