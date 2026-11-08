import { describe, expect, it } from "vitest";
import { generateEvolution, generateSignalScript, getScenario } from "./engine";
import { SCENARIOS } from "./scenarios";

describe("模拟引擎", () => {
  it("同一场景与种子生成完全一致的信号脚本", () => {
    const a = generateSignalScript("fire_alarm", 42);
    const b = generateSignalScript("fire_alarm", 42);
    expect(a).toEqual(b);
  });

  it("不同种子生成不同脚本（抖动生效）", () => {
    const a = generateSignalScript("fire_alarm", 42);
    const b = generateSignalScript("fire_alarm", 1337);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("信号按模拟时间升序排列", () => {
    const signals = generateSignalScript("medical_emergency", 7);
    const offsets = signals.map((s) => s.offsetMs);
    expect([...offsets].sort((x, y) => x - y)).toEqual(offsets);
  });

  it("每条信号都显式标记为模拟数据", () => {
    for (const key of Object.keys(SCENARIOS) as (keyof typeof SCENARIOS)[]) {
      const signals = generateSignalScript(key, 1);
      expect(signals.length).toBeGreaterThanOrEqual(2);
      for (const signal of signals) {
        expect(signal.payload.simulated).toBe(true);
      }
    }
  });

  it("演变节点可复现且按时间升序", () => {
    const a = generateEvolution("fire_alarm", 42);
    const b = generateEvolution("fire_alarm", 42);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
    const offsets = a.map((e) => e.offsetMs);
    expect([...offsets].sort((x, y) => x - y)).toEqual(offsets);
  });

  it("场景定义完整", () => {
    for (const key of Object.keys(SCENARIOS) as (keyof typeof SCENARIOS)[]) {
      const scenario = getScenario(key);
      expect(scenario.key).toBe(key);
      expect(scenario.name).toBeTruthy();
      expect(scenario.signals.length).toBeGreaterThan(0);
      expect(scenario.evolution.length).toBeGreaterThan(0);
      expect(scenario.defaultSimStart).toMatch(/^\d{2}:\d{2}$/);
    }
  });
});
