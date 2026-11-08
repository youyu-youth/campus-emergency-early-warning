import { describe, expect, it } from "vitest";
import { computeScore, type DrillMetrics } from "./score-rules";

/** 基准口径下的理想指标:各项恰好达标 → 全部子项满分 */
const ideal: DrillMetrics = {
  totalDurationMs: 360_000,
  reportDurationMs: 60_000,
  gradingDurationMs: 60_000,
  taskDone: 4,
  taskTotal: 4,
  resourceTotal: 16, // 每任务 4
};

describe("演练总评分(规则加权,模型不参与)", () => {
  it("各项恰好达标 → 100 分", () => {
    expect(computeScore(ideal)).toBe(100);
  });

  it("快于基准不加分(封顶 100),慢于两倍基准计 0 分(下限 0)", () => {
    expect(computeScore({ ...ideal, totalDurationMs: 100_000 })).toBe(100);
    expect(computeScore({ ...ideal, totalDurationMs: 1_000_000 })).toBeLessThan(100);
    // 总时长两倍基准 → 时长子项 0,其余满分:100 - 25 = 75
    expect(computeScore({ ...ideal, totalDurationMs: 720_000 })).toBe(75);
  });

  it("加权样例(手算):总时长 2 倍基准 0 分、上报达标 100、定级 90s 得 50、完成率 3/4 得 75、资源每任务 2 得 100 → 59 分", () => {
    const metrics: DrillMetrics = {
      totalDurationMs: 720_000,
      reportDurationMs: 30_000,
      gradingDurationMs: 90_000,
      taskDone: 3,
      taskTotal: 4,
      resourceTotal: 8,
    };
    // 0.25*0 + 0.15*100 + 0.20*50 + 0.25*75 + 0.15*100 = 58.75 → 四舍五入 59
    expect(computeScore(metrics)).toBe(59);
  });

  it("资源消耗按任务数折算:总量相同但任务更少时得分更低", () => {
    const sparse: DrillMetrics = { ...ideal, taskDone: 2, taskTotal: 2, resourceTotal: 16 };
    // 每任务 8 → (2*4-8)/4 = 0 → 资源子项 0;完成率 100;其余满分:100 - 15 = 85
    expect(computeScore(sparse)).toBe(85);
  });

  it("无任务时完成率子项按满分计(避免除零)", () => {
    const none: DrillMetrics = { ...ideal, taskDone: 0, taskTotal: 0, resourceTotal: 0 };
    expect(computeScore(none)).toBe(100);
  });
});
