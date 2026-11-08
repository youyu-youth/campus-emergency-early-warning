import { describe, expect, it } from "vitest";
import { ScriptedModel } from "../agents/model";
import { openDatabase } from "../db/client";
import {
  getDrill,
  getEventByDrillId,
  getGraphRunByDrillId,
  insertSignal,
  listSignalsByDrill,
  listTimelineByDrill,
} from "../db/queries";
import type { ClockState } from "../simulation/clock";
import { generateSignalScript } from "../simulation/engine";
import { DrillRunner } from "./drill-runner";

function perceptionJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    location: "图书馆三层东区",
    eventType: "fire_alarm",
    title: "图书馆三层东区疑似火情",
    occurredTime: "14:00:00",
    evidence: ["烟雾浓度 0.42%/m 超过阈值 0.15%/m"],
    reasoning: "烟雾浓度显著超过阈值,判断为疑似火情",
    ...overrides,
  });
}

function commandJson(severity: "I" | "II" | "III" | "IV" = "II"): string {
  return JSON.stringify({
    suggestedSeverity: severity,
    reasoning: "烟雾浓度超标且视觉确认,建议定为较大等级",
  });
}

/** 以固定真实时间步进驱动运行器直到演练离开 running(或超出步数上限) */
async function driveUntilNotRunning(runner: DrillRunner, realNow: { t: number }, maxSteps = 200): Promise<void> {
  for (let i = 0; i < maxSteps && runner.status === "running"; i++) {
    realNow.t += 1_000; // 每步真实前进 1 秒,倍速 60 → 模拟前进 60 秒
    await runner.tick();
  }
}

