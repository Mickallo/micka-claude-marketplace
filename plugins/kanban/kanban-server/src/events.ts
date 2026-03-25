import { EventEmitter } from "events";

export interface TaskEvent {
  type: string;
  taskId: number;
  data?: Record<string, unknown>;
}

class EventBus extends EventEmitter {
  emit(event: "task", payload: TaskEvent): boolean;
  emit(event: string, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  taskUpdated(taskId: number, data?: Record<string, unknown>) {
    this.emit("task", { type: "task:updated", taskId, data });
  }

  taskMoved(taskId: number, from: string, to: string) {
    this.emit("task", { type: "task:moved", taskId, data: { from, to } });
  }

  blockAdded(taskId: number, agent: string, verdict: string) {
    this.emit("task", { type: "task:block", taskId, data: { agent, verdict } });
  }
}

export const eventBus = new EventBus();
