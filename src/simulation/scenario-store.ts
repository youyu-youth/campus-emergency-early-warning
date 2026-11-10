// 场景仓库：scenarios 表的进程内缓存与读写入口(事件库 CRUD 唯一通道)
// 缓存按 Db 实例隔离(WeakMap,:memory: 测试互不串库);首次加载时幂等种入内置场景
// 读接口含已删行——历史演练的恢复/展示路径永不因软删除而缺场景

import type { Db } from "../db/client";
import type { ScenarioRow } from "../db/types";
import { BUILTIN_SCENARIOS, type Scenario } from "./scenarios";

function toScenario(row: ScenarioRow): Scenario {
  let defaults: Scenario["defaults"] = { location: "", intensity: "medium" };
  try {
    defaults = { ...defaults, ...(JSON.parse(row.defaults) as Partial<Scenario["defaults"]>) };
  } catch {
    // defaults 损坏容忍:保留默认
  }
  let signals: Scenario["signals"] = [];
  try {
    signals = JSON.parse(row.signals) as Scenario["signals"];
  } catch {
    signals = [];
  }
  let evolution: Scenario["evolution"] = [];
  try {
    evolution = JSON.parse(row.evolution) as Scenario["evolution"];
  } catch {
    evolution = [];
  }
  return {
    key: row.key,
    name: row.name,
    description: row.description,
    eventTypeLabel: row.event_type_label,
    defaultSimStart: row.default_sim_start,
    defaults,
    signals,
    evolution,
  };
}

interface ScenarioCacheEntry {
  scenario: Scenario;
  isBuiltin: boolean;
  isDeleted: boolean;
}

interface ScenarioCache {
  byKey: Map<string, ScenarioCacheEntry>;
}

const caches = new WeakMap<Db, ScenarioCache>();

/** 加载全表并幂等种入内置场景(INSERT OR IGNORE,已存在行不动) */
function loadCache(db: Db): ScenarioCache {
  const seed = db.transaction(() => {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO scenarios
        (key, name, description, event_type_label, default_sim_start, defaults, signals, evolution, is_builtin)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
    for (const s of BUILTIN_SCENARIOS) {
      insert.run(
        s.key,
        s.name,
        s.description,
        s.eventTypeLabel,
        s.defaultSimStart,
        JSON.stringify(s.defaults),
        JSON.stringify(s.signals),
        JSON.stringify(s.evolution),
      );
    }
  });
  seed();

  const byKey = new Map<string, ScenarioCacheEntry>();
  for (const row of db.prepare("SELECT * FROM scenarios").all() as ScenarioRow[]) {
    const scenario = toScenario(row);
    byKey.set(row.key, { scenario, isBuiltin: row.is_builtin === 1, isDeleted: row.is_deleted === 1 });
  }
  const cache = { byKey };
  caches.set(db, cache);
  return cache;
}

function cacheOf(db: Db): ScenarioCache {
  return caches.get(db) ?? loadCache(db);
}

/** 按 key 查场景(含已删;不存在返回 null)——runner/graph/DTO 组装共用 */
export function findScenario(db: Db, key: string): Scenario | null {
  return cacheOf(db).byKey.get(key)?.scenario ?? null;
}

/** 场景不存在时的统一报错(start 校验点) */
export function requireScenario(db: Db, key: string): Scenario {
  const scenario = findScenario(db, key);
  if (!scenario) throw new Error(`场景 ${key} 不存在(可能已被删除)`);
  return scenario;
}

export interface ScenarioListItem {
  scenario: Scenario;
  isBuiltin: boolean;
  isDeleted: boolean;
}

/** 场景列表(默认不含已删;管理页含) */
export function listScenarioItems(db: Db, includeDeleted = false): ScenarioListItem[] {
  return [...cacheOf(db).byKey.values()]
    .filter((item) => includeDeleted || !item.isDeleted)
    .map((item) => ({ ...item }));
}

/** 是否内置锁定场景 */
export function isBuiltinScenario(db: Db, key: string): boolean {
  return cacheOf(db).byKey.get(key)?.isBuiltin ?? false;
}

/** 写入场景(新建或整体替换)并刷新缓存 */
export function writeScenario(db: Db, scenario: Scenario, isBuiltin = false): void {
  db.prepare(`
    INSERT INTO scenarios
      (key, name, description, event_type_label, default_sim_start, defaults, signals, evolution, is_builtin, is_deleted, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT(key) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      event_type_label = excluded.event_type_label,
      default_sim_start = excluded.default_sim_start,
      defaults = excluded.defaults,
      signals = excluded.signals,
      evolution = excluded.evolution,
      is_deleted = 0,
      updated_at = excluded.updated_at
  `).run(
    scenario.key,
    scenario.name,
    scenario.description,
    scenario.eventTypeLabel,
    scenario.defaultSimStart,
    JSON.stringify(scenario.defaults),
    JSON.stringify(scenario.signals),
    JSON.stringify(scenario.evolution),
    isBuiltin ? 1 : 0,
  );
  caches.delete(db);
}

/** 软删除场景(从可选列表移除;历史演练名仍可查) */
export function softDeleteScenario(db: Db, key: string): void {
  db.prepare(
    "UPDATE scenarios SET is_deleted = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE key = ?",
  ).run(key);
  caches.delete(db);
}
