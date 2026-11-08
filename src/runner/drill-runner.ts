// 进程内推演运行器(ADR 0001):tick 循环驱动模拟时钟与信号到期,每步落库
// 当前实现感知段、研判段与处置段:信号 → 感知上报 → 定级确认 → 任务方案确认 → 三角色并行处置
// (里程碑演变 + 重新调度评估) → 事件 controlled;处置段完成后自动暂停,等待通知发布接入(后续路线)

import {
  TaskPlanItemSchema,
  type DispatchInput,
  type GradingInput,
  type RedispatchInput,
} from "../agents/command";
import type { AgentChatModel } from "../agents/model";
import type { Db } from "../db/client";
import {
  getActiveDrills,
  getDrill,
  getEventByDrillId,
  getGraphRunByDrillId,
  getTimelineNode,
  insertDrill,
  insertSignal,
  insertTask,
  insertTimelineNode,
  listSignalsByDrill,
  listTasksByDrill,
  listTimelineByDrill,
  updateDrillClock,
  updateDrillStatus,
  updateEventGrading,
  updateEventStatus,
  updateTaskStatus,
  updateTimelineNodeDetail,
  upsertGraphRun,
} from "../db/queries";
import type { DrillRow, TaskRow, TimelineNodeRow } from "../db/types";
import {
  buildDispatchGraph,
  buildRedispatchGraph,
  type DispatchSnapshot,
} from "../graph/dispatch";
import { buildGradingGraph, type GradingSnapshot } from "../graph/grading";
import { buildHandlingGraph, emptyHandlingState, type HandlingState } from "../graph/handling";
import { buildPerceptionGraph, type PendingSignal } from "../graph/perception";
import {
  formatSimClock,
  pauseClock,
  resumeClock,
  startClock,
  simOffsetMs,
  simTimeIso,
  type ClockState,
} from "../simulation/clock";
import { generateEvolution, generateSignalScript, getScenario } from "../simulation/engine";
import type { ScenarioKey } from "../simulation/scenarios";
import { computeTaskOutcome, MAX_TASK_ATTEMPTS, type TaskPlanItem } from "../simulation/task-rules";
import {
  DRILL_TRANSITIONS,
  EVENT_TRANSITIONS,
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
  phase: "perception" | "grading" | "handling";
  eventId: string | null;
  processedSignalIds: string[];
  grading?: GradingSnapshot;
  /** 待确认的派发方案(初始方案或里程碑加派);确认后清除 */
  dispatch?: DispatchSnapshot;
  /** 处置段执行簿(里程碑/评估/任务排期) */
  handling?: HandlingState;
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

    // 段末:任务全部终态 + 事件已控制 + 里程碑全部写入 → 自动暂停等待通知发布(路线下一 ticket)
    if (allTerminal && eventStatus === "controlled" && handling.writtenMilestoneOffsets.length >= evolution.length) {
      this.writeHandlingState(drill.id, handling);
      this.pauseAtPhaseEnd(drill, clock, offsetMs, nowMs);
      return;
    }
    this.writeHandlingState(drill.id, handling);
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
  ): void {
    const node = insertTimelineNode(this.deps.db, {
      drill_id: drillId,
      event_id: eventId,
      phase: "handling",
      node_type: "status_change",
      title: content.title,
      detail: JSON.stringify(content.detail),
      actor: "drill_runner",
      sim_time: simTimeIso(simOriginMs, offsetMs),
      real_time: new Date(nowMs).toISOString(),
    });
    this.deps.onTimelineNode?.(node);
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

  /** 段末自动暂停:处置段完成,等待通知发布接入(路线下一 ticket) */
  private pauseAtPhaseEnd(drill: DrillRow, clock: ClockState, offsetMs: number, nowMs: number): void {
    const { db } = this.deps;
    const status = transition(DRILL_TRANSITIONS, drill.status as DrillStatus, "paused");
    updateDrillStatus(db, drill.id, status);
    updateDrillClock(db, drill.id, JSON.stringify(pauseClock(clock, nowMs)));
    const node = insertTimelineNode(db, {
      drill_id: drill.id,
      phase: "handling",
      node_type: "status_change",
      title: "处置阶段完成,演练自动暂停(等待通知发布接入)",
      detail: JSON.stringify({ from: drill.status, to: "paused", reason: "handling_phase_done" }),
      actor: "drill_runner",
      sim_time: simTimeIso(clock.simOrigin, offsetMs),
      real_time: new Date(nowMs).toISOString(),
    });
    this.deps.onTimelineNode?.(node);
    const state = this.readRunState(drill.id);
    upsertGraphRun(db, drill.id, status, JSON.stringify({ ...state, phase: "handling" }));
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
