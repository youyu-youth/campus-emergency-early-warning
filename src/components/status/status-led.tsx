import type { AgentStatusDTO } from "@/lib/drill-types";
import { cn } from "@/lib/utils";

/** 智能体状态灯:待命灰/工作中靛青/执行与完成绿;永远搭配文字使用(不靠颜色单独区分) */
const LED: Record<AgentStatusDTO["status"], string> = {
  standby: "bg-muted-foreground/50",
  working: "bg-primary",
  executing: "bg-[oklch(0.55_0.15_150)]",
  done: "bg-[oklch(0.55_0.15_150)]",
};

/** Agent 状态灯(docs/design.md §5),工作区编队与指挥台侧栏共用语言 */
export function StatusLed({ status, className }: { status: AgentStatusDTO["status"]; className?: string }) {
  return <span className={cn("size-2 flex-none rounded-full", LED[status], className)} aria-hidden />;
}
