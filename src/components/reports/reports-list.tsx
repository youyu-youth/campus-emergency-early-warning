"use client";

import { useCallback, useEffect, useState } from "react";

import { DrillHistoryTable } from "@/components/dashboard/drill-history-table";
import type { DrillHistoryItemDTO } from "@/lib/drill-types";
import type { ScenarioKey } from "@/simulation/scenarios";

/** 复盘报告列表页(docs/design.md §4.6):列表即演练记录,一次性拉取(记录页无需轮询) */
export function ReportsList({ scenarioNames }: { scenarioNames: Record<ScenarioKey, string> }) {
  const [drills, setDrills] = useState<DrillHistoryItemDTO[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/drills/history", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { drills: DrillHistoryItemDTO[] };
      setDrills(data.drills);
    } catch {
      // 断线容忍:保留上一拍内容
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  return (
    <div className="flex flex-col gap-5 p-5">
      <DrillHistoryTable drills={drills} scenarioNames={scenarioNames} title="演练记录" flow />
    </div>
  );
}
