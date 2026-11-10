// 服务层 DTO 组装测试:人工确认全流程下 summary/detail/pendingConfirmation 的形状与内容
// 驱动模式与 drill-runner.test 相同(固定真实时间步进);模型用离线演示剧本(DEMO_SCRIPTS)

import { describe, expect, it } from "vitest";

import { openDatabase } from "../db/client";
import { getActiveDrills, getDrill, getGraphRunByDrillId } from "../db/queries";
import type { DrillRow, TaskRow, TimelineNodeRow } from "../db/types";
import { DEMO_SCRIPTS } from "../../scripts/demo-scripts";
import { ScriptedModel, type ScriptedResponse } from "../agents/model";
import { DrillRunner } from "../runner/drill-runner";
import type { NotificationDTO } from "../lib/drill-types";
import { buildDrillDetail, buildDrillHistory, buildDrillSummary, buildRestartInput, deriveAgentActivity } from "./drill-service";

async function driveUntilNotRunning(runner: DrillRunner, realNow: { t: number }, maxSteps = 400): Promise<void> {
  for (let i = 0; i < maxSteps && runner.status === "running"; i++) {
    realNow.t += 1_000; // 每步真实 1 秒,倍速 60 → 模拟 60 秒
    await runner.tick();
  }
}

describe("演练服务 · 查询 DTO 组装", () => {
  it("人工确认全流程:三个确认点的 pendingConfirmation 与终态 detail 完整", async () => {
    const db = openDatabase(":memory:");
    const model = new ScriptedModel(DEMO_SCRIPTS.fire_alarm);
    const realNow = { t: Date.parse("2026-11-08T06:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });
    const { drillId } = await runner.start({ scenarioKey: "fire_alarm", seed: 42, speed: 60 });
    expect(runner.status).toBe("running");

    // 缝 1:推进到定级确认
    await driveUntilNotRunning(runner, realNow);
    expect(runner.status).toBe("awaiting_confirmation");
    let summary = buildDrillSummary(db, getDrill(db, drillId)!);
    expect(summary.status).toBe("awaiting_confirmation");
    expect(summary.phase).toBe("grading");
    expect(summary.severity).toBeNull();
    expect(summary.simClockLabel).toMatch(/^\d{2}:\d{2}:\d{2}$/);

    let detail = buildDrillDetail(db, drillId)!;
    expect(detail.pendingConfirmation?.kind).toBe("grading");
    if (detail.pendingConfirmation?.kind === "grading") {
      expect(["I", "II", "III", "IV"]).toContain(detail.pendingConfirmation.suggested);
      expect(detail.pendingConfirmation.reasoning).toBeTypeOf("string");
    }
    const gradingNode = detail.timeline.find((n) => n.nodeType === "grading");
    expect(gradingNode?.requiresConfirmation).toBe(true);
    expect(gradingNode?.confirmation).toBeUndefined();
    expect(gradingNode?.reasoning).toBeTypeOf("string");
    expect(detail.agents.find((a) => a.key === "command")?.status).toBe("working");

    await runner.confirmGrading({});

    // 缝 2:任务方案确认(可能随后续里程碑加派多次)
    let confirmedDispatch = 0;
    let guard = 0;
    while (guard++ < 20) {
      await driveUntilNotRunning(runner, realNow);
      if (runner.status !== "awaiting_confirmation") break;
      const state = JSON.parse(getGraphRunByDrillId(db, drillId)!.state) as {
        grading?: { status?: string };
        dispatch?: { status?: string };
        notification?: { status?: string };
      };
      detail = buildDrillDetail(db, drillId)!;
      if (state.grading?.status === "awaiting_confirmation") {
        await runner.confirmGrading({});
      } else if (state.dispatch?.status === "awaiting_confirmation") {
        expect(detail.pendingConfirmation?.kind).toBe("dispatch");
        if (detail.pendingConfirmation?.kind === "dispatch") {
          expect(detail.pendingConfirmation.proposedTasks.length).toBeGreaterThan(0);
          expect(
            detail.pendingConfirmation.proposedTasks.every((t) =>
              ["security", "medical", "logistics"].includes(t.role),
            ),
          ).toBe(true);
        }
        confirmedDispatch += 1;
        await runner.confirmDispatch({});
      } else if (state.notification?.status === "awaiting_confirmation") {
        // 缝 3:通知发布确认
        summary = buildDrillSummary(db, getDrill(db, drillId)!);
        expect(summary.severity).not.toBeNull();
        detail = buildDrillDetail(db, drillId)!;
        expect(detail.pendingConfirmation?.kind).toBe("notification");
        if (detail.pendingConfirmation?.kind === "notification") {
          expect(detail.pendingConfirmation.drafts.length).toBe(2);
          expect(detail.pendingConfirmation.drafts.every((d) => d.content.includes("模拟演练"))).toBe(true);
        }
        await runner.confirmNotification();
        break;
      }
    }
    expect(confirmedDispatch).toBeGreaterThanOrEqual(1);

    // 终态:completed,无活跃摘要,detail 完整可复盘
    await driveUntilNotRunning(runner, realNow);
    expect(runner.status).toBe("completed");

    const activeRow = db
      .prepare("SELECT id FROM drills WHERE status IN ('running','awaiting_confirmation')")
      .get() as { id: string } | undefined;
    expect(activeRow).toBeUndefined();

    detail = buildDrillDetail(db, drillId)!;
    expect(detail.drill.status).toBe("completed");
    expect(detail.drill.score).not.toBeNull();
    expect(detail.event?.status).toBe("closed");
    expect(detail.pendingConfirmation).toBeNull();
    expect(detail.tasks.length).toBeGreaterThan(0);
    expect(detail.notifications.every((n) => n.status === "published_sim" || n.status === "failed")).toBe(true);
    // ⚑ 定级节点带上确认信息(确认耗时 + 最终等级)
    const confirmedGrading = detail.timeline.find((n) => n.nodeType === "grading");
    expect(confirmedGrading?.confirmation?.action).toBe("confirm");
    expect(confirmedGrading?.confirmation?.final).toMatch(/^(I|II|III|IV)$/);
    // 编队:全程结束全部已完成,时间线节点可作为各智能体的最近动作
    expect(detail.agents.every((a) => a.status === "done")).toBe(true);
    expect(detail.agents.find((a) => a.key === "perception")?.latestAction).toBeTypeOf("string");
    // 复盘报告随详情暴露(报告页数据源):形状完整,nodeSeq 全部可溯源到时间线
    expect(detail.report).not.toBeNull();
    const report = detail.report!;
    expect(["model", "degraded"]).toContain(report.source);
    expect(report.timelineSummary.length).toBeGreaterThan(0);
    expect(report.problems.length + report.improvements.length).toBeGreaterThan(0);
    const seqs = new Set(detail.timeline.map((n) => n.seq));
    expect(report.timelineSummary.every((item) => seqs.has(item.nodeSeq))).toBe(true);
    expect(report.problems.every((p) => p.nodeSeq === null || seqs.has(p.nodeSeq))).toBe(true);
    // 指标条数据源:五项指标齐全且总时长为正
    expect(report.metrics.taskTotal).toBeGreaterThan(0);
    expect(report.metrics.totalDurationMs).toBeGreaterThan(0);
    db.close();
  });

  it("编队状态推导:定级等待时未介入的智能体待命,已介入的在工作", async () => {
    const db = openDatabase(":memory:");
    const model = new ScriptedModel(DEMO_SCRIPTS.medical_emergency);
    const realNow = { t: Date.parse("2026-11-08T02:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });
    const { drillId } = await runner.start({ scenarioKey: "medical_emergency", seed: 7, speed: 60 });
    await driveUntilNotRunning(runner, realNow);

    const detail = buildDrillDetail(db, drillId)!;
    expect(detail.agents.find((a) => a.key === "notification")?.status).toBe("standby");
    expect(detail.agents.find((a) => a.key === "review")?.status).toBe("standby");
    expect(detail.agents.find((a) => a.key === "perception")?.status).toBe("done");
    expect(detail.agents.find((a) => a.key === "command")?.status).toBe("working");
    db.close();
  });

  it("监测中心数据:信号透出原始读数与感知解读,降级解读被标记", async () => {
    const db = openDatabase(":memory:");
    // 首信号感知强制坏输出(重试仍坏)→ 规则降级解读;后续信号走正常剧本
    const degradedScripts: Record<string, ScriptedResponse[]> = {
      ...DEMO_SCRIPTS.fire_alarm,
      perception: [{ badJson: true }, { badJson: true }, ...DEMO_SCRIPTS.fire_alarm.perception.slice(2)],
    };
    const model = new ScriptedModel(degradedScripts);
    const realNow = { t: Date.parse("2026-11-08T10:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });
    const { drillId } = await runner.start({ scenarioKey: "fire_alarm", seed: 42, speed: 60 });
    await driveUntilNotRunning(runner, realNow); // 感知段完成,停在定级确认

    const detail = buildDrillDetail(db, drillId)!;
    expect(detail.signals.length).toBeGreaterThan(0);

    // 首信号(按模拟时间最早):原始读数与设备编号透出(监测页「原始数据」段)
    const first = detail.signals[0];
    expect(first.sourceRef).toMatch(/^[A-Z0-9-]+$/);
    expect(first.payload).toBeTypeOf("object");
    expect(first.payload.simulated).toBe(true);
    expect(first.status).toBe("reported");

    // 首信号创建事件:解读完整、降级被标记、事件标题与解读一致
    expect(first.perception).toBeDefined();
    expect(first.perception!.createdEvent).toBe(true);
    expect(first.perception!.degraded).toBe(true);
    expect(first.perception!.evidence.length).toBeGreaterThan(0);
    expect(first.perception!.reasoning).toBeTypeOf("string");
    expect(detail.event?.title).toBe(first.perception!.title);

    // 后续信号:正常剧本解读(未降级),作为补充证据并入而非建事件
    const rest = detail.signals.slice(1);
    expect(rest.length).toBeGreaterThan(0);
    for (const signal of rest) {
      expect(signal.perception).toBeDefined();
      expect(signal.perception!.createdEvent).toBe(false);
    }
    expect(rest.some((s) => s.perception!.degraded === false)).toBe(true);
    db.close();
  });

  it("通知中心数据:发布时刻/来源/逐次分发记录透出,完成态重试后 DTO 反映追加", async () => {
    const db = openDatabase(":memory:");
    const model = new ScriptedModel(DEMO_SCRIPTS.medical_emergency);
    const realNow = { t: Date.parse("2026-11-08T02:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });
    const { drillId } = await runner.start({ scenarioKey: "medical_emergency", seed: 7, speed: 60 });

    // 走完三个确认点(seed 7:师生发布成功、家长通道首试失败)
    await driveUntilNotRunning(runner, realNow);
    await runner.confirmGrading({});
    await driveUntilNotRunning(runner, realNow);
    await runner.confirmDispatch({});
    await driveUntilNotRunning(runner, realNow);
    await runner.confirmNotification();
    await driveUntilNotRunning(runner, realNow);
    expect(runner.status).toBe("completed");

    let detail = buildDrillDetail(db, drillId)!;
    expect(detail.notifications).toHaveLength(2);
    const staff = detail.notifications.find((n) => n.audience === "staff_students")!;
    const parents = detail.notifications.find((n) => n.audience === "parents")!;
    // 已发布:发布时刻(模拟 ISO)+ 送达统计含通道与尝试次 + ⚑ 节点的来源与生成时刻
    expect(staff.status).toBe("published_sim");
    expect(staff.publishedSimTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(staff.delivery?.channelOk).toBe(true);
    expect(staff.delivery?.attempt).toBe(1);
    expect(staff.source).toBe("model");
    expect(staff.draftSimTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(staff.publishes).toHaveLength(1);
    expect(staff.publishes[0].attempt).toBe(1);
    expect(staff.publishes[0].stats.total).toBeGreaterThan(0);
    // 失败:发布时刻为 null,尝试记录标 failed
    expect(parents.status).toBe("failed");
    expect(parents.publishedSimTime).toBeNull();
    expect(parents.publishes).toHaveLength(1);
    expect(parents.publishes[0].status).toBe("failed");

    // 完成态重试(runner 仍绑定)→ DTO 透出第 2 次尝试与翻转后的状态
    const retry = await runner.retryNotification();
    expect(retry).toEqual({ retried: 1, published: 2, failed: 0 });
    detail = buildDrillDetail(db, drillId)!;
    const retriedParents = detail.notifications.find((n) => n.audience === "parents")!;
    expect(retriedParents.status).toBe("published_sim");
    expect(retriedParents.publishedSimTime).not.toBeNull();
    expect(retriedParents.publishes).toHaveLength(2);
    expect(retriedParents.publishes[1].attempt).toBe(2);
    expect(retriedParents.publishes[1].status).toBe("published_sim");
    db.close();
  });

  it("指挥台数据:详情含信号,历史列表可查,暂停仍是活跃演练且重启可接续", async () => {
    const db = openDatabase(":memory:");
    const model = new ScriptedModel(DEMO_SCRIPTS.fire_alarm);
    const realNow = { t: Date.parse("2026-11-08T08:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });
    const { drillId } = await runner.start({ scenarioKey: "fire_alarm", seed: 42, speed: 60 });
    await driveUntilNotRunning(runner, realNow); // 定级确认等待中(信号与事件已产生)

    // 详情暴露监测信号(指挥台态势侧栏数据源)
    const detail = buildDrillDetail(db, drillId)!;
    expect(detail.signals.length).toBeGreaterThan(0);
    expect(detail.signals[0].simTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(["sensor", "camera"]).toContain(detail.signals[0].sourceKind);

    // 历史列表:进行中演练等级/评分尚空
    const history = buildDrillHistory(db);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      id: drillId,
      scenarioKey: "fire_alarm",
      status: "awaiting_confirmation",
      severity: null,
      score: null,
    });

    // 确认定级后,等级进入历史条目
    await runner.confirmGrading({});
    expect(buildDrillHistory(db)[0].severity).toMatch(/^(I|II|III|IV)$/);

    // 暂停中仍是活跃演练(状态条/指挥台可见,且占用单事件焦点不可再发起)
    await runner.pause();
    expect(getActiveDrills(db).map((d) => d.id)).toEqual([drillId]);

    // 重启:新 runner 绑定已暂停演练,操作员可手动恢复
    const revived = new DrillRunner({ db, model, now: () => realNow.t });
    expect(revived.recoverInterruptedDrills()).toBe(1);
    expect(revived.drillId).toBe(drillId);
    await revived.resume();
    expect(getDrill(db, drillId)!.status).toBe("running");
    db.close();
  });

  it("重置输入还原:从演练行重建同配置 StartDrillInput(损坏容忍)", () => {
    const row = {
      id: "d1",
      scenario_key: "fire_alarm",
      name: "消防警报演练 · 种子 42",
      seed: 42,
      params: JSON.stringify({ location: "图书馆", intensity: "high", autoConfirm: true }),
      status: "running",
      clock_state: JSON.stringify({ speed: 4 }),
      score: null,
      started_at: "2026-11-10T02:00:00.000Z",
      ended_at: null,
      created_at: "2026-11-10T02:00:00.000Z",
      updated_at: "2026-11-10T02:00:00.000Z",
    } satisfies DrillRow;
    expect(buildRestartInput(row)).toEqual({ scenarioKey: "fire_alarm", seed: 42, speed: 4, autoConfirm: true });
    // clock_state/params 损坏:按默认倍速 1、人工确认重开
    expect(buildRestartInput({ ...row, clock_state: "broken", params: "broken" })).toEqual({
      scenarioKey: "fire_alarm",
      seed: 42,
      speed: 1,
      autoConfirm: undefined,
    });
  });

  it("重置与调速:调速进入摘要;重置=当前演练留痕终止+同配置同种子新开", async () => {
    const db = openDatabase(":memory:");
    const model = new ScriptedModel(DEMO_SCRIPTS.fire_alarm);
    const realNow = { t: Date.parse("2026-11-10T02:00:00.000Z") };
    const runner = new DrillRunner({ db, model, now: () => realNow.t });
    const { drillId: firstId } = await runner.start({
      scenarioKey: "fire_alarm",
      seed: 42,
      speed: 60,
      autoConfirm: true,
    });

    // 全自动模式确认点不暂停,少量推进保持运行中
    for (let i = 0; i < 3; i++) {
      realNow.t += 1_000;
      await runner.tick();
    }
    expect(runner.status).toBe("running");

    // 调速 → clock_state 落库 → 摘要 DTO 通路(状态条/控制台显示当前倍速)
    await runner.setSpeed(4);
    expect(buildDrillSummary(db, getDrill(db, firstId)!).speed).toBe(4);

    // 重置第一步:从活跃演练行重建输入(种子/倍速/确认模式全部保留)
    const input = buildRestartInput(getActiveDrills(db)[0]);
    expect(input).toEqual({ scenarioKey: "fire_alarm", seed: 42, speed: 4, autoConfirm: true });

    // 重置第二步:当前演练留痕终止(记录保留,不评分)
    await runner.abort();
    const oldRow = getDrill(db, firstId)!;
    expect(oldRow.status).toBe("aborted");
    expect(oldRow.ended_at).not.toBeNull();
    expect(oldRow.score).toBeNull();

    // 重置第三步:同配置新开一场,单事件焦点切换到新演练
    const { drillId: secondId } = await runner.start(input);
    expect(secondId).not.toBe(firstId);
    expect(getActiveDrills(db).map((d) => d.id)).toEqual([secondId]);
    const newDetail = buildDrillDetail(db, secondId)!;
    expect(newDetail.drill.seed).toBe(42);
    expect(newDetail.drill.speed).toBe(4);
    expect(newDetail.drill.autoConfirm).toBe(true);
    // 旧演练详情仍是可查看的终止记录
    expect(buildDrillDetail(db, firstId)!.drill.status).toBe("aborted");
    db.close();
  });
});

describe("协作页活动聚合 deriveAgentActivity", () => {
  const simTime = "2026-11-08T06:00:00.000Z";

  function timelineNode(
    seq: number,
    actor: string | null,
    nodeType: string,
    detail: Record<string, unknown>,
  ): TimelineNodeRow {
    return {
      id: `n${seq}`,
      drill_id: "d1",
      event_id: null,
      seq,
      phase: "handling",
      node_type: nodeType,
      title: `节点${seq}`,
      detail: JSON.stringify(detail),
      actor,
      requires_confirmation: 0,
      sim_time: simTime,
      real_time: simTime,
      created_at: simTime,
    };
  }

  function taskRow(role: string, result: Record<string, unknown> | null): TaskRow {
    return {
      id: `t-${role}-${Math.random().toString(36).slice(2, 6)}`,
      drill_id: "d1",
      event_id: "e1",
      role,
      title: "任务",
      description: "",
      status: "done",
      result: result === null ? null : JSON.stringify(result),
      dispatched_sim_time: simTime,
      started_sim_time: simTime,
      completed_sim_time: simTime,
      created_at: simTime,
      updated_at: simTime,
    };
  }

  it("按编队聚合调用/降级计数与最近调用(新→旧,含输入输出摘要)", () => {
    const timeline = [
      timelineNode(1, "monitor_agent", "signal", { input: { signalId: "s1" }, output: { title: "疑似火情" } }),
      timelineNode(2, "command_agent", "grading", { input: { event: "火情" }, output: { suggestedSeverity: "II" } }),
      timelineNode(3, "command_agent", "anomaly", { degraded: { reason: "timeout" } }),
    ];
    const result = deriveAgentActivity(timeline, [], []);
    const byKey = new Map(result.map((a) => [a.key, a]));

    const perception = byKey.get("perception")!;
    expect(perception.stats).toMatchObject({ calls: 1, degraded: 0, avgDurationMs: null, successRate: null, delivery: null });
    expect(perception.recentCalls[0]).toMatchObject({ seq: 1, degraded: false });
    expect(perception.recentCalls[0].input).toContain("signalId");
    expect(perception.recentCalls[0].output).toContain("疑似火情");

    const command = byKey.get("command")!;
    expect(command.stats).toMatchObject({ calls: 2, degraded: 1 });
    expect(command.recentCalls[0]).toMatchObject({ seq: 3, degraded: true });
  });

  it("处置角色从任务结果计算平均耗时与成功率;损坏结果容忍跳过", () => {
    const timeline = [timelineNode(1, "security_agent", "feedback", { output: { narrative: "完成" } })];
    const tasks = [
      taskRow("security", { durationMs: 1000, success: true, attempts: 1 }),
      taskRow("security", { durationMs: 3000, success: false, attempts: 2 }),
      taskRow("security", null),
      taskRow("medical", { durationMs: 999, success: true }),
    ];
    const security = deriveAgentActivity(timeline, tasks, []).find((a) => a.key === "handling_security")!;
    expect(security.stats.avgDurationMs).toBe(2000);
    expect(security.stats.successRate).toBe(0.5);
  });

  it("通知角色聚合送达统计;其他角色不产出送达", () => {
    const timeline = [timelineNode(1, "notification_agent", "notification", { output: {} })];
    const notifications = [
      { delivery: { total: 100, delivered: 90 } },
      { delivery: { total: 50, delivered: 50 } },
      { delivery: null },
    ] as unknown as NotificationDTO[];
    const result = deriveAgentActivity(timeline, [], notifications);
    expect(result.find((a) => a.key === "notification")!.stats.delivery).toEqual({ total: 150, delivered: 140 });
    expect(result.find((a) => a.key === "review")!.stats.delivery).toBeNull();
  });

  it("输入/输出摘要截断到 200 字符,损坏 detail JSON 容忍为空", () => {
    const long = "x".repeat(500);
    const timeline = [
      timelineNode(1, "review_agent", "status_change", { input: { blob: long }, output: { ok: true } }),
    ];
    timeline.push({
      ...timelineNode(2, "review_agent", "status_change", {}),
      detail: "{broken json",
    } as TimelineNodeRow);
    const review = deriveAgentActivity(timeline, [], []).find((a) => a.key === "review")!;
    const first = review.recentCalls.find((c) => c.seq === 1)!;
    expect(first.input!.length).toBe(201); // 200 字符 + 省略号
    expect(first.input!.endsWith("…")).toBe(true);
    const broken = review.recentCalls.find((c) => c.seq === 2)!;
    expect(broken.input).toBeUndefined();
    expect(broken.output).toBeUndefined();
  });

  it("操作员/推演引擎等非编队 actor 不进入聚合,编队顺序与 AGENT_DEFS 一致", () => {
    const timeline = [
      timelineNode(1, "operator", "operator_action", { action: "confirm" }),
      timelineNode(2, "drill_runner", "status_change", { from: "running", to: "paused" }),
    ];
    const result = deriveAgentActivity(timeline, [], []);
    expect(result.map((a) => a.key)).toEqual([
      "perception",
      "command",
      "handling_security",
      "handling_medical",
      "handling_logistics",
      "notification",
      "review",
    ]);
    expect(result.every((a) => a.stats.calls === 0 && a.recentCalls.length === 0)).toBe(true);
  });
});

