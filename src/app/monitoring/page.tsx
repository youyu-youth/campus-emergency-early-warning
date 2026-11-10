import { MonitoringConsole } from "@/components/monitoring/monitoring-console";
import { PageHeader } from "@/components/shell/page-header";

export default function MonitoringPage() {
  return (
    <>
      <PageHeader
        title="事件监测中心"
        description="模拟信号的实时输入流：感知智能体如何解读异常信号并上报事件"
      />
      <MonitoringConsole />
    </>
  );
}
