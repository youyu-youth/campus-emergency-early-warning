import { describe, expect, it } from "vitest";
import {
  formatSimClock,
  pauseClock,
  resumeClock,
  setSpeed,
  simTimeMs,
  startClock,
} from "./clock";

describe("演练时钟", () => {
  it("1 倍速下模拟时间随真实时间同步推进", () => {
    const clock = startClock(1_000_000, 10_000);
    expect(simTimeMs(clock, 25_000)).toBe(1_015_000);
  });

  it("2 倍速下模拟时间加倍推进", () => {
    const clock = startClock(0, 10_000, 2);
    expect(simTimeMs(clock, 20_000)).toBe(20_000);
  });

  it("暂停后模拟时间冻结，恢复后从冻结点继续", () => {
    let clock = startClock(0, 10_000);
    clock = pauseClock(clock, 16_000); // 累计 6000ms
    expect(simTimeMs(clock, 100_000)).toBe(6_000); // 冻结
    clock = resumeClock(clock, 20_000);
    expect(simTimeMs(clock, 23_000)).toBe(9_000); // 6000 + 3000
  });

  it("运行中调速先结算当前段", () => {
    let clock = startClock(0, 10_000, 1);
    clock = setSpeed(clock, 20_000, 3); // 结算 10000ms，再以 3 倍速推进
    expect(simTimeMs(clock, 25_000)).toBe(25_000); // 10000 + 5000*3
  });

  it("暂停态调速不改变累计值", () => {
    let clock = startClock(0, 10_000, 1);
    clock = pauseClock(clock, 15_000);
    clock = setSpeed(clock, 20_000, 4);
    expect(simTimeMs(clock, 30_000)).toBe(5_000);
  });

  it("误用抛出错误", () => {
    const running = startClock(0, 0);
    expect(() => startClock(0, 0, 0)).toThrow(/倍速/);
    expect(() => pauseClock(running, 0)).not.toThrow();
    expect(() => pauseClock({ ...running, running: false }, 0)).toThrow(/无法暂停/);
    expect(() => resumeClock(running, 0)).toThrow(/重复恢复/);
  });

  it("格式化模拟时钟", () => {
    expect(formatSimClock(0)).toBe("00:00:00");
    expect(formatSimClock(3_661_000)).toBe("01:01:01");
  });
});
