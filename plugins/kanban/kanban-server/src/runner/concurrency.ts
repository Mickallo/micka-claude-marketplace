/**
 * Simple semaphore for per-repo concurrency control.
 * - Read-only stages (Resolver, Planner, Critic, Inspector, Ranger) can run in parallel
 * - Builder is exclusive (1 per repo at a time)
 */

const WRITE_STAGES = new Set(["Builder"]);

interface RepoLock {
  readers: number;
  writer: boolean;
  queue: Array<{ resolve: () => void; exclusive: boolean }>;
}

const locks = new Map<string, RepoLock>();

function getLock(repo: string): RepoLock {
  if (!locks.has(repo)) {
    locks.set(repo, { readers: 0, writer: false, queue: [] });
  }
  return locks.get(repo)!;
}

function tryProcess(lock: RepoLock) {
  while (lock.queue.length > 0) {
    const next = lock.queue[0];
    if (next.exclusive) {
      if (lock.readers === 0 && !lock.writer) {
        lock.writer = true;
        lock.queue.shift();
        next.resolve();
      } else {
        break;
      }
    } else {
      if (!lock.writer) {
        lock.readers++;
        lock.queue.shift();
        next.resolve();
      } else {
        break;
      }
    }
  }
}

export function isWriteStage(stage: string): boolean {
  return WRITE_STAGES.has(stage);
}

export async function acquireRepo(repo: string, stage: string): Promise<void> {
  const lock = getLock(repo);
  const exclusive = isWriteStage(stage);

  // Try immediate acquire
  if (exclusive) {
    if (lock.readers === 0 && !lock.writer) {
      lock.writer = true;
      return;
    }
  } else {
    if (!lock.writer && lock.queue.every((q) => !q.exclusive)) {
      lock.readers++;
      return;
    }
  }

  // Queue
  return new Promise((resolve) => {
    lock.queue.push({ resolve, exclusive });
  });
}

export function releaseRepo(repo: string, stage: string): void {
  const lock = getLock(repo);
  if (isWriteStage(stage)) {
    lock.writer = false;
  } else {
    lock.readers = Math.max(0, lock.readers - 1);
  }
  tryProcess(lock);
}
