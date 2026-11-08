// 进程内推演运行器(ADR 0001):tick 循环驱动模拟时钟与信号到期,每步落库
// 当前实现感知段:信号到期 → 感知图解读上报;感知段完成后自动暂停,等待指挥调度接入(后续路线)

import type { AgentChatModel } from "../agents/model";
import type { Db } from "../db/client";
import {
  getActiveDrills,
  getDrill,
  getEventByDrillId,
  getGraphRunByDrillId,
  insertDrill,
  insertSignal,
  insertTimelineNode,
  listSignalsByDrill,
  updateDrillStatus,
  upsertGraphRun,
} from "../db/queries";
import type { DrillRow, TimelineNodeRow } from "../db/types";
import { buildPerceptionGraph, type PerceptionPhaseState, type PendingSignal } from "../graph/perception";
import { startClock, simOffsetMs, simTimeIso, type ClockState } from "../simulation/clock";
import { generateSignalScript, getScenario } from "../simulation/engine";
import type { ScenarioKey } from "../simulation/scenarios";
import { DRILL_TRANSITIONS, transition, type DrillStatus } from "../simulation/state-machines";

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
}

export class DrillRunner {
  private drillIdValue: string | null = null;
  /** tick 防重入:上一步(含模型调用)未完成前不推进下一步 */
  private ticking = false;
  private perceptionGraph: ReturnType<typeof buildPerceptionGraph> | null = null;

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
      params: JSON.stringify({ ...scenario.defaults, ...input.params }),
      status: "draft",
      clock_state: JSON.stringify(clock),
      started_at: new Date(nowMs).toISOString(),
    });
    const status = transition(DRILL_TRANSITIONS, "draft", "running");
    updateDrillStatus(db, drill.id, status);
    const initialSnapshot: PerceptionPhaseState = { phase: "perception", eventId: null, processedSignalIds: [] };
    upsertGraphRun(db, drill.id, status, JSON.stringify(initialSnapshot));
    this.drillIdValue = drill.id;
    return { drillId: drill.id };
  }

  /** 推进一步:把当前模拟时刻已到期的信号交给感知图处理;感知段完成则自动暂停 */
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
      const priorRun = getGraphRunByDrillId(db, drill.id);
      const priorProcessed: string[] = priorRun
        ? (JSON.parse(priorRun.state).processedSignalIds ?? [])
        : [];
      const result = await this.perceptionGraph.invoke({
        drillId: drill.id,
        scenarioKey,
        simOriginMs: clock.simOrigin,
        eventId: existingEvent?.id ?? null,
        pendingSignals,
        processedSignalIds: priorProcessed,
      });
      const snapshot: PerceptionPhaseState = {
        phase: "perception",
        eventId: result.eventId,
        processedSignalIds: result.processedSignalIds,
      };
      upsertGraphRun(db, drill.id, "running", JSON.stringify(snapshot));
    }

    // 感知段完成 = 信号全部到期写入且均已完成感知上报(不能只看写入条数,模型调用可能仍在途)
    const signals = listSignalsByDrill(db, drill.id);
    if (signals.length >= script.length && signals.every((s) => s.status === "reported")) {
      this.pauseAtPerceptionEnd(drill, simTimeIso(clock.simOrigin, offset), new Date(nowMs).toISOString());
    }
  }

  private pauseAtPerceptionEnd(drill: DrillRow, simTime: string, realTime: string): void {
    const { db } = this.deps;
    const status = transition(DRILL_TRANSITIONS, drill.status as DrillStatus, "paused");
    updateDrillStatus(db, drill.id, status);
    const node = insertTimelineNode(db, {
      drill_id: drill.id,
      phase: "perception",
      node_type: "status_change",
      title: "感知阶段完成,演练自动暂停(等待指挥调度接入)",
      detail: JSON.stringify({ from: drill.status, to: "paused", reason: "perception_phase_done" }),
      actor: "drill_runner",
      sim_time: simTime,
      real_time: realTime,
    });
    this.deps.onTimelineNode?.(node);
    const graphRun = getGraphRunByDrillId(db, drill.id);
    if (graphRun) {
      upsertGraphRun(db, drill.id, status, graphRun.state);
    }
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
