import { describe, expect, it } from "vitest";
import type { ScheduledSignal } from "../simulation/engine";
import { ScriptedModel } from "./model";
import { runPerception } from "./perception";

const fireSignal: ScheduledSignal = {
  offsetMs: 0,
  kind: "sensor",
  sourceRef: "LIB-3F-SMOKE-01",
  location: "图书馆三层东区",
  signalType: "smoke_density",
  confidence: 0.92,
  payload: { metric: "smoke_density", value: 0.42, unit: "%/m", threshold: 0.15, simulated: true },
};

const baseInput = {
  signal: fireSignal,
  scenarioKey: "fire_alarm" as const,
  scenarioName: "消防警报",
  simTimeLabel: "14:00:00",
  isFirstSignal: true,
};

describe("监测感知智能体(缝 2)", () => {
  it("正常剧本:解析模型输出的结构化解读", async () => {
    const scripted = JSON.stringify({
      location: "图书馆三层东区",
      eventType: "fire_alarm",
      title: "图书馆三层东区烟雾浓度超标疑似火情",
      occurredTime: "14:00:00",
      evidence: ["烟雾传感器读数 0.42%/m,超过阈值 0.15%/m"],
      reasoning: "烟雾浓度显著超过阈值,判断为疑似火情并上报",
    });
    const result = await runPerception(new ScriptedModel({ perception: [scripted] }), baseInput);
    expect(result.source).toBe("model");
    expect(result.degraded).toBeUndefined();
    expect(result.output.title).toBe("图书馆三层东区烟雾浓度超标疑似火情");
    expect(result.output.eventType).toBe("fire_alarm");
    expect(result.output.evidence).toHaveLength(1);
  });

  it("坏 JSON 一次:重试第二次成功,仍计为模型输出", async () => {
    const good = JSON.stringify({
      location: "图书馆三层东区",
      eventType: "fire_alarm",
      title: "图书馆三层东区疑似火情",
      occurredTime: "14:00:45",
      evidence: ["摄像头视觉确认烟雾可见"],
      reasoning: "视觉检测补充确认烟雾",
    });
    const result = await runPerception(new ScriptedModel({ perception: [{ badJson: true }, good] }), {
      ...baseInput,
      isFirstSignal: false,
    });
    expect(result.source).toBe("model");
    expect(result.output.title).toBe("图书馆三层东区疑似火情");
  });

  it("坏 JSON 两次:按规则默认结果降级上报", async () => {
    const result = await runPerception(
      new ScriptedModel({ perception: [{ badJson: true }, { badJson: true }] }),
      baseInput,
    );
    expect(result.source).toBe("degraded");
    expect(result.degraded?.reason).toBe("invalid_output");
    expect(result.degraded?.attempts).toBe(2);
    // 默认解读来自信号本身,保证事件仍可上报
    expect(result.output.location).toBe("图书馆三层东区");
    expect(result.output.eventType).toBe("fire_alarm");
    expect(result.output.evidence[0]).toContain("LIB-3F-SMOKE-01");
  });

  it("模型挂起:超时后降级,不无限等待", async () => {
    const result = await runPerception(new ScriptedModel({ perception: [{ hangMs: 5_000 }, { hangMs: 5_000 }] }), baseInput, {
      timeoutMs: 50,
    });
    expect(result.source).toBe("degraded");
    expect(result.degraded?.reason).toBe("timeout");
    expect(result.output.title).toContain("感知降级");
  });
});
