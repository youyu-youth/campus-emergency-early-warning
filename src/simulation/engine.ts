// 模拟引擎骨架：由场景模板 + 随机种子生成确定性的信号脚本与演变节点
// 同一场景配置与种子 → 完全一致的推演输入（可复现）

import { jitter, mulberry32, randRange } from "./rng";
import { SCENARIOS, type Scenario, type ScenarioKey, type SignalSourceKind } from "./scenarios";

export interface ScheduledSignal {
  offsetMs: number;
  kind: SignalSourceKind;
  sourceRef: string;
  location: string;
  signalType: string;
  confidence: number;
  payload: Record<string, unknown>;
}

export interface ScheduledEvolution {
  offsetMs: number;
  milestone: string;
  note: string;
}

/** 时间偏移的抖动幅度（±15%），由种子决定具体值 */
const JITTER_RATIO = 0.15;

export function getScenario(key: ScenarioKey): Scenario {
  return SCENARIOS[key];
}

// 生成信号脚本：偏移抖动、置信度在区间内取值，按发生顺序排列
export function generateSignalScript(key: ScenarioKey, seed: number): ScheduledSignal[] {
  const scenario = SCENARIOS[key];
  const rng = mulberry32(seed);
  return scenario.signals
    .map((template) => ({
      offsetMs: jitter(rng, template.offsetMs, JITTER_RATIO),
      kind: template.kind,
      sourceRef: template.sourceRef,
      location: template.location,
      signalType: template.signalType,
      confidence: Number(randRange(rng, template.confidence[0], template.confidence[1]).toFixed(2)),
      payload: { ...template.payload },
    }))
    .sort((a, b) => a.offsetMs - b.offsetMs);
}

// 生成场景演变节点：使用独立随机流，不影响信号序列
export function generateEvolution(key: ScenarioKey, seed: number): ScheduledEvolution[] {
  const scenario = SCENARIOS[key];
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  return scenario.evolution
    .map((template) => ({
      ...template,
      offsetMs: jitter(rng, template.offsetMs, JITTER_RATIO),
    }))
    .sort((a, b) => a.offsetMs - b.offsetMs);
}
