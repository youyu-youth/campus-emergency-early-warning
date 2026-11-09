import Link from "next/link";
import { ClipboardList } from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/shell/page-header";

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        title="事件复盘报告"
        description="演练历史、时间线回放、处置指标与改进建议"
      />
      <EmptyState
        icon={ClipboardList}
        title="暂无演练记录"
        description="完成一场演练后，时间线回放、规则评分与改进建议将在此归档，每条结论可溯源到时间线节点。"
        action={
          <Link href="/simulation" className="text-sm font-medium text-primary hover:brightness-110">
            发起首场演练
          </Link>
        }
        className="flex-1"
      />
    </>
  );
}
