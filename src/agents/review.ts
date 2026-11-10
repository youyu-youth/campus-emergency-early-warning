// 复盘评估智能体:仅基于留存的时间线与动作日志生成报告(时间线归纳、问题分析、改进建议)
// 指标与评分由规则计算,作为只读事实提供;坏输出或超时 → 规则默认报告骨架降级

import { AUDIENCE_LABELS, type NotificationAudience } from "../simulation/delivery-rules";
import { ROLE_LABELS, type AgentRole } from "../simulation/state-machines";
import { z } from "zod";
import { invokeAgent, type AgentCallResult, type AgentChatModel } from "./model";
import { reviewPrompt } from "./prompts";

export const ReviewInputSchema = z.object({
  event: z.object({
    type: z.string().min(1),
    title: z.string().min(1),
    location: z.string().min(1),
    severity: z.enum(["I", "II", "III", "IV"]),
    detectedSimTime: z.string().min(1),
  }),
  scenarioKey: z.string().min(1),
  scenarioName: z.string().min(1),
  /** 规则算好的指标(只读事实,模型引用但不参与计算) */
  metrics: z.object({
    totalDurationMs: z.number(),
    reportDurationMs: z.number(),
    gradingDurationMs: z.number(),
    taskDone: z.number(),
    taskTotal: z.number(),
    resourceTotal: z.number(),
  }),
  /** 留存时间线摘要(报告归纳引用 nodeSeq 溯源) */
  timeline: z
    .array(
      z.object({
        seq: z.number().int(),
        phase: z.string(),
        nodeType: z.string(),
        title: z.string(),
        simTimeLabel: z.string(),
      }),
    )
    .min(1),
  tasks: z.array(
    z.object({
      role: z.string(),
      title: z.string(),
      status: z.string(),
      success: z.boolean().nullable(),
      attempts: z.number(),
    }),
  ),
  notifications: z.array(
    z.object({
      audience: z.enum(["staff_students", "parents"]),
      title: z.string(),
      status: z.string(),
      delivered: z.number().nullable(),
      total: z.number().nullable(),
    }),
  ),
  anomalyCount: z.number().int(),
});
export type ReviewInput = z.infer<typeof ReviewInputSchema>;

export const ReviewOutputSchema = z.object({
  timelineSummary: z
    .array(z.object({ nodeSeq: z.number().int(), summary: z.string().min(1) }))
    .min(1),
  problems: z.array(
    z.object({
      nodeSeq: z.number().int().optional(),
      title: z.string().min(1),
      detail: z.string().min(1),
    }),
  ),
  improvements: z.array(z.object({ title: z.string().min(1), detail: z.string().min(1) })),
});
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;

export type ReviewResult = AgentCallResult<ReviewOutput>;

/** 单次模型调用超时(毫秒) */
export const REVIEW_TIMEOUT_MS = 30_000;

export async function runReview(
  model: AgentChatModel,
  input: ReviewInput,
  opts?: { timeoutMs?: number },
): Promise<ReviewResult> {
  return invokeAgent({
    model,
    agent: "review",
    prompt: reviewPrompt(ReviewInputSchema.parse(input)),
    schema: ReviewOutputSchema,
    fallbackOutput: () => defaultReview(input),
    timeoutMs: opts?.timeoutMs ?? REVIEW_TIMEOUT_MS,
  });
}

/** 时间线主轴节点类型(默认骨架的归纳范围,反馈与异常节点不逐条收录) */
const MAIN_AXIS_TYPES = new Set(["signal", "grading", "dispatch", "notification", "status_change"]);

/** 规则默认报告骨架:归纳直接引用留存节点,问题由失败任务/失败通知/降级次数确定性推导 */
export function defaultReview(input: ReviewInput): ReviewOutput {
  const problems = [];
  for (const task of input.tasks) {
    if (task.status === "failed") {
      problems.push({
        title: `任务「${task.title}」最终失败`,
        detail: `${ROLE_LABELS[task.role as AgentRole] ?? task.role}任务第 ${task.attempts} 次尝试后仍未完成`,
      });
    }
  }
  for (const n of input.notifications) {
    if (n.status === "failed") {
      problems.push({
        title: `「${AUDIENCE_LABELS[n.audience as NotificationAudience]}」通知模拟分发失败`,
        detail: "发布尝试未成功,通道故障,可重试发布",
      });
    }
  }
  if (input.anomalyCount > 0) {
    problems.push({
      title: `存在 ${input.anomalyCount} 次智能体降级`,
      detail: "部分环节由规则默认结果兜底,建议核查对应智能体的模型输出质量",
    });
  }
  return {
    timelineSummary: input.timeline
      .filter((n) => MAIN_AXIS_TYPES.has(n.nodeType))
      .map((n) => ({ nodeSeq: n.seq, summary: n.title })),
    problems,
    improvements: [
      {
        title: "对照时间线逐段复盘",
        detail: "建议结合指标条与关键节点耗时,针对失败与降级环节制定针对性改进措施。(规则默认骨架)",
      },
    ],
  };
}
