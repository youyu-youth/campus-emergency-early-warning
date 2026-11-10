"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { History, Loader2, Megaphone } from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { useShellDrill } from "@/components/shell/drill-context";
import { DrillTag } from "@/components/status/drill-tag";
import { StateChip } from "@/components/status/state-chip";
import type { DrillDetailDTO, DrillHistoryItemDTO } from "@/lib/drill-types";
import { cn } from "@/lib/utils";
import { NotificationList } from "./notification-list";
import { NotificationPreview } from "./notification-preview";

const POLL_INTERVAL_MS = 2000;

/**
 * 通知发布中心(docs/design.md §4.5):通知列表 + 公告预览 + 生成依据与分发记录。
 * 待确认通知与工作区决策坞联动(本页只引导跳转,不在本页确认);
 * 失败通知在本页重试(经 control 端点,⚑ 节点追加结果是设计内例外)。
 */
export function NotificationsConsole({ className }: { className?: string }) {
  const { drill: shellDrill } = useShellDrill();
  const activeId = shellDrill?.id ?? null;
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [historyEmpty, setHistoryEmpty] = useState(false);
  const [detail, setDetail] = useState<DrillDetailDTO | null>(null);
  const [missing, setMissing] = useState(false);
  const [stale, setStale] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [retryBusy, setRetryBusy] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const drillId = activeId ?? viewingId;
  const live = activeId !== null;
  const status = detail?.drill.status;
  const terminal = status === "completed" || status === "aborted";
  const awaitingNotification =
    detail?.drill.status === "awaiting_confirmation" && detail.pendingConfirmation?.kind === "notification";

  // 渲染期间调整状态(React 官方模式,避免 effect 级联渲染):
  // 活跃演练出现时退出历史回看;结束时无缝转入回看保留内容
  // (通知结果与失败重试的主场景就是刚完成的演练,不能跳回空态打断浏览)
  const [prevActiveId, setPrevActiveId] = useState(activeId);
  if (activeId !== prevActiveId) {
    setPrevActiveId(activeId);
    if (activeId) setViewingId(null);
    else if (prevActiveId) setViewingId(prevActiveId);
  }
  const [prevDrillId, setPrevDrillId] = useState(drillId);
  if (drillId !== prevDrillId) {
    setPrevDrillId(drillId);
    setDetail(null);
    setMissing(false);
    setStale(false);
    setSelectedId(null);
    setRetryError(null);
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

  /** 空闲态入口:回看最近一场演练的通知(history 按创建时间倒序) */
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

  /** 失败通知重试:成功/失败都立即补一拍刷新列表与分发记录 */
  const retryPublish = async () => {
    if (!drillId || retryBusy) return;
    setRetryBusy(true);
    setRetryError(null);
    try {
      const res = await fetch(`/api/drills/${drillId}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry_notification" }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `重试失败(${res.status})`);
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : String(error));
    } finally {
      setRetryBusy(false);
      await poll();
    }
  };

  if (!drillId) {
    return (
      <EmptyState
        icon={Megaphone}
        title={historyEmpty ? "暂无历史演练" : "等待推演开始"}
        description={
          historyEmpty
            ? "还没有任何演练记录。发起一场模拟推演后,面向师生与家长的通知将在此生成、确认并模拟分发。"
            : "推演进入通知阶段后,面向师生与家长的通知草稿将在此生成,经工作区决策坞确认后模拟分发并统计送达。"
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
              查看最近一场演练通知
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
      <div className="flex flex-1 items-center justify-center px-6 py-20" role="status" aria-label="加载演练通知">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  const selected = detail.notifications.find((n) => n.id === selectedId) ?? null;

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
            实时通知流
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

      {/* 决策坞联动:推演停在通知确认点时引导去工作区(docs/design.md §4.5/§6.2) */}
      {awaitingNotification && (
        <p className="flex-none rounded-sm border border-[oklch(0.75_0.15_70/0.45)] bg-[oklch(0.75_0.15_70/0.08)] px-4 py-2.5 text-xs leading-relaxed text-[oklch(0.5_0.12_70)]">
          ⚑ 推演停在通知确认点:{detail.notifications.filter((n) => n.status === "pending_confirmation").length} 份草稿待确认。
          请到
          <Link href={`/command?drill=${drillId}`} className="font-medium underline underline-offset-2">
            工作区决策坞
          </Link>
          确认发布(模拟)后继续。
        </p>
      )}

      {/* 1280+ 左右分割(docs/design.md §8:1024–1279 纵向堆叠) */}
      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_440px]">
        <NotificationList
          notifications={detail.notifications}
          selectedId={selectedId}
          onSelect={setSelectedId}
          className="min-h-[280px] xl:min-h-0"
        />
        <NotificationPreview
          notification={selected}
          event={detail.event}
          retryable={detail.notificationRetryable}
          retryBusy={retryBusy}
          retryError={retryError}
          onRetry={() => void retryPublish()}
          className="min-h-[360px] xl:min-h-0"
        />
      </div>
    </div>
  );
}
