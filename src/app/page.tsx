import { CommandDashboard } from "@/components/dashboard/command-dashboard";
import { PageHeader } from "@/components/shell/page-header";
import { SCENARIOS } from "@/simulation/scenarios";
import type { ScenarioKey } from "@/simulation/scenarios";

const SCENARIO_NAMES = Object.fromEntries(Object.values(SCENARIOS).map((s) => [s.key, s.name])) as Record<
  ScenarioKey,
  string
>;

export default function Home() {
  return (
    <>
      <PageHeader
        title="综合指挥台"
        description="全局态势一屏总览：演练状态、系统健康与快速入口"
      />
      <CommandDashboard scenarioNames={SCENARIO_NAMES} />
    </>
  );
}
