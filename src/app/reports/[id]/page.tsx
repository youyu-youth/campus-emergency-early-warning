import { Suspense } from "react";

import { ReportView } from "@/components/reports/report-view";

/** 报告详情页(首个页面级动态路由):id 为演练 ID;参数经客户端 useParams 读取(cacheComponents 预渲染约束,同 /command) */
export default function ReportDetailPage() {
  return (
    <Suspense fallback={null}>
      <ReportView />
    </Suspense>
  );
}
