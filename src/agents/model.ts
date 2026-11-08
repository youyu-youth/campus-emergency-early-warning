// 模型适配器:智能体只依赖可注入的对话模型接口
// 测试注入可编排剧本的假模型;生产注入 DeepSeek(wrapLangChain 适配)

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
