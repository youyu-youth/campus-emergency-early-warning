"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { History, Loader2, RadioTower } from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { useShellDrill } from "@/components/shell/drill-context";
import { DrillTag } from "@/components/status/drill-tag";
import { StateChip } from "@/components/status/state-chip";
import type { DrillDetailDTO, DrillHistoryItemDTO } from "@/lib/drill-types";
import { cn } from "@/lib/utils";
import { SignalDetailDrawer } from "./signal-detail-drawer";
import { SignalFeedList } from "./signal-feed-list";
import { SignalStatStrip } from "./signal-stat-strip";

const POLL_INTERVAL_MS = 2000;

/**
 * 事件监测中心(docs/design.md §4.2):统计带 + 实时信号流 + 信号详情抽屉。
 * 数据取自演练详情接口(信号与感知解读由服务端组装);活跃演练实时轮询,
 * 空闲时可回看最近一场演练的信号(只读)。
 */
export function MonitoringConsole({ className }: { className?: string }) {
  const { drill: shellDrill } = useShellDrill();
  const activeId = shellDrill?.id ?? null;
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [historyEmpty, setHistoryEmpty] = useState(false);
  const [detail, setDetail] = useState<DrillDetailDTO | null>(null);
  const [missing, setMissing] = useState(false);
  const [stale, setStale] = useState(false);
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);

  const drillId = activeId ?? viewingId;
  const live = activeId !== null;
  const status = detail?.drill.status;
  const terminal = status === "completed" || status === "aborted";

  // 渲染期间调整状态(React 官方模式,避免 effect 级联渲染):
  // 活跃演练出现时退出历史回看,演练切换时清上一场数据与选中信号
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
    setSelectedSignalId(null);
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

  /** 空闲态入口:回看最近一场演练的信号(history 按创建时间倒序) */
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
        icon={RadioTower}
        title={historyEmpty ? "暂无历史演练" : "等待推演开始"}
        description={
          historyEmpty
            ? "还没有任何演练记录。发起一场模拟推演后,传感器与摄像头的模拟异常信号将在此实时呈现。"
            : "推演开始后,模拟传感器与摄像头的异常信号将在此实时流入,并展示感知智能体的解读与上报过程。"
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
              查看最近一场演练信号
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
      <div className="flex flex-1 items-center justify-center px-6 py-20" role="status" aria-label="加载演练信号">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  const selectedSignal = detail.signals.find((s) => s.id === selectedSignalId) ?? null;

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
            实时信号流
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

      <SignalStatStrip signals={detail.signals} event={detail.event} className="flex-none" />

      {/* 1280+ 左右分割(docs/design.md §8:1024–1279 右栏不并排,纵向堆叠) */}
      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <SignalFeedList
          signals={detail.signals}
          selectedId={selectedSignalId}
          onSelect={setSelectedSignalId}
          className="min-h-[360px] xl:min-h-0"
        />
        <SignalDetailDrawer
          signal={selectedSignal}
          event={detail.event}
          drillId={detail.drill.id}
          className="min-h-[320px] xl:min-h-0"
        />
      </div>
    </div>
  );
}
