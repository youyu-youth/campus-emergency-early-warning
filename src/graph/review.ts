// LangGraph 复盘图:事件关闭后,复盘评估智能体仅基于留存日志生成报告并落库
// 幂等:该演练已有报告时直接复用(不重复调模型),用于中断后的重建
// 指标与评分由规则计算;数据库是唯一事实来源

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { runReview, type ReviewInput } from "../agents/review";
import type { AgentChatModel } from "../agents/model";
import type { Db } from "../db/client";
import { getReportByDrillId, insertReport, insertTimelineNode } from "../db/queries";
import type { ReportRow, TimelineNodeRow } from "../db/types";
import { simTimeIso } from "../simulation/clock";

/** graph_runs.state 中复盘段进度(由运行器读写) */
export interface ReviewSnapshot {
  status: "done";
  /** 复盘报告 id */
  reportId: string;
}

export interface ReviewGraphResult {
  report: ReportRow;
}

export const ReviewGraphState = Annotation.Root({
  drillId: Annotation<string>,
  /** 留存日志汇总出的复盘输入(由运行器从数据库只读生成) */
  input: Annotation<ReviewInput>,
  simOriginMs: Annotation<number>,
  offsetMs: Annotation<number>,
  result: Annotation<ReviewGraphResult | null>({
    reducer: (_, update) => update ?? null,
    default: () => null,
  }),
});

export interface ReviewGraphDeps {
  db: Db;
  model: AgentChatModel;
  now: () => number;
  onTimelineNode?: (node: TimelineNodeRow) => void;
}

export function buildReviewGraph(deps: ReviewGraphDeps) {
  const { db, model, now } = deps;

  async function generate(state: typeof ReviewGraphState.State): Promise<{ result: ReviewGraphResult }> {
    // 幂等:已有报告直接复用(报告落库与快照写入之间崩溃后的重建)
    const existing = getReportByDrillId(db, state.drillId);
    if (existing) return { result: { report: existing } };

    const result = await runReview(model, state.input);
    // 落库前净化:模型引用的 nodeSeq 必须对应真实留存节点(可溯源硬保证)
    const knownSeqs = new Set(state.input.timeline.map((n) => n.seq));
    const timelineSummary = result.output.timelineSummary.filter((s) => knownSeqs.has(s.nodeSeq));
    const problems = result.output.problems.map((p) =>
      p.nodeSeq !== undefined && !knownSeqs.has(p.nodeSeq) ? { ...p, nodeSeq: undefined } : p,
    );
    const report = insertReport(db, {
      drill_id: state.drillId,
      timeline_summary: JSON.stringify(timelineSummary),
      metrics: JSON.stringify(state.input.metrics),
      problems: JSON.stringify(problems),
      improvements: JSON.stringify(result.output.improvements),
      source: result.source,
    });

    const realTime = new Date(now()).toISOString();
    // 报告生成记为状态推进节点(八类节点中无 report 类型,复用 notification 会与通知⚑节点语义冲突)
    const reportNode = insertTimelineNode(db, {
      drill_id: state.drillId,
      event_id: null,
      phase: "review",
      node_type: "status_change",
      title: `复盘报告生成:${timelineSummary.length} 条时间线归纳、${problems.length} 项问题、${result.output.improvements.length} 条建议(${
        result.source === "model" ? "模型生成" : "降级规则骨架"
      })`,
      detail: JSON.stringify({
        input: { metrics: state.input.metrics, anomalyCount: state.input.anomalyCount },
        reasoning: "复盘报告仅基于留存时间线与动作日志生成,指标与评分由规则计算",
        output: {
          reportId: report.id,
          summaryCount: timelineSummary.length,
          problemCount: problems.length,
          improvementCount: result.output.improvements.length,
          source: result.source,
        },
      }),
      actor: "review_agent",
      sim_time: simTimeIso(state.simOriginMs, state.offsetMs),
      real_time: realTime,
    });
    deps.onTimelineNode?.(reportNode);

    if (result.degraded) {
      const anomaly = insertTimelineNode(db, {
        drill_id: state.drillId,
        node_type: "anomaly",
        phase: "review",
        title: `复盘智能体降级(${
          result.degraded.reason === "timeout" ? "模型超时" : "输出无效"
        }),采用规则默认报告骨架`,
        detail: JSON.stringify({
          degraded: result.degraded,
          fallback: "重试一次仍失败,时间线归纳直接引用留存节点,问题由失败记录确定性推导",
        }),
        actor: "review_agent",
        sim_time: simTimeIso(state.simOriginMs, state.offsetMs),
        real_time: realTime,
      });
      deps.onTimelineNode?.(anomaly);
    }

    return { result: { report } };
  }

  return new StateGraph(ReviewGraphState)
    .addNode("generate", generate)
    .addEdge(START, "generate")
    .addEdge("generate", END)
    .compile();
}
