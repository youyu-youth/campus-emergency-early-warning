// 进程内推演运行器(ADR 0001):tick 循环驱动模拟时钟与信号到期,每步落库
// 全链路:信号 → 感知上报 → 定级确认 → 任务方案确认 → 三角色并行处置(里程碑演变 + 重新调度评估)
// → 事件 controlled → 双受众通知确认发布(模拟送达) → 事件 closed → 复盘报告 + 规则评分 → 演练 completed

import {
  TaskPlanItemSchema,
  type DispatchInput,
  type GradingInput,
  type RedispatchInput,
} from "../agents/command";
import type { NotificationInput } from "../agents/notification";
import type { ReviewInput } from "../agents/review";
import type { AgentChatModel } from "../agents/model";
import type { Db } from "../db/client";
import {
  abortDrill,
  closeEvent,
  finishDrill,
  finishNotification,
  getActiveDrills,
  getAwaitingConfirmationDrillId,
  getDrill,
  getEventByDrillId,
  getLastTimelineActivityMs,
  getGraphRunByDrillId,
  getRunningDrill,
  getTimelineNode,
  insertDrill,
  insertSignal,
  insertTask,
  insertTimelineNode,
  listNotificationsByDrill,
  listSignalsByDrill,
  listTasksByDrill,
  listTimelineByDrill,
  updateDrillClock,
  updateDrillStatus,
  updateEventGrading,
  updateEventStatus,
  updateNotificationStatus,
  updateTaskStatus,
  updateTimelineNodeDetail,
  upsertGraphRun,
} from "../db/queries";
import type { DrillRow, NotificationRow, TaskRow, TimelineNodeRow } from "../db/types";
import {
  buildDispatchGraph,
  buildRedispatchGraph,
  type DispatchSnapshot,
} from "../graph/dispatch";
import { buildGradingGraph, type GradingSnapshot } from "../graph/grading";
import { buildHandlingGraph, emptyHandlingState, type HandlingState } from "../graph/handling";
import {
  buildNotificationGraph,
  type NotificationSnapshot,
  type PublishRecord,
} from "../graph/notification";
import { buildPerceptionGraph, type PendingSignal } from "../graph/perception";
import { buildReviewGraph, type ReviewSnapshot } from "../graph/review";
import {
  formatSimClock,
  pauseClock,
  resumeClock,
  setSpeed as setClockSpeed,
  startClock,
  simOffsetMs,
  simTimeIso,
  type ClockState,
} from "../simulation/clock";
import { generateEvolution, generateSignalScript, getScenario } from "../simulation/engine";
import type { ScenarioKey } from "../simulation/scenarios";
import {
  computeDelivery,
  MAX_PUBLISH_ATTEMPTS,
  type NotificationAudience,
} from "../simulation/delivery-rules";
import { computeScore, type DrillMetrics } from "../simulation/score-rules";
import { computeTaskOutcome, MAX_TASK_ATTEMPTS, type TaskPlanItem } from "../simulation/task-rules";
import {
  DRILL_TRANSITIONS,
  EVENT_TRANSITIONS,
  NOTIFICATION_TRANSITIONS,
  SEVERITY_LABELS,
  TASK_TRANSITIONS,
  transition,
  type AgentRole,
  type DrillStatus,
  type EventSeverity,
  type EventStatus,
} from "../simulation/state-machines";

export interface DrillRunnerDeps {
  db: Db;
  model: AgentChatModel;
  /** 真实时刻注入(测试注入固定序列,生产用 Date.now) */
  now?: () => number;
  /** 时间线节点落库后的回调(CLI 薄打印层订阅) */
  onTimelineNode?: (node: TimelineNodeRow) => void;
}

export interface StartDrillInput {
  scenarioKey: ScenarioKey;
  seed: number;
  /** 模拟时钟倍速(> 0),默认 1 */
  speed?: number;
  /** 覆盖场景默认参数(地点、强度等) */
  params?: Record<string, unknown>;
  /** 全自动模式:跳过关键节点人工确认(默认 false,对应场景配置的确认开关) */
  autoConfirm?: boolean;
}

/** graph_runs.state 的快照形状(运行器是唯一写入方,按 phase 演进) */
export interface DrillRunState {
  phase: "perception" | "grading" | "handling" | "notification" | "review";
  eventId: string | null;
  processedSignalIds: string[];
  grading?: GradingSnapshot;
  /** 待确认的派发方案(初始方案或里程碑加派);确认后清除 */
  dispatch?: DispatchSnapshot;
  /** 处置段执行簿(里程碑/评估/任务排期) */
  handling?: HandlingState;
  /** 通知段进度(草稿确认/发布尝试) */
  notification?: NotificationSnapshot;
  /** 复盘段进度(报告 id;写入即表示复盘图已完成) */
  review?: ReviewSnapshot;
}

export class DrillRunner {
  private drillIdValue: string | null = null;
  /** tick 防重入:上一步(含模型调用)未完成前不推进下一步 */
  private ticking = false;
  private perceptionGraph: ReturnType<typeof buildPerceptionGraph> | null = null;
  private gradingGraph: ReturnType<typeof buildGradingGraph> | null = null;
  private dispatchGraph: ReturnType<typeof buildDispatchGraph> | null = null;
  private redispatchGraph: ReturnType<typeof buildRedispatchGraph> | null = null;
  private handlingGraph: ReturnType<typeof buildHandlingGraph> | null = null;
  private notificationGraph: ReturnType<typeof buildNotificationGraph> | null = null;
  private reviewGraph: ReturnType<typeof buildReviewGraph> | null = null;

  constructor(private readonly deps: DrillRunnerDeps) {}

  get drillId(): string | null {
    return this.drillIdValue;
  }

  get status(): DrillStatus | null {
    if (!this.drillIdValue) return null;
    return (getDrill(this.deps.db, this.drillIdValue)?.status as DrillStatus) ?? null;
  }

  async start(input: StartDrillInput): Promise<{ drillId: string }> {
    const { db } = this.deps;
    const active = getActiveDrills(db);
    if (active.length > 0) {
      throw new Error(
        `同一时间至多一场运行中的演练:「${active[0].name}」(${active[0].id})正处于 ${active[0].status}`,
      );
    }
    const scenario = getScenario(input.scenarioKey);
    const nowMs = this.deps.now?.() ?? Date.now();
    const clock = startClock(simOriginFromStart(scenario.defaultSimStart, nowMs), nowMs, input.speed ?? 1);
    const drill = insertDrill(db, {
      scenario_key: input.scenarioKey,
      name: `${scenario.name}演练 · 种子 ${input.seed}`,
      seed: input.seed,
      params: JSON.stringify({ ...scenario.defaults, ...input.params, autoConfirm: input.autoConfirm ?? false }),
      status: "draft",
      clock_state: JSON.stringify(clock),
      started_at: new Date(nowMs).toISOString(),
    });
    const status = transition(DRILL_TRANSITIONS, "draft", "running");
    updateDrillStatus(db, drill.id, status);
    const initialSnapshot: DrillRunState = { phase: "perception", eventId: null, processedSignalIds: [] };
    upsertGraphRun(db, drill.id, status, JSON.stringify(initialSnapshot));
    this.drillIdValue = drill.id;
    return { drillId: drill.id };
  }

  /** 推进一步:把当前模拟时刻已到期的信号交给感知图处理;感知段完成后进入研判段定级 */
  async tick(): Promise<void> {
    if (this.ticking) return;
    const drill = this.current();
    if (!drill || drill.status !== "running") return;

    this.ticking = true;
    try {
      await this.step(drill);
    } finally {
      this.ticking = false;
    }
  }

