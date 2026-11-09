import { ShieldAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { SEVERITY_LABELS, type EventSeverity } from "@/simulation/state-machines";

/** 信号牌字色:Ⅱ/Ⅲ 橙黄亮度高,牌上用墨字保证对比;Ⅰ/Ⅳ 深底用白字 */
const TONE: Record<EventSeverity, string> = {
  I: "bg-severity-i text-white",
  II: "bg-severity-ii text-severity-ink",
  III: "bg-severity-iii text-severity-ink",
  IV: "bg-severity-iv text-white",
};

const SIZE = {
  sm: "gap-1 px-2 py-0.5 text-xs font-semibold",
  md: "gap-2 rounded-md px-3.5 py-1.5 text-base font-extrabold",
} as const;

const ICON = {
  sm: "size-3.5",
  md: "size-4",
} as const;

/** 等级信号牌:色牌 + 图标 + 文字,红Ⅰ/橙Ⅱ/黄Ⅲ/蓝Ⅳ只在此处与告警处出现 */
export function SeverityBadge({
  severity,
  size = "sm",
  className,
}: {
  severity: EventSeverity;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-heading inline-flex animate-plate-in items-center rounded font-bold tracking-wide motion-reduce:animate-none",
        TONE[severity],
        SIZE[size],
        className,
      )}
    >
      <ShieldAlert className={ICON[size]} aria-hidden />
      {SEVERITY_LABELS[severity]}
    </span>
  );
}
