// 演练 DTO 共享类型:服务端组装(src/server/drill-service)、前端消费(壳层/工作区/推演页)
// 纯类型文件,无运行时依赖,client bundle 可安全引入

import type { DrillPhase, DrillStatus, EventSeverity } from "@/simulation/state-machines";
import type { ScenarioKey } from "@/simulation/scenarios";
import type { TaskPlanItem } from "@/simulation/task-rules";
import type { DrillMetrics } from "@/simulation/score-rules";

export interface DrillSummaryDTO {
  id: string;
  name: string;
  status: DrillStatus;
  phase: DrillPhase;
  severity: EventSeverity | null;
  simClockLabel: string;
  speed: number;
}

export interface AgentStatusDTO {
  key: string;
  label: string;
  status: "standby" | "working" | "executing" | "done";
  latestAction: string | null;
}

export interface SignalDTO {
  id: string;
  sourceKind: "sensor" | "camera" | string;
  location: string;
  signalType: string;
  confidence: number;
  status: string;
  simTime: string;
}

/** 演练历史条目(指挥台历史表格);severity 来自关联事件,score 终止时为 null */
export interface DrillHistoryItemDTO {
  id: string;
  name: string;
  scenarioKey: ScenarioKey;
  status: DrillStatus;
  severity: EventSeverity | null;
  score: number | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface ReportTimelineItemDTO {
  /** 归纳条目对应的时间线节点序号(落库前已净化,保证可溯源) */
  nodeSeq: number;
  summary: string;
}

export interface ReportProblemDTO {
  /** 问题对应的时间线节点序号;失败任务/通知类问题可能无对应节点 */
  nodeSeq: number | null;
  title: string;
  detail: string;
}

export interface ReportImprovementDTO {
  title: string;
  detail: string;
}

/** 复盘报告(completed 演练必有;model=模型生成,degraded=模型失败后规则骨架生成) */
export interface ReportDTO {
  timelineSummary: ReportTimelineItemDTO[];
  problems: ReportProblemDTO[];
  improvements: ReportImprovementDTO[];
  /** 规则指标(评分输入,指标条数据源) */
  metrics: DrillMetrics;
  source: "model" | "degraded";
  createdAt: string;
}

export interface TimelineNodeDTO {
  id: string;
  seq: number;
  phase: DrillPhase;
  nodeType: string;
  title: string;
  actor: string | null;
  requiresConfirmation: boolean;
  simTime: string;
  /** ⚑ 节点确认信息(已确认时) */
  confirmation?: { action: string; waitedMs?: number; final?: string };
  /** Agent 决策依据(定级/方案节点) */
  reasoning?: string;
}

export interface TaskDTO {
  id: string;
  role: string;
  title: string;
  description: string;
  status: string;
  dispatchedSimTime: string | null;
  completedSimTime: string | null;
  /** 规则计算的处置结果(耗时/资源) */
  result: { durationMs?: number; note?: string } | null;
}

export interface NotificationDTO {
  id: string;
  audience: string;
  title: string;
  content: string;
  status: string;
  delivery: { total?: number; delivered?: number; failed?: number } | null;
}

export type PendingConfirmationDTO =
  | { kind: "grading"; suggested: EventSeverity; reasoning: string | null; nodeId: string }
  | {
      kind: "dispatch";
      dispatchKind: "initial" | "redispatch";
      proposedTasks: TaskPlanItem[];
      reasoning: string | null;
      nodeId: string;
    }
  | { kind: "notification"; drafts: NotificationDTO[]; nodeId: string | null };

export interface DrillDetailDTO {
  drill: {
    id: string;
    name: string;
    status: DrillStatus;
    scenarioKey: ScenarioKey;
    seed: number;
    score: number | null;
    simClockLabel: string;
    speed: number;
    /** 全自动模式(true=跳过人工确认点;来自 params 列,运行态控制台展示确认模式) */
    autoConfirm: boolean;
    startedAt: string | null;
    endedAt: string | null;
  };
  phase: DrillPhase;
  event: {
    id: string;
    type: string;
    title: string;
    location: string;
    severity: EventSeverity | null;
    status: string;
    detectedSimTime: string | null;
  } | null;
  pendingConfirmation: PendingConfirmationDTO | null;
  timeline: TimelineNodeDTO[];
  tasks: TaskDTO[];
  notifications: NotificationDTO[];
  signals: SignalDTO[];
  /** 复盘报告(completed 演练必有;运行中/终止为 null) */
  report: ReportDTO | null;
  agents: AgentStatusDTO[];
}
