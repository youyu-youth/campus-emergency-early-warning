// 数据访问层:运行器与图节点的唯一写库通道
// 表结构见 migrations.ts,行类型见 types.ts

import { randomUUID } from "node:crypto";
import type { DrillStatus, SignalStatus } from "../simulation/state-machines";
import type { Db } from "./client";
import type { DrillRow, EventRow, GraphRunRow, SignalRow, TimelineNodeRow } from "./types";

// —— 演练 ——

export function insertDrill(
  db: Db,
  row: Pick<DrillRow, "scenario_key" | "name" | "seed" | "params" | "status" | "clock_state" | "started_at">,
): DrillRow {
  const drill: DrillRow = {
    id: randomUUID(),
    ...row,
    score: null,
    ended_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO drills (id, scenario_key, name, seed, params, status, clock_state, started_at)
     VALUES (@id, @scenario_key, @name, @seed, @params, @status, @clock_state, @started_at)`,
  ).run(drill);
  return drill;
}

export function getDrill(db: Db, id: string): DrillRow | undefined {
  return db.prepare("SELECT * FROM drills WHERE id = ?").get(id) as DrillRow | undefined;
}

export function updateDrillStatus(db: Db, id: string, status: DrillStatus): void {
  db.prepare("UPDATE drills SET status = ?, updated_at = ? WHERE id = ?").run(
    status,
    new Date().toISOString(),
    id,
  );
}

export function getActiveDrills(db: Db): DrillRow[] {
  return db
    .prepare("SELECT * FROM drills WHERE status IN ('running', 'awaiting_confirmation') ORDER BY created_at")
    .all() as DrillRow[];
}

// —— 信号 ——

export interface NewSignal {
  drill_id: string;
  source_kind: string;
  source_ref: string;
  location: string;
  signal_type: string;
  payload: string;
  confidence: number;
  sim_time: string;
}

export function insertSignal(db: Db, row: NewSignal): SignalRow {
  const signal: SignalRow = {
    id: randomUUID(),
    ...row,
    status: "new",
    created_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO signals (id, drill_id, source_kind, source_ref, location, signal_type, payload, confidence, sim_time)
     VALUES (@id, @drill_id, @source_kind, @source_ref, @location, @signal_type, @payload, @confidence, @sim_time)`,
  ).run(signal);
  return signal;
}

export function updateSignalStatus(db: Db, id: string, status: SignalStatus): void {
  db.prepare("UPDATE signals SET status = ? WHERE id = ?").run(status, id);
}

export function listSignalsByDrill(db: Db, drillId: string): SignalRow[] {
  return db
    .prepare("SELECT * FROM signals WHERE drill_id = ? ORDER BY sim_time, created_at")
    .all(drillId) as SignalRow[];
}

// —— 事件 ——

export interface NewEvent {
  drill_id: string;
  signal_id: string;
  type: string;
  title: string;
  location: string;
  detected_sim_time: string;
}

export function insertEvent(db: Db, row: NewEvent): EventRow {
  const event: EventRow = {
    id: randomUUID(),
    ...row,
    severity: null,
    status: "reported",
    resolved_sim_time: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO events (id, drill_id, signal_id, type, title, location, detected_sim_time)
     VALUES (@id, @drill_id, @signal_id, @type, @title, @location, @detected_sim_time)`,
  ).run(event);
  return event;
}

export function getEventByDrillId(db: Db, drillId: string): EventRow | undefined {
  return db
    .prepare("SELECT * FROM events WHERE drill_id = ? ORDER BY created_at LIMIT 1")
    .get(drillId) as EventRow | undefined;
}

// —— 时间线 ——

export interface NewTimelineNode {
  drill_id: string;
  event_id?: string | null;
  phase: string;
  node_type: string;
  title: string;
  /** JSON:原始输入 / 决策依据 / 结构化输出 */
  detail: string;
  actor?: string | null;
  requires_confirmation?: 0 | 1;
  sim_time: string;
  real_time: string;
}

export function insertTimelineNode(db: Db, row: NewTimelineNode): TimelineNodeRow {
  const nextSeq = (() => {
    const { max } = db
      .prepare("SELECT COALESCE(MAX(seq), 0) AS max FROM timeline_nodes WHERE drill_id = ?")
      .get(row.drill_id) as { max: number };
    return max + 1;
  })();
  const node: TimelineNodeRow = {
    id: randomUUID(),
    drill_id: row.drill_id,
    event_id: row.event_id ?? null,
    seq: nextSeq,
    phase: row.phase,
    node_type: row.node_type,
    title: row.title,
    detail: row.detail,
    actor: row.actor ?? null,
    requires_confirmation: row.requires_confirmation ?? 0,
    sim_time: row.sim_time,
    real_time: row.real_time,
    created_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO timeline_nodes
       (id, drill_id, event_id, seq, phase, node_type, title, detail, actor, requires_confirmation, sim_time, real_time)
     VALUES (@id, @drill_id, @event_id, @seq, @phase, @node_type, @title, @detail, @actor, @requires_confirmation, @sim_time, @real_time)`,
  ).run(node);
  return node;
}

export function listTimelineByDrill(db: Db, drillId: string): TimelineNodeRow[] {
  return db
    .prepare("SELECT * FROM timeline_nodes WHERE drill_id = ? ORDER BY seq")
    .all(drillId) as TimelineNodeRow[];
}

// —— 图执行 ——

export function upsertGraphRun(db: Db, drillId: string, status: string, stateJson: string): void {
  const existing = db.prepare("SELECT id FROM graph_runs WHERE drill_id = ?").get(drillId) as
    | { id: string }
    | undefined;
  const now = new Date().toISOString();
  if (existing) {
    db.prepare("UPDATE graph_runs SET status = ?, state = ?, updated_at = ? WHERE id = ?").run(
      status,
      stateJson,
      now,
      existing.id,
    );
  } else {
    db.prepare(
      "INSERT INTO graph_runs (id, drill_id, status, state, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(randomUUID(), drillId, status, stateJson, now);
  }
}

export function getGraphRunByDrillId(db: Db, drillId: string): GraphRunRow | undefined {
  return db
    .prepare("SELECT * FROM graph_runs WHERE drill_id = ? LIMIT 1")
    .get(drillId) as GraphRunRow | undefined;
}
