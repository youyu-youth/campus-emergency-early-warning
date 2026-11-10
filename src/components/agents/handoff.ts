// 交接日志推导(纯函数):timeline 无显式「谁→谁」边表,按相邻节点 actor 变化推导(docs/design.md §4.4)
import type { TimelineNodeDTO } from "@/lib/drill-types";

export interface HandoffRecord {
  /** 交出方 actor */
  from: string;
  /** 接收方 actor */
  to: string;
  /** 交接内容摘要(接收方节点标题) */
  title: string;
  nodeType: string;
  simTime: string;
  seq: number;
}

/**
 * 从演练时间线推导交接记录:
 * timeline 按节点序号升序(API 保证),相邻两个不同 actor 的节点产生一条
 * 「前者 → 后者」交接;同一 actor 连续动作不产生交接。无 actor 的节点不参与。
 */
export function deriveHandoffs(timeline: TimelineNodeDTO[]): HandoffRecord[] {
  const withActor = timeline.filter((node) => node.actor !== null);
  const records: HandoffRecord[] = [];
  for (let i = 1; i < withActor.length; i++) {
    const prev = withActor[i - 1];
    const curr = withActor[i];
    if (prev.actor === curr.actor) continue;
    records.push({
      from: prev.actor as string,
      to: curr.actor as string,
      title: curr.title,
      nodeType: curr.nodeType,
      simTime: curr.simTime,
      seq: curr.seq,
    });
  }
  return records;
}
