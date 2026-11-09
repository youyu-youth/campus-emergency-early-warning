import { cn } from "@/lib/utils";

const VARIANT = {
  /** 壳层(深藏青底)上的亮橙描边徽标 */
  shell: "border-[oklch(0.75_0.14_50)] text-[oklch(0.8_0.13_50)]",
  /** 浅色画布上的深橙描边徽标 */
  canvas: "border-severity-ii text-[oklch(0.55_0.16_45)]",
} as const;

/** 「模拟演练」常驻标识:所有演练相关界面必须携带,避免与真实警情混淆 */
export function DrillTag({
  variant = "canvas",
  className,
}: {
  variant?: keyof typeof VARIANT;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-1.5 text-[10px] leading-[17px] font-medium tracking-[0.2em]",
        VARIANT[variant],
        className,
      )}
    >
      模拟演练
    </span>
  );
}
