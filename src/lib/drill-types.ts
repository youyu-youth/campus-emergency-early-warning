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

/** 感知解读(监测中心消费;来自 timeline 感知 signal 节点,模型失败时为规则降级解读) */
export interface SignalPerceptionDTO {
  title: string;
  eventType: string;
  /** 事件类型中文名(来自场景定义;场景缺失时回退 eventType 原值) */
  eventTypeLabel?: string;
  location: string;
  occurredTime: string;
  evidence: string[];
  reasoning: string;
  /** true=模型超时/输出无效,已按规则默认解读上报 */
  degraded: boolean;
  /** 该信号是否为创建事件的首信号 */
  createdEvent: boolean;
}

export interface SignalDTO {
  id: string;
  sourceKind: "sensor" | "camera" | string;
  /** 模拟设备编号(如 LIB-3F-SMOKE-01),证明信号来源为模拟设备 */
  sourceRef: string;
  location: string;
  signalType: string;
  confidence: number;
  status: string;
  simTime: string;
  /** 原始读数(键值随信号类型变化,显式携带 simulated: true) */
  payload: Record<string, unknown>;
  /** 感知 Agent 解读结果(信号被解读后才有) */
  perception?: SignalPerceptionDTO;
}

/** 演练历史条目(指挥台历史表格);severity 来自关联事件,score 终止时为 null */
export interface DrillHistoryItemDTO {
  id: string;
  name: string;
  scenarioKey: ScenarioKey;
  /** 场景中文名(服务端从场景仓库解析,场景已删也保留) */
  scenarioName: string;
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

/** 协作页消费的单次智能体调用(来自 timeline 节点;输入/输出为 detail 裁剪摘要) */
export interface AgentCallDTO {
  seq: number;
  nodeType: string;
  title: string;
  simTime: string;
  /** true=模型超时/输出无效,该节点为规则降级记录(anomaly) */
  degraded: boolean;
  /** 输入摘要 */
  input?: string;
  /** 输出摘要 */
  output?: string;
}

/** 协作页消费的智能体活动聚合(最近调用 + 规则统计;耗时/成功率仅处置角色有值,送达仅通知角色) */
export interface AgentActivityDTO {
  key: string;
  recentCalls: AgentCallDTO[];
  stats: {
    /** 该智能体的 timeline 调用节点数(含降级) */
    calls: number;
    /** 降级次数(anomaly 节点) */
    degraded: number;
    /** 平均任务耗时毫秒(规则模拟;仅处置角色,无结果任务时为 null) */
    avgDurationMs: number | null;
    /** 任务成功率 0-1(规则结果;仅处置角色) */
    successRate: number | null;
    /** 模拟送达统计(仅通知角色) */
    delivery: { total: number; delivered: number } | null;
  };
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

/** 单次发布尝试记录(来自 ⚑ 通知节点 detail.publishes;GLOSSARY:发布/重试追加是节点唯一可变例外) */
export interface NotificationPublishDTO {
  attempt: number;
  status: string;
  stats: { total?: number; delivered?: number; failed?: number };
  publishedSimTime: string | null;
}

export interface NotificationDTO {
  id: string;
  audience: string;
  title: string;
  content: string;
  status: string;
  delivery: { total?: number; delivered?: number; failed?: number; channelOk?: boolean; attempt?: number } | null;
  /** 发布(模拟)时刻;未发布为 null */
  publishedSimTime: string | null;
  /** 草稿生成时刻(模拟,来自 ⚑ 通知节点);通知图未执行时缺省 */
  draftSimTime?: string;
  /** 草稿来源:model=模型生成 / degraded=规则默认文案 / restored=中断恢复复用 */
  source?: "model" | "degraded" | "restored" | string;
  /** 逐次发布尝试记录(⚑ 节点 detail.publishes 按受众匹配) */
  publishes: NotificationPublishDTO[];
}

/** 事件库 · 信号模板(结构化读数,提交时服务端拼 payload 并盖模拟标记) */
export interface ScenarioSignalTemplateDTO {
  /** 相对演练开始的模拟偏移(毫秒) */
  offsetMs: number;
  kind: "sensor" | "camera";
  /** 模拟设备编号(如 LIB-3F-SMOKE-01) */
  sourceRef: string;
  location: string;
  signalType: string;
  confidence: [number, number];
  /** 原始读数(键值随信号类型;服务端存储时并入 payload.simulated) */
  reading: Record<string, string | number>;
}

/** 事件库 · 演变里程碑模板 */
export interface ScenarioEvolutionDTO {
  offsetMs: number;
  milestone: string;
  note: string;
}

/** 事件库场景(管理页与发起页消费;key 为标识,eventType 语义 = key) */
export interface ScenarioDTO {
  key: string;
  name: string;
  description: string;
  /** 事件类型中文名(监测中心展示) */
  eventTypeLabel: string;
  defaultSimStart: string;
  location: string;
  intensity: "low" | "medium" | "high";
  signals: ScenarioSignalTemplateDTO[];
  evolution: ScenarioEvolutionDTO[];
  isBuiltin: boolean;
  updatedAt: string;
}

/** 发起页场景卡片(ScenarioDTO 的轻量投影) */
export interface ScenarioCardDTO {
  key: string;
  name: string;
  description: string;
  location: string;
  intensity: "low" | "medium" | "high";
  signalCount: number;
  evolutionCount: number;
  isBuiltin: boolean;
}

/** 事件库场景创建/更新提交体(表单组装与服务端 zod 校验共用形状;纯类型,client 安全) */
export interface ScenarioBody {
  name: string;
  description: string;
  eventTypeLabel: string;
  defaultSimStart: string;
  location: string;
  intensity: "low" | "medium" | "high";
  signals: ScenarioSignalTemplateDTO[];
  evolution: ScenarioEvolutionDTO[];
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
    /** 场景中文名(服务端从场景仓库解析,场景已删也保留) */
    scenarioName: string;
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
  /** 协作页消费的编队活动聚合(与 agents 同 key 顺序) */
  agentActivity: AgentActivityDTO[];
  /** 失败通知当前可否重试:存在 failed 通知且演练未终止,且(经 API 门面)运行器仍绑定本演练 */
  notificationRetryable: boolean;
}
