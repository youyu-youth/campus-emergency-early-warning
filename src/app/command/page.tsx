import { Suspense } from "react";

import { PageHeader } from "@/components/shell/page-header";
import { CommandWorkspace } from "@/components/workspace/command-workspace";

export default function CommandPage() {
  return (
    <>
      <PageHeader
        title="事件详情工作区"
        description="处置主战场：处置时间线主轴 + 智能体编队 + 任务与决策"
      />
      <Suspense fallback={null}>
        <CommandWorkspace />
      </Suspense>
    </>
  );
}
