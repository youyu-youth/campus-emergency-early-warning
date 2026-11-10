// 事件库服务层:场景 CRUD 的校验、形状转换与锁定/软删/活跃引用规则(API 路由唯一入口)
// 内置场景锁定(不可改删,可复制);删除=软删(历史演练场景名仍可解析);活跃演练引用时拒绝删除

import { z } from "zod";

import { getActiveDrills } from "../db/queries";
import type { ScenarioBody, ScenarioDTO } from "../lib/drill-types";
import type { Db } from "../db/client";
import type { Scenario, SignalTemplate } from "../simulation/scenarios";
import { findScenario, isBuiltinScenario, listScenarioItems, softDeleteScenario, writeScenario } from "../simulation/scenario-store";

/** 信号模板提交形状:结构化读数(服务端拼 payload 并盖模拟标记) */
const SignalTemplateSchema = z.object({
  offsetMs: z.number().int().min(0).max(3_600_000),
  kind: z.enum(["sensor", "camera"]),
  sourceRef: z.string().min(1).max(64),
  location: z.string().min(1).max(100),
  signalType: z.string().min(1).max(64),
  confidence: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
  reading: z.record(z.string().min(1).max(32), z.union([z.string().max(200), z.number()])).default({}),
}).refine((s) => s.confidence[0] <= s.confidence[1], { message: "置信度区间下限不能大于上限" });

export const ScenarioBodySchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(300).default(""),
  eventTypeLabel: z.string().min(1).max(30),
  defaultSimStart: z.string().regex(/^\d{2}:\d{2}$/, "模拟开始时刻格式须为 HH:mm"),
  location: z.string().min(1).max(100),
  intensity: z.enum(["low", "medium", "high"]),
  signals: z.array(SignalTemplateSchema).min(1, "至少配置一条信号").max(10),
  evolution: z
    .array(
      z.object({
        offsetMs: z.number().int().min(0).max(3_600_000),
        milestone: z.string().min(1).max(40),
        note: z.string().max(200).default(""),
      }),
    )
    .max(10)
    .default([]),
});

// 提交体类型来自共享 DTO(纯类型文件);zod schema 与之保持同形(server 校验单一事实源)
export type { ScenarioBody };

/** 结构化读数 → 存储 payload(显式携带 simulated:true,不得伪装真实设备数据) */
function readingToPayload(reading: Record<string, string | number>): Record<string, unknown> {
  return { ...reading, simulated: true };
}

/** 请求体 → 场景存储形状 */
export function bodyToScenario(key: string, data: ScenarioBody): Scenario {
  return {
    key,
    name: data.name,
    description: data.description,
    eventTypeLabel: data.eventTypeLabel,
    defaultSimStart: data.defaultSimStart,
    defaults: { location: data.location, intensity: data.intensity },
    signals: data.signals.map<SignalTemplate>((s) => ({
      offsetMs: s.offsetMs,
      kind: s.kind,
      sourceRef: s.sourceRef,
      location: s.location,
      signalType: s.signalType,
      confidence: s.confidence,
      payload: readingToPayload(s.reading),
    })),
    evolution: data.evolution,
  };
}

/** 存储 → DTO(reading = payload 除模拟标记外) */
export function toScenarioDTO(scenario: Scenario, isBuiltin: boolean, updatedAt: string): ScenarioDTO {
  return {
    key: scenario.key,
    name: scenario.name,
    description: scenario.description,
    eventTypeLabel: scenario.eventTypeLabel,
    defaultSimStart: scenario.defaultSimStart,
    location: scenario.defaults.location,
    intensity: scenario.defaults.intensity,
    signals: scenario.signals.map((s) => {
      // 剥离模拟标记后作为结构化读数回传编辑表单
      const reading = Object.fromEntries(
        Object.entries(s.payload as Record<string, unknown>).filter(([k]) => k !== "simulated"),
      );
      return {
        offsetMs: s.offsetMs,
        kind: s.kind,
        sourceRef: s.sourceRef,
        location: s.location,
        signalType: s.signalType,
        confidence: s.confidence,
        reading: reading as Record<string, string | number>,
      };
    }),
    evolution: scenario.evolution,
    isBuiltin,
    updatedAt,
  };
}

/** 事件库列表(不含已删,内置在前) */
export function listScenarioApi(db: Db): ScenarioDTO[] {
  return listScenarioItems(db)
    .sort((a, b) =>
      a.isBuiltin === b.isBuiltin ? a.scenario.key.localeCompare(b.scenario.key) : a.isBuiltin ? -1 : 1,
    )
    .map((item) => toScenarioDTO(item.scenario, item.isBuiltin, ""));
}

export function createScenarioApi(db: Db, data: ScenarioBody): ScenarioDTO {
  const key = `custom_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  writeScenario(db, bodyToScenario(key, data));
  const created = findScenario(db, key);
  if (!created) throw new Error("场景创建失败");
  return toScenarioDTO(created, false, "");
}

/** 更新自定义场景(内置锁定;key 必须存在且未删) */
export function updateScenarioApi(db: Db, key: string, data: ScenarioBody): ScenarioDTO {
  if (isBuiltinScenario(db, key)) throw new ScenarioLockedError();
  const existing = listScenarioItems(db, true).find((item) => item.scenario.key === key && !item.isDeleted);
  if (!existing) throw new Error(`场景 ${key} 不存在`);
  writeScenario(db, bodyToScenario(key, data));
  return toScenarioDTO(findScenario(db, key)!, false, "");
}

/** 软删除自定义场景(内置锁定;活跃演练引用时拒绝) */
export function deleteScenarioApi(db: Db, key: string): void {
  if (isBuiltinScenario(db, key)) throw new ScenarioLockedError();
  const existing = findScenario(db, key);
  if (!existing) throw new Error(`场景 ${key} 不存在`);
  if (getActiveDrills(db).some((d) => d.scenario_key === key)) {
    throw new Error("有进行中的演练正在使用该场景,请先终止或等待演练结束");
  }
  softDeleteScenario(db, key);
}

/** 内置场景锁定错误(路由层映射 403) */
export class ScenarioLockedError extends Error {
  constructor() {
    super("内置场景为标准模板,不可修改或删除;可复制为新事件后编辑");
  }
}
