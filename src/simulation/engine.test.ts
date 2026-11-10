import { describe, expect, it } from "vitest";
import { generateEvolution, generateSignalScript } from "./engine";
import { BUILTIN_SCENARIOS } from "./scenarios";

function byKey(key: string) {
  const scenario = BUILTIN_SCENARIOS.find((s) => s.key === key);
  if (!scenario) throw new Error(`内置场景 ${key} 缺失`);
  return scenario;
}

describe("模拟引擎", () => {
  it("同一场景与种子生成完全一致的信号脚本", () => {
    const a = generateSignalScript(byKey("fire_alarm"), 42);
    const b = generateSignalScript(byKey("fire_alarm"), 42);
    expect(a).toEqual(b);
  });

  it("不同种子生成不同脚本（抖动生效）", () => {
    const a = generateSignalScript(byKey("fire_alarm"), 42);
    const b = generateSignalScript(byKey("fire_alarm"), 1337);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("信号按模拟时间升序排列", () => {
    const signals = generateSignalScript(byKey("medical_emergency"), 7);
    const offsets = signals.map((s) => s.offsetMs);
    expect([...offsets].sort((x, y) => x - y)).toEqual(offsets);
  });

  it("每条信号都显式标记为模拟数据", () => {
    for (const scenario of BUILTIN_SCENARIOS) {
      const signals = generateSignalScript(scenario, 1);
      expect(signals.length).toBeGreaterThanOrEqual(2);
      for (const signal of signals) {
        expect(signal.payload.simulated).toBe(true);
      }
    }
  });

  it("演变节点可复现且按时间升序", () => {
    const a = generateEvolution(byKey("fire_alarm"), 42);
    const b = generateEvolution(byKey("fire_alarm"), 42);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
    const offsets = a.map((e) => e.offsetMs);
    expect([...offsets].sort((x, y) => x - y)).toEqual(offsets);
  });

  it("内置场景定义完整", () => {
    for (const scenario of BUILTIN_SCENARIOS) {
      expect(scenario.key).toBeTruthy();
      expect(scenario.name).toBeTruthy();
      expect(scenario.eventTypeLabel).toBeTruthy();
      expect(scenario.signals.length).toBeGreaterThan(0);
      expect(scenario.evolution.length).toBeGreaterThan(0);
      expect(scenario.defaultSimStart).toMatch(/^\d{2}:\d{2}$/);
    }
  });
});
