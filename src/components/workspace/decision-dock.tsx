"use client";

import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";

import { SeverityBadge } from "@/components/status/severity-badge";
import type { PendingConfirmationDTO } from "@/lib/drill-types";
import { SEVERITY_LABELS, ROLE_LABELS, type EventSeverity } from "@/simulation/state-machines";
import { cn } from "@/lib/utils";

/** 底部 · 决策坞:关键节点暂停时升起,展示建议与依据,操作员确认或调整后推演继续 */
export function DecisionDock({
  drillId,
  pending,
  onDone,
}: {
  drillId: string;
  pending: PendingConfirmationDTO;
  onDone: () => Promise<void> | void;
}) {
  const [submitting, setSubmitting] = useState<"confirm" | EventSeverity | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (body: Record<string, unknown>, tag: "confirm" | EventSeverity | "reject") => {
    setSubmitting(tag);
    setError(null);
    try {
      const res = await fetch(`/api/drills/${drillId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? `提交失败(${res.status})`);
        return;
      }
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "网络错误,请重试");
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <section
      aria-label="决策坞"
      className="flex-none border-t-2 border-primary/60 bg-card px-6 py-4 shadow-[0_-6px_24px_oklch(0.25_0.03_262_/_0.10)]"
    >
      {pending.kind === "grading" && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold tracking-widest text-primary">⚑ 决策坞 · 事件定级</span>
            <span className="text-[13px] text-muted-foreground">指挥调度建议:</span>
            <SeverityBadge severity={pending.suggested} size="md" />
          </div>
          {pending.reasoning && (
            <p className="min-w-0 flex-1 basis-64 text-[13px] leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">依据:</span>
              {pending.reasoning}
            </p>
          )}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">调整等级:</span>
            {(["I", "II", "III", "IV"] as const)
              .filter((s) => s !== pending.suggested)
              .map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={submitting !== null}
                  onClick={() => void submit({ kind: "grading", severity: s }, s)}
                  className="rounded-sm border border-input px-2.5 py-1 text-xs transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
                >
                  {SEVERITY_LABELS[s]}
                </button>
              ))}
          </div>
          <button
            type="button"
            disabled={submitting !== null}
            onClick={() => void submit({ kind: "grading" }, "confirm")}
            className="flex h-9 items-center gap-2 rounded-sm bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:brightness-110 disabled:opacity-50"
          >
            {submitting === "confirm" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
            采纳建议
          </button>
        </div>
      )}

      {pending.kind === "dispatch" && (
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="text-xs font-bold tracking-widest text-primary">
              ⚑ 决策坞 · {pending.dispatchKind === "initial" ? "任务方案确认" : "里程碑加派确认"}
            </span>
            <table className="w-full max-w-2xl border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-1 pr-3 font-normal">角色</th>
                  <th className="py-1 pr-3 font-normal">任务</th>
                  <th className="py-1 font-normal">说明</th>
                </tr>
              </thead>
              <tbody>
                {pending.proposedTasks.map((task, i) => (
                  <tr key={i} className="border-b border-border/60 last:border-0">
                    <td className="py-1.5 pr-3 text-muted-foreground">{ROLE_LABELS[task.role]}</td>
                    <td className="py-1.5 pr-3 font-semibold">{task.title}</td>
                    <td className="py-1.5 text-muted-foreground">{task.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pending.reasoning && (
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground">依据:</span>
                {pending.reasoning}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={submitting !== null}
              onClick={() => void submit({ kind: "dispatch" }, "confirm")}
              className="flex h-9 items-center gap-2 rounded-sm bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:brightness-110 disabled:opacity-50"
            >
              {submitting === "confirm" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
              确认执行
            </button>
            {pending.dispatchKind === "redispatch" && (
              <button
                type="button"
                disabled={submitting !== null}
                onClick={() => void submit({ kind: "dispatch", tasks: [] }, "reject")}
                className="flex h-9 items-center justify-center gap-2 rounded-sm border border-input px-4 text-sm transition-colors hover:border-destructive hover:text-destructive disabled:opacity-50"
              >
                {submitting === "reject" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <X className="size-4" aria-hidden />}
                拒绝加派
              </button>
            )}
          </div>
        </div>
      )}

      {pending.kind === "notification" && (
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="text-xs font-bold tracking-widest text-primary">⚑ 决策坞 · 通知发布确认(模拟分发)</span>
            {pending.drafts.map((draft) => (
              <div key={draft.id} className="relative max-w-2xl rounded-sm border border-border bg-secondary/40 px-3 py-2.5">
                <div className="flex items-center gap-2 text-[13px]">
                  <span className="rounded-sm border border-border bg-card px-1.5 py-px text-[11px] text-muted-foreground">
                    {draft.audience === "staff_students" ? "师生" : "家长"}
                  </span>
                  <b className="font-semibold">{draft.title}</b>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{draft.content}</p>
                <span
                  className={cn(
                    "pointer-events-none absolute right-2 top-2 rotate-6 rounded-sm border-2 border-severity-ii/50 px-1.5 text-[10px] font-bold tracking-[0.3em] text-severity-ii/50",
                  )}
                  aria-hidden
                >
                  模拟演练
                </span>
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={submitting !== null}
            onClick={() => void submit({ kind: "notification" }, "confirm")}
            className="flex h-9 items-center gap-2 rounded-sm bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:brightness-110 disabled:opacity-50"
          >
            {submitting === "confirm" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
            确认发布(模拟)
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-[13px] text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
