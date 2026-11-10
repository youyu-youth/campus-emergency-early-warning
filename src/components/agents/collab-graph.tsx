"use client";

// 协作关系图(docs/design.md §4.4):固定拓扑 SVG——五类编队节点横向链式 + 操作员人工节点 + 重新调度回边
// 边三态:已走过实线/活跃中流动虚线/未到浅灰;节点状态与工作区编队同一语言(状态灯+文字)

import { useMemo } from "react";

import type { AgentStatusDTO } from "@/lib/drill-types";
import { cn } from "@/lib/utils";
import { PHASE_ORDER, type DrillPhase, type DrillStatus } from "@/simulation/state-machines";
import { AGENT_STATUS_LABELS, GRAPH_NODE_ICONS, GRAPH_NODE_TITLES, type GraphNodeKey } from "./agent-meta";

/** 边状态:未激活 / 活跃中(流动) / 已走过 */
type EdgeState = "pending" | "active" | "done";

const STATUS_STROKE: Record<AgentStatusDTO["status"] | "idle", string> = {
  standby: "stroke-border",
  working: "stroke-primary",
  executing: "stroke-primary",
  done: "stroke-[oklch(0.55_0.15_150)]",
  idle: "stroke-border",
};

const STATUS_DOT: Record<AgentStatusDTO["status"] | "idle", string> = {
  standby: "fill-muted-foreground/50",
  working: "fill-primary",
  executing: "fill-primary",
  done: "fill-[oklch(0.55_0.15_150)]",
  idle: "fill-muted-foreground/50",
};

const EDGE_STYLE: Record<EdgeState, string> = {
  pending: "stroke-border",
  active: "stroke-primary",
  done: "stroke-muted-foreground/60",
};

const EDGE_FILL: Record<EdgeState, string> = {
  pending: "fill-border",
  active: "fill-primary",
  done: "fill-muted-foreground/60",
};

/** 主链节点布局(处置执行为大节点,内含三角色行;节点间边距统一 110) */
const CHAIN_NODES: Array<{ key: Exclude<GraphNodeKey, "operator">; x: number; y: number; w: number; h: number }> = [
  { key: "perception", x: 40, y: 105, w: 160, h: 70 },
  { key: "command", x: 310, y: 105, w: 160, h: 70 },
  { key: "handling", x: 580, y: 60, w: 190, h: 140 },
  { key: "notification", x: 880, y: 105, w: 160, h: 70 },
  { key: "review", x: 1150, y: 105, w: 160, h: 70 },
];

/** 主链边:交接语义标签 + 源阶段序号(判定走过/活跃/未到) */
const CHAIN_EDGES: Array<{ x1: number; x2: number; srcOrdinal: number; label: string }> = [
  { x1: 200, x2: 310, srcOrdinal: 0, label: "事件上报" },
  { x1: 470, x2: 580, srcOrdinal: 1, label: "任务指派" },
  { x1: 770, x2: 880, srcOrdinal: 2, label: "处置反馈" },
  { x1: 1040, x2: 1150, srcOrdinal: 3, label: "演练留痕" },
];

const OPERATOR_NODE = { x: 310, y: 334, w: 160, h: 56 };

const HANDLING_ROLE_KEYS = ["handling_security", "handling_medical", "handling_logistics"] as const;

