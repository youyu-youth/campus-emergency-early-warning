import { describe, expect, it } from "vitest";
import { computeTaskOutcome, defaultTasksFor, MAX_TASK_ATTEMPTS } from "./task-rules";

describe("任务执行规则(纯函数,规则+种子确定性)", () => {
  it("同种子同序号同尝试 → 完全一致的结果", () => {
    expect(computeTaskOutcome(42, 0, 1, "security")).toEqual(computeTaskOutcome(42, 0, 1, "security"));
  });

  it("固定种子得到确定值(seed 42 logistics 序号 2:首试失败、重试成功)", () => {
    // 标准答案来自规则随机流的固化输出
    expect(computeTaskOutcome(42, 2, 1, "logistics")).toEqual({
      durationMs: 75_386,
      resources: { 人员: 1, 工具箱: 1 },
      success: false,
    });
    expect(computeTaskOutcome(42, 2, 2, "logistics").success).toBe(true);
  });

  it("重试使用不同随机流,结果与首次不同", () => {
    expect(computeTaskOutcome(42, 1, 1, "medical")).not.toEqual(computeTaskOutcome(42, 1, 2, "medical"));
  });

  it("场景默认方案覆盖保安/医务/后勤三角色", () => {
    for (const key of ["fire_alarm", "medical_emergency"]) {
      const plan = defaultTasksFor(key, "内置场景");
      expect(plan.map((t) => t.role).sort()).toEqual(["logistics", "medical", "security"]);
      expect(plan.every((t) => t.title.length > 0 && t.description.length > 0)).toBe(true);
    }
  });

  it("自定义场景用通用三角色模板(无缺条目崩溃)", () => {
    const plan = defaultTasksFor("custom_abc123", "实验室化学品泄漏");
    expect(plan.map((t) => t.role).sort()).toEqual(["logistics", "medical", "security"]);
    expect(plan.some((t) => t.description.includes("实验室化学品泄漏"))).toBe(true);
  });

  it("最大尝试次数为 2(首次执行 + 失败重试一次)", () => {
    expect(MAX_TASK_ATTEMPTS).toBe(2);
  });
});
