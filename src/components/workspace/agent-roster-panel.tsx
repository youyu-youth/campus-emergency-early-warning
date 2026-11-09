import type { AgentStatusDTO } from "@/lib/drill-types";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<AgentStatusDTO["status"], string> = {
  standby: "待命",
  working: "工作中",
  executing: "执行中",
  done: "已完成",
};

/** 编队行状态灯(永远配文字):工作中靛青 / 执行中绿 / 待命灰 / 完成灰+对勾 */
const STATUS_DOT: Record<AgentStatusDTO["status"], string> = {
  standby: "bg-muted-foreground/50",
  working: "bg-primary",
  executing: "bg-[oklch(0.55_0.15_150)]",
  done: "bg-[oklch(0.55_0.15_150)]",
};

/** 左栏 · 智能体编队:状态灯 + 当前动作一句话;活跃行满亮、空闲行压暗(行级 dimming) */
export function AgentRosterPanel({ agents, className }: { agents: AgentStatusDTO[]; className?: string }) {
  return (
    <aside className={cn("flex flex-col overflow-hidden rounded-md border border-border bg-card", className)}>
      <div className="flex h-9 flex-none items-center border-b border-border px-3 text-xs font-bold">
        智能体编队<span className="ml-1.5 font-normal text-muted-foreground/70">{agents.length}</span>
      </div>
      <ul className="overflow-y-auto">
        {agents.map((agent) => {
          const dim = agent.status === "standby";
          return (
            <li
              key={agent.key}
              className={cn(
                "flex min-h-11 items-start gap-2.5 border-b border-border/60 px-3 py-2 last:border-0",
                dim && "opacity-55",
              )}
            >
              <span className={cn("mt-1.5 size-2 flex-none rounded-full", STATUS_DOT[agent.status])} aria-hidden />
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <b className="text-[13px] font-semibold">{agent.label}</b>
                  <span className="text-[11px] text-muted-foreground">{STATUS_LABELS[agent.status]}</span>
                </div>
                {agent.latestAction && (
                  <p className="mt-0.5 truncate text-[11px] leading-relaxed text-muted-foreground" title={agent.latestAction}>
                    {agent.latestAction}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
