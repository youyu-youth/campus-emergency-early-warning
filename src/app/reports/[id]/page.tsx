import { Suspense } from "react";

import { ReportView } from "@/components/reports/report-view";
import { SCENARIOS } from "@/simulation/scenarios";
import type { ScenarioKey } from "@/simulation/scenarios";

const SCENARIO_NAMES = Object.fromEntries(Object.values(SCENARIOS).map((s) => [s.key, s.name])) as Record<
  ScenarioKey,
  string
>;

/** 报告详情页(首个页面级动态路由):id 为演练 ID;参数经客户端 useParams 读取(cacheComponents 预渲染约束,同 /command) */
export default function ReportDetailPage() {
  return (
    <Suspense fallback={null}>
      <ReportView scenarioNames={SCENARIO_NAMES} />
    </Suspense>
  );
}
