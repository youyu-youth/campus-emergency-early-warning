import { describe, expect, it } from "vitest";
import { ScriptedModel } from "./model";
import {
  defaultGrading,
  runDispatch,
  runDispatchEvaluation,
  runGrading,
  type DispatchInput,
  type GradingInput,
  type RedispatchInput,
} from "./command";

const baseInput: GradingInput = {
  event: {
    type: "fire_alarm",
    title: "图书馆三层东区烟雾浓度超标疑似火情",
    location: "图书馆三层东区",
    detectedSimTime: "14:00:00",
  },
  scenarioKey: "fire_alarm" as const,
  scenarioName: "消防警报",
  intensity: "medium" as const,
  evidence: ["烟雾传感器读数 0.42%/m,超过阈值 0.15%/m", "东侧书架区摄像头检测到可见烟雾"],
  simTimeLabel: "14:03:10",
};

function gradingJson(severity: string): string {
  return JSON.stringify({
    suggestedSeverity: severity,
    reasoning: "烟雾浓度超标且视觉确认,建议定为较大等级",
  });
}

describe("指挥调度智能体 · 定级(缝 2)", () => {
  it("正常剧本:解析模型输出的建议等级与理由", async () => {
    const result = await runGrading(new ScriptedModel({ command: [gradingJson("II")] }), baseInput);
    expect(result.source).toBe("model");
    expect(result.degraded).toBeUndefined();
    expect(result.output.suggestedSeverity).toBe("II");
    expect(result.output.reasoning).toContain("烟雾");
  });

  it("坏 JSON 一次:重试第二次成功,仍计为模型输出", async () => {
    const result = await runGrading(new ScriptedModel({ command: [{ badJson: true }, gradingJson("III")] }), baseInput);
    expect(result.source).toBe("model");
    expect(result.output.suggestedSeverity).toBe("III");
  });

  it("坏 JSON 两次:按规则默认定级降级,等级由强度决定", async () => {
    const result = await runGrading(new ScriptedModel({ command: [{ badJson: true }, { badJson: true }] }), baseInput);
    expect(result.source).toBe("degraded");
    expect(result.degraded?.reason).toBe("invalid_output");
    expect(result.degraded?.attempts).toBe(2);
    expect(result.output.suggestedSeverity).toBe("III");
    expect(result.output.reasoning).toContain("默认");
  });

  it("模型挂起:超时后降级,不无限等待", async () => {
    const result = await runGrading(
      new ScriptedModel({ command: [{ hangMs: 5_000 }, { hangMs: 5_000 }] }),
      baseInput,
      { timeoutMs: 50 },
    );
    expect(result.source).toBe("degraded");
    expect(result.degraded?.reason).toBe("timeout");
  });

  it("规则默认定级:强度映射 high→Ⅱ / medium→Ⅲ / low→Ⅳ", () => {
    expect(defaultGrading({ ...baseInput, intensity: "high" }).suggestedSeverity).toBe("II");
    expect(defaultGrading({ ...baseInput, intensity: "medium" }).suggestedSeverity).toBe("III");
    expect(defaultGrading({ ...baseInput, intensity: "low" }).suggestedSeverity).toBe("IV");
  });
});

const dispatchInput: DispatchInput = {
  event: baseInput.event,
  scenarioKey: "fire_alarm",
  scenarioName: "消防警报",
  severity: "II",
  evidence: baseInput.evidence,
  simTimeLabel: "14:03:20",
};

describe("指挥调度智能体 · 任务方案(缝 2)", () => {
  it("正常剧本:解析三角色任务方案", async () => {
    const scripted = JSON.stringify({
      tasks: [
        { role: "security", title: "封锁东侧楼梯", description: "引导人员经西侧楼梯疏散" },
        { role: "medical", title: "医疗待命", description: "评估潜在伤员并准备急救" },
        { role: "logistics", title: "切断三层电源", description: "联动断电并设置警戒线" },
      ],
      reasoning: "火情确认,需疏散引导、医疗待命与断电警戒并行",
    });
    const result = await runDispatch(new ScriptedModel({ command: [scripted] }), dispatchInput);
    expect(result.source).toBe("model");
    expect(result.output.tasks).toHaveLength(3);
    expect(result.output.tasks[0].role).toBe("security");
  });

  it("坏输出两次:降级为场景默认方案(规则)", async () => {
    const result = await runDispatch(
      new ScriptedModel({ command: [{ badJson: true }, { badJson: true }] }),
      dispatchInput,
    );
    expect(result.source).toBe("degraded");
    expect(result.degraded?.reason).toBe("invalid_output");
    // 默认方案覆盖保安/医务/后勤三角色,保证处置可推进
    const roles = result.output.tasks.map((t) => t.role);
    expect(roles).toEqual(expect.arrayContaining(["security", "medical", "logistics"]));
    expect(result.output.tasks.every((t) => t.title.length > 0 && t.description.length > 0)).toBe(true);
  });
});

const redispatchInput: RedispatchInput = {
  event: baseInput.event,
  scenarioKey: "fire_alarm",
  scenarioName: "消防警报",
  severity: "II",
  milestone: { label: "烟雾范围扩大", note: "东侧书架区烟雾浓度持续上升,蔓延至阅览区", simTimeLabel: "14:05:00" },
  currentTasks: [
    { role: "security", title: "封锁东侧楼梯", status: "executing" },
    { role: "medical", title: "医疗待命", status: "executing" },
  ],
  simTimeLabel: "14:05:01",
};

describe("指挥调度智能体 · 重新调度评估(缝 2)", () => {
  it("评估为需要加派:解析追加任务清单", async () => {
    const scripted = JSON.stringify({
      needsRedispatch: true,
      additionalTasks: [{ role: "logistics", title: "启动应急广播", description: "循环播放疏散引导广播" }],
      reasoning: "烟雾蔓延至阅览区,需加派广播引导",
    });
    const result = await runDispatchEvaluation(new ScriptedModel({ command: [scripted] }), redispatchInput);
    expect(result.source).toBe("model");
    expect(result.output.needsRedispatch).toBe(true);
    expect(result.output.additionalTasks).toHaveLength(1);
  });

  it("评估为无需加派:additionalTasks 为空", async () => {
    const scripted = JSON.stringify({
      needsRedispatch: false,
      additionalTasks: [],
      reasoning: "当前任务覆盖处置需要,无需调整",
    });
    const result = await runDispatchEvaluation(new ScriptedModel({ command: [scripted] }), redispatchInput);
    expect(result.output.needsRedispatch).toBe(false);
    expect(result.output.additionalTasks).toHaveLength(0);
  });

  it("坏输出两次:降级为保守结论(不加派),推演不中断", async () => {
    const result = await runDispatchEvaluation(
      new ScriptedModel({ command: [{ badJson: true }, { badJson: true }] }),
      redispatchInput,
    );
    expect(result.source).toBe("degraded");
    expect(result.output.needsRedispatch).toBe(false);
    expect(result.output.additionalTasks).toHaveLength(0);
  });

  it("模型挂起:超时后降级", async () => {
    const result = await runDispatchEvaluation(
      new ScriptedModel({ command: [{ hangMs: 5_000 }, { hangMs: 5_000 }] }),
      redispatchInput,
      { timeoutMs: 50 },
    );
    expect(result.source).toBe("degraded");
    expect(result.degraded?.reason).toBe("timeout");
  });
});