  private async step(drill: DrillRow): Promise<void> {
    const { db } = this.deps;
    const clock = JSON.parse(drill.clock_state) as ClockState;
    const nowMs = this.deps.now?.() ?? Date.now();
    const offset = simOffsetMs(clock, nowMs);
    const scenarioKey = drill.scenario_key as ScenarioKey;
    const script = generateSignalScript(scenarioKey, drill.seed);
    const bySourceRef = new Map(script.map((s) => [s.sourceRef, s]));

    // 到期判定按 source_ref 去重(而非已写条数):进程中断遗留的 new 信号会重新交给感知图,不会被跳过
    const written = listSignalsByDrill(db, drill.id);
    const knownRefs = new Set(written.map((s) => s.source_ref));
    const pendingSignals: PendingSignal[] = written
      .filter((s) => s.status === "new")
      .flatMap((s) => {
        const scheduled = bySourceRef.get(s.source_ref);
        return scheduled ? [{ signalId: s.id, scheduled }] : [];
      });
    for (const scheduled of script) {
      if (scheduled.offsetMs <= offset && !knownRefs.has(scheduled.sourceRef)) {
        pendingSignals.push({
          signalId: insertSignal(db, {
            drill_id: drill.id,
            source_kind: scheduled.kind,
            source_ref: scheduled.sourceRef,
            location: scheduled.location,
            signal_type: scheduled.signalType,
            payload: JSON.stringify(scheduled.payload),
            confidence: scheduled.confidence,
            sim_time: simTimeIso(clock.simOrigin, scheduled.offsetMs),
          }).id,
          scheduled,
        });
      }
    }

    if (pendingSignals.length > 0) {
      this.perceptionGraph ??= buildPerceptionGraph({
        db,
        model: this.deps.model,
        now: this.deps.now ?? (() => Date.now()),
        onTimelineNode: this.deps.onTimelineNode,
      });
      const existingEvent = getEventByDrillId(db, drill.id);
      const priorState = this.readRunState(drill.id);
      const result = await this.perceptionGraph.invoke({
        drillId: drill.id,
        scenarioKey,
        simOriginMs: clock.simOrigin,
        offsetMs: offset,
        eventId: existingEvent?.id ?? null,
        pendingSignals,
        processedSignalIds: priorState.processedSignalIds,
      });
      upsertGraphRun(
        db,
        drill.id,
        "running",
        JSON.stringify({
          ...priorState,
          eventId: result.eventId,
          processedSignalIds: result.processedSignalIds,
        }),
      );
    }

    // 感知段完成 = 信号全部到期写入且均已完成感知上报(不能只看写入条数,模型调用可能仍在途)
    const signals = listSignalsByDrill(db, drill.id);
    const perceptionDone = signals.length >= script.length && signals.every((s) => s.status === "reported");
    if (perceptionDone) {
      await this.stepGrading(drill, clock, offset, nowMs);
      // 定级已落定(确认后或 auto 采纳)则同 tick 流入处置段
      const graded = this.readRunState(drill.id).grading?.status === "done";
      if (graded && this.current()?.status === "running") {
        await this.stepHandling(drill, clock, offset, nowMs);
      }
    }
  }

  /** 研判段:指挥调度智能体提出建议等级,按确认开关等待操作员或自动采纳;完成后段末暂停 */
  private async stepGrading(
    drill: DrillRow,
    clock: ClockState,
    offsetMs: number,
    nowMs: number,
  ): Promise<void> {
    const { db } = this.deps;
    const state = this.readRunState(drill.id);

    if (state.grading) {
      return; // awaiting:等待操作员;done:由 step() 流入处置段
    }

    const event = getEventByDrillId(db, drill.id);
    if (!event) return;
    const scenarioKey = drill.scenario_key as ScenarioKey;
    const scenario = getScenario(scenarioKey);
    const params = JSON.parse(drill.params) as {
      intensity?: GradingInput["intensity"];
      autoConfirm?: boolean;
    };
    const evidence = this.collectEvidence(drill.id);
    const input: GradingInput = {
      event: {
        type: event.type as GradingInput["event"]["type"],
        title: event.title,
        location: event.location,
        detectedSimTime: event.detected_sim_time ?? "",
      },
      scenarioKey,
      scenarioName: scenario.name,
      intensity: params.intensity ?? scenario.defaults.intensity,
      evidence,
      simTimeLabel: formatSimClock(offsetMs),
    };

    this.gradingGraph ??= buildGradingGraph({
      db,
      model: this.deps.model,
      now: this.deps.now ?? (() => Date.now()),
      onTimelineNode: this.deps.onTimelineNode,
    });
    const requiresConfirmation = !params.autoConfirm;
    const result = await this.gradingGraph.invoke({
      drillId: drill.id,
      scenarioKey,
      eventId: event.id,
      input,
      simOriginMs: clock.simOrigin,
      offsetMs,
      requiresConfirmation,
    });
    const grading = result.result!;

    if (requiresConfirmation) {
      // 进入定级节点:演练等待人工确认,模拟时钟同步停走(确认等待不限时)
      // 说明:确认暂停由运行器经演练状态机管理而非 LangGraph interrupt——数据库是唯一事实来源,确认可跨进程边界
      // 等待起点取模型返回后的真实时刻,确认耗时不含模型调用耗时
      const awaitingStartedAt = this.deps.now?.() ?? Date.now();
      const next: DrillRunState = {
        ...state,
        phase: "grading",
        grading: {
          suggested: grading.output.suggestedSeverity,
          source: grading.source,
          status: "awaiting_confirmation",
          gradingNodeId: result.gradingNodeId!,
          awaitedSinceRealMs: awaitingStartedAt,
        },
      };
      this.enterAwaitingConfirmation(drill, clock, nowMs, next);
      return;
    }

    // auto 模式:自动采纳建议,不暂停,直接推进(step() 会继续流入处置段)
    this.applyGrading(event, grading.output.suggestedSeverity);
    upsertGraphRun(
      db,
      drill.id,
      drill.status as DrillStatus,
      JSON.stringify({
        ...state,
        phase: "grading",
        grading: {
          suggested: grading.output.suggestedSeverity,
          source: grading.source,
          status: "done",
          final: grading.output.suggestedSeverity,
          gradingNodeId: result.gradingNodeId!,
        },
      }),
    );
  }

