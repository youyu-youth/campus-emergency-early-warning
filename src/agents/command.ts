// 指挥调度智能体:定级(runGrading)、任务方案(runDispatch)、重新调度评估(runDispatchEvaluation)
// 输出经 zod 运行时校验;坏输出或超时 → 重试一次 → 仍失败按规则默认结果降级(方案用场景默认,评估保守不加派)

import { defaultTasksFor } from "../simulation/task-rules";
import type { EventSeverity } from "../simulation/state-machines";
import { z } from "zod";
import { invokeAgent, type AgentCallResult, type AgentChatModel } from "./model";
import { dispatchPlanPrompt, gradingPrompt, redispatchPrompt } from "./prompts";

export const GradingInputSchema = z.object({
  event: z.object({
    type: z.string().min(1),
    title: z.string().min(1),
    location: z.string().min(1),
    detectedSimTime: z.string().min(1),
  }),
  scenarioKey: z.string().min(1),
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

// —— 任务方案 ——

const EventSummarySchema = GradingInputSchema.shape.event;
const ScenarioSchema = GradingInputSchema.shape.scenarioKey;

export const TaskPlanItemSchema = z.object({
  role: z.enum(["security", "medical", "logistics"]),
  title: z.string().min(1),
  description: z.string().min(1),
});

export const DispatchInputSchema = z.object({
  event: EventSummarySchema,
  scenarioKey: ScenarioSchema,
  scenarioName: z.string().min(1),
  severity: z.enum(["I", "II", "III", "IV"]),
  evidence: z.array(z.string().min(1)).min(1),
  simTimeLabel: z.string().min(1),
});
export type DispatchInput = z.infer<typeof DispatchInputSchema>;

export const DispatchPlanOutputSchema = z.object({
  tasks: z.array(TaskPlanItemSchema).min(1),
  reasoning: z.string().min(1),
});
export type DispatchPlanOutput = z.infer<typeof DispatchPlanOutputSchema>;

export type DispatchResult = AgentCallResult<DispatchPlanOutput>;

export async function runDispatch(
  model: AgentChatModel,
  input: DispatchInput,
  opts?: { timeoutMs?: number },
): Promise<DispatchResult> {
  return invokeAgent({
    model,
    agent: "command",
    prompt: dispatchPlanPrompt(DispatchInputSchema.parse(input)),
    schema: DispatchPlanOutputSchema,
    fallbackOutput: () => defaultDispatchPlan(input),
    timeoutMs: opts?.timeoutMs ?? GRADING_TIMEOUT_MS,
  });
}

/** 规则默认方案:直接采用场景默认三角色任务,保证处置可推进 */
export function defaultDispatchPlan(input: DispatchInput): DispatchPlanOutput {
  return {
    tasks: defaultTasksFor(input.scenarioKey, input.scenarioName),
    reasoning: "模型输出无效或超时,按规则默认方案:采用三角色任务模板派发(内置场景用专属模板,自定义场景用通用模板)。",
  };
}

// —— 重新调度评估 ——

export const RedispatchInputSchema = z.object({
  event: EventSummarySchema,
  scenarioKey: ScenarioSchema,
  scenarioName: z.string().min(1),
  severity: z.enum(["I", "II", "III", "IV"]),
  milestone: z.object({
    label: z.string().min(1),
    note: z.string().min(1),
    simTimeLabel: z.string().min(1),
  }),
  currentTasks: z.array(z.object({ role: TaskPlanItemSchema.shape.role, title: z.string().min(1), status: z.string().min(1) })),
  simTimeLabel: z.string().min(1),
});
export type RedispatchInput = z.infer<typeof RedispatchInputSchema>;

export const RedispatchOutputSchema = z.object({
  needsRedispatch: z.boolean(),
  additionalTasks: z.array(TaskPlanItemSchema).default([]),
  reasoning: z.string().min(1),
});
export type RedispatchOutput = z.infer<typeof RedispatchOutputSchema>;

export type RedispatchResult = AgentCallResult<RedispatchOutput>;

export async function runDispatchEvaluation(
  model: AgentChatModel,
  input: RedispatchInput,
  opts?: { timeoutMs?: number },
): Promise<RedispatchResult> {
  return invokeAgent({
    model,
    agent: "command",
    prompt: redispatchPrompt(RedispatchInputSchema.parse(input)),
    schema: RedispatchOutputSchema,
    fallbackOutput: () => defaultRedispatch(),
    timeoutMs: opts?.timeoutMs ?? GRADING_TIMEOUT_MS,
  });
}

/** 规则默认评估:模型不可用时保守结论——不调整任务,保证推演不中断 */
export function defaultRedispatch(): RedispatchOutput {
  return {
    needsRedispatch: false,
    additionalTasks: [],
    reasoning: "模型输出无效或超时,按规则保守结论:维持当前任务方案,不加派不调整。",
  };
}
