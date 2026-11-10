"use client";

import { FileText, Loader2, Megaphone, RotateCcw, Send } from "lucide-react";

import { SeverityBadge } from "@/components/status/severity-badge";
import type { DrillDetailDTO, NotificationDTO } from "@/lib/drill-types";
import { cn } from "@/lib/utils";
import { AUDIENCE_LABELS, NOTIFICATION_STATUS_LABELS, SOURCE_LABELS, simTimeLabel } from "./notification-meta";

/** 详情抽屉小节标题条(与监测页信号详情同一节奏) */
function DrawerSection({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Megaphone;
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

/**
 * 通知全文预览(docs/design.md §4.5)三段:
 * 公告式排版预览(宋体+「模拟演练」水印)→ 生成依据 → 逐次分发记录(含失败重试入口)
 */
export function NotificationPreview({
  notification,
  event,
  retryable,
  retryBusy,
  retryError,
  onRetry,
  className,
}: {
  notification: NotificationDTO | null;
  event: DrillDetailDTO["event"];
  /** 服务端真值:存在失败通知且运行器仍绑定本演练(detail 接口已综合) */
  retryable: boolean;
  retryBusy: boolean;
  retryError: string | null;
  onRetry: () => void;
  className?: string;
}) {
  if (!notification) {
    return (
      <aside
        className={cn("flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card", className)}
        aria-label="通知详情"
      >
        <div className="flex h-9 flex-none items-center border-b border-border px-3 text-xs font-bold">通知详情</div>
        <p className="flex flex-1 items-center justify-center px-6 py-12 text-center text-[13px] text-muted-foreground">
          在左侧列表中点选一份通知,查看公告预览、生成依据与分发记录。
        </p>
      </aside>
    );
  }

  const audience = AUDIENCE_LABELS[notification.audience] ?? notification.audience;
  const showRetry = notification.status === "failed" && retryable;

  return (
    <aside
      className={cn("flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card", className)}
      aria-label="通知详情"
    >
      <div className="flex h-9 flex-none items-center gap-2 border-b border-border px-3 text-xs font-bold">
        通知详情
        <span className="ml-auto text-[11px] font-normal text-muted-foreground">{audience}通知</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* ① 公告式排版预览:宋体标题/正文(DESIGN.md 公文发布法则),水印贴纸复用决策坞视觉 */}
        <DrawerSection icon={FileText} title="公告预览（模拟）">
          <article className="relative rounded-sm border border-border bg-secondary/40 px-4 py-3.5">
            <span
              className="pointer-events-none absolute right-2 top-2 rotate-6 rounded-sm border-2 border-severity-ii/50 px-1.5 text-[10px] font-bold tracking-[0.3em] text-severity-ii/50"
              aria-hidden
            >
              模拟演练
            </span>
            <h4 className="font-heading pr-16 text-center text-[15px] font-bold leading-snug">{notification.title}</h4>
            <p className="font-heading mt-2.5 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">
              {notification.content}
            </p>
            <p className="mt-3 text-right text-[11px] text-muted-foreground">
              受众:{audience}
              {notification.publishedSimTime && (
                <>
                  {" · "}
                  <time className="font-mono tabular-nums">{simTimeLabel(notification.publishedSimTime)}</time> 发布(模拟)
                </>
              )}
            </p>
          </article>
        </DrawerSection>

        {/* ② 生成依据 */}
        <DrawerSection icon={Megaphone} title="生成依据">
          <dl className="space-y-2">
            <Field label="关联事件">{event?.title ?? "—"}</Field>
            <Field label="事件等级">
              {event?.severity ? <SeverityBadge severity={event.severity} size="sm" /> : "未定级"}
            </Field>
            <Field label="生成时刻(模拟)">
              {notification.draftSimTime ? (
                <span className="font-mono text-xs tabular-nums">{simTimeLabel(notification.draftSimTime)}</span>
              ) : (
                "—"
              )}
            </Field>
            <Field label="文案来源">
              {notification.source ? (SOURCE_LABELS[notification.source] ?? notification.source) : "—"}
            </Field>
          </dl>
          {notification.source === "degraded" && (
            <p className="mt-2.5 rounded-sm border border-[oklch(0.75_0.15_70/0.45)] bg-[oklch(0.75_0.15_70/0.08)] px-3 py-2 text-[11px] leading-relaxed text-[oklch(0.5_0.12_70)]">
              ⚠ 模型超时或输出无效,以上为按受众模板生成的规则默认文案(降级),文案仍强制携带「模拟演练」标识。
            </p>
          )}
        </DrawerSection>

        {/* ③ 逐次分发记录 */}
        <DrawerSection icon={Send} title="分发记录（模拟送达）">
          {notification.publishes.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              {notification.status === "pending_confirmation"
                ? "尚未发布,等待操作员在工作区决策坞确认。"
                : "尚未发布。"}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {notification.publishes.map((record) => (
                <li
                  key={record.attempt}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-sm bg-secondary/50 px-3 py-2 text-[12px]"
                >
                  <span className="font-mono text-muted-foreground tabular-nums">第 {record.attempt} 次</span>
                  <span className={cn("flex items-center gap-1.5", record.status === "failed" && "font-medium text-severity-i")}>
                    {NOTIFICATION_STATUS_LABELS[record.status] ?? record.status}
                  </span>
                  <span className="ml-auto font-mono text-muted-foreground tabular-nums">
                    送达 {record.stats.delivered ?? 0}/{record.stats.total ?? 0}
                  </span>
                  <span className="w-full text-right font-mono text-[11px] text-muted-foreground/80 tabular-nums">
                    {record.publishedSimTime ? simTimeLabel(record.publishedSimTime) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {showRetry && (
            <div className="mt-3">
              <button
                type="button"
                disabled={retryBusy}
                onClick={onRetry}
                className="flex h-9 items-center gap-2 rounded-sm border border-primary px-4 text-sm font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
              >
                {retryBusy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RotateCcw className="size-4" aria-hidden />}
                重试发布(模拟)
              </button>
              {retryError && (
                <p role="alert" className="mt-1.5 text-[12px] text-destructive">
                  {retryError}
                </p>
              )}
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                每份通知至多重试一次(共两次尝试);重试结果将追加到时间线 ⚑ 通知节点。
              </p>
            </div>
          )}
        </DrawerSection>
      </div>
    </aside>
  );
}
