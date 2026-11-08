import { describe, expect, it } from "vitest";
import type { Database } from "better-sqlite3";
import { openDatabase } from "./client";
import { runMigrations } from "./migrate";

function tableNames(db: Database): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[]
  ).map((row) => row.name);
}

describe("数据库迁移与约束", () => {
  it("建表齐全且迁移可幂等重复执行", () => {
    const db = openDatabase(":memory:");
    const expected = [
      "_migrations",
      "drills",
      "events",
      "graph_runs",
      "notifications",
      "signals",
      "tasks",
      "timeline_nodes",
    ];
    expect(tableNames(db)).toEqual(expected);
    expect(() => runMigrations(db)).not.toThrow(); // 幂等
    expect(tableNames(db)).toEqual(expected);
    db.close();
  });

  it("外键约束生效：不存在的演练不能挂任务与信号", () => {
    const db = openDatabase(":memory:");
    db.prepare("INSERT INTO drills (id, scenario_key, name, seed) VALUES (?, ?, ?, ?)").run(
      "DR-1",
      "fire_alarm",
      "消防警报演练 · 图书馆三层东区",
      42,
    );
    expect(() =>
      db.prepare("INSERT INTO signals (id, drill_id, source_kind, source_ref, location, signal_type, payload, confidence, sim_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
        "SG-1",
        "DR-404",
        "sensor",
        "LIB-3F-SMOKE-01",
        "图书馆三层东区",
        "smoke_density",
        '{"simulated":true}',
        0.92,
        "2026-11-08T14:00:00.000Z",
      ),
    ).toThrow();
    db.close();
  });

  it("演练与时间线节点可写入并读回（双时间来源）", () => {
    const db = openDatabase(":memory:");
    db.prepare("INSERT INTO drills (id, scenario_key, name, seed) VALUES (?, ?, ?, ?)").run(
      "DR-1",
      "fire_alarm",
      "消防警报演练 · 图书馆三层东区",
      42,
    );
    db.prepare(
      `INSERT INTO timeline_nodes
        (id, drill_id, seq, phase, node_type, title, detail, actor, requires_confirmation, sim_time, real_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "TL-1",
      "DR-1",
      1,
      "perception",
      "signal",
      "烟雾浓度超标信号上报",
      '{"source":"LIB-3F-SMOKE-01"}',
      "monitor_agent",
      0,
      "2026-11-08T14:00:05.000Z",
      "2026-11-08T06:00:05.123Z",
    );
    const node = db
      .prepare("SELECT * FROM timeline_nodes WHERE drill_id = ?")
      .get("DR-1") as {
      title: string;
      sim_time: string;
      real_time: string;
      requires_confirmation: number;
    };
    expect(node.title).toBe("烟雾浓度超标信号上报");
    expect(node.sim_time).not.toBe(node.real_time); // 模拟时间与真实时间分列记录
    expect(node.requires_confirmation).toBe(0);
    db.close();
  });

  it("同演练内时间线序号唯一", () => {
    const db = openDatabase(":memory:");
    db.prepare("INSERT INTO drills (id, scenario_key, name, seed) VALUES (?, ?, ?, ?)").run(
      "DR-1",
      "medical_emergency",
      "学生突发疾病演练 · 操场西侧",
      7,
    );
    const insert = db.prepare(
      `INSERT INTO timeline_nodes
        (id, drill_id, seq, phase, node_type, title, sim_time, real_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run("TL-1", "DR-1", 1, "perception", "signal", "心率异常信号", "s1", "r1");
    expect(() => insert.run("TL-2", "DR-1", 1, "perception", "signal", "重复序号", "s2", "r2")).toThrow();
    db.close();
  });
});
