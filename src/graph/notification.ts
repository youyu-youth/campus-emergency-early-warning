// LangGraph 通知图:通知发布智能体为事件生成师生/家长两受众草稿并写入 ⚑ 通知节点
// 幂等:已落库的受众直接复用行内容(不重复调模型),用于中断后的补全重建
// 发布、送达统计与状态机流转由运行器管理;数据库是唯一事实来源

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { runNotification, type NotificationInput, type NotificationResult } from "../agents/notification";
import type { AgentChatModel } from "../agents/model";
import type { Db } from "../db/client";
import { insertNotification, insertTimelineNode, updateNotificationStatus } from "../db/queries";
import type { NotificationRow, TimelineNodeRow } from "../db/types";
import {
  AUDIENCE_LABELS,
  type DeliveryStats,
  type NotificationAudience,
} from "../simulation/delivery-rules";
import { simTimeIso } from "../simulation/clock";
import { NOTIFICATION_TRANSITIONS, transition } from "../simulation/state-machines";

const AUDIENCES: NotificationAudience[] = ["staff_students", "parents"];

/** ⚑ 通知节点与快照中记录的单次发布结果 */
export interface PublishRecord {
  audience: NotificationAudience;
  attempt: number;
  status: "published_sim" | "failed";
  stats: DeliveryStats;
  publishedSimTime: string | null;
}

/** graph_runs.state 中通知段进度(由运行器读写) */
export interface NotificationSnapshot {
  status: "awaiting_confirmation" | "done";
  /** ⚑ 通知节点 id */
  nodeId: string;
  /** 受众 → 已消耗的发布尝试次数 */
  attempts: Record<string, number>;
  /** 进入等待确认的真实时刻(epoch 毫秒) */
  awaitedSinceRealMs?: number;
}

export const NotificationGraphState = Annotation.Root({
  drillId: Annotation<string>,
  eventId: Annotation<string>,
  /** 生成草稿的公共输入(受众由图按序展开) */
  input: Annotation<Omit<NotificationInput, "audience">>,
  /** 已落库的通知行(中断恢复时直接复用,不重复调模型) */
  existing: Annotation<NotificationRow[]>({ reducer: (_, update) => update, default: () => [] }),
  simOriginMs: Annotation<number>,
  offsetMs: Annotation<number>,
  requiresConfirmation: Annotation<boolean>,
  rows: Annotation<NotificationRow[]>({ reducer: (c, u) => u ?? c, default: () => [] }),
  nodeId: Annotation<string | null>({ reducer: (_, update) => update ?? null, default: () => null }),
});

export interface NotificationGraphDeps {
  db: Db;
  model: AgentChatModel;
  now: () => number;
  onTimelineNode?: (node: TimelineNodeRow) => void;
}

export function buildNotificationGraph(deps: NotificationGraphDeps) {
  const { db, model, now } = deps;

  async function draft(state: typeof NotificationGraphState.State) {
    const realTime = new Date(now()).toISOString();
    const simTime = simTimeIso(state.simOriginMs, state.offsetMs);
    const rows: NotificationRow[] = [];
    const sources: Record<string, NotificationResult["source"] | "restored"> = {};

    for (const audience of AUDIENCES) {
      const existing = state.existing.find((r) => r.audience === audience);
      if (existing) {
        rows.push(existing); // 中断恢复:直接复用已落库草稿
        sources[audience] = "restored";
        continue;
      }
      const result = await runNotification(model, { ...state.input, audience });
      const row = insertNotification(db, {
        drill_id: state.drillId,
        event_id: state.eventId,
        audience,
        title: result.output.title,
        content: result.output.content,
      });
      updateNotificationStatus(db, row.id, transition(NOTIFICATION_TRANSITIONS, "draft", "pending_confirmation"));
      rows.push(row);
      sources[audience] = result.source;
      emitDraftResult(db, deps, state, result, audience, simTime, realTime);
    }

    const node = insertTimelineNode(db, {
      drill_id: state.drillId,
      event_id: state.eventId,
      phase: "notification",
      node_type: "notification",
      title: `通知草稿:${rows.length} 份(${rows.map((r) => AUDIENCE_LABELS[r.audience as NotificationAudience]).join("、")})${
        state.requiresConfirmation ? "(等待操作员确认发布)" : "(auto 模式自动发布)"
      }`,
      detail: JSON.stringify({
        input: state.input,
        drafts: rows.map((r) => ({
          audience: r.audience,
          notificationId: r.id,
          title: r.title,
          content: r.content,
          source: sources[r.audience],
        })),
      }),
      actor: "notification_agent",
      requires_confirmation: state.requiresConfirmation ? 1 : 0,
      sim_time: simTime,
      real_time: realTime,
    });
    deps.onTimelineNode?.(node);

    return { rows, nodeId: node.id };
  }

  return new StateGraph(NotificationGraphState)
    .addNode("draft", draft)
    .addEdge(START, "draft")
    .addEdge("draft", END)
    .compile();
}

/** 单受众草稿的降级记录(anomaly 节点,模型输出无效/超时时) */
function emitDraftResult(
  db: Db,
  deps: NotificationGraphDeps,
  state: typeof NotificationGraphState.State,
  result: NotificationResult,
  audience: NotificationAudience,
  simTime: string,
  realTime: string,
): void {
  if (!result.degraded) return;
  const anomaly = insertTimelineNode(db, {
    drill_id: state.drillId,
    event_id: state.eventId,
    phase: "notification",
    node_type: "anomaly",
    title: `通知智能体降级(${AUDIENCE_LABELS[audience]}受众 · ${
      result.degraded.reason === "timeout" ? "模型超时" : "输出无效"
    }),采用规则默认文案`,
    detail: JSON.stringify({
      degraded: result.degraded,
      audience,
      fallback: "重试一次仍失败,已按受众模板生成带「模拟演练」标识的默认通知",
    }),
    actor: "notification_agent",
    sim_time: simTime,
    real_time: realTime,
  });
  deps.onTimelineNode?.(anomaly);
}
