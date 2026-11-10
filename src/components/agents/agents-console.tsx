"use client";

// 智能体协作调度(docs/design.md §4.4):协作关系图 + 编队详情 + 交接日志。
// 数据取自演练详情接口(编队状态/时间线/活动聚合由服务端组装);活跃演练实时轮询,
// 空闲时可回看最近一场演练(只读静态图);详情面板自动跟随当前焦点编队,点击节点转为手动。

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { History, Loader2, Network } from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { useShellDrill } from "@/components/shell/drill-context";
import { DrillTag } from "@/components/status/drill-tag";
import { StateChip } from "@/components/status/state-chip";
import type { DrillDetailDTO, DrillHistoryItemDTO } from "@/lib/drill-types";
import { cn } from "@/lib/utils";
import { AgentDetailPanel } from "./agent-detail-panel";
import { graphKeyOf, type GraphNodeKey } from "./agent-meta";
import { AgentsGraphCard } from "./collab-graph-card";
import { HandoffLogList } from "./handoff-log-list";
import { deriveHandoffs } from "./handoff";

const POLL_INTERVAL_MS = 2000;

export function AgentsConsole({ className }: { className?: string }) {
  const { drill: shellDrill } = useShellDrill();
  const activeId = shellDrill?.id ?? null;
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [historyEmpty, setHistoryEmpty] = useState(false);
  const [detail, setDetail] = useState<DrillDetailDTO | null>(null);
  const [missing, setMissing] = useState(false);
  const [stale, setStale] = useState(false);
  const [manualKey, setManualKey] = useState<GraphNodeKey | null>(null);

  const drillId = activeId ?? viewingId;
  const live = activeId !== null;
  const status = detail?.drill.status;
  const terminal = status === "completed" || status === "aborted";

  // 渲染期间调整状态(React 官方模式,避免 effect 级联渲染):
  // 活跃演练出现时退出历史回看;演练切换时清上一场数据与手动选中
  const [prevActiveId, setPrevActiveId] = useState(activeId);
  if (activeId !== prevActiveId) {
    setPrevActiveId(activeId);
    if (activeId) setViewingId(null);
  }
  const [prevDrillId, setPrevDrillId] = useState(drillId);
  if (drillId !== prevDrillId) {
    setPrevDrillId(drillId);
    setDetail(null);
    setMissing(false);
    setStale(false);
    setManualKey(null);
  }

  const poll = useCallback(async () => {
    if (!drillId) return;
    try {
      const res = await fetch(`/api/drills/${drillId}`, { cache: "no-store" });
      if (res.status === 404) {
        setMissing(true);
        return;
      }
      setDetail((await res.json()) as DrillDetailDTO);
      setStale(false);
    } catch {
      // 断线容忍:保留上一拍内容,等待下一拍
      setStale(true);
    }
  }, [drillId]);

  useEffect(() => {
    if (!drillId || missing || terminal) return; // 不存在/终态:数据不再变化,停止轮询
    let cancelled = false;
    const guarded = async () => {
      if (!cancelled) await poll();
    };
    queueMicrotask(() => void guarded());
    const timer = setInterval(() => void guarded(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [poll, missing, terminal, drillId]);

  /** 空闲态入口:回看最近一场演练的协作过程(history 按创建时间倒序) */
  const viewLatest = async () => {
    try {
      const res = await fetch("/api/drills/history", { cache: "no-store" });
      const data = (await res.json()) as { drills: DrillHistoryItemDTO[] };
      const latest = data.drills[0];
      if (!latest) {
        setHistoryEmpty(true);
        return;
      }
      setHistoryEmpty(false);
      setViewingId(latest.id);
    } catch {
      setHistoryEmpty(true);
    }
  };

  if (!drillId) {
    return (
      <EmptyState
        icon={Network}
        title={historyEmpty ? "暂无历史演练" : "等待推演开始"}
        description={
          historyEmpty
            ? "还没有任何演练记录。发起一场模拟推演后,五类智能体的协作关系与交接过程将在此呈现。"
            : "推演开始后,监测感知、指挥调度、处置执行、通知发布、复盘评估五类智能体的协作关系图与交接日志将在此实时呈现。"
        }
        action={
          <>
            <Link
              href="/simulation"
              className="h-9 rounded-sm bg-primary px-4 text-sm font-medium leading-9 text-primary-foreground hover:brightness-110"
            >
              发起模拟推演
            </Link>
            <button
              type="button"
              onClick={() => void viewLatest()}
              className="h-9 rounded-sm border border-input px-4 text-sm font-medium transition-colors hover:border-primary hover:text-primary"
            >
              查看最近一场演练协作
            </button>
          </>
        }
        className={cn("flex-1", className)}
      />
    );
  }

  if (!detail) {
    if (missing) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-20 text-center">
          <p className="text-sm text-muted-foreground">演练 {drillId} 不存在或已被清理。</p>
          {viewingId && (
            <button
              type="button"
              onClick={() => setViewingId(null)}
              className="h-9 rounded-sm bg-primary px-4 text-sm font-medium text-primary-foreground hover:brightness-110"
            >
              返回
            </button>
          )}
        </div>
      );
    }
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-20" role="status" aria-label="加载演练协作数据">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  const handoffs = deriveHandoffs(detail.timeline);
  const hasRedispatch = detail.timeline.some(
    (node) => node.nodeType === "dispatch" && node.title.startsWith("重新调度"),
  );
  const pendingRedispatch =
    detail.pendingConfirmation?.kind === "dispatch" && detail.pendingConfirmation.dispatchKind === "redispatch";

  // 焦点编队:优先正在工作/执行者;全空闲或终态时取最后完成者;演练未开始默认监测感知
  const focusKey: GraphNodeKey = (() => {
    const active = detail.agents.find((a) => a.status === "working" || a.status === "executing");
    if (active) return graphKeyOf(active.key);
    const lastDone = [...detail.agents].reverse().find((a) => a.status === "done");
    return lastDone ? graphKeyOf(lastDone.key) : "perception";
  })();
  const selectedKey = manualKey ?? focusKey;

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-4 px-6 py-6", className)}>
      {/* 头部:演练标识 + 实时/回看模式 */}
      <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="font-heading text-lg font-bold">{detail.drill.name}</h2>
        <StateChip status={detail.drill.status} />
        <DrillTag />
        {live ? (
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-primary">
            <span className="size-1.5 animate-pulse rounded-full bg-primary" aria-hidden />
            实时协作
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <History className="size-3.5" aria-hidden />
            历史回看(演练已结束)
          </span>
        )}
        {viewingId && !live && (
          <button
            type="button"
            onClick={() => setViewingId(null)}
            className="ml-auto h-8 rounded-sm border border-input px-3 text-xs font-medium transition-colors hover:border-primary hover:text-primary"
          >
            返回空闲态
          </button>
        )}
      </div>

      {stale && !terminal && (
        <p role="status" className="flex-none rounded-sm border border-border bg-secondary/50 px-4 py-2 text-xs text-muted-foreground">
          连接中断,显示的可能是滞后数据,正在自动重试…
        </p>
      )}

      {/* 1280+ 左右分割(docs/design.md §8:1024–1279 右栏不并排,纵向堆叠) */}
      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <AgentsGraphCard
          agents={detail.agents}
          phase={detail.phase}
          status={detail.drill.status}
          hasPendingConfirmation={detail.pendingConfirmation !== null}
          hasRedispatch={hasRedispatch}
          pendingRedispatch={pendingRedispatch}
          selectedKey={selectedKey}
          onSelect={setManualKey}
          className="min-h-[320px] xl:min-h-0"
        />
        <div className="flex min-h-0 flex-col gap-4">
          <AgentDetailPanel
            selectedKey={selectedKey}
            agents={detail.agents}
            activity={detail.agentActivity}
            timeline={detail.timeline}
            className="min-h-[300px] flex-none xl:max-h-[55%]"
          />
          <HandoffLogList records={handoffs} className="min-h-[200px] flex-1" />
        </div>
      </div>
    </div>
  );
}
