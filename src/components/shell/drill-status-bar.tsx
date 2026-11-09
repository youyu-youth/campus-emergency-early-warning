"use client";

import Link from "next/link";
import { Pause, Play } from "lucide-react";

import { DrillTag } from "@/components/status/drill-tag";
import { RealClock } from "@/components/status/real-clock";
import { SeverityBadge } from "@/components/status/severity-badge";
import { SimClock } from "@/components/status/sim-clock";
import { cn } from "@/lib/utils";
import { useShellDrill } from "./drill-context";
import type { DrillPhase, DrillStatus, EventSeverity } from "@/simulation/state-machines";
import { PHASE_LABELS } from "@/simulation/state-machines";

/** 状态条消费的演练摘要(数据接入层组装,壳层只负责呈现) */
export interface DrillSummary {
  id: string;
  name: string;
  status: DrillStatus;
  phase: DrillPhase;
  severity?: EventSeverity;
  /** HH:mm:ss;空闲态为空 */
  simClockLabel: string;
}

const ACTIVE_STATUS: readonly DrillStatus[] = ["running", "paused", "awaiting_confirmation"];

/** 顶部演练状态条(全局唯一时钟源,docs/design.md §2.1):空闲显示发起入口,运行挂等级牌+模拟钟+暂停控制。
 *  演练摘要优先取 props(测试/演示注入),否则读 ShellDrillContext(页面数据接入通道)。 */
export function DrillStatusBar({
  drill: drillProp,
  onPauseResume,
}: {
  drill?: DrillSummary | null;
  onPauseResume?: () => void;
}) {
  const { drill: drillFromContext, pauseResume } = useShellDrill();
  const drill = drillProp !== undefined ? drillProp : drillFromContext;
  const handlePauseResume = onPauseResume ?? pauseResume ?? undefined;
  const active = drill && ACTIVE_STATUS.includes(drill.status);

  return (
    <header className="flex h-12 flex-none items-center gap-2 overflow-x-auto border-b border-shell-border bg-shell px-4 text-shell-foreground sm:gap-3 sm:px-6">
      {drill && active ? (
        <>
          <span className="hidden text-[11px] text-shell-muted lg:inline">当前演练</span>
          <span className="hidden max-w-44 truncate text-[13px] font-semibold sm:inline xl:max-w-none">
            {drill.name}
          </span>
          {drill.severity && (
            <SeverityBadge key={drill.severity} severity={drill.severity} size="sm" className="flex-none" />
          )}
          <Divider className="hidden lg:block" />
          <span className="hidden text-[11px] text-shell-muted lg:inline">阶段</span>
          <span className="hidden whitespace-nowrap rounded-sm bg-shell-accent/30 px-2 py-0.5 text-[11px] font-medium text-[oklch(0.85_0.06_264)] sm:inline">
            {PHASE_LABELS[drill.phase]}
          </span>
          <Divider className="hidden lg:block" />
          <span className="hidden text-[11px] text-shell-muted lg:inline">模拟</span>
          <SimClock label={drill.simClockLabel} className="whitespace-nowrap" />
          {drill.status === "awaiting_confirmation" ? (
            <span className="flex flex-none items-center gap-1.5 whitespace-nowrap text-[11px] font-medium text-[oklch(0.8_0.13_70)]">
              <span className="size-2 rounded-full bg-[oklch(0.75_0.15_70)]" aria-hidden />
              <span className="sm:hidden">待确认</span>
              <span className="hidden sm:inline">等待人工确认</span>
            </span>
          ) : (
            <button
              type="button"
              onClick={handlePauseResume}
              disabled={!handlePauseResume}
              title={handlePauseResume ? undefined : "演练控制待数据接入后启用"}
              className="flex h-7 flex-none items-center gap-1.5 rounded-sm border border-shell-accent px-2 text-xs transition-colors hover:bg-shell-accent-soft disabled:cursor-not-allowed disabled:opacity-50 sm:px-3"
            >
              {drill.status === "paused" ? (
                <>
                  <Play className="size-3.5" aria-hidden />
                  <span className="hidden sm:inline">恢复</span>
                </>
              ) : (
                <>
                  <Pause className="size-3.5" aria-hidden />
                  <span className="hidden sm:inline">暂停</span>
                </>
              )}
            </button>
          )}
          <Link
            href="/command"
            className="hidden h-7 items-center whitespace-nowrap rounded-sm bg-shell-accent px-3 text-xs font-medium text-white transition-colors hover:brightness-110 md:flex"
          >
            进入工作区
          </Link>
        </>
      ) : (
        <>
          <span className="hidden text-[11px] text-shell-muted sm:inline">演练状态</span>
          <span className="whitespace-nowrap text-[13px] font-semibold">
            {drill ? (drill.status === "completed" ? "最近演练已完成" : "最近演练已终止") : "空闲"}
          </span>
          <Link
            href="/simulation"
            className="flex h-7 flex-none items-center whitespace-nowrap rounded-sm border border-shell-accent px-2.5 text-xs transition-colors hover:bg-shell-accent-soft sm:px-3"
          >
            发起演练
          </Link>
        </>
      )}

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        {/* 「模拟演练」标识常驻,任何视口不隐藏(PRODUCT.md 硬约束) */}
        <DrillTag variant="shell" />
        <Divider className="hidden sm:block" />
        {active ? (
          /* 运行态窄屏真实时钟让位:模拟时钟是全局唯一时钟源,保证徽标与演练信息同屏 */
          <>
            <span className="hidden text-[11px] text-shell-muted md:inline">真实</span>
            <RealClock className="hidden whitespace-nowrap font-mono text-xs tracking-wider text-shell-foreground/85 tabular-nums md:inline" />
          </>
        ) : (
          <>
            <span className="hidden text-[11px] text-shell-muted sm:inline">真实</span>
            <RealClock className="whitespace-nowrap font-mono text-xs tracking-wider text-shell-foreground/85 tabular-nums" />
          </>
        )}
      </div>
    </header>
  );
}

function Divider({ className }: { className?: string }) {
  return <span className={cn("h-4 w-px bg-shell-border", className)} aria-hidden />;
}
