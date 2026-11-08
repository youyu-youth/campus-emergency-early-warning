// LangGraph 派发图:任务方案(plan)与里程碑重新调度评估(evaluate),由指挥调度智能体驱动
// 确认缝与状态机流转由运行器管理;数据库是唯一事实来源

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import {
  runDispatch,
  runDispatchEvaluation,
  type DispatchInput,
  type DispatchResult,
  type RedispatchInput,
  type RedispatchResult,
} from "../agents/command";
import type { AgentChatModel } from "../agents/model";
import type { DegradedInfo } from "../agents/model";
import type { Db } from "../db/client";
import { insertTimelineNode } from "../db/queries";
import type { TimelineNodeRow } from "../db/types";
import { simTimeIso } from "../simulation/clock";
import type { TaskPlanItem } from "../simulation/task-rules";

/** graph_runs.state 中待确认的派发方案(初始方案或里程碑加派,由运行器读写) */
export interface DispatchSnapshot {
  kind: "initial" | "redispatch";
  status: "awaiting_confirmation";
  planNodeId: string;
  /** 待操作员确认/调整的任务清单(全量提交语义) */
  proposedTasks: TaskPlanItem[];
  /** 进入等待确认的真实时刻(epoch 毫秒),用于计算确认耗时 */
  awaitedSinceRealMs: number;
}

// —— 任务方案图 ——

export const DispatchGraphState = Annotation.Root({
  drillId: Annotation<string>,
  eventId: Annotation<string>,
  input: Annotation<DispatchInput>,
  simOriginMs: Annotation<number>,
  offsetMs: Annotation<number>,
  requiresConfirmation: Annotation<boolean>,
  result: Annotation<DispatchResult | null>({ reducer: (_, update) => update, default: () => null }),
  planNodeId: Annotation<string | null>({ reducer: (_, update) => update ?? null, default: () => null }),
});

export interface DispatchGraphDeps {
  db: Db;
  model: AgentChatModel;
  now: () => number;
  onTimelineNode?: (node: TimelineNodeRow) => void;
}

export function buildDispatchGraph(deps: DispatchGraphDeps) {
  const { db, model, now } = deps;

  async function plan(state: typeof DispatchGraphState.State) {
    const result = await runDispatch(model, state.input);
    const realTime = new Date(now()).toISOString();
    const simTime = simTimeIso(state.simOriginMs, state.offsetMs);
    const node = insertTimelineNode(db, {
      drill_id: state.drillId,
      event_id: state.eventId,
      phase: "handling",
      node_type: "dispatch",
      title: `任务方案:${result.output.tasks.length} 项任务${
        state.requiresConfirmation ? "(等待操作员确认)" : "(auto 模式自动采纳)"
      }`,
      detail: JSON.stringify({
        input: state.input,
        reasoning: result.output.reasoning,
        output: result.output,
      }),
      actor: "command_agent",
      requires_confirmation: state.requiresConfirmation ? 1 : 0,
      sim_time: simTime,
      real_time: realTime,
    });
    deps.onTimelineNode?.(node);

    if (result.degraded) {
      const anomaly = insertCommandAnomaly(db, state.drillId, state.eventId, result.degraded, simTime, realTime, {
        action: "按场景默认方案派发",
        fallback: "重试一次仍失败,已采用场景内置三角色默认任务方案",
      });
      deps.onTimelineNode?.(anomaly);
    }

    return { result, planNodeId: node.id };
  }

  return new StateGraph(DispatchGraphState)
    .addNode("plan", plan)
    .addEdge(START, "plan")
    .addEdge("plan", END)
    .compile();
}

// —— 重新调度评估图 ——

export const RedispatchGraphState = Annotation.Root({
  drillId: Annotation<string>,
  eventId: Annotation<string>,
  input: Annotation<RedispatchInput>,
  simOriginMs: Annotation<number>,
  offsetMs: Annotation<number>,
  requiresConfirmation: Annotation<boolean>,
  result: Annotation<RedispatchResult | null>({ reducer: (_, update) => update, default: () => null }),
  /** 评估结论/加派建议节点 id */
  nodeId: Annotation<string | null>({ reducer: (_, update) => update ?? null, default: () => null }),
});

export function buildRedispatchGraph(deps: DispatchGraphDeps) {
  const { db, model, now } = deps;

  async function evaluate(state: typeof RedispatchGraphState.State) {
    const result = await runDispatchEvaluation(model, state.input);
    const realTime = new Date(now()).toISOString();
    const simTime = simTimeIso(state.simOriginMs, state.offsetMs);
    const wantsAddition = result.output.needsRedispatch && result.output.additionalTasks.length > 0;

    const node = insertTimelineNode(db, {
      drill_id: state.drillId,
      event_id: state.eventId,
      phase: "handling",
      node_type: "dispatch",
      title: wantsAddition
        ? `重新调度建议:加派 ${result.output.additionalTasks.length} 项任务(${
            state.requiresConfirmation ? "等待操作员确认" : "auto 模式自动采纳"
          })`
        : `重新调度评估:无需加派`,
      detail: JSON.stringify({
        input: state.input,
        reasoning: result.output.reasoning,
        output: result.output,
      }),
      actor: "command_agent",
      requires_confirmation: wantsAddition && state.requiresConfirmation ? 1 : 0,
      sim_time: simTime,
      real_time: realTime,
    });
    deps.onTimelineNode?.(node);

    if (result.degraded) {
      const anomaly = insertCommandAnomaly(db, state.drillId, state.eventId, result.degraded, simTime, realTime, {
        action: "重新调度评估采用保守结论",
        fallback: "重试一次仍失败,按规则保守结论维持当前任务方案",
      });
      deps.onTimelineNode?.(anomaly);
    }

    return { result, nodeId: node.id };
  }

  return new StateGraph(RedispatchGraphState)
    .addNode("evaluate", evaluate)
    .addEdge(START, "evaluate")
    .addEdge("evaluate", END)
    .compile();
}

/** 指挥调度智能体降级的 anomaly 节点(方案图与评估图共用) */
function insertCommandAnomaly(
  db: Db,
  drillId: string,
  eventId: string,
  degraded: DegradedInfo,
  simTime: string,
  realTime: string,
  context: { action: string; fallback: string },
): TimelineNodeRow {
  return insertTimelineNode(db, {
    drill_id: drillId,
    event_id: eventId,
    phase: "handling",
    node_type: "anomaly",
    title: `指挥调度智能体降级(${
      degraded.reason === "timeout" ? "模型超时" : "输出无效"
    }),${context.action}`,
    detail: JSON.stringify({ degraded, fallback: context.fallback }),
    actor: "command_agent",
    sim_time: simTime,
    real_time: realTime,
  });
}
