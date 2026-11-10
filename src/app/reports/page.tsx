import { ReportsList } from "@/components/reports/reports-list";
import { PageHeader } from "@/components/shell/page-header";
import { SCENARIOS } from "@/simulation/scenarios";
import type { ScenarioKey } from "@/simulation/scenarios";

const SCENARIO_NAMES = Object.fromEntries(Object.values(SCENARIOS).map((s) => [s.key, s.name])) as Record<
  ScenarioKey,
  string
>;

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        title="事件复盘报告"
        description="演练历史、时间线回放、处置指标与改进建议"
      />
      <ReportsList scenarioNames={SCENARIO_NAMES} />
    </>
  );
}
