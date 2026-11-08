// LangGraph 处置图:到期任务经 Send 动态扇出到 execute 节点(每任务一个并行分支),join 汇合
// 耗时/资源/成败由规则预先算好传入;模型只生成执行叙述;各分支独立降级,互不阻塞

import { Annotation, END, Send, START, StateGraph } from "@langchain/langgraph";
import { runHandling, type HandlingResult } from "../agents/handling";
import type { AgentChatModel } from "../agents/model";
import type { Db } from "../db/client";
import { completeTask, insertTimelineNode } from "../db/queries";
import type { TimelineNodeRow } from "../db/types";
import type { TaskOutcome } from "../simulation/task-rules";
import { simTimeIso } from "../simulation/clock";
import type { AgentRole } from "../simulation/state-machines";
import { ROLE_LABELS, TASK_TRANSITIONS, transition } from "../simulation/state-machines";

/** graph_runs.state 中处置段的执行簿(由运行器读写) */
export interface HandlingState {
  /** 已写入时间线的里程碑偏移(毫秒) */
  writtenMilestoneOffsets: number[];
  /** 已触发过重新调度评估的里程碑偏移(毫秒) */
  evaluatedMilestoneOffsets: number[];
  /** 任务执行簿:taskId → 序号(规则随机流入参)/ 已排定尝试数 / 当前尝试到期偏移 */
  tasks: Record<string, { ordinal: number; attempts: number; dueOffsetMs?: number }>;
}

export function emptyHandlingState(): HandlingState {
  return { writtenMilestoneOffsets: [], evaluatedMilestoneOffsets: [], tasks: {} };
}

/** 到期待执行的任务(运行器按规则算好结果,与图上下文打包送入并行分支) */
export interface DueTask {
  taskId: string;
  role: AgentRole;
  title: string;
  description: string;
  ordinal: number;
  attempt: number;
  outcome: TaskOutcome;
}

/** Send 分支的载荷:共享上下文 + 单个任务 */
interface ExecutePayload {
  drillId: string;
  eventId: string;
  eventTitle: string;
  location: string;
  severity: string;
  simTimeLabel: string;
  simOriginMs: number;
  offsetMs: number;
  task: DueTask;
}

export const HandlingGraphState = Annotation.Root({
  drillId: Annotation<string>,
  eventId: Annotation<string>,
  eventTitle: Annotation<string>,
  location: Annotation<string>,
  severity: Annotation<string>,
  simTimeLabel: Annotation<string>,
  simOriginMs: Annotation<number>,
  offsetMs: Annotation<number>,
  /** 本批到期任务(覆盖式),由条件边扇出 */
  dueTasks: Annotation<DueTask[]>({ reducer: (_, update) => update, default: () => [] }),
  /** 已汇合完成的任务(累积) */
  completedTaskIds: Annotation<string[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
});

export interface HandlingGraphDeps {
  db: Db;
  model: AgentChatModel;
  now: () => number;
  onTimelineNode?: (node: TimelineNodeRow) => void;
}

export function buildHandlingGraph(deps: HandlingGraphDeps) {
  const { db, model, now } = deps;

  function fanOut(state: typeof HandlingGraphState.State) {
    return state.dueTasks.map((task) => {
      const payload: ExecutePayload = {
        drillId: state.drillId,
        eventId: state.eventId,
        eventTitle: state.eventTitle,
        location: state.location,
        severity: state.severity,
        simTimeLabel: state.simTimeLabel,
        simOriginMs: state.simOriginMs,
        offsetMs: state.offsetMs,
        task,
      };
      return new Send("execute", payload);
    });
  }

  async function execute(input: ExecutePayload): Promise<{ completedTaskIds: string[] }> {
    const { task } = input;
    const narrative: HandlingResult = await runHandling(model, {
      role: task.role,
      taskTitle: task.title,
      taskDescription: task.description,
      eventTitle: input.eventTitle,
      location: input.location,
      severity: input.severity as "I" | "II" | "III" | "IV",
      simTimeLabel: input.simTimeLabel,
      outcome: { ...task.outcome, attempt: task.attempt },
    });
    const realTime = new Date(now()).toISOString();
    const completedSimTime = simTimeIso(input.simOriginMs, input.offsetMs);
    const seconds = Math.round(task.outcome.durationMs / 1000);

    const feedbackNode = insertTimelineNode(db, {
      drill_id: input.drillId,
      event_id: input.eventId,
      phase: "handling",
      node_type: "feedback",
      title: `[${ROLE_LABELS[task.role]}] ${task.title}:${task.outcome.success ? "完成" : "失败"}(耗时 ${seconds}s,第 ${task.attempt} 次)`,
      detail: JSON.stringify({
        input: { task, context: { eventTitle: input.eventTitle, severity: input.severity } },
        reasoning: narrative.output.narrative,
        output: {
          narrative: narrative.output.narrative,
          source: narrative.source,
          ...task.outcome,
          attempt: task.attempt,
        },
      }),
      actor: `${task.role}_agent`,
      sim_time: completedSimTime,
      real_time: realTime,
    });
    deps.onTimelineNode?.(feedbackNode);

    if (narrative.degraded) {
      const anomalyNode = insertTimelineNode(db, {
        drill_id: input.drillId,
        event_id: input.eventId,
        phase: "handling",
        node_type: "anomaly",
        title: `处置智能体降级(${ROLE_LABELS[task.role]} · ${
          narrative.degraded.reason === "timeout" ? "模型超时" : "输出无效"
        }),采用规则默认反馈`,
        detail: JSON.stringify({
          degraded: narrative.degraded,
          taskId: task.taskId,
          fallback: "重试一次仍失败,执行结果按规则记录,叙述用规则默认文案",
        }),
        actor: `${task.role}_agent`,
        sim_time: completedSimTime,
        real_time: realTime,
      });
      deps.onTimelineNode?.(anomalyNode);
    }

    // 任务状态机:executing → done | failed(终态结果整段落库)
    const status = transition(TASK_TRANSITIONS, "executing", task.outcome.success ? "done" : "failed");
    completeTask(
      db,
      task.taskId,
      status,
      JSON.stringify({
        attempts: task.attempt,
        success: task.outcome.success,
        durationMs: task.outcome.durationMs,
        resources: task.outcome.resources,
        narrative: narrative.output.narrative,
        source: narrative.source,
      }),
      completedSimTime,
    );

    return { completedTaskIds: [task.taskId] };
  }

  async function join(): Promise<Record<string, never>> {
    return {};
  }

  return new StateGraph(HandlingGraphState)
    .addNode("execute", execute)
    .addNode("join", join)
    .addConditionalEdges(START, fanOut, ["execute"])
    .addEdge("execute", "join")
    .addEdge("join", END)
    .compile();
}
