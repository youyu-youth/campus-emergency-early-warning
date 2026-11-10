import Link from "next/link";
import { ArrowRight, FileWarning, RadioTower, ScanSearch } from "lucide-react";

import { SeverityBadge } from "@/components/status/severity-badge";
import type { DrillDetailDTO, SignalDTO } from "@/lib/drill-types";
import { cn } from "@/lib/utils";
import { EVENT_TYPE_LABELS, PAYLOAD_KEY_LABELS, SIGNAL_TYPE_LABELS, SOURCE_ICONS, SOURCE_LABELS, simTimeLabel } from "./signal-meta";

/** 详情抽屉小节标题条(与卡片列表页统一节奏) */
function DrawerSection({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof RadioTower;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-border/60 px-4 py-3.5 last:border-0">
      <h3 className="flex items-center gap-1.5 text-xs font-bold tracking-widest text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        {title}
      </h3>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-4">
      <dt className="flex-none text-[11px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right text-[13px]" title={typeof children === "string" ? children : undefined}>
        {children}
      </dd>
    </div>
  );
}

/** payload 原始值格式化:布尔 → 是/否,其余 String */
function formatPayloadValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
}

/**
 * 信号详情抽屉(docs/design.md §4.2)三段式:
 * 原始数据(等宽)→ 感知 Agent 提取(位置/类型/时间/证据)→ 上报结果与事件跳转
 */
export function SignalDetailDrawer({
  signal,
  event,
  drillId,
  className,
}: {
  signal: SignalDTO | null;
  event: DrillDetailDTO["event"];
  drillId: string;
  className?: string;
}) {
  if (!signal) {
    return (
      <aside
        className={cn("flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card", className)}
        aria-label="信号详情"
      >
        <div className="flex h-9 flex-none items-center border-b border-border px-3 text-xs font-bold">信号详情</div>
        <p className="flex flex-1 items-center justify-center px-6 py-12 text-center text-[13px] text-muted-foreground">
          在左侧信号流中点选一条信号,查看原始数据、感知解读与上报结果。
        </p>
      </aside>
    );
  }

  const SourceIcon = SOURCE_ICONS[signal.sourceKind];
  const perception = signal.perception;
  const payloadEntries = Object.entries(signal.payload);

  return (
    <aside
      className={cn("flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card", className)}
      aria-label="信号详情"
    >
      <div className="flex h-9 flex-none items-center gap-2 border-b border-border px-3 text-xs font-bold">
        信号详情
        <span className="ml-auto font-mono text-[11px] font-normal text-muted-foreground">{signal.sourceRef}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* ① 原始数据:模拟设备读数,等宽展示 */}
        <DrawerSection icon={RadioTower} title="原始数据（模拟设备）">
          <dl className="space-y-2">
            <Field label="设备编号">
              <span className="font-mono text-xs tabular-nums">{signal.sourceRef}</span>
            </Field>
            <Field label="来源">
              <span className="inline-flex items-center gap-1.5">
                {SourceIcon && <SourceIcon className="size-3.5 text-muted-foreground" aria-hidden />}
                {SOURCE_LABELS[signal.sourceKind] ?? signal.sourceKind}
              </span>
            </Field>
            <Field label="位置">{signal.location}</Field>
            <Field label="信号类型">{SIGNAL_TYPE_LABELS[signal.signalType] ?? signal.signalType}</Field>
            <Field label="检测时间(模拟)">
              <span className="font-mono text-xs tabular-nums">{simTimeLabel(signal.simTime)}</span>
            </Field>
            <Field label="置信度">
              <span className="font-mono text-xs tabular-nums">{Math.round(signal.confidence * 100)}%</span>
            </Field>
          </dl>
          {payloadEntries.length > 0 && (
            <dl className="mt-3 space-y-1.5 rounded-sm bg-secondary/50 px-3 py-2.5">
              {payloadEntries.map(([key, value]) => (
                <div key={key} className="flex items-baseline justify-between gap-4 font-mono text-[11px] tabular-nums">
                  <dt className="flex-none text-muted-foreground">{PAYLOAD_KEY_LABELS[key] ?? key}</dt>
                  <dd className={cn("min-w-0 truncate text-right", key === "simulated" && value === true && "font-sans font-medium text-primary")}>
                    {key === "simulated" ? formatPayloadValue(value) : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </DrawerSection>

        {/* ② 感知 Agent 提取 */}
        <DrawerSection icon={ScanSearch} title="感知智能体解读">
          {!perception ? (
            <p className="text-[13px] text-muted-foreground">
              {signal.status === "new" || signal.status === "processing"
                ? "感知智能体正在解读该信号…"
                : "该信号未被解读(已忽略或未产生解读记录)。"}
            </p>
          ) : (
            <div className="space-y-3">
              {perception.degraded && (
                <p className="rounded-sm border border-[oklch(0.75_0.15_70/0.45)] bg-[oklch(0.75_0.15_70/0.08)] px-3 py-2 text-[11px] leading-relaxed text-[oklch(0.5_0.12_70)]">
                  ⚠ 模型超时或输出无效,以下为规则默认解读(降级上报)。
                </p>
              )}
              <p className="text-[13px] font-semibold">{perception.title}</p>
              <dl className="space-y-2">
                <Field label="判定位置">{perception.location}</Field>
                <Field label="事件类型">{EVENT_TYPE_LABELS[perception.eventType] ?? perception.eventType}</Field>
                <Field label="发生时间(模拟)">
                  <span className="font-mono text-xs tabular-nums">{perception.occurredTime}</span>
                </Field>
              </dl>
              <div>
                <p className="mb-1.5 text-[11px] text-muted-foreground">证据要点</p>
                <ul className="space-y-1">
                  {perception.evidence.map((item, i) => (
                    <li key={i} className="flex gap-2 text-[13px] leading-relaxed">
                      <span className="flex-none text-muted-foreground" aria-hidden>
                        ·
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-1.5 text-[11px] text-muted-foreground">解读依据</p>
                <p className="text-[13px] leading-relaxed text-foreground/90">{perception.reasoning}</p>
              </div>
            </div>
          )}
        </DrawerSection>

        {/* ③ 上报结果 */}
        <DrawerSection icon={FileWarning} title="上报结果">
          {!perception ? (
            <p className="text-[13px] text-muted-foreground">尚未上报,等待感知智能体完成解读。</p>
          ) : event ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {event.severity ? (
                  <SeverityBadge severity={event.severity} size="sm" />
                ) : (
                  <span className="text-xs font-medium text-muted-foreground">未定级</span>
                )}
                <span className="text-[13px] font-semibold">{event.title}</span>
              </div>
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                {perception.createdEvent
                  ? "本信号为首信号:感知智能体据此创建事件并上报,后续信号将作为补充证据并入。"
                  : "本信号作为补充证据并入当前事件。"}
              </p>
              <Link
                href={`/command?drill=${drillId}`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:brightness-110"
              >
                前往事件工作区
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">事件尚未生成。</p>
          )}
        </DrawerSection>
      </div>
    </aside>
  );
}