  /** 处置段:任务方案确认缝 → 三角色并行执行 → 里程碑演变与重新调度 → 事件 controlled → 段末暂停 */
  private async stepHandling(
    drill: DrillRow,
    clock: ClockState,
    offsetMs: number,
    nowMs: number,
  ): Promise<void> {
    const { db } = this.deps;
    const state = this.readRunState(drill.id);
    if (state.dispatch?.status === "awaiting_confirmation") return; // 等待操作员确认方案/加派
    const event = getEventByDrillId(db, drill.id);
    if (!event || !event.severity) return;

    const handling: HandlingState = state.handling ?? emptyHandlingState();

    // 首次进入处置段:产出任务方案并经确认缝
    const tasks = listTasksByDrill(db, drill.id);
    if (tasks.length === 0) {
      if (event.status === "graded") {
        await this.planDispatch(drill, event, state, clock, offsetMs, nowMs);
      }
      return;
    }

    // 任务已派发(确认后首 tick 或进程恢复):事件进入处置中
    let eventStatus = event.status as EventStatus;
    if (eventStatus === "graded") {
      eventStatus = transition(EVENT_TRANSITIONS, eventStatus, "handling");
      updateEventStatus(db, event.id, eventStatus);
      this.emitStatusChange(drill.id, event.id, clock.simOrigin, offsetMs, nowMs, {
        title: `任务派发:${tasks.length} 项任务进入执行,事件处置中`,
        detail: { from: "graded", to: "handling", taskCount: tasks.length },
      });
    }

    // 里程碑到期写入(规则驱动)并在处置中触发重新调度评估
    const scenarioKey = drill.scenario_key as ScenarioKey;
    const evolution = generateEvolution(scenarioKey, drill.seed);
    for (const evo of evolution) {
      if (evo.offsetMs > offsetMs) break;
      if (!handling.writtenMilestoneOffsets.includes(evo.offsetMs)) {
        handling.writtenMilestoneOffsets.push(evo.offsetMs);
        this.emitStatusChange(drill.id, event.id, clock.simOrigin, evo.offsetMs, nowMs, {
          title: `场景演变:${evo.milestone}`,
          detail: { milestone: evo.milestone, note: evo.note, offsetMs: evo.offsetMs, driver: "rule" },
        });
        this.writeHandlingState(drill.id, handling);
      }
      if (eventStatus === "handling" && !handling.evaluatedMilestoneOffsets.includes(evo.offsetMs)) {
        handling.evaluatedMilestoneOffsets.push(evo.offsetMs);
        this.writeHandlingState(drill.id, handling); // 评估前落库,防中断后重复评估
        const outcome = await this.evaluateRedispatch(drill, event, evo, clock, offsetMs, nowMs);
        if (outcome === "awaiting") return; // 进入加派确认缝
        // auto 加派:由调用方落到同一份执行簿上(避免快照双写互相覆盖)
        if (typeof outcome === "object") {
          this.insertScheduledTasks(drill, event.id, outcome.additionalTasks, handling, clock.simOrigin, offsetMs);
        }
      }
    }

    // 到期任务:Send 扇出并行执行(三角色各自汇合反馈)
    const executing = listTasksByDrill(db, drill.id).filter((t) => t.status === "executing");
    const due = executing.flatMap((t) => {
      const book = handling.tasks[t.id];
      if (!book || book.dueOffsetMs === undefined || book.dueOffsetMs > offsetMs) return [];
      return [{
        taskId: t.id,
        role: t.role as AgentRole,
        title: t.title,
        description: t.description,
        ordinal: book.ordinal,
        attempt: book.attempts,
        outcome: computeTaskOutcome(drill.seed, book.ordinal, book.attempts, t.role as AgentRole),
      }];
    });
    if (due.length > 0) {
      this.handlingGraph ??= buildHandlingGraph({
        db,
        model: this.deps.model,
        now: this.deps.now ?? (() => Date.now()),
        onTimelineNode: this.deps.onTimelineNode,
      });
      await this.handlingGraph.invoke({
        drillId: drill.id,
        eventId: event.id,
        eventTitle: event.title,
        location: event.location,
        severity: event.severity,
        simTimeLabel: formatSimClock(offsetMs),
        simOriginMs: clock.simOrigin,
        offsetMs,
        dueTasks: due,
      });
    }

    // 失败任务自动重试一次(重试失败为终态 failed)
    for (const t of listTasksByDrill(db, drill.id).filter((x) => x.status === "failed")) {
      const book = handling.tasks[t.id];
      if (book && book.attempts < MAX_TASK_ATTEMPTS) {
        const attempt = book.attempts + 1;
        const outcome = computeTaskOutcome(drill.seed, book.ordinal, attempt, t.role as AgentRole);
        updateTaskStatus(db, t.id, transition(TASK_TRANSITIONS, "failed", "executing"));
        handling.tasks[t.id] = { ...book, attempts: attempt, dueOffsetMs: offsetMs + outcome.durationMs };
      }
    }

    // 全部任务终态 → 事件已控制
    const finalTasks = listTasksByDrill(db, drill.id);
    const allTerminal =
      finalTasks.length > 0 && finalTasks.every((t) => t.status === "done" || t.status === "failed");
    if (allTerminal && eventStatus === "handling") {
      eventStatus = transition(EVENT_TRANSITIONS, eventStatus, "controlled");
      updateEventStatus(db, event.id, eventStatus);
      const done = finalTasks.filter((t) => t.status === "done").length;
      this.emitStatusChange(drill.id, event.id, clock.simOrigin, offsetMs, nowMs, {
        title: `全部任务终态,事件已控制(完成 ${done} / 失败 ${finalTasks.length - done})`,
        detail: { from: "handling", to: "controlled", done, failed: finalTasks.length - done },
      });
    }

    // 段末:任务全部终态 + 事件已控制(或已关闭 = 复盘收尾曾被中断) + 里程碑全部写入 → 流入通知段
    if (
      allTerminal &&
      (eventStatus === "controlled" || eventStatus === "closed") &&
      handling.writtenMilestoneOffsets.length >= evolution.length
    ) {
      this.writeHandlingState(drill.id, handling);
      await this.stepNotification(drill, clock, offsetMs, nowMs);
      return;
    }
    this.writeHandlingState(drill.id, handling);
  }

  /** 通知段:双受众草稿生成 → 第三个确认点 → 模拟发布与送达统计 → 段末暂停等待复盘 */
  private async stepNotification(
    drill: DrillRow,
    clock: ClockState,
    offsetMs: number,
    nowMs: number,
  ): Promise<void> {
    const { db } = this.deps;
    const state = this.readRunState(drill.id);
    if (state.notification?.status === "awaiting_confirmation") return; // 等待操作员确认发布
    const event = getEventByDrillId(db, drill.id);
    if (!event || !event.severity) return;
    const rows = listNotificationsByDrill(db, drill.id);

    if (rows.length === 0) {
      await this.draftNotifications(drill, event, clock, offsetMs, nowMs, []);
      return;
    }
    if (!state.notification) {
      // 中断恢复:草稿已落库但快照未写入(图完成与快照落库之间崩溃)——按既有行重建
      await this.draftNotifications(drill, event, clock, offsetMs, nowMs, rows);
      return;
    }

    // 草稿已生成并发布(操作员确认后或 auto):全部终态则流入复盘段收尾
    const snapshot = state.notification;
    if (rows.every((r) => r.status === "published_sim" || r.status === "failed")) {
      snapshot.status = "done";
      this.writeNotificationState(drill.id, snapshot);
      await this.stepReview(drill, clock, offsetMs, nowMs);
    }
  }

  /** 生成双受众草稿:经确认缝等待发布,或 auto 直接发布(失败自动重试一次);
   *  existing 非空 = 中断恢复,既有 ⚑ 节点直接复用、缺失受众补齐(图幂等) */
  private async draftNotifications(
    drill: DrillRow,
    event: NonNullable<ReturnType<typeof getEventByDrillId>>,
    clock: ClockState,
    offsetMs: number,
    nowMs: number,
    existing: NotificationRow[],
  ): Promise<void> {
    const { db } = this.deps;
    const scenarioKey = drill.scenario_key as ScenarioKey;
    const scenario = getScenario(scenarioKey);
    const requiresConfirmation = !JSON.parse(drill.params).autoConfirm;

    // 恢复路径:⚑ 节点已写而快照丢失 → 不重复建节点,直接从节点重建
    const priorNode = existing.length > 0
      ? listTimelineByDrill(db, drill.id).find((n) => n.node_type === "notification")
      : undefined;
    let nodeId = priorNode?.id;

    if (!priorNode) {
      const input: Omit<NotificationInput, "audience"> = {
        event: {
          type: event.type as NotificationInput["event"]["type"],
          title: event.title,
          location: event.location,
        },
        scenarioKey,
        scenarioName: scenario.name,
        severity: event.severity as EventSeverity,
        simTimeLabel: formatSimClock(offsetMs),
      };
      this.notificationGraph ??= buildNotificationGraph({
        db,
        model: this.deps.model,
        now: this.deps.now ?? (() => Date.now()),
        onTimelineNode: this.deps.onTimelineNode,
      });
      const result = await this.notificationGraph.invoke({
        drillId: drill.id,
        eventId: event.id,
        input,
        existing,
        simOriginMs: clock.simOrigin,
        offsetMs,
        requiresConfirmation,
      });
      nodeId = result.nodeId!;
    }

    const snapshot: NotificationSnapshot = {
      status: "awaiting_confirmation",
      nodeId: nodeId!,
      // 中断恢复时尝试计数从 ⚑ 节点的发布记录重建,避免多计一次重试
      attempts: priorNode ? this.countPublishAttempts(db, nodeId!) : {},
    };

    if (requiresConfirmation) {
      // 进入通知确认点:演练等待人工确认,模拟时钟同步停走
      snapshot.awaitedSinceRealMs = this.deps.now?.() ?? Date.now();
      this.enterAwaitingConfirmation(drill, clock, nowMs, {
        ...this.readRunState(drill.id),
        phase: "notification",
        notification: snapshot,
      });
      return;
    }

    // auto 模式:直接发布(失败自动重试一次);全部终态则流入复盘段收尾
    this.publishNotifications(drill, snapshot, clock.simOrigin, offsetMs, true);
    if (listNotificationsByDrill(db, drill.id).every((r) => r.status === "published_sim" || r.status === "failed")) {
      snapshot.status = "done";
      this.writeNotificationState(drill.id, snapshot);
      await this.stepReview(drill, clock, offsetMs, nowMs);
    }
  }

