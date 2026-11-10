"use client";

import Link from "next/link";
import { ArrowRight, Check, Siren } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useShellDrill } from "@/components/shell/drill-context";
import { EmptyState } from "@/components/feedback/empty-state";
import { DrillTag } from "@/components/status/drill-tag";
import { SeverityBadge } from "@/components/status/severity-badge";
import { SimClock } from "@/components/status/sim-clock";
import { StateChip } from "@/components/status/state-chip";
import { DrillHistoryTable } from "./drill-history-table";
import { SituationSidebar } from "./situation-sidebar";
import type { DrillDetailDTO, DrillHistoryItemDTO } from "@/lib/drill-types";
import { cn } from "@/lib/utils";
import { PHASE_LABELS, type DrillPhase } from "@/simulation/state-machines";

const DETAIL_POLL_MS = 2000;

const PHASE_ORDER: DrillPhase[] = ["perception", "grading", "handling", "notification", "review"];

const ACTIVE_STATUSES = new Set(["running", "paused", "awaiting_confirmation"]);

/** 综合指挥台(docs/design.md §4.1):演练状态主面板 + 系统态势侧栏 + 演练历史表格。
 *  摘要直接消费壳层轮询(useShellDrill),活跃时另开详情轮询供侧栏,历史在发起/收尾时刷新。 */
export function CommandDashboard() {
  const { drill } = useShellDrill();
  const active = drill !== null && ACTIVE_STATUSES.has(drill.status);
  const drillId = active ? drill.id : null;

  const [detail, setDetail] = useState<DrillDetailDTO | null>(null);
  const [history, setHistory] = useState<DrillHistoryItemDTO[] | null>(null);
  // 仅消费当前活跃演练的详情(收尾后丢弃最后一拍,不靠 effect 里清 state)
  const activeDetail = detail !== null && detail.drill.id === drillId ? detail : null;

  // 活跃演练详情轮询(侧栏数据源;断线容忍保留上一拍)
  useEffect(() => {
    if (!drillId) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const res = await fetch(`/api/drills/${drillId}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        setDetail((await res.json()) as DrillDetailDTO);
      } catch {
        // 断线容忍:保留上一拍内容
      }
    };
    queueMicrotask(() => void refresh());
    const timer = setInterval(() => void refresh(), DETAIL_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [drillId]);

  // 历史:挂载首拉;演练发起(id 出现)与收尾(id 消失)时各补一拍,让新行与评分落表
  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/drills/history", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { drills: DrillHistoryItemDTO[] };
      setHistory(data.drills);
    } catch {
      // 断线容忍:保留上一拍内容
    }
  }, []);

  const prevDrillId = useRef<string | null>(null);
  useEffect(() => {
    queueMicrotask(() => void loadHistory());
  }, [loadHistory]);
  useEffect(() => {
    const prev = prevDrillId.current;
    prevDrillId.current = drillId;
    if (prev !== drillId) queueMicrotask(() => void loadHistory());
  }, [drillId, loadHistory]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 p-5">
      {/* 上区:左 2/3 演练状态主面板 + 右 1/3 系统态势侧栏 */}
      <div className="grid min-h-0 items-stretch gap-5 lg:grid-cols-[2fr_1fr]">
        {active && drill ? (
          <section className="flex flex-col rounded-md border border-border bg-card" aria-label="当前演练">
            <div className="flex items-center gap-3 border-b border-border px-6 py-3">
              <DrillTag variant="canvas" />
              <span className="ml-auto">
                <StateChip status={drill.status} />
              </span>
            </div>

            <div className="flex flex-col gap-4 px-6 py-5">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="font-heading text-lg font-bold">{drill.name}</h2>
                {drill.severity ? (
                  <SeverityBadge severity={drill.severity} size="md" />
                ) : (
                  <span className="text-[13px] text-muted-foreground">等级待定级确认</span>
                )}
              </div>
              <p className="text-[13px] text-muted-foreground">
                {activeDetail?.event ? (
                  <>
                    事件:{activeDetail.event.title}
                    <span className="ml-2 text-muted-foreground/70">{activeDetail.event.location}</span>
                  </>
                ) : (
                  "事件研判中,等待感知智能体上报……"
                )}
              </p>

              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-border pt-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-[11px] text-muted-foreground">模拟时钟</span>
                  <SimClock label={drill.simClockLabel} size="md" />
                </div>
                {/* 阶段带:五阶段进度,已过打勾、当前高亮 */}
                <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1" aria-label="推演阶段">
                  {PHASE_ORDER.map((p, i) => {
                    const passed = PHASE_ORDER.indexOf(drill.phase) > i;
                    const current = p === drill.phase;
                    return (
                      <li key={p} className="flex items-center gap-1.5">
                        {i > 0 && <span className="h-px w-4 bg-border" aria-hidden />}
                        <span
                          className={cn(
                            "flex items-center gap-1 whitespace-nowrap rounded-sm px-2 py-0.5 text-[11px]",
                            current
                              ? "bg-primary/10 font-semibold text-primary"
                              : passed
                                ? "text-muted-foreground"
                                : "text-muted-foreground/55",
                          )}
                        >
                          {passed && <Check className="size-3" aria-hidden />}
                          {PHASE_LABELS[p]}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>

              {activeDetail && (
                <p className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    场景<span className="ml-1.5 text-foreground/80">{activeDetail.drill.scenarioName}</span>
                  </span>
                  <span>
                    种子<span className="ml-1.5 font-mono text-foreground/80 tabular-nums">{activeDetail.drill.seed}</span>
                  </span>
                  <span>倍速 ×{activeDetail.drill.speed}</span>
                </p>
              )}

              {drill.status === "awaiting_confirmation" && (
                <p className="flex items-center gap-1.5 text-xs font-medium text-[oklch(0.5_0.12_70)]">
                  <span className="size-2 rounded-full bg-[oklch(0.75_0.15_70)]" aria-hidden />
                  等待人工确认:请在工作区处理关键节点,推演已暂停
                </p>
              )}

              <div>
                <Link
                  href={`/command?drill=${drill.id}`}
                  className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-sm bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:brightness-110"
                >
                  {drill.status === "awaiting_confirmation" ? "进入工作区处理确认" : "进入工作区"}
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </div>
            </div>
          </section>
        ) : (
          /* 空闲态:大号开场引导(docs/design.md §4.1) */
          <section className="flex flex-col rounded-md border border-border bg-card" aria-label="演练状态">
            <EmptyState
              icon={Siren}
              title="暂无运行中的演练"
              description="配置场景与随机种子，发起一场可复现的模拟推演。平台内所有事件均为演练数据，不涉及真实警情。"
              action={
                <>
                  <DrillTag variant="canvas" />
                  <Link
                    href="/simulation"
                    className="flex h-9 items-center whitespace-nowrap rounded-sm bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:brightness-110"
                  >
                    发起演练
                  </Link>
                  <Link
                    href="/reports"
                    className="flex h-9 items-center whitespace-nowrap rounded-sm border border-input px-4 text-sm transition-colors hover:bg-secondary"
                  >
                    查看复盘报告
                  </Link>
                </>
              }
              className="flex-1"
            />
          </section>
        )}

        <SituationSidebar
          signals={activeDetail?.signals ?? []}
          agents={activeDetail?.agents ?? []}
          notifications={activeDetail?.notifications ?? []}
          className="min-h-0"
        />
      </div>

      {/* 下区:演练历史表格 */}
      <DrillHistoryTable drills={history} className="min-h-56 flex-1" />
    </div>
  );
}
