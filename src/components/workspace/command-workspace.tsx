"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { EmptyState } from "@/components/feedback/empty-state";
import { DrillTag } from "@/components/status/drill-tag";
import { SeverityBadge } from "@/components/status/severity-badge";
import type { DrillDetailDTO } from "@/lib/drill-types";
import { Siren } from "lucide-react";
import { AgentRosterPanel } from "./agent-roster-panel";
import { DecisionDock } from "./decision-dock";
import { TaskRecordPanel } from "./task-record-panel";
import { TimelinePanel } from "./timeline-panel";

const DETAIL_POLL_MS = 1200;

const EVENT_STATUS_LABELS: Record<string, string> = {
  reported: "已上报",
  graded: "已定级",
  handling: "处置中",
  controlled: "已控制",
  closed: "已关闭",
  cancelled: "已取消",
};

const DRILL_STATUS_LABELS: Record<string, string> = {
  running: "推演中",
  paused: "已暂停",
  awaiting_confirmation: "等待确认",
  completed: "已完成",
  aborted: "已终止",
};

/** 事件详情工作区(docs/design.md §3):头带 + 编队/时间线/任务三区 + 决策坞,轮询驱动 */
export function CommandWorkspace() {
  const drillParam = useSearchParams().get("drill");
  const [detail, setDetail] = useState<DrillDetailDTO | null>(null);
  const drillIdRef = useRef<string | null>(drillParam);

  const refresh = useCallback(async () => {
    try {
      let id = drillIdRef.current;
      if (!id) {
        const res = await fetch("/api/drills", { cache: "no-store" });
        const data = (await res.json()) as { drill: { id: string } | null };
        id = data.drill?.id ?? null;
        drillIdRef.current = id;
      }
      if (!id) {
        setDetail(null);
        return;
      }
      const res = await fetch(`/api/drills/${id}`, { cache: "no-store" });
      if (res.status === 404) {
        setDetail(null);
        drillIdRef.current = null;
        return;
      }
      setDetail((await res.json()) as DrillDetailDTO);
    } catch {
      // 断线容忍:保留上一拍内容
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void refresh());
    const timer = setInterval(() => void refresh(), DETAIL_POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  if (!detail) {
    return (
      <EmptyState
        icon={Siren}
        title="推演未在进行"
        description="工作区在推演运行时展示事件时间线、智能体编队与决策坞。发起演练后可从顶部状态条一键进入。"
        action={
          <Link href="/simulation" className="text-sm font-medium text-primary hover:brightness-110">
            前往发起演练
          </Link>
        }
        className="flex-1"
      />
    );
  }

  const { drill, event, phase, timeline, tasks, notifications, agents, pendingConfirmation } = detail;
  const awaiting = drill.status === "awaiting_confirmation" && pendingConfirmation !== null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 事件头带:标题(焦点红圈=全站唯一焦点) + 等级信号牌 + 状态 */}
      <div className="flex flex-none items-center gap-4 border-b border-border bg-card px-6 py-3">
        <h3 className="font-heading rounded-sm text-base font-bold outline-1 outline-offset-4 outline-severity-i">
          {event?.title ?? "事件研判中"}
        </h3>
        {event && (
          <span className="font-mono text-xs text-muted-foreground">
            EV-{event.id.slice(0, 8).toUpperCase()} · {event.location}
          </span>
        )}
        {event?.severity ? (
          <SeverityBadge severity={event.severity} size="md" />
        ) : (
          <span className="text-[13px] text-muted-foreground">等级待定级确认</span>
        )}
        {event && (
          <span className="rounded-sm bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
            {EVENT_STATUS_LABELS[event.status] ?? event.status}
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          演练状态:{DRILL_STATUS_LABELS[drill.status] ?? drill.status}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <span className="font-mono text-xs text-muted-foreground">种子 {drill.seed}</span>
          <DrillTag variant="canvas" />
        </div>
      </div>

      {/* 三区:编队 / 时间线 / 任务与记录 */}
      <div className="flex min-h-0 flex-1 gap-5 p-5">
        <AgentRosterPanel agents={agents} className="w-60 flex-none" />
        <TimelinePanel phase={phase} timeline={timeline} awaitingCurrent={awaiting} className="min-w-0 flex-1" />
        <TaskRecordPanel tasks={tasks} timeline={timeline} notifications={notifications} className="w-80 flex-none" />
      </div>

      {/* 决策坞:关键节点暂停时升起 */}
      {awaiting && pendingConfirmation && (
        <DecisionDock drillId={drill.id} pending={pendingConfirmation} onDone={refresh} />
      )}

      {(drill.status === "completed" || drill.status === "aborted") && (
        <div className="flex flex-none items-center gap-3 border-t border-border bg-card px-6 py-3 text-[13px]">
          <span className="font-semibold">
            演练{drill.status === "completed" ? "已完成" : "已终止"}
            {drill.score !== null && <span className="ml-2 text-muted-foreground">规则评分:{drill.score} 分</span>}
          </span>
          <span className="text-muted-foreground">复盘报告与时间线回放可在「事件复盘报告」页查看(建设中)</span>
        </div>
      )}
    </div>
  );
}
