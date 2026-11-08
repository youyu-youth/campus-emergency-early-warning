// 事件 / 任务 / 通知 / 演练的状态机（纯函数规则，所有状态变化必须经此校验）
// 状态含义见 docs/design.md 第 7 节

export type DrillStatus =
  | "draft"
  | "running"
  | "awaiting_confirmation"
  | "paused"
  | "completed"
  | "aborted";

export type EventStatus =
  | "reported" // 已上报，待定级
  | "graded" // 已定级
  | "handling" // 处置中
  | "controlled" // 已控制
  | "closed" // 已关闭
  | "cancelled"; // 取消（误报或演练中止）

export type EventSeverity = "I" | "II" | "III" | "IV";

export type TaskStatus =
  | "pending_confirmation" // 待确认
  | "executing" // 执行中
  | "done" // 已完成
  | "failed" // 失败（可重试）
  | "cancelled"; // 已取消（改派或演练中止）

export type NotificationStatus =
  | "draft" // 草稿
  | "pending_confirmation" // 待确认
  | "published_sim" // 已发布（模拟分发）
  | "failed"; // 失败（可重试）

export type AgentRole = "security" | "medical" | "logistics";

/** 信号状态(无流转规则,由感知流程推进) */
export type SignalStatus = "new" | "processing" | "reported" | "ignored";

type TransitionMap<S extends string> = Readonly<Record<S, readonly S[]>>;

export const DRILL_TRANSITIONS: TransitionMap<DrillStatus> = {
  draft: ["running"],
  running: ["awaiting_confirmation", "paused", "completed", "aborted"],
  awaiting_confirmation: ["running", "paused", "aborted"],
  paused: ["running", "aborted"],
  completed: [],
  aborted: [],
};

export const EVENT_TRANSITIONS: TransitionMap<EventStatus> = {
  reported: ["graded", "cancelled"],
  graded: ["handling", "cancelled"],
  handling: ["controlled", "cancelled"],
  controlled: ["closed"],
  closed: [],
  cancelled: [],
};

export const TASK_TRANSITIONS: TransitionMap<TaskStatus> = {
  pending_confirmation: ["executing", "cancelled"],
  executing: ["done", "failed", "cancelled"],
  done: [],
  failed: ["executing"],
  cancelled: [],
};

export const NOTIFICATION_TRANSITIONS: TransitionMap<NotificationStatus> = {
  draft: ["pending_confirmation"],
  pending_confirmation: ["published_sim", "failed", "draft"],
  published_sim: [],
  failed: ["pending_confirmation"],
};

export function canTransition<S extends string>(map: TransitionMap<S>, from: S, to: S): boolean {
  return map[from].includes(to);
}

// 执行状态流转；非法流转抛出错误（调用方必须先处理或降级）
export function transition<S extends string>(map: TransitionMap<S>, from: S, to: S): S {
  if (!canTransition(map, from, to)) {
    const allowed = map[from].join("、") || "无";
    throw new Error(`不允许的状态流转：${from} → ${to}（允许：${allowed}）`);
  }
  return to;
}

export function isTerminal<S extends string>(map: TransitionMap<S>, status: S): boolean {
  return map[status].length === 0;
}

// 等级调整：定级后、控制前可调整事件等级（状态不变，仅等级可变）
export function canAdjustSeverity(status: EventStatus): boolean {
  return status === "graded" || status === "handling";
}
