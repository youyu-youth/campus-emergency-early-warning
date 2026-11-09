import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/** 确认戳:⚑ 节点经人工确认后盖下的小方戳(THESIS「确认是盖下去的戳」的载体,供工作区时间线使用) */
export function ConfirmStamp({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border border-primary px-1.5 py-px text-[10px] leading-4 font-medium text-primary",
        className,
      )}
    >
      <Check className="size-3" aria-hidden />
      已确认
    </span>
  );
}
