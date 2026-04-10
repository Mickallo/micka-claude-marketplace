#!/usr/bin/env tsx
import { runPipeline } from "./runner/orchestrator.js";
import * as readline from "readline";

const args = process.argv.slice(2);

function usage() {
  console.log(`Usage:
  kanban-runner run <id> [<id>...] [--auto]    Run pipeline for task(s)
  kanban-runner run --all [--auto]             Run all eligible tasks
  kanban-runner step <id>                      Execute one pipeline step
  kanban-runner status                         Show running tasks`);
  process.exit(1);
}

async function confirm(msg: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${msg} [Y/n] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() !== "n");
    });
  });
}

async function getEligibleTaskIds(): Promise<number[]> {
  const API = process.env.KANBAN_API || "http://localhost:5173";
  const res = await fetch(`${API}/api/board`);
  const data = await res.json();
  const ids: number[] = [];
  for (const [col, tasks] of Object.entries(data.columns)) {
    if (col === "done") continue;
    for (const task of tasks as Array<{ id: number; status: string; loop_count: number }>) {
      // Skip blocked tasks
      if (task.status.startsWith("awaiting:")) continue;
      const pipelinesRes = await fetch(`${API}/api/pipelines`);
      const pipelines = await pipelinesRes.json();
      if (task.loop_count >= pipelines.max_loops) continue;
      ids.push(task.id);
    }
  }
  return ids;
}

async function main() {
  if (args.length === 0) usage();

  const command = args[0];

  if (command === "step") {
    const id = parseInt(args[1]);
    if (isNaN(id)) usage();
    await runPipeline({ taskId: id, step: true });
    return;
  }

  if (command === "status") {
    console.log("Status: not implemented yet (runner is stateless, check the board)");
    return;
  }

  if (command === "run") {
    const auto = args.includes("--auto");
    const isAll = args.includes("--all");

    let taskIds: number[];
    if (isAll) {
      taskIds = await getEligibleTaskIds();
      if (taskIds.length === 0) {
        console.log("No eligible tasks found.");
        return;
      }
      console.log(`Found ${taskIds.length} eligible task(s): ${taskIds.join(", ")}`);
    } else {
      taskIds = args
        .slice(1)
        .filter((a) => !a.startsWith("--"))
        .map((a) => parseInt(a))
        .filter((n) => !isNaN(n));
      if (taskIds.length === 0) usage();
    }

    if (taskIds.length === 1) {
      // Single task: sequential
      await runPipeline({
        taskId: taskIds[0],
        auto,
        onConfirm: auto ? undefined : confirm,
      });
    } else {
      // Multiple tasks: parallel
      console.log(`Running ${taskIds.length} tasks in parallel...`);
      const results = await Promise.allSettled(
        taskIds.map((id) =>
          runPipeline({
            taskId: id,
            auto,
            onLog: (msg) => console.log(`[Task #${id}] ${msg}`),
          })
        )
      );
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === "rejected") {
          console.error(`Task #${taskIds[i]} failed: ${r.reason}`);
        }
      }
    }
    return;
  }

  // Legacy: just a number
  const id = parseInt(command);
  if (!isNaN(id)) {
    const auto = args.includes("--auto");
    await runPipeline({
      taskId: id,
      auto,
      onConfirm: auto ? undefined : confirm,
    });
    return;
  }

  usage();
}

main().catch((err) => {
  console.error("Runner error:", err);
  process.exit(1);
});
