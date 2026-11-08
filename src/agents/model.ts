// 模型适配器:智能体只依赖可注入的对话模型接口
// 测试注入可编排剧本的假模型;生产注入 DeepSeek(wrapLangChain 适配)
// invokeAgent 是全智能体统一的调用环:超时约束 + 重试一次 + 仍失败按规则默认结果降级

import { z } from "zod";

export interface AgentInvocation {
  /** 发起调用的智能体名(如 perception),假模型按「智能体 + 调用序」取剧本 */
  agent: string;
  prompt: string;
}

export interface AgentChatModel {
  invoke(input: AgentInvocation): Promise<{ content: string }>;
}

/** 剧本条目:字符串为正常响应;badJson 注入坏 JSON;hangMs 模拟模型挂起(触发超时) */
export type ScriptedResponse = string | { badJson: true } | { hangMs: number };

export class ScriptedModel implements AgentChatModel {
  private readonly calls = new Map<string, number>();

  constructor(private readonly scripts: Record<string, ScriptedResponse[]>) {}

  async invoke({ agent }: AgentInvocation): Promise<{ content: string }> {
    const seq = this.calls.get(agent) ?? 0;
    this.calls.set(agent, seq + 1);
    const scripted = this.scripts[agent]?.[seq];
    if (scripted === undefined) {
      throw new Error(`假模型缺少剧本:智能体 ${agent} 第 ${seq + 1} 次调用`);
    }
    if (typeof scripted === "string") return { content: scripted };
    if ("badJson" in scripted) return { content: "这不是 JSON{{{坏输出" };
    await new Promise((resolve) => setTimeout(resolve, scripted.hangMs));
    return { content: "{}" };
  }
}

/** 适配 LangChain ChatModel(如 ChatDeepSeek)到智能体模型接口 */
export function wrapLangChain(
  model: { invoke(prompt: string): Promise<{ content: unknown }> },
): AgentChatModel {
  return {
    invoke: async ({ prompt }) => {
      const message = await model.invoke(prompt);
      const content =
        typeof message.content === "string" ? message.content : JSON.stringify(message.content);
      return { content };
    },
  };
}

// —— 统一调用环 ——

export interface DegradedInfo {
  reason: "invalid_output" | "timeout";
  attempts: number;
  lastError: string;
}

export interface AgentCallResult<Output> {
  output: Output;
  source: "model" | "degraded";
  /** 降级说明(时间线 anomaly 节点记录) */
  degraded?: DegradedInfo;
}

/** 总尝试次数:首次 + 重试一次 */
const MAX_ATTEMPTS = 2;

export async function invokeAgent<Output>(args: {
  model: AgentChatModel;
  agent: string;
  prompt: string;
  schema: z.ZodType<Output>;
  /** 规则默认结果:模型不可用时保证流程继续推进 */
  fallbackOutput: () => Output;
  timeoutMs: number;
}): Promise<AgentCallResult<Output>> {
  let lastError = "";
  let timedOut = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { content } = await withTimeout(
        args.model.invoke({ agent: args.agent, prompt: args.prompt }),
        args.timeoutMs,
      );
      return { output: args.schema.parse(extractJson(content)), source: "model" };
    } catch (error) {
      if (error instanceof ModelTimeoutError) timedOut = true;
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    output: args.fallbackOutput(),
    source: "degraded",
    degraded: { reason: timedOut ? "timeout" : "invalid_output", attempts: MAX_ATTEMPTS, lastError },
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
