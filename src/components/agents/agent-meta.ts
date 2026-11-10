// 协作域展示语言:图节点键、actor/节点类型标签、编队职责与协议说明(消费 agents+timeline 数据,均为演练留痕)
import { Eye, Network, Radio, ShieldCheck, Sparkles, UserCheck, type LucideIcon } from "lucide-react";

import type { AgentStatusDTO } from "@/lib/drill-types";

/** 图节点键:编队聚合(处置三角色合并为一个「处置执行」节点) + 操作员人工节点 */
export type GraphNodeKey = "perception" | "command" | "handling" | "notification" | "review" | "operator";

/** 编队 key → 图节点键 */
export function graphKeyOf(agentKey: string): GraphNodeKey {
  if (agentKey.startsWith("handling_")) return "handling";
  if (agentKey === "operator") return "operator";
  return agentKey as GraphNodeKey;
}

/** 图节点标题 */
export const GRAPH_NODE_TITLES: Record<GraphNodeKey, string> = {
  perception: "监测感知",
  command: "指挥调度",
  handling: "处置执行",
  notification: "通知发布",
  review: "复盘评估",
  operator: "操作员 · 人工确认",
};

/** 图节点图标 */
export const GRAPH_NODE_ICONS: Record<GraphNodeKey, LucideIcon> = {
  perception: Eye,
  command: Network,
  handling: ShieldCheck,
  notification: Radio,
  review: Sparkles,
  operator: UserCheck,
};

/** timeline actor → 显示名(编队 7 条目 + 操作员/推演引擎) */
export const ACTOR_LABELS: Record<string, string> = {
  monitor_agent: "监测感知",
  command_agent: "指挥调度",
  security_agent: "处置 · 保安",
  medical_agent: "处置 · 医务",
  logistics_agent: "处置 · 后勤",
  notification_agent: "通知发布",
  review_agent: "复盘评估",
  operator: "操作员",
  drill_runner: "推演引擎",
};

export function actorLabel(actor: string): string {
  return ACTOR_LABELS[actor] ?? actor;
}

/** 节点类型中文标签(未知类型回退原值) */
export const NODE_TYPE_LABELS: Record<string, string> = {
  signal: "信号解读",
  grading: "事件定级",
  dispatch: "任务方案",
  feedback: "处置反馈",
  status_change: "状态变更",
  notification: "通知发布",
  anomaly: "降级记录",
  operator_action: "人工确认",
};

/** 编队职责(只读展示,来源 AGENTS.md 智能体分工;处置三角色共用一条) */
export const AGENT_DUTIES: Record<Exclude<GraphNodeKey, "operator">, { duty: string; io: string }> = {
  perception: {
    duty: "接收模拟传感器与摄像头的异常信号,提取位置、类型、时间和证据,提交事件上报。",
    io: "输入:模拟信号读数 → 输出:事件要素(位置/类型/时间/证据)",
  },
  command: {
    duty: "研判事件等级,拟定任务方案并指派保安、医务、后勤;依据处置反馈评估是否重新调度。",
    io: "输入:事件要素与处置反馈 → 输出:等级建议、任务方案",
  },
  handling: {
    duty: "按保安、医务、后勤角色执行模拟处置任务,返回耗时、资源消耗与处置结果(规则计算,智能体生成处置叙述)。",
    io: "输入:任务指令与规则预演结果 → 输出:处置叙述与执行反馈",
  },
  notification: {
    duty: "按事件状态生成面向师生与家长的通知文案(强制携带模拟演练标识),经确认后模拟分发。",
    io: "输入:事件与演练上下文 → 输出:多受众通知草稿",
  },
  review: {
    duty: "基于留存的事件与动作日志生成处置时间线、问题分析和改进建议。",
    io: "输入:演练时间线与指标 → 输出:复盘报告",
  },
};

/** 协作协议说明(项目现状:无外部工具权限,全部经结构化输出 + 运行时校验) */
export const PROTOCOL_NOTE = "无外部工具 · 结构化输出协议(输出经运行时校验,超时或无效时按规则降级并留痕)";

/** 状态文字(与 StatusLed 颜色搭配,状态不只靠颜色) */
export const AGENT_STATUS_LABELS: Record<AgentStatusDTO["status"], string> = {
  standby: "待命",
  working: "工作中",
  executing: "执行中",
  done: "已完成",
};

/** ISO 模拟时间 → HH:mm:ss(与监测/通知中心同一展示口径) */
export function simTimeLabel(iso: string): string {
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}
