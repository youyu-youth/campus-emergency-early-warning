import { describe, expect, it } from "vitest";
import { ScriptedModel } from "../agents/model";
import { openDatabase } from "../db/client";
import {
  getDrill,
  getEventByDrillId,
  getGraphRunByDrillId,
  getReportByDrillId,
  insertSignal,
  listNotificationsByDrill,
  listSignalsByDrill,
  listTasksByDrill,
  listTimelineByDrill,
  updateDrillStatus,
} from "../db/queries";
import type { ClockState } from "../simulation/clock";
import { generateSignalScript } from "../simulation/engine";
import { computeScore, type DrillMetrics } from "../simulation/score-rules";
import type { TaskPlanItem } from "../simulation/task-rules";
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

// —— 处置段剧本助手 ——

const PLAN_3 = [
  { role: "security", title: "封锁并引导疏散", description: "封锁图书馆三层东区,引导人员经西侧楼梯疏散" },
  { role: "medical", title: "医疗待命", description: "在楼下集结点待命,评估潜在伤员并准备急救" },
  { role: "logistics", title: "切断三层电源", description: "联动切断三层东区电源,设置外围警戒线" },
] as const;

function planJson(tasks: ReadonlyArray<{ role: string; title: string; description: string }> = PLAN_3): string {
  return JSON.stringify({ tasks, reasoning: "三角色并行处置" });
}

function evalNoJson(): string {
  return JSON.stringify({ needsRedispatch: false, additionalTasks: [], reasoning: "现有任务覆盖处置需要,无需调整" });
}

function evalAddJson(task: { role: string; title: string; description: string }): string {
  return JSON.stringify({
    needsRedispatch: true,
    additionalTasks: [task],
    reasoning: "场景演变带来新风险,需要加派",
  });
}

function narrativeJson(text: string): string {
  return JSON.stringify({ narrative: text });
}

function notificationJson(audience: "staff" | "parents"): string {
  const title =
    audience === "staff"
      ? "【模拟演练】图书馆三层火情疏散通知(师生)"
      : "【模拟演练】图书馆三层火情情况通报(家长)";
  const content =
    audience === "staff"
      ? "【模拟演练】三层师生请沿西侧楼梯有序疏散至图书馆前广场集结点,服从现场引导。本通知为模拟演练数据,非真实警情。"
      : "【模拟演练】家长您好:演练中火情已受控,学生安全,请勿恐慌赶往学校。本通报为模拟演练数据,非真实警情。";
  return JSON.stringify({ title, content });
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

    // 05 起通知段后进入复盘收尾:演练跑完全程进入 completed 终态
    expect(runner.status).toBe("completed");
    expect(getDrill(db, drillId)?.status).toBe("completed");

    // 到期信号按场景脚本 + 种子确定性写入 signals,全部完成感知
    const script = generateSignalScript("fire_alarm", 42);
    const signals = listSignalsByDrill(db, drillId);
    expect(signals).toHaveLength(script.length);
    expect(signals.map((s) => s.source_ref)).toEqual(script.map((s) => s.sourceRef));
    expect(signals.every((s) => s.status === "reported")).toBe(true);

    // 单事件焦点:仅创建一个事件,auto 全程跑完后事件受控,关联首信号
    const event = getEventByDrillId(db, drillId);
    expect(event).toBeDefined();
    expect(event!.status).toBe("closed");
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

    // 事件关闭记录 status_change 节点(复盘段),双时间同时落库
    const closeNode = nodes.find((n) => n.node_type === "status_change" && n.title.includes("事件关闭"));
    expect(closeNode?.phase).toBe("review");
    expect(closeNode?.sim_time).not.toBe(closeNode?.real_time);

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

    expect(runner.status).toBe("completed");
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

    // 降级不阻塞推演:事件仍以默认解读创建(auto 全程跑完到受控)
    const event = getEventByDrillId(db, drillId)!;
    expect(event.status).toBe("closed");
    expect(event.title).toContain("感知降级");
    // 每次感知降级记录一个 anomaly 节点(只统计感知段;后续段剧本缺失走各自降级,与本测试无关)
    const anomalies = listTimelineByDrill(db, drillId).filter(
      (n) => n.node_type === "anomaly" && n.phase === "perception",
    );
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
    expect(runner.status).toBe("completed");
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

    // 确认后推演恢复;03 起定级后流入任务方案确认点(剧本缺失 → 降级默认方案)
    await driveUntilNotRunning(runner, realNow);
    expect(runner.status).toBe("awaiting_confirmation");
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

    // 确认任务方案 → 处置段完成 → 通知确认点(剧本缺失走降级默认文案)→ 确认发布 → 复盘收尾
    await runner.confirmDispatch({});
    await driveUntilNotRunning(runner, realNow);
    expect(runner.status).toBe("awaiting_confirmation");
    await runner.confirmNotification();
    await driveUntilNotRunning(runner, realNow);
    expect(runner.status).toBe("completed");
    const finalNodes = listTimelineByDrill(db, drillId);
    expect(finalNodes.find((n) => n.node_type === "status_change" && n.title.includes("事件关闭"))!.phase).toBe("review");
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

    // 03/04 起,定级确认后依次流入任务方案、通知两个确认点(剧本缺失 → 降级),逐个确认后跑完
    await driveUntilNotRunning(runner, realNow);
    expect(runner.status).toBe("awaiting_confirmation");
    await runner.confirmDispatch({});
    await driveUntilNotRunning(runner, realNow);
    expect(runner.status).toBe("awaiting_confirmation");
    await runner.confirmNotification();
    await driveUntilNotRunning(runner, realNow);
    expect(runner.status).toBe("completed");
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
    for (let i = 0; i < 200 && runner.status === "running"; i++) {
      realNow.t += 1_000;
      await runner.tick();
      if (runner.status) seenStatuses.push(runner.status);
    }
    expect(runner.status).toBe("completed");
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

    // 降级不阻塞:事件按规则默认定级(medium → Ⅲ)并跑完全程
    expect(runner.status).toBe("completed");
    const event = getEventByDrillId(db, drillId)!;
    expect(event.severity).toBe("III");
    expect(event.status).toBe("closed");
    const anomaly = listTimelineByDrill(db, drillId).find(
      (n) => n.node_type === "anomaly" && n.phase === "grading",
    );
    expect(anomaly).toBeDefined();
    expect(anomaly!.title).toContain("指挥调度智能体降级");
    db.close();
  });
});

