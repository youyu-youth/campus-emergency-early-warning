import type { NotificationDTO, TaskDTO, TimelineNodeDTO } from "@/lib/drill-types";
import { ROLE_LABELS } from "@/simulation/state-machines";
import { cn } from "@/lib/utils";

const TASK_STATUS: Record<string, { label: string; dot: string }> = {
  pending_confirmation: { label: "待确认", dot: "bg-[oklch(0.75_0.15_70)]" },
  executing: { label: "执行中", dot: "bg-[oklch(0.55_0.15_150)]" },
  done: { label: "已完成", dot: "bg-muted-foreground/50" },
  failed: { label: "失败", dot: "bg-severity-i" },
  cancelled: { label: "已取消", dot: "bg-muted-foreground/50" },
};

const AUDIENCE_LABELS: Record<string, string> = {
  staff_students: "师生",
  parents: "家长",
};

function durationLabel(ms?: number): string {
  if (ms === undefined) return "";
  const minutes = Math.round(ms / 60_000);
  return `${minutes}m`;
}

/** 右栏 · 任务与记录:按角色分组的任务列表(行灯+耗时) + 操作记录审计流 */
export function TaskRecordPanel({
  tasks,
  timeline,
  notifications,
  className,
}: {
  tasks: TaskDTO[];
  timeline: TimelineNodeDTO[];
  notifications: NotificationDTO[];
  className?: string;
}) {
  const operatorLog = timeline.filter((n) => n.nodeType === "operator_action");

  return (
    <aside className={cn("flex flex-col gap-5 overflow-hidden", className)}>
      <div className="flex min-h-0 flex-[3] flex-col overflow-hidden rounded-md border border-border bg-card">
        <div className="flex h-9 flex-none items-center border-b border-border px-3 text-xs font-bold">
          任务列表<span className="ml-1.5 font-normal text-muted-foreground/70">{tasks.length}</span>
        </div>
        <ul className="overflow-y-auto">
          {tasks.length === 0 && <li className="px-3 py-4 text-xs text-muted-foreground">尚未派发任务</li>}
          {tasks.map((task) => {
            const status = TASK_STATUS[task.status] ?? { label: task.status, dot: "bg-muted-foreground/50" };
            return (
              <li key={task.id} className="border-b border-border/60 px-3 py-2.5 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="rounded-sm border border-border px-1.5 py-px text-[11px] text-muted-foreground">
                    {ROLE_LABELS[task.role as keyof typeof ROLE_LABELS] ?? task.role}
                  </span>
                  <b className="min-w-0 flex-1 truncate text-[13px] font-semibold" title={task.description}>
                    {task.title}
                  </b>
                  <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className={cn("size-2 rounded-full", status.dot)} aria-hidden />
                    {status.label}
                  </span>
                </div>
                <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground" title={task.description}>
                  {task.description}
                </p>
                {task.result?.durationMs !== undefined && (
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground tabular-nums">
                    耗时 {durationLabel(task.result.durationMs)}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex min-h-0 flex-[2] flex-col overflow-hidden rounded-md border border-border bg-card">
        <div className="flex h-9 flex-none items-center border-b border-border px-3 text-xs font-bold">操作记录</div>
        <ul className="overflow-y-auto">
          {operatorLog.length === 0 && <li className="px-3 py-4 text-xs text-muted-foreground">暂无人工干预</li>}
          {operatorLog.map((node) => (
            <li key={node.id} className="border-b border-border/60 px-3 py-2 text-[13px] leading-relaxed last:border-0">
              <time className="mr-2 font-mono text-[11px] text-muted-foreground tabular-nums">
                {node.simTime.slice(11, 19)}
              </time>
              {node.title}
            </li>
          ))}
        </ul>
      </div>

      {notifications.length > 0 && (
        <div className="flex min-h-0 flex-[2] flex-col overflow-hidden rounded-md border border-border bg-card">
          <div className="flex h-9 flex-none items-center border-b border-border px-3 text-xs font-bold">通知与送达</div>
          <ul className="overflow-y-auto">
            {notifications.map((n) => (
              <li key={n.id} className="border-b border-border/60 px-3 py-2 last:border-0">
                <div className="flex items-center gap-2 text-[13px]">
                  <span className="rounded-sm border border-border px-1.5 py-px text-[11px] text-muted-foreground">
                    {AUDIENCE_LABELS[n.audience] ?? n.audience}
                  </span>
                  <b className="min-w-0 flex-1 truncate font-semibold">{n.title}</b>
                  <span className="text-[11px] text-muted-foreground">
                    {n.status === "published_sim" && n.delivery
                      ? `已发布 ${n.delivery.delivered ?? 0}/${n.delivery.total ?? 0}`
                      : n.status === "failed"
                        ? "模拟失败"
                        : "待确认"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