  /** 从 ⚑ 通知节点的发布记录重建各受众已消耗的尝试次数(中断恢复用) */
  private countPublishAttempts(db: Db, nodeId: string): Record<string, number> {
    const node = getTimelineNode(db, nodeId);
    if (!node) return {};
    const publishes = (JSON.parse(node.detail).publishes ?? []) as Array<{ audience: string; attempt: number }>;
    const attempts: Record<string, number> = {};
    for (const p of publishes) {
      attempts[p.audience] = Math.max(attempts[p.audience] ?? 0, p.attempt);
    }
    return attempts;
  }

  /** 发布所有待确认通知(送达统计由规则按种子计算,结果追加 ⚑ 节点);autoRetry 时失败自动重试一次 */
  private publishNotifications(
    drill: DrillRow,
    snapshot: NotificationSnapshot,
    simOriginMs: number,
    offsetMs: number,
    autoRetry: boolean,
  ): void {
    const { db } = this.deps;
    const simTime = simTimeIso(simOriginMs, offsetMs);
    const results: PublishRecord[] = [];

    for (const row of listNotificationsByDrill(db, drill.id)) {
      if (row.status !== "pending_confirmation") continue;
      const attempt = (snapshot.attempts[row.audience] ?? 0) + 1;
      const ok = this.publishOneNotification(drill, row, attempt, snapshot, results, simTime);
      if (!ok && autoRetry && attempt < MAX_PUBLISH_ATTEMPTS) {
        this.republishNotification(drill, row, attempt + 1, snapshot, results, simTime);
      }
    }

    if (results.length > 0) {
      this.appendNotificationPublishes(db, snapshot.nodeId, results);
    }
  }

  /** 重试一条失败通知:failed → pending_confirmation → 再次发布 */
  private republishNotification(
    drill: DrillRow,
    row: NotificationRow,
    attempt: number,
    snapshot: NotificationSnapshot,
    results: PublishRecord[],
    simTime: string,
  ): boolean {
    updateNotificationStatus(
      this.deps.db,
      row.id,
      transition(NOTIFICATION_TRANSITIONS, "failed", "pending_confirmation"),
    );
    return this.publishOneNotification(
      drill,
      { ...row, status: "pending_confirmation" },
      attempt,
      snapshot,
      results,
      simTime,
    );
  }

  /** 发布单条通知:pending_confirmation → published_sim | failed,统计与尝试次数落库(失败不记发布时刻) */
  private publishOneNotification(
    drill: DrillRow,
    row: NotificationRow,
    attempt: number,
    snapshot: NotificationSnapshot,
    results: PublishRecord[],
    simTime: string,
  ): boolean {
    const outcome = computeDelivery(drill.seed, row.audience as NotificationAudience, attempt);
    const target: "published_sim" | "failed" = outcome.ok ? "published_sim" : "failed";
    const status = transition(NOTIFICATION_TRANSITIONS, "pending_confirmation", target);
    finishNotification(
      this.deps.db,
      row.id,
      status,
      JSON.stringify({ ...outcome.stats, channelOk: outcome.ok, attempt }),
      outcome.ok ? simTime : null,
    );
    snapshot.attempts[row.audience] = attempt;
    results.push({
      audience: row.audience as NotificationAudience,
      attempt,
      status: target,
      stats: outcome.stats,
      publishedSimTime: outcome.ok ? simTime : null,
    });
    return outcome.ok;
  }

  /** 操作员确认发布通知:双受众模拟发布、记录 operator_action 与 ⚑ 节点确认信息,恢复推演 */
  async confirmNotification(): Promise<{ published: number; failed: number }> {
    const { db } = this.deps;
    const drill = this.current();
    if (!drill) throw new Error("尚未发起演练,无可确认的通知");
    if (drill.status !== "awaiting_confirmation") {
      throw new Error(`当前演练状态为 ${drill.status},没有等待确认的通知`);
    }
    const state = this.readRunState(drill.id);
    const notification = state.notification;
    if (!notification || notification.status !== "awaiting_confirmation") {
      throw new Error("没有等待确认的通知");
    }

    const nowMs = this.deps.now?.() ?? Date.now();
    const waitedMs = nowMs - (notification.awaitedSinceRealMs ?? nowMs);
    const confirmedRealTime = new Date(nowMs).toISOString();
    const clock = JSON.parse(drill.clock_state) as ClockState;
    const offsetMs = simOffsetMs(clock, nowMs);

    // 发布(送达统计由规则计算,失败不重试,由操作员决定是否经 retryNotification 重试)
    this.publishNotifications(drill, notification, clock.simOrigin, offsetMs, false);
    const rows = listNotificationsByDrill(db, drill.id);
    const published = rows.filter((r) => r.status === "published_sim").length;
    const failed = rows.filter((r) => r.status === "failed").length;

    // ⚑ 通知节点追加确认信息
    const node = getTimelineNode(db, notification.nodeId);
    if (node) {
      updateTimelineNodeDetail(
        db,
        notification.nodeId,
        JSON.stringify({
          ...JSON.parse(node.detail),
          confirmation: { action: "confirm", waitedMs, confirmedRealTime },
        }),
      );
    }

    // 操作员动作留痕
    const operatorNode = insertTimelineNode(db, {
      drill_id: drill.id,
      event_id: state.eventId,
      phase: "notification",
      node_type: "operator_action",
      title: `操作员确认发布通知:${rows.length} 份(发布 ${published} / 失败 ${failed},等待 ${Math.round(waitedMs / 1000)}s)`,
      detail: JSON.stringify({ action: "confirm", published, failed, waitedMs }),
      actor: "operator",
      sim_time: simTimeIso(clock.simOrigin, offsetMs),
      real_time: confirmedRealTime,
    });
    this.deps.onTimelineNode?.(operatorNode);

    // 恢复模拟时钟与演练状态
    updateDrillClock(db, drill.id, JSON.stringify(resumeClock(clock, nowMs)));
    const status = transition(DRILL_TRANSITIONS, "awaiting_confirmation", "running");
    updateDrillStatus(db, drill.id, status);
    this.writeNotificationState(drill.id, { ...notification, status: "done" });
    return { published, failed };
  }

  /** 重试失败的模拟分发(每份通知最多重试一次):结果追加 ⚑ 节点,不改变演练状态 */
  async retryNotification(): Promise<{ retried: number; published: number; failed: number }> {
    const { db } = this.deps;
    const drill = this.current();
    if (!drill) throw new Error("尚未发起演练,无可重试的通知");
    const state = this.readRunState(drill.id);
    const notification = state.notification;
    if (!notification) throw new Error("没有可重试的通知");

    const failedRows = listNotificationsByDrill(db, drill.id).filter((r) => r.status === "failed");
    if (failedRows.length === 0) throw new Error("没有失败的通知可重试");

    const nowMs = this.deps.now?.() ?? Date.now();
    const clock = JSON.parse(drill.clock_state) as ClockState;
    const offsetMs = simOffsetMs(clock, nowMs);
    const simTime = simTimeIso(clock.simOrigin, offsetMs);
    const results: PublishRecord[] = [];

    for (const row of failedRows) {
      const attempt = (notification.attempts[row.audience] ?? 0) + 1;
      if (attempt > MAX_PUBLISH_ATTEMPTS) continue; // 已达重试上限,保持终态 failed
      this.republishNotification(drill, row, attempt, notification, results, simTime);
    }

    if (results.length === 0) throw new Error("失败的通知均已达到重试上限");
    this.appendNotificationPublishes(db, notification.nodeId, results);
    this.writeNotificationState(drill.id, notification);
    const rows = listNotificationsByDrill(db, drill.id);
    return {
      retried: results.length,
      published: rows.filter((r) => r.status === "published_sim").length,
      failed: rows.filter((r) => r.status === "failed").length,
    };
  }

