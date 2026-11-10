// 交接日志推导测试:相邻节点 actor 变化产生「谁→谁」交接;同 actor 连续动作折叠;无 actor 节点跳过
import { describe, expect, it } from "vitest";

import type { TimelineNodeDTO } from "@/lib/drill-types";
import { deriveHandoffs } from "./handoff";

function node(seq: number, actor: string | null, title: string, extra: Partial<TimelineNodeDTO> = {}): TimelineNodeDTO {
  return {
    id: `node-${seq}`,
    seq,
    phase: "handling",
    nodeType: "dispatch",
    title,
    actor,
    requiresConfirmation: false,
    simTime: `2026-11-08T06:00:${String(seq).padStart(2, "0")}.000Z`,
    ...extra,
  };
}

describe("交接日志推导 deriveHandoffs", () => {
  it("相邻不同 actor 产生交接,记录双方与接收方节点信息", () => {
    const records = deriveHandoffs([
      node(1, "command_agent", "任务方案:2 项任务"),
      node(2, "operator", "采纳建议方案"),
      node(3, "security_agent", "处置反馈:疏散引导完成", { nodeType: "feedback" }),
    ]);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ from: "command_agent", to: "operator", title: "采纳建议方案", seq: 2 });
    expect(records[1]).toMatchObject({ from: "operator", to: "security_agent", nodeType: "feedback", seq: 3 });
  });

  it("同一 actor 连续动作不产生交接", () => {
    const records = deriveHandoffs([
      node(1, "security_agent", "处置反馈:疏散引导完成"),
      node(2, "security_agent", "处置反馈:警戒带设置完成"),
    ]);
    expect(records).toHaveLength(0);
  });

  it("无 actor 的节点(如早期系统节点)不参与交接链", () => {
    const records = deriveHandoffs([
      node(1, null, "信号到达"),
      node(2, "monitor_agent", "信号解读:疑似火情", { phase: "perception", nodeType: "signal" }),
      node(3, null, "事件创建"),
      node(4, "command_agent", "事件定级:建议 II 级", { phase: "grading", nodeType: "grading" }),
    ]);
    // monitor→command 之间夹了无 actor 节点,仍按相邻参与者推导交接
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ from: "monitor_agent", to: "command_agent", seq: 4 });
  });

  it("空时间线与单节点时间线无交接", () => {
    expect(deriveHandoffs([])).toHaveLength(0);
    expect(deriveHandoffs([node(1, "monitor_agent", "信号解读")])).toHaveLength(0);
  });
});
