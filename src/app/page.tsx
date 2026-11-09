import Link from "next/link";
import { Siren } from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { DrillTag } from "@/components/status/drill-tag";
import { PageHeader } from "@/components/shell/page-header";

export default function Home() {
  return (
    <>
      <PageHeader
        title="综合指挥台"
        description="全局态势一屏总览：演练状态、系统健康与快速入口"
      />
      {/* 空闲态开场引导(docs/design.md §4.1);演练概要面板待数据接入轮实现 */}
      <EmptyState
        icon={Siren}
        title="暂无运行中的演练"
        description="配置场景与随机种子，发起一场可复现的模拟推演。平台内所有事件均为演练数据，不涉及真实警情。"
        action={
          <>
            <DrillTag variant="canvas" />
            <Link
              href="/simulation"
              className="flex h-9 items-center whitespace-nowrap rounded-sm bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:brightness-110"
            >
              发起演练
            </Link>
            <Link
              href="/reports"
              className="flex h-9 items-center whitespace-nowrap rounded-sm border border-input px-4 text-sm transition-colors hover:bg-secondary"
            >
              查看复盘报告
            </Link>
          </>
        }
        className="flex-1"
      />
    </>
  );
}
