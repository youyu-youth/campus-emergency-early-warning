// LangGraph 感知图:解读到期信号并上报事件(首信号建事件,后续信号补充证据)
// 图状态快照由运行器写入 graph_runs;数据库是唯一事实来源,节点副作用只经 queries 落库

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { AgentChatModel } from "../agents/model";
import { runPerception } from "../agents/perception";
import type { Db } from "../db/client";
import { insertEvent, insertTimelineNode, updateSignalStatus } from "../db/queries";
import type { TimelineNodeRow } from "../db/types";
import type { ScheduledSignal } from "../simulation/engine";
import { formatSimClock, simTimeIso } from "../simulation/clock";
import { getScenario } from "../simulation/engine";
import type { ScenarioKey } from "../simulation/scenarios";

/** 已写入 signals 表、等待感知处理的到期信号 */
export interface PendingSignal {
  signalId: string;
  scheduled: ScheduledSignal;
}

export const PerceptionGraphState = Annotation.Root({
  drillId: Annotation<string>,
  scenarioKey: Annotation<ScenarioKey>,
  /** 模拟世界起点(epoch 毫秒),用于把信号偏移落为模拟时间 */
  simOriginMs: Annotation<number>,
  /** 单事件焦点:首信号创建事件后回填 */
  eventId: Annotation<string | null>({ reducer: (current, update) => update ?? current, default: () => null }),
  /** 本批到期信号(覆盖式) */
  pendingSignals: Annotation<PendingSignal[]>({ reducer: (_, update) => update, default: () => [] }),
  /** 已完成感知的信号(累积) */
  processedSignalIds: Annotation<string[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
});

export interface PerceptionGraphDeps {
  db: Db;
  model: AgentChatModel;
  now: () => number;
  onTimelineNode?: (node: TimelineNodeRow) => void;
}

export function buildPerceptionGraph(deps: PerceptionGraphDeps) {
  const { db, model, now } = deps;

  async function perceive(state: typeof PerceptionGraphState.State) {
    const scenario = getScenario(state.scenarioKey);
    let eventId = state.eventId;
    const processed: string[] = [];

    for (const pending of state.pendingSignals) {
      const isFirstSignal = eventId === null;
      const result = await runPerception(model, {
        signal: pending.scheduled,
        scenarioKey: state.scenarioKey,
        scenarioName: scenario.name,
        simTimeLabel: formatSimClock(pending.scheduled.offsetMs),
        isFirstSignal,
      });

      if (isFirstSignal) {
        const event = insertEvent(db, {
          drill_id: state.drillId,
          signal_id: pending.signalId,
          type: result.output.eventType,
          title: result.output.title,
          location: result.output.location,
          detected_sim_time: simTimeIso(state.simOriginMs, pending.scheduled.offsetMs),
        });
        eventId = event.id;
      }

      const emit = (node: TimelineNodeRow) => {
        deps.onTimelineNode?.(node);
        return node;
      };

      emit(
        insertTimelineNode(db, {
          drill_id: state.drillId,
          event_id: eventId,
          phase: "perception",
          node_type: "signal",
          title: isFirstSignal
            ? `感知上报:创建事件「${result.output.title}」`
            : `补充证据:${result.output.title}`,
          detail: JSON.stringify({
            input: { signal: pending.scheduled, signalId: pending.signalId },
            reasoning: result.output.reasoning,
            output: result.output,
          }),
          actor: "monitor_agent",
          sim_time: simTimeIso(state.simOriginMs, pending.scheduled.offsetMs),
          real_time: new Date(now()).toISOString(),
        }),
      );

      if (result.degraded) {
        emit(
          insertTimelineNode(db, {
            drill_id: state.drillId,
            event_id: eventId,
            phase: "perception",
            node_type: "anomaly",
            title: `感知智能体降级(${result.degraded.reason === "timeout" ? "模型超时" : "输出无效"})`,
            detail: JSON.stringify({
              degraded: result.degraded,
              signalId: pending.signalId,
              fallback: "重试一次仍失败,已按规则默认解读上报",
            }),
            actor: "monitor_agent",
            sim_time: simTimeIso(state.simOriginMs, pending.scheduled.offsetMs),
            real_time: new Date(now()).toISOString(),
          }),
        );
      }

      updateSignalStatus(db, pending.signalId, "reported");
      processed.push(pending.signalId);
    }

    return { eventId, processedSignalIds: processed };
  }

  return new StateGraph(PerceptionGraphState)
    .addNode("perceive", perceive)
    .addEdge(START, "perceive")
    .addEdge("perceive", END)
    .compile();
}
