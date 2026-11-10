import type { DrillMetrics } from "@/simulation/score-rules";
import { cn } from "@/lib/utils";

/** 模拟毫秒 → 中文时长(报告文档语境:"3分05秒"/"42秒") */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}秒`;
  return `${Math.floor(s / 60)}分${String(s % 60).padStart(2, "0")}秒`;
}

/** 指标条(docs/design.md §4.6):五项横向度量带,规则计算、非模型输出;数字等宽右对齐 */
export function MetricsStrip({ metrics, className }: { metrics: DrillMetrics; className?: string }) {
  const completion = metrics.taskTotal > 0 ? `${metrics.taskDone}/${metrics.taskTotal}` : "—";
  const items: Array<{ label: string; value: string; hint?: string }> = [
    { label: "总时长", value: formatDuration(metrics.totalDurationMs), hint: "发现 → 关闭" },
    { label: "发现→上报", value: formatDuration(metrics.reportDurationMs) },
    { label: "定级耗时", value: formatDuration(metrics.gradingDurationMs) },
    { label: "任务完成率", value: completion, hint: "完成/总数" },
    { label: "资源消耗", value: String(metrics.resourceTotal), hint: "累计人次与设备" },
  ];
  return (
    <section className={cn("rounded-md border border-border bg-card", className)} aria-label="处置指标">
      <div className="flex h-9 items-center border-b border-border px-3 text-xs font-bold">处置指标（规则计算）</div>
      <dl className="grid grid-cols-2 divide-border sm:grid-cols-3 lg:grid-cols-5 lg:divide-x">
        {items.map((item, i) => (
          <div
            key={item.label}
            className={cn("flex flex-col gap-1 px-4 py-3.5", i > 0 && "border-t border-border lg:border-t-0")}
          >
            <dt className="text-[11px] text-muted-foreground">{item.label}</dt>
            <dd className="font-mono text-lg font-semibold tabular-nums">{item.value}</dd>
            {item.hint && <dd className="text-[11px] text-muted-foreground/70">{item.hint}</dd>}
          </div>
        ))}
      </dl>
    </section>
  );
}
