// Web 端演练服务:进程内单例持有 runner + tick 循环,向 API 路由暴露动作与查询
// 模型选择:配置了 MODEL_API_KEY 用真实模型;否则按场景用离线演示剧本(假模型)
// 数据库是唯一事实来源(scripts/drill-run.ts 同一约定),重启经 recoverInterruptedDrills 接续

import { DEMO_SCRIPTS } from "../../scripts/demo-scripts";
import { ScriptedModel, type AgentChatModel } from "../agents/model";
import { createProviderModel } from "../agents/model-provider";
import type { Db } from "../db/client";
import { getDb } from "../db/client";
import {
  getActiveDrills,
  getDrill,
  getEventByDrillId,
  getGraphRunByDrillId,
  getReportByDrillId,
  getTimelineNode,
  listDrills,
  listNotificationsByDrill,
  listSignalsByDrill,
  listTasksByDrill,
  listTimelineByDrill,
} from "../db/queries";
import type { DrillRow, NotificationRow, ReportRow, SignalRow, TaskRow, TimelineNodeRow } from "../db/types";
import { DrillRunner, type DrillRunState, type StartDrillInput } from "../runner/drill-runner";
import { formatSimClock, simOffsetMs, type ClockState } from "../simulation/clock";
import type { ScenarioKey } from "../simulation/scenarios";
import { PHASE_ORDER, type DrillPhase, type DrillStatus, type EventSeverity } from "../simulation/state-machines";
import type { TaskPlanItem } from "../simulation/task-rules";
import type {
  AgentStatusDTO,
  DrillDetailDTO,
  DrillHistoryItemDTO,
  DrillSummaryDTO,
  NotificationDTO,
  NotificationPublishDTO,
  PendingConfirmationDTO,
  ReportDTO,
  SignalDTO,
  SignalPerceptionDTO,
  TaskDTO,
  TimelineNodeDTO,
} from "../lib/drill-types";

const TICK_INTERVAL_MS = 200;

export type {
  AgentStatusDTO,
  DrillDetailDTO,
  DrillHistoryItemDTO,
  DrillSummaryDTO,
  NotificationDTO,
  PendingConfirmationDTO,
  ReportDTO,
  SignalDTO,
  TaskDTO,
  TimelineNodeDTO,
} from "../lib/drill-types";

// —— 查询组装(纯函数,可直接测试) ——

function readRunState(db: Db, drillId: string): DrillRunState {
  const row = getGraphRunByDrillId(db, drillId);
  if (!row) throw new Error(`演练 ${drillId} 缺少图运行状态`);
  return JSON.parse(row.state) as DrillRunState;
}

function clockLabel(drill: DrillRow): string {
  const clock = JSON.parse(drill.clock_state) as ClockState;
  return formatSimClock(simOffsetMs(clock, Date.now()));
}

/** 从 params 列读人工确认开关(损坏容忍:视作默认人工确认) */
function parseParamsAutoConfirm(drill: DrillRow): boolean {
  try {
    const params = JSON.parse(drill.params) as { autoConfirm?: unknown };
    return params.autoConfirm === true;
  } catch {
    return false;
  }
}

/** 重置语义(用户拍板):当前演练留痕终止,新开一场同配置同种子演练 */
export function buildRestartInput(drill: DrillRow): StartDrillInput {
  let speed = 1;
  try {
    const clock = JSON.parse(drill.clock_state) as { speed?: unknown };
    if (typeof clock.speed === "number" && clock.speed > 0) speed = clock.speed;
  } catch {
    // clock_state 损坏时按默认倍速重开
  }
  return {
    scenarioKey: drill.scenario_key as ScenarioKey,
    seed: drill.seed,
    speed,
    autoConfirm: parseParamsAutoConfirm(drill) || undefined,
  };
}