export function CollabGraph({
  agents,
  phase,
  status,
  hasPendingConfirmation,
  hasRedispatch,
  pendingRedispatch,
  selectedKey,
  onSelect,
  className,
}: {
  agents: AgentStatusDTO[];
  phase: DrillPhase;
  status: DrillStatus;
  hasPendingConfirmation: boolean;
  /** timeline 中出现过「重新调度」dispatch 节点 */
  hasRedispatch: boolean;
  /** 当前正等待重新调度方案确认 */
  pendingRedispatch: boolean;
  selectedKey: GraphNodeKey;
  onSelect: (key: GraphNodeKey) => void;
  className?: string;
}) {
  const byKey = useMemo(() => new Map(agents.map((a) => [a.key, a])), [agents]);
  const terminal = status === "completed" || status === "aborted";
  const currentOrdinal = PHASE_ORDER.indexOf(phase);

  const statusOf = (key: string): AgentStatusDTO["status"] => byKey.get(key)?.status ?? "standby";
  /** 处置执行聚合:三角色取最高活跃度(executing > working > done > standby) */
  const handlingStatus: AgentStatusDTO["status"] = useMemo(() => {
    const ranks: Record<AgentStatusDTO["status"], number> = { standby: 0, done: 1, working: 2, executing: 3 };
    return HANDLING_ROLE_KEYS.reduce<AgentStatusDTO["status"]>(
      (best, key) => (ranks[statusOf(key)] > ranks[best] ? statusOf(key) : best),
      "standby",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- statusOf 依赖 agents,由上层 memo 保证
  }, [byKey]);

  const chainEdgeState = (srcOrdinal: number): EdgeState => {
    if (status === "completed") return "done";
    if (srcOrdinal < currentOrdinal) return "done";
    if (srcOrdinal === currentOrdinal) return terminal ? "pending" : "active";
    return "pending";
  };
  /** 人工确认通道:有待确认时活跃;演练推进到研判之后视为已启用 */
  const operatorEdgeState: EdgeState = hasPendingConfirmation
    ? "active"
    : currentOrdinal >= 1 || status === "completed"
      ? "done"
      : "pending";
  /** 重新调度回边:发生过→已走过;等待确认→活跃;否则为潜在路径(浅虚线) */
  const redispatchEdgeState: EdgeState = pendingRedispatch ? "active" : hasRedispatch ? "done" : "pending";

  return (
    <svg
      viewBox="0 0 1350 430"
      role="img"
      aria-label={`智能体协作关系图:当前阶段${PHASE_ORDER.indexOf(phase) >= 0 ? phase : ""}`}
      className={cn("h-full w-full", className)}
    >
      <defs>
        {(["pending", "active", "done"] as const).map((state) => (
          <marker
            key={state}
            id={`arrow-${state}`}
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,1 L7,4 L0,7 z" className={EDGE_FILL[state]} />
          </marker>
        ))}
      </defs>

      {/* 重新调度回边(上方弧线):处置反馈 → 指挥调度重新评估 */}
      <path
        d="M 675,60 C 675,18 390,18 390,105"
        fill="none"
        strokeWidth="1.5"
        strokeDasharray="5 5"
        className={EDGE_STYLE[redispatchEdgeState]}
        markerEnd={`url(#arrow-${redispatchEdgeState})`}
        opacity={redispatchEdgeState === "pending" ? 0.55 : 1}
      />
      <text x="532" y="30" textAnchor="middle" className="fill-muted-foreground" fontSize="11">
        重新调度
      </text>

      {/* 主链边 */}
      {CHAIN_EDGES.map((edge) => {
        const state = chainEdgeState(edge.srcOrdinal);
        return (
          <g key={edge.srcOrdinal}>
            <line
              x1={edge.x1}
              y1={140}
              x2={edge.x2}
              y2={140}
              strokeWidth="1.5"
              className={EDGE_STYLE[state]}
              strokeDasharray={state === "active" ? "7 5" : undefined}
              markerEnd={`url(#arrow-${state})`}
            >
              {state === "active" && (
                <animate attributeName="stroke-dashoffset" values="24;0" dur="1.2s" repeatCount="indefinite" />
              )}
            </line>
            <text x={(edge.x1 + edge.x2) / 2} y="132" textAnchor="middle" className="fill-muted-foreground" fontSize="10.5">
              {edge.label}
            </text>
          </g>
        );
      })}

      {/* 人工确认双向通道(虚线):指挥调度 ⇄ 操作员 */}
      <line
        x1={390}
        y1={175}
        x2={390}
        y2={334}
        strokeWidth="1.5"
        strokeDasharray="2 5"
        className={EDGE_STYLE[operatorEdgeState]}
        markerEnd={`url(#arrow-${operatorEdgeState})`}
        markerStart={`url(#arrow-${operatorEdgeState})`}
      />
      <text x="398" y="258" className="fill-muted-foreground" fontSize="10.5">
        确认 / 调整
      </text>

      {/* 主链节点 */}
      {CHAIN_NODES.map((node) => {
        const isHandling = node.key === "handling";
        const agentStatus = isHandling ? handlingStatus : statusOf(node.key);
        const selected = selectedKey === node.key;
        const Icon = GRAPH_NODE_ICONS[node.key];
        return (
          <g
            key={node.key}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            aria-label={`${GRAPH_NODE_TITLES[node.key]}(${AGENT_STATUS_LABELS[agentStatus]})`}
            onClick={() => onSelect(node.key)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(node.key);
              }
            }}
            className="cursor-pointer"
          >
            <rect
              x={node.x}
              y={node.y}
              width={node.w}
              height={node.h}
              rx="8"
              className={cn("fill-card", STATUS_STROKE[agentStatus], selected && "fill-primary/10")}
              strokeWidth={selected ? "2" : "1.5"}
            >
              {agentStatus === "executing" && (
                <animate attributeName="stroke-opacity" values="1;0.45;1" dur="1.6s" repeatCount="indefinite" />
              )}
            </rect>
            <Icon x={node.x + 14} y={node.y + 14} width="15" height="15" className="fill-none stroke-muted-foreground" strokeWidth="1.5" />
            <text x={node.x + 36} y={node.y + 26} fontSize="13" className="fill-foreground font-bold">
              {GRAPH_NODE_TITLES[node.key]}
            </text>

            {isHandling ? (
              <>
                <line x1={node.x} y1={node.y + 40} x2={node.x + node.w} y2={node.y + 40} className="stroke-border" strokeWidth="1" />
                {HANDLING_ROLE_KEYS.map((roleKey, i) => {
                  const role = byKey.get(roleKey);
                  const roleName = role?.label.replace("处置 · ", "") ?? roleKey;
                  const roleStatus = role?.status ?? "standby";
                  const rowY = node.y + 58 + i * 20;
                  return (
                    <g key={roleKey}>
                      <text x={node.x + 14} y={rowY + 3.5} fontSize="11" className="fill-foreground">
                        {roleName}
                      </text>
                      <circle cx={node.x + node.w - 66} cy={rowY} r="3" className={STATUS_DOT[roleStatus]} />
                      <text x={node.x + node.w - 58} y={rowY + 3.5} fontSize="10.5" className="fill-muted-foreground">
                        {AGENT_STATUS_LABELS[roleStatus]}
                      </text>
                    </g>
                  );
                })}
                <line x1={node.x} y1={node.y + 124} x2={node.x + node.w} y2={node.y + 124} className="stroke-border" strokeWidth="1" />
                <text x={node.x + 14} y={node.y + 137} fontSize="10.5" className="fill-muted-foreground">
                  三角色并行处置
                </text>
              </>
            ) : (
              <g>
                <circle cx={node.x + 17} cy={node.y + node.h - 16} r="3.5" className={STATUS_DOT[agentStatus]}>
                  {agentStatus === "executing" && (
                    <animate attributeName="opacity" values="1;0.3;1" dur="1.6s" repeatCount="indefinite" />
                  )}
                </circle>
                <text x={node.x + 27} y={node.y + node.h - 12} fontSize="11" className="fill-muted-foreground">
                  {AGENT_STATUS_LABELS[agentStatus]}
                </text>
              </g>
            )}
          </g>
        );
      })}

      {/* 操作员人工节点(虚线边框区别于智能体) */}
      <g
        role="button"
        tabIndex={0}
        aria-pressed={selectedKey === "operator"}
        aria-label={`操作员人工确认节点${hasPendingConfirmation ? "(等待确认)" : ""}`}
        onClick={() => onSelect("operator")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect("operator");
          }
        }}
        className="cursor-pointer"
      >
        <rect
          x={OPERATOR_NODE.x}
          y={OPERATOR_NODE.y}
          width={OPERATOR_NODE.w}
          height={OPERATOR_NODE.h}
          rx="8"
          strokeDasharray="6 4"
          className={cn(
            "fill-card stroke-border",
            hasPendingConfirmation && "stroke-primary",
            selectedKey === "operator" && "fill-primary/10",
          )}
          strokeWidth={selectedKey === "operator" ? "2" : "1.5"}
        >
          {hasPendingConfirmation && (
            <animate attributeName="stroke-opacity" values="1;0.45;1" dur="1.6s" repeatCount="indefinite" />
          )}
        </rect>
      </g>
      <text x={OPERATOR_NODE.x + 14} y={OPERATOR_NODE.y + 24} fontSize="13" className="fill-foreground font-bold">
        操作员
      </text>
      <text x={OPERATOR_NODE.x + 14} y={OPERATOR_NODE.y + 44} fontSize="10.5" className="fill-muted-foreground">
        {hasPendingConfirmation ? "等待人工确认…" : "关键节点人工在环"}
      </text>

      {/* 图例:边三态(状态不只靠颜色,附文字) */}
      <g transform="translate(40, 412)">
        <line x1="0" y1="0" x2="26" y2="0" className={EDGE_STYLE.done} strokeWidth="1.5" />
        <text x="32" y="3.5" fontSize="10.5" className="fill-muted-foreground">
          已走过
        </text>
        <line x1="86" y1="0" x2="112" y2="0" className={EDGE_STYLE.active} strokeWidth="1.5" strokeDasharray="6 4" />
        <text x="118" y="3.5" fontSize="10.5" className="fill-muted-foreground">
          活跃中
        </text>
        <line x1="172" y1="0" x2="198" y2="0" className={EDGE_STYLE.pending} strokeWidth="1.5" />
        <text x="204" y="3.5" fontSize="10.5" className="fill-muted-foreground">
          未激活
        </text>
        <line x1="258" y1="0" x2="284" y2="0" className={EDGE_STYLE.pending} strokeWidth="1.5" strokeDasharray="2 5" />
        <text x="290" y="3.5" fontSize="10.5" className="fill-muted-foreground">
          虚线=人工通道
        </text>
      </g>
    </svg>
  );
}
