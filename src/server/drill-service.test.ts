// 服务层 DTO 组装测试:人工确认全流程下 summary/detail/pendingConfirmation 的形状与内容
// 驱动模式与 drill-runner.test 相同(固定真实时间步进);模型用离线演示剧本(DEMO_SCRIPTS)

import { describe, expect, it } from "vitest";

import { openDatabase } from "../db/client";
import { getActiveDrills, getDrill, getGraphRunByDrillId } from "../db/queries";
import type { DrillRow } from "../db/types";
import { DEMO_SCRIPTS } from "../../scripts/demo-scripts";
import { ScriptedModel } from "../agents/model";
import { DrillRunner } from "../runner/drill-runner";
import { buildDrillDetail, buildDrillHistory, buildDrillSummary, buildRestartInput } from "./drill-service";

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
