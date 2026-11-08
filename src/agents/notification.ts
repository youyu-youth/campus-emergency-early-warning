// 通知发布智能体:为事件生成面向师生/家长的通知草稿(标题 + 正文)
// 正文必须含「模拟演练」标识(zod 强制,漏标即坏输出);坏输出或超时 → 规则默认文案降级

import { AUDIENCE_LABELS } from "../simulation/delivery-rules";
import { SEVERITY_LABELS, type EventSeverity } from "../simulation/state-machines";
import { z } from "zod";
import { invokeAgent, type AgentCallResult, type AgentChatModel } from "./model";
import { notificationPrompt } from "./prompts";

export const NotificationInputSchema = z.object({
  audience: z.enum(["staff_students", "parents"]),
  event: z.object({
    type: z.enum(["fire_alarm", "medical_emergency"]),
    title: z.string().min(1),
    location: z.string().min(1),
  }),
  scenarioKey: z.enum(["fire_alarm", "medical_emergency"]),
  scenarioName: z.string().min(1),
  severity: z.enum(["I", "II", "III", "IV"]),
  simTimeLabel: z.string().min(1),
});
export type NotificationInput = z.infer<typeof NotificationInputSchema>;

export const NotificationOutputSchema = z.object({
  title: z.string().min(1).refine((t) => t.includes("模拟演练"), "标题必须含「模拟演练」标识"),
  content: z.string().min(1).refine((c) => c.includes("模拟演练"), "正文必须含「模拟演练」标识"),
});
export type NotificationOutput = z.infer<typeof NotificationOutputSchema>;

export type NotificationResult = AgentCallResult<NotificationOutput>;

/** 单次模型调用超时(毫秒) */
export const NOTIFICATION_TIMEOUT_MS = 20_000;

export async function runNotification(
  model: AgentChatModel,
  input: NotificationInput,
  opts?: { timeoutMs?: number },
): Promise<NotificationResult> {
  return invokeAgent({
    model,
    agent: "notification",
    prompt: notificationPrompt(NotificationInputSchema.parse(input)),
    schema: NotificationOutputSchema,
    fallbackOutput: () => defaultNotification(input),
    timeoutMs: opts?.timeoutMs ?? NOTIFICATION_TIMEOUT_MS,
  });
}

/** 规则默认文案:模型不可用时按受众模板生成带「模拟演练」标识的通知,保证可发布 */
export function defaultNotification(input: NotificationInput): NotificationOutput {
  const severityLabel = SEVERITY_LABELS[input.severity as EventSeverity];
  const audience = AUDIENCE_LABELS[input.audience];
  if (input.audience === "staff_students") {
    return {
      title: `【模拟演练】${input.event.title}处置通知(${audience})`,
      content: `【模拟演练】${input.event.location}发生${input.event.title}(等级 ${severityLabel})。请相关区域师生服从现场引导,按疏散路线有序撤离至室外集结点,不乘坐电梯、不返回取物。本通知为模拟演练数据,非真实警情。(规则默认文案)`,
    };
  }
  return {
    title: `【模拟演练】${input.event.title}情况通报(${audience})`,
    content: `【模拟演练】家长您好:${input.event.location}发生${input.event.title}(等级 ${severityLabel}),学校已启动应急处置,学生安全在控,请勿恐慌赶往现场,后续进展将通过学校渠道通报。本通报为模拟演练数据,非真实警情。(规则默认文案)`,
  };
}
