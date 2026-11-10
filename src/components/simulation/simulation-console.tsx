"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Ban, Loader2, Pause, Play, RotateCcw } from "lucide-react";

import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { DrillTag } from "@/components/status/drill-tag";
import { SimClock } from "@/components/status/sim-clock";
import { StateChip } from "@/components/status/state-chip";
import type { DrillDetailDTO, PendingConfirmationDTO } from "@/lib/drill-types";
import { cn } from "@/lib/utils";
import { PHASE_LABELS, PHASE_ORDER } from "@/simulation/state-machines";
import type { ScenarioCardDTO } from "@/lib/drill-types";

const POLL_INTERVAL_MS = 2000;
const SPEED_STEPS = [1, 2, 4, 8] as const;

const PENDING_KIND_LABELS: Record<PendingConfirmationDTO["kind"], string> = {
  grading: "事件定级",
  dispatch: "任务方案",
  notification: "通知发布",
};

/** 运行态控制台(docs/design.md §4.3):场景参数只读 + 暂停/恢复/倍速/重置/终止 + 五阶段进度条。
 *  重置语义:当前演练终止留痕,同配置同种子新开一场(跳转新工作区)。 */
export function SimulationConsole({
  drillId,
  scenarios,
  onExited,
}: {
  drillId: string;
  scenarios: ScenarioCardDTO[];
  /** 终态后「返回发起配置」回调:通知宿主重查活跃演练,切回空闲态 */
  onExited: () => void;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<DrillDetailDTO | null>(null);
  const [missing, setMissing] = useState(false);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"restart" | "abort" | null>(null);

  const status = detail?.drill.status;
  const terminal = status === "completed" || status === "aborted";

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/drills/${drillId}`, { cache: "no-store" });
      if (res.status === 404) {
        setMissing(true);
        return;
      }
      setDetail((await res.json()) as DrillDetailDTO);
      setStale(false);
    } catch {
      // 断线容忍:保留上一拍内容,等待下一拍
      setStale(true);
    }
  }, [drillId]);

  useEffect(() => {
    if (missing || terminal) return; // 不存在/终态:数据不再变化,停止轮询
    let cancelled = false;
    const guarded = async () => {
      if (!cancelled) await poll();
    };
    queueMicrotask(() => void guarded());
    const timer = setInterval(() => void guarded(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [poll, missing, terminal]);

  const control = async (action: string, extra?: Record<string, unknown>) => {
    setBusy(action);
    try {
      const res = await fetch(`/api/drills/${drillId}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = (await res.json()) as { drillId?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `操作失败(${res.status})`);
      return data;
    } finally {
      setBusy(null);
    }
  };

  const togglePause = async () => {
    if (!detail || busy) return;
    await control(status === "paused" ? "resume" : "pause");
    await poll();
  };

  const changeSpeed = async (step: number) => {
    if (busy || step === detail?.drill.speed) return;
    await control("set_speed", { speed: step });
    await poll();
  };

  const confirmRestart = async () => {
    const data = await control("restart");
    if (data?.drillId) router.push(`/command?drill=${data.drillId}`);
    else await poll(); // 未拿到新 id 的兜底:就地刷新
  };

  const confirmAbort = async () => {
    await control("abort");
    await poll();
  };

  if (!detail) {
    if (missing) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-20 text-center">
          <p className="text-sm text-muted-foreground">演练 {drillId} 不存在或已被清理。</p>
          <button
            type="button"
            onClick={onExited}
            className="h-9 rounded-sm bg-primary px-4 text-sm font-medium text-primary-foreground hover:brightness-110"
          >
            返回发起配置
          </button>
        </div>
      );
    }
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-20" role="status" aria-label="加载演练详情">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  const scenarioCard = scenarios.find((s) => s.key === detail.drill.scenarioKey);
  const awaiting = status === "awaiting_confirmation";
  const currentSpeed = detail.drill.speed;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-6 py-6">
      {/* 头部:演练标识 + 模拟钟 + 五阶段进度条 */}
      <section aria-label="演练概要" className="rounded-md border border-border bg-card px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="font-heading text-lg font-bold">{detail.drill.name}</h2>
          <StateChip status={detail.drill.status} />
          <DrillTag />
          <div className="ml-auto flex items-center gap-2.5">
            <span className="text-[11px] text-muted-foreground">模拟</span>
            <SimClock label={detail.drill.simClockLabel} className="text-base" />
            <span className="font-mono text-xs text-muted-foreground tabular-nums">{currentSpeed}×</span>
          </div>
        </div>
        <ol className="mt-4 flex gap-1" aria-label="推演阶段进度">
          {PHASE_ORDER.map((phase) => {
            const current = phase === detail.phase;
            const done = PHASE_ORDER.indexOf(phase) < PHASE_ORDER.indexOf(detail.phase);
            return (
              <li
                key={phase}
                className={cn(
                  "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-sm text-xs",
                  done && "bg-primary text-primary-foreground",
                  current && "border border-primary bg-primary/10 font-semibold text-primary",
                  !done && !current && "border border-border text-muted-foreground",
                )}
              >
                {current && <span className="size-1.5 animate-pulse rounded-full bg-primary" aria-hidden />}
                {PHASE_LABELS[phase]}
              </li>
            );
          })}
        </ol>
      </section>

      {stale && !terminal && (
        <p
          role="status"
          className="mt-5 rounded-sm border border-border bg-secondary/50 px-4 py-2 text-xs text-muted-foreground"
        >
          连接中断,显示的可能是滞后数据,正在自动重试…
        </p>
      )}

      {terminal ? (
        <div
          className={cn(
            "mt-5 flex flex-wrap items-center gap-3 rounded-md border px-4 py-3 text-[13px]",
            status === "completed"
              ? "border-[oklch(0.55_0.15_150/0.45)] bg-[oklch(0.55_0.15_150/0.06)]"
              : "border-border bg-secondary/40",
          )}
        >
          <span className="font-medium">
            {status === "completed" ? "演练已完成,复盘报告已生成。" : "演练已终止,未生成复盘报告。"}
          </span>
          {status === "completed" && (
            <Link
              href={`/reports/${drillId}`}
              className="text-sm font-medium text-primary hover:brightness-110"
            >
              查看复盘报告 →
            </Link>
          )}
          <button
            type="button"
            onClick={onExited}
            className="ml-auto h-8 rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:brightness-110"
          >
            返回发起配置
          </button>
        </div>
      ) : (
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {/* 场景参数只读 */}
          <section aria-label="场景参数" className="rounded-md border border-border bg-card p-5">
            <h3 className="text-xs font-bold tracking-widest text-muted-foreground">场景参数(只读)</h3>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-[13px]">
              <dt className="text-muted-foreground">场景</dt>
              <dd className="font-medium">{detail.drill.scenarioName}</dd>
              <dt className="text-muted-foreground">地点</dt>
              <dd>{detail.event?.location ?? scenarioCard?.location ?? "—"}</dd>
              <dt className="text-muted-foreground">随机种子</dt>
              <dd className="font-mono tabular-nums">{detail.drill.seed}</dd>
              <dt className="text-muted-foreground">确认模式</dt>
              <dd>
                {detail.drill.autoConfirm ? "全自动(跳过人工确认)" : "人工确认(定级 / 任务方案 / 通知发布)"}
              </dd>
            </dl>
          </section>

          {/* 时钟控制 */}
          <section aria-label="时钟控制" className="rounded-md border border-border bg-card p-5">
            <h3 className="text-xs font-bold tracking-widest text-muted-foreground">时钟控制</h3>
            {awaiting && detail.pendingConfirmation && (
              <p className="mt-3 rounded-sm border border-[oklch(0.75_0.15_70/0.45)] bg-[oklch(0.75_0.15_70/0.08)] px-3 py-2 text-xs leading-relaxed text-[oklch(0.5_0.12_70)]">
                ⚑ 推演停在人工确认点:{PENDING_KIND_LABELS[detail.pendingConfirmation.kind]}
                ——确认点本身已暂停时钟,请到
                <Link href={`/command?drill=${drillId}`} className="font-medium underline underline-offset-2">
                  工作区
                </Link>
                处理后继续。
              </p>
            )}
            <div className="mt-4 flex flex-wrap items-start gap-x-8 gap-y-4">
              <div>
                <span className="mb-1.5 block text-[11px] text-muted-foreground">推演</span>
                <button
                  type="button"
                  onClick={() => void togglePause()}
                  disabled={busy !== null || awaiting}
                  title={awaiting ? "确认点已暂停推演,请到工作区处理" : undefined}
                  className="flex h-9 items-center gap-2 rounded-sm border border-primary px-4 text-sm text-foreground transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === "pause" || busy === "resume" ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : status === "paused" ? (
                    <Play className="size-4" aria-hidden />
                  ) : (
                    <Pause className="size-4" aria-hidden />
                  )}
                  {status === "paused" ? "恢复" : "暂停"}
                </button>
                {status === "paused" && <p className="mt-1.5 text-[11px] text-muted-foreground">模拟时钟已冻结</p>}
              </div>
              <div>
                <span className="mb-1.5 block text-[11px] text-muted-foreground">倍速</span>
                <div className="flex gap-1.5">
                  {SPEED_STEPS.map((step) => {
                    const active = step === currentSpeed;
                    return (
                      <button
                        key={step}
                        type="button"
                        aria-pressed={active}
                        onClick={() => void changeSpeed(step)}
                        disabled={busy !== null}
                        className={cn(
                          "flex h-9 w-12 items-center justify-center rounded-sm border font-mono text-sm tabular-nums transition-colors disabled:opacity-50",
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input hover:border-primary hover:text-primary",
                        )}
                      >
                        {step}×
                      </button>
                    );
                  })}
                </div>
                {!(SPEED_STEPS as readonly number[]).includes(currentSpeed) && (
                  <p className="mt-1.5 font-mono text-[11px] text-muted-foreground tabular-nums">
                    当前 {currentSpeed}×(发起时自定义)
                  </p>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {/* 危险操作区:与普通操作分区放置,终止/重置均需二次确认 */}
      {!terminal && (
        <section
          aria-label="危险操作"
          className="mt-8 max-w-3xl rounded-md border border-destructive/40 bg-destructive/5 p-5"
        >
          <div className="flex items-center gap-2 text-sm font-bold text-destructive">
            <AlertTriangle className="size-4" aria-hidden />
            危险操作
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
            重置:当前演练立即终止留痕,并以相同场景、随机种子 {detail.drill.seed} 与当前倍速重新开始一场新演练。
            终止:结束当前演练,不生成复盘报告。两者都会保留在演练历史中,不可撤销。
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setDialog("restart")}
              disabled={busy !== null}
              className="flex h-9 items-center gap-2 rounded-sm border border-destructive px-4 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
            >
              <RotateCcw className="size-4" aria-hidden />
              重置演练
            </button>
            <button
              type="button"
              onClick={() => setDialog("abort")}
              disabled={busy !== null}
              className="flex h-9 items-center gap-2 rounded-sm bg-destructive px-4 text-sm font-medium text-white transition-colors hover:brightness-110 disabled:opacity-50"
            >
              <Ban className="size-4" aria-hidden />
              终止演练
            </button>
          </div>
        </section>
      )}

      <ConfirmDialog
        open={dialog === "restart"}
        title="重置演练"
        description={`当前演练「${detail.drill.name}」将标记为终止(保留在演练历史中),并立即以相同场景、随机种子 ${detail.drill.seed} 与当前倍速重新开始一场新演练。此操作不可撤销。`}
        confirmLabel="重置并重新开始"
        onConfirm={confirmRestart}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === "abort"}
        title="终止演练"
        description={`确定终止演练「${detail.drill.name}」?已产生的信号、事件与处置进度将保留记录,但不会生成复盘报告。此操作不可撤销。`}
        confirmLabel="确认终止"
        onConfirm={confirmAbort}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}
