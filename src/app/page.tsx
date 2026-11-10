import { CommandDashboard } from "@/components/dashboard/command-dashboard";
import { PageHeader } from "@/components/shell/page-header";

export default function Home() {
  return (
    <>
      <PageHeader
        title="综合指挥台"
        description="全局态势一屏总览：演练状态、系统健康与快速入口"
      />
      <CommandDashboard />
    </>
  );
}
