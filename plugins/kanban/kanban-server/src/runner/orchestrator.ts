import type { Task, Block, PipelinesFile, PipelineConfig } from "../types.js";
import { spawnClaude } from "./claude-spawn.js";
import { parseAgentOutput } from "./verdict-parser.js";
import { acquireRepo, releaseRepo } from "./concurrency.js";

const API_BASE = process.env.KANBAN_API || "http://localhost:5173";

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, opts);
  return res.json();
}

async function apiPatch(path: string, body: Record<string, unknown>) {
  return api(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function apiPost(path: string, body: Record<string, unknown>) {
  return api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function formatBlocks(blocks: Block[]): string {
  if (blocks.length === 0) return "None";
  return blocks
    .map(
      (b, i) =>
        `---\n#${i + 1} Agent: ${b.agent} | Verdict: ${b.verdict} | ${b.timestamp}\nContent: ${b.content}\nDecision Log: ${b.decision_log}\n---`
    )
    .join("\n\n");
}

function formatUserBlocks(blocks: Block[]): string {
  const userBlocks = blocks.filter(b => b.verdict === "info");
  if (userBlocks.length === 0) return "None";
  return userBlocks.map((b) => `- ${b.agent} (${b.timestamp}): ${b.content}`).join("\n");
}

function buildPrompt(task: Task, blocks: Block[]): string {
  return `Kanban task #${task.id}

Title: ${task.title}
Description: ${task.description || "No description"}

Previous blocks:
${formatBlocks(blocks)}

User notes:
${formatUserBlocks(blocks)}

Respond with your output, then on the last line write one of:
- ok — done, proceed to next stage
- nok — problem found, send back to previous stage
- relay — problem found but not in my scope, forward back`;
}

function buildResumePrompt(
  blocks: Block[],
  retryBlock: Block,
  isRelay: boolean
): string {
  let msg = "The task was sent back to your stage.\n\n";
  if (isRelay) {
    msg += "The next agent reported a problem but could not fix it. Review the feedback and either address it yourself or relay it further back.\n\n";
  }
  msg += `Feedback:\n${retryBlock.content}\n\nDecision log: ${retryBlock.decision_log}\n\n`;

  const recentUserBlocks = blocks.filter(b => b.verdict === "info").slice(-3);
  if (recentUserBlocks.length > 0) {
    msg += `User notes:\n${recentUserBlocks.map(b => `- ${b.agent} (${b.timestamp}): ${b.content}`).join("\n")}\n\n`;
  }

  msg += `Respond with your output, then on the last line write one of:
- ok — done, proceed to next stage
- nok — problem found, send back to previous stage
- relay — problem found but not in my scope, forward back`;

  return msg;
}

export interface RunOptions {
  taskId: number;
  auto?: boolean;
  step?: boolean;
  onLog?: (msg: string) => void;
  onConfirm?: (msg: string) => Promise<boolean>;
}

export async function runPipeline(opts: RunOptions): Promise<void> {
  const { taskId, auto = false, step = false, onLog = console.log, onConfirm } = opts;

  while (true) {
    // 1. Read task
    const task: Task = await api(`/api/task/${taskId}`);
    if (!task || !task.id) {
      onLog(`Task #${taskId} not found`);
      return;
    }

    // 2. Read pipeline config
    const pipelinesConfig: PipelinesFile = await api("/api/pipelines");
    const pipelineConfig: PipelineConfig =
      pipelinesConfig.pipelines[task.pipeline] || pipelinesConfig.pipelines[pipelinesConfig.default];
    const maxLoops = pipelinesConfig.max_loops;
    const gates = pipelineConfig.gates || [];
    const columns = ["todo", ...pipelineConfig.stages, "done"];

    // Handle awaiting state (gate)
    if (task.status.startsWith("awaiting:")) {
      onLog(`Task #${taskId} is awaiting validation for stage "${task.status.slice("awaiting:".length)}". Approve or refuse from the board UI.`);
      return;
    }

    // Done?
    if (task.status === "done") {
      onLog(`Task #${taskId} is done.`);
      return;
    }

    // Determine current position
    let currentIdx = columns.indexOf(task.status);
    if (task.status === "todo") {
      // Move to first stage
      const firstStage = columns[1];
      await apiPatch(`/api/task/${taskId}`, { status: firstStage, loop_count: 0 });
      onLog(`Task #${taskId}: todo -> ${firstStage}`);
      currentIdx = 1;
    } else if (currentIdx === -1) {
      onLog(`Task #${taskId} has unknown status "${task.status}"`);
      return;
    }

    const currentStage = columns[currentIdx];

    // 3. Check blocked
    if (task.loop_count >= maxLoops) {
      onLog(`Task #${taskId} is BLOCKED (${task.loop_count}/${maxLoops} loops). Add a comment to unblock.`);
      return;
    }

    // 4. Find repo from Resolver block (for concurrency)
    const blocks: Block[] = task.blocks ? JSON.parse(task.blocks) : [];
    let repo = "";
    const resolverBlock = blocks.find((b) => b.agent === "Resolver" && b.verdict === "ok");
    if (resolverBlock) {
      const repoMatch = resolverBlock.content.match(/Repository:\s*`([^`]+)`/);
      if (repoMatch) repo = repoMatch[1];
    }

    // Recover from interrupted run: if the last block is an "ok" verdict for the current stage,
    // the previous run completed the agent but crashed before advancing the task status.
    const lastBlock = blocks[blocks.length - 1];
    if (lastBlock && lastBlock.agent === currentStage && lastBlock.verdict === "ok") {
      if (gates.includes(currentStage)) {
        await apiPatch(`/api/task/${taskId}`, { status: `awaiting:${currentStage}`, loop_count: 0 });
        onLog(`Task #${taskId}: recovered — stage ${currentStage} already ok, awaiting validation.`);
        return;
      }
      const nextStage = columns[currentIdx + 1];
      await apiPatch(`/api/task/${taskId}`, { status: nextStage, loop_count: 0 });
      onLog(`Task #${taskId}: recovered — ${currentStage} already ok, advancing to ${nextStage}`);
      if (nextStage === "done") return;
      if (step) return;
      if (!auto) return;
      continue;
    }

    // Acquire repo lock
    if (repo) await acquireRepo(repo, currentStage);

    try {
      onLog(`Task #${taskId}: dispatching ${currentStage}...`);

      // 5. Check if we can resume a previous agent
      let sessionId: string | null = null;
      let isRetry = false;
      let retryBlock: Block | null = null;

      for (let i = blocks.length - 1; i >= 0; i--) {
        if (blocks[i].agent === currentStage && blocks[i].agent_id) {
          sessionId = blocks[i].agent_id;
          // Find the block that caused the retry (the one after this agent's last ok)
          if (i < blocks.length - 1) {
            retryBlock = blocks[blocks.length - 1];
            isRetry = true;
          }
          break;
        }
      }

      // 6. Build prompt
      let prompt: string;
      let resumeId: string | undefined;
      if (isRetry && sessionId && retryBlock) {
        const isRelay = retryBlock.verdict === "relay";
        prompt = buildResumePrompt(blocks, retryBlock, isRelay);
        resumeId = sessionId || undefined;
      } else {
        prompt = buildPrompt(task, blocks);
      }

      // 7. Dispatch via server (spawns claude with live terminal)
      const dispatchResult = await apiPost(`/api/task/${taskId}/dispatch`, {
        agent: currentStage,
        prompt,
        resume: resumeId,
      });

      const terminalId = (dispatchResult as { terminalId?: string }).terminalId;
      onLog(`Task #${taskId}: ${currentStage} dispatched (terminal: ${terminalId})`);

      // 8. Poll until the running block is updated by the server
      let parsed = { verdict: "ok" as string };
      for (let i = 0; i < 600; i++) {  // max 10 minutes
        await new Promise((r) => setTimeout(r, 3000));
        let updatedTask: Task;
        try {
          updatedTask = await api(`/api/task/${taskId}`);
        } catch (err) {
          onLog(`Task #${taskId}: transient poll error (${(err as Error).message}), retrying...`);
          continue;
        }
        const updatedBlocks: Block[] = updatedTask.blocks ? JSON.parse(updatedTask.blocks) : [];
        const lastBlock = updatedBlocks[updatedBlocks.length - 1];
        if (lastBlock && lastBlock.verdict !== "running") {
          parsed.verdict = lastBlock.verdict;
          onLog(`Task #${taskId}: ${currentStage} -> ${lastBlock.verdict}`);
          break;
        }
      }

      // 9. Move task
      if (parsed.verdict === "ok") {
        // Check if current stage is a gate
        if (gates.includes(currentStage)) {
          await apiPatch(`/api/task/${taskId}`, {
            status: `awaiting:${currentStage}`,
            loop_count: 0,
          });
          onLog(`Task #${taskId}: stage ${currentStage} completed. Awaiting validation.`);
          return;
        }

        const nextStage = columns[currentIdx + 1];
        await apiPatch(`/api/task/${taskId}`, { status: nextStage, loop_count: 0 });

        if (nextStage === "done") {
          onLog(`Task #${taskId}: DONE. Run /kanban-ship ${taskId} to push and create the PR.`);
          return;
        }
        onLog(`Task #${taskId}: ${currentStage} -> ${nextStage}`);
      } else if (parsed.verdict === "nok") {
        const newLoopCount = task.loop_count + 1;
        if (newLoopCount >= maxLoops) {
          await apiPatch(`/api/task/${taskId}`, { loop_count: newLoopCount });
          onLog(`Task #${taskId}: BLOCKED after ${newLoopCount} loops.`);
          return;
        }
        const prevStage = columns[currentIdx - 1];
        await apiPatch(`/api/task/${taskId}`, { status: prevStage, loop_count: newLoopCount });
        onLog(`Task #${taskId}: NOK, back to ${prevStage} (loop ${newLoopCount}/${maxLoops})`);
      } else if (parsed.verdict === "relay") {
        const prevStage = columns[currentIdx - 1];
        await apiPatch(`/api/task/${taskId}`, { status: prevStage });
        onLog(`Task #${taskId}: RELAY, back to ${prevStage}`);
      }
    } finally {
      if (repo) releaseRepo(repo, currentStage);
    }

    // 10. Loop or stop
    if (step) return;
    if (!auto) {
      if (onConfirm) {
        const shouldContinue = await onConfirm("Continue to next stage?");
        if (!shouldContinue) return;
      } else {
        return;
      }
    }
  }
}
