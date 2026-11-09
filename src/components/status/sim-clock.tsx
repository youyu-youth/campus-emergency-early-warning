import { cn } from "@/lib/utils";

const SIZE = {
  sm: "text-sm",
  md: "text-lg font-semibold",
} as const;

/** 模拟时钟(全局唯一时钟源显示件):等宽数字体现仪表感,跳动由数据侧驱动 */
export function SimClock({
  label,
  size = "md",
  className,
}: {
  /** HH:mm:ss 显示值 */
  label: string;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  return (
    <time
      aria-label={`模拟时钟 ${label}`}
      className={cn("font-mono tracking-wider tabular-nums", SIZE[size], className)}
    >
      {label}
    </time>
  );
}
