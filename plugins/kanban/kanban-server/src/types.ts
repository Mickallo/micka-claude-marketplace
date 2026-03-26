export interface Block {
  agent: string;
  agent_id: string | null;
  content: string;
  decision_log: string;
  verdict: "ok" | "nok" | "relay" | "running" | "info";
  timestamp: string;
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
  notes: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface PipelineConfig {
  stages: string[];
  gates?: string[];
}

export interface PipelinesFile {
  pipelines: Record<string, PipelineConfig>;
  default: string;
  max_loops: number;
}

export interface AgentInfo {
  name: string;
  source: string;
  path: string;
  description?: string;
  model?: string;
  color?: string;
  tools?: string[];
  prompt?: string;
}

export interface Note {
  id: number;
  text: string;
  author: string;
  timestamp: string;
}
