import { ReportsList } from "@/components/reports/reports-list";
import { PageHeader } from "@/components/shell/page-header";

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        title="事件复盘报告"
        description="演练历史、时间线回放、处置指标与改进建议"
      />
      <ReportsList />
    </>
  );
}
