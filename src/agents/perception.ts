// 监测感知智能体:解读模拟异常信号(位置/类型/时间/证据)上报为事件
// 输出经 zod 运行时校验;坏输出或超时 → 重试一次 → 仍失败按规则默认结果降级

import type { ScheduledSignal } from "../simulation/engine";
import { z } from "zod";
import { invokeAgent, type AgentCallResult, type AgentChatModel } from "./model";
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

export type PerceptionResult = AgentCallResult<PerceptionOutput>;

/** 单次模型调用超时(毫秒) */
export const PERCEPTION_TIMEOUT_MS = 20_000;

export async function runPerception(
  model: AgentChatModel,
  input: PerceptionInput,
  opts?: { timeoutMs?: number },
): Promise<PerceptionResult> {
  return invokeAgent({
    model,
    agent: "perception",
    prompt: perceptionPrompt(PerceptionInputSchema.parse(input)),
    schema: PerceptionOutputSchema,
    fallbackOutput: () => defaultPerception(input),
    timeoutMs: opts?.timeoutMs ?? PERCEPTION_TIMEOUT_MS,
  });
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
