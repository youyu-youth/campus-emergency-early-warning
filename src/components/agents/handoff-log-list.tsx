"use client";

// 交接日志(docs/design.md §4.4):按时间线序号升序滚动展示「谁 → 谁」交接与传递内容摘要
// 记录由 deriveHandoffs 从相邻节点 actor 变化推导(库中无显式边表)

import { useEffect, useRef } from "react";
import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { actorLabel, NODE_TYPE_LABELS, simTimeLabel } from "./agent-meta";
import type { HandoffRecord } from "./handoff";

export function HandoffLogList({ records, className }: { records: HandoffRecord[]; className?: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // 新交接到达时跟随滚动到底部(用户上翻接近底部时才跟随,避免打扰回看)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [records.length]);

  return (
    <section className={cn("flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card", className)} aria-label="交接日志">
      <div className="flex h-9 flex-none items-center border-b border-border px-3 text-xs font-bold">
        交接日志
        <span className="ml-auto font-mono text-[11px] font-normal text-muted-foreground tabular-nums">
          {records.length} 次交接
        </span>
      </div>
      {records.length === 0 ? (
        <p className="flex flex-1 items-center justify-center px-6 py-10 text-center text-[13px] text-muted-foreground">
          推演开始后,智能体之间的交接将按顺序在此记录。
        </p>
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <ul>
            {records.map((record) => (
              <li key={record.seq} className="border-b border-border/60 px-3 py-2 last:border-0">
                <div className="flex items-center gap-1.5 text-[11px]">
                  <time className="flex-none font-mono text-muted-foreground tabular-nums">{simTimeLabel(record.simTime)}</time>
                  <span className="flex-none font-medium">{actorLabel(record.from)}</span>
                  <ArrowRight className="size-3 flex-none text-muted-foreground" aria-label="交接给" />
                  <span className="min-w-0 flex-none font-medium text-primary">{actorLabel(record.to)}</span>
                  <span className="ml-auto flex-none rounded-sm bg-secondary px-1.5 py-px text-[10px] text-muted-foreground">
                    {NODE_TYPE_LABELS[record.nodeType] ?? record.nodeType}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground" title={record.title}>
                  {record.title}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
