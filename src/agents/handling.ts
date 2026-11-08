// 处置执行智能体:按角色(保安/医务/后勤)生成任务执行叙述
// 耗时、资源、成败由规则计算并作为输入告知;输出经 zod 校验,坏输出/超时 → 规则默认叙述降级
// 剧本键按角色分键(handling_security 等):三角色并行调用时保证剧本取号确定

import { ROLE_LABELS } from "../simulation/state-machines";
import { z } from "zod";
import { invokeAgent, type AgentCallResult, type AgentChatModel } from "./model";
import { handlingPrompt } from "./prompts";

export const HandlingInputSchema = z.object({
  role: z.enum(["security", "medical", "logistics"]),
  taskTitle: z.string().min(1),
  taskDescription: z.string().min(1),
  eventTitle: z.string().min(1),
  location: z.string().min(1),
  severity: z.enum(["I", "II", "III", "IV"]),
  simTimeLabel: z.string().min(1),
  /** 规则计算出的执行结果(叙述必须如实反映,不得虚构成败) */
  outcome: z.object({
    durationMs: z.number().int().nonnegative(),
    resources: z.record(z.string(), z.number().int().nonnegative()),
    success: z.boolean(),
    attempt: z.number().int().positive(),
  }),
});
export type HandlingInput = z.infer<typeof HandlingInputSchema>;

export const HandlingOutputSchema = z.object({
  narrative: z.string().min(1),
});
export type HandlingOutput = z.infer<typeof HandlingOutputSchema>;

export type HandlingResult = AgentCallResult<HandlingOutput>;

/** 单次模型调用超时(毫秒) */
export const HANDLING_TIMEOUT_MS = 20_000;

export async function runHandling(
  model: AgentChatModel,
  input: HandlingInput,
  opts?: { timeoutMs?: number },
): Promise<HandlingResult> {
  return invokeAgent({
    model,
    agent: `handling_${input.role}`,
    prompt: handlingPrompt(HandlingInputSchema.parse(input)),
    schema: HandlingOutputSchema,
    fallbackOutput: () => ({ narrative: defaultHandlingNarrative(input) }),
    timeoutMs: opts?.timeoutMs ?? HANDLING_TIMEOUT_MS,
  });
}

/** 规则默认叙述:模型不可用时按任务与规则结果生成如实陈述,保证反馈不缺失 */
export function defaultHandlingNarrative(input: HandlingInput): string {
  const seconds = Math.round(input.outcome.durationMs / 1000);
  const resources = Object.entries(input.outcome.resources)
    .map(([name, count]) => `${name}×${count}`)
    .join("、");
  const result = input.outcome.success ? "完成" : "失败";
  const attemptNote = input.outcome.attempt > 1 ? `(第 ${input.outcome.attempt} 次尝试)` : "";
  return `${ROLE_LABELS[input.role]}组执行「${input.taskTitle}」${attemptNote}:耗时 ${seconds} 秒,消耗 ${resources},任务${result}(规则默认叙述)。`;
}
