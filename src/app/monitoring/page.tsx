import Link from "next/link";
import { RadioTower } from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/shell/page-header";

export default function MonitoringPage() {
  return (
    <>
      <PageHeader
        title="事件监测中心"
        description="模拟信号的实时输入流：感知智能体如何解读异常信号并上报事件"
      />
      <EmptyState
        icon={RadioTower}
        title="监测中心建设中"
        description="推演开始后，传感器与摄像头的模拟异常信号将在此实时呈现，并展示感知智能体的解读过程。"
        action={
          <Link href="/" className="text-sm font-medium text-primary hover:brightness-110">
            返回综合指挥台
          </Link>
        }
        className="flex-1"
      />
    </>
  );
}
