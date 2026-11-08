// 进程内推演运行器(ADR 0001):tick 循环驱动模拟时钟与信号到期,每步落库
// 当前实现感知段与研判段:信号到期 → 感知图解读上报 → 定级节点(人工确认/auto 采纳);研判段完成后自动暂停,等待处置执行接入(后续路线)

import type { GradingInput } from "../agents/command";
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
  insertTimelineNode,
  listSignalsByDrill,
  listTimelineByDrill,
  updateDrillClock,
  updateDrillStatus,
  updateEventGrading,
  updateTimelineNodeDetail,
  upsertGraphRun,
} from "../db/queries";
import type { DrillRow, TimelineNodeRow } from "../db/types";
import { buildGradingGraph, type GradingSnapshot } from "../graph/grading";
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
import { generateSignalScript, getScenario } from "../simulation/engine";
import type { ScenarioKey } from "../simulation/scenarios";
import {
  DRILL_TRANSITIONS,
  EVENT_TRANSITIONS,
  SEVERITY_LABELS,
  transition,
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
  phase: "perception" | "grading";
  eventId: string | null;
  processedSignalIds: string[];
  grading?: GradingSnapshot;
}

export class DrillRunner {
  private drillIdValue: string | null = null;
  /** tick 防重入:上一步(含模型调用)未完成前不推进下一步 */
  private ticking = false;
  private perceptionGraph: ReturnType<typeof buildPerceptionGraph> | null = null;
  private gradingGraph: ReturnType<typeof buildGradingGraph> | null = null;

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
      if (state.grading.status === "done") {
        this.pauseAtPhaseEnd(drill, clock, offsetMs, nowMs);
      }
      return; // awaiting_confirmation:等待操作员经 confirmGrading 确认或调整
    }

    const event = getEventByDrillId(db, drill.id);
    if (!event) return;
    const scenarioKey = drill.scenario_key as ScenarioKey;
    const scenario = getScenario(scenarioKey);
    const params = JSON.parse(drill.params) as {
      intensity?: GradingInput["intensity"];
      autoConfirm?: boolean;
    };
    const evidence = listTimelineByDrill(db, drill.id)
      .filter((n) => n.node_type === "signal")
      .flatMap((n) => ((JSON.parse(n.detail).output?.evidence ?? []) as string[]));
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
      const status = transition(DRILL_TRANSITIONS, drill.status as DrillStatus, "awaiting_confirmation");
      updateDrillStatus(db, drill.id, status);
      updateDrillClock(db, drill.id, JSON.stringify(pauseClock(clock, nowMs)));
      upsertGraphRun(db, drill.id, status, JSON.stringify(next));
      return;
    }

    // auto 模式:自动采纳建议,不暂停,直接推进
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
    this.pauseAtPhaseEnd(drill, clock, offsetMs, nowMs);
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

  /** 段末自动暂停:研判段完成,等待处置执行接入(路线下一 ticket) */
  private pauseAtPhaseEnd(drill: DrillRow, clock: ClockState, offsetMs: number, nowMs: number): void {
    const { db } = this.deps;
    const status = transition(DRILL_TRANSITIONS, drill.status as DrillStatus, "paused");
    updateDrillStatus(db, drill.id, status);
    updateDrillClock(db, drill.id, JSON.stringify(pauseClock(clock, nowMs)));
    const node = insertTimelineNode(db, {
      drill_id: drill.id,
      phase: "grading",
      node_type: "status_change",
      title: "研判阶段完成,演练自动暂停(等待处置执行接入)",
      detail: JSON.stringify({ from: drill.status, to: "paused", reason: "grading_phase_done" }),
      actor: "drill_runner",
      sim_time: simTimeIso(clock.simOrigin, offsetMs),
      real_time: new Date(nowMs).toISOString(),
    });
    this.deps.onTimelineNode?.(node);
    const state = this.readRunState(drill.id);
    upsertGraphRun(db, drill.id, status, JSON.stringify({ ...state, phase: "grading" }));
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
