// 演练列表共享工具:指挥台历史表格与复盘报告列表表格共用(纯函数,client 安全)

import type { DrillHistoryItemDTO } from "./drill-types";
import type { EventSeverity } from "@/simulation/state-machines";
import type { ScenarioKey } from "@/simulation/scenarios";

export type DrillSortKey = "name" | "startedAt" | "scenario" | "severity" | "score" | "status";

/** 等级权重:Ⅰ 重大最高(降序 = 重大在前) */
export const SEVERITY_RANK: Record<EventSeverity, number> = { I: 4, II: 3, III: 2, IV: 1 };

export function startedAtLabel(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** null(未定级/未评分/未发起)恒排末尾,不随升降序浮动 */
function compareNullable<T>(a: T | null, b: T | null, compare: (x: T, y: T) => number): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compare(a, b);
}

export function sortDrills(
  drills: DrillHistoryItemDTO[],
  key: DrillSortKey,
  dir: "asc" | "desc",
  scenarioNames: Record<ScenarioKey, string>,
): DrillHistoryItemDTO[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...drills].sort((a, b) => {
    switch (key) {
      case "name":
        return factor * a.name.localeCompare(b.name, "zh-Hans-CN");
      case "startedAt":
        return compareNullable(a.startedAt, b.startedAt, (x, y) => factor * (Date.parse(x) - Date.parse(y)));
      case "scenario":
        return factor * (scenarioNames[a.scenarioKey] ?? "").localeCompare(scenarioNames[b.scenarioKey] ?? "", "zh-Hans-CN");
      case "severity":
        return compareNullable(a.severity, b.severity, (x, y) => factor * (SEVERITY_RANK[x] - SEVERITY_RANK[y]));
      case "score":
        return compareNullable(a.score, b.score, (x, y) => factor * (x - y));
      case "status":
        return factor * a.status.localeCompare(b.status);
    }
  });
}

/** 列表行去向:已完成 → 复盘报告页;其余(进行中/终止) → 工作区视图 */
export function drillRowHref(drill: Pick<DrillHistoryItemDTO, "id" | "status">): string {
  return drill.status === "completed" ? `/reports/${drill.id}` : `/command?drill=${drill.id}`;
}
