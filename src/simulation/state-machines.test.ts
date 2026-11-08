import { describe, expect, it } from "vitest";
import {
  canAdjustSeverity,
  canTransition,
  DRILL_TRANSITIONS,
  EVENT_TRANSITIONS,
  isTerminal,
  NOTIFICATION_TRANSITIONS,
  TASK_TRANSITIONS,
  transition,
  type DrillStatus,
  type EventStatus,
  type NotificationStatus,
  type TaskStatus,
} from "./state-machines";

describe("演练状态机", () => {
  it("走通完整生命周期：draft → running → awaiting_confirmation → running → completed", () => {
    let status: DrillStatus = "draft";
    status = transition(DRILL_TRANSITIONS, status, "running");
    status = transition(DRILL_TRANSITIONS, status, "awaiting_confirmation");
    status = transition(DRILL_TRANSITIONS, status, "running");
    status = transition(DRILL_TRANSITIONS, status, "completed");
    expect(status).toBe("completed");
    expect(isTerminal(DRILL_TRANSITIONS, status)).toBe(true);
  });

  it("允许暂停与恢复", () => {
    let status: DrillStatus = "running";
    status = transition(DRILL_TRANSITIONS, status, "paused");
    status = transition(DRILL_TRANSITIONS, status, "running");
    expect(status).toBe("running");
  });

  it("拒绝非法流转并给出允许值", () => {
    expect(() => transition(DRILL_TRANSITIONS, "draft", "completed")).toThrow(
      /不允许的状态流转：draft → completed/,
    );
    expect(canTransition(DRILL_TRANSITIONS, "completed", "running")).toBe(false);
  });
});

describe("事件状态机", () => {
  it("走通主线：reported → graded → handling → controlled → closed", () => {
    let status: EventStatus = "reported";
    for (const next of ["graded", "handling", "controlled", "closed"] as const) {
      status = transition(EVENT_TRANSITIONS, status, next);
    }
    expect(status).toBe("closed");
  });

  it("允许误报取消与演练中止取消", () => {
    expect(transition(EVENT_TRANSITIONS, "reported", "cancelled")).toBe("cancelled");
    expect(transition(EVENT_TRANSITIONS, "handling", "cancelled")).toBe("cancelled");
  });

  it("等级调整只允许在定级后、控制前", () => {
    expect(canAdjustSeverity("graded")).toBe(true);
    expect(canAdjustSeverity("handling")).toBe(true);
    expect(canAdjustSeverity("reported")).toBe(false);
    expect(canAdjustSeverity("controlled")).toBe(false);
  });
});

describe("任务状态机", () => {
  it("走通主线并允许失败重试", () => {
    let status: TaskStatus = "pending_confirmation";
    status = transition(TASK_TRANSITIONS, status, "executing");
    status = transition(TASK_TRANSITIONS, status, "failed");
    status = transition(TASK_TRANSITIONS, status, "executing");
    status = transition(TASK_TRANSITIONS, status, "done");
    expect(status).toBe("done");
    expect(isTerminal(TASK_TRANSITIONS, "done")).toBe(true);
  });

  it("待确认与执行中的任务都可取消（改派）", () => {
    expect(transition(TASK_TRANSITIONS, "pending_confirmation", "cancelled")).toBe("cancelled");
    expect(transition(TASK_TRANSITIONS, "executing", "cancelled")).toBe("cancelled");
    expect(() => transition(TASK_TRANSITIONS, "done", "executing")).toThrow();
  });
});

describe("通知状态机", () => {
  it("走通主线：草稿 → 待确认 → 已发布（模拟）", () => {
    let status: NotificationStatus = "draft";
    status = transition(NOTIFICATION_TRANSITIONS, status, "pending_confirmation");
    status = transition(NOTIFICATION_TRANSITIONS, status, "published_sim");
    expect(status).toBe("published_sim");
    expect(isTerminal(NOTIFICATION_TRANSITIONS, "published_sim")).toBe(true);
  });

  it("允许退回修改与失败重试", () => {
    expect(transition(NOTIFICATION_TRANSITIONS, "pending_confirmation", "draft")).toBe("draft");
    expect(transition(NOTIFICATION_TRANSITIONS, "failed", "pending_confirmation")).toBe(
      "pending_confirmation",
    );
  });
});