  /** ⚑ 通知节点追加发布结果(发布时刻与送达统计) */
  private appendNotificationPublishes(db: Db, nodeId: string, results: PublishRecord[]): void {
    const node = getTimelineNode(db, nodeId);
    if (!node) return;
    const detail = JSON.parse(node.detail) as { publishes?: PublishRecord[] };
    updateTimelineNodeDetail(
      db,
      nodeId,
      JSON.stringify({ ...detail, publishes: [...(detail.publishes ?? []), ...results] }),
    );
  }

  // —— 操作员控制(暂停/恢复/调速/终止) ——

  /** 操作员暂停:演练转 paused、模拟时钟同步停走;确认点本身已停走,无需叠加暂停 */
  async pause(): Promise<void> {
    const drill = this.current();
    if (!drill) throw new Error("尚未发起演练,无可暂停的推演");
    if (drill.status !== "running") {
      throw new Error(`当前演练状态为 ${drill.status},只有运行中的演练可以暂停`);
    }
    const nowMs = this.deps.now?.() ?? Date.now();
    const clock = JSON.parse(drill.clock_state) as ClockState;
    const status = transition(DRILL_TRANSITIONS, "running", "paused");
    updateDrillStatus(this.deps.db, drill.id, status);
    updateDrillClock(this.deps.db, drill.id, JSON.stringify(pauseClock(clock, nowMs)));
  }

  /** 操作员恢复:paused → running,模拟时钟从冻结点续算 */
  async resume(): Promise<void> {
    const drill = this.current();
    if (!drill) throw new Error("尚未发起演练,无可恢复的推演");
    if (drill.status !== "paused") {
      throw new Error(`当前演练状态为 ${drill.status},只有暂停中的演练可以恢复`);
    }
    const nowMs = this.deps.now?.() ?? Date.now();
    const clock = JSON.parse(drill.clock_state) as ClockState;
    const status = transition(DRILL_TRANSITIONS, "paused", "running");
    updateDrillStatus(this.deps.db, drill.id, status);
    updateDrillClock(this.deps.db, drill.id, JSON.stringify(resumeClock(clock, nowMs)));
  }

  /** 操作员调速:运行中变速即时生效(当前段先结算进累计),已累计模拟时间不受影响 */
  async setSpeed(speed: number): Promise<void> {
    if (!(speed > 0)) throw new Error(`倍速必须大于 0,收到 ${speed}`);
    const drill = this.current();
    if (!drill) throw new Error("尚未发起演练,无可调速的推演");
    if (drill.status === "completed" || drill.status === "aborted") {
      throw new Error(`当前演练状态为 ${drill.status},已终止的演练不能调速`);
    }
    const nowMs = this.deps.now?.() ?? Date.now();
    const clock = JSON.parse(drill.clock_state) as ClockState;
    updateDrillClock(this.deps.db, drill.id, JSON.stringify(setClockSpeed(clock, nowMs, speed)));
  }

  /** 操作员终止(二次确认由调用方负责):进入 aborted 终态,时钟停走,落库数据完整保留 */
  async abort(): Promise<void> {
    const { db } = this.deps;
    const drill = this.current();
    if (!drill) throw new Error("尚未发起演练,无可终止的推演");
    if (drill.status === "completed" || drill.status === "aborted") {
      throw new Error(`当前演练状态为 ${drill.status},已结束的演练不能再终止`);
    }
    const nowMs = this.deps.now?.() ?? Date.now();
    const clock = JSON.parse(drill.clock_state) as ClockState;
    const frozen = clock.running ? pauseClock(clock, nowMs) : clock;
    if (clock.running) {
      updateDrillClock(db, drill.id, JSON.stringify(frozen));
    }
    const state = this.readRunState(drill.id);
    const status = transition(DRILL_TRANSITIONS, drill.status as DrillStatus, "aborted");
    updateDrillStatus(db, drill.id, status);
    abortDrill(db, drill.id, new Date(nowMs).toISOString());
    const node = insertTimelineNode(db, {
      drill_id: drill.id,
      event_id: state.eventId,
      phase: state.phase,
      node_type: "operator_action",
      title: `操作员终止演练(终态 aborted,落库数据完整保留)`,
      detail: JSON.stringify({ action: "abort", from: drill.status, to: "aborted" }),
      actor: "operator",
      sim_time: simTimeIso(frozen.simOrigin, simOffsetMs(frozen, nowMs)),
      real_time: new Date(nowMs).toISOString(),
    });
    this.deps.onTimelineNode?.(node);
  }

  /**
   * 重启恢复(spec 决策 12 / ADR 0001):进程启动时调用。
   * 原 running 演练恢复为 paused,时钟冻结在最后落库动作时刻(不丢已推进模拟时间,停机真实时间不计入);
   * 确认等待中(awaiting_confirmation)的演练时钟本已停走,保持原状直接接续(否则将无法恢复也无法新开)。
   * 接续的演练绑定到本实例,可继续 pause/resume/abort/confirm。返回接续的演练数(0 或 1)。
   */
  recoverInterruptedDrills(): number {
    const { db } = this.deps;
    const nowMs = this.deps.now?.() ?? Date.now();
    const interrupted = getRunningDrill(db);
    if (!interrupted) {
      // 无 running:若有确认等待中的演练,直接绑定接续(时钟已停,无需转态)
      const awaitingId = getAwaitingConfirmationDrillId(db);
      if (awaitingId) this.drillIdValue = awaitingId;
      return awaitingId ? 1 : 0;
    }

    const clock = JSON.parse(interrupted.clock_state) as ClockState;
    // 冻结点 = 最后落库动作的真实时刻(时间线最大 real_time),停机真实时间不计入
    const lastActivityMs = getLastTimelineActivityMs(db, interrupted.id) ?? clock.lastRealAt ?? nowMs;
    const frozen: ClockState = clock.running
      ? {
          ...clock,
          simElapsedMs:
            clock.simElapsedMs + Math.max(0, lastActivityMs - (clock.lastRealAt ?? lastActivityMs)) * clock.speed,
          running: false,
          lastRealAt: null,
        }
      : clock;
    const status = transition(DRILL_TRANSITIONS, "running", "paused");
    updateDrillStatus(db, interrupted.id, status);
    updateDrillClock(db, interrupted.id, JSON.stringify(frozen));
    const runState = this.readRunState(interrupted.id);
    const node = insertTimelineNode(db, {
      drill_id: interrupted.id,
      event_id: runState.eventId,
      phase: runState.phase,
      node_type: "status_change",
      title: `进程重启:演练自动恢复为暂停态(等待操作员手动恢复,模拟时钟从落库状态续算)`,
      detail: JSON.stringify({ from: "running", to: "paused", reason: "process_restart" }),
      actor: "drill_runner",
      sim_time: simTimeIso(frozen.simOrigin, frozen.simElapsedMs),
      real_time: new Date(nowMs).toISOString(),
    });
    this.deps.onTimelineNode?.(node);
    this.drillIdValue = interrupted.id;
    return 1;
  }

  private writeNotificationState(drillId: string, notification: NotificationSnapshot): void {
    const status = (getDrill(this.deps.db, drillId)?.status ?? "running") as string;
    upsertGraphRun(
      this.deps.db,
      drillId,
      status,
      JSON.stringify({ ...this.readRunState(drillId), phase: "notification", notification }),
    );
  }