describe("推演运行器 · 感知段(缝 1)", () => {
  it("fire_alarm:信号逐条产出 → 首信号建事件 → 后续信号补充证据(auto 全程跑通)", async () => {
    const db = openDatabase(":memory:");
    const model = new ScriptedModel({
      perception: [perceptionJson(), perceptionJson(), perceptionJson()],
      command: [commandJson("II")],
    });
    const realNow = { t: Date.parse("2026-11-08T06:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });

    const { drillId } = await runner.start({ scenarioKey: "fire_alarm", seed: 42, speed: 60, autoConfirm: true });
    await driveUntilNotRunning(runner, realNow);

    // 演练在研判段完成后自动暂停,落库状态一致
    expect(runner.status).toBe("paused");
    expect(getDrill(db, drillId)?.status).toBe("paused");

    // 到期信号按场景脚本 + 种子确定性写入 signals,全部完成感知
    const script = generateSignalScript("fire_alarm", 42);
    const signals = listSignalsByDrill(db, drillId);
    expect(signals).toHaveLength(script.length);
    expect(signals.map((s) => s.source_ref)).toEqual(script.map((s) => s.sourceRef));
    expect(signals.every((s) => s.status === "reported")).toBe(true);

    // 单事件焦点:仅创建一个事件,auto 定级后已定级,关联首信号
    const event = getEventByDrillId(db, drillId);
    expect(event).toBeDefined();
    expect(event!.status).toBe("graded");
    expect(event!.severity).toBe("II");
    expect(event!.signal_id).toBe(signals[0].id);
    expect(event!.type).toBe("fire_alarm");
    expect(event!.title).toBe("图书馆三层东区疑似火情");

    // 时间线:每条信号一个 signal 节点,全部关联同一事件,detail 含三段
    const nodes = listTimelineByDrill(db, drillId);
    const signalNodes = nodes.filter((n) => n.node_type === "signal");
    expect(signalNodes).toHaveLength(script.length);
    expect(signalNodes.every((n) => n.event_id === event!.id)).toBe(true);
    const detail = JSON.parse(signalNodes[0].detail);
    expect(detail.input).toBeDefined();
    expect(detail.reasoning).toBeTypeOf("string");
    expect(detail.output).toBeDefined();
    expect(signalNodes[0].title).toContain("创建事件");
    expect(signalNodes[1].title).toContain("补充证据");

    // 段末自动暂停记录 status_change 节点,双时间同时落库
    const pauseNode = nodes.find((n) => n.node_type === "status_change");
    expect(pauseNode?.title).toContain("暂停");
    expect(pauseNode?.sim_time).not.toBe(pauseNode?.real_time);

    // 图状态快照写入 graph_runs,数据库可重建推演进度
    const graphRun = getGraphRunByDrillId(db, drillId);
    expect(graphRun).toBeDefined();
    const state = JSON.parse(graphRun!.state);
    expect(state.eventId).toBe(event!.id);
    expect(state.processedSignalIds).toHaveLength(script.length);

    db.close();
  });

  it("medical_emergency:第二类场景同样跑通,后续信号不开新事件", async () => {
    const db = openDatabase(":memory:");
    const medicalJson = (title: string) =>
      perceptionJson({ location: "操场西侧跑道", eventType: "medical_emergency", title });
    const model = new ScriptedModel({
      perception: [medicalJson("学生突发疾病疑似晕倒"), medicalJson("倒地检测补充确认")],
      command: [commandJson("III")],
    });
    const realNow = { t: Date.parse("2026-11-08T02:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });

    const { drillId } = await runner.start({ scenarioKey: "medical_emergency", seed: 7, speed: 60, autoConfirm: true });
    await driveUntilNotRunning(runner, realNow);

    expect(runner.status).toBe("paused");
    const script = generateSignalScript("medical_emergency", 7);
    expect(listSignalsByDrill(db, drillId)).toHaveLength(script.length);
    // 单事件焦点:两路信号只归并到一个事件
    const eventsCount = db
      .prepare("SELECT COUNT(*) AS n FROM events WHERE drill_id = ?")
      .get(drillId) as { n: number };
    expect(eventsCount.n).toBe(1);
    const event = getEventByDrillId(db, drillId)!;
    expect(event.type).toBe("medical_emergency");
    expect(listTimelineByDrill(db, drillId).filter((n) => n.node_type === "signal")).toHaveLength(script.length);
    db.close();
  });

  it("感知全程坏输出:降级默认解读上报,事件仍创建并记 anomaly 节点", async () => {
    const db = openDatabase(":memory:");
    const model = new ScriptedModel({
      perception: [
        { badJson: true },
        { badJson: true },
        { badJson: true },
        { badJson: true },
        { badJson: true },
        { badJson: true },
      ],
      command: [commandJson("II")],
    });
    const realNow = { t: Date.parse("2026-11-08T06:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });

    const { drillId } = await runner.start({ scenarioKey: "fire_alarm", seed: 42, speed: 60, autoConfirm: true });
    await driveUntilNotRunning(runner, realNow);

    // 降级不阻塞推演:事件仍以默认解读创建(auto 模式下继续完成定级)
    const event = getEventByDrillId(db, drillId)!;
    expect(event.status).toBe("graded");
    expect(event.title).toContain("感知降级");
    // 每次降级记录一个 anomaly 节点
    const anomalies = listTimelineByDrill(db, drillId).filter((n) => n.node_type === "anomaly");
    expect(anomalies).toHaveLength(generateSignalScript("fire_alarm", 42).length);
    expect(anomalies.every((n) => n.title.includes("降级"))).toBe(true);
    db.close();
  });

  it("模型调用在途时的并发 tick 不会提前判定段末暂停", async () => {
    const db = openDatabase(":memory:");
    // 首个剧本慢响应(模拟模型在途),第二个为正常输出
    const model = new ScriptedModel({
      perception: [{ hangMs: 400 }, perceptionJson({ title: "慢响应解读" })],
      command: [commandJson("III")],
    });
    const realNow = { t: Date.parse("2026-11-08T06:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });
    await runner.start({ scenarioKey: "medical_emergency", seed: 7, speed: 60, autoConfirm: true });

    realNow.t += 120_000; // 一步跨过全部信号到期时刻
    const inFlight = runner.tick(); // 首个 tick:信号写入后停留在模型调用
    await new Promise((r) => setTimeout(r, 50));
    await runner.tick(); // 并发 tick:不允许推进,更不允许提前暂停
    expect(runner.status).toBe("running");

    await inFlight; // 首个 tick 完成(此时只处理了先到期信号的批次)
    await driveUntilNotRunning(runner, realNow);
    expect(runner.status).toBe("paused");
    expect(getEventByDrillId(db, runner.drillId!)).toBeDefined();
    db.close();
  });

  it("已写入未感知的遗留信号不会被跳过(模拟中断后继续感知)", async () => {
    const db = openDatabase(":memory:");
    const model = new ScriptedModel({
      perception: [perceptionJson({ location: "操场西侧跑道", eventType: "medical_emergency" }), perceptionJson()],
      command: [commandJson("III")],
    });
    const realNow = { t: Date.parse("2026-11-08T02:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });
    const { drillId } = await runner.start({ scenarioKey: "medical_emergency", seed: 7, speed: 60, autoConfirm: true });

    // 模拟进程中断:首信号已落库(status=new)但未来得及感知
    const script = generateSignalScript("medical_emergency", 7);
    const first = script[0];
    insertSignal(db, {
      drill_id: drillId,
      source_kind: first.kind,
      source_ref: first.sourceRef,
      location: first.location,
      signal_type: first.signalType,
      payload: JSON.stringify(first.payload),
      confidence: first.confidence,
      sim_time: "2026-11-08T02:15:00.000Z",
    });

    await driveUntilNotRunning(runner, realNow);

    // 遗留信号被感知而非跳过,且不会重复写入
    const signals = listSignalsByDrill(db, drillId);
    expect(signals).toHaveLength(script.length);
    expect(new Set(signals.map((s) => s.source_ref)).size).toBe(script.length);
    expect(signals.every((s) => s.status === "reported")).toBe(true);
    expect(getEventByDrillId(db, drillId)?.signal_id).toBe(signals[0].id);
    db.close();
  });

  it("同一时间至多一场运行中的演练", async () => {
    const db = openDatabase(":memory:");
    const realNow = { t: Date.parse("2026-11-08T06:00:00.000Z") };
    const runner = new DrillRunner({ db, model: new ScriptedModel({ perception: [] }), now: () => realNow.t });
    await runner.start({ scenarioKey: "fire_alarm", seed: 1, speed: 60 });
    await expect(
      new DrillRunner({ db, model: new ScriptedModel({ perception: [] }), now: () => realNow.t }).start({
        scenarioKey: "medical_emergency",
        seed: 2,
      }),
    ).rejects.toThrow(/至多一场/);
    db.close();
  });
});

describe("推演运行器 · 研判段定级确认(缝 1)", () => {
  it("事件上报后进入定级节点:演练转 awaiting_confirmation,模拟时钟停走,⚑ 节点带建议等级", async () => {
    const db = openDatabase(":memory:");
    const model = new ScriptedModel({
      perception: [perceptionJson(), perceptionJson(), perceptionJson()],
      command: [commandJson("II")],
    });
    const realNow = { t: Date.parse("2026-11-08T06:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });

    const { drillId } = await runner.start({ scenarioKey: "fire_alarm", seed: 42, speed: 60 });
    await driveUntilNotRunning(runner, realNow);

    // 演练在定级节点暂停等待确认,模拟时钟同步停走
    expect(runner.status).toBe("awaiting_confirmation");
    const drill = getDrill(db, drillId)!;
    expect(drill.status).toBe("awaiting_confirmation");
    expect((JSON.parse(drill.clock_state) as ClockState).running).toBe(false);

    // ⚑ 定级节点:requires_confirmation=1,detail 含输入/依据/输出三段与建议等级
    const gradingNode = listTimelineByDrill(db, drillId).find((n) => n.node_type === "grading");
    expect(gradingNode).toBeDefined();
    expect(gradingNode!.phase).toBe("grading");
    expect(gradingNode!.requires_confirmation).toBe(1);
    const detail = JSON.parse(gradingNode!.detail);
    expect(detail.input).toBeDefined();
    expect(detail.reasoning).toBeTypeOf("string");
    expect(detail.output.suggestedSeverity).toBe("II");

    // 事件在操作员确认前保持已上报、未定级
    const event = getEventByDrillId(db, drillId)!;
    expect(event.status).toBe("reported");
    expect(event.severity).toBeNull();
    db.close();
  });

  it("操作员确认定级:事件定级、⚑ 节点与 operator_action 记录确认耗时,推演恢复后段末暂停", async () => {
    const db = openDatabase(":memory:");
    const model = new ScriptedModel({
      perception: [perceptionJson(), perceptionJson(), perceptionJson()],
      command: [commandJson("II")],
    });
    const realNow = { t: Date.parse("2026-11-08T06:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });
    const { drillId } = await runner.start({ scenarioKey: "fire_alarm", seed: 42, speed: 60 });
    await driveUntilNotRunning(runner, realNow); // → awaiting_confirmation

    // 操作员等待 30 秒(真实时间)后确认建议等级
    realNow.t += 30_000;
    const confirmedAt = realNow.t;
    const confirmed = await runner.confirmGrading({});
    expect(confirmed.severity).toBe("II");
    expect(runner.status).toBe("running");

    // 确认后推演恢复,到研判段末自动暂停,时钟停走
    await driveUntilNotRunning(runner, realNow);
    expect(runner.status).toBe("paused");
    expect((JSON.parse(getDrill(db, drillId)!.clock_state) as ClockState).running).toBe(false);

    // 事件定级结果与状态机流转
    const event = getEventByDrillId(db, drillId)!;
    expect(event.severity).toBe("II");
    expect(event.status).toBe("graded");

    // operator_action 节点:确认动作、建议与最终等级、确认耗时
    const nodes = listTimelineByDrill(db, drillId);
    const operatorNode = nodes.find((n) => n.node_type === "operator_action");
    expect(operatorNode).toBeDefined();
    expect(operatorNode!.actor).toBe("operator");
    const opDetail = JSON.parse(operatorNode!.detail);
    expect(opDetail.action).toBe("confirm");
    expect(opDetail.suggested).toBe("II");
    expect(opDetail.final).toBe("II");
    expect(opDetail.waitedMs).toBe(30_000);

    // ⚑ 定级节点 detail 追加确认信息(耗时与最终等级)
    const gradingNode = nodes.find((n) => n.node_type === "grading")!;
    expect(JSON.parse(gradingNode.detail).confirmation).toEqual({
      action: "confirm",
      final: "II",
      waitedMs: 30_000,
      confirmedRealTime: new Date(confirmedAt).toISOString(),
    });

    // 段末暂停留痕 status_change
    expect(nodes.find((n) => n.node_type === "status_change")!.title).toContain("研判");
    db.close();
  });

  it("操作员调整定级:输入新等级生效并记为 adjust;非等待状态确认被拒绝", async () => {
    const db = openDatabase(":memory:");
    const model = new ScriptedModel({
      perception: [perceptionJson(), perceptionJson(), perceptionJson()],
      command: [commandJson("II")],
    });
    const realNow = { t: Date.parse("2026-11-08T06:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });
    const { drillId } = await runner.start({ scenarioKey: "fire_alarm", seed: 42, speed: 60 });
    await driveUntilNotRunning(runner, realNow); // → awaiting_confirmation

    realNow.t += 5_000;
    const adjusted = await runner.confirmGrading({ severity: "IV" });
    expect(adjusted.severity).toBe("IV");

    await driveUntilNotRunning(runner, realNow);
    expect(runner.status).toBe("paused");
    expect(getEventByDrillId(db, drillId)!.severity).toBe("IV");

    const operatorNode = listTimelineByDrill(db, drillId).find((n) => n.node_type === "operator_action")!;
    const opDetail = JSON.parse(operatorNode.detail);
    expect(opDetail.action).toBe("adjust");
    expect(opDetail.suggested).toBe("II");
    expect(opDetail.final).toBe("IV");
    expect(opDetail.waitedMs).toBe(5_000);

    // 段末已暂停,再确认属于非法状态流转,被拒绝且不改库
    await expect(runner.confirmGrading({})).rejects.toThrow(/没有等待确认/);
    db.close();
  });

  it("auto 模式:自动采纳建议不暂停,⚑ 节点标记无需人工确认且无 operator_action", async () => {
    const db = openDatabase(":memory:");
    const model = new ScriptedModel({
      perception: [perceptionJson(), perceptionJson(), perceptionJson()],
      command: [commandJson("II")],
    });
    const realNow = { t: Date.parse("2026-11-08T06:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });
    const { drillId } = await runner.start({ scenarioKey: "fire_alarm", seed: 42, speed: 60, autoConfirm: true });

    // 逐 tick 记录状态:全程不得进入 awaiting_confirmation
    const seenStatuses: string[] = [];
    for (let i = 0; i < 200 && runner.status !== "paused"; i++) {
      realNow.t += 1_000;
      await runner.tick();
      if (runner.status) seenStatuses.push(runner.status);
    }
    expect(runner.status).toBe("paused");
    expect(seenStatuses).not.toContain("awaiting_confirmation");

    const nodes = listTimelineByDrill(db, drillId);
    const gradingNode = nodes.find((n) => n.node_type === "grading")!;
    expect(gradingNode.requires_confirmation).toBe(0);
    expect(gradingNode.title).toContain("自动采纳");
    expect(nodes.some((n) => n.node_type === "operator_action")).toBe(false);
    expect(getEventByDrillId(db, drillId)!.severity).toBe("II");
    db.close();
  });

  it("调度智能体坏输出:规则默认定级 + anomaly 节点,推演不中断", async () => {
    const db = openDatabase(":memory:");
    const model = new ScriptedModel({
      perception: [perceptionJson(), perceptionJson(), perceptionJson()],
      command: [{ badJson: true }, { badJson: true }],
    });
    const realNow = { t: Date.parse("2026-11-08T06:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });
    const { drillId } = await runner.start({ scenarioKey: "fire_alarm", seed: 42, speed: 60, autoConfirm: true });
    await driveUntilNotRunning(runner, realNow);

    // 降级不阻塞:事件按规则默认定级(medium → Ⅲ)并完成研判段
    expect(runner.status).toBe("paused");
    const event = getEventByDrillId(db, drillId)!;
    expect(event.severity).toBe("III");
    expect(event.status).toBe("graded");
    const anomaly = listTimelineByDrill(db, drillId).find(
      (n) => n.node_type === "anomaly" && n.phase === "grading",
    );
    expect(anomaly).toBeDefined();
    expect(anomaly!.title).toContain("指挥调度智能体降级");
    db.close();
  });
});
