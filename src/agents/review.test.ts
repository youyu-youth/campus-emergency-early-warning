import { describe, expect, it } from "vitest";
import { ScriptedModel } from "./model";
import { defaultReview, runReview, type ReviewInput } from "./review";

const baseInput: ReviewInput = {
  event: {
    type: "fire_alarm",
    title: "图书馆三层东区疑似火情",
    location: "图书馆三层东区",
    severity: "II",
    detectedSimTime: "14:00:00",
  },
  scenarioKey: "fire_alarm",
  scenarioName: "消防警报",
  metrics: {
    totalDurationMs: 300_000,
    reportDurationMs: 15_000,
    gradingDurationMs: 45_000,
    taskDone: 3,
    taskTotal: 4,
    resourceTotal: 14,
  },
  timeline: [
    { seq: 1, phase: "perception", nodeType: "signal", title: "信号解读:创建事件", simTimeLabel: "14:00:00" },
    { seq: 2, phase: "grading", nodeType: "grading", title: "定级建议:II", simTimeLabel: "14:02:00" },
    { seq: 3, phase: "handling", nodeType: "dispatch", title: "任务方案:3 项", simTimeLabel: "14:03:00" },
    { seq: 4, phase: "notification", nodeType: "notification", title: "通知草稿:2 份", simTimeLabel: "14:06:00" },
  ],
  tasks: [
    { role: "security", title: "封锁并引导疏散", status: "done", success: true, attempts: 1 },
    { role: "medical", title: "医疗待命", status: "done", success: true, attempts: 1 },
    { role: "logistics", title: "切断三层电源", status: "failed", success: false, attempts: 2 },
  ],
  notifications: [
    { audience: "staff_students", title: "疏散通知", status: "published_sim", delivered: 1_112, total: 1_120 },
    { audience: "parents", title: "情况通报", status: "failed", delivered: null, total: null },
  ],
  anomalyCount: 1,
};

function reportJson(): string {
  return JSON.stringify({
    timelineSummary: [
      { nodeSeq: 1, summary: "烟雾传感器率先发现异常并创建事件" },
      { nodeSeq: 4, summary: "双受众通知确认后发布" },
    ],
    problems: [{ nodeSeq: 3, title: "断电任务两度失败", detail: "配电箱跳闸后未及时切换备用回路" }],
    improvements: [{ title: "补充备用回路操作培训", detail: "后勤断电流程增加备用回路切换演练" }],
  });
}

describe("复盘评估智能体(缝 2)", () => {
  it("正常剧本:解析时间线归纳、问题分析与改进建议", async () => {
    const result = await runReview(new ScriptedModel({ review: [reportJson()] }), baseInput);
    expect(result.source).toBe("model");
    expect(result.output.timelineSummary).toHaveLength(2);
    expect(result.output.timelineSummary[0]).toEqual({ nodeSeq: 1, summary: "烟雾传感器率先发现异常并创建事件" });
    expect(result.output.problems[0]!.nodeSeq).toBe(3);
    expect(result.output.improvements[0]!.title).toContain("备用回路");
  });

  it("坏 JSON 两次:规则默认报告骨架降级(归纳引用真实节点,问题由规则推导)", async () => {
    const result = await runReview(
      new ScriptedModel({ review: [{ badJson: true }, { badJson: true }] }),
      baseInput,
    );
    expect(result.source).toBe("degraded");
    expect(result.degraded?.reason).toBe("invalid_output");
    // 骨架归纳:逐条对应输入时间线的主轴节点
    expect(result.output.timelineSummary.map((s) => s.nodeSeq)).toEqual([1, 2, 3, 4]);
    expect(result.output.timelineSummary.every((s) => s.summary.length > 0)).toBe(true);
    // 规则推导的问题:失败任务、失败通知、降级各一条
    const titles = result.output.problems.map((p) => p.title);
    expect(titles.some((t) => t.includes("切断三层电源"))).toBe(true);
    expect(titles.some((t) => t.includes("家长"))).toBe(true);
    expect(titles.some((t) => t.includes("降级"))).toBe(true);
    expect(result.output.improvements).toHaveLength(1);
  });

  it("模型挂起:超时后降级", async () => {
    const result = await runReview(
      new ScriptedModel({ review: [{ hangMs: 5_000 }, { hangMs: 5_000 }] }),
      baseInput,
      { timeoutMs: 50 },
    );
    expect(result.source).toBe("degraded");
    expect(result.degraded?.reason).toBe("timeout");
  });

  it("干净推演的默认骨架:无失败无降级时问题清单为空", () => {
    const clean = defaultReview({
      ...baseInput,
      tasks: baseInput.tasks.map((t) => ({ ...t, status: "done", success: true })),
      notifications: baseInput.notifications.map((n) => ({
        ...n,
        status: "published_sim",
        delivered: 800,
        total: 810,
      })),
      anomalyCount: 0,
    });
    expect(clean.problems).toEqual([]);
    expect(clean.timelineSummary.length).toBeGreaterThan(0);
    expect(clean.improvements).toHaveLength(1);
  });
});