  /** 首次派发:调度智能体产出任务方案,经确认缝或 auto 直接采纳 */
  private async planDispatch(
    drill: DrillRow,
    event: NonNullable<ReturnType<typeof getEventByDrillId>>,
    state: DrillRunState,
    clock: ClockState,
    offsetMs: number,
    nowMs: number,
  ): Promise<void> {
    const { db } = this.deps;
    const scenarioKey = drill.scenario_key as ScenarioKey;
    const scenario = getScenario(scenarioKey);
    const requiresConfirmation = !JSON.parse(drill.params).autoConfirm;
    const input: DispatchInput = {
      event: {
        type: event.type as DispatchInput["event"]["type"],
        title: event.title,
        location: event.location,
        detectedSimTime: event.detected_sim_time ?? "",
      },
      scenarioKey,
      scenarioName: scenario.name,
      severity: event.severity as EventSeverity,
      evidence: this.collectEvidence(drill.id),
      simTimeLabel: formatSimClock(offsetMs),
    };

    this.dispatchGraph ??= buildDispatchGraph({
      db,
      model: this.deps.model,
      now: this.deps.now ?? (() => Date.now()),
      onTimelineNode: this.deps.onTimelineNode,
    });
    const result = await this.dispatchGraph.invoke({
      drillId: drill.id,
      eventId: event.id,
      input,
      simOriginMs: clock.simOrigin,
      offsetMs,
      requiresConfirmation,
    });
    const plan = result.result!;

    if (requiresConfirmation) {
      // 进入方案确认点:演练等待人工确认,模拟时钟同步停走
      const awaitingStartedAt = this.deps.now?.() ?? Date.now();
      const next: DrillRunState = {
        ...this.readRunState(drill.id),
        dispatch: {
          kind: "initial",
          status: "awaiting_confirmation",
          planNodeId: result.planNodeId!,
          proposedTasks: plan.output.tasks,
          awaitedSinceRealMs: awaitingStartedAt,
        },
      };
      this.enterAwaitingConfirmation(drill, clock, nowMs, next);
      return;
    }

    // auto 模式:直接采纳方案并派发执行
    const handling = state.handling ?? emptyHandlingState();
    this.insertScheduledTasks(drill, event.id, plan.output.tasks, handling, clock.simOrigin, offsetMs);
    const eventStatus = transition(EVENT_TRANSITIONS, "graded", "handling");
    updateEventStatus(db, event.id, eventStatus);
    this.emitStatusChange(drill.id, event.id, clock.simOrigin, offsetMs, nowMs, {
      title: `任务派发:${plan.output.tasks.length} 项任务进入执行,事件处置中`,
      detail: { from: "graded", to: "handling", taskCount: plan.output.tasks.length, auto: true },
    });
    this.writeHandlingState(drill.id, handling);
  }

  /** 里程碑触发的重新调度评估:加派经确认缝,否则记录结论;auto 模式返回加派清单交调用方执行 */
  private async evaluateRedispatch(
    drill: DrillRow,
    event: NonNullable<ReturnType<typeof getEventByDrillId>>,
    evo: { offsetMs: number; milestone: string; note: string },
    clock: ClockState,
    offsetMs: number,
    nowMs: number,
  ): Promise<"none" | "awaiting" | { additionalTasks: TaskPlanItem[] }> {
    const { db } = this.deps;
    const scenarioKey = drill.scenario_key as ScenarioKey;
    const scenario = getScenario(scenarioKey);
    const requiresConfirmation = !JSON.parse(drill.params).autoConfirm;
    const input: RedispatchInput = {
      event: {
        type: event.type as RedispatchInput["event"]["type"],
        title: event.title,
        location: event.location,
        detectedSimTime: event.detected_sim_time ?? "",
      },
      scenarioKey,
      scenarioName: scenario.name,
      severity: event.severity as EventSeverity,
      milestone: {
        label: evo.milestone,
        note: evo.note,
        simTimeLabel: formatSimClock(evo.offsetMs),
      },
      currentTasks: listTasksByDrill(db, drill.id).map((t) => ({
        role: t.role as AgentRole,
        title: t.title,
        status: t.status,
      })),
      simTimeLabel: formatSimClock(offsetMs),
    };

    this.redispatchGraph ??= buildRedispatchGraph({
      db,
      model: this.deps.model,
      now: this.deps.now ?? (() => Date.now()),
      onTimelineNode: this.deps.onTimelineNode,
    });
    const result = await this.redispatchGraph.invoke({
      drillId: drill.id,
      eventId: event.id,
      input,
      simOriginMs: clock.simOrigin,
      offsetMs,
      requiresConfirmation,
    });
    const output = result.result!.output;
    const wantsAddition = output.needsRedispatch && output.additionalTasks.length > 0;
    if (!wantsAddition) return "none";

    if (requiresConfirmation) {
      // 加派建议经同一确认缝放行
      const awaitingStartedAt = this.deps.now?.() ?? Date.now();
      const next: DrillRunState = {
        ...this.readRunState(drill.id),
        dispatch: {
          kind: "redispatch",
          status: "awaiting_confirmation",
          planNodeId: result.nodeId!,
          proposedTasks: output.additionalTasks,
          awaitedSinceRealMs: awaitingStartedAt,
        },
      };
      this.enterAwaitingConfirmation(drill, clock, nowMs, next);
      return "awaiting";
    }

    // auto 模式:返回加派清单,由调用方落到统一执行簿
    return { additionalTasks: output.additionalTasks };
  }

  /** 任务落库并排定首次执行(到期偏移由规则计算);返回新任务行 */
  private insertScheduledTasks(
    drill: DrillRow,
    eventId: string,
    items: TaskPlanItem[],
    handling: HandlingState,
    simOriginMs: number,
    offsetMs: number,
  ): TaskRow[] {
    const { db } = this.deps;
    return items.map((item) => {
      const ordinal = Object.keys(handling.tasks).length;
      const outcome = computeTaskOutcome(drill.seed, ordinal, 1, item.role);
      const task = insertTask(db, {
        drill_id: drill.id,
        event_id: eventId,
        role: item.role,
        title: item.title,
        description: item.description,
        dispatched_sim_time: simTimeIso(simOriginMs, offsetMs),
      });
      updateTaskStatus(db, task.id, transition(TASK_TRANSITIONS, "pending_confirmation", "executing"));
      handling.tasks[task.id] = { ordinal, attempts: 1, dueOffsetMs: offsetMs + outcome.durationMs };
      return task;
    });
  }

