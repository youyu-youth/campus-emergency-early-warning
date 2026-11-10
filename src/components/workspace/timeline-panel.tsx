"use client";

import { useEffect, useRef, useState } from "react";

import { ConfirmStamp } from "@/components/status/confirm-stamp";
import type { TimelineNodeDTO } from "@/lib/drill-types";
import { PHASE_LABELS, type DrillPhase } from "@/simulation/state-machines";
import { cn } from "@/lib/utils";

const PHASE_ORDER: DrillPhase[] = ["perception", "grading", "handling", "notification", "review"];

/** 节点类别视觉语言:⚑=需人工确认,其余按语义着色(色点永远配文字);回放组件共用 */
export const NODE_META: Record<string, { dot: string; label: string }> = {
  signal: { dot: "bg-primary", label: "信号" },
  grading: { dot: "bg-severity-ii", label: "定级" },
  dispatch: { dot: "bg-primary", label: "派发" },
  feedback: { dot: "bg-[oklch(0.55_0.15_150)]", label: "反馈" },
  status_change: { dot: "bg-muted-foreground/60", label: "状态" },
  notification: { dot: "bg-primary", label: "通知" },
  anomaly: { dot: "bg-severity-i", label: "异常" },
  operator_action: { dot: "border-2 border-primary bg-card", label: "操作员" },
};

export function simTimeLabel(iso: string): string {
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

export function waitedLabel(waitedMs?: number): string {
  if (waitedMs === undefined) return "";
  const s = Math.round(waitedMs / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m${s % 60}s` : `${s}s`;
}

/** 中央 · 处置时间线(主轴):阶段带 + 七类节点 + ⚑确认戳 + 当前时刻游标,自动跟随最新节点 */
export function TimelinePanel({
  phase,
  timeline,
  awaitingCurrent,
  className,
}: {
  phase: DrillPhase;
  timeline: TimelineNodeDTO[];
  awaitingCurrent: boolean;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const lastSeqRef = useRef(0);

  useEffect(() => {
    const last = timeline.at(-1);
    if (last && last.seq !== lastSeqRef.current) {
      lastSeqRef.current = last.seq;
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [timeline]);

  const currentOrdinal = PHASE_ORDER.indexOf(phase);

  return (
    <section className={cn("flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card", className)}>
      <div className="flex h-9 flex-none items-center gap-2 border-b border-border px-3 text-xs font-bold">
        处置时间线
        <span className="font-normal text-muted-foreground/70">{timeline.length} 个节点</span>
      </div>

      {/* 阶段带:已过灰底 / 当前靛青 / 未到描边 */}
      <div className="flex flex-none items-center gap-2 border-b border-border px-4 py-2.5">
        {PHASE_ORDER.map((p, i) => (
          <span key={p} className="flex items-center gap-2">
            {i > 0 && <span className="text-muted-foreground/40" aria-hidden>—</span>}
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[11px]",
                i < currentOrdinal && "bg-secondary text-secondary-foreground",
                i === currentOrdinal && "bg-primary font-bold text-primary-foreground",
                i > currentOrdinal && "border border-border text-muted-foreground",
              )}
            >
              {PHASE_LABELS[p]}
            </span>
          </span>
        ))}
      </div>

      {/* 节点流(脊柱) */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <ol className="border-l border-border pl-5">
          {timeline.map((node) => {
            const meta = NODE_META[node.nodeType] ?? { dot: "bg-muted-foreground/60", label: node.nodeType };
            const isFlag = node.requiresConfirmation;
            const waitingNow = isFlag && !node.confirmation && awaitingCurrent;
            const open = expanded === node.id;
            return (
              <li key={node.id} className="relative pb-4 last:pb-1">
                <span
                  className={cn(
                    "absolute top-1 -left-[25px] size-2.5 rounded-full",
                    meta.dot,
                    isFlag && !node.confirmation && "ring-2 ring-severity-ii/50",
                    waitingNow && "animate-pulse bg-[oklch(0.75_0.15_70)]",
                  )}
                  aria-hidden
                />
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <time className="font-mono text-xs text-muted-foreground tabular-nums">{simTimeLabel(node.simTime)}</time>
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : node.id)}
                    aria-expanded={open}
                    className="text-left text-[13px] font-semibold hover:text-primary"
                  >
                    {node.title}
                  </button>
                  <span className="text-[10px] text-muted-foreground/70">{meta.label}</span>
                  {node.confirmation && <ConfirmStamp />}
                  {node.confirmation?.waitedMs !== undefined && (
                    <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                      确认耗时 {waitedLabel(node.confirmation.waitedMs)}
                    </span>
                  )}
                  {!node.confirmation && isFlag && (
                    <span className={cn("text-[11px]", waitingNow ? "font-medium text-[oklch(0.55_0.15_70)]" : "text-muted-foreground")}>
                      ⚑ {waitingNow ? "等待人工确认" : "需人工确认"}
                    </span>
                  )}
                </div>
                {open && (node.reasoning || node.confirmation) && (
                  <div className="mt-1.5 rounded-sm border border-border bg-secondary/50 px-3 py-2 text-[13px] leading-relaxed">
                    {node.reasoning && (
                      <p>
                        <span className="font-semibold">决策依据:</span>
                        {node.reasoning}
                      </p>
                    )}
                    {node.confirmation?.final && (
                      <p className="mt-1 text-muted-foreground">
                        最终等级:{node.confirmation.final}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
          <li className="relative -ml-5 pl-0">
            <span className="text-[11px] font-bold text-primary">▼ 当前时刻</span>
          </li>
        </ol>
      </div>
    </section>
  );
}
