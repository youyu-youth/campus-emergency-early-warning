"use client";

// 编队详情面板(docs/design.md §4.4):职责、协作协议、规则统计与最近调用(含降级标记与输入/输出摘要)
// 处置执行为三角色聚合展示;操作员为人工节点(无模型调用,展示最近人工动作)

import { useMemo } from "react";

import { StatusLed } from "@/components/status/status-led";
import type { AgentActivityDTO, AgentCallDTO, AgentStatusDTO, TimelineNodeDTO } from "@/lib/drill-types";
import { cn } from "@/lib/utils";
import {
  AGENT_DUTIES,
  AGENT_STATUS_LABELS,
  GRAPH_NODE_TITLES,
  NODE_TYPE_LABELS,
  PROTOCOL_NOTE,
  simTimeLabel,
  type GraphNodeKey,
} from "./agent-meta";

const HANDLING_ROLE_KEYS = ["handling_security", "handling_medical", "handling_logistics"] as const;

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)} 秒`;
}

function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** 单条最近调用:时间 + 类型 + 标题 + 降级标记 + 输入/输出摘要 */
function CallItem({ call }: { call: AgentCallDTO }) {
  return (
    <li className="border-b border-border/60 px-3 py-2 last:border-0">
      <div className="flex items-center gap-2 text-xs">
        <time className="flex-none font-mono text-[11px] text-muted-foreground tabular-nums">{simTimeLabel(call.simTime)}</time>
        <span className="flex-none rounded-sm bg-secondary px-1.5 py-px text-[10px] text-muted-foreground">
          {NODE_TYPE_LABELS[call.nodeType] ?? call.nodeType}
        </span>
        {call.degraded && (
          <span className="flex-none rounded-sm border border-[oklch(0.75_0.14_50)] px-1.5 py-px text-[10px] text-[oklch(0.6_0.14_50)]">
            降级
          </span>
        )}
        <span className="min-w-0 flex-1 truncate font-medium" title={call.title}>
          {call.title}
        </span>
      </div>
      {(call.input || call.output) && (
        <dl className="mt-1 space-y-0.5">
          {call.input && (
            <div className="flex gap-1.5">
              <dt className="flex-none text-[10px] leading-4 text-muted-foreground">输入</dt>
              <dd className="line-clamp-2 min-w-0 flex-1 break-all font-mono text-[10px] leading-4 text-muted-foreground">
                {call.input}
              </dd>
            </div>
          )}
          {call.output && (
            <div className="flex gap-1.5">
              <dt className="flex-none text-[10px] leading-4 text-muted-foreground">输出</dt>
              <dd className="line-clamp-2 min-w-0 flex-1 break-all font-mono text-[10px] leading-4 text-muted-foreground">
                {call.output}
              </dd>
            </div>
          )}
        </dl>
      )}
    </li>
  );
}

/** 统计行:调用/降级通用;处置角色附耗时与成功率;通知角色附送达 */
function StatsRow({ activity, compact }: { activity: AgentActivityDTO; compact?: boolean }) {
  const { stats } = activity;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground", compact && "gap-x-2.5")}>
      <span className="tabular-nums">
        调用 <b className="font-mono text-foreground">{stats.calls}</b> 次
      </span>
      <span className="tabular-nums">
        降级 <b className="font-mono text-foreground">{stats.degraded}</b> 次
      </span>
      {stats.avgDurationMs !== null && (
        <span className="tabular-nums">
          平均耗时 <b className="font-mono text-foreground">{formatDuration(stats.avgDurationMs)}</b>
        </span>
      )}
      {stats.successRate !== null && (
        <span className="tabular-nums">
          成功率 <b className="font-mono text-foreground">{formatRate(stats.successRate)}</b>
        </span>
      )}
      {stats.delivery && (
        <span className="tabular-nums">
          模拟送达 <b className="font-mono text-foreground">{stats.delivery.delivered}/{stats.delivery.total}</b>
        </span>
      )}
    </div>
  );
}

export function AgentDetailPanel({
  selectedKey,
  agents,
  activity,
  timeline,
  className,
}: {
  selectedKey: GraphNodeKey;
  agents: AgentStatusDTO[];
  activity: AgentActivityDTO[];
  timeline: TimelineNodeDTO[];
  className?: string;
}) {
  const byKey = useMemo(() => new Map(agents.map((a) => [a.key, a])), [agents]);
  const activityByKey = useMemo(() => new Map(activity.map((a) => [a.key, a])), [activity]);

  // 操作员:人工节点,展示职责与最近人工动作(无模型调用与统计)
  if (selectedKey === "operator") {
    const operatorActions = timeline
      .filter((node) => node.actor === "operator")
      .slice(-5)
      .reverse();
    return (
      <section className={cn("flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card", className)} aria-label="操作员详情">
        <div className="flex h-9 flex-none items-center border-b border-border px-3 text-xs font-bold">
          操作员 · 人工确认
          <span className="ml-auto text-[10px] font-normal text-muted-foreground">人工在环</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <p className="border-b border-border/60 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
            在定级、任务方案、通知发布三个关键节点人工确认或调整智能体建议;全程可暂停、恢复、终止演练。
          </p>
          <p className="px-3 pb-1 pt-2.5 text-[10px] font-bold tracking-widest text-muted-foreground">最近人工动作</p>
          {operatorActions.length === 0 ? (
            <p className="px-3 pb-3 text-xs text-muted-foreground">暂无人工确认动作。</p>
          ) : (
            <ul>
              {operatorActions.map((node) => (
                <li key={node.id} className="border-b border-border/60 px-3 py-2 last:border-0">
                  <div className="flex items-center gap-2 text-xs">
                    <time className="flex-none font-mono text-[11px] text-muted-foreground tabular-nums">{simTimeLabel(node.simTime)}</time>
                    <span className="min-w-0 flex-1 truncate" title={node.title}>
                      {node.title}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    );
  }

  // 处置执行:三角色聚合(职责/协议共用,统计分行,最近调用按时间合并)
  if (selectedKey === "handling") {
    const mergedCalls = HANDLING_ROLE_KEYS.flatMap((key) => activityByKey.get(key)?.recentCalls ?? [])
      .sort((a, b) => b.seq - a.seq)
      .slice(0, 5);
    return (
      <section className={cn("flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card", className)} aria-label="处置执行详情">
        <div className="flex h-9 flex-none items-center gap-2 border-b border-border px-3 text-xs font-bold">
          处置执行
          <span className="flex items-center gap-1.5 text-[11px] font-normal text-muted-foreground">
            <StatusLed status="executing" /> 三角色并行
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <p className="border-b border-border/60 px-3 py-2.5 text-xs leading-5 text-muted-foreground">{AGENT_DUTIES.handling.duty}</p>
          <p className="border-b border-border/60 px-3 py-2 text-[11px] leading-5 text-muted-foreground">{AGENT_DUTIES.handling.io}</p>
          <p className="border-b border-border/60 px-3 py-2 text-[11px] leading-5 text-muted-foreground">{PROTOCOL_NOTE}</p>
          <div className="space-y-1.5 border-b border-border/60 px-3 py-2.5">
            {HANDLING_ROLE_KEYS.map((key) => {
              const role = byKey.get(key);
              const roleActivity = activityByKey.get(key);
              return (
                <div key={key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="flex w-[4.5rem] flex-none items-center gap-1.5 text-[11px] font-medium">
                    <StatusLed status={role?.status ?? "standby"} />
                    {role?.label.replace("处置 · ", "") ?? key}
                  </span>
                  {roleActivity ? (
                    <StatsRow activity={roleActivity} compact />
                  ) : (
                    <span className="text-[11px] text-muted-foreground">暂无活动</span>
                  )}
                </div>
              );
            })}
          </div>
          <p className="px-3 pb-1 pt-2.5 text-[10px] font-bold tracking-widest text-muted-foreground">最近调用</p>
          {mergedCalls.length === 0 ? (
            <p className="px-3 pb-3 text-xs text-muted-foreground">等待任务指派…</p>
          ) : (
            <ul>
              {mergedCalls.map((call) => (
                <CallItem key={`${call.seq}-${call.nodeType}`} call={call} />
              ))}
            </ul>
          )}
        </div>
      </section>
    );
  }

  // 其余四类编队:单条目
  const agent = byKey.get(selectedKey);
  const agentActivity = activityByKey.get(selectedKey);
  const status = agent?.status ?? "standby";
  return (
    <section className={cn("flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card", className)} aria-label={`${GRAPH_NODE_TITLES[selectedKey]}详情`}>
      <div className="flex h-9 flex-none items-center gap-2 border-b border-border px-3 text-xs font-bold">
        {GRAPH_NODE_TITLES[selectedKey]}
        <span className="flex items-center gap-1.5 text-[11px] font-normal text-muted-foreground">
          <StatusLed status={status} />
          {AGENT_STATUS_LABELS[status]}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <p className="border-b border-border/60 px-3 py-2.5 text-xs leading-5 text-muted-foreground">{AGENT_DUTIES[selectedKey].duty}</p>
        <p className="border-b border-border/60 px-3 py-2 text-[11px] leading-5 text-muted-foreground">{AGENT_DUTIES[selectedKey].io}</p>
        <p className="border-b border-border/60 px-3 py-2 text-[11px] leading-5 text-muted-foreground">{PROTOCOL_NOTE}</p>
        <div className="border-b border-border/60 px-3 py-2.5">
          {agentActivity ? (
            <StatsRow activity={agentActivity} />
          ) : (
            <p className="text-[11px] text-muted-foreground">暂无活动</p>
          )}
        </div>
        <p className="px-3 pb-1 pt-2.5 text-[10px] font-bold tracking-widest text-muted-foreground">最近调用</p>
        {!agentActivity || agentActivity.recentCalls.length === 0 ? (
          <p className="px-3 pb-3 text-xs text-muted-foreground">尚未参与推演…</p>
        ) : (
          <ul>
            {agentActivity.recentCalls.map((call) => (
              <CallItem key={`${call.seq}-${call.nodeType}`} call={call} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