  /** 操作员确认或调整任务方案/加派清单:落库执行、记录 operator_action 与 ⚑ 节点确认信息,恢复推演 */
  async confirmDispatch(input: { tasks?: TaskPlanItem[] }): Promise<{ dispatchedCount: number }> {
    const { db } = this.deps;
    const drill = this.current();
    if (!drill) throw new Error("尚未发起演练,无可确认的任务方案");
    if (drill.status !== "awaiting_confirmation") {
      throw new Error(`当前演练状态为 ${drill.status},没有等待确认的任务方案`);
    }
    const state = this.readRunState(drill.id);
    const dispatch = state.dispatch;
    if (!dispatch || dispatch.status !== "awaiting_confirmation") {
      throw new Error("没有等待确认的任务方案");
    }
    const event = getEventByDrillId(db, drill.id);
    if (!event) throw new Error("任务确认失败:事件不存在");

    const proposed = dispatch.proposedTasks;
    const final = input.tasks ?? proposed;
    for (const item of final) {
      const parsed = TaskPlanItemSchema.safeParse(item);
      if (!parsed.success) {
        throw new Error(`无效的任务条目:${JSON.stringify(item)}(需要 role/title/description,角色只能是 security/medical/logistics)`);
      }
    }
    if (dispatch.kind === "initial" && final.length === 0) {
      throw new Error("初始任务方案至少需要 1 项任务");
    }

    const nowMs = this.deps.now?.() ?? Date.now();
    const waitedMs = nowMs - (dispatch.awaitedSinceRealMs ?? nowMs);
    const confirmedRealTime = new Date(nowMs).toISOString();
    const action: "confirm" | "adjust" | "reject" =
      final.length === 0
        ? "reject"
        : input.tasks === undefined || JSON.stringify(input.tasks) === JSON.stringify(proposed)
          ? "confirm"
          : "adjust";

    // ⚑ 方案节点追加确认信息(确认耗时与最终清单)
    const planNode = getTimelineNode(db, dispatch.planNodeId);
    if (planNode) {
      updateTimelineNodeDetail(
        db,
        dispatch.planNodeId,
        JSON.stringify({
          ...JSON.parse(planNode.detail),
          confirmation: { action, finalTasks: final, waitedMs, confirmedRealTime },
        }),
      );
    }

    // 落库执行(时钟处于停走态,到期锚点取冻结的当前偏移)
    const clock = JSON.parse(drill.clock_state) as ClockState;
    const offsetMs = simOffsetMs(clock, nowMs);
    const handling = state.handling ?? emptyHandlingState();
    if (final.length > 0) {
      this.insertScheduledTasks(drill, event.id, final, handling, clock.simOrigin, offsetMs);
      if (dispatch.kind === "initial") {
        const eventStatus = transition(EVENT_TRANSITIONS, event.status as EventStatus, "handling");
        updateEventStatus(db, event.id, eventStatus);
        this.emitStatusChange(drill.id, event.id, clock.simOrigin, offsetMs, nowMs, {
          title: `任务派发:${final.length} 项任务进入执行,事件处置中`,
          detail: {
            from: event.status,
            to: "handling",
            taskCount: final.length,
            tasks: final,
            kind: dispatch.kind,
            action,
          },
        });
      }
    }

    // 操作员动作留痕
    const kindLabel = dispatch.kind === "initial" ? "任务方案" : "加派";
    const operatorTitle =
      action === "reject"
        ? `操作员拒绝${kindLabel}(等待 ${Math.round(waitedMs / 1000)}s)`
        : action === "confirm"
          ? `操作员确认${kindLabel}:${final.length} 项任务(等待 ${Math.round(waitedMs / 1000)}s)`
          : `操作员调整${kindLabel}:${final.length} 项(原建议 ${proposed.length} 项,等待 ${Math.round(waitedMs / 1000)}s)`;
    const operatorNode = insertTimelineNode(db, {
      drill_id: drill.id,
      event_id: event.id,
      phase: "handling",
      node_type: "operator_action",
      title: operatorTitle,
      detail: JSON.stringify({ action, kind: dispatch.kind, proposed, final, waitedMs }),
      actor: "operator",
      sim_time: simTimeIso(clock.simOrigin, offsetMs),
      real_time: confirmedRealTime,
    });
    this.deps.onTimelineNode?.(operatorNode);

    // 恢复模拟时钟与演练状态
    updateDrillClock(db, drill.id, JSON.stringify(resumeClock(clock, nowMs)));
    const status = transition(DRILL_TRANSITIONS, "awaiting_confirmation", "running");
    updateDrillStatus(db, drill.id, status);
    upsertGraphRun(
      db,
      drill.id,
      status,
      JSON.stringify({ ...state, phase: "handling", dispatch: undefined, handling }),
    );
    return { dispatchedCount: final.length };
  }

  /** 感知智能体提取的证据要点(从 signal 时间线节点汇总) */
  private collectEvidence(drillId: string): string[] {
    return listTimelineByDrill(this.deps.db, drillId)
      .filter((n) => n.node_type === "signal")
      .flatMap((n) => ((JSON.parse(n.detail).output?.evidence ?? []) as string[]));
  }

  private emitStatusChange(
    drillId: string,
    eventId: string,
    simOriginMs: number,
    offsetMs: number,
    nowMs: number,
    content: { title: string; detail: Record<string, unknown> },
    phase: "handling" | "review" = "handling",
  ): void {
    const node = insertTimelineNode(this.deps.db, {
      drill_id: drillId,
      event_id: eventId,
      phase,
      node_type: "status_change",
      title: content.title,
      detail: JSON.stringify(content.detail),
      actor: "drill_runner",
      sim_time: simTimeIso(simOriginMs, offsetMs),
      real_time: new Date(nowMs).toISOString(),
    });
    this.deps.onTimelineNode?.(node);
  }

  /** 演练模拟世界起点(从落库时钟状态读取) */
  private simOriginOf(drill: DrillRow): number {
    return (JSON.parse(drill.clock_state) as ClockState).simOrigin;
  }

  private writeHandlingState(drillId: string, handling: HandlingState): void {
    const status = (getDrill(this.deps.db, drillId)?.status ?? "running") as string;
    upsertGraphRun(
      this.deps.db,
      drillId,
      status,
      JSON.stringify({ ...this.readRunState(drillId), phase: "handling", handling }),
    );
  }

  /** 操作员确认或调整定级建议:落定等级、记录 operator_action 与 ⚑ 节点确认耗时,推演恢复 */
  async confirmGrading(input: { severity?: EventSeverity }): Promise<{ severity: EventSeverity }> {
    const { db } = this.deps;
    const drill = this.current();
    if (!drill) throw new Error("尚未发起演练,无可确认的定级建议");
    if (drill.status !== "awaiting_confirmation") {
      throw new Error(`当前演练状态为 ${drill.status},没有等待确认的定级建议`);
    }
    const state = this.readRunState(drill.id);
    const grading = state.grading;
    if (!grading || grading.status !== "awaiting_confirmation") {
      throw new Error("没有等待确认的定级建议");
    }
    const event = getEventByDrillId(db, drill.id);
    if (!event) throw new Error("定级确认失败:事件不存在");

    const nowMs = this.deps.now?.() ?? Date.now();
    if (input.severity && !(input.severity in SEVERITY_LABELS)) {
      throw new Error(`无效的事件等级:${input.severity}(只能是 I / II / III / IV)`);
    }
    const final = input.severity ?? grading.suggested;
    const action =
      input.severity === undefined || input.severity === grading.suggested ? "confirm" : "adjust";
    const waitedMs = nowMs - (grading.awaitedSinceRealMs ?? nowMs);
    const confirmedRealTime = new Date(nowMs).toISOString();

    this.applyGrading(event, final);

    // ⚑ 定级节点追加确认信息(确认耗时与最终等级)
    const gradingNode = getTimelineNode(db, grading.gradingNodeId);
    if (gradingNode) {
      updateTimelineNodeDetail(
        db,
        grading.gradingNodeId,
        JSON.stringify({
          ...JSON.parse(gradingNode.detail),
          confirmation: { action, final, waitedMs, confirmedRealTime },
        }),
      );
    }

    // 操作员动作留痕(operator_action 节点,审计流)
    const clock = JSON.parse(drill.clock_state) as ClockState;
    const operatorNode = insertTimelineNode(db, {
      drill_id: drill.id,
      event_id: event.id,
      phase: "grading",
      node_type: "operator_action",
      title:
        action === "confirm"
          ? `操作员确认定级:${SEVERITY_LABELS[final]}(等待 ${Math.round(waitedMs / 1000)}s)`
          : `操作员调整定级:${SEVERITY_LABELS[final]}(原建议 ${SEVERITY_LABELS[grading.suggested]})`,
      detail: JSON.stringify({ action, suggested: grading.suggested, final, waitedMs }),
      actor: "operator",
      sim_time: simTimeIso(clock.simOrigin, simOffsetMs(clock, nowMs)),
      real_time: confirmedRealTime,
    });
    this.deps.onTimelineNode?.(operatorNode);

    // 恢复模拟时钟与演练状态(确认等待不限时,时钟从停走时刻续算)
    updateDrillClock(db, drill.id, JSON.stringify(resumeClock(clock, nowMs)));
    const status = transition(DRILL_TRANSITIONS, "awaiting_confirmation", "running");
    updateDrillStatus(db, drill.id, status);
    upsertGraphRun(
      db,
      drill.id,
      status,
      JSON.stringify({ ...state, grading: { ...grading, status: "done", final } }),
    );
    return { severity: final };
  }

