import { describe, expect, it } from "vitest";
import { computeDelivery } from "./delivery-rules";

describe("通知送达规则(纯函数,规则+种子确定性)", () => {
  it("同种子同受众同尝试 → 完全一致的结果", () => {
    expect(computeDelivery(42, "parents", 1)).toEqual(computeDelivery(42, "parents", 1));
  });

  it("固定种子得到确定值(seed 42 双受众均成功)", () => {
    // 标准答案来自规则随机流的固化输出
    expect(computeDelivery(42, "staff_students", 1)).toEqual({
      ok: true,
      stats: { total: 1_120, delivered: 1_112, failed: 8 },
    });
    expect(computeDelivery(42, "parents", 1)).toEqual({
      ok: true,
      stats: { total: 732, delivered: 721, failed: 11 },
    });
  });

  it("seed 7 家长通道首试失败、重试成功(触发 failed→可重试路径)", () => {
    expect(computeDelivery(7, "parents", 1).ok).toBe(false);
    expect(computeDelivery(7, "parents", 2).ok).toBe(true);
  });

  it("通道失败时送达统计仍自洽(delivered + failed = total)", () => {
    const outcome = computeDelivery(27, "staff_students", 1);
    expect(outcome.ok).toBe(false);
    expect(outcome.stats.delivered + outcome.stats.failed).toBe(outcome.stats.total);
  });

  it("成功分发时个体失败率不超过上限(2%)", () => {
    for (const seed of [3, 19, 50]) {
      const { ok, stats } = computeDelivery(seed, "staff_students", 1);
      if (ok) {
        expect(stats.failed / stats.total).toBeLessThanOrEqual(0.02);
        expect(stats.delivered + stats.failed).toBe(stats.total);
      }
    }
  });
});
