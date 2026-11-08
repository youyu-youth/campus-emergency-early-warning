// 指挥调度智能体 · 定级:基于事件证据研判等级,提出建议等级(Ⅰ–Ⅳ)与理由
// 输出经 zod 运行时校验;坏输出或超时 → 重试一次 → 仍失败按规则默认定级降级

import type { EventSeverity } from "../simulation/state-machines";
import { z } from "zod";
import { invokeAgent, type AgentCallResult, type AgentChatModel } from "./model";
import { gradingPrompt } from "./prompts";

export const GradingInputSchema = z.object({
  event: z.object({
    type: z.enum(["fire_alarm", "medical_emergency"]),
    title: z.string().min(1),
    location: z.string().min(1),
    detectedSimTime: z.string().min(1),
  }),
  scenarioKey: z.enum(["fire_alarm", "medical_emergency"]),
  scenarioName: z.string().min(1),
  intensity: z.enum(["low", "medium", "high"]),
  /** 感知智能体提取的证据要点(逐条) */
  evidence: z.array(z.string().min(1)).min(1),
  /** 定级研判时的模拟时钟显示(HH:mm:ss) */
  simTimeLabel: z.string().min(1),
});
export type GradingInput = z.infer<typeof GradingInputSchema>;

export const GradingOutputSchema = z.object({
  suggestedSeverity: z.enum(["I", "II", "III", "IV"]),
  reasoning: z.string().min(1),
});
export type GradingOutput = z.infer<typeof GradingOutputSchema>;

export type GradingResult = AgentCallResult<GradingOutput>;

/** 单次模型调用超时(毫秒) */
export const GRADING_TIMEOUT_MS = 20_000;

export async function runGrading(
  model: AgentChatModel,
  input: GradingInput,
  opts?: { timeoutMs?: number },
): Promise<GradingResult> {
  return invokeAgent({
    model,
    agent: "command",
    prompt: gradingPrompt(GradingInputSchema.parse(input)),
    schema: GradingOutputSchema,
    fallbackOutput: () => defaultGrading(input),
    timeoutMs: opts?.timeoutMs ?? GRADING_TIMEOUT_MS,
  });
}

/** 规则默认定级:模型不可用时按场景强度映射(高→Ⅱ 中→Ⅲ 低→Ⅳ),保证推演不中断 */
export function defaultGrading(input: GradingInput): GradingOutput {
  const severity: Record<GradingInput["intensity"], EventSeverity> = {
    high: "II",
    medium: "III",
    low: "IV",
  };
  return {
    suggestedSeverity: severity[input.intensity],
    reasoning: `模型输出无效或超时,按规则默认定级:场景强度 ${input.intensity},映射为建议等级 ${severity[input.intensity]}。`,
  };
}
