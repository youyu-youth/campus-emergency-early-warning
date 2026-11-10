"use client";

import { Megaphone } from "lucide-react";

import type { NotificationDTO } from "@/lib/drill-types";
import { cn } from "@/lib/utils";
import { DeliveryStateChip } from "./delivery-state-chip";
import { AUDIENCE_LABELS, simTimeLabel } from "./notification-meta";

/** 通知主列表(docs/design.md §4.5):受众徽章/标题/状态与送达/发布模拟时间;行点击选中 */
export function NotificationList({
  notifications,
  selectedId,
  onSelect,
  className,
}: {
  notifications: NotificationDTO[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  className?: string;
}) {
  return (
    <section className={cn("flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card", className)} aria-label="通知列表">
      <div className="flex h-9 flex-none items-center border-b border-border px-3 text-xs font-bold">
        通知列表
        <span className="ml-auto font-mono text-[11px] font-normal text-muted-foreground tabular-nums">
          {notifications.length} 份
        </span>
      </div>
      {notifications.length === 0 ? (
        <p className="flex flex-1 items-center justify-center gap-2 px-6 py-12 text-center text-[13px] text-muted-foreground">
          <Megaphone className="size-4" aria-hidden />
          推演进入通知阶段后,师生与家长通知草稿将在此生成。
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {notifications.map((notification) => {
            const selected = notification.id === selectedId;
            return (
              <li key={notification.id} className="border-b border-border/60 last:border-0">
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelect(notification.id)}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-secondary/50",
                    selected && "bg-primary/10",
                  )}
                >
                  <span className={cn("h-8 w-0.5 flex-none rounded-full", selected ? "bg-primary" : "bg-transparent")} aria-hidden />
                  <span className="flex-none rounded-sm border border-border bg-card px-1.5 py-px text-[11px] text-muted-foreground">
                    {AUDIENCE_LABELS[notification.audience] ?? notification.audience}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium" title={notification.title}>
                    {notification.title}
                  </span>
                  <DeliveryStateChip status={notification.status} delivery={notification.delivery} className="flex-none" />
                  <span className="w-16 flex-none text-right font-mono text-[11px] text-muted-foreground tabular-nums">
                    {notification.publishedSimTime ? simTimeLabel(notification.publishedSimTime) : "—"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
