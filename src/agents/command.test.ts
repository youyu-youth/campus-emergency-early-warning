import { describe, expect, it } from "vitest";
import { ScriptedModel } from "./model";
import { defaultGrading, runGrading, type GradingInput } from "./command";

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
