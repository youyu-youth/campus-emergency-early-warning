"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Bot, ClipboardList, LocateFixed, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { EmptyState } from "@/components/feedback/empty-state";
import { MetricsStrip, formatDuration } from "./metrics-strip";
import { PlaybackTimeline } from "./playback-timeline";
import { DrillTag } from "@/components/status/drill-tag";
import { SeverityBadge } from "@/components/status/severity-badge";
import { StateChip } from "@/components/status/state-chip";
import { simTimeLabel } from "@/components/workspace/timeline-panel";
import type { DrillDetailDTO } from "@/lib/drill-types";
import { startedAtLabel } from "@/lib/drill-list-utils";
import { cn } from "@/lib/utils";

/** 报告详情(docs/design.md §4.6):报告头(摘要+总评分) → 指标条 → 时间线归纳/回放 → 问题分析 → 改进建议。
 *  结论可溯源:问题与归纳条目可定位到时间线对应节点(滚动+展开+高亮)。一次性拉取,文档型只读。 */
export function ReportView() {
  const { id: drillId } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<DrillDetailDTO | null>(null);
  const [missing, setMissing] = useState(false);
  const [anchorSeq, setAnchorSeq] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/drills/${drillId}`, { cache: "no-store" });
        if (cancelled) return;
        if (res.status === 404) {
          setMissing(true);
          return;
        }
        if (res.ok) setDetail((await res.json()) as DrillDetailDTO);
      } catch {
        // 断线容忍:保留骨架态,下一拍由用户刷新重试
      }
    };
    queueMicrotask(() => void load());
    return () => {
      cancelled = true;
    };
  }, [drillId]);

  const handleAnchored = useCallback(() => setAnchorSeq(null), []);

  if (missing) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="演练不存在"
        description="该演练记录不存在或已被清理。"
        action={
          <Link href="/reports" className="text-sm font-medium text-primary hover:brightness-110">
            返回复盘报告列表
          </Link>
        }
        className="flex-1"
      />
    );
  }

  if (!detail) {
    return (
      <div className="flex flex-1 flex-col gap-5 p-5" aria-busy="true">
        <div className="h-40 animate-pulse rounded-md bg-secondary/60" />
        <div className="h-28 animate-pulse rounded-md bg-secondary/60" />
        <div className="h-72 animate-pulse rounded-md bg-secondary/60" />
      </div>
    );
  }

  const { drill, event, timeline, report } = detail;
  const terminal = drill.status === "completed" || drill.status === "aborted";

  if (!terminal) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="演练尚未结束"
        description="复盘报告在演练完成后生成。当前演练仍在进行，可先到工作区查看处置进展。"
        action={
          <Link href={`/command?drill=${drill.id}`} className="text-sm font-medium text-primary hover:brightness-110">
            进入工作区
          </Link>
        }
        className="flex-1"
      />
    );
  }

  if (!report) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="该演练未生成复盘报告"
        description="演练被终止时不再生成复盘报告与评分，时间线可在工作区回看。"
        action={
          <Link href={`/command?drill=${drill.id}`} className="text-sm font-medium text-primary hover:brightness-110">
            在工作区回看时间线
          </Link>
        }
        className="flex-1"
      />
    );
  }

  const nodeBySeq = new Map(timeline.map((n) => [n.seq, n]));
  const realSpanLabel =
    drill.startedAt && drill.endedAt
      ? `${startedAtLabel(drill.startedAt)} → ${startedAtLabel(drill.endedAt)}（真实时间）`
      : null;

  return (
    <div className="flex flex-col gap-5 p-5">
      {/* 报告头:演练摘要 + 总评分 */}
      <section className="rounded-md border border-border bg-card" aria-label="报告头">
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <Link
            href="/reports"
            className="flex h-7 items-center gap-1.5 rounded-sm border border-input px-2.5 text-xs transition-colors hover:bg-secondary"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            返回列表
          </Link>
          <DrillTag variant="canvas" />
          <span className="ml-auto">
            <StateChip status={drill.status} />
          </span>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-6 px-5 py-5">
          <div className="min-w-0">
            <h2 className="font-heading text-xl font-bold">{drill.name}</h2>
            {event && (
              <p className="mt-1.5 text-[13px] text-muted-foreground">
                事件:{event.title}
                <span className="ml-2 text-muted-foreground/70">{event.location}</span>
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
              {event?.severity && <SeverityBadge severity={event.severity} size="sm" />}
              <span>
                场景<span className="ml-1.5 text-foreground/80">{drill.scenarioName}</span>
              </span>
              <span>
                种子<span className="ml-1.5 font-mono text-foreground/80 tabular-nums">{drill.seed}</span>
              </span>
              {realSpanLabel && <span>{realSpanLabel}</span>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-baseline gap-1.5">
              <span className="font-heading text-4xl font-extrabold tabular-nums">
                {drill.score === null ? "—" : Math.round(drill.score)}
              </span>
              <span className="text-sm text-muted-foreground">分 / 100</span>
            </div>
            <span className="text-[11px] text-muted-foreground">总评分（规则计算）</span>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-[11px]",
                report.source === "degraded"
                  ? "border border-[oklch(0.75_0.15_70/0.5)] font-medium text-[oklch(0.5_0.12_70)]"
                  : "border border-border text-muted-foreground",
              )}
            >
              {report.source === "degraded" ? (
                <>
                  <TriangleAlert className="size-3.5" aria-hidden />
                  规则降级生成（模型调用失败）
                </>
              ) : (
                <>
                  <Bot className="size-3.5" aria-hidden />
                  复盘智能体生成
                </>
              )}
            </span>
          </div>
        </div>
      </section>

      {/* 指标条 */}
      <MetricsStrip metrics={report.metrics} />

      {/* 时间线归纳:复盘智能体对主轴节点的逐条归纳,可定位到对应节点 */}
      <section className="overflow-hidden rounded-md border border-border bg-card" aria-label="时间线归纳">
        <div className="flex h-9 items-center gap-2 border-b border-border px-3 text-xs font-bold">
          时间线归纳
          <span className="font-normal text-muted-foreground/70">{report.timelineSummary.length} 条</span>
          <span className="ml-auto font-normal text-muted-foreground/70">点击条目定位时间线节点</span>
        </div>
        <ul>
          {report.timelineSummary.map((item) => {
            const node = nodeBySeq.get(item.nodeSeq);
            return (
              <li key={item.nodeSeq} className="border-b border-border/60 last:border-0">
                <button
                  type="button"
                  onClick={() => setAnchorSeq(item.nodeSeq)}
                  className="flex w-full items-baseline gap-3 px-4 py-2.5 text-left transition-colors hover:bg-secondary/50"
                >
                  <time className="font-mono text-xs text-muted-foreground tabular-nums">
                    {node ? simTimeLabel(node.simTime) : `#${item.nodeSeq}`}
                  </time>
                  <span className="min-w-0 flex-1 text-[13px] leading-relaxed">{item.summary}</span>
                  <LocateFixed className="size-3.5 flex-none text-muted-foreground/50" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* 时间线回放(只读) */}
      <PlaybackTimeline timeline={timeline} anchorSeq={anchorSeq} onAnchored={handleAnchored} />

      {/* 问题分析 */}
      <section className="overflow-hidden rounded-md border border-border bg-card" aria-label="问题分析">
        <div className="flex h-9 items-center gap-2 border-b border-border px-3 text-xs font-bold">
          问题分析
          <span className="font-normal text-muted-foreground/70">{report.problems.length} 项</span>
        </div>
        {report.problems.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">本次推演未发现明显问题</p>
        ) : (
          <ul>
            {report.problems.map((problem, i) => (
              <li key={`${problem.title}-${i}`} className="border-b border-border/60 px-4 py-3 last:border-0">
                <div className="flex items-baseline gap-3">
                  <b className="min-w-0 text-[13px] font-semibold">{problem.title}</b>
                  {problem.nodeSeq !== null && (
                    <button
                      type="button"
                      onClick={() => setAnchorSeq(problem.nodeSeq)}
                      className="ml-auto inline-flex flex-none items-center gap-1 rounded-sm text-xs text-primary transition-colors hover:brightness-110"
                    >
                      <LocateFixed className="size-3.5" aria-hidden />
                      定位到时间线
                    </button>
                  )}
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{problem.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 改进建议 */}
      <section className="overflow-hidden rounded-md border border-border bg-card" aria-label="改进建议">
        <div className="flex h-9 items-center gap-2 border-b border-border px-3 text-xs font-bold">
          改进建议
          <span className="font-normal text-muted-foreground/70">{report.improvements.length} 条</span>
        </div>
        {report.improvements.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">暂无改进建议</p>
        ) : (
          <ul>
            {report.improvements.map((item, i) => (
              <li key={`${item.title}-${i}`} className="border-b border-border/60 px-4 py-3 last:border-0">
                <b className="text-[13px] font-semibold">{item.title}</b>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{item.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 报告脚注:指标口径说明 */}
      <p className="px-1 pb-2 text-[11px] leading-relaxed text-muted-foreground/70">
        报告基于演练留存日志生成（{formatDuration(report.metrics.totalDurationMs)} 推演全程），评分与指标由规则计算，
        归纳/问题/建议由{report.source === "degraded" ? "降级规则" : "复盘智能体"}生成；所有时间均来自演练模拟时钟，报告中不含真实警情数据。
      </p>
    </div>
  );
}
