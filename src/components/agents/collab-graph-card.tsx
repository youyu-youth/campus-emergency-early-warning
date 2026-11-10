"use client";

// 协作关系图卡片:卡片容器(卡片头 + 图区)包裹 CollabGraph,供协作台主区使用

import type { AgentStatusDTO } from "@/lib/drill-types";
import { cn } from "@/lib/utils";
import type { DrillPhase, DrillStatus } from "@/simulation/state-machines";
import { CollabGraph } from "./collab-graph";
import type { GraphNodeKey } from "./agent-meta";

export function AgentsGraphCard({
  agents,
  phase,
  status,
  hasPendingConfirmation,
  hasRedispatch,
  pendingRedispatch,
  selectedKey,
  onSelect,
  className,
}: {
  agents: AgentStatusDTO[];
  phase: DrillPhase;
  status: DrillStatus;
  hasPendingConfirmation: boolean;
  hasRedispatch: boolean;
  pendingRedispatch: boolean;
  selectedKey: GraphNodeKey;
  onSelect: (key: GraphNodeKey) => void;
  className?: string;
}) {
  return (
    <section className={cn("flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card", className)} aria-label="协作关系图">
      <div className="flex h-9 flex-none items-center border-b border-border px-3 text-xs font-bold">
        协作关系图
        <span className="ml-auto text-[10px] font-normal text-muted-foreground">点击节点查看详情</span>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <CollabGraph
          agents={agents}
          phase={phase}
          status={status}
          hasPendingConfirmation={hasPendingConfirmation}
          hasRedispatch={hasRedispatch}
          pendingRedispatch={pendingRedispatch}
          selectedKey={selectedKey}
          onSelect={onSelect}
        />
      </div>
    </section>
  );
}
