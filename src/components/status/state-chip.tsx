import { cn } from "@/lib/utils";
import type { DrillStatus } from "@/simulation/state-machines";

/** 演练状态机标签:文字永远在场,色调只做辅助(推演中靛青/待确认琥珀/完成绿) */
const STATUS_META: Record<DrillStatus, { label: string; chip: string }> = {
  draft: { label: "准备中", chip: "bg-secondary text-secondary-foreground" },
  running: { label: "推演中", chip: "bg-primary/10 font-semibold text-primary" },
  paused: { label: "已暂停", chip: "bg-secondary text-secondary-foreground" },
  awaiting_confirmation: {
    label: "等待确认",
    chip: "bg-[oklch(0.75_0.15_70/0.18)] font-medium text-[oklch(0.5_0.12_70)]",
  },
  completed: {
    label: "已完成",
    chip: "bg-[oklch(0.55_0.15_150/0.14)] text-[oklch(0.42_0.13_150)]",
  },
  aborted: { label: "已终止", chip: "bg-muted text-muted-foreground" },
};

/** 状态机标签(docs/design.md §5):演练状态 → 中文标签 chip */
export function StateChip({ status, className }: { status: DrillStatus; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn("inline-flex items-center whitespace-nowrap rounded-sm px-2 py-0.5 text-xs", meta.chip, className)}
    >
      {meta.label}
    </span>
  );
}
