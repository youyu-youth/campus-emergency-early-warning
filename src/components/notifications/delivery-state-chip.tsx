import { cn } from "@/lib/utils";
import { deliveryLabel, NOTIFICATION_STATUS_DOTS, NOTIFICATION_STATUS_LABELS } from "./notification-meta";

/** 状态三件套:色点 + 文字(+送达统计)(docs/design.md §5 组件表 DeliveryStateChip) */
export function DeliveryStateChip({
  status,
  delivery,
  className,
}: {
  status: string;
  delivery: { total?: number; delivered?: number } | null;
  className?: string;
}) {
  const deliveryText = deliveryLabel(delivery);
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[11px] text-muted-foreground", className)}>
      <span className={cn("size-1.5 flex-none rounded-full", NOTIFICATION_STATUS_DOTS[status] ?? "bg-muted-foreground/40")} aria-hidden />
      {NOTIFICATION_STATUS_LABELS[status] ?? status}
      {deliveryText && <span className="font-mono tabular-nums">{deliveryText}</span>}
    </span>
  );
}
