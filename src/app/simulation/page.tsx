import { PageHeader } from "@/components/shell/page-header";
import { SimulationLauncher } from "@/components/simulation/simulation-launcher";

export default function SimulationPage() {
  return (
    <>
      <PageHeader
        title="事件模拟推演"
        description="选择场景、配置参数与随机种子，发起可复现的模拟演练"
      />
      <SimulationLauncher />
    </>
  );
}