  /** 把最终等级落到事件上(reported → graded,经状态机校验) */
  private applyGrading(event: { id: string; status: string }, severity: EventSeverity): void {
    transition(EVENT_TRANSITIONS, event.status as EventStatus, "graded");
    updateEventGrading(this.deps.db, event.id, severity);
  }

  /** 复盘段收尾:事件 closed → 复盘报告(仅基于留存日志)→ 规则评分 → 演练 completed
   *  幂等:报告已落库时复盘图直接复用(不重复调模型);快照已写而收尾未完成则补齐收尾 */
  private async stepReview(
    drill: DrillRow,
    clock: ClockState,
    offsetMs: number,
    nowMs: number,
  ): Promise<void> {
    const { db } = this.deps;
    if (drill.status === "completed") return; // 已收尾(不可重入)

    const event = getEventByDrillId(db, drill.id);
    if (!event || !event.severity) return;

    // 事件关闭(controlled → closed,经状态机校验),记录关闭(模拟)时刻
    if (event.status === "controlled") {
      transition(EVENT_TRANSITIONS, event.status, "closed");
      closeEvent(db, event.id, simTimeIso(clock.simOrigin, offsetMs));
      this.emitStatusChange(drill.id, event.id, clock.simOrigin, offsetMs, nowMs, {
        title: "事件关闭,进入复盘评估",
        detail: { from: "controlled", to: "closed" },
      }, "review");
    }

    // 复盘报告:复盘图幂等(既有报告复用);指标从留存日志只读汇总
    const input = this.collectReviewInput(drill, event, offsetMs);
    this.reviewGraph ??= buildReviewGraph({
      db,
      model: this.deps.model,
      now: this.deps.now ?? (() => Date.now()),
      onTimelineNode: this.deps.onTimelineNode,
    });
    const { report } = (await this.reviewGraph.invoke({
      drillId: drill.id,
      input,
      simOriginMs: clock.simOrigin,
      offsetMs,
    })).result!;

    // 规则评分 + 演练终态 completed,模拟时钟停走(恢复路径中时钟可能已停,不重复暂停)
    const metrics = JSON.parse(report.metrics) as DrillMetrics;
    const score = computeScore(metrics);
    finishDrill(db, drill.id, score, new Date(nowMs).toISOString());
    const status = transition(DRILL_TRANSITIONS, drill.status as DrillStatus, "completed");
    updateDrillStatus(db, drill.id, status);
    if (clock.running) {
      updateDrillClock(db, drill.id, JSON.stringify(pauseClock(clock, nowMs)));
    }
    const doneNode = insertTimelineNode(db, {
      drill_id: drill.id,
      event_id: event.id,
      phase: "review",
      node_type: "status_change",
      title: `演练完成,总评分 ${score}(复盘报告 ${report.id})`,
      detail: JSON.stringify({ from: drill.status, to: "completed", score, reportId: report.id }),
      actor: "drill_runner",
      sim_time: simTimeIso(clock.simOrigin, offsetMs),
      real_time: new Date(nowMs).toISOString(),
    });
    this.deps.onTimelineNode?.(doneNode);
    upsertGraphRun(db, drill.id, status, JSON.stringify({
      ...this.readRunState(drill.id),
      phase: "review",
      review: { status: "done", reportId: report.id },
    }));
  }

  /** 从留存日志只读汇总复盘输入:指标条(规则)、时间线、任务结果、通知结果(复盘只基于事实) */
  private collectReviewInput(
    drill: DrillRow,
    event: NonNullable<ReturnType<typeof getEventByDrillId>>,
    offsetMs: number,
  ): ReviewInput {
    const { db } = this.deps;
    const scenarioKey = drill.scenario_key as ScenarioKey;
    const scenario = getScenario(scenarioKey);
    const nodes = listTimelineByDrill(db, drill.id);
    const tasks = listTasksByDrill(db, drill.id);

    // 时间指标(模拟毫秒,从留存节点推算:发现=首信号检测,上报=事件创建节点,定级=定级节点,关闭=当前)
    const firstSignal = nodes.find((n) => n.node_type === "signal");
    const gradingNode = nodes.find((n) => n.node_type === "grading");
    const detectedMs = Date.parse(event.detected_sim_time ?? "");
    const reportedMs = firstSignal ? Date.parse(firstSignal.sim_time) : detectedMs;
    const gradedMs = gradingNode ? Date.parse(gradingNode.sim_time) : reportedMs;
    const closedMs = Date.parse(simTimeIso(this.simOriginOf(drill), offsetMs));

    const resourceTotal = tasks.reduce((sum, t) => {
      if (!t.result) return sum;
      const resources = (JSON.parse(t.result).resources ?? {}) as Record<string, number>;
      return sum + Object.values(resources).reduce((a, b) => a + b, 0);
    }, 0);

    return {
      event: {
        type: event.type as ReviewInput["event"]["type"],
        title: event.title,
        location: event.location,
        severity: event.severity as ReviewInput["event"]["severity"],
        detectedSimTime: event.detected_sim_time ?? "",
      },
      scenarioKey,
      scenarioName: scenario.name,
      metrics: {
        totalDurationMs: Math.max(closedMs - detectedMs, 0),
        reportDurationMs: Math.max(reportedMs - detectedMs, 0),
        gradingDurationMs: Math.max(gradedMs - reportedMs, 0),
        taskDone: tasks.filter((t) => t.status === "done").length,
        taskTotal: tasks.length,
        resourceTotal,
      },
      timeline: nodes.map((n) => ({
        seq: n.seq,
        phase: n.phase,
        nodeType: n.node_type,
        title: n.title,
        simTimeLabel: n.sim_time,
      })),
      tasks: tasks.map((t) => {
        const result = t.result ? (JSON.parse(t.result) as { success: boolean | null; attempts: number }) : null;
        return {
          role: t.role,
          title: t.title,
          status: t.status,
          success: result?.success ?? null,
          attempts: result?.attempts ?? 0,
        };
      }),
      notifications: listNotificationsByDrill(db, drill.id).map((n) => {
        const delivery = n.delivery ? (JSON.parse(n.delivery) as { delivered?: number; total?: number }) : null;
        return {
          audience: n.audience as ReviewInput["notifications"][number]["audience"],
          title: n.title,
          status: n.status,
          delivered: delivery?.delivered ?? null,
          total: delivery?.total ?? null,
        };
      }),
      anomalyCount: nodes.filter((n) => n.node_type === "anomaly").length,
    };
  }

  /** 进入确认缝:演练转 awaiting_confirmation、模拟时钟同步停走、快照落库 */
  private enterAwaitingConfirmation(
    drill: DrillRow,
    clock: ClockState,
    nowMs: number,
    next: DrillRunState,
  ): void {
    const status = transition(DRILL_TRANSITIONS, drill.status as DrillStatus, "awaiting_confirmation");
    updateDrillStatus(this.deps.db, drill.id, status);
    updateDrillClock(this.deps.db, drill.id, JSON.stringify(pauseClock(clock, nowMs)));
    upsertGraphRun(this.deps.db, drill.id, status, JSON.stringify(next));
  }

  private readRunState(drillId: string): DrillRunState {
    const run = getGraphRunByDrillId(this.deps.db, drillId);
    return run
      ? (JSON.parse(run.state) as DrillRunState)
      : { phase: "perception", eventId: null, processedSignalIds: [] };
  }

  private current(): DrillRow | null {
    return this.drillIdValue ? (getDrill(this.deps.db, this.drillIdValue) ?? null) : null;
  }
}

/** 模拟世界起点:取真实时刻所在日 + 场景默认开始时刻(HH:mm,本地时区) */
function simOriginFromStart(defaultSimStart: string, realNowMs: number): number {
  const [hours, minutes] = defaultSimStart.split(":").map(Number);
  const d = new Date(realNowMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hours, minutes, 0, 0).getTime();
}
