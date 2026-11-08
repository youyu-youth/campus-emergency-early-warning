import { describe, expect, it } from "vitest";
import { ScriptedModel } from "./model";
import { defaultHandlingNarrative, runHandling, type HandlingInput } from "./handling";

const baseInput: HandlingInput = {
  role: "security",
  taskTitle: "封锁东侧楼梯",
  taskDescription: "引导人员经西侧楼梯疏散",
  eventTitle: "图书馆三层东区烟雾浓度超标疑似火情",
  location: "图书馆三层东区",
  severity: "II",
  simTimeLabel: "14:04:30",
  outcome: { durationMs: 88_000, resources: { 人员: 2, 对讲机: 1 }, success: true, attempt: 1 },
};

describe("处置执行智能体(缝 2)", () => {
  it("正常剧本:按角色生成执行叙述", async () => {
    const scripted = JSON.stringify({
      narrative: "保安组 2 人 1 分 28 秒完成东侧楼梯封锁,引导 30 余名学生经西侧楼梯疏散,过程有序。",
    });
    const result = await runHandling(new ScriptedModel({ handling_security: [scripted] }), baseInput);
    expect(result.source).toBe("model");
    expect(result.output.narrative).toContain("封锁");
  });

  it("坏输出两次:规则默认叙述降级,不阻塞该角色反馈", async () => {
    const result = await runHandling(
      new ScriptedModel({ handling_security: [{ badJson: true }, { badJson: true }] }),
      baseInput,
    );
    expect(result.source).toBe("degraded");
    expect(result.degraded?.reason).toBe("invalid_output");
    expect(result.output.narrative).toContain("封锁东侧楼梯");
    expect(result.output.narrative).toContain("完成");
  });

  it("失败结果的默认叙述如实陈述失败", () => {
    const narrative = defaultHandlingNarrative({
      ...baseInput,
      outcome: { ...baseInput.outcome, success: false, attempt: 2 },
    });
    expect(narrative).toContain("失败");
    expect(narrative).toContain("第 2 次尝试");
  });

  it("模型挂起:超时后降级", async () => {
    const result = await runHandling(
      new ScriptedModel({ handling_security: [{ hangMs: 5_000 }, { hangMs: 5_000 }] }),
      baseInput,
      { timeoutMs: 50 },
    );
    expect(result.source).toBe("degraded");
    expect(result.degraded?.reason).toBe("timeout");
  });
});
