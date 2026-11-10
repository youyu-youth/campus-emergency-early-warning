"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { SeverityBadge } from "@/components/status/severity-badge";
import { StateChip } from "@/components/status/state-chip";
import type { DrillHistoryItemDTO } from "@/lib/drill-types";
import { drillRowHref, sortDrills, startedAtLabel, type DrillSortKey } from "@/lib/drill-list-utils";
import { cn } from "@/lib/utils";
import type { ScenarioKey } from "@/simulation/scenarios";

const COLUMNS: Array<{ key: DrillSortKey; label: string; className?: string }> = [
  { key: "name", label: "演练" },
  { key: "startedAt", label: "发起时间" },
  { key: "scenario", label: "场景" },
  { key: "severity", label: "等级", className: "text-center" },
  { key: "score", label: "评分", className: "text-right" },
  { key: "status", label: "状态" },
];

/** 演练列表表格(docs/design.md §4.1/§4.6):时间/场景/等级/评分/状态可排序;行点击按状态进报告页/工作区。
 *  flow 变体供 /reports 列表页:自然高度随页面滚动;默认 panel 变体为指挥台视口内填充 */
export function DrillHistoryTable({
  drills,
  scenarioNames,
  className,
  title = "演练历史",
  flow = false,
}: {
  /** null = 首次加载中 */
  drills: DrillHistoryItemDTO[] | null;
  scenarioNames: Record<ScenarioKey, string>;
  className?: string;
  title?: string;
  flow?: boolean;
}) {
  const router = useRouter();
  const [sort, setSort] = useState<{ key: DrillSortKey; dir: "asc" | "desc" }>({ key: "startedAt", dir: "desc" });

  const sorted = useMemo(
    () => (drills ? sortDrills(drills, sort.key, sort.dir, scenarioNames) : null),
    [drills, sort, scenarioNames],
  );

  const toggleSort = (key: DrillSortKey) => {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  };

  return (
    <section
      className={cn(
        "overflow-hidden rounded-md border border-border bg-card",
        flow ? "" : "flex min-h-0 flex-col",
        className,
      )}
    >
      <div className="flex h-9 flex-none items-center justify-between border-b border-border px-3 text-xs font-bold">
        {title}
        {sorted && <span className="font-normal text-muted-foreground/70">{sorted.length} 场</span>}
      </div>
      <div className={flow ? "" : "min-h-0 flex-1 overflow-auto"}>
        <table className="w-full border-collapse text-left text-[13px]">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border">
              {COLUMNS.map((col) => {
                const active = sort.key === col.key;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                    className={cn("px-3 py-2 text-xs font-semibold", col.className)}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-sm transition-colors hover:text-primary",
                        active && "text-primary",
                        col.className,
                      )}
                    >
                      {col.label}
                      {active ? (
                        sort.dir === "asc" ? (
                          <ArrowUp className="size-3" aria-hidden />
                        ) : (
                          <ArrowDown className="size-3" aria-hidden />
                        )
                      ) : (
                        <ArrowUpDown className="size-3 opacity-40" aria-hidden />
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted === null
              ? // 首次加载骨架(不用转圈遮罩)
                Array.from({ length: 3 }, (_, i) => (
                  <tr key={i} className="border-b border-border/60 last:border-0">
                    {COLUMNS.map((col) => (
                      <td key={col.key} className={cn("px-3 py-3", col.className)}>
                        <div className="h-3.5 animate-pulse rounded-sm bg-secondary" />
                      </td>
                    ))}
                  </tr>
                ))
              : sorted.length === 0
                ? <tr>
                    <td colSpan={COLUMNS.length} className="px-3 py-10 text-center">
                      <p className="text-[13px] text-muted-foreground">暂无演练记录</p>
                      <Link
                        href="/simulation"
                        className="mt-1 inline-block text-xs font-medium text-primary hover:brightness-110"
                      >
                        发起第一场推演 →
                      </Link>
                    </td>
                  </tr>
                : sorted.map((drill) => (
                    <tr
                      key={drill.id}
                      onClick={() => router.push(drillRowHref(drill))}
                      className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-secondary/50"
                    >
                      <td className="max-w-72 truncate px-3 py-2.5">
                        <Link
                          href={drillRowHref(drill)}
                          className="font-medium hover:text-primary"
                          title={drill.name}
                        >
                          {drill.name}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted-foreground tabular-nums">
                        {startedAtLabel(drill.startedAt)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                        {scenarioNames[drill.scenarioKey] ?? drill.scenarioKey}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {drill.severity ? (
                          <SeverityBadge severity={drill.severity} size="sm" />
                        ) : (
                          <span className="text-xs text-muted-foreground/60">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">
                        {drill.score === null ? (
                          <span className="text-muted-foreground/60">—</span>
                        ) : (
                          <span className="font-semibold text-foreground">{Math.round(drill.score)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <StateChip status={drill.status} />
                      </td>
                    </tr>
                  ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
