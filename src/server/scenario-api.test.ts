// 事件库测试:场景仓库(种子/CRUD/软删保留) + API 规则(内置锁定/活跃引用拒删) + 自定义场景端到端
// 端到端用空剧本假模型(全链路降级),验证自定义场景可完整跑通演练闭环且历史场景名不因软删退化

import { describe, expect, it } from "vitest";

import { ScriptedModel } from "../agents/model";
import { openDatabase, type Db } from "../db/client";
import { getActiveDrills } from "../db/queries";
import { DrillRunner } from "../runner/drill-runner";
import {
  findScenario,
  listScenarioItems,
} from "../simulation/scenario-store";
import {
  createScenarioApi,
  deleteScenarioApi,
  ScenarioBodySchema,
  updateScenarioApi,
  type ScenarioBody,
} from "./scenario-api";

function validBody(overrides: Partial<ScenarioBody> = {}): ScenarioBody {
  const parsed = ScenarioBodySchema.parse({
    name: "实验室化学品泄漏",
    description: "实验楼 B201 化学品泄漏,气体传感器与摄像头先后触发",
    eventTypeLabel: "化学品泄漏",
    defaultSimStart: "09:00",
    location: "实验楼 B201",
    intensity: "high",
    signals: [
      {
        offsetMs: 0,
        kind: "sensor",
        sourceRef: "LAB-B201-CHEM-01",
        location: "实验楼 B201",
        signalType: "gas_leak",
        confidence: [0.9, 0.97],
        reading: { metric: "gas_concentration", value: 35, unit: "ppm", threshold: 20 },
      },
      {
        offsetMs: 40_000,
        kind: "camera",
        sourceRef: "CAM-LAB-B201",
        location: "实验楼 B201 门口",
        signalType: "evacuation_flow",
        confidence: [0.75, 0.88],
        reading: { detection: "crowd_flow_abnormal", region: "走廊东侧" },
      },
    ],
    evolution: [
      { offsetMs: 120_000, milestone: "泄漏扩散", note: "通风受限,浓度持续上升" },
    ],
    ...overrides,
  });
  return parsed;
}

async function driveUntilNotRunning(runner: DrillRunner, realNow: { t: number }, maxSteps = 600): Promise<void> {
  for (let i = 0; i < maxSteps && runner.status === "running"; i++) {
    realNow.t += 1_000;
    await runner.tick();
  }
}

describe("事件库 · 场景仓库与 API 规则", () => {
  it("迁移后自动种入两个内置场景(锁定)", () => {
    const db = openDatabase(":memory:");
    const items = listScenarioItems(db);
    expect(items.filter((i) => i.isBuiltin).map((i) => i.scenario.key).sort()).toEqual([
      "fire_alarm",
      "medical_emergency",
    ]);
    db.close();
  });

  it("创建自定义场景 → 列表可选;软删后列表移除但 findScenario 仍可查(历史演练名不退化)", () => {
    const db = openDatabase(":memory:");
    const created = createScenarioApi(db, validBody());
    expect(created.key.startsWith("custom_")).toBe(true);
    expect(listScenarioItems(db).some((i) => i.scenario.key === created.key)).toBe(true);
    // 存储层 payload 显式携带模拟标记
    const stored = findScenario(db, created.key)!;
    expect(stored.signals[0].payload.simulated).toBe(true);
    expect(stored.signals[0].payload.value).toBe(35);

    deleteScenarioApi(db, created.key);
    expect(listScenarioItems(db).some((i) => i.scenario.key === created.key)).toBe(false);
    expect(findScenario(db, created.key)?.name).toBe("实验室化学品泄漏");
    db.close();
  });

  it("内置场景锁定:修改与删除均被拒绝", () => {
    const db = openDatabase(":memory:");
    expect(() => updateScenarioApi(db, "fire_alarm", validBody())).toThrow(/内置场景/);
    expect(() => deleteScenarioApi(db, "fire_alarm")).toThrow(/内置场景/);
    db.close();
  });

  it("更新自定义场景生效;不存在的场景报错;活跃演练引用时拒绝删除", () => {
    const db = openDatabase(":memory:");
    const created = createScenarioApi(db, validBody());
    const updated = updateScenarioApi(db, created.key, validBody({ name: "实验室泄漏(修订)", intensity: "medium" }));
    expect(updated.name).toBe("实验室泄漏(修订)");
    expect(() => updateScenarioApi(db, "custom_none", validBody())).toThrow(/不存在/);

    // 活跃引用:手工插入一条 running 演练占用该场景
    db.prepare(
      "INSERT INTO drills (id, scenario_key, name, seed, params, status, clock_state) VALUES ('d1', ?, '占用演练', 1, '{}', 'running', '{}')",
    ).run(created.key);
    expect(getActiveDrills(db).some((d) => d.scenario_key === created.key)).toBe(true);
    expect(() => deleteScenarioApi(db, created.key)).toThrow(/进行中的演练/);
    db.close();
  });
});

describe("事件库 · 自定义场景端到端(空剧本假模型,全链路降级)", () => {
  async function runCustomDrill(db: Db): Promise<string> {
    const created = createScenarioApi(db, validBody());
    const realNow = { t: Date.parse("2026-11-10T01:00:00.000Z") };
    const runner = new DrillRunner({ db, model: new ScriptedModel({}), now: () => realNow.t });
    const { drillId } = await runner.start({ scenarioKey: created.key, seed: 42, speed: 60, autoConfirm: true });
    await driveUntilNotRunning(runner, realNow);
    expect(runner.status).toBe("completed");
    return drillId;
  }

  it("自定义场景跑通完整闭环:演练名/降级留痕/通用降级任务方案/复盘报告", async () => {
    const db = openDatabase(":memory:");
    const drillId = await runCustomDrill(db);

    const drill = db.prepare("SELECT * FROM drills WHERE id = ?").get(drillId) as { name: string; status: string; score: number | null };
    expect(drill.name).toContain("实验室化学品泄漏");
    expect(drill.status).toBe("completed");
    expect(drill.score).not.toBeNull();

    // 两次信号全部感知降级留痕(anomaly 节点)
    const nodes = db.prepare("SELECT * FROM timeline_nodes WHERE drill_id = ?").all(drillId) as Array<{ node_type: string; phase: string }>;
    expect(nodes.filter((n) => n.node_type === "anomaly" && n.phase === "perception")).toHaveLength(2);

    // 降级派发方案覆盖三角色(通用模板,无缺条目崩溃)
    const tasks = db.prepare("SELECT role FROM tasks WHERE drill_id = ?").all(drillId) as Array<{ role: string }>;
    expect(tasks.map((t) => t.role).sort()).toEqual(["logistics", "medical", "security"]);

    // 复盘报告落库
    const report = db.prepare("SELECT source FROM reports WHERE drill_id = ?").get(drillId) as { source: string };
    expect(report.source).toBe("degraded");
    db.close();
  });

  it("软删除后历史演练的场景名仍解析为中文名(buildDrillHistory 不退化)", async () => {
    const { buildDrillHistory } = await import("./drill-service");
    const db = openDatabase(":memory:");
    const drillId = await runCustomDrill(db);

    // 软删该场景后,历史条目 scenarioName 仍为中文名而非裸 key
    const key = (db.prepare("SELECT scenario_key FROM drills WHERE id = ?").get(drillId) as { scenario_key: string }).scenario_key;
    deleteScenarioApi(db, key);
    const entry = buildDrillHistory(db).find((h) => h.id === drillId)!;
    expect(entry.scenarioName).toBe("实验室化学品泄漏");
    db.close();
  });
});
