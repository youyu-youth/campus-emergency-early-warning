// 监测感知智能体:解读模拟异常信号(位置/类型/时间/证据)上报为事件
// 输出经 zod 运行时校验;坏输出或超时 → 重试一次 → 仍失败按规则默认结果降级

import type { ScheduledSignal } from "../simulation/engine";
import { z } from "zod";
import type { AgentChatModel } from "./model";
import { perceptionPrompt } from "./prompts";

export const PerceptionInputSchema = z.object({
  signal: z.custom<ScheduledSignal>((s) => typeof s === "object" && s !== null && "signalType" in s),
  scenarioKey: z.enum(["fire_alarm", "medical_emergency"]),
  scenarioName: z.string().min(1),
  /** 信号到期时的模拟时钟显示(HH:mm:ss) */
  simTimeLabel: z.string().min(1),
  /** 首个信号上报为新事件,后续信号作为补充证据 */
  isFirstSignal: z.boolean(),
});
export type PerceptionInput = z.infer<typeof PerceptionInputSchema>;

export const PerceptionOutputSchema = z.object({
  location: z.string().min(1),
  eventType: z.enum(["fire_alarm", "medical_emergency"]),
  title: z.string().min(1),
  occurredTime: z.string().min(1),
  evidence: z.array(z.string().min(1)).min(1),
  reasoning: z.string().min(1),
});
export type PerceptionOutput = z.infer<typeof PerceptionOutputSchema>;

export interface PerceptionResult {
  output: PerceptionOutput;
  source: "model" | "degraded";
  /** 降级说明(时间线 anomaly 节点记录) */
  degraded?: {
    reason: "invalid_output" | "timeout";
    attempts: number;
    lastError: string;
  };
}

/** 单次模型调用超时(毫秒) */
export const PERCEPTION_TIMEOUT_MS = 20_000;
/** 总尝试次数:首次 + 重试一次 */
const MAX_ATTEMPTS = 2;

export async function runPerception(
  model: AgentChatModel,
  input: PerceptionInput,
  opts?: { timeoutMs?: number },
): Promise<PerceptionResult> {
  const timeoutMs = opts?.timeoutMs ?? PERCEPTION_TIMEOUT_MS;
  const prompt = perceptionPrompt(PerceptionInputSchema.parse(input));
  let lastError = "";
  let timedOut = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { content } = await withTimeout(
        model.invoke({ agent: "perception", prompt }),
        timeoutMs,
      );
      const output = PerceptionOutputSchema.parse(extractJson(content));
      return { output, source: "model" };
    } catch (error) {
      if (error instanceof ModelTimeoutError) timedOut = true;
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    output: defaultPerception(input),
    source: "degraded",
    degraded: { reason: timedOut ? "timeout" : "invalid_output", attempts: MAX_ATTEMPTS, lastError },
  };
}

/** 规则默认解读:模型不可用时直接采用信号的来源位置与类型,保证事件仍可上报 */
export function defaultPerception(input: PerceptionInput): PerceptionOutput {
  const kindLabel = input.signal.kind === "sensor" ? "模拟传感器" : "模拟摄像头";
  return {
    location: input.signal.location,
    eventType: input.scenarioKey,
    title: input.isFirstSignal
      ? `${input.scenarioName}信号上报(感知降级 · 默认解读)`
      : `${input.scenarioName}补充证据(感知降级 · 默认解读)`,
    occurredTime: input.simTimeLabel,
    evidence: [
      `${kindLabel} ${input.signal.sourceRef} 上报 ${input.signal.signalType},置信度 ${input.signal.confidence}`,
    ],
    reasoning: "模型输出无效或超时,按规则默认解读:直接采用信号的来源位置与类型上报。",
  };
}

/** 单次模型调用超时的判型错误 */
class ModelTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`模型调用超时(${timeoutMs}ms)`);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new ModelTimeoutError(timeoutMs)), timeoutMs),
    ),
  ]);
}

/** 提取模型输出中的 JSON 对象(容忍 ```json 代码块包裹) */
export function extractJson(content: string): unknown {
  const text = content.trim();
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("模型输出不是有效 JSON");
  }
}