describe("推演运行器 · 处置段(缝 1)", () => {
  it("人工全流程:方案确认 → 三角色并行汇合反馈 → 失败重试 → 加派确认 → 事件 controlled → 段末暂停", async () => {
    const db = openDatabase(":memory:");
    const model = new ScriptedModel({
      perception: [perceptionJson(), perceptionJson(), perceptionJson()],
      // 调用序:定级 → 方案 → 里程碑1评估(加派) → 里程碑2/3评估(不加派)
      command: [
        commandJson("II"),
        planJson(),
        evalAddJson({ role: "security", title: "启动应急广播", description: "循环播放疏散引导广播" }),
        evalNoJson(),
        evalNoJson(),
      ],
      handling_security: [
        narrativeJson("保安组封锁东侧楼梯并引导 30 余名学生经西侧楼梯疏散,过程有序。"),
        narrativeJson("广播启动后人流疏散明显加快,未出现拥挤。"),
      ],
      handling_medical: [narrativeJson("医务组在集结点待命,评估 2 名轻微呛咳学生,无需送医。")],
      handling_logistics: [
        narrativeJson("后勤组断电时配电箱跳闸,首次未能完成,准备重试。"),
        narrativeJson("后勤组改用备用回路完成断电,并设置好警戒线。"),
      ],
      notification: [notificationJson("staff"), notificationJson("parents")],
    });
    const realNow = { t: Date.parse("2026-11-08T06:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });
    const { drillId } = await runner.start({ scenarioKey: "fire_alarm", seed: 42, speed: 60 });

    // 定级确认
    await driveUntilNotRunning(runner, realNow);
    realNow.t += 30_000;
    await runner.confirmGrading({});

    // 任务方案确认点:⚑ 方案节点带全量清单
    await driveUntilNotRunning(runner, realNow);
    expect(runner.status).toBe("awaiting_confirmation");
    const nodes0 = listTimelineByDrill(db, drillId);
    const planNode = nodes0.find((n) => n.node_type === "dispatch" && n.title.includes("任务方案"))!;
    expect(planNode.requires_confirmation).toBe(1);
    const planDetail = JSON.parse(planNode.detail);
    expect(planDetail.output.tasks).toHaveLength(3);
    expect(planDetail.input).toBeDefined();
    expect(planDetail.reasoning).toBeTypeOf("string");
    realNow.t += 10_000;
    const dispatched = await runner.confirmDispatch({});
    expect(dispatched.dispatchedCount).toBe(3);

    // 里程碑1评估建议加派 → 同一确认缝放行
    await driveUntilNotRunning(runner, realNow);
    expect(runner.status).toBe("awaiting_confirmation");
    const proposalNode = listTimelineByDrill(db, drillId).find(
      (n) => n.node_type === "dispatch" && n.title.includes("重新调度建议"),
    )!;
    expect(proposalNode.requires_confirmation).toBe(1);
    realNow.t += 8_000;
    await runner.confirmDispatch({});
    // 确认信息追加到 ⚑ 节点 detail(含耗时)
    const proposalDetail = getTimelineDetail(db, proposalNode.id) as { confirmation: { waitedMs: number } };
    expect(proposalDetail.confirmation.waitedMs).toBe(8_000);

    // 处置段完成 → 通知确认点:⚑ 通知节点含双受众草稿全文
    await driveUntilNotRunning(runner, realNow);
    expect(runner.status).toBe("awaiting_confirmation");
    expect((JSON.parse(getDrill(db, drillId)!.clock_state) as ClockState).running).toBe(false);
    const draftNodes = listTimelineByDrill(db, drillId).filter((n) => n.node_type === "notification");
    expect(draftNodes).toHaveLength(1);
    expect(draftNodes[0].phase).toBe("notification");
    expect(draftNodes[0].requires_confirmation).toBe(1);
    const drafts = JSON.parse(draftNodes[0].detail).drafts as Array<{ audience: string; content: string }>;
    expect(drafts).toHaveLength(2);
    expect(drafts.every((d) => d.content.includes("模拟演练"))).toBe(true);
    const pendingRows = listNotificationsByDrill(db, drillId);
    expect(pendingRows).toHaveLength(2);
    expect(pendingRows.every((n) => n.status === "pending_confirmation")).toBe(true);

    // 操作员确认发布:双受众 published_sim,送达统计由规则按种子计算(seed 42 固化值)
    realNow.t += 6_000;
    const publishResult = await runner.confirmNotification();
    expect(publishResult).toEqual({ published: 2, failed: 0 });
    const publishedRows = listNotificationsByDrill(db, drillId);
    expect(publishedRows.every((n) => n.status === "published_sim")).toBe(true);
    expect(publishedRows.every((n) => n.published_sim_time !== null)).toBe(true);
    const staffRow = publishedRows.find((n) => n.audience === "staff_students")!;
    expect(JSON.parse(staffRow.delivery!)).toMatchObject({ total: 1_120, delivered: 1_112, failed: 8 });
    const parentsRow = publishedRows.find((n) => n.audience === "parents")!;
    expect(JSON.parse(parentsRow.delivery!)).toMatchObject({ total: 732, delivered: 721, failed: 11 });
    // ⚑ 节点追加发布结果(发布时刻与统计)与确认耗时
    const nodeDetail = getTimelineDetail(db, draftNodes[0].id) as {
      publishes: Array<{ audience: string; status: string; attempt: number }>;
      confirmation: { waitedMs: number };
    };
    expect(nodeDetail.publishes).toHaveLength(2);
    expect(nodeDetail.publishes.every((p) => p.status === "published_sim" && p.attempt === 1)).toBe(true);
    expect(nodeDetail.confirmation.waitedMs).toBe(6_000);

    // 通知段跑完:进入复盘收尾,演练完成、时钟停走
    await driveUntilNotRunning(runner, realNow);
    expect(runner.status).toBe("completed");
    expect((JSON.parse(getDrill(db, drillId)!.clock_state) as ClockState).running).toBe(false);

    // 任务:3 项初始 + 1 项加派;logistics 首试失败自动重试后成功(规则+种子)
    const tasks = listTasksByDrill(db, drillId);
    expect(tasks).toHaveLength(4);
    expect(tasks.filter((t) => t.status === "done")).toHaveLength(4);
    const retryTask = tasks.find((t) => t.role === "logistics")!;
    expect(JSON.parse(retryTask.result!).attempts).toBe(2);
    expect(JSON.parse(retryTask.result!).success).toBe(true);
    expect(retryTask.completed_sim_time).not.toBeNull();
    const addedTask = tasks.find((t) => t.title === "启动应急广播")!;
    expect(addedTask.role).toBe("security");
    expect(addedTask.status).toBe("done");

    // 反馈节点:每角色叙述各异,logistics 两条(失败+重试),共 5 条;记录耗时与资源
    const nodes = listTimelineByDrill(db, drillId);
    const feedbacks = nodes.filter((n) => n.node_type === "feedback");
    expect(feedbacks).toHaveLength(5);
    expect(feedbacks.filter((n) => n.title.includes("第 2 次"))).toHaveLength(1);
    for (const fb of feedbacks) {
      const detail = JSON.parse(fb.detail);
      expect(detail.output.narrative).toBeTypeOf("string");
      expect(detail.output.durationMs).toBeGreaterThan(0);
      expect(detail.output.resources).toBeDefined();
    }
    expect(feedbacks.some((n) => JSON.parse(n.detail).output.narrative.includes("广播"))).toBe(true);

    // 事件状态机:graded → handling → controlled 全程留痕
    const event = getEventByDrillId(db, drillId)!;
    expect(event.status).toBe("closed");
    expect(event.severity).toBe("II");
    const statusTitles = nodes.filter((n) => n.node_type === "status_change").map((n) => n.title);
    expect(statusTitles.some((t) => t.includes("事件处置中"))).toBe(true);
    expect(statusTitles.some((t) => t.includes("事件已控制"))).toBe(true);

    // 里程碑 3 条(规则驱动) + operator_action 4 条(定级/方案/加派/通知确认)
    const finalNodes = listTimelineByDrill(db, drillId);
    expect(finalNodes.filter((n) => n.title.startsWith("场景演变"))).toHaveLength(3);
    expect(finalNodes.filter((n) => n.node_type === "operator_action")).toHaveLength(4);

    // 图快照:处置段执行簿完整,数据库可重建
    const state = JSON.parse(getGraphRunByDrillId(db, drillId)!.state);
    expect(state.phase).toBe("review"); // 通知段完成后进入复盘收尾
    expect(Object.keys(state.handling.tasks)).toHaveLength(4);
    expect(state.handling.writtenMilestoneOffsets).toHaveLength(3);
    db.close();
  });

  it("操作员调整方案:删任务 + 改标题后执行,落库与调整后一致", async () => {
    const db = openDatabase(":memory:");
    const model = new ScriptedModel({
      perception: [
        perceptionJson({ location: "操场西侧跑道", eventType: "medical_emergency" }),
        perceptionJson({ location: "操场西侧跑道", eventType: "medical_emergency" }),
      ],
      command: [commandJson("III"), planJson(), evalNoJson(), evalNoJson()],
      handling_security: [narrativeJson("保安组疏导围观学生并预留了救护通道。")],
      handling_medical: [narrativeJson("医务组评估学生意识恢复,情况稳定。")],
      notification: [notificationJson("staff"), notificationJson("parents")],
    });
    const realNow = { t: Date.parse("2026-11-08T02:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });
    const { drillId } = await runner.start({ scenarioKey: "medical_emergency", seed: 7, speed: 60 });

    await driveUntilNotRunning(runner, realNow);
    await runner.confirmGrading({});
    await driveUntilNotRunning(runner, realNow); // → 方案确认点
    expect(runner.status).toBe("awaiting_confirmation");

    // 调整:删除后勤任务,医务任务改标题
    const adjusted: TaskPlanItem[] = [
      { role: "medical", title: "现场急救与评估", description: "携带急救包评估生命体征" },
      { role: "security", title: "现场秩序维护", description: "疏导围观学生,预留救护车通道" },
    ];
    const result = await runner.confirmDispatch({ tasks: adjusted });
    expect(result.dispatchedCount).toBe(2);

    // 通知确认点 → 确认发布 → 段末暂停
    await driveUntilNotRunning(runner, realNow);
    expect(runner.status).toBe("awaiting_confirmation");
    await runner.confirmNotification();
    await driveUntilNotRunning(runner, realNow);
    expect(runner.status).toBe("completed");

    const tasks = listTasksByDrill(db, drillId);
    expect(tasks).toHaveLength(2);
    expect(tasks.map((t) => t.role).sort()).toEqual(["medical", "security"]);
    expect(tasks.find((t) => t.role === "medical")!.title).toBe("现场急救与评估");
    expect(tasks.every((t) => t.status === "done")).toBe(true);

    // 操作留痕:adjust 动作记录原建议与最终清单
    const op = listTimelineByDrill(db, drillId)
      .filter((n) => n.node_type === "operator_action")
      .find((n) => n.title.includes("调整"))!;
    const detail = JSON.parse(op.detail);
    expect(detail.action).toBe("adjust");
    expect(detail.kind).toBe("initial");
    expect(detail.proposed).toHaveLength(3);
    expect(detail.final).toHaveLength(2);
    db.close();
  });

  it("auto 模式:方案与加派均自动采纳,全程无确认暂停", async () => {
    const db = openDatabase(":memory:");
    const model = new ScriptedModel({
      perception: [perceptionJson(), perceptionJson(), perceptionJson()],
      command: [
        commandJson("II"),
        planJson(),
        evalAddJson({ role: "security", title: "启动应急广播", description: "循环播放疏散引导广播" }),
        evalNoJson(),
      ],
      handling_security: [
        narrativeJson("保安组封锁东侧楼梯并引导疏散。"),
        narrativeJson("广播引导后疏散加快。"),
      ],
      handling_medical: [narrativeJson("医务组待命评估。")],
      handling_logistics: [narrativeJson("首次断电失败。"), narrativeJson("重试完成断电。")],
    });
    const realNow = { t: Date.parse("2026-11-08T06:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });
    const { drillId } = await runner.start({ scenarioKey: "fire_alarm", seed: 42, speed: 60, autoConfirm: true });

    const seenStatuses: string[] = [];
    for (let i = 0; i < 200 && runner.status === "running"; i++) {
      realNow.t += 1_000;
      await runner.tick();
      if (runner.status) seenStatuses.push(runner.status);
    }
    expect(runner.status).toBe("completed");
    expect(seenStatuses).not.toContain("awaiting_confirmation");

    // 方案与加派建议均标记 auto 采纳(requires_confirmation=0);评估结论节点同类型但不需确认
    const nodes = listTimelineByDrill(db, drillId);
    const dispatchNodes = nodes.filter((n) => n.node_type === "dispatch");
    expect(dispatchNodes.some((n) => n.title.includes("任务方案"))).toBe(true);
    expect(dispatchNodes.some((n) => n.title.includes("重新调度建议"))).toBe(true);
    expect(dispatchNodes.every((n) => n.requires_confirmation === 0)).toBe(true);
    expect(nodes.some((n) => n.node_type === "operator_action")).toBe(false);

    // 加派任务同样执行并完成
    const tasks = listTasksByDrill(db, drillId);
    expect(tasks).toHaveLength(4);
    expect(tasks.every((t) => t.status === "done")).toBe(true);
    expect(getEventByDrillId(db, drillId)!.status).toBe("closed");
    db.close();
  });

  it("失败重试两次仍失败:任务终态 failed,事件仍推进 controlled", async () => {
    const db = openDatabase(":memory:");
    // seed 27:序号 1 的医务任务两次尝试均失败(规则随机流固化)
    const model = new ScriptedModel({
      perception: [
        perceptionJson({ location: "操场西侧跑道", eventType: "medical_emergency" }),
        perceptionJson({ location: "操场西侧跑道", eventType: "medical_emergency" }),
      ],
      command: [commandJson("III"), planJson(), evalNoJson(), evalNoJson(), evalNoJson()],
      handling_security: [narrativeJson("保安组疏导围观学生。")],
      handling_medical: [narrativeJson("首次急救评估未完成。"), narrativeJson("重试仍未完成,等待支援。")],
      handling_logistics: [narrativeJson("后勤组运送担架到位。")],
    });
    const realNow = { t: Date.parse("2026-11-08T02:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });
    const { drillId } = await runner.start({ scenarioKey: "medical_emergency", seed: 27, speed: 60, autoConfirm: true });
    await driveUntilNotRunning(runner, realNow);

    expect(runner.status).toBe("completed");
    const tasks = listTasksByDrill(db, drillId);
    const medical = tasks.find((t) => t.role === "medical")!;
    expect(medical.status).toBe("failed");
    const result = JSON.parse(medical.result!);
    expect(result.attempts).toBe(2);
    expect(result.success).toBe(false);
    // 其余任务不受失败影响,事件以受控收尾
    expect(tasks.filter((t) => t.status === "done")).toHaveLength(2);
    expect(getEventByDrillId(db, drillId)!.status).toBe("closed");
    const feedbacks = listTimelineByDrill(db, drillId).filter((n) => n.node_type === "feedback");
    expect(feedbacks.filter((n) => n.title.includes("医务"))).toHaveLength(2);
    db.close();
  });

  it("处置智能体坏输出:规则默认反馈 + anomaly 节点,不阻塞其他角色", async () => {
    const db = openDatabase(":memory:");
    const model = new ScriptedModel({
      perception: [
        perceptionJson({ location: "操场西侧跑道", eventType: "medical_emergency" }),
        perceptionJson({ location: "操场西侧跑道", eventType: "medical_emergency" }),
      ],
      command: [commandJson("III"), planJson(), evalNoJson(), evalNoJson()],
      handling_security: [{ badJson: true }, { badJson: true }],
      handling_medical: [narrativeJson("医务组完成现场急救评估。")],
      handling_logistics: [narrativeJson("后勤组器材运送到位。")],
    });
    const realNow = { t: Date.parse("2026-11-08T02:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });
    const { drillId } = await runner.start({ scenarioKey: "medical_emergency", seed: 7, speed: 60, autoConfirm: true });
    await driveUntilNotRunning(runner, realNow);

    // 推演不中断:全部任务终态,事件受控
    expect(runner.status).toBe("completed");
    const tasks = listTasksByDrill(db, drillId);
    expect(tasks.every((t) => t.status === "done")).toBe(true);
    expect(getEventByDrillId(db, drillId)!.status).toBe("closed");

    // 保安角色降级:默认叙述 + anomaly 节点;其他角色叙述正常
    const nodes = listTimelineByDrill(db, drillId);
    const securityFeedback = nodes.find((n) => n.node_type === "feedback" && n.title.includes("保安"))!;
    expect(JSON.parse(securityFeedback.detail).output.narrative).toContain("规则默认叙述");
    const anomaly = nodes.find(
      (n) => n.node_type === "anomaly" && n.phase === "handling" && n.title.includes("保安"),
    );
    expect(anomaly).toBeDefined();
    expect(nodes.find((n) => n.node_type === "feedback" && n.title.includes("医务"))!).toBeDefined();
    expect(nodes.find((n) => n.node_type === "feedback" && n.title.includes("后勤"))!).toBeDefined();
    db.close();
  });

  it("三角色并行扇出:同批到期任务的模型调用并发执行(批耗时≈单角色而非累加)", async () => {
    const db = openDatabase(":memory:");
    const model = new ScriptedModel({
      perception: [perceptionJson(), perceptionJson(), perceptionJson()],
      command: [commandJson("II"), planJson(), evalNoJson(), evalNoJson()],
      // 每角色首次响应挂起 120ms 后返回空对象(坏输出),第二次立即成功:单角色净耗时 ≈120ms
      handling_security: [{ hangMs: 120 }, narrativeJson("保安完成")],
      handling_medical: [{ hangMs: 120 }, narrativeJson("医务完成")],
      handling_logistics: [{ hangMs: 120 }, narrativeJson("后勤完成")],
    });
    const realNow = { t: Date.parse("2026-11-08T06:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });
    const { drillId } = await runner.start({ scenarioKey: "fire_alarm", seed: 42, speed: 60, autoConfirm: true });

    // 三任务到期时刻(255/274/297s)落在同一 tick(offset 300):Send 扇出应并发调用三角色
    let maxTickMs = 0;
    for (let i = 0; i < 200 && runner.status === "running"; i++) {
      realNow.t += 1_000;
      const startedAt = Date.now();
      await runner.tick();
      maxTickMs = Math.max(maxTickMs, Date.now() - startedAt);
    }
    expect(runner.status).toBe("completed");
    // 串行执行三角色需 ≥360ms;并发应显著低于该下限
    expect(maxTickMs).toBeLessThan(300);
    const roles = listTimelineByDrill(db, drillId)
      .filter((n) => n.node_type === "feedback")
      .map((n) => n.actor);
    expect(roles).toEqual(expect.arrayContaining(["security_agent", "medical_agent", "logistics_agent"]));
    db.close();
  });

  it("操作员拒绝加派:不加任务,记录 reject,推演继续收尾", async () => {
    const db = openDatabase(":memory:");
    const model = new ScriptedModel({
      perception: [
        perceptionJson({ location: "操场西侧跑道", eventType: "medical_emergency" }),
        perceptionJson({ location: "操场西侧跑道", eventType: "medical_emergency" }),
      ],
      command: [
        commandJson("III"),
        planJson(),
        evalAddJson({ role: "logistics", title: "增派担架转运", description: "增加一副担架与转运人员" }),
        evalNoJson(),
      ],
      handling_security: [narrativeJson("保安组疏导围观学生。")],
      handling_medical: [narrativeJson("医务组完成急救评估。")],
      handling_logistics: [narrativeJson("后勤组器材到位。")],
    });
    const realNow = { t: Date.parse("2026-11-08T02:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });
    const { drillId } = await runner.start({ scenarioKey: "medical_emergency", seed: 7, speed: 60 });

    await driveUntilNotRunning(runner, realNow);
    await runner.confirmGrading({});
    await driveUntilNotRunning(runner, realNow);
    await runner.confirmDispatch({}); // 初始方案
    await driveUntilNotRunning(runner, realNow); // → 加派确认点
    expect(runner.status).toBe("awaiting_confirmation");

    // 拒绝加派:提交空清单
    const rejected = await runner.confirmDispatch({ tasks: [] });
    expect(rejected.dispatchedCount).toBe(0);
    await driveUntilNotRunning(runner, realNow);
    expect(runner.status).toBe("awaiting_confirmation"); // 通知确认点(剧本缺失 → 降级默认文案)
    await runner.confirmNotification();
    await driveUntilNotRunning(runner, realNow);
    expect(runner.status).toBe("completed");

    // 未新增任务;拒绝动作留痕
    expect(listTasksByDrill(db, drillId)).toHaveLength(3);
    const rejectNode = listTimelineByDrill(db, drillId)
      .filter((n) => n.node_type === "operator_action")
      .find((n) => n.title.includes("拒绝"))!;
    expect(JSON.parse(rejectNode.detail).action).toBe("reject");
    expect(getEventByDrillId(db, drillId)!.status).toBe("closed");
    db.close();
  });
});

describe("推演运行器 · 通知段(缝 1)", () => {
  it("auto 模式:双受众自动发布,通道失败自动重试一次成功(seed 7 家长)", async () => {
    const db = openDatabase(":memory:");
    const model = new ScriptedModel({
      perception: [
        perceptionJson({ location: "操场西侧跑道", eventType: "medical_emergency" }),
        perceptionJson({ location: "操场西侧跑道", eventType: "medical_emergency" }),
      ],
      command: [commandJson("III"), planJson(), evalNoJson(), evalNoJson()],
      handling_security: [narrativeJson("保安组疏导围观学生。")],
      handling_medical: [narrativeJson("医务组完成急救评估。")],
      handling_logistics: [narrativeJson("后勤组器材到位。")],
      notification: [notificationJson("staff"), notificationJson("parents")],
    });
    const realNow = { t: Date.parse("2026-11-08T02:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });
    const { drillId } = await runner.start({ scenarioKey: "medical_emergency", seed: 7, speed: 60, autoConfirm: true });
    await driveUntilNotRunning(runner, realNow);

    // 全程无确认暂停;两份通知最终 published_sim
    expect(runner.status).toBe("completed");
    const rows = listNotificationsByDrill(db, drillId);
    expect(rows).toHaveLength(2);
    expect(rows.every((n) => n.status === "published_sim")).toBe(true);
    expect(listTimelineByDrill(db, drillId).some((n) => n.node_type === "operator_action")).toBe(false);

    // 家长通道首试失败、自动重试成功:delivery 记录第 2 次尝试的统计(seed 7 固化值)
    const parents = rows.find((n) => n.audience === "parents")!;
    expect(JSON.parse(parents.delivery!)).toMatchObject({
      total: 811,
      delivered: 799,
      failed: 12,
      attempt: 2,
    });
    // ⚑ 通知节点记录两次发布尝试(第 1 次失败 + 第 2 次成功)
    const node = listTimelineByDrill(db, drillId).find((n) => n.node_type === "notification")!;
    const publishes = JSON.parse(node.detail).publishes as Array<{ audience: string; attempt: number; status: string }>;
    const parentsPublishes = publishes.filter((x) => x.audience === "parents");
    expect(parentsPublishes.map((x) => [x.attempt, x.status])).toEqual([[1, "failed"], [2, "published_sim"]]);
    db.close();
  });

  it("人工模式:通道失败只影响通知自身,主线照常收尾;操作员可重试发布成功", async () => {
    const db = openDatabase(":memory:");
    const model = new ScriptedModel({
      perception: [
        perceptionJson({ location: "操场西侧跑道", eventType: "medical_emergency" }),
        perceptionJson({ location: "操场西侧跑道", eventType: "medical_emergency" }),
      ],
      command: [commandJson("III"), planJson(), evalNoJson(), evalNoJson()],
      handling_security: [narrativeJson("保安组疏导围观学生。")],
      handling_medical: [narrativeJson("医务组完成急救评估。")],
      handling_logistics: [narrativeJson("后勤组器材到位。")],
      notification: [notificationJson("staff"), notificationJson("parents")],
    });
    const realNow = { t: Date.parse("2026-11-08T02:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });
    const { drillId } = await runner.start({ scenarioKey: "medical_emergency", seed: 7, speed: 60 });

    // 走完三个确认点(定级/方案/通知)
    await driveUntilNotRunning(runner, realNow);
    await runner.confirmGrading({});
    await driveUntilNotRunning(runner, realNow);
    await runner.confirmDispatch({});
    await driveUntilNotRunning(runner, realNow);
    const publishResult = await runner.confirmNotification();
    expect(publishResult).toEqual({ published: 1, failed: 1 }); // 师生成功、家长通道失败

    // 失败不影响主线:推演照常推进到段末暂停,事件保持 controlled
    await driveUntilNotRunning(runner, realNow);
    expect(runner.status).toBe("completed");
    expect(getEventByDrillId(db, drillId)!.status).toBe("closed");
    const failedRow = listNotificationsByDrill(db, drillId).find((n) => n.status === "failed")!;
    expect(failedRow.audience).toBe("parents");

    // 操作员重试发布:第 2 次尝试成功,通知翻转为 published_sim
    realNow.t += 4_000;
    const retry = await runner.retryNotification();
    expect(retry).toEqual({ retried: 1, published: 2, failed: 0 });
    expect(listNotificationsByDrill(db, drillId).every((n) => n.status === "published_sim")).toBe(true);
    const node = listTimelineByDrill(db, drillId).find((n) => n.node_type === "notification")!;
    const parentsPublishes = (JSON.parse(node.detail).publishes as Array<{ audience: string; attempt: number }>).filter(
      (x) => x.audience === "parents",
    );
    expect(parentsPublishes).toHaveLength(2);

    // 无失败通知时再重试被拒绝
    await expect(runner.retryNotification()).rejects.toThrow(/没有失败的通知/);
    db.close();
  });

  it("中断恢复:草稿已落库但快照丢失,从 ⚑ 节点重建后仍可确认发布(不重复建行/节点)", async () => {
    const db = openDatabase(":memory:");
    const model = new ScriptedModel({
      perception: [perceptionJson(), perceptionJson(), perceptionJson()],
      command: [commandJson("II"), planJson(), evalNoJson(), evalNoJson(), evalNoJson()],
      handling_security: [narrativeJson("保安组封锁引导疏散。")],
      handling_medical: [narrativeJson("医务组待命评估。")],
      handling_logistics: [narrativeJson("首次断电失败。"), narrativeJson("重试完成断电。")],
      notification: [notificationJson("staff"), notificationJson("parents")],
    });
    const realNow = { t: Date.parse("2026-11-08T06:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });
    const { drillId } = await runner.start({ scenarioKey: "fire_alarm", seed: 42, speed: 60 });

    await driveUntilNotRunning(runner, realNow);
    await runner.confirmGrading({});
    await driveUntilNotRunning(runner, realNow);
    await runner.confirmDispatch({});
    await driveUntilNotRunning(runner, realNow);
    expect(runner.status).toBe("awaiting_confirmation"); // 通知确认点

    // 模拟崩溃:草稿与 ⚑ 节点已落库、快照未写入(时钟当时仍在走),重启后演练恢复为 running
    const run = getGraphRunByDrillId(db, drillId)!;
    const state = JSON.parse(run.state) as Record<string, unknown>;
    delete state.notification;
    db.prepare("UPDATE graph_runs SET state = ? WHERE id = ?").run(JSON.stringify(state), run.id);
    const drill = getDrill(db, drillId)!;
    const clock = JSON.parse(drill.clock_state) as { running: boolean; lastRealAt: number | null };
    clock.running = true;
    clock.lastRealAt = realNow.t;
    db.prepare("UPDATE drills SET clock_state = ? WHERE id = ?").run(JSON.stringify(clock), drillId);
    updateDrillStatus(db, drillId, "running");

    // 恢复推进:从 ⚑ 节点重建快照,重新进入确认点;通知行与节点不重复
    await runner.tick();
    expect(runner.status).toBe("awaiting_confirmation");
    expect(listNotificationsByDrill(db, drillId)).toHaveLength(2);
    expect(listTimelineByDrill(db, drillId).filter((n) => n.node_type === "notification")).toHaveLength(1);

    // 确认发布照常完成,双受众干净发布(seed 42)
    const result = await runner.confirmNotification();
    expect(result).toEqual({ published: 2, failed: 0 });
    await driveUntilNotRunning(runner, realNow);
    expect(runner.status).toBe("completed");
    db.close();
  });

  it("通知智能体全程坏输出:规则默认文案发布 + anomaly 节点,通知段照常完成", async () => {
    const db = openDatabase(":memory:");
    const model = new ScriptedModel({
      perception: [perceptionJson(), perceptionJson(), perceptionJson()],
      command: [commandJson("II"), planJson(), evalNoJson(), evalNoJson()],
      handling_security: [narrativeJson("保安组封锁引导疏散。")],
      handling_medical: [narrativeJson("医务组待命评估。")],
      handling_logistics: [narrativeJson("首次断电失败。"), narrativeJson("重试完成断电。")],
      notification: [{ badJson: true }, { badJson: true }, { badJson: true }, { badJson: true }],
    });
    const realNow = { t: Date.parse("2026-11-08T06:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });
    const { drillId } = await runner.start({ scenarioKey: "fire_alarm", seed: 42, speed: 60, autoConfirm: true });
    await driveUntilNotRunning(runner, realNow);

    expect(runner.status).toBe("completed");
    const rows = listNotificationsByDrill(db, drillId);
    expect(rows.every((n) => n.status === "published_sim")).toBe(true);
    expect(rows.every((n) => n.content.includes("模拟演练"))).toBe(true);
    expect(rows.every((n) => n.content.includes("规则默认文案"))).toBe(true);
    const anomalies = listTimelineByDrill(db, drillId).filter(
      (n) => n.node_type === "anomaly" && n.phase === "notification",
    );
    expect(anomalies).toHaveLength(2); // 每受众一次降级
    db.close();
  });
});

/** 读取时间线节点 detail 并解析(JSON) */
function getTimelineDetail(db: ReturnType<typeof openDatabase>, nodeId: string): Record<string, unknown> {
  const node = db.prepare("SELECT detail FROM timeline_nodes WHERE id = ?").get(nodeId) as {
    detail: string;
  };
  return JSON.parse(node.detail);
}

// —— 复盘段剧本助手 ——

function reportJson(): string {
  return JSON.stringify({
    timelineSummary: [
      { nodeSeq: 1, summary: "首个烟雾信号经感知解读创建事件" },
      { nodeSeq: 2, summary: "摄像头视觉确认作为补充证据" },
      { nodeSeq: 4, summary: "指挥调度定级为较大等级" },
      { nodeSeq: 5, summary: "三角色任务方案派发执行" },
      { nodeSeq: 999, summary: "引用不存在的节点(应被过滤)" },
    ],
    problems: [
      { nodeSeq: 4, title: "定级耗时偏长", detail: "从上报到定级耗时超出基准(剧本问题)" },
      { nodeSeq: 999, title: "引用无效节点的问题", detail: "nodeSeq 无效应丢弃引用保留问题" },
    ],
    improvements: [{ title: "压缩定级链路", detail: "建议预置等级判定参考表加快研判(剧本建议)" }],
  });
}

function fullAutoModel(overrides: Record<string, ScriptedModel["scripts"][string]> = {}): ScriptedModel {
  return new ScriptedModel({
    perception: [perceptionJson(), perceptionJson(), perceptionJson()],
    command: [commandJson("II"), planJson(), evalNoJson(), evalNoJson(), evalNoJson()],
    handling_security: [narrativeJson("保安组封锁引导疏散。")],
    handling_medical: [narrativeJson("医务组待命评估。")],
    handling_logistics: [narrativeJson("首次断电失败。"), narrativeJson("重试完成断电。")],
    notification: [notificationJson("staff"), notificationJson("parents")],
    review: [reportJson()],
    ...overrides,
  });
}

describe("推演运行器 · 复盘段收尾(缝 1)", () => {
  it("auto 全链路收尾:事件 closed、报告落库可溯源、规则评分写入 drills.score、演练 completed", async () => {
    const db = openDatabase(":memory:");
    const realNow = { t: Date.parse("2026-11-08T06:00:00.000Z") };
    const runner = new DrillRunner({ db, model: fullAutoModel(), now: () => realNow.t });
    const { drillId } = await runner.start({ scenarioKey: "fire_alarm", seed: 42, speed: 60, autoConfirm: true });
    await driveUntilNotRunning(runner, realNow);

    // 演练终态 completed:score 与 ended_at 落库,模拟时钟停走
    expect(runner.status).toBe("completed");
    const drill = getDrill(db, drillId)!;
    expect(drill.status).toBe("completed");
    expect(drill.score).not.toBeNull();
    expect(drill.score).toBeGreaterThanOrEqual(0);
    expect(drill.score).toBeLessThanOrEqual(100);
    expect(drill.ended_at).not.toBeNull();
    expect((JSON.parse(drill.clock_state) as ClockState).running).toBe(false);

    // 事件状态机走完全程:closed 且记录关闭(模拟)时刻
    const event = getEventByDrillId(db, drillId)!;
    expect(event.status).toBe("closed");
    expect(event.resolved_sim_time).not.toBeNull();

    // 时间线节点齐备:八类主轴节点覆盖,事件关闭节点属复盘段
    const nodes = listTimelineByDrill(db, drillId);
    for (const type of ["signal", "grading", "dispatch", "feedback", "notification", "status_change"]) {
      expect(nodes.some((n) => n.node_type === type)).toBe(true);
    }
    const closeNode = nodes.find((n) => n.node_type === "status_change" && n.title.includes("事件关闭"))!;
    expect(closeNode.phase).toBe("review");

    // 复盘报告落库:归纳逐条可溯源到真实节点,无效引用被过滤;指标条与任务结果一致
    const report = getReportByDrillId(db, drillId)!;
    expect(report.source).toBe("model");
    const summary = JSON.parse(report.timeline_summary) as Array<{ nodeSeq: number; summary: string }>;
    expect(summary).toHaveLength(4); // 5 条剧本中 nodeSeq=999 的无效引用被过滤
    const seqSet = new Set(nodes.map((n) => n.seq));
    expect(summary.every((s) => seqSet.has(s.nodeSeq))).toBe(true);
    const problems = JSON.parse(report.problems) as Array<{ nodeSeq?: number; title: string }>;
    expect(problems).toHaveLength(2);
    expect(problems.every((p) => p.nodeSeq === undefined || seqSet.has(p.nodeSeq))).toBe(true);
    const metrics = JSON.parse(report.metrics) as DrillMetrics;
    expect(metrics.taskDone).toBe(3); // PLAN_3 三任务全部完成(logistics 首试失败自动重试成功)
    expect(metrics.taskTotal).toBe(3);
    expect(metrics.resourceTotal).toBeGreaterThan(0);
    expect(metrics.totalDurationMs).toBeGreaterThanOrEqual(metrics.gradingDurationMs);
    // 评分与指标同源:drills.score 等于规则函数作用于报告指标条的结果
    expect(drill.score).toBe(computeScore(metrics));

    // 图快照:复盘段完成,报告 id 可重建
    const state = JSON.parse(getGraphRunByDrillId(db, drillId)!.state);
    expect(state.phase).toBe("review");
    expect(state.review.reportId).toBe(report.id);
    db.close();
  });

  it("复盘智能体坏输出:规则默认报告骨架 + anomaly 节点(复盘段),演练仍达 completed", async () => {
    const db = openDatabase(":memory:");
    const model = fullAutoModel({ review: [{ badJson: true }, { badJson: true }] });
    const realNow = { t: Date.parse("2026-11-08T06:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });
    const { drillId } = await runner.start({ scenarioKey: "fire_alarm", seed: 42, speed: 60, autoConfirm: true });
    await driveUntilNotRunning(runner, realNow);

    expect(runner.status).toBe("completed");
    const report = getReportByDrillId(db, drillId)!;
    expect(report.source).toBe("degraded");
    const summary = JSON.parse(report.timeline_summary) as Array<{ nodeSeq: number }>;
    expect(summary.length).toBeGreaterThan(0);
    const seqSet = new Set(listTimelineByDrill(db, drillId).map((n) => n.seq));
    expect(summary.every((s) => seqSet.has(s.nodeSeq))).toBe(true);
    // 复盘降级记录 anomaly 节点
    const anomaly = listTimelineByDrill(db, drillId).find(
      (n) => n.node_type === "anomaly" && n.phase === "review",
    );
    expect(anomaly?.title).toContain("复盘智能体降级");
    expect(getDrill(db, drillId)!.score).not.toBeNull();
    db.close();
  });

  it("全链路降级回归:调度/处置/通知/复盘同时坏输出,其余环节照常推进,演练仍达终态", async () => {
    const db = openDatabase(":memory:");
    const model = new ScriptedModel({
      perception: [perceptionJson(), perceptionJson(), perceptionJson()],
      command: [{ badJson: true }, { badJson: true }], // 定级与方案全部降级(后续调用剧本缺失同走降级)
      handling_security: [{ badJson: true }, { badJson: true }], // 保安角色降级
      handling_medical: [narrativeJson("医务组待命评估。")],
      handling_logistics: [narrativeJson("后勤组完成断电。")],
      notification: [{ badJson: true }, { badJson: true }, { badJson: true }, { badJson: true }],
      review: [{ badJson: true }, { badJson: true }],
    });
    const realNow = { t: Date.parse("2026-11-08T06:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });
    const { drillId } = await runner.start({ scenarioKey: "fire_alarm", seed: 42, speed: 60, autoConfirm: true });
    await driveUntilNotRunning(runner, realNow);

    // 主线不受任何单段降级影响:任务全终态、事件关闭、演练完成、评分与报告存在
    expect(runner.status).toBe("completed");
    const tasks = listTasksByDrill(db, drillId);
    expect(tasks.length).toBe(3); // 调度降级 → 规则默认三角色方案
    expect(tasks.every((t) => t.status === "done" || t.status === "failed")).toBe(true);
    expect(getEventByDrillId(db, drillId)!.status).toBe("closed");
    expect(getDrill(db, drillId)!.score).not.toBeNull();
    expect(getReportByDrillId(db, drillId)!.source).toBe("degraded");

    // 各段降级均有 anomaly 留痕:研判/处置/通知/复盘
    const phases = new Set(
      listTimelineByDrill(db, drillId)
        .filter((n) => n.node_type === "anomaly")
        .map((n) => n.phase),
    );
    for (const phase of ["grading", "handling", "notification", "review"]) {
      expect(phases.has(phase)).toBe(true);
    }
    db.close();
  });

  it("固定种子两次运行:评分、指标条、报告归纳与时间线节点序列完全一致(可复现)", async () => {
    const db = openDatabase(":memory:");
    const realNow = { t: Date.parse("2026-11-08T06:00:00.000Z") };

    const runOnce = async (): Promise<{ drillId: string }> => {
      const runner = new DrillRunner({ db, model: fullAutoModel(), now: () => realNow.t });
      const { drillId } = await runner.start({ scenarioKey: "fire_alarm", seed: 42, speed: 60, autoConfirm: true });
      await driveUntilNotRunning(runner, realNow);
      return { drillId };
    };

    const first = await runOnce();
    const second = await runOnce();

    expect(getDrill(db, first.drillId)!.score).toBe(getDrill(db, second.drillId)!.score);
    const r1 = getReportByDrillId(db, first.drillId)!;
    const r2 = getReportByDrillId(db, second.drillId)!;
    expect(r1.metrics).toBe(r2.metrics);
    expect(r1.timeline_summary).toBe(r2.timeline_summary);
    expect(r1.problems).toBe(r2.problems);
    const types1 = listTimelineByDrill(db, first.drillId).map((n) => n.node_type);
    const types2 = listTimelineByDrill(db, second.drillId).map((n) => n.node_type);
    expect(types1).toEqual(types2);
    db.close();
  });

  it("中断恢复:报告已落库但收尾未完成(快照丢失/保留两种窗口),重跑不重复建报告且完成收尾", async () => {
    const db = openDatabase(":memory:");
    const realNow = { t: Date.parse("2026-11-08T06:00:00.000Z") };
    const runner = new DrillRunner({ db, model: fullAutoModel(), now: () => realNow.t });
    const { drillId } = await runner.start({ scenarioKey: "fire_alarm", seed: 42, speed: 60, autoConfirm: true });
    await driveUntilNotRunning(runner, realNow);
    expect(runner.status).toBe("completed");

    // 窗口 A:复盘图已完成(报告已落库)但 graph_runs 快照未写入 → 图幂等,直接复用既有报告
    const run = getGraphRunByDrillId(db, drillId)!;
    const state = JSON.parse(run.state) as Record<string, unknown>;
    delete state.review;
    db.prepare("UPDATE graph_runs SET state = ? WHERE id = ?").run(JSON.stringify(state), run.id);
    db.prepare("UPDATE drills SET status = 'running', score = NULL, ended_at = NULL WHERE id = ?").run(drillId);

    await runner.tick();
    expect(runner.status).toBe("completed");
    expect(db.prepare("SELECT COUNT(*) AS n FROM reports WHERE drill_id = ?").get(drillId)).toEqual({ n: 1 });
    expect(getDrill(db, drillId)!.score).not.toBeNull();

    // 窗口 B:快照已写入但 drills 收尾(评分/终态)未落 → 从快照直接补齐收尾,不再进图
    const run2 = getGraphRunByDrillId(db, drillId)!;
    const state2 = JSON.parse(run2.state) as Record<string, unknown>;
    expect(state2.review).toBeDefined();
    db.prepare("UPDATE drills SET status = 'running', score = NULL, ended_at = NULL WHERE id = ?").run(drillId);
    await runner.tick();
    expect(runner.status).toBe("completed");
    expect(db.prepare("SELECT COUNT(*) AS n FROM reports WHERE drill_id = ?").get(drillId)).toEqual({ n: 1 });
    expect(getDrill(db, drillId)!.score).not.toBeNull();
    db.close();
  });
});

