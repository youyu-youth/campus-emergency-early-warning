import Link from "next/link";
import { Network } from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/shell/page-header";

export default function AgentsPage() {
  return (
    <>
      <PageHeader
        title="智能体协作调度"
        description="五类智能体的协作关系图与交接日志"
      />
      <EmptyState
        icon={Network}
        title="协作视图建设中"
        description="将呈现监测感知、指挥调度、处置执行、通知发布、复盘评估五类智能体的协作关系图、工具权限与交接日志。"
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
