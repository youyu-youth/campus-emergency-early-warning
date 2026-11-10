// 任务执行规则:耗时、资源消耗、成败全部由规则 + 种子确定性计算(LLM 不参与,spec 决策 6)
// 每个任务独立随机流(种子 ^ 任务序号 ^ 尝试次数),重试结果与首次不同;默认任务方案供调度智能体降级使用

import type { AgentRole } from "./state-machines";
import { mulberry32, randInt, jitter } from "./rng";

/** 任务方案条目(调度智能体输出与落库共用形状) */
export interface TaskPlanItem {
  role: AgentRole;
  title: string;
  description: string;
}

export interface TaskOutcome {
  /** 执行耗时(模拟毫秒) */
  durationMs: number;
  /** 资源消耗(名称 → 数量) */
  resources: Record<string, number>;
  success: boolean;
}

/** 各角色的规则参数:基准耗时(±20% 抖动)、单次尝试失败率、资源消耗区间 */
const ROLE_PARAMS: Record<AgentRole, {
  durationBaseMs: number;
  failRate: number;
  personnel: [number, number];
  equipment: { name: string; count: [number, number] };
}> = {
  security: {
    durationBaseMs: 80_000,
    failRate: 0.1,
    personnel: [2, 3],
    equipment: { name: "对讲机", count: [1, 2] },
  },
  medical: {
    durationBaseMs: 105_000,
    failRate: 0.12,
    personnel: [1, 2],
    equipment: { name: "急救包", count: [1, 1] },
  },
  logistics: {
    durationBaseMs: 70_000,
    failRate: 0.12,
    personnel: [1, 2],
    equipment: { name: "工具箱", count: [1, 1] },
  },
};

/** 任务随机流的种子:同一种子 + 序号 + 尝试次数 → 完全一致的结果 */
function taskSeed(seed: number, ordinal: number, attempt: number): number {
  return (seed ^ 0x5f3759df ^ Math.imul(ordinal + 1, 2654435761) ^ Math.imul(attempt, 40503)) >>> 0;
}

/** 任务最大尝试次数:首次执行 + 失败自动重试一次 */
export const MAX_TASK_ATTEMPTS = 2;

export function computeTaskOutcome(
  seed: number,
  ordinal: number,
  attempt: number,
  role: AgentRole,
): TaskOutcome {
  const rng = mulberry32(taskSeed(seed, ordinal, attempt));
  const params = ROLE_PARAMS[role];
  return {
    durationMs: jitter(rng, params.durationBaseMs, 0.2),
    resources: {
      人员: randInt(rng, params.personnel[0], params.personnel[1]),
      [params.equipment.name]: randInt(rng, params.equipment.count[0], params.equipment.count[1]),
    },
    success: rng() >= params.failRate,
  };
}

/** 内置场景的默认任务方案(调度智能体降级时的规则兜底) */
const BUILTIN_TASK_PLANS: Record<string, TaskPlanItem[]> = {
  fire_alarm: [
    { role: "security", title: "封锁并引导疏散", description: "封锁图书馆三层东区,引导人员经西侧楼梯疏散" },
    { role: "medical", title: "医疗待命", description: "在楼下集结点待命,评估潜在伤员并准备急救" },
    { role: "logistics", title: "切断三层电源", description: "联动切断三层东区电源,设置外围警戒线" },
  ],
  medical_emergency: [
    { role: "medical", title: "现场急救", description: "携带急救包赶到倒地学生处,评估意识与生命体征" },
    { role: "security", title: "现场秩序维护", description: "疏导围观学生,预留救护车通道" },
    { role: "logistics", title: "器材与转运支援", description: "运送担架与急救器材到现场,协助模拟转运" },
  ],
};

/**
 * 场景默认任务方案:内置场景用专属清单,自定义场景用按场景名拼装的三角色通用模板
 * (保证任意场景下调度智能体降级时处置仍可推进,不再有缺条目崩溃点)
 */
export function defaultTasksFor(scenarioKey: string, scenarioName: string): TaskPlanItem[] {
  const builtin = BUILTIN_TASK_PLANS[scenarioKey];
  if (builtin) return builtin.map((t) => ({ ...t }));
  return [
    { role: "security", title: "现场管控与警戒", description: `对${scenarioName}事发区域实施警戒隔离,疏导围观人员,预留应急通道` },
    { role: "medical", title: "医疗待命支援", description: `在事发附近集结待命,评估${scenarioName}潜在伤员并准备急救` },
    { role: "logistics", title: "保障与联动支援", description: `保障事发区域周边设施联动与物资供应,协助处置` },
  ];
}