/** 壳层状态条消费的摘要(全局唯一活跃演练;无则 null) */
export function buildDrillSummary(db: Db, drill: DrillRow): DrillSummaryDTO {
  const state = readRunState(db, drill.id);
  const event = getEventByDrillId(db, drill.id);
  return {
    id: drill.id,
    name: drill.name,
    status: drill.status as DrillStatus,
    phase: state.phase,
    severity: (event?.severity as EventSeverity | null) ?? null,
    simClockLabel: clockLabel(drill),
    speed: JSON.parse(drill.clock_state).speed,
  };
}

function toTimelineDTO(node: TimelineNodeRow): TimelineNodeDTO {
  let detail: Record<string, unknown> = {};
  try {
    detail = JSON.parse(node.detail) as Record<string, unknown>;
  } catch {
    detail = {};
  }
  const confirmation = detail.confirmation as TimelineNodeDTO["confirmation"] | undefined;
  const reasoning = typeof detail.reasoning === "string" ? detail.reasoning : undefined;
  return {
    id: node.id,
    seq: node.seq,
    phase: node.phase as DrillPhase,
    nodeType: node.node_type,
    title: node.title,
    actor: node.actor,
    requiresConfirmation: node.requires_confirmation === 1,
    simTime: node.sim_time,
    ...(confirmation ? { confirmation } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
  };
}

function toTaskDTO(task: TaskRow): TaskDTO {
  let result: TaskDTO["result"] = null;
  try {
    result = task.result ? (JSON.parse(task.result) as TaskDTO["result"]) : null;
  } catch {
    result = null;
  }
  return {
    id: task.id,
    role: task.role,
    title: task.title,
    description: task.description,
    status: task.status,
    dispatchedSimTime: task.dispatched_sim_time,
    completedSimTime: task.completed_sim_time,
    result,
  };
}

function toNotificationDTO(row: NotificationRow): NotificationDTO {
  let delivery: NotificationDTO["delivery"] = null;
  try {
    delivery = row.delivery ? (JSON.parse(row.delivery) as NotificationDTO["delivery"]) : null;
  } catch {
    delivery = null;
  }
  return {
    id: row.id,
    audience: row.audience,
    title: row.title,
    content: row.content,
    status: row.status,
    delivery,
    publishedSimTime: row.published_sim_time,
    publishes: [],
  };
}

/**
 * 把 ⚑ 通知节点的生成与发布记录挂到对应通知(通知中心消费):
 * - 节点 detail.drafts[] = { audience, notificationId, source } → 草稿来源
 * - 节点 sim_time → 草稿生成时刻
 * - 节点 detail.publishes[] = { audience, attempt, status, stats, publishedSimTime } → 逐次尝试
 */
function attachNotificationDetails(notifications: NotificationDTO[], timelineRows: TimelineNodeRow[]): void {
  for (const node of timelineRows) {
    if (node.phase !== "notification" || node.node_type !== "notification") continue;
    let detail: Record<string, unknown> = {};
    try {
      detail = JSON.parse(node.detail) as Record<string, unknown>;
    } catch {
      detail = {};
    }
    const drafts = Array.isArray(detail.drafts) ? (detail.drafts as Array<Record<string, unknown>>) : [];
    for (const draft of drafts) {
      const notification = notifications.find((n) => n.id === draft.notificationId);
      if (notification) {
        notification.draftSimTime = node.sim_time;
        notification.source = typeof draft.source === "string" ? draft.source : undefined;
      }
    }
    const publishes = Array.isArray(detail.publishes) ? (detail.publishes as Array<Record<string, unknown>>) : [];
    for (const record of publishes) {
      const audience = typeof record.audience === "string" ? record.audience : null;
      const notification = audience ? notifications.find((n) => n.audience === audience) : undefined;
      if (notification) {
        notification.publishes.push({
          attempt: Number(record.attempt ?? 0),
          status: String(record.status ?? ""),
          stats: (record.stats ?? {}) as NotificationPublishDTO["stats"],
          publishedSimTime: typeof record.publishedSimTime === "string" ? record.publishedSimTime : null,
        });
      }
    }
  }
}

function toSignalDTO(row: SignalRow): SignalDTO {
  let payload: SignalDTO["payload"] = {};
  try {
    payload = JSON.parse(row.payload) as SignalDTO["payload"];
  } catch {
    payload = {};
  }
  return {
    id: row.id,
    sourceKind: row.source_kind,
    sourceRef: row.source_ref,
    location: row.location,
    signalType: row.signal_type,
    confidence: row.confidence,
    status: row.status,
    simTime: row.sim_time,
    payload,
  };
}

/**
 * 把 timeline 感知节点的解读结果挂到对应信号(监测中心消费):
 * - signal 节点 detail = { input: { signalId }, output },output 即感知提取
 * - anomaly 节点 detail = { signalId },标记该信号为降级解读
 */
function attachSignalPerceptions(signals: SignalDTO[], timelineRows: TimelineNodeRow[], eventSignalId: string | null): void {
  const byId = new Map(signals.map((s) => [s.id, s]));
  for (const node of timelineRows) {
    let detail: Record<string, unknown> = {};
    try {
      detail = JSON.parse(node.detail) as Record<string, unknown>;
    } catch {
      detail = {};
    }
    if (node.node_type === "signal" && node.phase === "perception") {
      const signalId = (detail.input as { signalId?: string } | undefined)?.signalId;
      const output = detail.output as SignalPerceptionDTO | undefined;
      const signal = signalId ? byId.get(signalId) : undefined;
      if (signal && output) {
        signal.perception = {
          title: String(output.title ?? ""),
          eventType: String(output.eventType ?? ""),
          location: String(output.location ?? ""),
          occurredTime: String(output.occurredTime ?? ""),
          evidence: Array.isArray(output.evidence) ? output.evidence.map(String) : [],
          reasoning: String(output.reasoning ?? ""),
          degraded: false,
          createdEvent: signalId === eventSignalId,
        };
      }
    } else if (node.node_type === "anomaly") {
      const signalId = typeof detail.signalId === "string" ? detail.signalId : null;
      const signal = signalId ? byId.get(signalId) : undefined;
      if (signal?.perception) {
        signal.perception.degraded = true;
      }
    }
  }
}

/** 复盘报告行 → DTO(JSON 列解析失败容忍:置空数组/零指标,报告头仍可呈现) */
function toReportDTO(row: ReportRow): ReportDTO {
  const parseArray = <T,>(json: string): T[] => {
    try {
      const parsed = JSON.parse(json) as unknown;
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  };
  let metrics: ReportDTO["metrics"] = {
    totalDurationMs: 0,
    reportDurationMs: 0,
    gradingDurationMs: 0,
    taskDone: 0,
    taskTotal: 0,
    resourceTotal: 0,
  };
  try {
    metrics = { ...metrics, ...(JSON.parse(row.metrics) as Partial<ReportDTO["metrics"]>) };
  } catch {
    // 保留零指标
  }
  return {
    timelineSummary: parseArray<ReportDTO["timelineSummary"][number]>(row.timeline_summary),
    problems: parseArray<ReportDTO["problems"][number]>(row.problems).map((p) => ({
      nodeSeq: typeof p.nodeSeq === "number" ? p.nodeSeq : null,
      title: String(p.title ?? ""),
      detail: String(p.detail ?? ""),
    })),
    improvements: parseArray<ReportDTO["improvements"][number]>(row.improvements),
    metrics,
    source: row.source === "degraded" ? "degraded" : "model",
    createdAt: row.created_at,
  };
}

const AGENT_DEFS: Array<{ key: string; label: string; phases: DrillPhase[] }> = [
  { key: "perception", label: "监测感知", phases: ["perception"] },
  { key: "command", label: "指挥调度", phases: ["grading", "handling"] },
  { key: "handling_security", label: "处置 · 保安", phases: ["handling"] },
  { key: "handling_medical", label: "处置 · 医务", phases: ["handling"] },
  { key: "handling_logistics", label: "处置 · 后勤", phases: ["handling"] },
  { key: "notification", label: "通知发布", phases: ["notification"] },
  { key: "review", label: "复盘评估", phases: ["review"] },
];

/** 智能体编队状态推导:终态全员已完成;当前阶段的编队「工作中/执行中」,已过阶段「已完成」,未到「待命」 */
function deriveAgentStatuses(
  phase: DrillPhase,
  timeline: TimelineNodeRow[],
  tasks: TaskRow[],
  finished = false,
): AgentStatusDTO[] {
  const actorByKey: Record<string, string> = {
    perception: "monitor_agent",
    command: "command_agent",
    handling_security: "security_agent",
    handling_medical: "medical_agent",
    handling_logistics: "logistics_agent",
    notification: "notification_agent",
    review: "review_agent",
  };
  const latestByActor = new Map<string, TimelineNodeRow>();
  for (const node of timeline) {
    if (node.actor) latestByActor.set(node.actor, node);
  }
  const currentOrdinal = PHASE_ORDER.indexOf(phase);

  return AGENT_DEFS.map((def) => {
    const latest = latestByActor.get(actorByKey[def.key]) ?? null;
    let status: AgentStatusDTO["status"] = "standby";
    if (finished) {
      status = "done";
    } else if (def.phases.includes(phase)) {
      // 处置角色:有执行中任务才算执行中,否则该阶段工作中
      const executing = def.key.startsWith("handling_")
        ? tasks.some((t) => t.role === def.key.replace("handling_", "") && t.status === "executing")
        : false;
      status = executing ? "executing" : "working";
    } else if (def.phases.some((p) => PHASE_ORDER.indexOf(p) < currentOrdinal)) {
      status = "done";
    }
    return { key: def.key, label: def.label, status, latestAction: latest?.title ?? null };
  });
}

/** 当前等待确认的关键节点与建议内容(决策坞消费) */
function buildPendingConfirmation(
  db: Db,
  drill: DrillRow,
  state: DrillRunState,
): PendingConfirmationDTO | null {
  if (state.grading?.status === "awaiting_confirmation") {
    const node = getTimelineNode(db, state.grading.gradingNodeId);
    return {
      kind: "grading",
      suggested: state.grading.suggested,
      reasoning: node ? extractReasoning(node) : null,
      nodeId: state.grading.gradingNodeId,
    };
  }
  if (state.dispatch?.status === "awaiting_confirmation") {
    const node = getTimelineNode(db, state.dispatch.planNodeId);
    return {
      kind: "dispatch",
      dispatchKind: state.dispatch.kind,
      proposedTasks: state.dispatch.proposedTasks,
      reasoning: node ? extractReasoning(node) : null,
      nodeId: state.dispatch.planNodeId,
    };
  }
  if (state.notification?.status === "awaiting_confirmation") {
    const drafts = listNotificationsByDrill(db, drill.id)
      .filter((n) => n.status === "pending_confirmation")
      .map(toNotificationDTO);
    return { kind: "notification", drafts, nodeId: state.notification.nodeId ?? null };
  }
  return null;
}

function extractReasoning(node: TimelineNodeRow): string | null {
  try {
    const detail = JSON.parse(node.detail) as { reasoning?: unknown };
    return typeof detail.reasoning === "string" ? detail.reasoning : null;
  } catch {
    return null;
  }
}

/** 工作区消费的演练详情 */
export function buildDrillDetail(db: Db, drillId: string): DrillDetailDTO | null {
  const drill = getDrill(db, drillId);
  if (!drill) return null;
  const state = readRunState(db, drill.id);
  const eventRow = getEventByDrillId(db, drill.id);
  const timelineRows = listTimelineByDrill(db, drill.id);
  const taskRows = listTasksByDrill(db, drill.id);
  const finished = drill.status === "completed" || drill.status === "aborted";
  const reportRow = getReportByDrillId(db, drill.id);
  const signals = listSignalsByDrill(db, drill.id).map(toSignalDTO);
  attachSignalPerceptions(signals, timelineRows, eventRow?.signal_id ?? null);
  const notifications = listNotificationsByDrill(db, drill.id).map(toNotificationDTO);
  attachNotificationDetails(notifications, timelineRows);

  const event: DrillDetailDTO["event"] = eventRow
    ? {
        id: eventRow.id,
        type: eventRow.type,
        title: eventRow.title,
        location: eventRow.location,
        severity: (eventRow.severity as EventSeverity | null) ?? null,
        status: eventRow.status,
        detectedSimTime: eventRow.detected_sim_time,
      }
    : null;

  return {
    drill: {
      id: drill.id,
      name: drill.name,
      status: drill.status as DrillStatus,
      scenarioKey: drill.scenario_key as ScenarioKey,
      seed: drill.seed,
      score: drill.score,
      simClockLabel: clockLabel(drill),
      speed: JSON.parse(drill.clock_state).speed,
      autoConfirm: parseParamsAutoConfirm(drill),
      startedAt: drill.started_at,
      endedAt: drill.ended_at,
    },
    phase: state.phase,
    event,
    pendingConfirmation: buildPendingConfirmation(db, drill, state),
    timeline: timelineRows.map(toTimelineDTO),
    tasks: taskRows.map(toTaskDTO),
    notifications,
    signals,
    report: reportRow ? toReportDTO(reportRow) : null,
    agents: deriveAgentStatuses(state.phase, timelineRows, taskRows, finished),
    notificationRetryable: notifications.some((n) => n.status === "failed") && drill.status !== "aborted",
  };
}

/** 指挥台历史表格消费的演练列表(时间倒序;等级取关联事件) */
export function buildDrillHistory(db: Db): DrillHistoryItemDTO[] {
  return listDrills(db).map((row) => ({
    id: row.id,
    name: row.name,
    scenarioKey: row.scenario_key as DrillHistoryItemDTO["scenarioKey"],
    status: row.status as DrillHistoryItemDTO["status"],
    severity: (row.severity as EventSeverity | null) ?? null,
    score: row.score,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  }));
}

// —— 服务单例(runner 生命周期与 tick 循环) ——

interface DrillServiceState {
  runner: DrillRunner;
  modelLabel: string;
  offline: boolean;
  scenarioKey: ScenarioKey | null;
  tickTimer: ReturnType<typeof setInterval> | null;
  lastError: string | null;
}

const globalRef = globalThis as typeof globalThis & { __cewpDrillService?: DrillServiceState };

function buildModel(scenarioKey: ScenarioKey): { model: AgentChatModel; label: string; offline: boolean } {
  const apiKey = process.env.MODEL_API_KEY?.trim() || process.env.DEEPSEEK_API_KEY?.trim();
  if (apiKey) return { model: createProviderModel(), label: "真实模型", offline: false };
  return { model: new ScriptedModel(DEMO_SCRIPTS[scenarioKey]), label: "离线演示剧本", offline: true };
}

export function getDrillService(): DrillServiceState {
  if (!globalRef.__cewpDrillService) {
    const db = getDb();
    // 初始 runner 只用于接续已有演练(模型仅在 start 时按场景确定,离线模式下随场景重建)
    const boot = buildModel("fire_alarm");
    const runner = new DrillRunner({ db, model: boot.model });
    runner.recoverInterruptedDrills();
    globalRef.__cewpDrillService = {
      runner,
      modelLabel: boot.label,
      offline: boot.offline,
      scenarioKey: null,
      tickTimer: null,
      lastError: null,
    };
    const service = globalRef.__cewpDrillService;
    if (service.runner.status === "running") ensureTicking(service);
  }
  return globalRef.__cewpDrillService;
}

function stopTicking(service: DrillServiceState): void {
  if (service.tickTimer) {
    clearInterval(service.tickTimer);
    service.tickTimer = null;
  }
}

function ensureTicking(service: DrillServiceState): void {
  if (service.tickTimer) return;
  service.tickTimer = setInterval(() => {
    void (async () => {
      try {
        await service.runner.tick();
      } catch (error) {
        service.lastError = error instanceof Error ? error.message : String(error);
        stopTicking(service);
        return;
      }
      if (service.runner.status !== "running") stopTicking(service);
    })();
  }, TICK_INTERVAL_MS);
}

export interface DrillServiceApi {
  start(input: StartDrillInput): Promise<{ drillId: string }>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  abort(): Promise<void>;
  setSpeed(speed: number): Promise<void>;
  /** 重置:当前演练终止留痕,同配置同种子新开一场(running/paused/awaiting 均可) */
  restart(): Promise<{ drillId: string }>;
  confirmGrading(severity?: EventSeverity): Promise<{ severity: EventSeverity }>;
  confirmDispatch(tasks?: TaskPlanItem[]): Promise<{ dispatchedCount: number }>;
  confirmNotification(): Promise<{ published: number; failed: number }>;
  /** 失败通知重试(仅运行器绑定的演练;完成态亦可——⚑ 节点追加发布结果是设计内例外) */
  retryNotification(drillId: string): Promise<{ retried: number; published: number; failed: number }>;
  activeSummary(): DrillSummaryDTO | null;
  detail(drillId: string): DrillDetailDTO | null;
  history(): DrillHistoryItemDTO[];
  modelLabel: string;
  offline: boolean;
  lastError: string | null;
}

/** 动作门面:API 路由唯一入口(校验活跃演练归属后转发 runner) */
export function drillServiceApi(): DrillServiceApi {
  const service = getDrillService();
  const db = getDb();
  const wrap = {
    get modelLabel() {
      return service.modelLabel;
    },
    get offline() {
      return service.offline;
    },
    get lastError() {
      return service.lastError;
    },
    async start(input: StartDrillInput) {
      // 离线模式:剧本按场景绑定,场景变化时重建 runner(此刻必无活跃演练,start 会校验)
      if (service.offline && service.scenarioKey !== input.scenarioKey) {
        const built = buildModel(input.scenarioKey);
        service.runner = new DrillRunner({ db, model: built.model });
        service.scenarioKey = input.scenarioKey;
      }
      const result = await service.runner.start(input);
      service.scenarioKey = input.scenarioKey;
      ensureTicking(service);
      return result;
    },
    async pause() {
      await service.runner.pause();
      stopTicking(service);
    },
    async resume() {
      await service.runner.resume();
      ensureTicking(service);
    },
    async abort() {
      await service.runner.abort();
      stopTicking(service);
    },
    async setSpeed(speed: number) {
      // 调速不改变 running 状态,tick 循环无需启停
      await service.runner.setSpeed(speed);
    },
    async restart() {
      const active = getActiveDrills(db)[0];
      if (!active) throw new Error("没有可重置的演练");
      const input = buildRestartInput(active);
      await service.runner.abort();
      stopTicking(service);
      // abort 已留痕,start 失败时旧演练保持终止,操作员可回到发起页重新发起
      return wrap.start(input);
    },
    async confirmGrading(severity?: EventSeverity) {
      const result = await service.runner.confirmGrading(severity ? { severity } : {});
      ensureTicking(service);
      return result;
    },
    async confirmDispatch(tasks?: TaskPlanItem[]) {
      const result = await service.runner.confirmDispatch(tasks ? { tasks } : {});
      ensureTicking(service);
      return result;
    },
    async confirmNotification() {
      const result = await service.runner.confirmNotification();
      ensureTicking(service);
      return result;
    },
    async retryNotification(drillId: string) {
      // 归属校验:运行器只操作绑定演练(绑定在完成后仍保持,直至下一场 start),防止历史演练误触
      if (service.runner.drillId !== drillId) {
        throw new Error("只能重试当前运行器绑定的演练的通知");
      }
      return service.runner.retryNotification();
    },
    activeSummary() {
      const active = getActiveDrills(db)[0];
      return active ? buildDrillSummary(db, active) : null;
    },
    detail(drillId: string) {
      const detail = buildDrillDetail(db, drillId);
      // 重试能力收紧:运行器只操作绑定演练(服务重启后绑定丢失,历史回看只读)
      if (detail) {
        detail.notificationRetryable = detail.notificationRetryable && service.runner.drillId === drillId;
      }
      return detail;
    },
    history() {
      return buildDrillHistory(db);
    },
  };
  return wrap;
}
