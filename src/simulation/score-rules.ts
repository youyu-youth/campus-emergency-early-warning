// 演练总评分规则:由规则 + 指标确定性加权计算,写入 drills.score(LLM 不参与算分,spec 决策 15)
// 五项指标与权重:总时长 25% / 发现→上报 15% / 定级耗时 20% / 任务完成率 25% / 资源消耗 15%

/** 指标条数据(复盘报告与 CLI 摘要同源展示) */
export interface DrillMetrics {
  /** 总时长:首信号发现 → 事件关闭(模拟毫秒) */
  totalDurationMs: number;
  /** 发现→上报耗时:首信号发现 → 感知上报完成(模拟毫秒) */
  reportDurationMs: number;
  /** 定级耗时:感知上报完成 → 定级落定(模拟毫秒) */
  gradingDurationMs: number;
  /** 任务完成数 / 总数(含失败终态) */
  taskDone: number;
  taskTotal: number;
  /** 资源消耗总数(全部尝试累计,名称无关) */
  resourceTotal: number;
}

/** 时效类子项的基准:恰好达标 100 分,两倍基准 0 分(线性,区间外截断) */
const TIMING_TARGETS_MS = {
  total: 360_000, // 6 分钟
  report: 60_000, // 1 分钟
  grading: 60_000, // 1 分钟
} as const;

/** 资源消耗基准:每任务平均消耗 4 单位(人员 + 设备)记 100 分,8 单位记 0 分 */
const RESOURCE_PER_TASK_TARGET = 4;

const WEIGHTS = {
  total: 0.25,
  report: 0.15,
  grading: 0.2,
  completion: 0.25,
  resource: 0.15,
} as const;

function timingScore(durationMs: number, targetMs: number): number {
  return clamp(Math.round((100 * (2 * targetMs - durationMs)) / targetMs));
}

function clamp(score: number): number {
  return Math.max(0, Math.min(100, score));
}

export function computeScore(metrics: DrillMetrics): number {
  const completion =
    metrics.taskTotal > 0 ? clamp(Math.round((100 * metrics.taskDone) / metrics.taskTotal)) : 100;
  const perTask = metrics.resourceTotal / Math.max(metrics.taskTotal, 1);
  const resource = clamp(
    Math.round((100 * (2 * RESOURCE_PER_TASK_TARGET - perTask)) / RESOURCE_PER_TASK_TARGET),
  );
  const total =
    timingScore(metrics.totalDurationMs, TIMING_TARGETS_MS.total) * WEIGHTS.total +
    timingScore(metrics.reportDurationMs, TIMING_TARGETS_MS.report) * WEIGHTS.report +
    timingScore(metrics.gradingDurationMs, TIMING_TARGETS_MS.grading) * WEIGHTS.grading +
    completion * WEIGHTS.completion +
    resource * WEIGHTS.resource;
  return clamp(Math.round(total));
}
