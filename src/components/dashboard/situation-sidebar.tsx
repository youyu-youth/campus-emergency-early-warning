import { Radio, Video } from "lucide-react";

import { StatusLed } from "@/components/status/status-led";
import type { AgentStatusDTO, NotificationDTO, SignalDTO } from "@/lib/drill-types";
import { cn } from "@/lib/utils";

/** 信号来源图标:传感器/摄像头(模拟信号,PRODUCT.md 约束) */
const SOURCE_ICONS: Record<string, typeof Radio> = {
  sensor: Radio,
  camera: Video,
};

const SIGNAL_STATUS_LABELS: Record<string, string> = {
  new: "新信号",
  processing: "解读中",
  reported: "已上报",
  ignored: "已忽略",
};

const AGENT_STATUS_LABELS: Record<AgentStatusDTO["status"], string> = {
  standby: "待命",
  working: "工作中",
  executing: "执行中",
  done: "已完成",
};

const NOTIFICATION_STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  pending_confirmation: "待确认",
  published_sim: "已发布·模拟",
  failed: "模拟失败",
};

const AUDIENCE_LABELS: Record<string, string> = {
  staff_students: "师生",
  parents: "家长",
};

function simTimeLabel(iso: string): string {
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

function SectionShell({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col border-b border-border last:border-0">
      <div className="flex h-9 flex-none items-center justify-between px-3 text-xs font-bold">
        {title}
        {hint && <span className="font-mono text-[11px] font-normal text-muted-foreground tabular-nums">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

/** 等待推演的紧凑空态(侧栏三条共用) */
function WaitingRow() {
  return <p className="px-3 pb-3 text-[11px] leading-relaxed text-muted-foreground">等待推演开始</p>;
}

/** 右栏 · 系统态势侧栏(docs/design.md §4.1):监测信号摘要 / 智能体编队健康 / 通知送达统计 */
export function SituationSidebar({
  signals,
  agents,
  notifications,
  className,
}: {
  signals: SignalDTO[];
  agents: AgentStatusDTO[];
  notifications: NotificationDTO[];
  className?: string;
}) {
  const recentSignals = [...signals].slice(-6).reverse();
  const activeAgents = agents.filter((a) => a.status !== "standby").length;
  const published = notifications.filter((n) => n.status === "published_sim");
  const deliveryTotal = published.reduce((sum, n) => sum + (n.delivery?.total ?? 0), 0);
  const deliveryDone = published.reduce((sum, n) => sum + (n.delivery?.delivered ?? 0), 0);

  return (
    <aside
      className={cn("flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card", className)}
      aria-label="系统态势"
    >
      <SectionShell title="监测信号摘要" hint={signals.length > 0 ? `${signals.length} 条` : undefined}>
        {recentSignals.length === 0 ? (
          <WaitingRow />
        ) : (
          <ul className="max-h-44 overflow-y-auto pb-1">
            {recentSignals.map((signal) => {
              const Icon = SOURCE_ICONS[signal.sourceKind] ?? Radio;
              return (
                <li key={signal.id} className="flex min-h-8 items-center gap-2 border-b border-border/60 px-3 last:border-0">
                  <time className="font-mono text-[11px] text-muted-foreground tabular-nums">
                    {simTimeLabel(signal.simTime)}
                  </time>
                  <Icon className="size-3.5 flex-none text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-xs" title={`${signal.location} · ${signal.signalType}`}>
                    {signal.location}
                  </span>
                  <span className="flex-none text-[11px] text-muted-foreground">
                    {SIGNAL_STATUS_LABELS[signal.status] ?? signal.status}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </SectionShell>

      <SectionShell title="智能体集群" hint={agents.length > 0 ? `${activeAgents}/${agents.length} 活跃` : undefined}>
        {agents.length === 0 ? (
          <WaitingRow />
        ) : (
          <ul className="max-h-48 overflow-y-auto pb-1">
            {agents.map((agent) => (
              <li
                key={agent.key}
                className={cn(
                  "flex min-h-8 items-center gap-2 border-b border-border/60 px-3 last:border-0",
                  agent.status === "standby" && "opacity-55",
                )}
              >
                <StatusLed status={agent.status} />
                <span className="flex-none text-xs font-semibold">{agent.label}</span>
                <span className="min-w-0 flex-1 truncate text-right text-[11px] text-muted-foreground" title={agent.latestAction ?? undefined}>
                  {agent.latestAction ?? AGENT_STATUS_LABELS[agent.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionShell>

      <SectionShell
        title="通知送达"
        hint={deliveryTotal > 0 ? `${deliveryDone}/${deliveryTotal} 已送达` : undefined}
      >
        {notifications.length === 0 ? (
          <WaitingRow />
        ) : (
          <ul className="max-h-36 overflow-y-auto pb-1">
            {notifications.map((n) => (
              <li key={n.id} className="flex min-h-8 items-center gap-2 border-b border-border/60 px-3 last:border-0">
                <span className="flex-none text-xs font-semibold">{AUDIENCE_LABELS[n.audience] ?? n.audience}通知</span>
                <span className="min-w-0 flex-1 truncate text-right text-[11px] text-muted-foreground">
                  {n.status === "published_sim" && n.delivery
                    ? `已送达 ${n.delivery.delivered ?? 0}/${n.delivery.total ?? 0}`
                    : (NOTIFICATION_STATUS_LABELS[n.status] ?? n.status)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionShell>
    </aside>
  );
}
