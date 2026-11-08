import { describe, expect, it } from "vitest";
import { ScriptedModel } from "./model";
import { defaultNotification, runNotification, type NotificationInput } from "./notification";

const baseInput: NotificationInput = {
  audience: "staff_students",
  event: {
    type: "fire_alarm",
    title: "图书馆三层东区烟雾浓度超标疑似火情",
    location: "图书馆三层东区",
  },
  scenarioKey: "fire_alarm",
  scenarioName: "消防警报",
  severity: "II",
  simTimeLabel: "14:09:00",
};

function draftJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    title: "【模拟演练】图书馆三层火情疏散通知",
    content:
      "【模拟演练】图书馆三层东区发现烟雾,请三层师生立即沿西侧楼梯有序疏散至室外集结点,服从现场引导。本通知为模拟演练数据,非真实警情。",
    ...overrides,
  });
}

describe("通知发布智能体(缝 2)", () => {
  it("正常剧本:解析标题与正文", async () => {
    const result = await runNotification(new ScriptedModel({ notification: [draftJson()] }), baseInput);
    expect(result.source).toBe("model");
    expect(result.output.title).toContain("模拟演练");
    expect(result.output.content).toContain("疏散");
  });

  it("正文缺少「模拟演练」标识 → 视为坏输出,重试后仍缺 → 规则默认文案降级", async () => {
    const noMarker = JSON.stringify({ title: "火情通知", content: "请立即疏散。" });
    const result = await runNotification(
      new ScriptedModel({ notification: [noMarker, noMarker] }),
      baseInput,
    );
    expect(result.source).toBe("degraded");
    // 默认文案必须带标识,保证通知可发布
    expect(result.output.content).toContain("模拟演练");
  });

  it("坏 JSON 两次:规则默认文案降级(带标识、含事件与等级信息)", async () => {
    const result = await runNotification(
      new ScriptedModel({ notification: [{ badJson: true }, { badJson: true }] }),
      { ...baseInput, audience: "parents" },
    );
    expect(result.source).toBe("degraded");
    expect(result.degraded?.reason).toBe("invalid_output");
    expect(result.output.content).toContain("模拟演练");
    expect(result.output.content).toContain("图书馆三层东区");
  });

  it("默认文案按受众分化措辞(师生行动指引 / 家长告知安抚)", () => {
    const staff = defaultNotification(baseInput);
    const parents = defaultNotification({ ...baseInput, audience: "parents" });
    expect(staff.content).toContain("疏散");
    expect(parents.content).toContain("家长");
    for (const n of [staff, parents]) {
      expect(n.title).toContain("模拟演练");
      expect(n.content).toContain("模拟演练");
    }
  });

  it("模型挂起:超时后降级", async () => {
    const result = await runNotification(
      new ScriptedModel({ notification: [{ hangMs: 5_000 }, { hangMs: 5_000 }] }),
      baseInput,
      { timeoutMs: 50 },
    );
    expect(result.source).toBe("degraded");
    expect(result.degraded?.reason).toBe("timeout");
  });
});
