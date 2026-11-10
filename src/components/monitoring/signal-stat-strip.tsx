import { SeverityBadge } from "@/components/status/severity-badge";
import type { DrillDetailDTO, SignalDTO } from "@/lib/drill-types";
import { cn } from "@/lib/utils";

/** 信号统计带(docs/design.md §4.2):信号总数/待处理/已上报/关联事件,数字等宽 */
export function SignalStatStrip({
  signals,
  event,
  className,
}: {
  signals: SignalDTO[];
  event: DrillDetailDTO["event"];
  className?: string;
}) {
  const pending = signals.filter((s) => s.status === "new" || s.status === "processing").length;
  const reported = signals.filter((s) => s.status === "reported").length;
  return (
    <section className={cn("rounded-md border border-border bg-card", className)} aria-label="信号统计">
      <div className="flex h-9 items-center border-b border-border px-3 text-xs font-bold">
        信号统计（模拟信号流）
      </div>
      <dl className="grid grid-cols-2 divide-border sm:grid-cols-4 sm:divide-x">
        <div className="flex flex-col gap-1 px-4 py-3.5">
          <dt className="text-[11px] text-muted-foreground">信号总数</dt>
          <dd className="font-mono text-lg font-semibold tabular-nums">{signals.length}</dd>
        </div>
        <div className="flex flex-col gap-1 border-t border-border px-4 py-3.5 sm:border-t-0">
          <dt className="text-[11px] text-muted-foreground">待处理</dt>
          <dd className="font-mono text-lg font-semibold tabular-nums">{pending}</dd>
          <dd className="text-[11px] text-muted-foreground/70">新信号 + 解读中</dd>
        </div>
        <div className="flex flex-col gap-1 border-t border-border px-4 py-3.5 sm:border-t-0">
          <dt className="text-[11px] text-muted-foreground">已上报</dt>
          <dd className="font-mono text-lg font-semibold tabular-nums">{reported}</dd>
        </div>
        <div className="flex min-w-0 flex-col gap-1 border-t border-border px-4 py-3.5 sm:border-t-0">
          <dt className="text-[11px] text-muted-foreground">关联事件</dt>
          {event ? (
            <dd className="flex min-w-0 flex-wrap items-center gap-2">
              {event.severity ? (
                <SeverityBadge severity={event.severity} size="sm" />
              ) : (
                <span className="text-xs font-medium text-muted-foreground">未定级</span>
              )}
              <span className="truncate text-[13px] font-medium" title={event.title}>
                {event.title}
              </span>
            </dd>
          ) : (
            <dd className="text-lg text-muted-foreground">—</dd>
          )}
          {!event && <dd className="text-[11px] text-muted-foreground/70">首信号解读后生成</dd>}
        </div>
      </dl>
    </section>
  );
}
