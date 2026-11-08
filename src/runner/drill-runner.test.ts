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

/** 以固定真实时间步进驱动运行器直到演练离开 running(或超出步数上限) */
async function driveUntilNotRunning(runner: DrillRunner, realNow: { t: number }, maxSteps = 200): Promise<void> {
  for (let i = 0; i < maxSteps && runner.status === "running"; i++) {
    realNow.t += 1_000; // 每步真实前进 1 秒,倍速 60 → 模拟前进 60 秒
    await runner.tick();
  }
}

describe("推演运行器 · 感知段(缝 1)", () => {
  it("fire_alarm:信号逐条产出 → 首信号建事件 → 后续信号补充证据 → 段末自动暂停", async () => {
    const db = openDatabase(":memory:");
    const model = new ScriptedModel({ perception: [perceptionJson(), perceptionJson(), perceptionJson()] });
    const realNow = { t: Date.parse("2026-11-08T06:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });

    const { drillId } = await runner.start({ scenarioKey: "fire_alarm", seed: 42, speed: 60 });
    await driveUntilNotRunning(runner, realNow);

    // 演练在感知段完成后自动暂停,落库状态一致
    expect(runner.status).toBe("paused");
    expect(getDrill(db, drillId)?.status).toBe("paused");

    // 到期信号按场景脚本 + 种子确定性写入 signals,全部完成感知
    const script = generateSignalScript("fire_alarm", 42);
    const signals = listSignalsByDrill(db, drillId);
    expect(signals).toHaveLength(script.length);
    expect(signals.map((s) => s.source_ref)).toEqual(script.map((s) => s.sourceRef));
    expect(signals.every((s) => s.status === "reported")).toBe(true);

    // 单事件焦点:仅创建一个事件,已上报、未定级、关联首信号
    const event = getEventByDrillId(db, drillId);
    expect(event).toBeDefined();
    expect(event!.status).toBe("reported");
    expect(event!.severity).toBeNull();
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
    const model = new ScriptedModel({ perception: [medicalJson("学生突发疾病疑似晕倒"), medicalJson("倒地检测补充确认")] });
    const realNow = { t: Date.parse("2026-11-08T02:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });

    const { drillId } = await runner.start({ scenarioKey: "medical_emergency", seed: 7, speed: 60 });
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
    });
    const realNow = { t: Date.parse("2026-11-08T06:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });

    const { drillId } = await runner.start({ scenarioKey: "fire_alarm", seed: 42, speed: 60 });
    await driveUntilNotRunning(runner, realNow);

    // 降级不阻塞推演:事件仍以默认解读创建
    const event = getEventByDrillId(db, drillId)!;
    expect(event.status).toBe("reported");
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
    });
    const realNow = { t: Date.parse("2026-11-08T06:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });
    await runner.start({ scenarioKey: "medical_emergency", seed: 7, speed: 60 });

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
    });
    const realNow = { t: Date.parse("2026-11-08T02:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });
    const { drillId } = await runner.start({ scenarioKey: "medical_emergency", seed: 7, speed: 60 });

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
