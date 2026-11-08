// LangGraph 定级图:指挥调度智能体基于事件证据研判等级,写入 ⚑ 定级节点
// 演练状态机流转与时钟停走/恢复由运行器负责;数据库是唯一事实来源

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { runGrading, type GradingInput, type GradingResult } from "../agents/command";
import type { AgentChatModel } from "../agents/model";
import type { Db } from "../db/client";
import { insertTimelineNode } from "../db/queries";
import type { TimelineNodeRow } from "../db/types";
import { simTimeIso } from "../simulation/clock";
import { getScenario } from "../simulation/engine";
import type { ScenarioKey } from "../simulation/scenarios";
import { SEVERITY_LABELS, type EventSeverity } from "../simulation/state-machines";

/** graph_runs.state 中研判段的定级进度(由运行器读写) */
export interface GradingSnapshot {
  suggested: EventSeverity;
  /** 建议来源:model | degraded(规则默认定级) */
  source: GradingResult["source"];
  status: "awaiting_confirmation" | "done";
  /** 操作员最终采纳的等级(auto 模式即建议值) */
  final?: EventSeverity;
  gradingNodeId: string;
  /** 进入等待确认的真实时刻(epoch 毫秒),用于计算确认耗时 */
  awaitedSinceRealMs?: number;
}

export const GradingGraphState = Annotation.Root({
  drillId: Annotation<string>,
  scenarioKey: Annotation<ScenarioKey>,
  eventId: Annotation<string>,
  /** 定级输入(事件摘要 + 证据要点,由运行器从时间线收集) */
  input: Annotation<GradingInput>,
  /** 模拟世界起点(epoch 毫秒) */
  simOriginMs: Annotation<number>,
  /** 当前模拟时间偏移(毫秒) */
  offsetMs: Annotation<number>,
  /** 是否需人工确认(决定 ⚑ 节点的 requires_confirmation) */
  requiresConfirmation: Annotation<boolean>,
  /** 本次定级结果(节点回填) */
  result: Annotation<GradingResult | null>({ reducer: (_, update) => update, default: () => null }),
  gradingNodeId: Annotation<string | null>({
    reducer: (_, update) => update ?? null,
    default: () => null,
  }),
});

export interface GradingGraphDeps {
  db: Db;
  model: AgentChatModel;
  now: () => number;
  onTimelineNode?: (node: TimelineNodeRow) => void;
}

export function buildGradingGraph(deps: GradingGraphDeps) {
  const { db, model, now } = deps;

  async function grade(state: typeof GradingGraphState.State) {
    const scenario = getScenario(state.scenarioKey);
    const result = await runGrading(model, state.input);
    const realTime = new Date(now()).toISOString();
    const simTime = simTimeIso(state.simOriginMs, state.offsetMs);
    const label = SEVERITY_LABELS[result.output.suggestedSeverity];

    const node = insertTimelineNode(db, {
      drill_id: state.drillId,
      event_id: state.eventId,
      phase: "grading",
      node_type: "grading",
      title: `研判定级建议:${label}${state.requiresConfirmation ? "(等待操作员确认)" : "(auto 模式自动采纳)"}`,
      detail: JSON.stringify({
        input: state.input,
        reasoning: result.output.reasoning,
        output: result.output,
        scenario: { key: scenario.key, name: scenario.name },
      }),
      actor: "command_agent",
      requires_confirmation: state.requiresConfirmation ? 1 : 0,
      sim_time: simTime,
      real_time: realTime,
    });
    deps.onTimelineNode?.(node);

    if (result.degraded) {
      const anomaly = insertTimelineNode(db, {
        drill_id: state.drillId,
        event_id: state.eventId,
        phase: "grading",
        node_type: "anomaly",
        title: `指挥调度智能体降级(${
          result.degraded.reason === "timeout" ? "模型超时" : "输出无效"
        }),按规则默认定级 ${label}`,
        detail: JSON.stringify({
          degraded: result.degraded,
          fallback: "重试一次仍失败,已按场景强度映射的规则默认等级继续研判",
        }),
        actor: "command_agent",
        sim_time: simTime,
        real_time: realTime,
      });
      deps.onTimelineNode?.(anomaly);
    }

    return { result, gradingNodeId: node.id };
  }

  return new StateGraph(GradingGraphState)
    .addNode("grade", grade)
    .addEdge(START, "grade")
    .addEdge("grade", END)
    .compile();
}
